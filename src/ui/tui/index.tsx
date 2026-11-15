/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import { Show } from "solid-js"
import type { ReviewDraft } from "../../domain/review-draft.js"
import { emptySnapshot, type QueueSnapshot } from "../../domain/review-queue.js"
import { createDiscoveryBatcher } from "../../shared/notifications/discovery-batcher.js"
import { notificationText } from "../../shared/notifications/notification-text.js"
import { parseOptions } from "../../shared/options.js"
import { draftForSession, replaceDraft } from "../../shared/review/draft-status.js"
import { type LocalReviews, ReviewQueue } from "../../shared/rpc.js"
import { FINDINGS_PANEL, FindingsPanel } from "./components/findings/findings-panel.js"
import { ReviewStatus } from "./components/findings/review-status.js"
import { ReviewPanel } from "./components/review-panel.js"
import type { TuiState } from "./state.js"

export default Plugin.define({
  id: "github-review-queue.tui",
  async setup(context) {
    const options = parseOptions(context.options)
    const rpc = context.client.rpc(ReviewQueue)
    const initial: TuiState = { ...emptySnapshot(), drafts: [], reviewed: [], snoozes: [] }
    const [state, updateState] = context.storage.memory<TuiState>("queue", { initial })
    const update = (snapshot: QueueSnapshot) => updateState((draft) => Object.assign(draft, snapshot))

    const directory = (context.location ?? context.data.location.default()).directory
    void rpc.repository({ directory }).then((result) =>
      updateState((draft) => {
        const repository = result.repository
        if (repository) {
          draft.repository = repository
        }
      }),
    )
    const updateDrafts = (local: LocalReviews) =>
      updateState((store) => {
        store.drafts = local.drafts
        store.reviewed = local.reviewed
        store.snoozes = local.snoozes
      })
    void rpc.snapshot({}).then((snapshot) => update(snapshot))
    // Another location (the review session's) may write a draft, so re-read drafts with every queue update too.
    const loadDrafts = () => void rpc.drafts({}).then(updateDrafts)
    loadDrafts()
    const stopState = rpc.events.on("state", (event) => {
      update(event.data)
      loadDrafts()
    })
    const stopDrafts = rpc.events.on("drafts", (event) => updateDrafts(event.data))
    const batcher = createDiscoveryBatcher((items) => {
      const { title, message } = notificationText(items)
      context.ui.toast.show({ title, message: `${message}  ·  /reviews`, variant: "info" })
      if (options.notifications) {
        void context.attention.notify({
          title,
          message,
          notification: { when: "blurred" },
          sound: { name: "default", when: "blurred" },
        })
      }
    })
    const stopDiscovered = rpc.events.on("discovered", (event) => {
      batcher.push(event.data.item)
    })

    const updateDraft = (draft: ReviewDraft) =>
      updateState((store) => {
        store.drafts = replaceDraft(store.drafts, draft)
      })
    const reviewDraft = (sessionID: string) => draftForSession(state.drafts, sessionID)
    const inReviewSession = () => {
      const route = context.ui.router.current()
      return route.type === "session" && reviewDraft(route.sessionID) !== undefined
    }

    const removePanel = context.ui.slot({
      append: "session.panel",
      render: (panel) => (
        <>
          <Show when={panel.name === "github-review-queue.main"}>
            <ReviewPanel panel={panel} state={state} update={update} updateLocal={updateDrafts} />
          </Show>
          <Show when={panel.name === FINDINGS_PANEL}>
            <FindingsPanel
              panel={panel}
              draft={reviewDraft(panel.sessionID)}
              update={updateDraft}
              reload={loadDrafts}
            />
          </Show>
        </>
      ),
    })
    const removeStatus = context.ui.slot({
      append: "session.composer.top",
      render: (input) => (
        <Show when={reviewDraft(input.sessionID)}>
          {(draft) => <ReviewStatus sessionID={input.sessionID} draft={draft()} reload={loadDrafts} />}
        </Show>
      ),
    })
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "github-review-queue.show",
          title: "Show GitHub review requests",
          group: "GitHub",
          palette: true,
          slash: { name: "reviews" },
          suggested: true,
          run: () => {
            context.ui.panel.open("github-review-queue.main")
          },
        },
        {
          id: "github-review-queue.findings",
          title: "Show review findings",
          group: "GitHub",
          palette: true,
          slash: { name: "findings" },
          enabled: inReviewSession,
          suggested: inReviewSession,
          run: () => {
            context.ui.panel.open(FINDINGS_PANEL)
          },
        },
      ],
      bindings: ["github-review-queue.show", "github-review-queue.findings"],
    }))
    context.ui.slot({
      append: "home.footer.status",
      render: () => <text fg={context.theme.text.muted}>Reviews {state.items.length}</text>,
    })

    return () => {
      stopState()
      stopDrafts()
      stopDiscovered()
      batcher.dispose()
      removePanel()
      removeStatus()
    }
  },
})
