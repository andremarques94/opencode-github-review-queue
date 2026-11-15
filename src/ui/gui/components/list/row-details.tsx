import { For } from "solid-js"
import type { Detail } from "../../../../shared/presentation.js"

export function RowDetails(props: { id: string; details: Detail[] }) {
  return (
    <dl class="grq-details" id={props.id}>
      <For each={props.details}>
        {(detail) => (
          <>
            <dt>{detail.label}</dt>
            <dd data-tone={detail.tone}>{detail.value}</dd>
          </>
        )}
      </For>
    </dl>
  )
}
