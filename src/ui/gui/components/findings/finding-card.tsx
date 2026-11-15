import type { Context } from "@opencode/plugin/gui"
import { Show } from "solid-js"
import { commentBody, type Finding, findingLocation, type ReviewDraft } from "../../../../domain/review-draft.js"
import { DECISION_LABELS } from "../../../../shared/review/draft-status.js"
import type { FindingActions } from "../../actions/finding-actions.js"
import { showEvidence } from "../evidence-dialog.js"

export type FindingCardProps = {
  context: Context
  draft: ReviewDraft
  finding: Finding
  actions: FindingActions
}

export function FindingCard(props: FindingCardProps) {
  const editable = () => props.draft.status !== "posted"
  const decide = (decision: "keep" | "drop") => void props.actions.decide(props.draft, props.finding, decision)

  return (
    <article class="grq-finding" data-decision={props.finding.decision}>
      <div class="grq-finding-meta">
        <span>#{props.finding.id}</span>
        <span class="grq-finding-location" title={findingLocation(props.finding)}>
          {findingLocation(props.finding)}
        </span>
        <span class="grq-badge">{props.finding.severity}</span>
        <span>{props.finding.confidence} confidence</span>
        <span class={`grq-badge grq-badge-${props.finding.decision}`}>{DECISION_LABELS[props.finding.decision]}</span>
      </div>
      <props.context.ui.Markdown text={commentBody(props.finding)} />
      <div class="grq-actions">
        <Show when={editable()}>
          <props.context.ui.Button
            size="small"
            variant={props.finding.decision === "keep" ? "contrast" : "neutral"}
            icon="check"
            disabled={props.finding.decision === "keep"}
            onClick={() => decide("keep")}
          >
            Keep
          </props.context.ui.Button>
          <props.context.ui.Button
            size="small"
            variant="ghost"
            icon="trash"
            disabled={props.finding.decision === "drop"}
            onClick={() => decide("drop")}
          >
            Drop
          </props.context.ui.Button>
          <props.context.ui.Button
            size="small"
            variant="ghost"
            icon="edit"
            onClick={() => void props.actions.edit(props.draft, props.finding)}
          >
            Edit
          </props.context.ui.Button>
          <props.context.ui.Button
            size="small"
            variant="ghost"
            icon="help"
            onClick={() => void props.actions.ask(props.draft, props.finding)}
          >
            Ask
          </props.context.ui.Button>
        </Show>
        <Show when={props.finding.evidence}>
          <props.context.ui.Button
            size="small"
            variant="ghost"
            icon="eye"
            onClick={() => showEvidence(props.context, props.finding)}
          >
            Evidence
          </props.context.ui.Button>
        </Show>
      </div>
    </article>
  )
}
