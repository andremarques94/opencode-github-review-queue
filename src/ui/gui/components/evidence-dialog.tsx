import type { Context } from "@opencode/plugin/gui"
import { type Finding, findingLocation } from "../../../domain/review-draft.js"
import { escapeInlineFences } from "../../../shared/presentation.js"
import { dialogStyles } from "./styles.js"

export function showEvidence(context: Context, finding: Finding): void {
  context.dialogs.open((dialog) => (
    <context.ui.Dialog
      title={`Evidence for finding #${finding.id}`}
      description={`${findingLocation(finding)} · ${finding.severity} · ${finding.confidence} confidence`}
      size="large"
      footer={
        <context.ui.Button variant="ghost" onClick={dialog.close}>
          Close
        </context.ui.Button>
      }
    >
      <style>{dialogStyles}</style>
      <div class="grq-preview">
        <context.ui.Markdown text={escapeInlineFences(finding.evidence)} />
      </div>
    </context.ui.Dialog>
  ))
}
