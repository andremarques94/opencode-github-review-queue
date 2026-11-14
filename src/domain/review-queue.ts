import type { ReviewRequest } from "./review-request.js"

export type QueueErrorKind = "missing-gh" | "authentication" | "offline" | "rate-limit" | "unavailable" | "unknown"

export type QueueError = {
  kind: QueueErrorKind
  message: string
  retryAt?: string
}

export type QueueSnapshot = {
  items: ReviewRequest[]
  newKeys: string[]
  initialized: boolean
  loading: boolean
  stale: boolean
  lastSuccessAt?: string
  error?: QueueError
}

export type PersistedQueue = {
  version: 1
  initialized: boolean
  items: ReviewRequest[]
  lastSuccessAt?: string
  seen?: Record<string, string>
}

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
