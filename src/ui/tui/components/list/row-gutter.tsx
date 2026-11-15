/** @jsxImportSource @opentui/solid */

import { usePlugin } from "@opencode/plugin/tui"
import type { RGBA } from "@opentui/core"

/** The bar beside a selected or hovered row, and the dot on a new one. */
export function RowGutter(props: { selected: boolean; hovered: boolean; isNew: boolean; bar: RGBA }) {
  const theme = usePlugin().theme

  return (
    <text width={2}>
      <span style={{ fg: props.bar }}>{props.selected || props.hovered ? "▌" : " "}</span>
      <span style={{ fg: theme.text.action.primary.base }}>{props.isNew ? "●" : " "}</span>
    </text>
  )
}
