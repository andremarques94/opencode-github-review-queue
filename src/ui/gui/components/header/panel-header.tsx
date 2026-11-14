import type { Context } from "@opencode/plugin/gui"
import { Show } from "solid-js"
import type { Store } from "solid-js/store"
import type { QueueSnapshot } from "@/domain/review-queue.js"
import { type QueueFilter, refreshLabel } from "@/shared/presentation.js"
import { ScopeToggle } from "./scope-toggle.js"

export function PanelHeader(props: {
  context: Context
  state: Store<QueueSnapshot>
  count: number
  filter: QueueFilter
  repository: string | undefined
  setFilter(filter: QueueFilter): void
  refresh(): void
}) {
  const status = () => {
    const scope = props.filter === "current" ? props.repository?.split("/").pop() : undefined
    return [refreshLabel(props.state), scope].filter(Boolean).join(" · ")
  }

  return (
    <header class="grq-header">
      <div class="grq-header-top">
        <div class="grq-heading">
          <span>Review requests</span>
          <span class="grq-count">{props.count}</span>
        </div>
        <div class="grq-tools">
          <ScopeToggle filter={props.filter} canFilter={!!props.repository} setFilter={props.setFilter} />
          <props.context.ui.Tooltip value="Refresh">
            <props.context.ui.IconButton
              icon="outline-rotate-clockwise"
              label="Refresh"
              size="small"
              busy={props.state.loading}
              onClick={props.refresh}
            />
          </props.context.ui.Tooltip>
        </div>
      </div>
      <div class="grq-status">
        {status()}
        <Show when={props.state.stale}>
          <span class="grq-status-stale"> · stale</span>
        </Show>
      </div>
    </header>
  )
}
