import type { Context } from "@opencode/plugin/gui"
import type { ReviewDraft } from "../../../domain/review-draft.js"
import type { ReviewedRecord } from "../../../domain/review-history.js"
import type { ReviewRequest } from "../../../domain/review-request.js"
import { fullReference } from "../../../shared/presentation.js"
import { postReviewFlow, resetReviewFlow, startReviewFlow } from "../../../shared/review/flows.js"
import { snoozeFlow } from "../../../shared/review/snooze.js"
import { summaryFlow } from "../../../shared/review/summary.js"
import { errorMessage, type LocalReviews, ReviewQueue } from "../../../shared/rpc.js"
import { createFlowHost } from "./flow-host.js"

export type ReviewActions = {
  review(item: ReviewRequest, resuming: boolean, previous: ReviewedRecord | undefined): Promise<void>
  post(draft: ReviewDraft): Promise<void>
  reset(draft: ReviewDraft): Promise<void>
  snooze(item: ReviewRequest): Promise<void>
  wake(item: ReviewRequest): Promise<void>
  summarize(item: ReviewRequest): Promise<void>
}

export function attempting(context: Context) {
  return async (run: () => Promise<void>, fallback: string) => {
    try {
      await run()
    } catch (error) {
      const message = errorMessage(error)
      context.toast.show({
        variant: "error",
        title: fallback,
        ...(message ? { description: message } : {}),
      })
    }
  }
}

export function createReviewActions(input: {
  context: Context
  server: () => string
  directory: () => string | undefined
  updateLocal(local: LocalReviews): void
}): ReviewActions {
  const { context } = input
  const host = createFlowHost(context)
  const attempt = attempting(context)

  return {
    review: (item, resuming, previous) =>
      attempt(async () => {
        const sessionID = await startReviewFlow(host, item, input.directory(), resuming, previous)
        if (sessionID) {
          context.tabs.open({ server: input.server(), id: sessionID }, { focus: true })
        }
      }, "Could not start the review"),
    post: (draft) =>
      attempt(async () => {
        const posted = await postReviewFlow(host, draft)
        if (!posted) {
          return
        }
        context.toast.show({
          variant: "success",
          title: "Review posted",
          description: posted.url,
          actions: [{ label: "Open", run: () => context.system.openExternal(posted.url) }],
        })
        if (posted.cleanupWarning) {
          context.toast.show({ variant: "error", title: "Cleanup failed", description: posted.cleanupWarning })
        }
      }, "Could not post the review"),
    reset: (draft) =>
      attempt(async () => {
        if (await resetReviewFlow(host, draft)) {
          context.toast.show({ variant: "success", title: "Review reset" })
        }
      }, "Could not reset the review"),
    snooze: (item) =>
      attempt(async () => {
        const local = await snoozeFlow(host, item)
        if (local) {
          input.updateLocal(local)
        }
      }, "Could not snooze the pull request"),
    wake: (item) =>
      attempt(async () => {
        input.updateLocal(await context.client.rpc(ReviewQueue).wake({ key: item.key }))
        context.toast.show({ variant: "success", title: `${fullReference(item)} is back in the queue` })
      }, "Could not wake the pull request"),
    summarize: (item) => attempt(() => summaryFlow(host, item), "Could not summarize the pull request"),
  }
}
