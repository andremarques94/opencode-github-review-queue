/** @jsxImportSource @opentui/solid */

import { usePlugin } from "@opencode/plugin/tui"
import { Show } from "solid-js"
import type { Store } from "solid-js/store"
import { type QueueFilter, refreshLabel } from "../../../../shared/presentation.js"
import type { ReviewActions } from "../../review-actions.js"
import type { TuiState } from "../../state.js"
import { ScopeToggle } from "./scope-toggle.js"

export function PanelHeader(props: {
  state: Store<TuiState>
  filter: QueueFilter
  count: number
  actions: ReviewActions
}) {
  const theme = usePlugin().theme
  const status = () =>
    [
      refreshLabel(props.state),
      props.filter === "current" ? (props.state.repository ?? "not a GitHub repository") : undefined,
      props.state.loading ? "refreshing…" : undefined,
    ]
      .filter(Boolean)
      .join(" · ")

  return (
    <box flexDirection="column">
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text.base}>
          <b>Review requests</b>
          <span style={{ fg: theme.text.muted }}> {props.count}</span>
        </text>
        <ScopeToggle filter={props.filter} setFilter={props.actions.setFilter} />
      </box>
      <box flexDirection="row">
        <text fg={theme.text.muted} wrapMode="none" truncate>
          {status()}
        </text>
        <Show when={props.state.stale}>
          <text fg={theme.text.feedback.warning.base}> · stale</text>
        </Show>
      </box>
    </box>
  )
}
