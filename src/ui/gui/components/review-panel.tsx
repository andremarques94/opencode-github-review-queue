import type { Context } from "@opencode/plugin/gui"
import { createEffect, createMemo, createSignal, Show } from "solid-js"
import type { Store } from "solid-js/store"
import type { ReviewDraft } from "../../../domain/review-draft.js"
import type { QueueSnapshot } from "../../../domain/review-queue.js"
import { filterItems, type QueueFilter } from "../../../shared/presentation.js"
import { ReviewQueue } from "../../../shared/rpc.js"
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
  drafts: readonly ReviewDraft[]
  repositories: Map<string, string | undefined>
  state: Store<QueueSnapshot>
  update(snapshot: QueueSnapshot): void
}

export function ReviewPanel(props: ReviewPanelProps) {
  const [filter, setFilter] = createSignal<QueueFilter>("all")
  const [repository, setRepository] = createSignal<string | undefined>()
  const rpc = () => props.context.client.rpc(ReviewQueue)
  const actions = createReviewActions({
    context: props.context,
    server: () => props.server,
    directory: () => props.directory,
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

  const items = createMemo(() => filterItems(props.state.items, filter(), repository()))
  const refresh = () => {
    void rpc()
      .refresh({})
      .then((snapshot) => props.update(snapshot))
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
      <Show when={props.state.error}>{(error) => <ErrorBanner message={error().message} />}</Show>
      <Show
        when={items().length > 0}
        fallback={<EmptyState context={props.context} state={props.state} filter={filter()} />}
      >
        <ReviewList
          context={props.context}
          items={items()}
          newKeys={props.state.newKeys}
          drafts={props.drafts}
          actions={actions}
          grouped={filter() === "all"}
          copy={copy}
        />
      </Show>
    </section>
  )
}
