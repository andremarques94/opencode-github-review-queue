import { describe, expect, it, vi } from "vitest"
import { compareQueues, type PersistedQueue, replaceSnapshot } from "../src/domain/review-queue.js"
import { type ReviewRequest, requestKey } from "../src/domain/review-request.js"
import { StorageLease } from "../src/server/queue-lease.js"
import { type PollerEvent, type QueuePersistence, ReviewQueuePoller } from "../src/server/review-queue-poller.js"

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

describe("replaceSnapshot", () => {
  it("drops what the new snapshot leaves out, such as an error that has cleared", () => {
    const failed = {
      items: [],
      newKeys: [],
      authored: [item("acme/api", 1)],
      initialized: true,
      loading: false,
      stale: true,
      lastSuccessAt: "2026-01-01T00:00:00.000Z",
      error: { kind: "offline" as const, message: "GitHub is unreachable." },
    }
    const recovered = { items: [item("acme/api", 2)], newKeys: [], initialized: true, loading: false, stale: false }
    const store = structuredClone(failed)

    replaceSnapshot(store, recovered)

    expect(store).toEqual(recovered)
  })
})

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

  it("discards a persisted queue with a corrupt item", async () => {
    const persistence: QueuePersistence = {
      load: async () => ({ version: 1, initialized: true, items: [{ key: "acme/api#1" }] }),
      save: vi.fn(async () => {}),
    }
    const poller = new ReviewQueuePoller(async () => ({ items: [item("acme/api", 1)] }), persistence, options)
    const discovered = vi.fn()
    poller.on((event) => {
      if (event.type === "discovered") {
        discovered(event.item)
      }
    })

    await poller.start()

    expect(discovered).not.toHaveBeenCalled()
    expect(poller.snapshot().items).toEqual([item("acme/api", 1)])
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

  it("announces a follow-up once, and not again when it is re-requested", async () => {
    const followUp = { ...item("acme/api", 4), followUp: true as const }
    const queues = [[], [followUp], [item("acme/api", 4)]]
    const poller = new ReviewQueuePoller(
      async () => ({ items: queues.shift() ?? [] }),
      memoryPersistence().persistence,
      options,
    )
    const discovered: ReviewRequest[] = []
    poller.on((event) => {
      if (event.type === "discovered") {
        discovered.push(event.item)
      }
    })

    await poller.start()
    await poller.refresh()
    await poller.refresh()

    expect(discovered).toEqual([followUp])
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
    expect(saved.read()).toEqual({ ...baseline, error: { kind: "unknown", message: "offline" } })
    poller.stop()
  })

  it("shows a failing host without marking the other hosts' queue stale", async () => {
    const saved = memoryPersistence()
    const partial = { kind: "offline" as const, message: "ghe.acme.com: unreachable", hosts: ["ghe.acme.com"] }
    const results = [{ items: [item("acme/api", 1)], error: partial }, { items: [item("acme/api", 1)] }]
    const contexts: unknown[] = []
    const poller = new ReviewQueuePoller(
      async (_signal, context) => {
        contexts.push(context.manual)
        return results.shift() ?? { items: [] }
      },
      saved.persistence,
      options,
    )
    const follower = new ReviewQueuePoller(async () => ({ items: [] }), saved.persistence, options, Date.now, {
      acquire: async () => false,
      claim: async () => {},
      release: async () => {},
    })

    await poller.start()
    await follower.start()

    expect(poller.snapshot()).toMatchObject({ stale: false, error: partial })
    expect(saved.read()?.error).toEqual(partial)
    expect(follower.snapshot()).toMatchObject({ stale: false, error: partial })

    await poller.refresh()

    expect(poller.snapshot()).not.toHaveProperty("error")
    expect(contexts).toEqual([false, true])
    poller.stop()
    follower.stop()
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

/** Two locations: each has its own poller and lease, sharing one plugin storage. */
function sharedStorage() {
  const values = new Map<string, unknown>()
  const slot = (key: string) => ({
    load: async () => structuredClone(values.get(key)),
    save: async (value: unknown) => void values.set(key, structuredClone(value)),
    remove: async () => void values.delete(key),
  })
  return { values, baseline: slot("baseline"), lease: slot("lease") }
}

describe("StorageLease", () => {
  const TTL = 1_000

  it("is acquired when free, renewed by its holder, and refused to others while live", async () => {
    const storage = sharedStorage()
    let now = 0
    const first = new StorageLease(storage.lease, TTL, () => now, "first")
    const second = new StorageLease(storage.lease, TTL, () => now, "second")

    expect(await first.acquire()).toBe(true)
    now = 900
    expect(await first.acquire()).toBe(true)
    expect(storage.values.get("lease")).toEqual({ owner: "first", expiresAt: 1_900 })
    now = 1_500
    expect(await second.acquire()).toBe(false)
  })

  it("hands a lapsed lease over, and the old holder yields", async () => {
    const storage = sharedStorage()
    let now = 0
    const first = new StorageLease(storage.lease, TTL, () => now, "first")
    const second = new StorageLease(storage.lease, TTL, () => now, "second")
    await first.acquire()

    now = 1_001
    expect(await second.acquire()).toBe(true)
    expect(await first.acquire()).toBe(false)
  })

  it("loses a race when another instance's write lands first", async () => {
    const storage = sharedStorage()
    const lease = new StorageLease(
      { ...storage.lease, save: async () => void storage.values.set("lease", { owner: "other", expiresAt: 5_000 }) },
      TTL,
      () => 0,
      "mine",
    )

    expect(await lease.acquire()).toBe(false)
  })

  it("releases only its own lease", async () => {
    const storage = sharedStorage()
    const first = new StorageLease(storage.lease, TTL, () => 0, "first")
    const second = new StorageLease(storage.lease, TTL, () => 0, "second")
    await first.acquire()

    await second.release()
    expect(storage.values.has("lease")).toBe(true)
    await first.release()
    expect(storage.values.has("lease")).toBe(false)
  })
})

describe("ReviewQueuePoller across locations", () => {
  const TTL = 3 * options.intervalMs

  function location(
    storage: ReturnType<typeof sharedStorage>,
    owner: string,
    clock: () => number,
    queue: () => ReviewRequest[],
  ) {
    const fetchQueue = vi.fn(async () => ({ items: queue() }))
    const poller = new ReviewQueuePoller(
      fetchQueue,
      storage.baseline,
      options,
      clock,
      new StorageLease(storage.lease, TTL, clock, owner),
    )
    const events: PollerEvent[] = []
    poller.on((event) => events.push(event))
    const of = (type: PollerEvent["type"]) => events.filter((event) => event.type === type)
    return { poller, fetchQueue, of }
  }

  it("polls GitHub from one location while the other follows the saved queue", async () => {
    const storage = sharedStorage()
    let now = Date.parse("2026-01-01T00:00:00.000Z")
    let queue = [item("acme/api", 1)]
    const leader = location(
      storage,
      "leader",
      () => now,
      () => queue,
    )
    const follower = location(
      storage,
      "follower",
      () => now,
      () => queue,
    )

    await leader.poller.start()
    await follower.poller.start()

    expect(leader.fetchQueue).toHaveBeenCalledTimes(1)
    expect(follower.fetchQueue).not.toHaveBeenCalled()
    expect(follower.poller.snapshot()).toMatchObject({ items: queue, loading: false, initialized: true })

    queue = [item("acme/api", 1), item("acme/api", 2)]
    now += options.intervalMs
    await leader.poller.poll()
    await follower.poller.poll()

    expect(follower.fetchQueue).not.toHaveBeenCalled()
    expect(follower.poller.snapshot().items).toEqual(queue)
    expect(follower.poller.snapshot().newKeys).toEqual(["acme/api#2"])
    expect(follower.of("discovered")).toEqual([
      { type: "discovered", item: item("acme/api", 2), eventID: `acme/api#2:${new Date(now).toISOString()}` },
    ])
    expect(follower.of("fetched")).toEqual([])
    expect(leader.of("fetched")).toHaveLength(2)
    leader.poller.stop()
    follower.poller.stop()
  })

  it("announces changes on the user's own pull requests on both locations, once each", async () => {
    const storage = sharedStorage()
    let now = Date.parse("2026-01-01T00:00:00.000Z")
    const own = (mergeReady: boolean): ReviewRequest => ({
      ...item("acme/api", 7),
      authored: { mergeReady, waitingOn: [], changesRequestedBy: [] },
    })
    let authored = [own(false)]
    const make = (owner: string) => {
      const poller = new ReviewQueuePoller(
        async () => ({ items: [], authored }),
        storage.baseline,
        options,
        () => now,
        new StorageLease(storage.lease, TTL, () => now, owner),
      )
      const notices: PollerEvent[] = []
      poller.on((event) => event.type === "notice" && notices.push(event))
      return { poller, notices }
    }
    const leader = make("leader")
    const follower = make("follower")

    await leader.poller.start()
    await follower.poller.start()
    authored = [own(true)]
    now += options.intervalMs
    await leader.poller.poll()
    await follower.poller.poll()
    await follower.poller.poll()

    const expected = {
      type: "notice",
      notice: { key: "acme/api#7", kind: "ready-to-merge" },
      item: own(true),
      eventID: `acme/api#7:ready-to-merge:${new Date(now).toISOString()}`,
    }
    expect(leader.notices).toEqual([expected])
    expect(follower.notices).toEqual([expected])
    expect(follower.poller.snapshot().authored).toEqual([own(true)])
    leader.poller.stop()
    follower.poller.stop()
  })

  it("does not announce the same queue twice to a follower", async () => {
    const storage = sharedStorage()
    const now = Date.parse("2026-01-01T00:00:00.000Z")
    const leader = location(
      storage,
      "leader",
      () => now,
      () => [item("acme/api", 1)],
    )
    const follower = location(
      storage,
      "follower",
      () => now,
      () => [],
    )

    await leader.poller.start()
    await follower.poller.start()
    const states = follower.of("state").length
    await follower.poller.poll()

    expect(follower.of("state")).toHaveLength(states)
    leader.poller.stop()
    follower.poller.stop()
  })

  it("shows the holder's failure to followers", async () => {
    const storage = sharedStorage()
    const now = Date.parse("2026-01-01T00:00:00.000Z")
    let fail = false
    const leader = location(
      storage,
      "leader",
      () => now,
      () => {
        if (fail) {
          throw new Error("offline")
        }
        return [item("acme/api", 1)]
      },
    )
    const follower = location(
      storage,
      "follower",
      () => now,
      () => [],
    )
    await leader.poller.start()
    await follower.poller.start()

    fail = true
    await leader.poller.refresh()
    await follower.poller.poll()

    expect(follower.poller.snapshot()).toMatchObject({
      stale: true,
      error: { message: "offline" },
      items: [item("acme/api", 1)],
    })
    leader.poller.stop()
    follower.poller.stop()
  })

  it("re-reads the saved queue when asked for the latest one", async () => {
    const storage = sharedStorage()
    let now = Date.parse("2026-01-01T00:00:00.000Z")
    let queue = [item("acme/api", 1)]
    const leader = location(
      storage,
      "leader",
      () => now,
      () => queue,
    )
    const follower = location(
      storage,
      "follower",
      () => now,
      () => queue,
    )
    await leader.poller.start()
    await follower.poller.start()

    queue = [item("acme/api", 1), item("acme/api", 2)]
    now += options.intervalMs
    await leader.poller.poll()

    expect(follower.poller.snapshot().items).toHaveLength(1)
    expect((await follower.poller.latest()).items).toEqual(queue)
    expect(follower.fetchQueue).not.toHaveBeenCalled()
    leader.poller.stop()
    follower.poller.stop()
  })

  it("takes over once the holder's lease lapses", async () => {
    const storage = sharedStorage()
    let now = Date.parse("2026-01-01T00:00:00.000Z")
    const queue = [item("acme/api", 1)]
    const leader = location(
      storage,
      "leader",
      () => now,
      () => queue,
    )
    const follower = location(
      storage,
      "follower",
      () => now,
      () => queue,
    )
    await leader.poller.start()
    await follower.poller.start()

    now += TTL - 1
    await follower.poller.poll()
    expect(follower.fetchQueue).not.toHaveBeenCalled()

    now += 2
    await follower.poller.poll()
    expect(follower.fetchQueue).toHaveBeenCalledTimes(1)
    expect(follower.of("fetched")).toHaveLength(1)

    now += options.intervalMs
    await leader.poller.poll()
    expect(leader.fetchQueue).toHaveBeenCalledTimes(1)
    leader.poller.stop()
    follower.poller.stop()
  })

  it("hands over right away when the holder stops", async () => {
    const storage = sharedStorage()
    const now = Date.parse("2026-01-01T00:00:00.000Z")
    const leader = location(
      storage,
      "leader",
      () => now,
      () => [],
    )
    const follower = location(
      storage,
      "follower",
      () => now,
      () => [],
    )
    await leader.poller.start()
    await follower.poller.start()

    leader.poller.stop()
    await vi.waitFor(() => expect(storage.values.has("lease")).toBe(false))
    await follower.poller.poll()

    expect(follower.fetchQueue).toHaveBeenCalledTimes(1)
    follower.poller.stop()
  })

  it("refreshes from a follower by taking the lease over", async () => {
    const storage = sharedStorage()
    let now = Date.parse("2026-01-01T00:00:00.000Z")
    const leader = location(
      storage,
      "leader",
      () => now,
      () => [item("acme/api", 1)],
    )
    const follower = location(
      storage,
      "follower",
      () => now,
      () => [item("acme/api", 1)],
    )
    await leader.poller.start()
    await follower.poller.start()

    await follower.poller.refresh()
    now += options.intervalMs
    await leader.poller.poll()
    await follower.poller.poll()

    expect(follower.fetchQueue).toHaveBeenCalledTimes(2)
    expect(leader.fetchQueue).toHaveBeenCalledTimes(1)
    expect(follower.of("discovered")).toEqual([])
    leader.poller.stop()
    follower.poller.stop()
  })
})
