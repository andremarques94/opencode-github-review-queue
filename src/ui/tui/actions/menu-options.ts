import { canAddress } from "../../../domain/my-pull-request.js"
import type { ReviewDraft } from "../../../domain/review-draft.js"
import type { ReviewRequest } from "../../../domain/review-request.js"
import type { Snooze } from "../../../domain/snooze.js"
import { fullReference, type QueueFilter, readinessSummary, teamRequest } from "../../../shared/presentation.js"
import { type DraftAction, draftActions } from "../../../shared/review/draft-status.js"
import { snoozeLabel } from "../../../shared/review/snooze.js"
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

const SCOPE_TITLES: Record<QueueFilter, string> = {
  all: "Show all repositories",
  current: "Show only this repository",
  mine: "Show your pull requests",
}

const withDescription = (description: string | undefined) => (description ? { description } : {})

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
  snooze: Snooze | undefined,
  showDetails: boolean,
): MenuOption[] {
  return [
    {
      title: showDetails ? "Hide details" : "Show details",
      value: actions.toggleDetails,
      description: "Size, checks, reviewers, and when you were asked",
      footer: "d",
      category: PULL_REQUEST,
    },
    {
      title: "Open on GitHub",
      value: actions.open,
      ...withDescription(
        [teamRequest(item)?.detail, readinessSummary(item)].filter((part) => part !== undefined).join(" · "),
      ),
      footer: "o",
      category: PULL_REQUEST,
    },
    {
      title: "Copy reference",
      value: () => actions.copy("reference"),
      description: fullReference(item),
      footer: "y",
      category: PULL_REQUEST,
    },
    { title: "Copy link", value: () => actions.copy("link"), footer: "u", category: PULL_REQUEST },
    {
      title: "Summarize",
      value: actions.summarize,
      description: "Intent, main changes, and what to inspect",
      footer: "i",
      category: PULL_REQUEST,
    },
    ...(canAddress(item)
      ? [
          {
            title: "Address review…",
            value: actions.address,
            description: "Work through the review comments in your checkout",
            footer: "a",
            category: PULL_REQUEST,
          },
        ]
      : []),
    snooze
      ? {
          title: "Wake up",
          value: actions.snooze,
          description: `Snoozed ${snoozeLabel(snooze)}`,
          footer: "s",
          category: PULL_REQUEST,
        }
      : { title: "Snooze…", value: actions.snooze, footer: "s", category: PULL_REQUEST },
    ...draftActions(draft).map((action) => draftOption(actions, action)),
  ]
}

export function queueOptions(
  actions: ReviewActions,
  queue: { nextFilter: QueueFilter; snoozed: number; showSnoozed: boolean; toggleFullscreen: () => void },
): MenuOption[] {
  return [
    {
      title: SCOPE_TITLES[queue.nextFilter],
      value: actions.toggleFilter,
      footer: "f / ←→",
      category: QUEUE,
    },
    ...(queue.snoozed > 0 || queue.showSnoozed
      ? [
          {
            title: queue.showSnoozed ? "Hide snoozed" : `Show ${queue.snoozed} snoozed`,
            value: actions.toggleSnoozed,
            footer: "z",
            category: QUEUE,
          },
        ]
      : []),
    { title: "Refresh", value: actions.refresh, footer: "r", category: QUEUE },
    { title: "Toggle full screen", value: queue.toggleFullscreen, footer: "shift+f", category: QUEUE },
  ]
}
