import { usePlugin } from "@opencode/plugin/tui"
import type { PanelInput } from "@opencode/plugin/tui/context"
import type { Accessor, Setter } from "solid-js"
import type { ReviewDraft } from "../../../domain/review-draft.js"
import { reviewedFor } from "../../../domain/review-history.js"
import type { QueueSnapshot } from "../../../domain/review-queue.js"
import type { ReviewRequest } from "../../../domain/review-request.js"
import { fullReference, type QueueFilter } from "../../../shared/presentation.js"
import { draftFor, resumable } from "../../../shared/review/draft-status.js"
import { postReviewFlow, type ReviewFlowHost, resetReviewFlow, startReviewFlow } from "../../../shared/review/flows.js"
import { activeSnooze, snoozeFlow } from "../../../shared/review/snooze.js"
import { summaryFlow } from "../../../shared/review/summary.js"
import { errorMessage, type LocalReviews, ReviewQueue } from "../../../shared/rpc.js"
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
  snooze(): Promise<void>
  toggleSnoozed(): void
  summarize(): Promise<void>
  menu(): Promise<void>
  refresh(): Promise<void>
  setFilter(filter: QueueFilter): void
  toggleFilter(): void
  close(): void
}

export function attempting(context: ReturnType<typeof usePlugin>) {
  return async (run: () => Promise<void>, fallback: string) => {
    try {
      await run()
    } catch (error) {
      context.ui.toast.show({ message: errorMessage(error) ?? fallback, variant: "error" })
    }
  }
}

export async function postDraft(
  context: ReturnType<typeof usePlugin>,
  host: ReviewFlowHost,
  draft: ReviewDraft,
): Promise<void> {
  const posted = await postReviewFlow(host, draft)
  if (!posted) {
    return
  }
  context.ui.toast.show({ message: `Review posted · ${posted.url}`, variant: "success" })
  if (posted.cleanupWarning) {
    context.ui.toast.show({ message: posted.cleanupWarning, variant: "warning" })
  }
}

export function useReviewActions(input: {
  panel: PanelInput
  update(state: QueueSnapshot): void
  updateLocal(local: LocalReviews): void
  ordered: Accessor<ReviewRequest[]>
  current: Accessor<ReviewRequest | undefined>
  local: Accessor<LocalReviews>
  now: Accessor<number>
  setSelected: Setter<number>
  filter: Accessor<QueueFilter>
  setFilter: Setter<QueueFilter>
  snoozed: Accessor<number>
  showSnoozed: Accessor<boolean>
  setShowSnoozed: Setter<boolean>
}): ReviewActions {
  const context = usePlugin()
  const rpc = context.client.rpc(ReviewQueue)
  const directory = () => (context.location ?? context.data.location.default()).directory
  const currentDraft = () => {
    const item = input.current()
    return item ? draftFor(input.local().drafts, item.key) : undefined
  }
  const host = createFlowHost(context)
  const attempt = attempting(context)

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
        const sessionID = await startReviewFlow(
          host,
          item,
          directory(),
          resumable(currentDraft()),
          reviewedFor(input.local().reviewed, item.key),
        )
        if (sessionID) {
          input.panel.close()
          context.ui.router.navigate({ type: "session", sessionID })
        }
      }, "Could not start the review"),
    post: () =>
      attempt(async () => {
        const draft = currentDraft()
        if (draft) {
          await postDraft(context, host, draft)
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
    snooze: () =>
      attempt(async () => {
        const item = input.current()
        if (!item) {
          return
        }
        if (activeSnooze(input.local().snoozes, item, input.now())) {
          input.updateLocal(await rpc.wake({ key: item.key }))
          context.ui.toast.show({ message: `${fullReference(item)} is back in the queue`, variant: "success" })
          return
        }
        const local = await snoozeFlow(host, item)
        if (local) {
          input.updateLocal(local)
        }
      }, "Could not snooze the pull request"),
    toggleSnoozed() {
      input.setShowSnoozed((shown) => !shown)
    },
    summarize: () =>
      attempt(async () => {
        const item = input.current()
        if (item) {
          await summaryFlow(host, item)
        }
      }, "Could not summarize the pull request"),
    async menu() {
      const item = input.current()
      const choice = await context.ui.dialog.select<() => unknown>({
        title: item ? `#${item.number} ${item.title}` : "Review queue",
        options: [
          ...(item
            ? pullRequestOptions(actions, item, currentDraft(), activeSnooze(input.local().snoozes, item, input.now()))
            : []),
          ...queueOptions(actions, {
            filter: input.filter(),
            snoozed: input.snoozed(),
            showSnoozed: input.showSnoozed(),
            toggleFullscreen: input.panel.toggleFullscreen,
          }),
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
      { id: "github-review-queue.summarize", title: "Summarize pull request", bind: "i", run: actions.summarize },
      { id: "github-review-queue.snooze", title: "Snooze or wake pull request", bind: "s", run: actions.snooze },
      {
        id: "github-review-queue.show-snoozed",
        title: "Show or hide snoozed pull requests",
        bind: "z",
        run: actions.toggleSnoozed,
      },
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
