import { spawn } from "node:child_process"
import type { QueueError, QueueErrorKind } from "@/domain/review-queue.js"

export interface CommandResult {
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
      message: text ? `GitHub refresh failed: ${text.split("\n")[0]}` : "GitHub refresh failed.",
    })
  }
  return new GhError({
    kind: known.kind,
    message: known.message,
    ...(known.kind === "rate-limit" ? retryAfter(lower) : {}),
  })
}
