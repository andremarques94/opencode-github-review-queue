/** @jsxImportSource @opentui/solid */

import type { PanelInput } from "@opencode/plugin/tui/context"
import { createMemo, createSignal, onCleanup, Show } from "solid-js"
import type { Store } from "solid-js/store"
import { reviewedFor } from "../../../domain/review-history.js"
import type { QueueSnapshot } from "../../../domain/review-queue.js"
import type { ReviewRequest } from "../../../domain/review-request.js"
import { filterItems, groupByRepository, pullRequestDetails, type QueueFilter } from "../../../shared/presentation.js"
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
  const [showDetails, setShowDetails] = createSignal(false)
  const [now, setNow] = createSignal(Date.now())
  onCleanup(watchClock(setNow))

  const view = createMemo(() =>
    hideSnoozed(filterItems(props.state, filter(), props.state.repository), props.state.snoozes, showSnoozed(), now()),
  )
  const groups = createMemo(() => groupByRepository(view().items))
  // The "current" scope shows no repository headers, so nothing there can stay collapsed.
  const isCollapsed = (repository: string) =>
    filter() !== "current" && props.state.collapsed.includes(repository.toLowerCase())
  const collapsed = createMemo(() =>
    groups()
      .map((group) => group.repository)
      .filter(isCollapsed),
  )
  const ordered = createMemo(() => groups().flatMap((group) => (isCollapsed(group.repository) ? [] : group.items)))
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
    showDetails,
    setShowDetails,
    collapsed,
  })
  const label = (item: ReviewRequest) => rowLabel(item, props.state, now())
  const details = () => {
    const item = current()
    return showDetails() && item
      ? pullRequestDetails(item, reviewedFor(props.state.reviewed, item.key), now())
      : undefined
  }

  return (
    <box flexDirection="column" flexGrow={1} paddingTop={1} paddingLeft={1} paddingRight={1}>
      <PanelHeader
        state={props.state}
        filter={filter()}
        count={view().items.length}
        view={view()}
        showSnoozed={showSnoozed()}
        actions={actions}
      />
      <Show when={props.state.error}>{(error) => <ErrorLine message={error().message} />}</Show>
      <Show
        when={groups().length > 0}
        fallback={<EmptyState state={props.state} filter={filter()} snoozed={view().snoozed} />}
      >
        <ReviewList
          groups={groups()}
          grouped={filter() !== "current"}
          collapsed={collapsed()}
          selectedKey={current()?.key}
          newKeys={props.state.newKeys}
          label={label}
          details={details()}
          width={props.panel.width - ROW_INSET}
          actions={actions}
        />
      </Show>
      <KeyHints
        hints={[
          { key: "enter", label: "review", run: actions.review },
          { key: "d", label: showDetails() ? "hide details" : "details", run: actions.toggleDetails },
          { key: "m", label: "actions", run: actions.menu },
        ]}
      />
    </box>
  )
}
