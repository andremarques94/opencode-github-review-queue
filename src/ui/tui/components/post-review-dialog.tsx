/** @jsxImportSource @opentui/solid */

import { usePlugin } from "@opencode/plugin/tui"
import { useTerminalDimensions } from "@opentui/solid"
import { For, Show } from "solid-js"
import type { ReviewSubmission, Verdict } from "../../../domain/review-draft.js"
import { fitLine } from "../../../shared/presentation.js"
import { commentCount, type ReviewPreview, VERDICT_LABELS } from "../../../shared/review/preview.js"
import { editFindingBody } from "./findings/edit-finding-dialog.js"
import { KeyHints } from "./key-hints.js"
import { MarkdownText } from "./markdown-text.js"

// Above the panels' own `enter` bindings while the dialog is open.
const DIALOG_PRIORITY = 100

/** The host's confirm dialog runs a long title into its `esc` hint and wraps the preview twice. */
export async function confirmPost(
  context: ReturnType<typeof usePlugin>,
  preview: ReviewPreview,
): Promise<ReviewSubmission | undefined> {
  let review: ReviewSubmission = { verdict: preview.event, summary: preview.summary }
  while (true) {
    const action = await postAction(context, {
      ...preview,
      event: review.verdict,
      verdict: VERDICT_LABELS[review.verdict],
      summary: review.summary,
    })
    switch (action) {
      case "cancel":
        return undefined
      case "post":
        return review
      case "edit": {
        const summary = await editFindingBody(context, {
          title: "Edit final comment",
          body: review.summary,
          allowEmpty: true,
          saveLabel: "save comment",
        })
        if (summary !== undefined) {
          review = { ...review, summary }
        }
        break
      }
      case "state": {
        const verdict = await context.ui.dialog.select<Verdict>({
          title: "Review state",
          current: review.verdict,
          options: (Object.keys(VERDICT_LABELS) as Verdict[])
            .filter((value) => !preview.ownPullRequest || value === "COMMENT")
            .map((value) => ({ title: VERDICT_LABELS[value], value })),
        })
        if (verdict) {
          review = { ...review, verdict }
        }
        break
      }
    }
  }
}

type PostAction = "post" | "cancel" | "edit" | "state"

function postAction(context: ReturnType<typeof usePlugin>, preview: ReviewPreview): Promise<PostAction> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (action: PostAction) => {
      if (!settled) {
        settled = true
        resolve(action)
      }
    }
    const decide = (action: PostAction) => {
      finish(action)
      context.ui.dialog.clear()
    }
    context.ui.dialog.show(
      () => <PostReviewDialog preview={preview} decide={decide} />,
      () => finish("cancel"),
    )
    context.ui.dialog.set({ size: "large" })
  })
}

function PostReviewDialog(props: { preview: ReviewPreview; decide(action: PostAction): void }) {
  const context = usePlugin()
  const theme = context.theme
  const dimensions = useTerminalDimensions()
  context.keymap.layer(() => ({
    priority: DIALOG_PRIORITY,
    commands: [
      { bind: "enter", run: () => props.decide("post") },
      { bind: "e", run: () => props.decide("edit") },
      { bind: "s", run: () => props.decide("state") },
    ],
  }))

  return (
    <box flexDirection="column" gap={1} paddingLeft={2} paddingRight={2} paddingBottom={1}>
      <text fg={theme.text.base}>
        <b>Post review</b>
      </text>
      <text fg={theme.text.muted} wrapMode="word">
        {props.preview.reference} · {props.preview.verdict} · {commentCount(props.preview.comments.length)}
      </text>
      <scrollbox maxHeight={Math.max(3, dimensions().height - 12)}>
        <Show when={props.preview.summary}>{(summary) => <MarkdownText content={summary()} />}</Show>
        <Show when={props.preview.comments.length > 0}>
          <For each={props.preview.comments}>
            {(comment, index) => (
              <box flexDirection="column" marginTop={Math.min(index(), 1)}>
                <text fg={theme.text.muted} wrapMode="none">
                  {comment.location}
                </text>
                <text fg={theme.text.base} wrapMode="none">
                  {fitLine(comment.body, Number.POSITIVE_INFINITY)}
                </text>
              </box>
            )}
          </For>
        </Show>
      </scrollbox>
      <KeyHints
        hints={[
          { key: "e", label: "edit comment", run: () => props.decide("edit") },
          { key: "s", label: "review state", run: () => props.decide("state") },
          { key: "enter", label: "post review", run: () => props.decide("post") },
          { key: "esc", label: "cancel", run: () => props.decide("cancel") },
        ]}
      />
    </box>
  )
}
