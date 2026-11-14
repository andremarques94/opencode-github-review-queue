import type { Context } from "@opencode/plugin/gui"
import { createMemo, For } from "solid-js"
import type { ReviewDraft } from "../../../../domain/review-draft.js"
import type { ReviewRequest } from "../../../../domain/review-request.js"
import { groupByRepository } from "../../../../shared/presentation.js"
import type { ReviewActions } from "../../actions/review-actions.js"
import { ReviewGroup } from "./review-group.js"

export function ReviewList(props: {
  context: Context
  items: ReviewRequest[]
  newKeys: readonly string[]
  drafts: readonly ReviewDraft[]
  actions: ReviewActions
  grouped: boolean
  copy(text: string, name: string): void
}) {
  const groups = createMemo(() => groupByRepository(props.items))

  return (
    <div class="grq-list">
      <For each={groups()}>
        {(group) => (
          <ReviewGroup
            context={props.context}
            group={group}
            showHeader={props.grouped}
            newKeys={props.newKeys}
            drafts={props.drafts}
            actions={props.actions}
            copy={props.copy}
          />
        )}
      </For>
    </div>
  )
}
