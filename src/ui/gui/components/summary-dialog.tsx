import type { Context } from "@opencode/plugin/gui"
import { createSignal, onCleanup, Show } from "solid-js"
import { elapsedLabel } from "../../../shared/presentation.js"
import type { PendingSummary, SummaryView } from "../../../shared/review/summary.js"
import { dialogStyles } from "./styles.js"

/** Opens at once with a loader, so the click shows it worked while the model reads the pull request. */
export function openSummary(context: Context, input: { title: string; waiting: string }): PendingSummary {
  const [view, setView] = createSignal<SummaryView>()
  const startedAt = Date.now()
  let close: (() => void) | undefined
  const open = () =>
    context.dialogs.open((dialog) => {
      close = dialog.close
      onCleanup(() => {
        close = undefined
      })
      return (
        <SummaryDialog
          context={context}
          title={input.title}
          waiting={input.waiting}
          view={view()}
          startedAt={startedAt}
          close={dialog.close}
        />
      )
    })
  open()
  return {
    show(next) {
      setView(next)
      if (!close) {
        open()
      }
    },
    close: () => close?.(),
  }
}

function SummaryDialog(props: {
  context: Context
  title: string
  waiting: string
  view: SummaryView | undefined
  startedAt: number
  close(): void
}) {
  const [now, setNow] = createSignal(Date.now())
  const timer = setInterval(() => setNow(Date.now()), 1_000)
  onCleanup(() => clearInterval(timer))

  return (
    <props.context.ui.Dialog
      title={props.title}
      size="large"
      footer={
        <props.context.ui.Button variant="ghost" onClick={props.close}>
          Close
        </props.context.ui.Button>
      }
    >
      <style>{dialogStyles}</style>
      <Show
        when={props.view}
        fallback={
          <div class="grq-preview-meta">
            <props.context.ui.Loader />
            <span>
              {props.waiting} {elapsedLabel(props.startedAt, now())}
            </span>
          </div>
        }
      >
        {(view) => (
          <div class="grq-preview">
            <Show when={view().note}>{(note) => <div class="grq-preview-meta">{note()}</div>}</Show>
            <props.context.ui.Markdown text={view().markdown} />
          </div>
        )}
      </Show>
    </props.context.ui.Dialog>
  )
}
