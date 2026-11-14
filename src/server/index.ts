import { Plugin } from "@opencode/plugin"
import type { PersistedQueue } from "../domain/review-queue.js"
import { parseOptions } from "../shared/options.js"
import { ReviewQueue } from "../shared/rpc.js"
import { openReview, repositoryForDirectory } from "./github/repository.js"
import { fetchReviewRequests } from "./github/review-requests.js"
import { type PollerEvent, ReviewQueuePoller } from "./review-queue-poller.js"

let shared: { poller: ReviewQueuePoller; refs: number; started?: Promise<void> } | undefined

export default Plugin.define({
  id: "github-review-queue",
  async setup(ctx) {
    const options = parseOptions(ctx.options)
    if (!shared) {
      const poller = new ReviewQueuePoller(
        fetchReviewRequests,
        {
          load: async () => (await ctx.storage.get("baseline")) as PersistedQueue | undefined,
          save: (value) => ctx.storage.set("baseline", value),
        },
        options,
      )
      shared = { poller, refs: 0 }
    }
    const current = shared
    current.refs += 1

    const registration = await ctx.rpc.register(ReviewQueue, {
      snapshot: async () => current.poller.snapshot(),
      refresh: () => current.poller.refresh(),
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
        void registration.events.emit("state", event.state)
      } else {
        void registration.events.emit("discovered", event)
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
