/** @jsxImportSource @opentui/solid */

import { usePlugin } from "@opencode/plugin/tui"

export function ErrorLine(props: { message: string }) {
  const theme = usePlugin().theme

  return (
    <text fg={theme.text.feedback.warning.base} marginTop={1}>
      {props.message}
    </text>
  )
}
