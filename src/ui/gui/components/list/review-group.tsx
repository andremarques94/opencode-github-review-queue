import type { Context } from "@opencode/plugin/gui"
import { createMemo, For, Show } from "solid-js"
import type { RepositoryGroup } from "../../../../shared/presentation.js"
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

  return (
    <section>
      <Show when={props.showHeader}>
        <button
          type="button"
          class="grq-group"
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
          <span class="grq-group-count">{props.group.items.length}</span>
        </button>
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
