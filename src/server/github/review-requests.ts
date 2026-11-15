import * as v from "valibot"
import type { Authored } from "../../domain/my-pull-request.js"
import { type Checks, type RequestedVia, type ReviewRequest, requestKey } from "../../domain/review-request.js"
import { GhError, runGh } from "./cli.js"

const REQUESTED = "is:pr is:open review-requested:@me"
const REVIEWED = "is:pr is:open reviewed-by:@me -review-requested:@me"

const AUTHORED = "is:pr is:open author:@me"

const pullRequestQuery = (extra: string) => `query($search: String!, $endCursor: String) {
  search(query: $search, type: ISSUE, first: 100, after: $endCursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        number title url createdAt isDraft headRefOid baseRefOid mergeable additions deletions changedFiles
        author { login }
        repository { nameWithOwner }
        commits(last: 1) { nodes { commit { committedDate statusCheckRollup { state } } } }
        reviewThreads(first: 100) { pageInfo { hasNextPage } nodes { isResolved } }
        reviewRequests(first: 100) { nodes { requestedReviewer { ...reviewer } } }
        timelineItems(itemTypes: [REVIEW_REQUESTED_EVENT], last: 20) {
          nodes { ... on ReviewRequestedEvent { createdAt requestedReviewer { ...reviewer } } }
        }${extra}
      }
    }
  }
  viewer { login }
  rateLimit { remaining resetAt }
}
fragment reviewer on RequestedReviewer {
  __typename
  ... on User { login }
  ... on Team { slug organization { login } }
}`

const QUERY = pullRequestQuery("")
const AUTHORED_QUERY = pullRequestQuery(`
        reviewDecision mergeStateStatus
        latestReviews(first: 20) { nodes { state author { login } } }`)

const CHECKS: Record<string, Checks> = {
  SUCCESS: "passing",
  FAILURE: "failing",
  ERROR: "failing",
  PENDING: "pending",
  EXPECTED: "pending",
}

/** GitHub says `UNKNOWN` while it is still computing. */
const MERGEABLE: Record<string, boolean> = { MERGEABLE: false, CONFLICTING: true }

const known = <K extends string, T>(key: K, value: T | null | undefined) =>
  (value === null || value === undefined ? {} : { [key]: value }) as { [P in K]?: T }

/** Readiness is extra: a field GitHub leaves out or changes shape never costs the whole queue. */
const optional = <T extends v.GenericSchema>(schema: T) => v.fallback(v.optional(v.nullable(schema)), undefined)

const Commits = v.object({
  nodes: v.array(
    v.object({
      commit: v.object({
        committedDate: v.optional(v.string()),
        statusCheckRollup: v.nullable(v.object({ state: v.string() })),
      }),
    }),
  ),
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

/** Other timeline items come back as empty objects. */
const RequestEvents = v.object({
  nodes: v.array(v.fallback(v.nullable(v.object({ createdAt: v.string(), requestedReviewer: Reviewer })), null)),
})
type RequestEvent = { at: string; reviewer: Reviewer }

const teamName = (team: { slug: string; organization: { login: string } }) => `${team.organization.login}/${team.slug}`

const isUser = (reviewer: Reviewer, login: string) =>
  reviewer?.__typename === "User" && reviewer.login.toLowerCase() === login.toLowerCase()

function requestedVia(reviewers: readonly Reviewer[], viewer: string): RequestedVia | undefined {
  if (reviewers.some((reviewer) => isUser(reviewer, viewer))) {
    return { kind: "you" }
  }
  const teams = reviewers.flatMap((reviewer) => (reviewer?.__typename === "Team" ? [teamName(reviewer)] : []))
  const [first, ...rest] = teams
  return first ? { kind: "team", teams: [first, ...rest] } : undefined
}

function asksFor(reviewer: Reviewer, via: RequestedVia, viewer: string): boolean {
  if (via.kind === "you") {
    return isUser(reviewer, viewer)
  }
  return reviewer?.__typename === "Team" && via.teams.includes(teamName(reviewer))
}

function requestedAt(events: readonly RequestEvent[], via: RequestedVia | undefined, viewer: string | undefined) {
  const matching = via && viewer ? events.filter((event) => asksFor(event.reviewer, via, viewer)) : events
  return matching.at(-1)?.at
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
    additions: optional(v.number()),
    deletions: optional(v.number()),
    changedFiles: optional(v.number()),
    commits: optional(Commits),
    reviewThreads: optional(ReviewThreads),
    reviewRequests: optional(ReviewRequests),
    timelineItems: optional(RequestEvents),
  }),
  v.transform((node): { request: ReviewRequest; reviewers: Reviewer[]; events: RequestEvent[] } => {
    const commit = node.commits?.nodes[0]?.commit
    const request: ReviewRequest = {
      key: requestKey(node.repository.nameWithOwner, node.number),
      repository: node.repository.nameWithOwner,
      number: node.number,
      title: node.title,
      url: node.url,
      createdAt: node.createdAt,
      draft: node.isDraft,
      author: node.author.login,
      ...known("headSha", node.headRefOid),
      ...known("baseSha", node.baseRefOid),
      ...known("checks", CHECKS[commit?.statusCheckRollup?.state ?? ""]),
      ...known("conflicts", MERGEABLE[node.mergeable ?? ""]),
      ...threadReadiness(node.reviewThreads),
      ...known("additions", node.additions),
      ...known("deletions", node.deletions),
      ...known("changedFiles", node.changedFiles),
      ...known("lastCommitAt", commit?.committedDate),
    }
    return {
      request,
      reviewers: node.reviewRequests?.nodes.map((entry) => entry.requestedReviewer) ?? [],
      events: (node.timelineItems?.nodes ?? []).flatMap((event) =>
        event ? [{ at: event.createdAt, reviewer: event.requestedReviewer }] : [],
      ),
    }
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
  const { request, reviewers, events } = parsed.output
  const via = viewer ? requestedVia(reviewers, viewer) : undefined
  const at = requestedAt(events, via, viewer)
  return { ...request, ...(via ? { requestedVia: via } : {}), ...(at ? { requestedAt: at } : {}) }
}

const REVIEW_DECISIONS = ["APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"] as const
/** `HAS_HOOKS` merges as cleanly as `CLEAN`; GitHub only adds that pre-receive hooks will run. */
const MERGE_READY: Record<string, boolean> = { CLEAN: true, HAS_HOOKS: true, BEHIND: false, BLOCKED: false }

const AuthoredNode = v.object({
  reviewDecision: optional(v.picklist(REVIEW_DECISIONS)),
  mergeStateStatus: optional(v.string()),
  reviewRequests: optional(ReviewRequests),
  latestReviews: optional(
    v.object({ nodes: v.array(v.object({ state: v.string(), author: v.nullable(v.object({ login: v.string() })) })) }),
  ),
})

const reviewerName = (reviewer: Reviewer) => {
  switch (reviewer?.__typename) {
    case undefined:
      return []
    case "User":
      return [reviewer.login]
    case "Team":
      return [teamName(reviewer)]
  }
}

function readAuthored(node: unknown, viewer: string | undefined): ReviewRequest {
  const { requestedVia: _, ...request } = readNode(node, viewer)
  const parsed = v.parse(AuthoredNode, node)
  const mergeReady = MERGE_READY[parsed.mergeStateStatus ?? ""]
  const reviews = parsed.latestReviews?.nodes ?? []
  const authored: Authored = {
    ...(parsed.reviewDecision ? { reviewDecision: parsed.reviewDecision } : {}),
    ...(mergeReady === undefined ? {} : { mergeReady }),
    waitingOn: (parsed.reviewRequests?.nodes ?? []).flatMap((entry) => reviewerName(entry.requestedReviewer)),
    changesRequestedBy: reviews.flatMap((review) =>
      review.state === "CHANGES_REQUESTED" && review.author ? [review.author.login] : [],
    ),
  }
  return { ...request, authored }
}

export type SearchResult = { items: ReviewRequest[]; retryAt?: string }

async function searchPullRequests(
  search: string,
  signal: AbortSignal,
  { query, read }: { query: string; read: typeof readNode } = { query: QUERY, read: readNode },
): Promise<SearchResult> {
  const result = await runGh(
    ["api", "graphql", "--paginate", "--slurp", "-f", `query=${query}`, "-f", `search=${search}`],
    { signal },
  )
  const pages = parsePages(result.stdout).map(readPage)
  const viewer = pages.find((page) => page.viewer)?.viewer
  const items = pages.flatMap((page) => page.nodes.map((node) => read(node, viewer)))
  items.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const retryAt = pages.reduce<string | undefined>((last, page) => page.retryAt ?? last, undefined)
  return { items, ...(retryAt ? { retryAt } : {}) }
}

export const fetchReviewRequests = (signal: AbortSignal) => searchPullRequests(REQUESTED, signal)

export const fetchReviewedPullRequests = (signal: AbortSignal) => searchPullRequests(REVIEWED, signal)

export const fetchAuthoredPullRequests = (signal: AbortSignal) =>
  searchPullRequests(AUTHORED, signal, { query: AUTHORED_QUERY, read: readAuthored })
