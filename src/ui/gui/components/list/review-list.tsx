import type { Context } from "@opencode/plugin/gui"
import { createMemo, For, Show } from "solid-js"
import type { ReviewRequest } from "../../../../domain/review-request.js"
import { groupByRepository } from "../../../../shared/presentation.js"
import type { LocalReviews } from "../../../../shared/rpc.js"
import type { ReviewActions } from "../../actions/review-actions.js"
import { ReviewGroup } from "./review-group.js"
import type { DetailsState } from "./review-row.js"

export function ReviewList(props: {
  context: Context
  items: ReviewRequest[]
  newKeys: readonly string[]
  local: LocalReviews
  now: number
  actions: ReviewActions
  grouped: boolean
  details: DetailsState
  copy(text: string, name: string): void
}) {
  const groups = createMemo(() => new Map(groupByRepository(props.items).map((group) => [group.repository, group])))
  // Every refresh and clock tick builds new groups; iterating their names keeps each group, and the rows in it, mounted.
  const names = createMemo(() => [...groups().keys()])

  return (
    <div class="grq-list">
      <For each={names()}>
        {(name) => (
          <Show when={groups().get(name)}>
            {(group) => (
              <ReviewGroup
                context={props.context}
                group={group()}
                showHeader={props.grouped}
                newKeys={props.newKeys}
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
    </div>
  )
}
