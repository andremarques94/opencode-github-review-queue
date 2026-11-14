import type { usePlugin } from "@opencode/plugin/tui"
import type { FindingFlowHost } from "../../../shared/review/finding-flows.js"
import type { ReviewFlowHost } from "../../../shared/review/flows.js"
import { ReviewQueue } from "../../../shared/rpc.js"
import { editFindingBody } from "../components/findings/edit-finding-dialog.js"
import { confirmPost } from "../components/post-review-dialog.js"

export function createFindingFlowHost(context: ReturnType<typeof usePlugin>): FindingFlowHost {
  const rpc = context.client.rpc(ReviewQueue)
  return {
    decideFinding: (request) => rpc.decideFinding(request),
    editFinding: (request) => rpc.editFinding(request),
    askAboutFinding: (request) => rpc.askAboutFinding(request),
    editBody: (input) => editFindingBody(context, input),
    questions: (sessionID) => context.client.session.form.list({ sessionID }),
    cancelQuestion: (input) => context.client.session.form.cancel(input),
  }
}

export function createFlowHost(context: ReturnType<typeof usePlugin>): ReviewFlowHost {
  const rpc = context.client.rpc(ReviewQueue)
  return {
    confirm: async (options) =>
      (await context.ui.dialog.confirm({
        title: options.title,
        message: options.message,
        label: { confirm: options.confirm },
      })) === true,
    confirmPost: (preview) => confirmPost(context, preview),
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
