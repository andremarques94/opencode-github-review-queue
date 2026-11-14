import { Plugin } from "@opencode/plugin"
import type { PersistedQueue } from "../domain/review-queue.js"
import { ReviewQueue } from "../rpc/review-queue.js"
import { parseOptions } from "../shared/options.js"
import { fetchReviewRequests, openReview, repositoryForDirectory } from "./github.js"
import { type PollerEvent, ReviewQueuePoller } from "./review-queue-poller.js"

let shared: { poller: ReviewQueuePoller; refs: number; started?: Promise<void> } | undefined

function savedQueue(value: unknown): PersistedQueue | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined
  }
  const candidate = value as Partial<PersistedQueue>
  return candidate.version === 1 && typeof candidate.initialized === "boolean" && Array.isArray(candidate.items)
    ? (candidate as PersistedQueue)
    : undefined
}

export default Plugin.define({
  id: "github-review-queue",
  async setup(ctx) {
    const options = parseOptions(ctx.options)
    if (!shared) {
      const poller = new ReviewQueuePoller(
        fetchReviewRequests,
        {
          load: async () => savedQueue(await ctx.storage.get("baseline")),
          save: (value) => ctx.storage.set("baseline", value as any),
        },
        options,
      )
      shared = { poller, refs: 0 }
    }
    const current = shared
    current.refs += 1

    const registration = await ctx.rpc.register(ReviewQueue, {
      snapshot: async () => current.poller.snapshot() as any,
      refresh: async () => (await current.poller.refresh()) as any,
      repository: async (input, rpcContext) => {
        const directory = (input as { directory: string }).directory
        const signal = AbortSignal.any([rpcContext.signal, AbortSignal.timeout(options.timeoutMs)])
        return { repository: (await repositoryForDirectory(directory, signal)) ?? null }
      },
      open: async (input, rpcContext) => {
        const key = (input as { key: string }).key
        const item = current.poller.snapshot().items.find((candidate) => candidate.key === key)
        if (!item) {
          throw new Error("That review request is no longer in the queue. Refresh and try again.")
        }
        const signal = AbortSignal.any([rpcContext.signal, AbortSignal.timeout(options.timeoutMs)])
        await openReview(item, signal)
        return { opened: true }
      },
    })

    const emit = (event: PollerEvent) => {
      if (event.type === "state") {
        void registration.events.emit("state", event.state as any)
      } else {
        void registration.events.emit("discovered", event as any)
      }
    }
    const unsubscribe = current.poller.on(emit)
    current.started ??= current.poller.start()
    await current.started

    return async () => {
      unsubscribe()
      await registration.dispose()
      current.refs -= 1
      if (current.refs === 0) {
        current.poller.stop()
        if (shared === current) {
          shared = undefined
        }
      }
    }
  },
})
