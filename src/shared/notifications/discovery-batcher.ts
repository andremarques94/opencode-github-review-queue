export type DiscoveryBatcher<T> = {
  push(item: T): void
  dispose(): void
}

export function createDiscoveryBatcher<T extends { key: string }>(
  deliver: (items: T[]) => void,
  { delayMs = 750, windowMs = 60 * 60_000, now = Date.now } = {},
): DiscoveryBatcher<T> {
  const recent = new Map<string, number>()
  let pending: T[] = []
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
