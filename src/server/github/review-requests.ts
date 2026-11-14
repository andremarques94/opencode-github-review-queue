import * as v from "valibot"
import { type ReviewRequest, requestKey } from "../../domain/review-request.js"
import { GhError, runGh } from "./cli.js"

const QUERY = `query($endCursor: String) {
  search(query: "is:pr is:open review-requested:@me", type: ISSUE, first: 100, after: $endCursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        number title url createdAt isDraft
        author { login }
        repository { nameWithOwner }
      }
    }
  }
  rateLimit { remaining resetAt }
}`

const PullRequest = v.pipe(
  v.object({
    number: v.number(),
    title: v.string(),
    url: v.string(),
    createdAt: v.string(),
    isDraft: v.boolean(),
    author: v.fallback(v.object({ login: v.string() }), { login: "ghost" }),
    repository: v.object({ nameWithOwner: v.string() }),
  }),
  v.transform(
    (node): ReviewRequest => ({
      key: requestKey(node.repository.nameWithOwner, node.number),
      repository: node.repository.nameWithOwner,
      number: node.number,
      title: node.title,
      url: node.url,
      createdAt: node.createdAt,
      draft: node.isDraft,
      author: node.author.login,
    }),
  ),
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
