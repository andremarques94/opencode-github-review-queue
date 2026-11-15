/** @jsxImportSource @opentui/solid */

import { usePlugin } from "@opencode/plugin/tui"
import type { Store } from "solid-js/store"
import { emptyMessage, type QueueFilter } from "../../../../shared/presentation.js"
import type { TuiState } from "../../state.js"

export function EmptyState(props: { state: Store<TuiState>; filter: QueueFilter; snoozed: number }) {
  const theme = usePlugin().theme
  const message = () => {
    if (!props.state.initialized) {
      return "Waiting for the first successful GitHub refresh."
    }
    if (props.snoozed > 0) {
      return "Everything left is snoozed. Press z to show it."
    }
    return emptyMessage(props.filter)
  }

  return (
    <text fg={theme.text.muted} marginTop={1} flexGrow={1}>
      {message()}
    </text>
  )
}
