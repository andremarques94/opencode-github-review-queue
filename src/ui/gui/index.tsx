import {
  Command,
  ComposerPill,
  MenuItem,
  type MountedSession,
  Panel,
  type PanelTab,
  Plugin,
} from "@opencode/plugin/gui"
import { createEffect, untrack } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { emptySnapshot, type QueueSnapshot, replaceSnapshot } from "../../domain/review-queue.js"
import type { ReviewRequest } from "../../domain/review-request.js"
import { createDiscoveryBatcher } from "../../shared/notifications/discovery-batcher.js"
import {
  type MyUpdate,
  myUpdate,
  myUpdateText,
  notificationText,
} from "../../shared/notifications/notification-text.js"
import { parseOptions } from "../../shared/options.js"
import { draftForSession, pillStatus, replaceDraft, reviewProgress } from "../../shared/review/draft-status.js"
import { awake } from "../../shared/review/snooze.js"
import { type LocalReviews, ReviewQueue } from "../../shared/rpc.js"
import { createFindingActions, FINDINGS_PANEL } from "./actions/finding-actions.js"
import { FindingsPanel } from "./components/findings/findings-panel.js"
import { ProgressMenu } from "./components/findings/progress-menu.js"
import { ReviewPanel } from "./components/review-panel.js"

export default Plugin.define({
  i18n: {
    en: {
      "panel.title": "Review requests",
      "command.open": "Show GitHub review requests",
      "menu.open": "GitHub review requests",
      "findings.title": "Review findings",
      "findings.label": "Findings",
    },
  },
  setup(ctx) {
    const options = parseOptions(ctx.options)
    const [state, setState] = createStore<QueueSnapshot>(emptySnapshot())
    const [drafts, setDrafts] = createStore<LocalReviews>({ drafts: [], reviewed: [], snoozes: [], collapsed: [] })
    const repositories = new Map<string, string | undefined>()
    const rpc = () => ctx.client.rpc(ReviewQueue)
    const update = (snapshot: QueueSnapshot) => setState(produce((draft) => replaceSnapshot(draft, snapshot)))

    void rpc()
      .snapshot({})
      .then((snapshot) => update(snapshot))
    // Another location (the review session's) may write a draft, so re-read drafts with every queue update too.
    const loadDrafts = () => void rpc().drafts({}).then(setDrafts)
    loadDrafts()
    const stopState = rpc().events.on("state", (event) => {
      update(event.data)
      loadDrafts()
    })
    const stopDrafts = rpc().events.on("drafts", (event) => setDrafts(event.data))
    const reviewDraft = (session: MountedSession) => draftForSession(drafts.drafts, session.id)
    // The agent records decisions in the review session's own plugin instance, whose events may not reach this
    // window, so re-read drafts whenever that session's state, messages, or open questions change.
    createEffect(() => {
      const session = ctx.sessions.current()
      if (!session) {
        return
      }
      const data = session.server.data.session
      data.status(session.id)
      data.message.list(session.id).length
      data.form.list(session.id)?.length
      if (untrack(() => reviewDraft(session))) {
        loadDrafts()
      }
    })
    const findingActions = (session: () => MountedSession) =>
      createFindingActions({
        context: ctx,
        session,
        update: (draft) => setDrafts("drafts", replaceDraft(drafts.drafts, draft)),
        reload: loadDrafts,
      })
    const openPanel = () => {
      const session = ctx.sessions.current() ?? ctx.sessions.list()[0]
      if (session) {
        ctx.layout.open(`${ctx.id}:main`, session)
      }
    }
    const announce = ({ title, message }: { title: string; message: string }, keys: string[]) => {
      ctx.toast.show({
        title,
        description: message,
        icon: "github",
        actions: [{ label: "Show reviews", run: openPanel }],
      })
      if (options.notifications) {
        const session = ctx.sessions.current() ?? ctx.sessions.list()[0]
        void ctx.attention.notify({
          title,
          message,
          id: `${keys.sort().join(",")}:${Math.floor(Date.now() / 3_600_000)}`,
          ...(session ? { session: { server: session.server.id, id: session.id } } : {}),
        })
      }
    }
    const keysOf = (entries: readonly { key: string }[]) => entries.map((entry) => entry.key)
    const batcher = createDiscoveryBatcher((items: ReviewRequest[]) => announce(notificationText(items), keysOf(items)))
    const stopDiscovered = rpc().events.on("discovered", (event) => {
      if (awake(drafts.snoozes, event.data.item)) {
        batcher.push(event.data.item)
      }
    })
    const updates = createDiscoveryBatcher((entries: MyUpdate[]) => announce(myUpdateText(entries), keysOf(entries)))
    const stopNotices = rpc().events.on("notice", (event) => {
      if (options.notifyOnMyPullRequests) {
        updates.push(myUpdate(event.data.notice, event.data.item))
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
          server={props.session.server.id}
          local={drafts}
          updateLocal={setDrafts}
          repositories={repositories}
          state={state}
          update={update}
        />
      ),
    })
    const findingsTab: PanelTab = {
      id: FINDINGS_PANEL,
      title: ctx.t("findings.title"),
      label: () => (
        <span class="flex items-center gap-1">
          <ctx.ui.Icon name="checklist" size="small" />
          <span>{ctx.t("findings.label")}</span>
        </span>
      ),
      tabbable: true,
    }
    ctx.add(Panel, {
      id: FINDINGS_PANEL,
      region: "side",
      list: (input) => (input.open.includes(FINDINGS_PANEL) && reviewDraft(input.session) ? [findingsTab] : []),
      render: (props) => (
        <FindingsPanel
          context={ctx}
          session={props.session}
          screen={props.screen}
          draft={reviewDraft(props.session)}
          actions={findingActions(() => props.session)}
        />
      ),
    })
    // A pill rather than a `session.header` slot: it has a popover for the Post action, shows only in the sessions
    // `show` picks, and floats over the timeline, so it never competes with the title for room or reflows the screen.
    ctx.add(ComposerPill, {
      id: "review",
      show: (input) => {
        const draft = reviewDraft(input.session)
        if (!draft) {
          return undefined
        }
        const progress = reviewProgress(draft)
        // `title` is also the popover's heading, so it must not repeat the label.
        return {
          label: `Review · ${pillStatus(draft)}`,
          icon: "github",
          ...(progress.tone ? { tone: progress.tone } : {}),
          // The popover is narrow: the repository's name, without its owner, keeps the heading on one line.
          title: `Review of ${draft.repository.split("/").pop()} #${draft.number}`,
        }
      },
      menu: (input) => (
        <ProgressMenu
          context={ctx}
          session={input.session}
          screen={input.screen}
          draft={reviewDraft(input.session)}
          actions={findingActions(() => input.session)}
          close={input.close}
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
      stopNotices()
      updates.dispose()
    }
  },
})
