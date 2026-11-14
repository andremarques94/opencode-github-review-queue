import type { Context } from "@opencode/plugin/gui"
import { Show } from "solid-js"
import type { Store } from "solid-js/store"
import type { QueueSnapshot } from "../../../../domain/review-queue.js"
import type { QueueFilter } from "../../../../shared/presentation.js"

export function EmptyState(props: { context: Context; state: Store<QueueSnapshot>; filter: QueueFilter }) {
  const message = () => {
    if (!props.state.initialized) {
      return "Waiting for the first successful GitHub refresh."
    }
    return props.filter === "current" ? "No review requests in this repository." : "You're all caught up."
  }

  return (
    <div class="grq-empty">
      <Show
        when={props.state.loading && !props.state.initialized}
        fallback={
          <>
            <span class="grq-empty-icon">
              <props.context.ui.Icon name="github" />
            </span>
            <span>{message()}</span>
          </>
        }
      >
        <props.context.ui.Loader />
        <span>Loading review requests…</span>
      </Show>
    </div>
  )
}
