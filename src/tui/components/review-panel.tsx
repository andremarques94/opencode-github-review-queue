/** @jsxImportSource @opentui/solid */
import { usePlugin } from "@opencode/plugin/tui"
import type { PanelInput } from "@opencode/plugin/tui/context"
import { createMemo, createSignal, For, Show } from "solid-js"
import type { Store } from "solid-js/store"
import type { QueueSnapshot, ReviewRequest } from "../../domain/review-queue.js"
import { ReviewQueue } from "../../rpc/review-queue.js"
import { ago, filterItems, fullReference, type QueueFilter, refreshLabel } from "../../shared/presentation.js"
import type { TuiState } from "../state.js"

interface ReviewPanelProps {
  panel: PanelInput
  state: Store<TuiState>
  update(state: QueueSnapshot): void
}

export function ReviewPanel(props: ReviewPanelProps) {
  const context = usePlugin()
  const rpc = context.client.rpc(ReviewQueue)
  const [filter, setFilter] = createSignal<QueueFilter>("all")
  const [selected, setSelected] = createSignal(0)
  const items = createMemo(() => filterItems(props.state.items, filter(), props.state.repository))
  const current = () => items()[Math.min(selected(), Math.max(0, items().length - 1))]

  const copy = (value: string, label: string) => {
    const copied = context.renderer.copyToClipboardOSC52(value)
    context.ui.toast.show({
      message: copied ? `${label} copied` : "Terminal clipboard is unavailable",
      variant: copied ? "success" : "warning",
    })
  }
  const refresh = async () => {
    props.update((await rpc.refresh({})) as unknown as QueueSnapshot)
  }
  const open = async (item: ReviewRequest | undefined) => {
    if (!item) {
      return
    }
    try {
      await rpc.open({ key: item.key })
    } catch (error) {
      context.ui.toast.show({
        message: error instanceof Error ? error.message : "Could not open pull request",
        variant: "error",
      })
    }
  }

  context.keymap.layer(() => ({
    commands: [
      {
        id: "github-review-queue.next",
        title: "Next review request",
        bind: "j",
        run: () => setSelected((value) => Math.min(value + 1, items().length - 1)),
      },
      {
        id: "github-review-queue.previous",
        title: "Previous review request",
        bind: "k",
        run: () => setSelected((value) => Math.max(0, value - 1)),
      },
      { id: "github-review-queue.open", title: "Open pull request", bind: "enter", run: () => open(current()) },
      {
        id: "github-review-queue.copy-number",
        title: "Copy PR number",
        bind: "c",
        run: () => {
          const item = current()
          if (item) {
            copy(String(item.number), "PR number")
          }
        },
      },
      {
        id: "github-review-queue.copy-reference",
        title: "Copy qualified PR reference",
        bind: "y",
        run: () => {
          const item = current()
          if (item) {
            copy(fullReference(item), "PR reference")
          }
        },
      },
      {
        id: "github-review-queue.copy-url",
        title: "Copy PR URL",
        bind: "u",
        run: () => {
          const item = current()
          if (item) {
            copy(item.url, "PR URL")
          }
        },
      },
      {
        id: "github-review-queue.filter",
        title: "Toggle repository filter",
        bind: "f",
        run: () => {
          setFilter((value) => (value === "all" ? "current" : "all"))
          setSelected(0)
        },
      },
      { id: "github-review-queue.refresh", title: "Refresh review queue", bind: "r", run: refresh },
      {
        id: "github-review-queue.fullscreen",
        title: "Toggle panel fullscreen",
        bind: "shift+f",
        run: props.panel.toggleFullscreen,
      },
      { bind: "escape", run: props.panel.close },
    ],
  }))

  return (
    <box flexDirection="column" padding={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={context.theme.text.base}>
          <b>Review requests ({items().length})</b>
        </text>
        <text fg={context.theme.text.muted}>
          {filter() === "all" ? "all repositories" : (props.state.repository ?? "not a repository")}
        </text>
      </box>
      <Show when={props.state.loading}>
        <text fg={context.theme.text.muted}>Refreshing GitHub…</text>
      </Show>
      <Show when={props.state.error}>
        <text fg={context.theme.text.warning}>
          {props.state.stale ? "STALE · " : ""}
          {props.state.error?.message}
        </text>
      </Show>
      <Show when={!props.state.loading && items().length === 0}>
        <text fg={context.theme.text.muted}>
          {props.state.initialized ? "No pending review requests." : "Waiting for the first successful GitHub refresh."}
        </text>
      </Show>
      <box flexDirection="column">
        <For each={items()}>
          {(item, index) => (
            <box
              flexDirection="column"
              paddingLeft={1}
              backgroundColor={index() === selected() ? context.theme.background.element : undefined}
            >
              <text fg={context.theme.text.base}>
                {index() === selected() ? "› " : "  "}
                {props.state.newKeys.includes(item.key) ? "● " : ""}
                <b>
                  {item.repository} #{item.number}
                </b>
                {item.draft ? " · DRAFT" : ""}
              </text>
              <text fg={context.theme.text.base}> {item.title}</text>
              <text fg={context.theme.text.muted}>
                {" "}
                @{item.author} · {ago(item.createdAt)}
              </text>
            </box>
          )}
        </For>
      </box>
      <text fg={context.theme.text.muted}>
        {refreshLabel(props.state)} · j/k select · enter open · c number · y repo#PR · u URL · f filter · r refresh
      </text>
    </box>
  )
}
