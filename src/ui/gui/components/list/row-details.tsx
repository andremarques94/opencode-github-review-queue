import { For, Show } from "solid-js"
import type { Detail } from "../../../../shared/presentation.js"

export function RowDetails(props: { id: string; details: Detail[]; copy(text: string, name: string): void }) {
  return (
    <dl class="grq-details" id={props.id}>
      <For each={props.details}>
        {(detail) => (
          <>
            <dt>{detail.label}</dt>
            <dd data-tone={detail.tone} data-copyable={detail.copy ? "" : undefined}>
              <span>{detail.value}</span>
              <Show when={detail.copy}>
                {(name) => (
                  <button
                    type="button"
                    class="grq-detail-copy"
                    title={`Copy ${name().toLowerCase()}`}
                    aria-label={`Copy ${name().toLowerCase()}`}
                    onClick={() => props.copy(detail.value, name())}
                  >
                    Copy
                  </button>
                )}
              </Show>
            </dd>
          </>
        )}
      </For>
    </dl>
  )
}
