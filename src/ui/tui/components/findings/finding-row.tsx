/** @jsxImportSource @opentui/solid */

import { usePlugin } from "@opencode/plugin/tui"
import { Show } from "solid-js"
import { commentBody, type Finding, findingLocation } from "../../../../domain/review-draft.js"
import { escapeInlineFences, fitLine } from "../../../../shared/presentation.js"
import type { FindingActions } from "../../actions/finding-actions.js"
import { MarkdownText } from "../markdown-text.js"

export const findingRowID = (id: number) => `github-review-queue:finding:${id}`

const DECISION_MARKS = { keep: "✓", drop: "✗", pending: "○" } as const

export function FindingRow(props: {
  finding: Finding
  index: number
  selected: boolean
  expanded: boolean
  width: number
  actions: FindingActions
}) {
  const theme = usePlugin().theme
  const colors = {
    keep: {
      mark: theme.text.feedback.success.base,
      location: theme.text.base,
      summary: theme.text.muted,
      body: "base",
    },
    drop: { mark: theme.text.faint, location: theme.text.faint, summary: theme.text.faint, body: "faint" },
    pending: {
      mark: theme.text.feedback.warning.base,
      location: theme.text.base,
      summary: theme.text.muted,
      body: "base",
    },
  } as const
  const color = () => colors[props.finding.decision]
  const look = () =>
    props.selected ? { background: theme.background.raised.base, bar: "▌" } : { background: undefined, bar: " " }
  const prefix = () => `${DECISION_MARKS[props.finding.decision]} #${props.finding.id} ${props.finding.severity} · `

  return (
    <box
      id={findingRowID(props.finding.id)}
      flexDirection="row"
      marginTop={Math.min(props.index, 1)}
      backgroundColor={look().background}
      onMouseDown={() => props.actions.select(props.finding.id)}
    >
      <text width={2} fg={theme.text.action.primary.base}>
        {look().bar}
      </text>
      <box flexDirection="column" flexGrow={1} paddingRight={1}>
        <text wrapMode="none">
          <span style={{ fg: color().mark }}>{DECISION_MARKS[props.finding.decision]}</span>
          <span style={{ fg: theme.text.muted }}>{prefix().slice(DECISION_MARKS[props.finding.decision].length)}</span>
          <span style={{ fg: color().location }}>
            {fitLine(findingLocation(props.finding), props.width - prefix().length)}
          </span>
        </text>
        <Show
          when={props.selected}
          fallback={
            <text wrapMode="none" fg={color().summary}>
              {fitLine(props.finding.body, props.width)}
            </text>
          }
        >
          <MarkdownText content={commentBody(props.finding)} tone={color().body} />
          <Show when={props.expanded && props.finding.evidence}>
            {(evidence) => (
              <box flexDirection="column" marginTop={1}>
                <text fg={theme.text.muted}>
                  <b>Evidence</b>
                </text>
                <MarkdownText content={escapeInlineFences(evidence())} tone="muted" />
              </box>
            )}
          </Show>
        </Show>
      </box>
    </box>
  )
}
