import * as v from "valibot"
import { MyNotice } from "./my-pull-request.js"
import { ReviewRequest } from "./review-request.js"

const QueueErrorKind = v.picklist([
  "missing-gh",
  "outdated-gh",
  "authentication",
  "offline",
  "rate-limit",
  "unavailable",
  "unknown",
])
export type QueueErrorKind = v.InferOutput<typeof QueueErrorKind>

const QueueError = v.object({
  kind: QueueErrorKind,
  message: v.string(),
  retryAt: v.exactOptional(v.string()),
  /** The hosts that failed while others refreshed; their items are kept, and only they are stale. */
  hosts: v.exactOptional(v.array(v.string())),
})
export type QueueError = v.InferOutput<typeof QueueError>

export const QueueSnapshot = v.object({
  items: v.array(ReviewRequest),
  newKeys: v.array(v.string()),
  authored: v.exactOptional(v.array(ReviewRequest)),
  initialized: v.boolean(),
  loading: v.boolean(),
  stale: v.boolean(),
  lastSuccessAt: v.exactOptional(v.string()),
  error: v.exactOptional(QueueError),
})
export type QueueSnapshot = v.InferOutput<typeof QueueSnapshot>

export const PersistedQueue = v.object({
  version: v.literal(1),
  initialized: v.boolean(),
  items: v.array(ReviewRequest),
  lastSuccessAt: v.exactOptional(v.string()),
  seen: v.exactOptional(v.record(v.string(), v.string())),
  newKeys: v.exactOptional(v.array(v.string())),
  authored: v.exactOptional(v.array(ReviewRequest)),
  notices: v.exactOptional(v.array(MyNotice)),
  error: v.exactOptional(QueueError),
})
export type PersistedQueue = v.InferOutput<typeof PersistedQueue>

const OPTIONAL_KEYS = ["authored", "lastSuccessAt", "error"] as const satisfies readonly (keyof QueueSnapshot)[]

/**
 * Replaces `target` with `next` in place, for UI stores that merge: a key `next` leaves out, such as the error of a
 * refresh that failed before, must go rather than linger.
 */
export function replaceSnapshot(target: Partial<QueueSnapshot>, next: QueueSnapshot): void {
  for (const key of OPTIONAL_KEYS) {
    if (!(key in next)) {
      delete target[key]
    }
  }
  Object.assign(target, next)
}

export const everyPullRequest = (state: Pick<QueueSnapshot, "items" | "authored">) => [
  ...state.items,
  ...(state.authored ?? []),
]

export const emptySnapshot = (): QueueSnapshot => ({
  items: [],
  newKeys: [],
  initialized: false,
  loading: true,
  stale: false,
})

export function compareQueues(previous: readonly ReviewRequest[], current: readonly ReviewRequest[]) {
  const previousKeys = new Set(previous.map((item) => item.key))
  const currentKeys = new Set(current.map((item) => item.key))
  return {
    added: current.filter((item) => !previousKeys.has(item.key)),
    removed: previous.filter((item) => !currentKeys.has(item.key)),
  }
}
