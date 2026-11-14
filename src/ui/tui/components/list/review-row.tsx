/** @jsxImportSource @opentui/solid */

import { usePlugin } from "@opencode/plugin/tui"
import type { MouseEvent } from "@opentui/core"
import { createSignal, Show } from "solid-js"
import type { ReviewRequest } from "../../../../domain/review-request.js"
import { ago } from "../../../../shared/presentation.js"
import type { ReviewActions } from "../../actions/review-actions.js"

const RIGHT_BUTTON = 2

export const rowID = (key: string) => `github-review-queue:${key}`

export function ReviewRow(props: {
  item: ReviewRequest
  index: number
  selected: boolean
  isNew: boolean
  review: string | undefined
  actions: ReviewActions
}) {
  const theme = usePlugin().theme
  const [hovered, setHovered] = createSignal(false)
  const look = () =>
    props.selected
      ? { background: theme.background.raised.base, bar: theme.text.action.primary.base, wrap: "word" as const }
      : { background: undefined, bar: theme.text.faint, wrap: "none" as const }

  // Dialogs open on release: opened on press, the release would land outside them and close them again.
  let pressedSelected = false
  const press = () => {
    pressedSelected = props.selected
    props.actions.select(props.item.key)
  }
  const release = (event: MouseEvent) => {
    if (event.button === RIGHT_BUTTON) {
      void props.actions.menu()
      return
    }
    if (pressedSelected) {
      void props.actions.review()
    }
  }

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
      <text width={2}>
        <span style={{ fg: look().bar }}>{props.selected || hovered() ? "▌" : " "}</span>
        <span style={{ fg: theme.text.action.primary.base }}>{props.isNew ? "●" : " "}</span>
      </text>
      <box flexDirection="column" flexGrow={1} paddingRight={1}>
        <text fg={theme.text.base} wrapMode={look().wrap} truncate={!props.selected}>
          {props.item.title}
        </text>
        <text fg={theme.text.muted} wrapMode="none" truncate>
          #{props.item.number} · @{props.item.author} · {ago(props.item.createdAt)}
          <Show when={props.item.draft}>
            <span style={{ fg: theme.text.feedback.warning.base }}> · draft</span>
          </Show>
          <Show when={props.review}>
            {(review) => <span style={{ fg: theme.text.action.primary.base }}> · {review()}</span>}
          </Show>
        </text>
      </box>
    </box>
  )
}
