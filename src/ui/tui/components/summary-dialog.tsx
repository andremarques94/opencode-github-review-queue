/** @jsxImportSource @opentui/solid */

import { usePlugin } from "@opencode/plugin/tui"
import { Show } from "solid-js"
import type { SummaryView } from "../../../shared/review/summary.js"
import { MarkdownText } from "./markdown-text.js"

const SUMMARY_HEIGHT = 24

export function showSummary(context: ReturnType<typeof usePlugin>, view: SummaryView): void {
  context.ui.dialog.show(() => <SummaryDialog view={view} close={() => context.ui.dialog.clear()} />)
  context.ui.dialog.set({ size: "large" })
}

function SummaryDialog(props: { view: SummaryView; close(): void }) {
  const theme = usePlugin().theme

  return (
    <box flexDirection="column" gap={1} paddingLeft={2} paddingRight={2} paddingBottom={1}>
      <text fg={theme.text.base} wrapMode="word">
        <b>{props.view.title}</b>
      </text>
      <Show when={props.view.note}>
        {(note) => (
          <text fg={theme.text.feedback.warning.base} wrapMode="word">
            {note()}
          </text>
        )}
      </Show>
      <scrollbox maxHeight={SUMMARY_HEIGHT}>
        <MarkdownText content={props.view.markdown} />
      </scrollbox>
      <text wrapMode="none" onMouseUp={props.close}>
        <span style={{ fg: theme.text.base }}>esc</span>
        <span style={{ fg: theme.text.faint }}> close</span>
      </text>
    </box>
  )
}
