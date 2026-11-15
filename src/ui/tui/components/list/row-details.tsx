/** @jsxImportSource @opentui/solid */

import { usePlugin } from "@opencode/plugin/tui"
import { For } from "solid-js"
import type { Detail } from "../../../../shared/presentation.js"

export function RowDetails(props: { details: Detail[] }) {
  const theme = usePlugin().theme
  const width = () => Math.max(...props.details.map((detail) => detail.label.length)) + 2

  return (
    <box flexDirection="column" marginTop={1}>
      <For each={props.details}>
        {(detail) => (
          <text wrapMode="word">
            <span style={{ fg: theme.text.faint }}>{detail.label.padEnd(width())}</span>
            <span style={{ fg: detail.tone ? theme.text.feedback[detail.tone].base : theme.text.base }}>
              {detail.value}
            </span>
          </text>
        )}
      </For>
    </box>
  )
}
