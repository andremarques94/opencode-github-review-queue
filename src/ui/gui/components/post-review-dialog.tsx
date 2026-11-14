import type { Context } from "@opencode/plugin/gui"
import { For, onCleanup, Show } from "solid-js"
import { commentCount, type ReviewPreview } from "../../../shared/review/preview.js"
import { dialogStyles } from "./styles.js"

export function confirmPost(context: Context, preview: ReviewPreview): Promise<boolean> {
  return new Promise((resolve) => {
    context.dialogs.open((dialog) => {
      const finish = (confirmed: boolean) => {
        resolve(confirmed)
        dialog.close()
      }
      onCleanup(() => resolve(false))
      return (
        <context.ui.Dialog
          title={preview.title}
          size="large"
          footer={
            <>
              <context.ui.Button variant="ghost" onClick={() => finish(false)}>
                Cancel
              </context.ui.Button>
              <context.ui.Button variant="contrast" onClick={() => finish(true)}>
                Post review
              </context.ui.Button>
            </>
          }
        >
          <style>{dialogStyles}</style>
          <div class="grq-preview">
            <div class="grq-preview-meta">
              <span class="grq-badge grq-badge-review">{preview.verdict}</span>
              <span>{commentCount(preview.comments.length)}</span>
            </div>
            <Show when={preview.summary}>
              <section class="grq-preview-section">
                <h3 class="grq-preview-heading">Summary</h3>
                <context.ui.Markdown text={preview.summary} />
              </section>
            </Show>
            <Show when={preview.comments.length > 0}>
              <section class="grq-preview-section">
                <h3 class="grq-preview-heading">Inline comments</h3>
                <For each={preview.comments}>
                  {(comment) => (
                    <article class="grq-preview-comment">
                      <div class="grq-preview-location">{comment.location}</div>
                      <context.ui.Markdown text={comment.body} />
                    </article>
                  )}
                </For>
              </section>
            </Show>
          </div>
        </context.ui.Dialog>
      )
    })
  })
}
