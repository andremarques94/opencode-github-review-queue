/** @jsxImportSource @opentui/solid */

import { usePlugin } from "@opencode/plugin/tui"
import { createEffect, Show } from "solid-js"
import type { ReviewDraft } from "../../../../domain/review-draft.js"
import { reviewProgress } from "../../../../shared/review/draft-status.js"
import { createFlowHost } from "../../actions/flow-host.js"
import { attempting, postDraft } from "../../actions/review-actions.js"
import { FINDINGS_PANEL } from "./findings-panel.js"

export function ReviewStatus(props: { sessionID: string; draft: ReviewDraft; reload(): void }) {
  const context = usePlugin()
  const theme = context.theme
  const progress = () => reviewProgress(props.draft)
  const post = () =>
    attempting(context)(async () => {
      await postDraft(context, createFlowHost(context), props.draft)
      props.reload()
    }, "Could not post the review")

  // The agent records decisions in the review session's own plugin instance, whose events may not reach this
  // client, so re-read drafts whenever the session's state, messages, or open questions change.
  createEffect(() => {
    const data = context.data.session
    data.status(props.sessionID)
    data.message.list(props.sessionID).length
    data.form.list(props.sessionID)?.length
    props.reload()
  })

  return (
    <box flexDirection="row" gap={2} paddingLeft={1} paddingRight={1} overflow="hidden">
      <text wrapMode="none" truncate>
        <span style={{ fg: theme.text.action.primary.base }}>Review</span>
        <span style={{ fg: progress().tone === "success" ? theme.text.feedback.success.base : theme.text.muted }}>
          {" "}
          {progress().label}
        </span>
      </text>
      <text wrapMode="none" fg={theme.text.base} onMouseUp={() => context.ui.panel.open(FINDINGS_PANEL)}>
        findings
      </text>
      <Show when={props.draft.status !== "posted"}>
        <text
          wrapMode="none"
          fg={progress().blocker ? theme.text.faint : theme.text.base}
          onMouseUp={() => void post()}
        >
          post review…
        </text>
      </Show>
    </box>
  )
}
