import { usePlugin } from "@opencode/plugin/tui"
import type { PanelInput } from "@opencode/plugin/tui/context"
import type { Accessor, Setter } from "solid-js"
import type { QueueSnapshot } from "../../domain/review-queue.js"
import type { ReviewRequest } from "../../domain/review-request.js"
import { fullReference, type QueueFilter } from "../../shared/presentation.js"
import { ReviewQueue } from "../../shared/rpc.js"

export type CopyKind = "number" | "reference" | "link"

const copyTargets: Record<CopyKind, { label: string; value(item: ReviewRequest): string }> = {
  number: { label: "Number", value: (item) => String(item.number) },
  reference: { label: "Reference", value: fullReference },
  link: { label: "Link", value: (item) => item.url },
}

export interface ReviewActions {
  select(key: string): void
  open(): Promise<void>
  copy(kind: CopyKind): void
  menu(): Promise<void>
  refresh(): Promise<void>
  setFilter(filter: QueueFilter): void
  toggleFilter(): void
  close(): void
}

export function useReviewActions(input: {
  panel: PanelInput
  update(state: QueueSnapshot): void
  ordered: Accessor<ReviewRequest[]>
  current: Accessor<ReviewRequest | undefined>
  setSelected: Setter<number>
  filter: Accessor<QueueFilter>
  setFilter: Setter<QueueFilter>
}): ReviewActions {
  const context = usePlugin()
  const rpc = context.client.rpc(ReviewQueue)

  const actions: ReviewActions = {
    select(key) {
      const index = input.ordered().findIndex((item) => item.key === key)
      if (index !== -1) {
        input.setSelected(index)
      }
    },
    async open() {
      const item = input.current()
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
    },
    copy(kind) {
      const item = input.current()
      if (!item) {
        return
      }
      const target = copyTargets[kind]
      const copied = context.renderer.copyToClipboardOSC52(target.value(item))
      context.ui.toast.show({
        message: copied ? `${target.label} copied` : "Terminal clipboard is unavailable",
        variant: copied ? "success" : "warning",
      })
    },
    async menu() {
      const item = input.current()
      if (!item) {
        return
      }
      const choice = await context.ui.dialog.select<"open" | CopyKind>({
        title: `#${item.number} ${item.title}`,
        options: [
          { title: "Open on GitHub", value: "open" },
          { title: "Copy number", value: "number", description: String(item.number) },
          { title: "Copy reference", value: "reference", description: fullReference(item) },
          { title: "Copy link", value: "link", description: item.url },
        ],
      })
      if (choice === "open") {
        await actions.open()
      } else if (choice) {
        actions.copy(choice)
      }
    },
    async refresh() {
      input.update((await rpc.refresh({})) as QueueSnapshot)
    },
    setFilter(filter) {
      input.setFilter(filter)
      input.setSelected(0)
    },
    toggleFilter() {
      actions.setFilter(input.filter() === "all" ? "current" : "all")
    },
    close: input.panel.close,
  }

  context.keymap.layer(() => ({
    commands: [
      {
        id: "github-review-queue.next",
        title: "Next review request",
        bind: "j",
        run: () => input.setSelected((value) => Math.min(value + 1, input.ordered().length - 1)),
      },
      {
        id: "github-review-queue.previous",
        title: "Previous review request",
        bind: "k",
        run: () => input.setSelected((value) => Math.max(0, value - 1)),
      },
      { id: "github-review-queue.open", title: "Open pull request", bind: "enter", run: actions.open },
      { id: "github-review-queue.menu", title: "Pull request actions", bind: "m", run: actions.menu },
      {
        id: "github-review-queue.copy-number",
        title: "Copy PR number",
        bind: "c",
        run: () => actions.copy("number"),
      },
      {
        id: "github-review-queue.copy-reference",
        title: "Copy qualified PR reference",
        bind: "y",
        run: () => actions.copy("reference"),
      },
      { id: "github-review-queue.copy-url", title: "Copy PR URL", bind: "u", run: () => actions.copy("link") },
      { id: "github-review-queue.filter", title: "Toggle repository filter", bind: "f", run: actions.toggleFilter },
      { id: "github-review-queue.refresh", title: "Refresh review queue", bind: "r", run: actions.refresh },
      {
        id: "github-review-queue.fullscreen",
        title: "Toggle panel fullscreen",
        bind: "shift+f",
        run: input.panel.toggleFullscreen,
      },
      { bind: "escape", run: actions.close },
    ],
  }))

  return actions
}
