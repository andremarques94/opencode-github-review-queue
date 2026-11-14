import { usePlugin } from "@opencode/plugin/tui"
import type { PanelInput } from "@opencode/plugin/tui/context"
import type { Accessor, Setter } from "solid-js"
import type { ReviewDraft } from "../../../domain/review-draft.js"
import type { QueueSnapshot } from "../../../domain/review-queue.js"
import type { ReviewRequest } from "../../../domain/review-request.js"
import { fullReference, type QueueFilter } from "../../../shared/presentation.js"
import { draftFor, resumable } from "../../../shared/review/draft-status.js"
import { postReviewFlow, resetReviewFlow, startReviewFlow } from "../../../shared/review/flows.js"
import { errorMessage, ReviewQueue } from "../../../shared/rpc.js"
import { createFlowHost } from "./flow-host.js"
import { pullRequestOptions, queueOptions } from "./menu-options.js"

export type CopyKind = "reference" | "link"

const copyTargets: Record<CopyKind, { label: string; value(item: ReviewRequest): string }> = {
  reference: { label: "Reference", value: fullReference },
  link: { label: "Link", value: (item) => item.url },
}

export type ReviewActions = {
  select(key: string): void
  open(): Promise<void>
  review(): Promise<void>
  post(): Promise<void>
  reset(): Promise<void>
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
  drafts: Accessor<readonly ReviewDraft[]>
  setSelected: Setter<number>
  filter: Accessor<QueueFilter>
  setFilter: Setter<QueueFilter>
}): ReviewActions {
  const context = usePlugin()
  const rpc = context.client.rpc(ReviewQueue)
  const directory = () => (context.location ?? context.data.location.default()).directory
  const currentDraft = () => {
    const item = input.current()
    return item ? draftFor(input.drafts(), item.key) : undefined
  }
  const host = createFlowHost(context)
  const attempt = async (run: () => Promise<void>, fallback: string) => {
    try {
      await run()
    } catch (error) {
      context.ui.toast.show({ message: errorMessage(error) ?? fallback, variant: "error" })
    }
  }

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
      await attempt(async () => {
        await rpc.open({ key: item.key })
      }, "Could not open pull request")
    },
    review: () =>
      attempt(async () => {
        const item = input.current()
        if (!item) {
          return
        }
        const sessionID = await startReviewFlow(host, item, directory(), resumable(currentDraft()))
        if (sessionID) {
          input.panel.close()
          context.ui.router.navigate({ type: "session", sessionID })
        }
      }, "Could not start the review"),
    post: () =>
      attempt(async () => {
        const draft = currentDraft()
        if (!draft) {
          return
        }
        const posted = await postReviewFlow(host, draft)
        if (!posted) {
          return
        }
        context.ui.toast.show({ message: `Review posted · ${posted.url}`, variant: "success" })
        if (posted.cleanupWarning) {
          context.ui.toast.show({ message: posted.cleanupWarning, variant: "warning" })
        }
      }, "Could not post the review"),
    reset: () =>
      attempt(async () => {
        const draft = currentDraft()
        if (draft && (await resetReviewFlow(host, draft))) {
          context.ui.toast.show({ message: "Review reset", variant: "success" })
        }
      }, "Could not reset the review"),
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
      const choice = await context.ui.dialog.select<() => unknown>({
        title: item ? `#${item.number} ${item.title}` : "Review queue",
        options: [
          ...(item ? pullRequestOptions(actions, item, currentDraft()) : []),
          ...queueOptions(actions, input.filter(), input.panel.toggleFullscreen),
        ],
      })
      await choice?.()
    },
    async refresh() {
      input.update(await rpc.refresh({}))
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
        bind: "j,down",
        run: () => input.setSelected((value) => Math.min(value + 1, input.ordered().length - 1)),
      },
      {
        id: "github-review-queue.previous",
        title: "Previous review request",
        bind: "k,up",
        run: () => input.setSelected((value) => Math.max(0, value - 1)),
      },
      { id: "github-review-queue.review", title: "Start or resume review", bind: "enter", run: actions.review },
      { id: "github-review-queue.open", title: "Open pull request on GitHub", bind: "o", run: actions.open },
      { id: "github-review-queue.menu", title: "Pull request actions", bind: "m", run: actions.menu },
      { id: "github-review-queue.post", title: "Post review", bind: "p", run: actions.post },
      {
        id: "github-review-queue.copy-reference",
        title: "Copy qualified PR reference",
        bind: "y",
        run: () => actions.copy("reference"),
      },
      { id: "github-review-queue.copy-url", title: "Copy PR URL", bind: "u", run: () => actions.copy("link") },
      {
        id: "github-review-queue.filter",
        title: "Toggle repository filter",
        bind: "f,left,right",
        run: actions.toggleFilter,
      },
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
