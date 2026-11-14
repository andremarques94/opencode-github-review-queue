import type { ReviewRequest } from "../../domain/review-request.js"

export interface DiscoveryBatcher {
  push(item: ReviewRequest): void
  dispose(): void
}

export function createDiscoveryBatcher(
  deliver: (items: ReviewRequest[]) => void,
  { delayMs = 750, windowMs = 60 * 60_000, now = Date.now } = {},
): DiscoveryBatcher {
  const recent = new Map<string, number>()
  let pending: ReviewRequest[] = []
  let timer: ReturnType<typeof setTimeout> | undefined

  const flush = () => {
    timer = undefined
    const items = pending
    pending = []
    if (items.length > 0) {
      deliver(items)
    }
  }

  return {
    push(item) {
      const time = now()
      for (const [key, at] of recent) {
        if (time - at > windowMs) {
          recent.delete(key)
        }
      }
      if (recent.has(item.key)) {
        return
      }
      recent.set(item.key, time)
      pending.push(item)
      timer ??= setTimeout(flush, delayMs)
    },
    dispose() {
      if (timer) {
        clearTimeout(timer)
      }
      timer = undefined
      pending = []
    },
  }
}
