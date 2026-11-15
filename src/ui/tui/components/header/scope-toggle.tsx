/** @jsxImportSource @opentui/solid */

import { usePlugin } from "@opencode/plugin/tui"
import { Show } from "solid-js"
import type { QueueFilter } from "../../../../shared/presentation.js"

export function ScopeToggle(props: {
  filter: QueueFilter
  /** Undefined when the user's own pull requests are turned off. */
  mine: number | undefined
  setFilter(filter: QueueFilter): void
}) {
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
      <Show when={props.mine !== undefined}>
        <text fg={theme.text.faint}> · </text>
        {option("mine", props.mine ? `Mine ${props.mine}` : "Mine")}
      </Show>
    </box>
  )
}
