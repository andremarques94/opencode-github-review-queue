/** @jsxImportSource @opentui/solid */

import { usePlugin } from "@opencode/plugin/tui"
import { For, Show } from "solid-js"
import type { ReviewRequest } from "../../../../domain/review-request.js"
import { parseOptions } from "../../../../shared/options.js"
import { readinessMarks, sizeMark, teamRequest, waitMark } from "../../../../shared/presentation.js"

export function RowMeta(props: { item: ReviewRequest; review: string | undefined }) {
  const plugin = usePlugin()
  const theme = plugin.theme
  const staleAfterMs = parseOptions(plugin.options).staleAfterMs
  const wait = () => waitMark(props.item, staleAfterMs)

  return (
    <text fg={theme.text.muted} wrapMode="none">
      #{props.item.number}
      {/* Before the author and age, so a narrow panel cuts those first. */}
      <For each={readinessMarks(props.item)}>
        {(mark) => <span style={{ fg: theme.text.feedback[mark.tone].base }}> {mark.label}</span>}
      </For>
      <Show when={sizeMark(props.item)}>{(size) => ` ${size().label}`}</Show>
      <Show when={!props.item.authored}>
        {" · "}
        <b>@{props.item.author}</b>
      </Show>
      <Show when={teamRequest(props.item)}>
        {(team) => <span style={{ fg: theme.text.faint }}> {team().label}</span>}
      </Show>
      {" · "}
      <span style={{ fg: wait().stale ? theme.text.feedback.warning.base : theme.text.muted }}>{wait().label}</span>
      <Show when={props.item.draft}>
        <span style={{ fg: theme.text.feedback.warning.base }}> · draft</span>
      </Show>
      <Show when={props.review}>
        {(review) => <span style={{ fg: theme.text.action.primary.base }}> · {review()}</span>}
      </Show>
    </text>
  )
}
