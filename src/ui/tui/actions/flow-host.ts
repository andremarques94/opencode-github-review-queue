import type { usePlugin } from "@opencode/plugin/tui"
import type { ReviewFlowHost } from "../../../shared/review/flows.js"
import { previewText } from "../../../shared/review/preview.js"
import { ReviewQueue } from "../../../shared/rpc.js"

export function createFlowHost(context: ReturnType<typeof usePlugin>): ReviewFlowHost {
  const rpc = context.client.rpc(ReviewQueue)
  return {
    confirm: async (options) =>
      (await context.ui.dialog.confirm({
        title: options.title,
        message: options.message,
        label: { confirm: options.confirm },
      })) === true,
    confirmPost: async (preview) =>
      (await context.ui.dialog.confirm({
        title: preview.title,
        message: previewText(preview),
        label: { confirm: "Post review" },
      })) === true,
    select: (options) =>
      context.ui.dialog.select({
        title: options.title,
        options: options.options.map(({ group, ...option }) => ({ ...option, ...(group ? { category: group } : {}) })),
        ...(options.current ? { current: options.current } : {}),
      }),
    models: () => rpc.models({}),
    notify: (message) => context.ui.toast.show({ message, variant: "info" }),
    startReview: (request) => rpc.startReview(request),
    postReview: (request) => rpc.postReview(request),
    resetReview: (request) => rpc.resetReview(request),
  }
}
