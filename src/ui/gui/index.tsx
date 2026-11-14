import { Command, MenuItem, Panel, type PanelTab, Plugin } from "@opencode/plugin/gui"
import { createStore } from "solid-js/store"
import type { ReviewDraft } from "../../domain/review-draft.js"
import { emptySnapshot, type QueueSnapshot } from "../../domain/review-queue.js"
import { createDiscoveryBatcher } from "../../shared/notifications/discovery-batcher.js"
import { notificationText } from "../../shared/notifications/notification-text.js"
import { parseOptions } from "../../shared/options.js"
import { ReviewQueue } from "../../shared/rpc.js"
import { ReviewPanel } from "./components/review-panel.js"

export default Plugin.define({
  i18n: {
    en: {
      "panel.title": "Review requests",
      "command.open": "Show GitHub review requests",
      "menu.open": "GitHub review requests",
    },
  },
  setup(ctx) {
    const options = parseOptions(ctx.options)
    const [state, setState] = createStore<QueueSnapshot>(emptySnapshot())
    const [drafts, setDrafts] = createStore<{ list: ReviewDraft[] }>({ list: [] })
    const repositories = new Map<string, string | undefined>()
    const rpc = () => ctx.client.rpc(ReviewQueue)
    const update = (snapshot: QueueSnapshot) => setState(snapshot)

    void rpc()
      .snapshot({})
      .then((snapshot) => update(snapshot))
    // Another location (the review session's) may write a draft, so re-read drafts with every queue update too.
    const loadDrafts = () =>
      void rpc()
        .drafts({})
        .then((result) => setDrafts("list", result.drafts))
    loadDrafts()
    const stopState = rpc().events.on("state", (event) => {
      update(event.data)
      loadDrafts()
    })
    const stopDrafts = rpc().events.on("drafts", (event) => setDrafts("list", event.data.drafts))
    const openPanel = () => {
      const session = ctx.sessions.current() ?? ctx.sessions.list()[0]
      if (session) {
        ctx.layout.open(`${ctx.id}:main`, session)
      }
    }
    const batcher = createDiscoveryBatcher((items) => {
      const { title, message } = notificationText(items)
      ctx.toast.show({
        title,
        description: message,
        icon: "github",
        actions: [{ label: "Show reviews", run: openPanel }],
      })
      if (options.notifications) {
        const session = ctx.sessions.current() ?? ctx.sessions.list()[0]
        const keys = items.map((item) => item.key).sort()
        void ctx.attention.notify({
          title,
          message,
          id: `${keys.join(",")}:${Math.floor(Date.now() / 3_600_000)}`,
          ...(session ? { session: { server: session.server.id, id: session.id } } : {}),
        })
      }
    })
    const stopDiscovered = rpc().events.on("discovered", (event) => {
      batcher.push(event.data.item)
    })

    const tab: PanelTab = {
      id: "main",
      get title() {
        return `${ctx.t("panel.title")} (${state.items.length})`
      },
      label: () => (
        <span class="flex items-center gap-1">
          <ctx.ui.Icon name="github" size="small" />
          <span>{state.items.length}</span>
        </span>
      ),
      pinned: true,
      draggable: false,
      closable: false,
      fallback: true,
      tabbable: true,
    }

    ctx.add(Panel, {
      id: "main",
      region: "side",
      width: "narrow",
      mobile: {
        get title() {
          return ctx.t("panel.title")
        },
        order: 45,
        kind: "menu",
        icon: "github",
      },
      list: () => [tab],
      render: (props) => (
        <ReviewPanel
          context={ctx}
          directory={props.session.location?.directory}
          server={props.session.server.id}
          drafts={drafts.list}
          repositories={repositories}
          state={state}
          update={update}
        />
      ),
    })
    ctx.add(
      Command,
      (): Command => ({
        id: "open",
        title: ctx.t("command.open"),
        group: "GitHub",
        featured: true,
        enabled: !!ctx.sessions.current(),
        run: () => {
          const session = ctx.sessions.current()
          if (session) {
            ctx.layout.open(`${ctx.id}:main`, session)
          }
        },
      }),
    )
    ctx.add(MenuItem, (): MenuItem => {
      const session = ctx.sessions.current()
      return {
        menu: "session.panel",
        id: "open",
        title: ctx.t("menu.open"),
        icon: "github",
        description: `${state.items.length} pending`,
        opened: !!session && ctx.layout.state(`${ctx.id}:main`, session) !== "closed",
        run: () => {
          if (session) {
            ctx.layout.open(`${ctx.id}:main`, session)
          }
        },
      }
    })

    return () => {
      stopState()
      stopDrafts()
      stopDiscovered()
      batcher.dispose()
    }
  },
})
