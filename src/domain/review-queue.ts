import * as v from "valibot"
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
  error: v.exactOptional(QueueError),
})
export type PersistedQueue = v.InferOutput<typeof PersistedQueue>

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
