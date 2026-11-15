import type { Context, MountedSession, SessionScreen } from "@opencode/plugin/gui"
import { For, Show } from "solid-js"
import { type ReviewDraft, walkthroughOrder } from "../../../../domain/review-draft.js"
import type { FindingActions } from "../../actions/finding-actions.js"
import { findingStyles } from "../styles.js"
import { FindingCard } from "./finding-card.js"
import { OpenWorktree } from "./open-worktree.js"
import { ReviewProgress } from "./review-progress.js"

export function FindingsPanel(props: {
  context: Context
  session: MountedSession
  screen: SessionScreen
  draft: ReviewDraft | undefined
  actions: FindingActions
}) {
  const comments = () => props.screen.comment.list()
  return (
    <section class="grq-findings">
      <style>{findingStyles}</style>
      <Show
        when={props.draft}
        fallback={<div class="grq-findings-header grq-muted">This session has no review draft.</div>}
      >
        {(draft) => (
          <>
            <header class="grq-findings-header">
              <div class="grq-findings-heading">
                <div class="grq-findings-title">
                  {draft().repository}#{draft().number} · {draft().title}
                </div>
                <Show when={draft().status !== "posted"}>
                  <OpenWorktree context={props.context} session={props.session} screen={props.screen} />
                </Show>
              </div>
              <ReviewProgress context={props.context} draft={draft()} actions={props.actions} />
              <Show when={draft().status !== "posted" && comments().length > 0}>
                <div class="grq-actions">
                  <span class="grq-muted">
                    {comments().length === 1 ? "1 line comment" : `${comments().length} line comments`} on the code
                  </span>
                  <props.context.ui.Tooltip value="Ask the agent to investigate each marked line and record a finding there">
                    <props.context.ui.Button
                      size="small"
                      variant="neutral"
                      onClick={() =>
                        void props.actions.addLineComments(draft(), comments(), (id) => props.screen.comment.remove(id))
                      }
                    >
                      Add as findings
                    </props.context.ui.Button>
                  </props.context.ui.Tooltip>
                </div>
              </Show>
            </header>
            <div class="grq-findings-list">
              <For
                each={walkthroughOrder(draft())}
                fallback={
                  <div class="grq-muted">
                    {draft().status === "investigating" ? "The agent is still investigating." : "No findings."}
                  </div>
                }
              >
                {(finding) => (
                  <FindingCard context={props.context} draft={draft()} finding={finding} actions={props.actions} />
                )}
              </For>
            </div>
          </>
        )}
      </Show>
    </section>
  )
}
