import type { PersistedQueue, QueueError, QueueSnapshot, ReviewRequest } from "../domain/review-queue.js"
import { compareQueues, emptySnapshot } from "../domain/review-queue.js"

export interface QueuePersistence {
  load(): Promise<PersistedQueue | undefined>
  save(value: PersistedQueue): Promise<void>
}
export interface PollerOptions {
  intervalMs: number
  timeoutMs: number
  maxBackoffMs: number
}
export interface FetchResult {
  items: ReviewRequest[]
  retryAt?: string
}
export type FetchQueue = (signal: AbortSignal) => Promise<FetchResult>
export type PollerEvent =
  | { type: "state"; state: QueueSnapshot }
  | { type: "discovered"; item: ReviewRequest; eventID: string }

const persistedIsValid = (value: PersistedQueue | undefined): value is PersistedQueue =>
  value?.version === 1 && typeof value.initialized === "boolean" && Array.isArray(value.items)

export class ReviewQueuePoller {
  private state: QueueSnapshot = emptySnapshot()
  private listeners = new Set<(event: PollerEvent) => void>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private active: Promise<QueueSnapshot> | undefined
  private controller: AbortController | undefined
  private stopped = false
  private failures = 0

  constructor(
    private readonly fetchQueue: FetchQueue,
    private readonly persistence: QueuePersistence,
    private readonly options: PollerOptions,
    private readonly now: () => number = Date.now,
  ) {}

  snapshot(): QueueSnapshot {
    return structuredClone(this.state)
  }
  on(listener: (event: PollerEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async start(): Promise<void> {
    const saved = await this.persistence.load()
    if (persistedIsValid(saved)) {
      this.state = {
        items: saved.items,
        newKeys: [],
        initialized: saved.initialized,
        loading: true,
        stale: false,
        ...(saved.lastSuccessAt ? { lastSuccessAt: saved.lastSuccessAt } : {}),
      }
    }
    this.emit({ type: "state", state: this.snapshot() })
    await this.refresh()
  }

  refresh(): Promise<QueueSnapshot> {
    if (this.active) {
      return this.active
    }
    this.clearTimer()
    this.active = this.performRefresh().finally(() => {
      this.active = undefined
    })
    return this.active
  }

  stop(): void {
    this.stopped = true
    this.clearTimer()
    this.controller?.abort()
  }

  private async performRefresh(): Promise<QueueSnapshot> {
    this.state = { ...this.state, loading: true }
    this.emit({ type: "state", state: this.snapshot() })
    this.controller = new AbortController()
    const timeout = setTimeout(() => this.controller?.abort(), this.options.timeoutMs)
    try {
      const result = await this.fetchQueue(this.controller.signal)
      const firstSuccess = !this.state.initialized
      const { added } = compareQueues(this.state.items, result.items)
      const timestamp = new Date(this.now()).toISOString()
      const nextState: QueueSnapshot = {
        items: result.items,
        newKeys: firstSuccess ? [] : added.map((item) => item.key),
        initialized: true,
        loading: false,
        stale: false,
        lastSuccessAt: timestamp,
      }
      await this.persistence.save({ version: 1, initialized: true, items: result.items, lastSuccessAt: timestamp })
      this.failures = 0
      this.state = nextState
      this.emit({ type: "state", state: this.snapshot() })
      if (!firstSuccess) {
        for (const item of added) {
          this.emit({ type: "discovered", item, eventID: `${item.key}:${timestamp}` })
        }
      }
      this.schedule(Math.max(this.options.intervalMs, this.delayFromRetryAt(result.retryAt) ?? 0))
    } catch (error) {
      if (this.stopped) {
        return this.snapshot()
      }
      const detail = this.errorDetail(error, this.controller.signal.aborted)
      this.failures += 1
      this.state = { ...this.state, loading: false, stale: this.state.initialized, error: detail }
      this.emit({ type: "state", state: this.snapshot() })
      const exponential = Math.min(this.options.maxBackoffMs, this.options.intervalMs * 2 ** Math.min(this.failures, 6))
      this.schedule(Math.max(exponential, this.delayFromRetryAt(detail.retryAt) ?? 0))
    } finally {
      clearTimeout(timeout)
      this.controller = undefined
    }
    return this.snapshot()
  }

  private errorDetail(error: unknown, timedOut: boolean): QueueError {
    if (timedOut) {
      return {
        kind: "offline",
        message: `GitHub refresh timed out after ${Math.round(this.options.timeoutMs / 1_000)} seconds. The saved queue was left unchanged.`,
      }
    }
    if (typeof error === "object" && error !== null && "detail" in error) {
      return (error as { detail: QueueError }).detail
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
  private schedule(delay: number): void {
    if (!this.stopped) {
      this.timer = setTimeout(() => void this.refresh(), delay)
    }
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
