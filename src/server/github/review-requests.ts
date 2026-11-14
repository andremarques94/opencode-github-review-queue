import { type ReviewRequest, requestKey } from "@/domain/review-request.js"
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

interface PullRequestNode {
  number: number
  title: string
  url: string
  createdAt: string
  isDraft: boolean
  author?: unknown
  repository: { nameWithOwner: string }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null

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

const hasErrors = (page: Record<string, unknown>) => Array.isArray(page.errors) && page.errors.length > 0

function searchData(page: unknown): { nodes: unknown[]; rateLimit: unknown } {
  if (!isRecord(page) || hasErrors(page)) {
    throw unchanged(isRecord(page) ? "a partial GraphQL response" : "a partial response")
  }
  const data = page.data
  if (!isRecord(data) || !isRecord(data.search) || !Array.isArray(data.search.nodes)) {
    throw unchanged("a partial response")
  }
  return { nodes: data.search.nodes, rateLimit: data.rateLimit }
}

function readPage(page: unknown): { nodes: unknown[]; retryAt?: string } {
  const { nodes, rateLimit } = searchData(page)
  const resetAt = isRecord(rateLimit) && rateLimit.remaining === 0 ? rateLimit.resetAt : undefined
  return { nodes, ...(typeof resetAt === "string" ? { retryAt: resetAt } : {}) }
}

function isPullRequestNode(node: unknown): node is PullRequestNode {
  return (
    isRecord(node) &&
    isRecord(node.repository) &&
    typeof node.repository.nameWithOwner === "string" &&
    typeof node.number === "number" &&
    typeof node.title === "string" &&
    typeof node.url === "string" &&
    typeof node.createdAt === "string" &&
    typeof node.isDraft === "boolean"
  )
}

function readNode(node: unknown): ReviewRequest {
  if (!isPullRequestNode(node)) {
    throw unchanged("a partial pull request")
  }
  const repository = node.repository.nameWithOwner
  return {
    key: requestKey(repository, node.number),
    repository,
    number: node.number,
    title: node.title,
    url: node.url,
    createdAt: node.createdAt,
    draft: node.isDraft,
    author: isRecord(node.author) && typeof node.author.login === "string" ? node.author.login : "ghost",
  }
}

export async function fetchReviewRequests(signal: AbortSignal): Promise<{ items: ReviewRequest[]; retryAt?: string }> {
  const result = await runGh(["api", "graphql", "--paginate", "--slurp", "-f", `query=${QUERY}`], { signal })
  const pages = parsePages(result.stdout).map(readPage)
  const items = pages.flatMap((page) => page.nodes.map(readNode))
  items.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const retryAt = pages.reduce<string | undefined>((last, page) => page.retryAt ?? last, undefined)
  return { items, ...(retryAt ? { retryAt } : {}) }
}
