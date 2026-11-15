import type { ReviewRequest } from "../domain/review-request.js"
import { type Snooze, snoozing } from "../domain/snooze.js"
import type { KeyedStore } from "./keyed-store.js"

export async function pruneSnoozes(store: KeyedStore<Snooze>, queue: readonly ReviewRequest[], now: number) {
  const items = new Map(queue.map((item) => [item.key, item]))
  for (const snooze of await store.list()) {
    const item = items.get(snooze.key)
    if (!item || !snoozing(snooze, item, now)) {
      await store.remove(snooze.key)
    }
  }
}
