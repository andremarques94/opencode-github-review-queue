import * as v from "valibot"
import type { QueueError } from "../../domain/review-queue.js"
import { classifyGhError, GhError, runGh } from "./cli.js"

/** The first release with `gh auth status --json hosts`. */
const MINIMUM_VERSION = [2, 81, 0] as const

/** `undefined` when the output does not parse; the `--json` call then decides. */
export function ghVersion(output: string): [number, number, number] | undefined {
  const match = output.match(/gh version (\d+)\.(\d+)\.(\d+)/)
  if (!match) {
    return undefined
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

const isOlder = (version: readonly number[], minimum: readonly number[]) => {
  const index = version.findIndex((part, at) => part !== minimum[at])
  return index !== -1 && (version[index] ?? 0) < (minimum[index] ?? 0)
}

export async function checkGhVersion(signal: AbortSignal): Promise<void> {
  const version = ghVersion((await runGh(["--version"], { signal })).stdout)
  if (version && isOlder(version, MINIMUM_VERSION)) {
    throw new GhError({
      kind: "outdated-gh",
      message: `GitHub CLI ${MINIMUM_VERSION.join(".")} or later is required (found ${version.join(".")}). Run \`brew upgrade gh\` or see https://cli.github.com.`,
    })
  }
}

/** Only what the plugin needs: `--show-token` is never passed, and other fields are dropped. */
const Account = v.object({
  host: v.string(),
  login: v.optional(v.string()),
  active: v.boolean(),
  state: v.string(),
  error: v.optional(v.string()),
})

const AuthStatus = v.object({
  hosts: v.record(v.string(), v.array(v.fallback(v.nullable(Account), null))),
})

export type GitHubHost = { host: string; error?: QueueError }

/**
 * Every host `gh` is logged into, by its active account. The exit code can be 0 when a check fails, so `state` decides;
 * a host whose account failed is kept with its error, instead of vanishing from the queue.
 */
export async function discoverHosts(signal: AbortSignal): Promise<GitHubHost[]> {
  const result = await runGh(["auth", "status", "--json", "hosts"], { signal })
  let value: unknown
  try {
    value = JSON.parse(result.stdout)
  } catch {
    throw new GhError({ kind: "unknown", message: "`gh auth status` returned malformed JSON." })
  }
  const parsed = v.safeParse(AuthStatus, value)
  if (!parsed.success) {
    throw new GhError({ kind: "unknown", message: "`gh auth status` returned an unexpected response." })
  }
  const hosts = Object.values(parsed.output.hosts).flatMap((accounts) => {
    const active = accounts.find((account) => account?.active)
    if (!active) {
      return []
    }
    return [active.state === "success" ? { host: active.host } : { host: active.host, error: checkFailed(active) }]
  })
  if (hosts.length === 0) {
    throw new GhError({
      kind: "authentication",
      message: "GitHub CLI is not logged in to any host. Run `gh auth login`.",
    })
  }
  return hosts
}

/** The check also fails while the host is unreachable; only a rejected login asks the user to log in again. */
function checkFailed(account: { host: string; state: string; error?: string | undefined }): QueueError {
  const cause = account.state === "timeout" ? "offline" : classifyGhError(account.error ?? "").detail.kind
  if (cause === "offline") {
    return { kind: cause, message: `${account.host} is unreachable. The last successful queue is still shown.` }
  }
  return {
    kind: "authentication",
    message: `GitHub authentication failed for ${account.host}. Run \`gh auth login --hostname ${account.host}\`.`,
  }
}
