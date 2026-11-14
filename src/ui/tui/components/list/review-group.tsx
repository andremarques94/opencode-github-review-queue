/** @jsxImportSource @opentui/solid */

import { usePlugin } from "@opencode/plugin/tui"
import { For, Show } from "solid-js"
import type { ReviewDraft } from "../../../../domain/review-draft.js"
import type { RepositoryGroup } from "../../../../shared/presentation.js"
import { draftFor, draftLabel } from "../../../../shared/review/draft-status.js"
import type { ReviewActions } from "../../actions/review-actions.js"
import { ReviewRow } from "./review-row.js"

export function ReviewGroup(props: {
  group: RepositoryGroup
  showHeader: boolean
  selectedKey: string | undefined
  newKeys: readonly string[]
  drafts: readonly ReviewDraft[]
  width: number
  actions: ReviewActions
}) {
  const theme = usePlugin().theme

  return (
    <box flexDirection="column" marginBottom={1}>
      <Show when={props.showHeader}>
        <box flexDirection="row" justifyContent="space-between">
          <text wrapMode="none" truncate>
            <span style={{ fg: theme.text.faint }}>{props.group.owner ? `${props.group.owner}/` : ""}</span>
            <span style={{ fg: theme.text.muted }}>
              <b>{props.group.name}</b>
            </span>
          </text>
          <text fg={theme.text.faint}>{props.group.items.length}</text>
        </box>
      </Show>
      <For each={props.group.items}>
        {(item, index) => (
          <ReviewRow
            item={item}
            index={index()}
            selected={props.selectedKey === item.key}
            isNew={props.newKeys.includes(item.key)}
            review={draftLabel(draftFor(props.drafts, item.key))}
            width={props.width}
            actions={props.actions}
          />
        )}
      </For>
    </box>
  )
}
