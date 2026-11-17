import type { Context } from "@opencode/plugin/gui"
import { createMemo, For, Show } from "solid-js"
import { isRepositorySnooze } from "../../../../domain/snooze.js"
import type { RepositoryGroup } from "../../../../shared/presentation.js"
import { activeSnooze } from "../../../../shared/review/snooze.js"
import type { LocalReviews } from "../../../../shared/rpc.js"
import type { ReviewActions } from "../../actions/review-actions.js"
import { type DetailsState, ReviewRow } from "./review-row.js"

export function ReviewGroup(props: {
  context: Context
  group: RepositoryGroup
  showHeader: boolean
  newKeys: readonly string[]
  local: LocalReviews
  now: number
  actions: ReviewActions
  details: DetailsState
  copy(text: string, name: string): void
}) {
  const items = createMemo(() => new Map(props.group.items.map((item) => [item.key, item])))
  const collapsed = () => props.showHeader && props.local.collapsed.includes(props.group.repository.toLowerCase())
  const keys = createMemo(() => (collapsed() ? [] : [...items().keys()]))
  const toggleLabel = () => `${collapsed() ? "Expand" : "Collapse"} ${props.group.repository}`
  const keysInGroup = () => props.group.items.map((item) => item.key)
  const anyDetails = () => keysInGroup().some((key) => props.details.isOpen(key))
  const detailsLabel = () => (anyDetails() ? "Hide details in this repository" : "Show details in this repository")
  const toggleDetails = () => {
    const open = !anyDetails()
    if (collapsed() && open) {
      void props.actions.collapse(props.group.repository, false)
    }
    props.details.setAll(keysInGroup(), open)
  }
  /** Shown snoozed rows carry the repository's snooze; the header wakes it from there. */
  const repositorySnooze = () =>
    props.group.items
      .map((item) => activeSnooze(props.local.snoozes, item, props.now))
      .find((snooze) => snooze !== undefined && isRepositorySnooze(snooze))
  const snoozeLabel = () => (repositorySnooze() ? "Wake up this repository" : "Snooze this repository…")
  const snooze = () => {
    const first = props.group.items[0]
    const current = repositorySnooze()
    if (!first) {
      return
    }
    void (current ? props.actions.wake(first, current) : props.actions.snoozeRepository(first))
  }

  return (
    <section>
      <Show when={props.showHeader}>
        <div class="grq-group">
          <button
            type="button"
            class="grq-group-toggle"
            title={toggleLabel()}
            aria-label={toggleLabel()}
            aria-expanded={!collapsed()}
            onClick={() => void props.actions.collapse(props.group.repository, !collapsed())}
          >
            <props.context.ui.Icon name="outline-chevron-down" size="small" />
            <span class="grq-group-name">
              <Show when={props.group.owner}>
                <span class="grq-group-owner">{props.group.owner} / </span>
              </Show>
              {props.group.name}
            </span>
            <span class="grq-count">{props.group.items.length}</span>
          </button>
          <div class="grq-group-tools">
            <props.context.ui.Tooltip value={detailsLabel()}>
              <props.context.ui.IconButton
                icon={anyDetails() ? "collapse" : "expand"}
                label={detailsLabel()}
                size="small"
                onClick={toggleDetails}
              />
            </props.context.ui.Tooltip>
            <props.context.ui.Tooltip value={snoozeLabel()}>
              <props.context.ui.IconButton
                icon={repositorySnooze() ? "outline-eye" : "outline-eye-slash"}
                label={snoozeLabel()}
                size="small"
                onClick={snooze}
              />
            </props.context.ui.Tooltip>
          </div>
        </div>
      </Show>
      {/* Keyed by pull request, so a refresh updates a row in place: its open details and menu stay open. */}
      <For each={keys()}>
        {(key) => (
          <Show when={items().get(key)}>
            {(item) => (
              <ReviewRow
                context={props.context}
                item={item()}
                isNew={props.newKeys.includes(key)}
                local={props.local}
                now={props.now}
                actions={props.actions}
                details={props.details}
                copy={props.copy}
              />
            )}
          </Show>
        )}
      </For>
    </section>
  )
}
