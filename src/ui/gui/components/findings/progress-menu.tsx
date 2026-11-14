import type { Context } from "@opencode/plugin/gui"
import { Show } from "solid-js"
import type { ReviewDraft } from "../../../../domain/review-draft.js"
import type { FindingActions } from "../../actions/finding-actions.js"
import { progressStyles } from "../styles.js"
import { ReviewProgress } from "./review-progress.js"

export function ProgressMenu(props: {
  context: Context
  draft: ReviewDraft | undefined
  actions: FindingActions
  close(): void
}) {
  return (
    <Show when={props.draft}>
      {(draft) => (
        <div class="grq-progress">
          <style>{progressStyles}</style>
          <ReviewProgress context={props.context} draft={draft()} actions={props.actions} beforePost={props.close}>
            <props.context.ui.Button
              size="small"
              variant="ghost"
              icon="checklist"
              onClick={() => {
                props.close()
                props.actions.showFindings()
              }}
            >
              Show findings
            </props.context.ui.Button>
          </ReviewProgress>
        </div>
      )}
    </Show>
  )
}
