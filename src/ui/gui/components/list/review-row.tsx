import type { Context } from "@opencode/plugin/gui"
import { createUniqueId, Show } from "solid-js"
import { canAddress } from "../../../../domain/my-pull-request.js"
import { reviewedFor } from "../../../../domain/review-history.js"
import type { ReviewRequest } from "../../../../domain/review-request.js"
import { fullReference, pullRequestDetails } from "../../../../shared/presentation.js"
import {
  type DraftAction,
  draftActions,
  draftFor,
  opensOnGitHub,
  resumable,
} from "../../../../shared/review/draft-status.js"
import { activeSnooze, snoozeLabel } from "../../../../shared/review/snooze.js"
import type { LocalReviews } from "../../../../shared/rpc.js"
import type { ReviewActions } from "../../actions/review-actions.js"
import { RowDetails } from "./row-details.js"
import { RowMeta } from "./row-meta.js"

export type DetailsState = {
  isOpen(key: string): boolean
  toggle(key: string): void
  setAll(keys: readonly string[], open: boolean): void
}

export type ReviewRowProps = {
  context: Context
  item: ReviewRequest
  isNew: boolean
  local: LocalReviews
  now: number
  actions: ReviewActions
  details: DetailsState
  copy(text: string, name: string): void
}

// The host's menu has no programmatic open, so right-click replays a real mouse click on its trigger.
const mouse = { bubbles: true, cancelable: true, button: 0 }
const pointer = { ...mouse, pointerType: "mouse", isPrimary: true }
const CLICK_SEQUENCE = [
  () => new PointerEvent("pointerdown", { ...pointer, buttons: 1 }),
  () => new MouseEvent("mousedown", { ...mouse, buttons: 1 }),
  () => new PointerEvent("pointerup", pointer),
  () => new MouseEvent("mouseup", mouse),
  () => new MouseEvent("click", mouse),
]

export function ReviewRow(props: ReviewRowProps) {
  let actions: HTMLDivElement | undefined
  const expanded = () => props.details.isOpen(props.item.key)
  const toggleDetails = () => props.details.toggle(props.item.key)
  const detailsID = createUniqueId()
  const detailsLabel = () => (expanded() ? "Hide details" : "Show details")
  const detailRows = () => pullRequestDetails(props.item, reviewedFor(props.local.reviewed, props.item.key), props.now)
  const draft = () => draftFor(props.local.drafts, props.item.key)
  const snooze = () => activeSnooze(props.local.snoozes, props.item, props.now)
  const open = () => props.context.system.openExternal(props.item.url)
  const openMenu = (event: MouseEvent) => {
    const trigger = actions?.querySelector("button")
    if (!trigger) {
      return
    }
    event.preventDefault()
    for (const create of CLICK_SEQUENCE) {
      trigger.dispatchEvent(create())
    }
  }

  const review = () =>
    opensOnGitHub(props.item, draft())
      ? open()
      : void props.actions.review(props.item, resumable(draft()), reviewedFor(props.local.reviewed, props.item.key))
  // A double click's first click already toggled the details, so the second one undoes that before reviewing.
  const clickRow = (event: MouseEvent) => {
    toggleDetails()
    if (event.detail === 2) {
      review()
    }
  }
  const reviewItem = () =>
    opensOnGitHub(props.item, draft())
      ? []
      : [
          {
            label: resumable(draft()) ? "Resume review" : "Start review",
            icon: "outline-code-brackets" as const,
            onSelect: review,
          },
        ]
  const addressItem = () =>
    canAddress(props.item)
      ? [
          {
            label: "Address review…",
            icon: "outline-code-brackets" as const,
            onSelect: () => void props.actions.address(props.item),
          },
        ]
      : []
  const snoozeItem = () => {
    const current = snooze()
    return current
      ? {
          label: `Wake up (snoozed ${snoozeLabel(current, props.now)})`,
          icon: "outline-eye" as const,
          onSelect: () => void props.actions.wake(props.item, current),
        }
      : { label: "Snooze…", icon: "outline-eye-slash" as const, onSelect: () => void props.actions.snooze(props.item) }
  }
  const snoozeRepositoryItem = () =>
    snooze()
      ? []
      : [
          {
            label: "Snooze repository…",
            icon: "outline-eye-slash" as const,
            onSelect: () => void props.actions.snoozeRepository(props.item),
          },
        ]
  const draftItem = (action: DraftAction) => {
    if (action.kind === "reset") {
      return { label: action.label, icon: "trash" as const, onSelect: () => void props.actions.reset(action.draft) }
    }
    return {
      label: action.label,
      icon: "outline-arrow-up-right" as const,
      disabled: action.blocker !== undefined,
      onSelect: () => void props.actions.post(action.draft),
    }
  }
  const draftItems = () => {
    const actions = draftActions(draft())
    return actions.length > 0 ? [{ type: "separator" as const }, ...actions.map(draftItem)] : []
  }

  return (
    <article class="grq-row" onContextMenu={openMenu}>
      <span class="grq-dot" data-hidden={props.isNew ? undefined : ""} title={props.isNew ? "New" : undefined} />
      <div class="grq-row-body">
        <button type="button" class="grq-row-main" title={props.item.title} onClick={clickRow}>
          <div class="grq-row-title">{props.item.title}</div>
          <RowMeta context={props.context} item={props.item} local={props.local} now={props.now} />
        </button>
        <Show when={expanded()}>
          <RowDetails id={detailsID} details={detailRows()} />
        </Show>
      </div>
      <button
        type="button"
        class="grq-disclosure"
        aria-expanded={expanded()}
        aria-controls={detailsID}
        aria-label={detailsLabel()}
        title={detailsLabel()}
        onClick={() => toggleDetails()}
      >
        <props.context.ui.Icon name="outline-chevron-down" size="small" />
      </button>
      <div
        class="grq-row-actions"
        ref={(element) => {
          actions = element
        }}
      >
        <props.context.ui.Menu
          label="Pull request actions"
          items={[
            ...reviewItem(),
            ...addressItem(),
            { label: "Summarize", icon: "file-document", onSelect: () => void props.actions.summarize(props.item) },
            { type: "separator" },
            { label: "Open on GitHub", icon: "github", onSelect: open },
            {
              label: "Copy reference",
              icon: "copy",
              onSelect: () => props.copy(fullReference(props.item), "Reference"),
            },
            { label: "Copy link", icon: "link", onSelect: () => props.copy(props.item.url, "Link") },
            { type: "separator" },
            snoozeItem(),
            ...snoozeRepositoryItem(),
            ...draftItems(),
          ]}
        />
      </div>
    </article>
  )
}
