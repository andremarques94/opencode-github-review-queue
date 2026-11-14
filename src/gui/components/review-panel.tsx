import type { Context } from "@opencode/plugin/gui"
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import type { Store } from "solid-js/store"
import type { QueueSnapshot } from "../../domain/review-queue.js"
import { ReviewQueue } from "../../rpc/review-queue.js"
import { filterItems, type QueueFilter, refreshLabel } from "../../shared/presentation.js"
import { ReviewRow } from "./review-row.js"

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
      .then(() => props.context.toast.show({ variant: "success", title: `${name} copied` }))
  }

  return (
    <section class="flex h-full min-h-0 flex-col bg-background-base text-text-base">
      <header class="flex items-center justify-between gap-2 border-b border-border-base px-3 py-2">
        <div class="min-w-0">
          <div class="flex items-center gap-2 font-medium">
            <span>Pending reviews</span>
            <span class="text-text-muted">{items().length}</span>
          </div>
          <div class="truncate text-xs text-text-muted">
            {refreshLabel(props.state)}
            {props.state.stale ? " · stale" : ""}
          </div>
        </div>
        <div class="flex items-center gap-1">
          <props.context.ui.Button
            size="small"
            variant={filter() === "current" ? "neutral" : "ghost-muted"}
            disabled={!repository()}
            onClick={() => setFilter("current")}
          >
            Current
          </props.context.ui.Button>
          <props.context.ui.Button
            size="small"
            variant={filter() === "all" ? "neutral" : "ghost-muted"}
            onClick={() => setFilter("all")}
          >
            All
          </props.context.ui.Button>
          <props.context.ui.Tooltip value="Refresh">
            <props.context.ui.IconButton
              icon="outline-rotate-clockwise"
              label="Refresh"
              size="small"
              busy={props.state.loading}
              onClick={refresh}
            />
          </props.context.ui.Tooltip>
        </div>
      </header>

      <Show when={props.state.error}>
        <div class="border-b border-border-base bg-background-stronger px-3 py-2 text-xs text-text-muted">
          <span class="font-medium text-warning-base">{props.state.stale ? "Stale data: " : ""}</span>
          {props.state.error?.message}
        </div>
      </Show>
      <Show when={!props.state.loading && items().length === 0}>
        <div class="flex flex-1 items-center justify-center px-6 text-center text-sm text-text-muted">
          {props.state.initialized ? "No pending review requests." : "Waiting for the first successful GitHub refresh."}
        </div>
      </Show>
      <Show when={props.state.loading && !props.state.initialized}>
        <div class="flex flex-1 items-center justify-center gap-2 text-sm text-text-muted">
          <props.context.ui.Loader /> Loading review requests…
        </div>
      </Show>

      <div class="min-h-0 flex-1 overflow-y-auto">
        <For each={items()}>
          {(item) => (
            <ReviewRow context={props.context} item={item} isNew={props.state.newKeys.includes(item.key)} copy={copy} />
          )}
        </For>
      </div>
    </section>
  )
}
