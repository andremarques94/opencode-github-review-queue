import type { Context } from "@opencode/plugin/gui"
import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js"
import type { Store } from "solid-js/store"
import type { QueueSnapshot } from "../../../domain/review-queue.js"
import { filterItems, groupByRepository, type QueueFilter } from "../../../shared/presentation.js"
import { hideSnoozed, watchClock } from "../../../shared/review/snooze.js"
import { type LocalReviews, ReviewQueue } from "../../../shared/rpc.js"
import { createReviewActions } from "../actions/review-actions.js"
import { EmptyState } from "./feedback/empty-state.js"
import { ErrorBanner } from "./feedback/error-banner.js"
import { PanelHeader } from "./header/panel-header.js"
import { ReviewList } from "./list/review-list.js"
import { panelStyles } from "./styles.js"

export type ReviewPanelProps = {
  context: Context
  directory: string | undefined
  server: string
  local: LocalReviews
  updateLocal(local: LocalReviews): void
  repositories: Map<string, string | undefined>
  state: Store<QueueSnapshot>
  update(snapshot: QueueSnapshot): void
}

export function ReviewPanel(props: ReviewPanelProps) {
  const [filter, setFilter] = createSignal<QueueFilter>("all")
  const [showSnoozed, setShowSnoozed] = createSignal(false)
  /** Kept here rather than in each row, so the header can open or close them all. */
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set())
  const [now, setNow] = createSignal(Date.now())
  onCleanup(watchClock(setNow))
  const [repository, setRepository] = createSignal<string | undefined>()
  const rpc = () => props.context.client.rpc(ReviewQueue)
  const actions = createReviewActions({
    context: props.context,
    server: () => props.server,
    directory: () => props.directory,
    updateLocal: (local) => props.updateLocal(local),
  })

  createEffect(() => {
    const directory = props.directory
    if (!directory) {
      setRepository(undefined)
      return
    }
    if (props.repositories.has(directory)) {
      setRepository(props.repositories.get(directory))
      return
    }
    void rpc()
      .repository({ directory })
      .then((result) => {
        const value = result.repository ?? undefined
        props.repositories.set(directory, value)
        setRepository(value)
      })
  })

  const view = createMemo(() =>
    hideSnoozed(filterItems(props.state, filter(), repository()), props.local.snoozes, showSnoozed(), now()),
  )
  const details = {
    isOpen: (key: string) => expanded().has(key),
    toggle: (key: string) =>
      setExpanded((current) => {
        const next = new Set(current)
        if (!next.delete(key)) {
          next.add(key)
        }
        return next
      }),
    setAll: (keys: readonly string[], open: boolean) =>
      setExpanded((current) => {
        const next = new Set(current)
        for (const key of keys) {
          if (open) {
            next.add(key)
          } else {
            next.delete(key)
          }
        }
        return next
      }),
  }
  const grouped = () => filter() !== "current"
  const repositories = () => groupByRepository(view().items).map((group) => group.repository)
  const anyRepositoryOpen = () => repositories().some((name) => !props.local.collapsed.includes(name.toLowerCase()))
  const anyDetails = () => view().items.some((item) => expanded().has(item.key))
  // With repository headers the button folds repositories; without them (one repository) it folds row details.
  const expandAll = () => {
    if (view().items.length === 0) {
      return undefined
    }
    if (!grouped()) {
      const open = anyDetails()
      return {
        expanded: open,
        label: open ? "Hide all details" : "Show all details",
        toggle: () =>
          details.setAll(
            view().items.map((item) => item.key),
            !open,
          ),
      }
    }
    const open = anyRepositoryOpen()
    return {
      expanded: open,
      label: open ? "Collapse all repositories" : "Expand all repositories",
      toggle: () => void actions.collapseAll(repositories(), open),
    }
  }
  const refresh = () => {
    void rpc()
      .refresh({})
      .then((snapshot) => props.update(snapshot))
  }
  const copy = (text: string, name: string) => {
    void props.context.system
      .copy(text)
      .then(() => props.context.toast.show({ variant: "success", title: `${name} copied`, description: text }))
      .catch(() => props.context.toast.show({ variant: "error", title: `Could not copy ${name.toLowerCase()}` }))
  }

  return (
    <section class="grq">
      <style>{panelStyles}</style>
      <PanelHeader
        context={props.context}
        state={props.state}
        count={view().items.length}
        view={view()}
        showSnoozed={showSnoozed()}
        toggleSnoozed={() => setShowSnoozed((shown) => !shown)}
        filter={filter()}
        repository={repository()}
        setFilter={setFilter}
        refresh={refresh}
        expandAll={expandAll()}
      />
      <Show when={props.state.error}>{(error) => <ErrorBanner message={error().message} />}</Show>
      <Show
        when={view().items.length > 0}
        fallback={<EmptyState context={props.context} state={props.state} filter={filter()} snoozed={view().snoozed} />}
      >
        <ReviewList
          context={props.context}
          items={view().items}
          newKeys={props.state.newKeys}
          local={props.local}
          now={now()}
          actions={actions}
          grouped={grouped()}
          details={details}
          copy={copy}
        />
      </Show>
    </section>
  )
}
