import { Plugin } from "@opencode/plugin"
import { type PluginOptions, parseOptions } from "../shared/options.js"
import { ReviewQueue } from "../shared/rpc.js"
import { openReview, repositoryForDirectory } from "./github/repository.js"
import { fetchReviewRequests } from "./github/review-requests.js"
import { defaultCacheDirectory, expandHome } from "./review/checkout.js"
import { DraftStore } from "./review/draft-store.js"
import { rememberModel, reviewModels } from "./review/models.js"
import { ReviewService } from "./review/review-service.js"
import { addReviewTools } from "./review/tools.js"
import { type PollerEvent, ReviewQueuePoller } from "./review-queue-poller.js"

// Cloning and fetching a large repository can take far longer than one GitHub API call.
const CHECKOUT_TIMEOUT_MS = 10 * 60_000
const DRAFT_PREFIX = "draft/"

type Shared = {
  poller: ReviewQueuePoller
  drafts: DraftStore
  reviews: ReviewService
  refs: number
  started?: Promise<void>
}

let shared: Shared | undefined

/** Turns a thrown error into the method's `failed` error, so the UI receives its message. */
async function reported<T, E>(
  context: { error(type: "failed", message: string): E },
  run: () => Promise<T>,
): Promise<T | E> {
  try {
    return await run()
  } catch (error) {
    return context.error("failed", error instanceof Error ? error.message : String(error))
  }
}

function createShared(storage: Plugin.Context["storage"], options: PluginOptions): Shared {
  const poller = new ReviewQueuePoller(
    fetchReviewRequests,
    {
      load: () => storage.get("baseline"),
      save: (value) => storage.set("baseline", value),
    },
    options,
  )
  const drafts = new DraftStore({
    get: (key) => storage.get(`${DRAFT_PREFIX}${key}`),
    list: async () => (await storage.scan({ prefix: DRAFT_PREFIX })).entries.map((entry) => entry.value),
    save: (draft) => storage.set(`${DRAFT_PREFIX}${draft.key}`, draft),
    remove: (key) => storage.remove(`${DRAFT_PREFIX}${key}`),
  })
  const reviews = new ReviewService(drafts, {
    cacheDirectory: options.cacheDirectory ? expandHome(options.cacheDirectory) : defaultCacheDirectory(),
    guidelinesFile: options.reviewGuidelines && expandHome(options.reviewGuidelines),
    timeoutMs: options.timeoutMs,
  })
  return { poller, drafts, reviews, refs: 0 }
}

export default Plugin.define({
  id: "github-review-queue",
  async setup(ctx) {
    const options = parseOptions(ctx.options)
    shared ??= createShared(ctx.storage, options)
    const current = shared
    current.refs += 1
    const timeout = (signal: AbortSignal, ms = options.timeoutMs) => AbortSignal.any([signal, AbortSignal.timeout(ms)])
    const queued = (key: string) => {
      const item = current.poller.snapshot().items.find((candidate) => candidate.key === key)
      if (!item) {
        throw new Error("That review request is no longer in the queue. Refresh and try again.")
      }
      return item
    }

    const registration = await ctx.rpc.register(ReviewQueue, {
      snapshot: async () => current.poller.snapshot(),
      refresh: () => current.poller.refresh(),
      repository: async (input, rpcContext) => ({
        repository: (await repositoryForDirectory(input.directory, timeout(rpcContext.signal))) ?? null,
      }),
      open: (input, rpcContext) =>
        reported(rpcContext, async () => {
          await openReview(queued(input.key), timeout(rpcContext.signal))
          return { opened: true }
        }),
      drafts: async () => ({ drafts: await current.drafts.list() }),
      models: () => reviewModels(ctx),
      startReview: (input, rpcContext) =>
        reported(rpcContext, async () => {
          const result = await current.reviews.start({
            item: queued(input.key),
            directory: input.directory,
            clone: input.clone,
            model: input.model,
            sessions: ctx.session,
            signal: timeout(rpcContext.signal, CHECKOUT_TIMEOUT_MS),
          })
          if (result.status === "started" && input.model) {
            await rememberModel(ctx.storage, input.model)
          }
          return result
        }),
      resetReview: (input, rpcContext) =>
        reported(rpcContext, async () => {
          await current.reviews.reset(input.key, timeout(rpcContext.signal))
          return {}
        }),
      postReview: (input, rpcContext) =>
        reported(rpcContext, () => current.reviews.post(input.key, input.allowStale, timeout(rpcContext.signal))),
    })
    const tools = await ctx.tool.transform((editor) => addReviewTools(editor, current.reviews))

    const emit = (event: PollerEvent) => {
      if (event.type === "state") {
        void registration.events.emit("state", event.state)
        return
      }
      void registration.events.emit("discovered", event)
    }
    const unsubscribe = current.poller.on(emit)
    const unsubscribeDrafts = current.drafts.on((drafts) => void registration.events.emit("drafts", { drafts }))
    current.started ??= current.poller.start()
    await current.started

    return async () => {
      unsubscribe()
      unsubscribeDrafts()
      await tools.dispose()
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
