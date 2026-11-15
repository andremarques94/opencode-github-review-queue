import type { Context } from "@opencode/plugin/gui"
import { Show } from "solid-js"
import type { SummaryView } from "../../../shared/review/summary.js"
import { dialogStyles } from "./styles.js"

export function showSummary(context: Context, view: SummaryView): void {
  context.dialogs.open((dialog) => (
    <context.ui.Dialog
      title={view.title}
      size="large"
      footer={
        <context.ui.Button variant="ghost" onClick={dialog.close}>
          Close
        </context.ui.Button>
      }
    >
      <style>{dialogStyles}</style>
      <div class="grq-preview">
        <Show when={view.note}>{(note) => <div class="grq-preview-meta">{note()}</div>}</Show>
        <context.ui.Markdown text={view.markdown} />
      </div>
    </context.ui.Dialog>
  ))
}
