import * as v from "valibot"
import { ReviewDraft } from "../../domain/review-draft.js"

export type DraftPersistence = {
  get(key: string): Promise<unknown>
  list(): Promise<unknown[]>
  save(draft: ReviewDraft): Promise<void>
  remove(key: string): Promise<void>
}

const parse = (value: unknown) => {
  const parsed = v.safeParse(ReviewDraft, value)
  return parsed.success ? parsed.output : undefined
}

/** Never cached: each OpenCode location runs its own plugin instance, and storage is the only state they share. */
export class DraftStore {
  private listeners = new Set<(drafts: ReviewDraft[]) => void>()
  /** Serialized so concurrent tool calls never overwrite each other's changes. */
  private writes: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly persistence: DraftPersistence,
    private readonly now: () => number = Date.now,
  ) {}

  async list(): Promise<ReviewDraft[]> {
    return (await this.persistence.list()).map(parse).filter((draft) => draft !== undefined)
  }

  async get(key: string): Promise<ReviewDraft | undefined> {
    return parse(await this.persistence.get(key))
  }

  async bySession(sessionID: string): Promise<ReviewDraft | undefined> {
    return (await this.list()).find((draft) => draft.sessionID === sessionID)
  }

  put(draft: ReviewDraft): Promise<ReviewDraft> {
    return this.serialize(() => this.save(draft))
  }

  update(key: string, change: (draft: ReviewDraft) => void): Promise<ReviewDraft> {
    return this.serialize(async () => {
      const draft = await this.get(key)
      if (!draft) {
        throw new Error("This review draft no longer exists.")
      }
      change(draft)
      return this.save(draft)
    })
  }

  remove(key: string): Promise<void> {
    return this.serialize(async () => {
      await this.persistence.remove(key)
      await this.emit()
    })
  }

  on(listener: (drafts: ReviewDraft[]) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private serialize<T>(write: () => Promise<T>): Promise<T> {
    const next = this.writes.then(write)
    this.writes = next.catch(() => undefined)
    return next
  }

  private async save(draft: ReviewDraft): Promise<ReviewDraft> {
    const saved = v.parse(ReviewDraft, { ...draft, updatedAt: new Date(this.now()).toISOString() })
    await this.persistence.save(saved)
    await this.emit()
    return saved
  }

  private async emit(): Promise<void> {
    if (this.listeners.size === 0) {
      return
    }
    const drafts = await this.list()
    for (const listener of this.listeners) {
      listener(drafts)
    }
  }
}
