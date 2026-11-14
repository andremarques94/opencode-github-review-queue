import type { QueueFilter } from "@/shared/presentation.js"

export function ScopeToggle(props: { filter: QueueFilter; canFilter: boolean; setFilter(filter: QueueFilter): void }) {
  const segment = (value: QueueFilter, label: string, disabled = false) => (
    <button
      type="button"
      class="grq-segment-button"
      aria-pressed={props.filter === value}
      disabled={disabled}
      title={disabled ? "This session is not in a GitHub repository" : undefined}
      onClick={() => props.setFilter(value)}
    >
      {label}
    </button>
  )

  return (
    <fieldset class="grq-segment" aria-label="Scope">
      {segment("current", "Current", !props.canFilter)}
      {segment("all", "All")}
    </fieldset>
  )
}
