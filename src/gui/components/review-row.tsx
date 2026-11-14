import type { Context } from "@opencode/plugin/gui"
import { Show } from "solid-js"
import type { ReviewRequest } from "../../domain/review-queue.js"
import { ago, fullReference } from "../../shared/presentation.js"

interface ReviewRowProps {
  context: Context
  item: ReviewRequest
  isNew: boolean
  copy(text: string, name: string): void
}

export function ReviewRow(props: ReviewRowProps) {
  const open = () => props.context.system.openExternal(props.item.url)

  return (
    <article class="grq-row">
      <span class="grq-dot" data-hidden={props.isNew ? undefined : ""} title={props.isNew ? "New" : undefined} />
      <button type="button" class="grq-row-main" title={props.item.title} onClick={open}>
        <div class="grq-row-title">{props.item.title}</div>
        <div class="grq-row-meta">
          <span class="grq-number">#{props.item.number}</span>
          <span class="grq-sep">·</span>
          <span>@{props.item.author}</span>
          <span class="grq-sep">·</span>
          <span class="grq-number">{ago(props.item.createdAt)}</span>
          <Show when={props.item.draft}>
            <span class="grq-badge">Draft</span>
          </Show>
        </div>
      </button>
      <div class="grq-row-actions">
        <props.context.ui.Menu
          label="Pull request actions"
          items={[
            { label: "Open on GitHub", icon: "outline-arrow-up-right", onSelect: open },
            { type: "separator" },
            { label: "Copy number", icon: "copy", onSelect: () => props.copy(String(props.item.number), "Number") },
            {
              label: "Copy reference",
              icon: "copy",
              onSelect: () => props.copy(fullReference(props.item), "Reference"),
            },
            { label: "Copy link", icon: "link", onSelect: () => props.copy(props.item.url, "Link") },
          ]}
        />
      </div>
    </article>
  )
}
