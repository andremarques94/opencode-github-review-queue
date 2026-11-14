/** @jsxImportSource @opentui/solid */

import { usePlugin } from "@opencode/plugin/tui"
import type { Store } from "solid-js/store"
import type { QueueFilter } from "../../../../shared/presentation.js"
import type { TuiState } from "../../state.js"

export function EmptyState(props: { state: Store<TuiState>; filter: QueueFilter }) {
  const theme = usePlugin().theme
  const message = () => {
    if (!props.state.initialized) {
      return "Waiting for the first successful GitHub refresh."
    }
    return props.filter === "current" ? "No review requests in this repository." : "You're all caught up."
  }

  return (
    <text fg={theme.text.muted} marginTop={1} flexGrow={1}>
      {message()}
    </text>
  )
}
