/** @jsxImportSource @opentui/solid */

import { usePlugin } from "@opencode/plugin/tui"
import { SyntaxStyle } from "@opentui/core"
import { createMemo, onCleanup } from "solid-js"

export function MarkdownText(props: { content: string; tone?: "base" | "muted" | "faint" }) {
  const context = usePlugin()
  // The plugin context exposes no syntax style of its own, so this builds one from the theme's text colors.
  const style = createMemo((previous: SyntaxStyle | undefined) => {
    previous?.destroy()
    const text = context.theme.text
    return SyntaxStyle.fromStyles(
      {
        default: { fg: text.base },
        conceal: { fg: text.faint },
        "markup.heading": { fg: text.base, bold: true },
        "markup.strong": { bold: true },
        "markup.italic": { italic: true },
        "markup.strikethrough": { dim: true },
        "markup.raw": { fg: text.action.primary.base },
        "markup.link": { fg: text.muted },
        "markup.link.label": { fg: text.action.primary.base },
        "markup.link.url": { fg: text.action.primary.base, underline: true },
        "markup.list": { fg: text.muted },
        "markup.quote": { fg: text.muted, italic: true },
      },
      context.renderer.nativeScene,
    )
  }, undefined)
  onCleanup(() => style().destroy())

  return (
    <markdown content={props.content} syntaxStyle={style()} fg={context.theme.text[props.tone ?? "base"]} conceal />
  )
}
