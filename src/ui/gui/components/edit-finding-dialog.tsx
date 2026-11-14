import type { Context } from "@opencode/plugin/gui"
import { createSignal, onCleanup } from "solid-js"
import { dialogStyles } from "./styles.js"

/** `dialogs.prompt` takes one line, and a review comment is Markdown that often spans several, with suggestion blocks. */
export function editFindingBody(context: Context, input: { title: string; body: string }): Promise<string | undefined> {
  return new Promise((resolve) => {
    context.dialogs.open((dialog) => {
      const [body, setBody] = createSignal(input.body)
      const finish = (value: string | undefined) => {
        resolve(value)
        dialog.close()
      }
      const save = () => {
        if (body().trim()) {
          finish(body())
        }
      }
      onCleanup(() => resolve(undefined))
      return (
        <context.ui.Dialog
          title={input.title}
          description="The comment is posted exactly as written. Saving keeps the finding."
          size="large"
          footer={
            <>
              <context.ui.Button variant="ghost" onClick={() => finish(undefined)}>
                Cancel
              </context.ui.Button>
              <context.ui.Button variant="contrast" disabled={!body().trim()} onClick={save}>
                Save and keep
              </context.ui.Button>
            </>
          }
        >
          <style>{dialogStyles}</style>
          <textarea
            class="grq-textarea"
            aria-label="Comment"
            value={body()}
            onInput={(event) => setBody(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                save()
              }
            }}
            ref={(element) => queueMicrotask(() => element.focus())}
          />
        </context.ui.Dialog>
      )
    })
  })
}
