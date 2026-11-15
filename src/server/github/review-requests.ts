import * as v from "valibot"
import { type Checks, type RequestedVia, type ReviewRequest, requestKey } from "../../domain/review-request.js"
import { GhError, runGh } from "./cli.js"

const REQUESTED = "is:pr is:open review-requested:@me"
/** Reviewed pull requests that no longer ask for the user; the queue keeps those with new commits since. */
const REVIEWED = "is:pr is:open reviewed-by:@me -review-requested:@me"

const QUERY = `query($search: String!, $endCursor: String) {
  search(query: $search, type: ISSUE, first: 100, after: $endCursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        number title url createdAt isDraft headRefOid baseRefOid mergeable
        author { login }
        repository { nameWithOwner }
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
        reviewThreads(first: 100) { pageInfo { hasNextPage } nodes { isResolved } }
        reviewRequests(first: 100) {
          nodes { requestedReviewer { __typename ... on User { login } ... on Team { slug organization { login } } } }
        }
      }
    }
  }
  viewer { login }
  rateLimit { remaining resetAt }
}`

const CHECKS: Record<string, Checks> = {
  SUCCESS: "passing",
  FAILURE: "failing",
  ERROR: "failing",
  PENDING: "pending",
  EXPECTED: "pending",
}

/** Readiness is extra: a field GitHub leaves out or changes shape never costs the whole queue. */
const optional = <T extends v.GenericSchema>(schema: T) => v.fallback(v.optional(v.nullable(schema)), undefined)

const Commits = v.object({
  nodes: v.array(v.object({ commit: v.object({ statusCheckRollup: v.nullable(v.object({ state: v.string() })) }) })),
})

const ReviewThreads = v.object({
  pageInfo: v.optional(v.object({ hasNextPage: v.boolean() })),
  nodes: v.array(v.object({ isResolved: v.boolean() })),
})

/** Past the first page the count is a lower bound; none unresolved on it says nothing about the rest. */
function threadReadiness(threads: v.InferOutput<typeof ReviewThreads> | null | undefined) {
  if (!threads) {
    return {}
  }
  const unresolvedThreads = threads.nodes.filter((thread) => !thread.isResolved).length
  if (!threads.pageInfo?.hasNextPage) {
    return { unresolvedThreads }
  }
  return unresolvedThreads > 0 ? { unresolvedThreads, unresolvedThreadsCapped: true } : {}
}

/** Bots, mannequins, and teams the token cannot read come back as something else, or null; they say nothing. */
const Reviewer = v.fallback(
  v.nullable(
    v.variant("__typename", [
      v.object({ __typename: v.literal("User"), login: v.string() }),
      v.object({ __typename: v.literal("Team"), slug: v.string(), organization: v.object({ login: v.string() }) }),
    ]),
  ),
  null,
)
type Reviewer = v.InferOutput<typeof Reviewer>

const ReviewRequests = v.object({ nodes: v.array(v.object({ requestedReviewer: Reviewer })) })

/** A direct request wins over a team one: the user is asked personally either way. */
function requestedVia(reviewers: readonly Reviewer[], viewer: string): RequestedVia | undefined {
  const named = viewer.toLowerCase()
  if (reviewers.some((reviewer) => reviewer?.__typename === "User" && reviewer.login.toLowerCase() === named)) {
    return { kind: "you" }
  }
  const teams = reviewers.flatMap((reviewer) =>
    reviewer?.__typename === "Team" ? [`${reviewer.organization.login}/${reviewer.slug}`] : [],
  )
  const [first, ...rest] = teams
  return first ? { kind: "team", teams: [first, ...rest] } : undefined
}

const PullRequest = v.pipe(
  v.object({
    number: v.number(),
    title: v.string(),
    url: v.string(),
    createdAt: v.string(),
    isDraft: v.boolean(),
    author: v.fallback(v.object({ login: v.string() }), { login: "ghost" }),
    repository: v.object({ nameWithOwner: v.string() }),
    headRefOid: optional(v.string()),
    baseRefOid: optional(v.string()),
    mergeable: optional(v.string()),
    commits: optional(Commits),
    reviewThreads: optional(ReviewThreads),
    reviewRequests: optional(ReviewRequests),
  }),
  v.transform((node): { request: ReviewRequest; reviewers: Reviewer[] } => {
    const checks = CHECKS[node.commits?.nodes[0]?.commit.statusCheckRollup?.state ?? ""]
    const request: ReviewRequest = {
      key: requestKey(node.repository.nameWithOwner, node.number),
      repository: node.repository.nameWithOwner,
      number: node.number,
      title: node.title,
      url: node.url,
      createdAt: node.createdAt,
      draft: node.isDraft,
      author: node.author.login,
      ...(node.headRefOid ? { headSha: node.headRefOid } : {}),
      ...(node.baseRefOid ? { baseSha: node.baseRefOid } : {}),
      ...(checks ? { checks } : {}),
      ...(node.mergeable === "MERGEABLE" || node.mergeable === "CONFLICTING"
        ? { conflicts: node.mergeable === "CONFLICTING" }
        : {}),
      ...threadReadiness(node.reviewThreads),
    }
    return { request, reviewers: node.reviewRequests?.nodes.map((entry) => entry.requestedReviewer) ?? [] }
  }),
)

const GraphQLErrors = v.object({ errors: v.pipe(v.array(v.unknown()), v.nonEmpty()) })

const SearchPage = v.object({
  data: v.object({
    search: v.object({ nodes: v.array(v.unknown()) }),
    viewer: v.fallback(v.optional(v.object({ login: v.string() })), undefined),
    rateLimit: v.fallback(v.optional(v.object({ remaining: v.number(), resetAt: v.string() })), undefined),
  }),
})

const unchanged = (problem: string) =>
  new GhError({ kind: "unknown", message: `GitHub returned ${problem}; the saved queue was left unchanged.` })

function parsePages(stdout: string): unknown[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    throw unchanged("malformed JSON")
  }
  if (!Array.isArray(parsed)) {
    throw unchanged("an incomplete response")
  }
  return parsed
}

function readPage(page: unknown): { nodes: unknown[]; viewer?: string; retryAt?: string } {
  if (v.is(GraphQLErrors, page)) {
    throw unchanged("a partial GraphQL response")
  }
  const parsed = v.safeParse(SearchPage, page)
  if (!parsed.success) {
    throw unchanged("a partial response")
  }
  const { search, viewer, rateLimit } = parsed.output.data
  return {
    nodes: search.nodes,
    ...(viewer ? { viewer: viewer.login } : {}),
    ...(rateLimit?.remaining === 0 ? { retryAt: rateLimit.resetAt } : {}),
  }
}

/** Without the viewer's login a direct request cannot be told from a team one, so neither is claimed. */
function readNode(node: unknown, viewer: string | undefined): ReviewRequest {
  const parsed = v.safeParse(PullRequest, node)
  if (!parsed.success) {
    throw unchanged("a partial pull request")
  }
  const { request, reviewers } = parsed.output
  const via = viewer ? requestedVia(reviewers, viewer) : undefined
  return via ? { ...request, requestedVia: via } : request
}

export type SearchResult = { items: ReviewRequest[]; retryAt?: string }

async function searchPullRequests(search: string, signal: AbortSignal): Promise<SearchResult> {
  const result = await runGh(
    ["api", "graphql", "--paginate", "--slurp", "-f", `query=${QUERY}`, "-f", `search=${search}`],
    { signal },
  )
  const pages = parsePages(result.stdout).map(readPage)
  const viewer = pages.find((page) => page.viewer)?.viewer
  const items = pages.flatMap((page) => page.nodes.map((node) => readNode(node, viewer)))
  items.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const retryAt = pages.reduce<string | undefined>((last, page) => page.retryAt ?? last, undefined)
  return { items, ...(retryAt ? { retryAt } : {}) }
}

export const fetchReviewRequests = (signal: AbortSignal) => searchPullRequests(REQUESTED, signal)

export const fetchReviewedPullRequests = (signal: AbortSignal) => searchPullRequests(REVIEWED, signal)
