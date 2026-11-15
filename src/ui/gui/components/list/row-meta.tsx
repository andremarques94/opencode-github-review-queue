import type { Context } from "@opencode/plugin/gui"
import { For, Show } from "solid-js"
import { postBlocker } from "../../../../domain/review-draft.js"
import type { ReviewRequest } from "../../../../domain/review-request.js"
import { parseOptions } from "../../../../shared/options.js"
import { readinessMarks, sizeMark, teamRequest, waitMark } from "../../../../shared/presentation.js"
import { draftFor, resumable, rowLabel } from "../../../../shared/review/draft-status.js"
import type { LocalReviews } from "../../../../shared/rpc.js"

const postBlockerOf = (draft: ReturnType<typeof draftFor>) => (draft ? postBlocker(draft) : undefined)

export function RowMeta(props: { context: Context; item: ReviewRequest; local: LocalReviews; now: number }) {
  const draft = () => draftFor(props.local.drafts, props.item.key)
  const wait = () => waitMark(props.item, parseOptions(props.context.options).staleAfterMs, props.now)

  return (
    <div class="grq-row-meta">
      <span class="grq-number">#{props.item.number}</span>
      <For each={readinessMarks(props.item)}>
        {(mark) => (
          <span class="grq-mark" data-tone={mark.tone} role="img" title={mark.detail} aria-label={mark.detail}>
            {mark.label}
          </span>
        )}
      </For>
      <Show when={sizeMark(props.item)}>
        {(size) => (
          <span class="grq-number" title={size().detail}>
            {size().label}
          </span>
        )}
      </Show>
      <Show when={!props.item.authored}>
        <span class="grq-sep">·</span>
        <span class="grq-author">@{props.item.author}</span>
      </Show>
      <Show when={teamRequest(props.item)}>
        {(team) => (
          <span class="grq-team" title={team().detail}>
            {team().label}
          </span>
        )}
      </Show>
      <span class="grq-sep">·</span>
      <span class="grq-number" data-stale={wait().stale ? "" : undefined} title={wait().detail}>
        {wait().label}
      </span>
      <Show when={props.item.draft}>
        <span class="grq-badge">Draft</span>
      </Show>
      <Show when={rowLabel(props.item, props.local, props.now)}>
        {(label) => (
          <span class="grq-badge grq-badge-review" title={(resumable(draft()) && postBlockerOf(draft())) || label()}>
            {label()}
          </span>
        )}
      </Show>
    </div>
  )
}
