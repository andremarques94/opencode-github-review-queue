import * as v from "valibot"
import { MyNotice } from "./my-pull-request.js"
import { ReviewRequest } from "./review-request.js"

const QueueErrorKind = v.picklist(["missing-gh", "authentication", "offline", "rate-limit", "unavailable", "unknown"])
export type QueueErrorKind = v.InferOutput<typeof QueueErrorKind>

const QueueError = v.object({
  kind: QueueErrorKind,
  message: v.string(),
  retryAt: v.exactOptional(v.string()),
})
export type QueueError = v.InferOutput<typeof QueueError>

export const QueueSnapshot = v.object({
  items: v.array(ReviewRequest),
  newKeys: v.array(v.string()),
  /** The user's own open pull requests; missing until fetched, or when that list is turned off. */
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
  /** What changed on the user's own pull requests in this poll, for followers to announce. */
  notices: v.exactOptional(v.array(MyNotice)),
  error: v.exactOptional(QueueError),
})
export type PersistedQueue = v.InferOutput<typeof PersistedQueue>

/** The review queue and the user's own pull requests: everything a key in the panel can point at. */
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
