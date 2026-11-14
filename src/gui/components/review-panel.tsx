import type { Context } from "@opencode/plugin/gui"
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import type { Store } from "solid-js/store"
import type { QueueSnapshot, ReviewRequest } from "../../domain/review-queue.js"
import { ReviewQueue } from "../../rpc/review-queue.js"
import { filterItems, groupByRepository, type QueueFilter, refreshLabel } from "../../shared/presentation.js"
import { ReviewRow } from "./review-row.js"
import { panelStyles } from "./styles.js"

interface ReviewPanelProps {
  context: Context
  directory: string | undefined
  repositories: Map<string, string | undefined>
  state: Store<QueueSnapshot>
  update(snapshot: QueueSnapshot): void
}

export function ReviewPanel(props: ReviewPanelProps) {
  const [filter, setFilter] = createSignal<QueueFilter>("all")
  const [repository, setRepository] = createSignal<string | undefined>()
  const rpc = () => props.context.client.rpc(ReviewQueue)

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
        const value = (result as { repository: string | null }).repository ?? undefined
        props.repositories.set(directory, value)
        setRepository(value)
      })
  })

  const items = createMemo(() => filterItems(props.state.items, filter(), repository()))
  const refresh = () => {
    void rpc()
      .refresh({})
      .then((snapshot) => props.update(snapshot as unknown as QueueSnapshot))
  }
  const copy = (text: string, name: string) => {
    void props.context.system
      .copy(text)
      .then(() => props.context.toast.show({ variant: "success", title: `${name} copied`, description: text }))
  }

  return (
    <section class="grq">
      <style>{panelStyles}</style>
      <PanelHeader
        context={props.context}
        state={props.state}
        count={items().length}
        filter={filter()}
        repository={repository()}
        setFilter={setFilter}
        refresh={refresh}
      />
      <Show when={props.state.error}>
        <div class="grq-banner">{props.state.error?.message}</div>
      </Show>
      <Show
        when={items().length > 0}
        fallback={<EmptyState context={props.context} state={props.state} filter={filter()} />}
      >
        <GroupedList
          context={props.context}
          items={items()}
          newKeys={props.state.newKeys}
          grouped={filter() === "all"}
          copy={copy}
        />
      </Show>
    </section>
  )
}

function PanelHeader(props: {
  context: Context
  state: Store<QueueSnapshot>
  count: number
  filter: QueueFilter
  repository: string | undefined
  setFilter(filter: QueueFilter): void
  refresh(): void
}) {
  const status = () => {
    const scope = props.filter === "current" ? props.repository?.split("/").pop() : undefined
    return [refreshLabel(props.state), scope].filter(Boolean).join(" · ")
  }
  const segment = (value: QueueFilter, label: string, disabled = false) => (
    <button
      type="button"
      class="grq-segment-button"
      aria-pressed={props.filter === value}
      disabled={disabled}
      title={disabled ? "This session is not in a GitHub repository" : undefined}
      onClick={() => props.setFilter(value)}
    >
      {label}
    </button>
  )

  return (
    <header class="grq-header">
      <div class="grq-header-top">
        <div class="grq-heading">
          <span>Review requests</span>
          <span class="grq-count">{props.count}</span>
        </div>
        <div class="grq-tools">
          <fieldset class="grq-segment" aria-label="Scope">
            {segment("current", "Current", !props.repository)}
            {segment("all", "All")}
          </fieldset>
          <props.context.ui.Tooltip value="Refresh">
            <props.context.ui.IconButton
              icon="outline-rotate-clockwise"
              label="Refresh"
              size="small"
              busy={props.state.loading}
              onClick={props.refresh}
            />
          </props.context.ui.Tooltip>
        </div>
      </div>
      <div class="grq-status">
        {status()}
        <Show when={props.state.stale}>
          <span class="grq-status-stale"> · stale</span>
        </Show>
      </div>
    </header>
  )
}

function EmptyState(props: { context: Context; state: Store<QueueSnapshot>; filter: QueueFilter }) {
  const message = () => {
    if (!props.state.initialized) {
      return "Waiting for the first successful GitHub refresh."
    }
    return props.filter === "current" ? "No review requests in this repository." : "You're all caught up."
  }

  return (
    <div class="grq-empty">
      <Show
        when={props.state.loading && !props.state.initialized}
        fallback={
          <>
            <span class="grq-empty-icon">
              <props.context.ui.Icon name="github" />
            </span>
            <span>{message()}</span>
          </>
        }
      >
        <props.context.ui.Loader />
        <span>Loading review requests…</span>
      </Show>
    </div>
  )
}

function GroupedList(props: {
  context: Context
  items: ReviewRequest[]
  newKeys: readonly string[]
  grouped: boolean
  copy(text: string, name: string): void
}) {
  const groups = createMemo(() => groupByRepository(props.items))

  return (
    <div class="grq-list">
      <For each={groups()}>
        {(group) => (
          <section>
            <Show when={props.grouped}>
              <div class="grq-group" title={group.repository}>
                <span class="grq-group-name">
                  <Show when={group.owner}>
                    <span class="grq-group-owner">{group.owner} / </span>
                  </Show>
                  {group.name}
                </span>
                <span class="grq-group-count">{group.items.length}</span>
              </div>
            </Show>
            <For each={group.items}>
              {(item) => (
                <ReviewRow
                  context={props.context}
                  item={item}
                  isNew={props.newKeys.includes(item.key)}
                  copy={props.copy}
                />
              )}
            </For>
          </section>
        )}
      </For>
    </div>
  )
}
