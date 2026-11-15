/** @jsxImportSource @opentui/solid */

import type { PanelInput } from "@opencode/plugin/tui/context"
import { createMemo, createSignal, onCleanup, Show } from "solid-js"
import type { Store } from "solid-js/store"
import type { QueueSnapshot } from "../../../domain/review-queue.js"
import type { ReviewRequest } from "../../../domain/review-request.js"
import { filterItems, groupByRepository, type QueueFilter } from "../../../shared/presentation.js"
import { rowLabel } from "../../../shared/review/draft-status.js"
import { hideSnoozed, watchClock } from "../../../shared/review/snooze.js"
import type { LocalReviews } from "../../../shared/rpc.js"
import { useReviewActions } from "../actions/review-actions.js"
import type { TuiState } from "../state.js"
import { EmptyState } from "./feedback/empty-state.js"
import { ErrorLine } from "./feedback/error-line.js"
import { PanelHeader } from "./header/panel-header.js"
import { KeyHints } from "./key-hints.js"
import { ReviewList } from "./list/review-list.js"

export type ReviewPanelProps = {
  panel: PanelInput
  state: Store<TuiState>
  update(state: QueueSnapshot): void
  updateLocal(local: LocalReviews): void
}

// Columns the panel's padding, a row's selection bar, and its right padding take from the title.
const ROW_INSET = 5

export function ReviewPanel(props: ReviewPanelProps) {
  const [filter, setFilter] = createSignal<QueueFilter>("all")
  const [selected, setSelected] = createSignal(0)
  const [showSnoozed, setShowSnoozed] = createSignal(false)
  const [now, setNow] = createSignal(Date.now())
  onCleanup(watchClock(setNow))

  const view = createMemo(() =>
    hideSnoozed(
      filterItems(props.state.items, filter(), props.state.repository),
      props.state.snoozes,
      showSnoozed(),
      now(),
    ),
  )
  const groups = createMemo(() => groupByRepository(view().items))
  const ordered = createMemo(() => groups().flatMap((group) => group.items))
  const current = () => ordered()[Math.min(selected(), Math.max(0, ordered().length - 1))]
  const actions = useReviewActions({
    panel: props.panel,
    update: props.update,
    updateLocal: props.updateLocal,
    ordered,
    current,
    local: () => props.state,
    now,
    setSelected,
    filter,
    setFilter,
    snoozed: () => view().snoozed,
    showSnoozed,
    setShowSnoozed,
  })
  const label = (item: ReviewRequest) => rowLabel(item, props.state, now())

  return (
    <box flexDirection="column" flexGrow={1} paddingTop={1} paddingLeft={1} paddingRight={1}>
      <PanelHeader
        state={props.state}
        filter={filter()}
        count={ordered().length}
        view={view()}
        showSnoozed={showSnoozed()}
        actions={actions}
      />
      <Show when={props.state.error}>{(error) => <ErrorLine message={error().message} />}</Show>
      <Show
        when={ordered().length > 0}
        fallback={<EmptyState state={props.state} filter={filter()} snoozed={view().snoozed} />}
      >
        <ReviewList
          groups={groups()}
          grouped={filter() === "all"}
          selectedKey={current()?.key}
          newKeys={props.state.newKeys}
          label={label}
          width={props.panel.width - ROW_INSET}
          actions={actions}
        />
      </Show>
      <KeyHints
        hints={[
          { key: "enter", label: "review", run: actions.review },
          { key: "m", label: "actions", run: actions.menu },
        ]}
      />
    </box>
  )
}
