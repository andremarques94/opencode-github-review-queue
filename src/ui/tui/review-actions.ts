import { usePlugin } from "@opencode/plugin/tui"
import type { PanelInput } from "@opencode/plugin/tui/context"
import type { Accessor, Setter } from "solid-js"
import type { ReviewDraft } from "../../domain/review-draft.js"
import type { QueueSnapshot } from "../../domain/review-queue.js"
import type { ReviewRequest } from "../../domain/review-request.js"
import { fullReference, type QueueFilter } from "../../shared/presentation.js"
import {
  type DraftAction,
  draftActions,
  draftFor,
  errorMessage,
  postReviewFlow,
  previewText,
  type ReviewFlowHost,
  resetReviewFlow,
  resumable,
  startReviewFlow,
} from "../../shared/review-flow.js"
import { ReviewQueue } from "../../shared/rpc.js"

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

type MenuOption = { title: string; value: () => unknown; description?: string; footer?: string; category: string }

const PULL_REQUEST = "Pull request"
const QUEUE = "Queue"

function draftOption(actions: ReviewActions, action: DraftAction): MenuOption {
  if (action.kind === "reset") {
    return { title: action.label, value: actions.reset, category: PULL_REQUEST }
  }
  return {
    title: action.label,
    value: actions.post,
    description: action.blocker ?? "Ready to post",
    footer: "p",
    category: PULL_REQUEST,
  }
}

function pullRequestOptions(actions: ReviewActions, item: ReviewRequest, draft: ReviewDraft | undefined): MenuOption[] {
  return [
    { title: "Open on GitHub", value: actions.open, footer: "o", category: PULL_REQUEST },
    {
      title: "Copy reference",
      value: () => actions.copy("reference"),
      description: fullReference(item),
      footer: "y",
      category: PULL_REQUEST,
    },
    { title: "Copy link", value: () => actions.copy("link"), footer: "u", category: PULL_REQUEST },
    ...draftActions(draft).map((action) => draftOption(actions, action)),
  ]
}

function queueOptions(actions: ReviewActions, filter: QueueFilter, toggleFullscreen: () => void): MenuOption[] {
  return [
    {
      title: filter === "all" ? "Show only this repository" : "Show all repositories",
      value: actions.toggleFilter,
      footer: "f",
      category: QUEUE,
    },
    { title: "Refresh", value: actions.refresh, footer: "r", category: QUEUE },
    { title: "Toggle full screen", value: toggleFullscreen, footer: "shift+f", category: QUEUE },
  ]
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
  const host: ReviewFlowHost = {
    confirm: async (options) =>
      (await context.ui.dialog.confirm({
        title: options.title,
        message: options.message,
        label: { confirm: options.confirm },
      })) === true,
    confirmPost: async (preview) =>
      (await context.ui.dialog.confirm({
        title: preview.title,
        message: previewText(preview),
        label: { confirm: "Post review" },
      })) === true,
    select: (options) =>
      context.ui.dialog.select({
        title: options.title,
        options: options.options.map(({ group, ...option }) => ({ ...option, ...(group ? { category: group } : {}) })),
        ...(options.current ? { current: options.current } : {}),
      }),
    models: () => rpc.models({}),
    notify: (message) => context.ui.toast.show({ message, variant: "info" }),
    startReview: (request) => rpc.startReview(request),
    postReview: (request) => rpc.postReview(request),
    resetReview: (request) => rpc.resetReview(request),
  }
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
        const url = await postReviewFlow(host, draft)
        if (url) {
          context.ui.toast.show({ message: `Review posted · ${url}`, variant: "success" })
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
      // Every action with its key, so the footer can stay short on narrow panels.
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
        bind: "j",
        run: () => input.setSelected((value) => Math.min(value + 1, input.ordered().length - 1)),
      },
      {
        id: "github-review-queue.previous",
        title: "Previous review request",
        bind: "k",
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
