import { Show } from "solid-js"
import type { QueueFilter } from "../../../../shared/presentation.js"

export function ScopeToggle(props: {
  filter: QueueFilter
  canFilter: boolean
  /** Undefined when the user's own pull requests are turned off. */
  mine: number | undefined
  setFilter(filter: QueueFilter): void
}) {
  const segment = (value: QueueFilter, label: string, disabled = false, title?: string) => (
    <button
      type="button"
      class="grq-segment-button"
      aria-pressed={props.filter === value}
      disabled={disabled}
      title={disabled ? "This session is not in a GitHub repository" : title}
      onClick={() => props.setFilter(value)}
    >
      {label}
    </button>
  )

  return (
    <fieldset class="grq-segment" aria-label="Scope">
      {segment("current", "Current", !props.canFilter)}
      {segment("all", "All")}
      <Show when={props.mine !== undefined}>
        {segment(
          "mine",
          props.mine ? `Mine ${props.mine}` : "Mine",
          false,
          props.mine ? `${props.mine} of your pull requests need you` : "Your open pull requests",
        )}
      </Show>
    </fieldset>
  )
}
