import type { Context, ServerRef } from "@opencode/plugin/gui"
import type { FindingFlowHost } from "../../../shared/review/finding-flows.js"
import type { ReviewFlowHost } from "../../../shared/review/flows.js"
import type { SnoozeFlowHost } from "../../../shared/review/snooze.js"
import type { SummaryFlowHost } from "../../../shared/review/summary.js"
import { ReviewQueue } from "../../../shared/rpc.js"
import { editFindingBody } from "../components/edit-finding-dialog.js"
import { confirmPost } from "../components/post-review-dialog.js"
import { showSummary } from "../components/summary-dialog.js"

/** `server` is the review session's server: its pending questions live there. */
export function createFindingFlowHost(context: Context, server: () => ServerRef): FindingFlowHost {
  const rpc = () => context.client.rpc(ReviewQueue)
  return {
    decideFinding: (request) => rpc().decideFinding(request),
    editFinding: (request) => rpc().editFinding(request),
    askAboutFinding: (request) => rpc().askAboutFinding(request),
    editBody: (input) => editFindingBody(context, input),
    questions: (sessionID) => server().client.session.form.list({ sessionID }),
    cancelQuestion: (input) => server().client.session.form.cancel(input),
  }
}

export function createFlowHost(context: Context): ReviewFlowHost & SnoozeFlowHost & SummaryFlowHost {
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
    prompt: (options) => context.dialogs.prompt({ ...options, submit: "Snooze" }),
    snooze: (request) => rpc().snooze(request),
    summarize: (request) => rpc().summarize(request),
    showSummary: (view) => showSummary(context, view),
  }
}
