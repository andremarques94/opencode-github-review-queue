import { describe, expect, it, vi } from "vitest"
import { compareQueues, type PersistedQueue } from "../src/domain/review-queue.js"
import { type ReviewRequest, requestKey } from "../src/domain/review-request.js"
import { type QueuePersistence, ReviewQueuePoller } from "../src/server/review-queue-poller.js"

const item = (repository: string, number: number): ReviewRequest => ({
  key: requestKey(repository, number),
  repository,
  number,
  title: `PR ${number}`,
  author: "octocat",
  draft: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  url: `https://github.com/${repository}/pull/${number}`,
})

function memoryPersistence(initial?: PersistedQueue) {
  let value = initial
  const persistence: QueuePersistence = {
    load: vi.fn(async () => value),
    save: vi.fn(async (next) => {
      value = structuredClone(next)
    }),
  }
  return { persistence, read: () => value }
}

const options = { intervalMs: 60_000, timeoutMs: 5_000, maxBackoffMs: 15 * 60_000 }

describe("review queue comparison", () => {
  it("finds additions and removals by repository-qualified key", () => {
    const one = item("acme/api", 7)
    const sameNumberElsewhere = item("acme/web", 7)
    const result = compareQueues([one], [sameNumberElsewhere])

    expect(result.added).toEqual([sameNumberElsewhere])
    expect(result.removed).toEqual([one])
  })
})

describe("ReviewQueuePoller", () => {
  it("establishes the first successful baseline silently", async () => {
    const saved = memoryPersistence()
    const poller = new ReviewQueuePoller(async () => ({ items: [item("acme/api", 1)] }), saved.persistence, options)
    const discovered: ReviewRequest[] = []
    poller.on((event) => {
      if (event.type === "discovered") {
        discovered.push(event.item)
      }
    })

    await poller.start()

    expect(poller.snapshot().items).toHaveLength(1)
    expect(poller.snapshot().newKeys).toEqual([])
    expect(discovered).toEqual([])
    expect(saved.read()?.initialized).toBe(true)
    poller.stop()
  })

  it("uses the persisted queue as the restart baseline", async () => {
    const existing = item("acme/api", 2)
    const saved = memoryPersistence({
      version: 1,
      initialized: true,
      items: [existing],
      lastSuccessAt: "2026-01-01T00:00:00.000Z",
    })
    const poller = new ReviewQueuePoller(async () => ({ items: [existing] }), saved.persistence, options)
    const discovered = vi.fn()
    poller.on((event) => {
      if (event.type === "discovered") {
        discovered(event.item)
      }
    })

    await poller.start()

    expect(discovered).not.toHaveBeenCalled()
    expect(poller.snapshot().items).toEqual([existing])
    poller.stop()
  })

  it("ignores a request that briefly drops out of search results", async () => {
    const request = item("acme/api", 3)
    const queues = [[request], [], [request]]
    let now = Date.parse("2026-01-01T00:00:00.000Z")
    const poller = new ReviewQueuePoller(
      async () => ({ items: queues.shift() ?? [] }),
      memoryPersistence().persistence,
      { ...options, renotifyAfterMs: 60 * 60_000 },
      () => now,
    )
    const discovered: ReviewRequest[] = []
    poller.on((event) => {
      if (event.type === "discovered") {
        discovered.push(event.item)
      }
    })

    await poller.start()
    now += 60_000
    await poller.refresh()
    now += 60_000
    await poller.refresh()

    expect(discovered).toEqual([])
    expect(poller.snapshot().newKeys).toEqual([])
    poller.stop()
  })

  it("notifies when a request returns after the renotify window", async () => {
    const request = item("acme/api", 3)
    const queues = [[request], [], [request]]
    let now = Date.parse("2026-01-01T00:00:00.000Z")
    const saved = memoryPersistence()
    const poller = new ReviewQueuePoller(
      async () => ({ items: queues.shift() ?? [] }),
      saved.persistence,
      { ...options, renotifyAfterMs: 60 * 60_000 },
      () => now,
    )
    const discovered: ReviewRequest[] = []
    poller.on((event) => {
      if (event.type === "discovered") {
        discovered.push(event.item)
      }
    })

    await poller.start()
    now += 60_000
    await poller.refresh()
    now += 2 * 60 * 60_000
    await poller.refresh()

    expect(discovered).toEqual([request])
    expect(poller.snapshot().newKeys).toEqual([request.key])
    expect(Object.keys(saved.read()?.seen ?? {})).toEqual([request.key])
    poller.stop()
  })

  it("remembers recently seen requests across restarts", async () => {
    const request = item("acme/api", 5)
    const now = Date.parse("2026-01-01T00:10:00.000Z")
    const saved = memoryPersistence({
      version: 1,
      initialized: true,
      items: [],
      lastSuccessAt: "2026-01-01T00:09:00.000Z",
      seen: { [request.key]: "2026-01-01T00:05:00.000Z" },
    })
    const poller = new ReviewQueuePoller(
      async () => ({ items: [request] }),
      saved.persistence,
      options,
      () => now,
    )
    const discovered = vi.fn()
    poller.on((event) => {
      if (event.type === "discovered") {
        discovered(event.item)
      }
    })

    await poller.start()

    expect(discovered).not.toHaveBeenCalled()
    poller.stop()
  })

  it("preserves the last successful queue and baseline after failure", async () => {
    const request = item("acme/api", 4)
    const saved = memoryPersistence()
    let fail = false
    const poller = new ReviewQueuePoller(
      async () => {
        if (fail) {
          throw new Error("offline")
        }
        return { items: [request] }
      },
      saved.persistence,
      options,
    )

    await poller.start()
    const baseline = structuredClone(saved.read())
    fail = true
    await poller.refresh()

    expect(poller.snapshot().items).toEqual([request])
    expect(poller.snapshot().stale).toBe(true)
    expect(poller.snapshot().error?.message).toBe("offline")
    expect(saved.read()).toEqual(baseline)
    poller.stop()
  })

  it("coalesces overlapping refreshes", async () => {
    const saved = memoryPersistence()
    let resolveFetch: ((value: { items: ReviewRequest[] }) => void) | undefined
    const fetchQueue = vi.fn(
      () =>
        new Promise<{ items: ReviewRequest[] }>((resolve) => {
          resolveFetch = resolve
        }),
    )
    const poller = new ReviewQueuePoller(fetchQueue, saved.persistence, options)

    const starting = poller.start()
    await vi.waitFor(() => expect(fetchQueue).toHaveBeenCalledTimes(1))
    const first = poller.refresh()
    const second = poller.refresh()

    expect(first).toBe(second)
    expect(fetchQueue).toHaveBeenCalledTimes(1)
    resolveFetch?.({ items: [] })
    await Promise.all([starting, first, second])
    poller.stop()
  })
})
