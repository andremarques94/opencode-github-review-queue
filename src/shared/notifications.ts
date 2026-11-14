import type { ReviewRequest } from "../domain/review-queue.js"

export interface DiscoveryBatcher {
  push(item: ReviewRequest): void
  dispose(): void
}

/**
 * Collects discovered requests into one delivery and drops repeats of a key within `windowMs`. Repeats arrive when
 * several server locations relay the same poller event, or when separate server processes each poll.
 */
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

const repositoryName = (repository: string) => repository.split("/").pop() ?? repository
const shortReference = (item: ReviewRequest) => `${repositoryName(item.repository)} #${item.number}`
const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text)

export function notificationText(items: readonly ReviewRequest[]): { title: string; message: string } {
  const [first] = items
  if (items.length === 1 && first) {
    return { title: `Review requested · ${shortReference(first)}`, message: truncate(first.title, 80) }
  }
  const listed = items.slice(0, 3).map(shortReference).join(", ")
  const more = items.length > 3 ? ` +${items.length - 3} more` : ""
  return { title: `${items.length} new review requests`, message: `${listed}${more}` }
}
