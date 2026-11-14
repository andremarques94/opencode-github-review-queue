import { Command, MenuItem, Panel, type PanelTab, Plugin } from "@opencode/plugin/gui"
import { createStore } from "solid-js/store"
import type { QueueSnapshot, ReviewRequest } from "../domain/review-queue.js"
import { emptySnapshot } from "../domain/review-queue.js"
import { ReviewQueue } from "../rpc/review-queue.js"
import { parseOptions } from "../shared/options.js"
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
    const repositories = new Map<string, string | undefined>()
    const rpc = () => ctx.client.rpc(ReviewQueue)
    const update = (snapshot: QueueSnapshot) => setState(snapshot)

    void rpc()
      .snapshot({})
      .then((snapshot) => update(snapshot as unknown as QueueSnapshot))
    const stopState = rpc().events.on("state", (event) => update(event.data as unknown as QueueSnapshot))
    const stopDiscovered = rpc().events.on("discovered", (event) => {
      const data = event.data as { item: ReviewRequest; eventID: string }
      const message = `${data.item.repository} #${data.item.number} — ${data.item.title}`
      ctx.toast.show({ title: "Review requested", description: message, icon: "github" })
      if (options.notifications) {
        void ctx.attention.notify({ title: "Review requested", message, id: data.eventID })
      }
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
      stopDiscovered()
    }
  },
})
