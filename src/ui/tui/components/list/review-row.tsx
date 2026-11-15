/** @jsxImportSource @opentui/solid */

import { usePlugin } from "@opencode/plugin/tui"
import type { MouseEvent } from "@opentui/core"
import { createSignal, Show } from "solid-js"
import type { ReviewRequest } from "../../../../domain/review-request.js"
import { type Detail, fitLine } from "../../../../shared/presentation.js"
import type { ReviewActions } from "../../actions/review-actions.js"
import { RowDetails } from "./row-details.js"
import { RowGutter } from "./row-gutter.js"
import { RowMeta } from "./row-meta.js"

const RIGHT_BUTTON = 2

export const rowID = (key: string) => `github-review-queue:${key}`

function rowLook(selected: boolean, title: string, width: number, theme: ReturnType<typeof usePlugin>["theme"]) {
  if (selected) {
    return {
      background: theme.background.raised.base,
      bar: theme.text.action.primary.base,
      wrap: "word" as const,
      title,
    }
  }
  return { background: undefined, bar: theme.text.faint, wrap: "none" as const, title: fitLine(title, width) }
}

// Dialogs open on release: opened on press, the release would land outside them and close them again.
function rowClicks(row: { readonly selected: boolean; readonly item: ReviewRequest; readonly actions: ReviewActions }) {
  let pressedSelected = false
  return {
    press() {
      pressedSelected = row.selected
      row.actions.select(row.item.key)
    },
    release(event: MouseEvent) {
      if (event.button === RIGHT_BUTTON) {
        void row.actions.menu()
        return
      }
      if (pressedSelected) {
        void row.actions.review()
      }
    },
  }
}

export function ReviewRow(props: {
  item: ReviewRequest
  index: number
  selected: boolean
  isNew: boolean
  review: string | undefined
  /** Shown under the row while it is selected. */
  details: Detail[] | undefined
  width: number
  actions: ReviewActions
}) {
  const plugin = usePlugin()
  const theme = plugin.theme
  const [hovered, setHovered] = createSignal(false)
  const look = () => rowLook(props.selected, props.item.title, props.width, theme)

  const { press, release } = rowClicks(props)

  return (
    <box
      id={rowID(props.item.key)}
      flexDirection="row"
      marginTop={Math.min(props.index, 1)}
      backgroundColor={look().background}
      onMouseDown={press}
      onMouseUp={release}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
    >
      <RowGutter selected={props.selected} hovered={hovered()} isNew={props.isNew} bar={look().bar} />
      <box flexDirection="column" flexGrow={1} paddingRight={1}>
        <text fg={theme.text.base} wrapMode={look().wrap}>
          <b>{look().title}</b>
        </text>
        <RowMeta item={props.item} review={props.review} />
        <Show when={props.selected && props.details}>{(details) => <RowDetails details={details()} />}</Show>
      </box>
    </box>
  )
}
