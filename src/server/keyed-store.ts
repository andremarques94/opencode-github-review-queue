import * as v from "valibot"

export type KeyedPersistence<T> = {
  get(key: string): Promise<unknown>
  list(): Promise<unknown[]>
  save(key: string, value: T): Promise<void>
  remove(key: string): Promise<void>
}

/** Entries kept in plugin storage under one prefix. Never cached, for the same reason as drafts. */
export class KeyedStore<T extends { key: string }> {
  constructor(
    private readonly schema: v.GenericSchema<unknown, T>,
    private readonly persistence: KeyedPersistence<T>,
  ) {}

  async get(key: string): Promise<T | undefined> {
    return this.parse(await this.persistence.get(key))
  }

  async list(): Promise<T[]> {
    return (await this.persistence.list()).map((value) => this.parse(value)).filter((value) => value !== undefined)
  }

  async put(value: T): Promise<T> {
    const saved = v.parse(this.schema, value)
    await this.persistence.save(saved.key, saved)
    return saved
  }

  remove(key: string): Promise<void> {
    return this.persistence.remove(key)
  }

  private parse(value: unknown): T | undefined {
    const parsed = v.safeParse(this.schema, value)
    return parsed.success ? parsed.output : undefined
  }
}
