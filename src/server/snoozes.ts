import type { ReviewRequest } from "../domain/review-request.js"
import { isRepositorySnooze, type Snooze, snoozing } from "../domain/snooze.js"
import type { KeyedStore } from "./keyed-store.js"

function expired(snooze: Snooze, items: ReadonlyMap<string, ReviewRequest>, now: number): boolean {
  if (isRepositorySnooze(snooze)) {
    return snooze.until.kind !== "time" || Date.parse(snooze.until.at) <= now
  }
  const item = items.get(snooze.key)
  return !item || !snoozing(snooze, item, now)
}

export async function pruneSnoozes(store: KeyedStore<Snooze>, queue: readonly ReviewRequest[], now: number) {
  const items = new Map(queue.map((item) => [item.key, item]))
  for (const snooze of await store.list()) {
    if (expired(snooze, items, now)) {
      await store.remove(snooze.key)
    }
  }
}
