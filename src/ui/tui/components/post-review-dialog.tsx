/** @jsxImportSource @opentui/solid */

import { usePlugin } from "@opencode/plugin/tui"
import { For, Show } from "solid-js"
import { fitLine } from "../../../shared/presentation.js"
import { commentCount, type ReviewPreview } from "../../../shared/review/preview.js"
import { MarkdownText } from "./markdown-text.js"

// Above the panels' own `enter` bindings while the dialog is open.
const DIALOG_PRIORITY = 100
const COMMENT_LIST_HEIGHT = 12

/** The host's confirm dialog runs a long title into its `esc` hint and wraps the preview twice. */
export function confirmPost(context: ReturnType<typeof usePlugin>, preview: ReviewPreview): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (posted: boolean) => {
      if (!settled) {
        settled = true
        resolve(posted)
      }
    }
    const decide = (posted: boolean) => {
      finish(posted)
      context.ui.dialog.clear()
    }
    context.ui.dialog.show(
      () => <PostReviewDialog preview={preview} post={() => decide(true)} cancel={() => decide(false)} />,
      () => finish(false),
    )
    context.ui.dialog.set({ size: "large" })
  })
}

function PostReviewDialog(props: { preview: ReviewPreview; post(): void; cancel(): void }) {
  const context = usePlugin()
  const theme = context.theme
  context.keymap.layer(() => ({
    priority: DIALOG_PRIORITY,
    commands: [{ bind: "enter", run: props.post }],
  }))

  return (
    <box flexDirection="column" gap={1} paddingLeft={2} paddingRight={2} paddingBottom={1}>
      <text fg={theme.text.base}>
        <b>Post review</b>
      </text>
      <text fg={theme.text.muted} wrapMode="word">
        {props.preview.reference} · {props.preview.verdict} · {commentCount(props.preview.comments.length)}
      </text>
      <Show when={props.preview.summary}>{(summary) => <MarkdownText content={summary()} />}</Show>
      <Show when={props.preview.comments.length > 0}>
        <scrollbox maxHeight={COMMENT_LIST_HEIGHT}>
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
        </scrollbox>
      </Show>
      <box flexDirection="row" gap={2}>
        <text wrapMode="none" onMouseUp={props.post}>
          <span style={{ fg: theme.text.action.primary.base }}>enter</span>
          <span style={{ fg: theme.text.base }}> post review</span>
        </text>
        <text wrapMode="none" onMouseUp={props.cancel}>
          <span style={{ fg: theme.text.base }}>esc</span>
          <span style={{ fg: theme.text.faint }}> cancel</span>
        </text>
      </box>
    </box>
  )
}
