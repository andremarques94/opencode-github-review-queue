import { Plugin } from "@opencode/plugin"
import { ReviewedRecord } from "../domain/review-history.js"
import { everyPullRequest } from "../domain/review-queue.js"
import { Snooze } from "../domain/snooze.js"
import { type PluginOptions, parseOptions } from "../shared/options.js"
import { type LocalReviews, ReviewQueue } from "../shared/rpc.js"
import { openReview, repositoryForDirectory } from "./github/repository.js"
import { type KeyedPersistence, KeyedStore } from "./keyed-store.js"
import { StorageLease } from "./queue-lease.js"
import { queueSource } from "./queue-source.js"
import { nextStep } from "./review/agent/instructions.js"
import { addReviewTools, hideReviewTools } from "./review/agent/tools.js"
import { defaultCacheDirectory, expandHome } from "./review/checkout.js"
import { DraftStore } from "./review/draft-store.js"
import { Findings } from "./review/findings.js"
import { rememberModel, reviewModels } from "./review/models.js"
import { ReviewSessions } from "./review/sessions.js"
import { summarize } from "./review/summary.js"
import { triage } from "./review/triage.js"
import { type PollerEvent, ReviewQueuePoller } from "./review-queue-poller.js"
import { pruneSnoozes } from "./snoozes.js"

// Cloning and fetching a large repository can take far longer than one GitHub API call.
const CHECKOUT_TIMEOUT_MS = 10 * 60_000
const SUMMARY_TIMEOUT_MS = 5 * 60_000
const DRAFT_PREFIX = "draft/"
const REVIEWED_PREFIX = "reviewed/"
const SNOOZE_PREFIX = "snooze/"
// Missing a few renewals, such as while the machine sleeps, should not hand the lease over.
const LEASE_INTERVALS = 3

type Shared = {
  poller: ReviewQueuePoller
  drafts: DraftStore
  reviewed: KeyedStore<ReviewedRecord>
  snoozes: KeyedStore<Snooze>
  reviews: ReviewSessions
  findings: Findings
  refs: number
  started?: Promise<void>
}

let shared: Shared | undefined

type Json = Parameters<Plugin.Context["storage"]["set"]>[1]

function prefixed<T extends Json>(storage: Plugin.Context["storage"], prefix: string): KeyedPersistence<T> {
  return {
    get: (key) => storage.get(`${prefix}${key}`),
    list: async () => (await storage.scan({ prefix })).entries.map((entry) => entry.value),
    save: (key, value) => storage.set(`${prefix}${key}`, value),
    remove: (key) => storage.remove(`${prefix}${key}`),
  }
}

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

async function localReviews(current: Shared): Promise<LocalReviews> {
  const [drafts, reviewed, snoozes] = await Promise.all([
    current.drafts.list(),
    current.reviewed.list(),
    current.snoozes.list(),
  ])
  return { drafts, reviewed, snoozes }
}

function createShared(storage: Plugin.Context["storage"], options: PluginOptions): Shared {
  const lease = new StorageLease(
    {
      load: () => storage.get("lease"),
      save: (value) => storage.set("lease", value),
      remove: () => storage.remove("lease"),
    },
    LEASE_INTERVALS * options.intervalMs + options.timeoutMs,
  )
  const reviewed = new KeyedStore(ReviewedRecord, prefixed(storage, REVIEWED_PREFIX))
  const poller = new ReviewQueuePoller(
    queueSource(options, reviewed),
    {
      load: () => storage.get("baseline"),
      save: (value) => storage.set("baseline", value),
    },
    options,
    Date.now,
    lease,
  )
  const drafts = new DraftStore({
    get: (key) => storage.get(`${DRAFT_PREFIX}${key}`),
    list: async () => (await storage.scan({ prefix: DRAFT_PREFIX })).entries.map((entry) => entry.value),
    save: (draft) => storage.set(`${DRAFT_PREFIX}${draft.key}`, draft),
    remove: (key) => storage.remove(`${DRAFT_PREFIX}${key}`),
  })
  const snoozes = new KeyedStore(Snooze, prefixed(storage, SNOOZE_PREFIX))
  const reviews = new ReviewSessions(drafts, reviewed, {
    cacheDirectory: options.cacheDirectory ? expandHome(options.cacheDirectory) : defaultCacheDirectory(),
    guidelinesFile: options.reviewGuidelines && expandHome(options.reviewGuidelines),
    keepClones: options.keepClones,
    timeoutMs: options.timeoutMs,
  })
  poller.on((event) => {
    if (event.type === "fetched") {
      void reviews.pruneAfterRefresh(event.state, AbortSignal.timeout(options.timeoutMs))
      void pruneSnoozes(snoozes, everyPullRequest(event.state), Date.now()).catch(() => undefined)
    }
  })
  return { poller, drafts, reviewed, snoozes, reviews, findings: new Findings(drafts, options.timeoutMs), refs: 0 }
}

export default Plugin.define({
  id: "github-review-queue",
  async setup(ctx) {
    const options = parseOptions(ctx.options)
    shared ??= createShared(ctx.storage, options)
    const current = shared
    current.refs += 1
    const timeout = (signal: AbortSignal, ms = options.timeoutMs) => AbortSignal.any([signal, AbortSignal.timeout(ms)])
    const queued = async (key: string) => {
      const item = everyPullRequest(await current.poller.latest()).find((candidate) => candidate.key === key)
      if (!item) {
        throw new Error("That pull request is no longer in the queue. Refresh and try again.")
      }
      return item
    }
    const panel = triage(current.findings, (input) => ctx.session.prompt(input))

    const registration = await ctx.rpc.register(ReviewQueue, {
      snapshot: async () => current.poller.snapshot(),
      refresh: () => current.poller.refresh(),
      repository: async (input, rpcContext) => ({
        repository: (await repositoryForDirectory(input.directory, timeout(rpcContext.signal))) ?? null,
      }),
      open: (input, rpcContext) =>
        reported(rpcContext, async () => {
          await openReview(await queued(input.key), timeout(rpcContext.signal))
          return { opened: true }
        }),
      drafts: () => localReviews(current),
      models: () => reviewModels(ctx),
      startReview: (input, rpcContext) =>
        reported(rpcContext, async () => {
          const result = await current.reviews.start({
            item: await queued(input.key),
            directory: input.directory,
            clone: input.clone,
            mode: input.mode,
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
      decideFinding: (input, rpcContext) => reported(rpcContext, () => panel.decide(input)),
      editFinding: (input, rpcContext) => reported(rpcContext, () => panel.edit(input)),
      askAboutFinding: (input, rpcContext) => reported(rpcContext, () => panel.ask(input)),
      addLineComments: (input, rpcContext) => reported(rpcContext, () => panel.addLineComments(input)),
      summarize: (input, rpcContext) =>
        reported(rpcContext, async () => {
          // Always the model the user picked: without one, the server falls back to a default they never chose.
          const generate = async (prompt: string, signal: AbortSignal) =>
            (await ctx.experimental.generate.text({ prompt, model: input.model }, { signal })).text
          return summarize(await queued(input.key), generate, timeout(rpcContext.signal, SUMMARY_TIMEOUT_MS))
        }),
      snooze: (input, rpcContext) =>
        reported(rpcContext, async () => {
          const item = await queued(input.key)
          await current.snoozes.put({
            version: 1,
            key: item.key,
            until: input.until,
            createdAt: new Date().toISOString(),
          })
          return localReviews(current)
        }),
      wake: (input, rpcContext) =>
        reported(rpcContext, async () => {
          await current.snoozes.remove(input.key)
          return localReviews(current)
        }),
    })
    const tools = await ctx.tool.transform((editor) => addReviewTools(editor, current.findings))
    const reminder = await ctx.session.hook("context", async (event) => {
      const draft = await current.drafts.bySession(event.sessionID)
      if (!draft) {
        hideReviewTools(event.tools)
        return
      }
      const step = nextStep(draft)
      if (step) {
        event.system.push({ type: "text", text: step })
      }
    })

    const emit = (event: PollerEvent) => {
      switch (event.type) {
        case "state":
          void registration.events.emit("state", event.state)
          return
        case "discovered":
          void registration.events.emit("discovered", { item: event.item, eventID: event.eventID })
          return
        case "notice":
          void registration.events.emit("notice", { notice: event.notice, item: event.item, eventID: event.eventID })
          return
      }
    }
    const unsubscribe = current.poller.on(emit)
    const unsubscribeDrafts = current.drafts.on(
      () => void localReviews(current).then((local) => registration.events.emit("drafts", local)),
    )
    current.started ??= current.poller.start()
    await current.started

    return async () => {
      unsubscribe()
      unsubscribeDrafts()
      await tools.dispose()
      await reminder.dispose()
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
