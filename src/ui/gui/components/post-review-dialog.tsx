import type { Context } from "@opencode/plugin/gui"
import { createSignal, For, onCleanup, Show } from "solid-js"
import type { ReviewSubmission, Verdict } from "../../../domain/review-draft.js"
import { commentCount, type ReviewPreview, VERDICT_LABELS } from "../../../shared/review/preview.js"
import { dialogStyles } from "./styles.js"

export function confirmPost(context: Context, preview: ReviewPreview): Promise<ReviewSubmission | undefined> {
  return new Promise((resolve) => {
    context.dialogs.open((dialog) => {
      const [summary, setSummary] = createSignal(preview.summary)
      const [verdict, setVerdict] = createSignal<Verdict>(preview.event)
      const finish = (review: ReviewSubmission | undefined) => {
        resolve(review)
        dialog.close()
      }
      onCleanup(() => resolve(undefined))
      return (
        <context.ui.Dialog
          title={preview.title}
          size="large"
          footer={
            <>
              <context.ui.Button variant="ghost" onClick={() => finish(undefined)}>
                Cancel
              </context.ui.Button>
              <context.ui.Button variant="contrast" onClick={() => finish({ verdict: verdict(), summary: summary() })}>
                Post review
              </context.ui.Button>
            </>
          }
        >
          <style>{dialogStyles}</style>
          <div class="grq-preview">
            <div class="grq-preview-meta">
              <span>{commentCount(preview.comments.length)}</span>
            </div>
            <label class="grq-preview-section">
              <span class="grq-preview-heading">Review state</span>
              <select
                class="grq-review-state"
                value={verdict()}
                onChange={(event) => setVerdict(event.currentTarget.value as Verdict)}
              >
                <For each={Object.entries(VERDICT_LABELS)}>
                  {([value, label]) => (
                    <option value={value} disabled={preview.ownPullRequest && value !== "COMMENT"}>
                      {label}
                    </option>
                  )}
                </For>
              </select>
            </label>
            <label class="grq-preview-section">
              <span class="grq-preview-heading">Final comment</span>
              <textarea
                class="grq-textarea"
                value={summary()}
                onInput={(event) => setSummary(event.currentTarget.value)}
              />
              <span class="grq-preview-help">Posted exactly as written. Editing here does not use the model.</span>
            </label>
            <Show when={summary()}>
              <section class="grq-preview-section">
                <h3 class="grq-preview-heading">Preview</h3>
                <context.ui.Markdown text={summary()} />
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
