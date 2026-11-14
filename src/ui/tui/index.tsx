/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import { Show } from "solid-js"
import { emptySnapshot, type QueueSnapshot } from "../../domain/review-queue.js"
import type { ReviewRequest } from "../../domain/review-request.js"
import { createDiscoveryBatcher } from "../../shared/notifications/discovery-batcher.js"
import { notificationText } from "../../shared/notifications/notification-text.js"
import { parseOptions } from "../../shared/options.js"
import { ReviewQueue } from "../../shared/rpc.js"
import { ReviewPanel } from "./components/review-panel.js"
import type { TuiState } from "./state.js"

export default Plugin.define({
  id: "github-review-queue.tui",
  async setup(context) {
    const options = parseOptions(context.options)
    const rpc = context.client.rpc(ReviewQueue)
    const initial: TuiState = { ...emptySnapshot() }
    const [state, updateState] = context.storage.memory<TuiState>("queue", { initial })
    const update = (snapshot: QueueSnapshot) => updateState((draft) => Object.assign(draft, snapshot))

    const directory = (context.location ?? context.data.location.default()).directory
    void rpc.repository({ directory }).then((result) =>
      updateState((draft) => {
        const repository = (result as { repository: string | null }).repository
        if (repository) {
          draft.repository = repository
        }
      }),
    )
    void rpc.snapshot({}).then((snapshot) => update(snapshot as QueueSnapshot))
    const stopState = rpc.events.on("state", (event) => update(event.data as QueueSnapshot))
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
      batcher.push((event.data as { item: ReviewRequest }).item)
    })

    const removePanel = context.ui.slot({
      append: "session.panel",
      render: (panel) => (
        <Show when={panel.name === "github-review-queue.main"}>
          <ReviewPanel panel={panel} state={state} update={update} />
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
      ],
      bindings: ["github-review-queue.show"],
    }))
    context.ui.slot({
      append: "home.footer.status",
      render: () => <text fg={context.theme.text.muted}>Reviews {state.items.length}</text>,
    })

    return () => {
      stopState()
      stopDiscovered()
      batcher.dispose()
      removePanel()
    }
  },
})
