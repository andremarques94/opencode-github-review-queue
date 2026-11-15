import * as v from "valibot"
import { type MyNotice, myNotices } from "../domain/my-pull-request.js"
import {
  compareQueues,
  emptySnapshot,
  PersistedQueue,
  type QueueError,
  type QueueSnapshot,
} from "../domain/review-queue.js"
import type { ReviewRequest } from "../domain/review-request.js"
import { GhError } from "./github/cli.js"
import { type Lease, SOLE_LEASE } from "./queue-lease.js"

export type QueuePersistence = {
  load(): Promise<unknown>
  save(value: PersistedQueue): Promise<void>
}
export type PollerOptions = {
  intervalMs: number
  timeoutMs: number
  maxBackoffMs: number
  renotifyAfterMs?: number
}

const DEFAULT_RENOTIFY_AFTER_MS = 60 * 60_000
export type FetchResult = {
  items: ReviewRequest[]
  authored?: ReviewRequest[]
  retryAt?: string
}
export type FetchQueue = (signal: AbortSignal) => Promise<FetchResult>
export type PollerEvent =
  | { type: "state"; state: QueueSnapshot }
  | { type: "discovered"; item: ReviewRequest; eventID: string }
  | { type: "notice"; notice: MyNotice; item: ReviewRequest; eventID: string }
  /** Only on the instance that fetched the queue from GitHub. */
  | { type: "fetched"; state: QueueSnapshot }

/**
 * Every OpenCode location runs its own instance. The one holding the lease polls GitHub and persists the queue; the
 * others follow the persisted queue, and take the lease over once it lapses.
 */
export class ReviewQueuePoller {
  private state: QueueSnapshot = emptySnapshot()
  private listeners = new Set<(event: PollerEvent) => void>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private active: Promise<QueueSnapshot> | undefined
  private controller: AbortController | undefined
  private stopped = false
  private leading = false
  private nextFetchAt = 0
  private failures = 0
  private seen = new Map<string, number>()
  /** The last successful poll's notices, kept when a failure re-saves the queue, as `newKeys` are. */
  private notices: MyNotice[] = []

  constructor(
    private readonly fetchQueue: FetchQueue,
    private readonly persistence: QueuePersistence,
    private readonly options: PollerOptions,
    private readonly now: () => number = Date.now,
    private readonly lease: Lease = SOLE_LEASE,
  ) {}

  snapshot(): QueueSnapshot {
    return structuredClone(this.state)
  }
  /**
   * The queue as last saved by whichever instance polls. A UI may show a queue this instance has not re-read yet, so
   * actions on a pull request look it up here rather than in `snapshot`.
   */
  async latest(): Promise<QueueSnapshot> {
    if (!this.leading) {
      await this.follow()
    }
    return this.snapshot()
  }
  on(listener: (event: PollerEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async start(): Promise<void> {
    const saved = await this.load()
    if (saved) {
      this.adopt(saved, [])
      this.state = { ...this.state, loading: true }
    }
    this.emit({ type: "state", state: this.snapshot() })
    await this.poll()
  }

  async poll(): Promise<void> {
    if (this.stopped) {
      return
    }
    this.clearTimer()
    try {
      if (await this.lease.acquire().catch(() => false)) {
        await this.lead()
        if (this.now() >= this.nextFetchAt) {
          await this.run(() => this.performRefresh())
        }
        return
      }
      this.leading = false
      await this.follow()
    } finally {
      this.scheduleNext()
    }
  }

  /** Fetches now from any instance, taking the lease over so the queue keeps a single poller. */
  refresh(): Promise<QueueSnapshot> {
    return this.run(async () => {
      await this.lease.claim().catch(() => undefined)
      await this.lead()
      return this.performRefresh()
    })
  }

  stop(): void {
    this.stopped = true
    this.clearTimer()
    this.controller?.abort()
    if (this.leading) {
      void this.lease.release().catch(() => undefined)
    }
  }

  private run(task: () => Promise<QueueSnapshot>): Promise<QueueSnapshot> {
    this.active ??= task().finally(() => {
      this.active = undefined
    })
    return this.active
  }

  /** A new holder starts from the queue its predecessor saved, so it only announces what is actually new. */
  private async lead(): Promise<void> {
    if (this.leading) {
      return
    }
    this.leading = true
    const saved = await this.load()
    if (saved && saved.lastSuccessAt !== this.state.lastSuccessAt) {
      this.adopt(saved, this.state.newKeys)
    }
  }

  private async follow(): Promise<void> {
    const saved = await this.load()
    if (!saved) {
      return
    }
    const fresh = saved.lastSuccessAt !== this.state.lastSuccessAt
    if (!fresh && saved.error?.message === this.state.error?.message && !this.state.loading) {
      return
    }
    const announce = fresh && this.state.initialized
    this.adopt(saved, announce ? (saved.newKeys ?? []) : this.state.newKeys)
    this.emit({ type: "state", state: this.snapshot() })
    if (!announce) {
      return
    }
    for (const item of this.state.items.filter((candidate) => this.state.newKeys.includes(candidate.key))) {
      this.emit({ type: "discovered", item, eventID: `${item.key}:${saved.lastSuccessAt}` })
    }
    this.announce(saved.notices, saved.lastSuccessAt)
  }

  private announce(notices: readonly MyNotice[] = [], timestamp = ""): void {
    for (const notice of notices) {
      const item = this.state.authored?.find((candidate) => candidate.key === notice.key)
      if (item) {
        this.emit({ type: "notice", notice, item, eventID: `${notice.key}:${notice.kind}:${timestamp}` })
      }
    }
  }

  private async load(): Promise<PersistedQueue | undefined> {
    const loaded = v.safeParse(PersistedQueue, await this.persistence.load().catch(() => undefined))
    return loaded.success ? loaded.output : undefined
  }

  private adopt(saved: PersistedQueue, newKeys: string[]): void {
    this.state = {
      items: saved.items,
      newKeys,
      ...(saved.authored ? { authored: saved.authored } : {}),
      initialized: saved.initialized,
      loading: false,
      stale: saved.initialized && saved.error !== undefined,
      ...(saved.lastSuccessAt ? { lastSuccessAt: saved.lastSuccessAt } : {}),
      ...(saved.error ? { error: saved.error } : {}),
    }
    const fallback = saved.lastSuccessAt ? Date.parse(saved.lastSuccessAt) : this.now()
    this.seen = new Map(saved.items.map((item) => [item.key, fallback]))
    for (const [key, at] of Object.entries(saved.seen ?? {})) {
      const time = Date.parse(at)
      if (Number.isFinite(time)) {
        this.seen.set(key, time)
      }
    }
  }

  private async performRefresh(): Promise<QueueSnapshot> {
    this.state = { ...this.state, loading: true }
    this.emit({ type: "state", state: this.snapshot() })
    this.controller = new AbortController()
    const timeout = setTimeout(() => this.controller?.abort(), this.options.timeoutMs)
    try {
      const result = await this.fetchQueue(this.controller.signal)
      const firstSuccess = !this.state.initialized
      const now = this.now()
      const timestamp = new Date(now).toISOString()
      const added = firstSuccess ? [] : this.newlyQueued(compareQueues(this.state.items, result.items).added, now)
      const seen = this.recordSeen(result.items, now)
      const newKeys = added.map((item) => item.key)
      const { authored, notices } = this.authoredUpdate(result.authored)
      const nextState: QueueSnapshot = {
        items: result.items,
        newKeys,
        ...authored,
        initialized: true,
        loading: false,
        stale: false,
        lastSuccessAt: timestamp,
      }
      await this.persistence.save({
        version: 1,
        initialized: true,
        items: result.items,
        ...authored,
        lastSuccessAt: timestamp,
        seen,
        newKeys,
        ...this.persistedNotices(notices),
      })
      this.notices = notices
      this.failures = 0
      this.state = nextState
      this.emit({ type: "state", state: this.snapshot() })
      this.emit({ type: "fetched", state: this.snapshot() })
      for (const item of added) {
        this.emit({ type: "discovered", item, eventID: `${item.key}:${timestamp}` })
      }
      this.announce(notices, timestamp)
      this.nextFetchAt = now + Math.max(this.options.intervalMs, this.delayFromRetryAt(result.retryAt) ?? 0)
    } catch (error) {
      if (this.stopped) {
        return this.snapshot()
      }
      const detail = this.errorDetail(error, this.controller.signal.aborted)
      this.failures += 1
      this.state = { ...this.state, loading: false, stale: this.state.initialized, error: detail }
      await this.persistence.save(this.persisted(detail)).catch(() => undefined)
      this.emit({ type: "state", state: this.snapshot() })
      const exponential = Math.min(this.options.maxBackoffMs, this.options.intervalMs * 2 ** Math.min(this.failures, 6))
      this.nextFetchAt = this.now() + Math.max(exponential, this.delayFromRetryAt(detail.retryAt) ?? 0)
    } finally {
      clearTimeout(timeout)
      this.controller = undefined
    }
    this.scheduleNext()
    return this.snapshot()
  }

  /** The last successful queue, unchanged, with the failure that followers should show. */
  private persisted(error: QueueError): PersistedQueue {
    const seen = Object.fromEntries([...this.seen].map(([key, at]) => [key, new Date(at).toISOString()]))
    return {
      version: 1,
      initialized: this.state.initialized,
      items: this.state.items,
      ...(this.state.authored ? { authored: this.state.authored } : {}),
      ...(this.state.lastSuccessAt ? { lastSuccessAt: this.state.lastSuccessAt } : {}),
      seen,
      newKeys: this.state.newKeys,
      ...this.persistedNotices(this.notices),
      error,
    }
  }

  private authoredUpdate(next: ReviewRequest[] | undefined) {
    if (!next) {
      return { authored: {}, notices: [] }
    }
    return { authored: { authored: next }, notices: myNotices(this.state.authored ?? [], next) }
  }

  private persistedNotices(notices: MyNotice[]) {
    return notices.length > 0 ? { notices } : {}
  }

  private get renotifyAfterMs(): number {
    return this.options.renotifyAfterMs ?? DEFAULT_RENOTIFY_AFTER_MS
  }

  private newlyQueued(candidates: readonly ReviewRequest[], now: number): ReviewRequest[] {
    return candidates.filter((item) => {
      const last = this.seen.get(item.key)
      return last === undefined || now - last > this.renotifyAfterMs
    })
  }

  private recordSeen(items: readonly ReviewRequest[], now: number): Record<string, string> {
    for (const item of items) {
      this.seen.set(item.key, now)
    }
    const persisted: Record<string, string> = {}
    for (const [key, at] of this.seen) {
      if (now - at > this.renotifyAfterMs) {
        this.seen.delete(key)
        continue
      }
      persisted[key] = new Date(at).toISOString()
    }
    return persisted
  }

  private errorDetail(error: unknown, timedOut: boolean): QueueError {
    if (timedOut) {
      return {
        kind: "offline",
        message: `GitHub refresh timed out after ${Math.round(this.options.timeoutMs / 1_000)} seconds. The saved queue was left unchanged.`,
      }
    }
    if (error instanceof GhError) {
      return error.detail
    }
    return {
      kind: "unknown",
      message: error instanceof Error ? error.message : "GitHub refresh failed. The saved queue was left unchanged.",
    }
  }
  private delayFromRetryAt(retryAt: string | undefined): number | undefined {
    if (!retryAt) {
      return undefined
    }
    const delay = Date.parse(retryAt) - this.now()
    return Number.isFinite(delay) ? Math.max(0, delay) : undefined
  }
  /** Ticks at least every interval, so the holder renews its lease even while backing off. */
  private scheduleNext(): void {
    this.clearTimer()
    if (this.stopped) {
      return
    }
    const due = this.leading ? Math.max(0, this.nextFetchAt - this.now()) : this.options.intervalMs
    this.timer = setTimeout(() => void this.poll(), Math.min(this.options.intervalMs, due))
  }
  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer)
    }
    this.timer = undefined
  }
  private emit(event: PollerEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }
}
