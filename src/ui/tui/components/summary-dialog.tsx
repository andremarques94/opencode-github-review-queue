/** @jsxImportSource @opentui/solid */

import { usePlugin } from "@opencode/plugin/tui"
import { type Accessor, createSignal, onCleanup, Show } from "solid-js"
import { elapsedLabel } from "../../../shared/presentation.js"
import type { PendingSummary, SummaryView } from "../../../shared/review/summary.js"
import { MarkdownText } from "./markdown-text.js"

const SUMMARY_HEIGHT = 24
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

export function openSummary(
  context: ReturnType<typeof usePlugin>,
  input: { title: string; waiting: string },
): PendingSummary {
  const [view, setView] = createSignal<SummaryView>()
  const startedAt = Date.now()
  let open = false
  const show = () => {
    open = true
    context.ui.dialog.show(
      () => (
        <SummaryDialog
          title={input.title}
          waiting={input.waiting}
          view={view}
          startedAt={startedAt}
          close={() => context.ui.dialog.clear()}
        />
      ),
      () => {
        open = false
      },
    )
    context.ui.dialog.set({ size: "large" })
  }
  show()
  return {
    show(next) {
      setView(next)
      if (!open) {
        show()
      }
    },
    close() {
      if (open) {
        context.ui.dialog.clear()
      }
    },
  }
}

function SummaryDialog(props: {
  title: string
  waiting: string
  view: Accessor<SummaryView | undefined>
  startedAt: number
  close(): void
}) {
  const theme = usePlugin().theme
  const [now, setNow] = createSignal(Date.now())
  const timer = setInterval(() => setNow(Date.now()), 100)
  onCleanup(() => clearInterval(timer))
  const frame = () => SPINNER[Math.floor((now() - props.startedAt) / 100) % SPINNER.length]

  return (
    <box flexDirection="column" gap={1} paddingLeft={2} paddingRight={2} paddingBottom={1}>
      <text fg={theme.text.base} wrapMode="word">
        <b>{props.title}</b>
      </text>
      <Show
        when={props.view()}
        fallback={
          <text fg={theme.text.muted} wrapMode="word">
            <span style={{ fg: theme.text.action.primary.base }}>{frame()}</span> {props.waiting}{" "}
            {elapsedLabel(props.startedAt, now())}
          </text>
        }
      >
        {(view) => (
          <>
            <Show when={view().note}>
              {(note) => (
                <text fg={theme.text.feedback.warning.base} wrapMode="word">
                  {note()}
                </text>
              )}
            </Show>
            <scrollbox maxHeight={SUMMARY_HEIGHT}>
              <MarkdownText content={view().markdown} />
            </scrollbox>
          </>
        )}
      </Show>
      <text wrapMode="none" onMouseUp={props.close}>
        <span style={{ fg: theme.text.base }}>esc</span>
        <span style={{ fg: theme.text.faint }}> close</span>
      </text>
    </box>
  )
}
