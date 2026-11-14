/** @jsxImportSource @opentui/solid */

import { usePlugin } from "@opencode/plugin/tui"
import type { ReviewActions } from "../review-actions.js"

export function KeyHints(props: { actions: ReviewActions }) {
  const theme = usePlugin().theme
  const hint = (key: string, label: string) => (
    <>
      <span style={{ fg: theme.text.base }}>{key}</span>
      <span style={{ fg: theme.text.faint }}> {label} </span>
    </>
  )
  const button = (key: string, label: string, run: () => unknown) => (
    <text onMouseDown={() => void run()}>{hint(key, label)}</text>
  )

  return (
    <box flexDirection="row" marginTop={1} marginBottom={1} overflow="hidden">
      <text>{hint("j/k", "move")}</text>
      {button("enter", "review", props.actions.review)}
      {button("o", "github", props.actions.open)}
      {button("m", "menu", props.actions.menu)}
      {button("f", "scope", props.actions.toggleFilter)}
      {button("r", "refresh", props.actions.refresh)}
      {button("esc", "close", props.actions.close)}
    </box>
  )
}
