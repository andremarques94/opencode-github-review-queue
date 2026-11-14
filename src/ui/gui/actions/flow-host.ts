import type { Context } from "@opencode/plugin/gui"
import type { ReviewFlowHost } from "../../../shared/review/flows.js"
import { ReviewQueue } from "../../../shared/rpc.js"
import { confirmPost } from "../components/post-review-dialog.js"

export function createFlowHost(context: Context): ReviewFlowHost {
  const rpc = () => context.client.rpc(ReviewQueue)
  return {
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
}
