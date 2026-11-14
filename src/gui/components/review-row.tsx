import type { Context } from "@opencode/plugin/gui"
import { Show } from "solid-js"
import type { ReviewRequest } from "../../domain/review-queue.js"
import { age, fullReference } from "../../shared/presentation.js"

interface ReviewRowProps {
  context: Context
  item: ReviewRequest
  isNew: boolean
  copy(text: string, name: string): void
}

export function ReviewRow(props: ReviewRowProps) {
  return (
    <article class="group border-b border-border-base px-3 py-2 hover:bg-background-stronger">
      <div class="flex items-start gap-2">
        <button
          type="button"
          class="min-w-0 flex-1 text-left"
          onClick={() => props.context.system.openExternal(props.item.url)}
        >
          <div class="flex items-center gap-1.5 text-sm font-medium">
            <Show when={props.isNew}>
              <span class="text-success-base" title="New review request">
                ●
              </span>
            </Show>
            <span class="truncate">{props.item.repository}</span>
            <span class="shrink-0">#{props.item.number}</span>
            <Show when={props.item.draft}>
              <span class="shrink-0 rounded bg-background-strongest px-1 text-[10px] text-text-muted">DRAFT</span>
            </Show>
          </div>
          <div class="mt-0.5 line-clamp-2 text-sm">{props.item.title}</div>
          <div class="mt-1 text-xs text-text-muted">
            @{props.item.author} · {age(props.item.createdAt)} ago
          </div>
        </button>
        <props.context.ui.Menu
          label="Copy or open"
          items={[
            {
              label: "Open on GitHub",
              icon: "outline-arrow-up-right",
              onSelect: () => props.context.system.openExternal(props.item.url),
            },
            {
              label: `Copy #${props.item.number}`,
              icon: "copy",
              onSelect: () => props.copy(String(props.item.number), "PR number"),
            },
            {
              label: `Copy ${fullReference(props.item)}`,
              icon: "copy",
              onSelect: () => props.copy(fullReference(props.item), "PR reference"),
            },
            { label: "Copy URL", icon: "link", onSelect: () => props.copy(props.item.url, "PR URL") },
          ]}
        />
      </div>
    </article>
  )
}
