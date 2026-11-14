import type { Context } from "@opencode/plugin/gui"
import type { JSX } from "solid-js"
import { Show } from "solid-js"
import type { ReviewDraft } from "../../../../domain/review-draft.js"
import { reviewProgress } from "../../../../shared/review/draft-status.js"
import type { FindingActions } from "../../actions/finding-actions.js"

export function ReviewProgress(props: {
  context: Context
  draft: ReviewDraft
  actions: FindingActions
  /** Closes a popover before the post dialog opens over it. */
  beforePost?: () => void
  children?: JSX.Element
}) {
  const progress = () => reviewProgress(props.draft)

  return (
    <>
      <div>{progress().label}</div>
      <Show when={props.draft.status !== "posted" && progress().blocker}>
        {(blocker) => <div class="grq-muted">{blocker()}</div>}
      </Show>
      <div class="grq-actions">
        <Show when={props.draft.status !== "posted"}>
          <props.context.ui.Button
            size="small"
            variant="contrast"
            icon="outline-arrow-up-right"
            disabled={progress().blocker !== undefined}
            onClick={() => {
              props.beforePost?.()
              void props.actions.post(props.draft)
            }}
          >
            Post review…
          </props.context.ui.Button>
        </Show>
        {props.children}
      </div>
    </>
  )
}
