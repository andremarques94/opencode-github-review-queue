/** @jsxImportSource @opentui/solid */

import { usePlugin } from "@opencode/plugin/tui"
import { For } from "solid-js"

export function KeyHints(props: { hints: { key: string; label: string; run: () => unknown }[] }) {
  const theme = usePlugin().theme

  return (
    <box flexDirection="row" flexWrap="wrap" columnGap={2} marginTop={1} marginBottom={1}>
      <For each={props.hints}>
        {(hint) => (
          <text wrapMode="none" flexShrink={0} onMouseUp={() => void hint.run()}>
            <span style={{ fg: theme.text.base }}>{hint.key}</span>
            <span style={{ fg: theme.text.faint }}> {hint.label}</span>
          </text>
        )}
      </For>
    </box>
  )
}
