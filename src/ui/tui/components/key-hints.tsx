/** @jsxImportSource @opentui/solid */

import { usePlugin } from "@opencode/plugin/tui"
import type { ReviewActions } from "../review-actions.js"

/** Two hints that fit a narrow panel; the actions menu lists every other key. */
export function KeyHints(props: { actions: ReviewActions }) {
  const theme = usePlugin().theme
  const hint = (key: string, label: string, run: () => unknown) => (
    <text wrapMode="none" onMouseUp={() => void run()}>
      <span style={{ fg: theme.text.base }}>{key}</span>
      <span style={{ fg: theme.text.faint }}> {label}</span>
    </text>
  )

  return (
    <box flexDirection="row" gap={2} marginTop={1} marginBottom={1} overflow="hidden">
      {hint("enter", "review", props.actions.review)}
      {hint("m", "actions", props.actions.menu)}
    </box>
  )
}
