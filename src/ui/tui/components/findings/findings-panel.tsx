/** @jsxImportSource @opentui/solid */

import { usePlugin } from "@opencode/plugin/tui"
import type { PanelInput } from "@opencode/plugin/tui/context"
import type { ScrollBoxRenderable } from "@opentui/core"
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { type ReviewDraft, walkthroughOrder } from "../../../../domain/review-draft.js"
import { fitLine } from "../../../../shared/presentation.js"
import { reviewProgress } from "../../../../shared/review/draft-status.js"
import { useFindingActions } from "../../actions/finding-actions.js"
import { KeyHints } from "../key-hints.js"
import { FindingRow, findingRowID } from "./finding-row.js"

export const FINDINGS_PANEL = "github-review-queue.findings"

// Columns the panel's padding takes, and those plus a row's selection bar and right padding.
const PANEL_PADDING = 2
const ROW_INSET = PANEL_PADDING + 3

export function FindingsPanel(props: {
  panel: PanelInput
  draft: ReviewDraft | undefined
  update(draft: ReviewDraft): void
  reload(): void
}) {
  const theme = usePlugin().theme
  const [selected, setSelected] = createSignal(0)
  const [expanded, setExpanded] = createSignal<number | undefined>()
  const ordered = createMemo(() => (props.draft ? walkthroughOrder(props.draft) : []))
  const current = () => ordered()[Math.min(selected(), Math.max(0, ordered().length - 1))]
  const actions = useFindingActions({
    panel: props.panel,
    draft: () => props.draft,
    ordered,
    current,
    setSelected,
    setExpanded,
    update: props.update,
    reload: props.reload,
  })
  let scroll: ScrollBoxRenderable | undefined
  createEffect(() => {
    const id = current()?.id
    if (id !== undefined) {
      scroll?.scrollChildIntoView(findingRowID(id))
    }
  })

  return (
    <box flexDirection="column" flexGrow={1} paddingTop={1} paddingLeft={1} paddingRight={1}>
      <Show when={props.draft} fallback={<text fg={theme.text.muted}>This session has no review draft.</text>}>
        {(draft) => (
          <>
            <text fg={theme.text.base} wrapMode="none">
              {fitLine(`${draft().repository}#${draft().number} · ${draft().title}`, props.panel.width - PANEL_PADDING)}
            </text>
            <text fg={theme.text.muted} wrapMode="word">
              {reviewProgress(draft()).label}
              <Show when={draft().status !== "posted" && reviewProgress(draft()).blocker}>
                {(blocker) => <span style={{ fg: theme.text.faint }}> · {blocker()}</span>}
              </Show>
            </text>
            <scrollbox
              ref={(element: ScrollBoxRenderable) => {
                scroll = element
              }}
              flexGrow={1}
              marginTop={1}
            >
              <For
                each={ordered()}
                fallback={
                  <text fg={theme.text.muted}>
                    {draft().status === "investigating" ? "The agent is still investigating." : "No findings."}
                  </text>
                }
              >
                {(finding, index) => (
                  <FindingRow
                    finding={finding}
                    index={index()}
                    selected={current()?.id === finding.id}
                    expanded={expanded() === finding.id}
                    width={props.panel.width - ROW_INSET}
                    actions={actions}
                  />
                )}
              </For>
            </scrollbox>
            <KeyHints
              hints={[
                { key: "y", label: "keep", run: () => actions.decide("keep") },
                { key: "d", label: "drop", run: () => actions.decide("drop") },
                { key: "e", label: "edit", run: actions.edit },
                { key: "a", label: "ask", run: actions.ask },
                { key: "enter", label: "evidence", run: actions.toggleEvidence },
                { key: "p", label: "post", run: actions.post },
                { key: "shift+f", label: "full screen", run: props.panel.toggleFullscreen },
                { key: "esc", label: "close", run: props.panel.close },
              ]}
            />
          </>
        )}
      </Show>
    </box>
  )
}
