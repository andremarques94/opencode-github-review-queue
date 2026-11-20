/** @jsxImportSource @opentui/solid */

import type { usePlugin } from "@opencode/plugin/tui"
import type { TextareaRenderable } from "@opentui/core"

// Terminals rarely report meta+return, the textarea's default submit key.
const SAVE_BINDING = [{ name: "s", ctrl: true, action: "submit" as const }]

/** `dialog.prompt` takes one line, and a review comment is Markdown that often spans several. */
export function editFindingBody(
  context: ReturnType<typeof usePlugin>,
  input: { title: string; body: string; allowEmpty?: boolean; saveLabel?: string },
): Promise<string | undefined> {
  return new Promise((resolve) => {
    let textarea: TextareaRenderable | undefined
    let settled = false
    const finish = (value: string | undefined) => {
      if (!settled) {
        settled = true
        resolve(value)
      }
    }
    const save = () => {
      const body = textarea?.plainText ?? ""
      if (!input.allowEmpty && !body.trim()) {
        return
      }
      finish(body)
      context.ui.dialog.clear()
    }
    context.ui.dialog.show(
      () => (
        <box flexDirection="column" gap={1} paddingLeft={2} paddingRight={2} paddingBottom={1}>
          <text fg={context.theme.text.base}>{input.title}</text>
          <textarea
            ref={(element: TextareaRenderable) => {
              textarea = element
            }}
            initialValue={input.body}
            focused
            height={12}
            textColor={context.theme.text.base}
            focusedBackgroundColor={context.theme.background.raised.base}
            keyBindings={SAVE_BINDING}
            onSubmit={save}
          />
          <text fg={context.theme.text.faint}>ctrl+s {input.saveLabel ?? "save and keep"} · esc cancel</text>
        </box>
      ),
      () => finish(undefined),
    )
    context.ui.dialog.set({ size: "large" })
  })
}
