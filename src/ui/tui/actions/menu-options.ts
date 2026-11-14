import type { ReviewDraft } from "../../../domain/review-draft.js"
import type { ReviewRequest } from "../../../domain/review-request.js"
import { fullReference, type QueueFilter } from "../../../shared/presentation.js"
import { type DraftAction, draftActions } from "../../../shared/review/draft-status.js"
import type { ReviewActions } from "./review-actions.js"

export type MenuOption = {
  title: string
  value: () => unknown
  description?: string
  footer?: string
  category: string
}

const PULL_REQUEST = "Pull request"
const QUEUE = "Queue"

function draftOption(actions: ReviewActions, action: DraftAction): MenuOption {
  if (action.kind === "reset") {
    return { title: action.label, value: actions.reset, category: PULL_REQUEST }
  }
  return {
    title: action.label,
    value: actions.post,
    description: action.blocker ?? "Ready to post",
    footer: "p",
    category: PULL_REQUEST,
  }
}

export function pullRequestOptions(
  actions: ReviewActions,
  item: ReviewRequest,
  draft: ReviewDraft | undefined,
): MenuOption[] {
  return [
    { title: "Open on GitHub", value: actions.open, footer: "o", category: PULL_REQUEST },
    {
      title: "Copy reference",
      value: () => actions.copy("reference"),
      description: fullReference(item),
      footer: "y",
      category: PULL_REQUEST,
    },
    { title: "Copy link", value: () => actions.copy("link"), footer: "u", category: PULL_REQUEST },
    ...draftActions(draft).map((action) => draftOption(actions, action)),
  ]
}

export function queueOptions(actions: ReviewActions, filter: QueueFilter, toggleFullscreen: () => void): MenuOption[] {
  return [
    {
      title: filter === "all" ? "Show only this repository" : "Show all repositories",
      value: actions.toggleFilter,
      footer: "f / ←→",
      category: QUEUE,
    },
    { title: "Refresh", value: actions.refresh, footer: "r", category: QUEUE },
    { title: "Toggle full screen", value: toggleFullscreen, footer: "shift+f", category: QUEUE },
  ]
}
