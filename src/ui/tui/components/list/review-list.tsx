/** @jsxImportSource @opentui/solid */

import type { ScrollBoxRenderable } from "@opentui/core"
import { createEffect, For } from "solid-js"
import type { ReviewRequest } from "../../../../domain/review-request.js"
import type { RepositoryGroup } from "../../../../shared/presentation.js"
import type { ReviewActions } from "../../actions/review-actions.js"
import { ReviewGroup } from "./review-group.js"
import { rowID } from "./review-row.js"

export function ReviewList(props: {
  groups: RepositoryGroup[]
  grouped: boolean
  selectedKey: string | undefined
  newKeys: readonly string[]
  label(item: ReviewRequest): string | undefined
  width: number
  actions: ReviewActions
}) {
  let scroll: ScrollBoxRenderable | undefined

  createEffect(() => {
    const key = props.selectedKey
    if (key) {
      scroll?.scrollChildIntoView(rowID(key))
    }
  })

  return (
    <scrollbox
      ref={(element: ScrollBoxRenderable) => {
        scroll = element
      }}
      flexGrow={1}
      marginTop={1}
    >
      <For each={props.groups}>
        {(group) => (
          <ReviewGroup
            group={group}
            showHeader={props.grouped}
            selectedKey={props.selectedKey}
            newKeys={props.newKeys}
            label={props.label}
            width={props.width}
            actions={props.actions}
          />
        )}
      </For>
    </scrollbox>
  )
}
