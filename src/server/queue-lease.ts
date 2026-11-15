import { randomUUID } from "node:crypto"
import * as v from "valibot"

export type Lease = {
  acquire(): Promise<boolean>
  /** Takes the lease even from a live holder, which yields on its next poll. */
  claim(): Promise<void>
  release(): Promise<void>
}

export type LeasePersistence = {
  load(): Promise<unknown>
  save(value: LeaseRecord): Promise<void>
  remove(): Promise<void>
}

const LeaseRecord = v.object({ owner: v.string(), expiresAt: v.number() })
export type LeaseRecord = v.InferOutput<typeof LeaseRecord>

/** For a lone instance, such as in tests: it always polls. */
export const SOLE_LEASE: Lease = {
  acquire: async () => true,
  claim: async () => {},
  release: async () => {},
}

/** Decides which of the plugin instances, one per OpenCode location, polls GitHub. */
export class StorageLease implements Lease {
  constructor(
    private readonly persistence: LeasePersistence,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
    readonly owner: string = randomUUID(),
  ) {}

  async acquire(): Promise<boolean> {
    const current = await this.current()
    if (current && current.owner !== this.owner && current.expiresAt > this.now()) {
      return false
    }
    await this.claim()
    // Storage has no compare-and-set: of two instances that both saw a lapsed lease, the later write wins, and the
    // other sees it here. If both read before either wrote, both poll once and the loser yields on its next poll.
    return (await this.current())?.owner === this.owner
  }

  claim(): Promise<void> {
    return this.persistence.save({ owner: this.owner, expiresAt: this.now() + this.ttlMs })
  }

  async release(): Promise<void> {
    if ((await this.current())?.owner === this.owner) {
      await this.persistence.remove()
    }
  }

  private async current(): Promise<LeaseRecord | undefined> {
    const parsed = v.safeParse(LeaseRecord, await this.persistence.load())
    return parsed.success ? parsed.output : undefined
  }
}
