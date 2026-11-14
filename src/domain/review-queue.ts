export interface ReviewRequest {
  key: string
  repository: string
  number: number
  title: string
  author: string
  draft: boolean
  createdAt: string
  url: string
}

export type QueueErrorKind = "missing-gh" | "authentication" | "offline" | "rate-limit" | "unavailable" | "unknown"

export interface QueueError {
  kind: QueueErrorKind
  message: string
  retryAt?: string
}

export interface QueueSnapshot {
  items: ReviewRequest[]
  newKeys: string[]
  initialized: boolean
  loading: boolean
  stale: boolean
  lastSuccessAt?: string
  error?: QueueError
}

export interface PersistedQueue {
  version: 1
  initialized: boolean
  items: ReviewRequest[]
  lastSuccessAt?: string
}

export const emptySnapshot = (): QueueSnapshot => ({
  items: [],
  newKeys: [],
  initialized: false,
  loading: true,
  stale: false,
})

export function requestKey(repository: string, number: number): string {
  return `${repository.toLowerCase()}#${number}`
}

export function compareQueues(previous: readonly ReviewRequest[], current: readonly ReviewRequest[]) {
  const previousKeys = new Set(previous.map((item) => item.key))
  const currentKeys = new Set(current.map((item) => item.key))
  return {
    added: current.filter((item) => !previousKeys.has(item.key)),
    removed: previous.filter((item) => !currentKeys.has(item.key)),
  }
}
