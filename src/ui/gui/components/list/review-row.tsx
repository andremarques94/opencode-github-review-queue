import type { Context } from "@opencode/plugin/gui"
import { For, Show } from "solid-js"
import { postBlocker } from "../../../../domain/review-draft.js"
import { reviewedFor } from "../../../../domain/review-history.js"
import type { ReviewRequest } from "../../../../domain/review-request.js"
import { ago, fullReference, readinessMarks, teamRequest } from "../../../../shared/presentation.js"
import {
  type DraftAction,
  draftActions,
  draftFor,
  resumable,
  rowLabel,
} from "../../../../shared/review/draft-status.js"
import { activeSnooze, snoozeLabel } from "../../../../shared/review/snooze.js"
import type { LocalReviews } from "../../../../shared/rpc.js"
import type { ReviewActions } from "../../actions/review-actions.js"

export type ReviewRowProps = {
  context: Context
  item: ReviewRequest
  isNew: boolean
  local: LocalReviews
  now: number
  actions: ReviewActions
  copy(text: string, name: string): void
}

const postBlockerOf = (draft: ReturnType<typeof draftFor>) => (draft ? postBlocker(draft) : undefined)

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
    void props.actions.review(props.item, resumable(draft()), reviewedFor(props.local.reviewed, props.item.key))
  const snoozeItem = () => {
    const current = snooze()
    return current
      ? {
          label: `Wake up (snoozed ${snoozeLabel(current, props.now)})`,
          icon: "outline-eye" as const,
          onSelect: () => void props.actions.wake(props.item),
        }
      : { label: "Snooze…", icon: "outline-eye-slash" as const, onSelect: () => void props.actions.snooze(props.item) }
  }
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
      <button type="button" class="grq-row-main" title={props.item.title} onClick={review}>
        <div class="grq-row-title">{props.item.title}</div>
        <div class="grq-row-meta">
          <span class="grq-number">#{props.item.number}</span>
          <For each={readinessMarks(props.item)}>
            {(mark) => (
              <span class="grq-mark" data-tone={mark.tone} role="img" title={mark.detail} aria-label={mark.detail}>
                {mark.label}
              </span>
            )}
          </For>
          <span class="grq-sep">·</span>
          <span>@{props.item.author}</span>
          <Show when={teamRequest(props.item)}>
            {(team) => (
              <span class="grq-team" title={team().detail}>
                {team().label}
              </span>
            )}
          </Show>
          <span class="grq-sep">·</span>
          <span class="grq-number">{ago(props.item.createdAt)}</span>
          <Show when={props.item.draft}>
            <span class="grq-badge">Draft</span>
          </Show>
          <Show when={rowLabel(props.item, props.local, props.now)}>
            {(label) => (
              <span
                class="grq-badge grq-badge-review"
                title={(resumable(draft()) && postBlockerOf(draft())) || label()}
              >
                {label()}
              </span>
            )}
          </Show>
        </div>
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
            { label: "Open on GitHub", icon: "github", onSelect: open },
            {
              label: "Copy reference",
              icon: "copy",
              onSelect: () => props.copy(fullReference(props.item), "Reference"),
            },
            { label: "Copy link", icon: "link", onSelect: () => props.copy(props.item.url, "Link") },
            { label: "Summarize", icon: "file-document", onSelect: () => void props.actions.summarize(props.item) },
            snoozeItem(),
            ...draftItems(),
          ]}
        />
      </div>
    </article>
  )
}
