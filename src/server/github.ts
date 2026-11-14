import { spawn } from "node:child_process"
import type { QueueError, ReviewRequest } from "../domain/review-queue.js"
import { requestKey } from "../domain/review-queue.js"

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

interface CommandResult {
  stdout: string
  stderr: string
}

export class GhError extends Error {
  constructor(readonly detail: QueueError) {
    super(detail.message)
  }
}

export function runGh(args: readonly string[], options: { signal: AbortSignal; cwd?: string }): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("gh", args, {
      ...(options.cwd ? { cwd: options.cwd } : {}),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      signal: options.signal,
      windowsHide: true,
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = (stdout + chunk.toString("utf8")).slice(0, 16 * 1024 * 1024)
    })
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(0, 64 * 1024)
    })
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.name === "AbortError") {
        reject(error)
      } else if (error.code === "ENOENT") {
        reject(
          new GhError({
            kind: "missing-gh",
            message: "GitHub CLI (gh) was not found. Install it, then run `gh auth login`.",
          }),
        )
      } else {
        reject(error)
      }
    })
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr })
      } else {
        reject(classifyGhError(stderr || `gh exited with status ${String(code)}`))
      }
    })
  })
}

function classifyGhError(stderr: string): GhError {
  const text = stderr.trim()
  const lower = text.toLowerCase()
  if (
    lower.includes("authentication") ||
    lower.includes("auth login") ||
    lower.includes("bad credentials") ||
    lower.includes("http 401")
  ) {
    return new GhError({
      kind: "authentication",
      message: "GitHub authentication failed. Run `gh auth status`, then `gh auth login` if needed.",
    })
  }
  if (lower.includes("rate limit") || lower.includes("secondary rate")) {
    const retry = lower.match(/retry[- ]after[: ]+(\d+)/)?.[1]
    const retryAt = retry ? new Date(Date.now() + Number(retry) * 1_000).toISOString() : undefined
    return new GhError({
      kind: "rate-limit",
      message: "GitHub rate limit reached. Polling will resume with backoff.",
      ...(retryAt ? { retryAt } : {}),
    })
  }
  if (
    lower.includes("could not resolve host") ||
    lower.includes("network") ||
    lower.includes("connection") ||
    lower.includes("offline")
  ) {
    return new GhError({
      kind: "offline",
      message: "GitHub is unreachable. The last successful review queue is still shown.",
    })
  }
  if (lower.includes("not found") || lower.includes("forbidden") || lower.includes("http 403")) {
    return new GhError({
      kind: "unavailable",
      message: "GitHub denied access to one or more repositories. Check your `gh` account and repository permissions.",
    })
  }
  return new GhError({
    kind: "unknown",
    message: text ? `GitHub refresh failed: ${text.split("\n")[0]}` : "GitHub refresh failed.",
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export async function fetchReviewRequests(signal: AbortSignal): Promise<{ items: ReviewRequest[]; retryAt?: string }> {
  const result = await runGh(["api", "graphql", "--paginate", "--slurp", "-f", `query=${QUERY}`], { signal })
  let parsed: unknown
  try {
    parsed = JSON.parse(result.stdout)
  } catch {
    throw new GhError({
      kind: "unknown",
      message: "GitHub returned malformed JSON; the saved queue was left unchanged.",
    })
  }
  if (!Array.isArray(parsed)) {
    throw new GhError({
      kind: "unknown",
      message: "GitHub returned an incomplete response; the saved queue was left unchanged.",
    })
  }

  const items: ReviewRequest[] = []
  let retryAt: string | undefined
  for (const page of parsed) {
    if (isRecord(page) && Array.isArray(page.errors) && page.errors.length > 0) {
      throw new GhError({
        kind: "unknown",
        message: "GitHub returned a partial GraphQL response; the saved queue was left unchanged.",
      })
    }
    if (
      !isRecord(page) ||
      !isRecord(page.data) ||
      !isRecord(page.data.search) ||
      !Array.isArray(page.data.search.nodes)
    ) {
      throw new GhError({
        kind: "unknown",
        message: "GitHub returned a partial response; the saved queue was left unchanged.",
      })
    }
    for (const node of page.data.search.nodes) {
      if (
        !isRecord(node) ||
        !isRecord(node.repository) ||
        typeof node.repository.nameWithOwner !== "string" ||
        typeof node.number !== "number" ||
        typeof node.title !== "string" ||
        typeof node.url !== "string" ||
        typeof node.createdAt !== "string" ||
        typeof node.isDraft !== "boolean"
      ) {
        throw new GhError({
          kind: "unknown",
          message: "GitHub returned a partial pull request; the saved queue was left unchanged.",
        })
      }
      const repository = node.repository.nameWithOwner
      const author = isRecord(node.author) && typeof node.author.login === "string" ? node.author.login : "ghost"
      items.push({
        key: requestKey(repository, node.number),
        repository,
        number: node.number,
        title: node.title,
        url: node.url,
        createdAt: node.createdAt,
        draft: node.isDraft,
        author,
      })
    }
    if (
      isRecord(page.data.rateLimit) &&
      page.data.rateLimit.remaining === 0 &&
      typeof page.data.rateLimit.resetAt === "string"
    ) {
      retryAt = page.data.rateLimit.resetAt
    }
  }
  items.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  return { items, ...(retryAt ? { retryAt } : {}) }
}

export async function repositoryForDirectory(directory: string, signal: AbortSignal): Promise<string | undefined> {
  try {
    const result = await runGh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], {
      signal,
      cwd: directory,
    })
    return result.stdout.trim() || undefined
  } catch {
    return undefined
  }
}

export async function openReview(item: ReviewRequest, signal: AbortSignal): Promise<void> {
  await runGh(["pr", "view", String(item.number), "--repo", item.repository, "--web"], { signal })
}
