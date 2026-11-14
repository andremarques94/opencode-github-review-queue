import type { QueueError, QueueErrorKind } from "../../domain/review-queue.js"
import { type CommandResult, ExitError, type RunOptions, runProcess } from "../process.js"

export class GhError extends Error {
  constructor(readonly detail: QueueError) {
    super(detail.message)
  }
}

export async function runGh(args: readonly string[], options: RunOptions): Promise<CommandResult> {
  try {
    return await runProcess("gh", args, options)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new GhError({
        kind: "missing-gh",
        message: "GitHub CLI (gh) was not found. Install it, then run `gh auth login`.",
      })
    }
    if (error instanceof ExitError) {
      throw classifyGhError(error.stderr || `gh exited with status ${String(error.code)}`)
    }
    throw error
  }
}

const KNOWN_FAILURES: readonly { kind: QueueErrorKind; patterns: readonly string[]; message: string }[] = [
  {
    kind: "authentication",
    patterns: ["authentication", "auth login", "bad credentials", "http 401"],
    message: "GitHub authentication failed. Run `gh auth status`, then `gh auth login` if needed.",
  },
  {
    kind: "rate-limit",
    patterns: ["rate limit", "secondary rate"],
    message: "GitHub rate limit reached. Polling will resume with backoff.",
  },
  {
    kind: "offline",
    patterns: ["could not resolve host", "network", "connection", "offline"],
    message: "GitHub is unreachable. The last successful review queue is still shown.",
  },
  {
    kind: "unavailable",
    patterns: ["not found", "forbidden", "http 403"],
    message: "GitHub denied access to one or more repositories. Check your `gh` account and repository permissions.",
  },
]

function retryAfter(stderr: string): { retryAt?: string } {
  const seconds = stderr.match(/retry[- ]after[: ]+(\d+)/)?.[1]
  return seconds ? { retryAt: new Date(Date.now() + Number(seconds) * 1_000).toISOString() } : {}
}

export function classifyGhError(stderr: string): GhError {
  const text = stderr.trim()
  const lower = text.toLowerCase()
  const known = KNOWN_FAILURES.find((failure) => failure.patterns.some((pattern) => lower.includes(pattern)))
  if (!known) {
    return new GhError({
      kind: "unknown",
      message: text ? `GitHub request failed: ${text.split("\n")[0]}` : "GitHub request failed.",
    })
  }
  return new GhError({
    kind: known.kind,
    message: known.message,
    ...(known.kind === "rate-limit" ? retryAfter(lower) : {}),
  })
}
