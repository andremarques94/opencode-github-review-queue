import type { Context } from "@opencode/plugin/gui"
import { For, Show } from "solid-js"
import type { RepositoryGroup } from "../../../../shared/presentation.js"
import type { LocalReviews } from "../../../../shared/rpc.js"
import type { ReviewActions } from "../../actions/review-actions.js"
import { ReviewRow } from "./review-row.js"

export function ReviewGroup(props: {
  context: Context
  group: RepositoryGroup
  showHeader: boolean
  newKeys: readonly string[]
  local: LocalReviews
  now: number
  actions: ReviewActions
  copy(text: string, name: string): void
}) {
  return (
    <section>
      <Show when={props.showHeader}>
        <div class="grq-group" title={props.group.repository}>
          <span class="grq-group-name">
            <Show when={props.group.owner}>
              <span class="grq-group-owner">{props.group.owner} / </span>
            </Show>
            {props.group.name}
          </span>
          <span class="grq-group-count">{props.group.items.length}</span>
        </div>
      </Show>
      <For each={props.group.items}>
        {(item) => (
          <ReviewRow
            context={props.context}
            item={item}
            isNew={props.newKeys.includes(item.key)}
            local={props.local}
            now={props.now}
            actions={props.actions}
            copy={props.copy}
          />
        )}
      </For>
    </section>
  )
}
