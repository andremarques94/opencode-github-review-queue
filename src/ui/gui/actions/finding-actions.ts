import type { Context, MountedSession } from "@opencode/plugin/gui"
import type { Finding, ReviewDraft } from "../../../domain/review-draft.js"
import { askAboutFindingFlow, decideFindingFlow, editFindingFlow } from "../../../shared/review/finding-flows.js"
import { createFindingFlowHost } from "./flow-host.js"
import { attempting, createReviewActions } from "./review-actions.js"

export type FindingActions = {
  decide(draft: ReviewDraft, finding: Finding, decision: "keep" | "drop"): Promise<void>
  edit(draft: ReviewDraft, finding: Finding): Promise<void>
  ask(draft: ReviewDraft, finding: Finding): Promise<void>
  post(draft: ReviewDraft): Promise<void>
  showFindings(): void
}

export const FINDINGS_PANEL = "findings"

export function createFindingActions(input: {
  context: Context
  session: () => MountedSession
  update(draft: ReviewDraft): void
  reload(): void
}): FindingActions {
  const { context } = input
  const host = createFindingFlowHost(context, () => input.session().server)
  const attempt = attempting(context)
  const reviews = createReviewActions({
    context,
    server: () => input.session().server.id,
    directory: () => undefined,
    updateLocal: input.reload,
  })

  return {
    decide: (draft, finding, decision) =>
      attempt(async () => {
        input.update(await decideFindingFlow(host, draft, finding, decision))
      }, "Could not record the decision"),
    edit: (draft, finding) =>
      attempt(async () => {
        const saved = await editFindingFlow(host, draft, finding)
        if (saved) {
          input.update(saved)
        }
      }, "Could not save the comment"),
    ask: (draft, finding) =>
      attempt(() => askAboutFindingFlow(host, draft, finding), "Could not ask about the finding"),
    async post(draft) {
      await reviews.post(draft)
      input.reload()
    },
    showFindings: () => context.layout.open(`${context.id}:${FINDINGS_PANEL}`, input.session()),
  }
}
