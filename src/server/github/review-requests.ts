import * as v from "valibot"
import { type Checks, type ReviewRequest, requestKey } from "../../domain/review-request.js"
import { GhError, runGh } from "./cli.js"

const QUERY = `query($endCursor: String) {
  search(query: "is:pr is:open review-requested:@me", type: ISSUE, first: 100, after: $endCursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        number title url createdAt isDraft headRefOid baseRefOid mergeable
        author { login }
        repository { nameWithOwner }
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
        reviewThreads(first: 100) { pageInfo { hasNextPage } nodes { isResolved } }
      }
    }
  }
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
  }),
  v.transform((node): ReviewRequest => {
    const checks = CHECKS[node.commits?.nodes[0]?.commit.statusCheckRollup?.state ?? ""]
    return {
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
  }),
)

const GraphQLErrors = v.object({ errors: v.pipe(v.array(v.unknown()), v.nonEmpty()) })

const SearchPage = v.object({
  data: v.object({
    search: v.object({ nodes: v.array(v.unknown()) }),
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

function readPage(page: unknown): { nodes: unknown[]; retryAt?: string } {
  if (v.is(GraphQLErrors, page)) {
    throw unchanged("a partial GraphQL response")
  }
  const parsed = v.safeParse(SearchPage, page)
  if (!parsed.success) {
    throw unchanged("a partial response")
  }
  const { search, rateLimit } = parsed.output.data
  return { nodes: search.nodes, ...(rateLimit?.remaining === 0 ? { retryAt: rateLimit.resetAt } : {}) }
}

function readNode(node: unknown): ReviewRequest {
  const parsed = v.safeParse(PullRequest, node)
  if (!parsed.success) {
    throw unchanged("a partial pull request")
  }
  return parsed.output
}

export async function fetchReviewRequests(signal: AbortSignal): Promise<{ items: ReviewRequest[]; retryAt?: string }> {
  const result = await runGh(["api", "graphql", "--paginate", "--slurp", "-f", `query=${QUERY}`], { signal })
  const pages = parsePages(result.stdout).map(readPage)
  const items = pages.flatMap((page) => page.nodes.map(readNode))
  items.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const retryAt = pages.reduce<string | undefined>((last, page) => page.retryAt ?? last, undefined)
  return { items, ...(retryAt ? { retryAt } : {}) }
}
