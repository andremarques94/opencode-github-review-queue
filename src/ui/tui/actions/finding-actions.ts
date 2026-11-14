import { usePlugin } from "@opencode/plugin/tui"
import type { PanelInput } from "@opencode/plugin/tui/context"
import type { Accessor, Setter } from "solid-js"
import type { Finding, ReviewDraft } from "../../../domain/review-draft.js"
import { askAboutFindingFlow, decideFindingFlow, editFindingFlow } from "../../../shared/review/finding-flows.js"
import { createFindingFlowHost, createFlowHost } from "./flow-host.js"
import { attempting, postDraft } from "./review-actions.js"

export type FindingActions = {
  select(id: number): void
  decide(decision: "keep" | "drop"): Promise<void>
  edit(): Promise<void>
  ask(): Promise<void>
  post(): Promise<void>
  toggleEvidence(): void
}

export function useFindingActions(input: {
  panel: PanelInput
  draft: Accessor<ReviewDraft | undefined>
  ordered: Accessor<Finding[]>
  current: Accessor<Finding | undefined>
  setSelected: Setter<number>
  setExpanded: Setter<number | undefined>
  update(draft: ReviewDraft): void
  reload(): void
}): FindingActions {
  const context = usePlugin()
  const host = createFindingFlowHost(context)
  const attempt = attempting(context)
  const target = () => {
    const draft = input.draft()
    const finding = input.current()
    return draft && finding && draft.status !== "posted" ? { draft, finding } : undefined
  }

  const actions: FindingActions = {
    select(id) {
      const index = input.ordered().findIndex((finding) => finding.id === id)
      if (index !== -1) {
        input.setSelected(index)
      }
    },
    decide: (decision) =>
      attempt(async () => {
        const selected = target()
        if (selected) {
          input.update(await decideFindingFlow(host, selected.draft, selected.finding, decision))
        }
      }, "Could not record the decision"),
    edit: () =>
      attempt(async () => {
        const selected = target()
        const saved = selected && (await editFindingFlow(host, selected.draft, selected.finding))
        if (saved) {
          input.update(saved)
        }
      }, "Could not save the comment"),
    ask: () =>
      attempt(async () => {
        const selected = target()
        if (selected) {
          await askAboutFindingFlow(host, selected.draft, selected.finding)
          context.ui.toast.show({ message: `Asked about finding #${selected.finding.id}`, variant: "info" })
        }
      }, "Could not ask about the finding"),
    post: () =>
      attempt(async () => {
        const draft = input.draft()
        if (draft) {
          await postDraft(context, createFlowHost(context), draft)
          input.reload()
        }
      }, "Could not post the review"),
    toggleEvidence() {
      const id = input.current()?.id
      input.setExpanded((expanded) => (expanded === id ? undefined : id))
    },
  }

  context.keymap.layer(() => ({
    commands: [
      {
        id: "github-review-queue.findings.next",
        title: "Next finding",
        bind: "j,down",
        run: () => input.setSelected((value) => Math.min(value + 1, input.ordered().length - 1)),
      },
      {
        id: "github-review-queue.findings.previous",
        title: "Previous finding",
        bind: "k,up",
        run: () => input.setSelected((value) => Math.max(0, value - 1)),
      },
      { id: "github-review-queue.findings.keep", title: "Keep finding", bind: "y", run: () => actions.decide("keep") },
      { id: "github-review-queue.findings.drop", title: "Drop finding", bind: "d", run: () => actions.decide("drop") },
      { id: "github-review-queue.findings.edit", title: "Edit the comment", bind: "e", run: actions.edit },
      { id: "github-review-queue.findings.ask", title: "Ask the agent about it", bind: "a", run: actions.ask },
      {
        id: "github-review-queue.findings.evidence",
        title: "Show evidence",
        bind: "enter",
        run: actions.toggleEvidence,
      },
      { id: "github-review-queue.findings.post", title: "Post review", bind: "p", run: actions.post },
      {
        id: "github-review-queue.findings.fullscreen",
        title: "Toggle panel fullscreen",
        bind: "shift+f",
        run: input.panel.toggleFullscreen,
      },
      { bind: "escape", run: input.panel.close },
    ],
  }))

  return actions
}
