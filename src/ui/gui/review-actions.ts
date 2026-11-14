import type { Context } from "@opencode/plugin/gui"
import type { ReviewDraft } from "../../domain/review-draft.js"
import type { ReviewRequest } from "../../domain/review-request.js"
import {
  errorMessage,
  postReviewFlow,
  type ReviewFlowHost,
  resetReviewFlow,
  startReviewFlow,
} from "../../shared/review-flow.js"
import { ReviewQueue } from "../../shared/rpc.js"
import { confirmPost } from "./components/post-review-dialog.js"

export type ReviewActions = {
  review(item: ReviewRequest, resuming: boolean): Promise<void>
  post(draft: ReviewDraft): Promise<void>
  reset(draft: ReviewDraft): Promise<void>
}

export function createReviewActions(input: {
  context: Context
  server: () => string
  directory: () => string | undefined
}): ReviewActions {
  const { context } = input
  const rpc = () => context.client.rpc(ReviewQueue)
  const host: ReviewFlowHost = {
    confirm: (options) =>
      context.dialogs.confirm({
        title: options.title,
        description: options.message,
        confirm: options.confirm,
        ...(options.danger ? { danger: true } : {}),
      }),
    confirmPost: (preview) => confirmPost(context, preview),
    select: (options) => context.dialogs.select(options),
    models: () => rpc().models({}),
    notify: (message) => context.toast.show({ title: message, icon: "github" }),
    startReview: (request) => rpc().startReview(request),
    postReview: (request) => rpc().postReview(request),
    resetReview: (request) => rpc().resetReview(request),
  }
  const attempt = async (run: () => Promise<void>, fallback: string) => {
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

  return {
    review: (item, resuming) =>
      attempt(async () => {
        const sessionID = await startReviewFlow(host, item, input.directory(), resuming)
        if (sessionID) {
          context.tabs.open({ server: input.server(), id: sessionID }, { focus: true })
        }
      }, "Could not start the review"),
    post: (draft) =>
      attempt(async () => {
        const url = await postReviewFlow(host, draft)
        if (url) {
          context.toast.show({
            variant: "success",
            title: "Review posted",
            description: url,
            actions: [{ label: "Open", run: () => context.system.openExternal(url) }],
          })
        }
      }, "Could not post the review"),
    reset: (draft) =>
      attempt(async () => {
        if (await resetReviewFlow(host, draft)) {
          context.toast.show({ variant: "success", title: "Review reset" })
        }
      }, "Could not reset the review"),
  }
}
