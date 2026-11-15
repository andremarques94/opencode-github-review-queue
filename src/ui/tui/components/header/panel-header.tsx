/** @jsxImportSource @opentui/solid */

import { usePlugin } from "@opencode/plugin/tui"
import { Show } from "solid-js"
import type { Store } from "solid-js/store"
import { needingYou, type QueueFilter, refreshLabel } from "../../../../shared/presentation.js"
import { type QueueView, snoozedToggleLabel } from "../../../../shared/review/snooze.js"
import type { ReviewActions } from "../../actions/review-actions.js"
import type { TuiState } from "../../state.js"
import { ScopeToggle } from "./scope-toggle.js"

export function PanelHeader(props: {
  state: Store<TuiState>
  filter: QueueFilter
  count: number
  view: QueueView
  showSnoozed: boolean
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
          <b>{props.filter === "mine" ? "Your pull requests" : "Review requests"}</b>
          <span style={{ fg: theme.text.muted }}> {props.count}</span>
        </text>
        <ScopeToggle filter={props.filter} mine={needingYou(props.state)} setFilter={props.actions.setFilter} />
      </box>
      <box flexDirection="row">
        <text fg={theme.text.muted} wrapMode="none" truncate>
          {status()}
        </text>
        <Show when={props.state.stale}>
          <text fg={theme.text.feedback.warning.base}> · stale</text>
        </Show>
        <Show when={props.view.snoozed > 0}>
          <text fg={theme.text.action.primary.base} wrapMode="none" onMouseUp={props.actions.toggleSnoozed}>
            {` · ${snoozedToggleLabel(props.view, props.showSnoozed)}`}
          </text>
        </Show>
      </box>
    </box>
  )
}
