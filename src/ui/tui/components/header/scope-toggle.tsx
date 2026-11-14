/** @jsxImportSource @opentui/solid */

import { usePlugin } from "@opencode/plugin/tui"
import type { QueueFilter } from "@/shared/presentation.js"

export function ScopeToggle(props: { filter: QueueFilter; setFilter(filter: QueueFilter): void }) {
  const theme = usePlugin().theme
  const option = (value: QueueFilter, label: string) => (
    <text
      fg={props.filter === value ? theme.text.action.primary.base : theme.text.faint}
      onMouseDown={() => props.setFilter(value)}
    >
      {props.filter === value ? <b>{label}</b> : label}
    </text>
  )

  return (
    <box flexDirection="row">
      {option("all", "All")}
      <text fg={theme.text.faint}> · </text>
      {option("current", "Current")}
    </box>
  )
}
