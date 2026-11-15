import type { Context, MountedSession, SessionScreen } from "@opencode/plugin/gui"
import { OpenInApp } from "@opencode/plugin/gui/file"
import { Show } from "solid-js"

/**
 * The host's "Open in" button for the review session's workspace, which is the review worktree, so the changes can
 * be run in an editor or terminal. Shows nothing on the web, for a remote server, or before the host provides it.
 */
export function OpenWorktree(props: {
  context: Context
  session: MountedSession
  screen: SessionScreen
  /** Puts the button on a row of its own, after this text. */
  label?: string
}) {
  const openInApp = props.context.use(OpenInApp)
  const live = () => {
    const current = openInApp()
    return current.status === "active" ? current.value : undefined
  }
  return (
    <Show when={live()}>
      {(open) => {
        const Button = open().Button
        const button = <Button session={props.session} screen={props.screen} />
        return props.label ? (
          <div class="grq-progress-open">
            <span class="grq-muted">{props.label}</span>
            {button}
          </div>
        ) : (
          button
        )
      }}
    </Show>
  )
}
