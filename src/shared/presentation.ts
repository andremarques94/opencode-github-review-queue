import type { QueueSnapshot } from "../domain/review-queue.js"
import type { ReviewRequest } from "../domain/review-request.js"

export type QueueFilter = "current" | "all"

export function filterItems(
  items: readonly ReviewRequest[],
  filter: QueueFilter,
  repository?: string,
): ReviewRequest[] {
  if (filter === "all") {
    return [...items]
  }
  if (!repository) {
    return []
  }
  return items.filter((item) => item.repository.toLowerCase() === repository.toLowerCase())
}

function age(createdAt: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(createdAt)) / 1_000))
  if (seconds < 60) {
    return "now"
  }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return `${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours}h`
  }
  const days = Math.floor(hours / 24)
  if (days < 30) {
    return `${days}d`
  }
  return `${Math.floor(days / 30)}mo`
}

export function ago(createdAt: string, now = Date.now()): string {
  const value = age(createdAt, now)
  return value === "now" ? "just now" : `${value} ago`
}

export type RepositoryGroup = {
  repository: string
  owner: string
  name: string
  items: ReviewRequest[]
}

export function groupByRepository(items: readonly ReviewRequest[]): RepositoryGroup[] {
  const groups = new Map<string, RepositoryGroup>()
  for (const item of items) {
    const key = item.repository.toLowerCase()
    let group = groups.get(key)
    if (!group) {
      const slash = item.repository.indexOf("/")
      group = {
        repository: item.repository,
        owner: slash === -1 ? "" : item.repository.slice(0, slash),
        name: slash === -1 ? item.repository : item.repository.slice(slash + 1),
        items: [],
      }
      groups.set(key, group)
    }
    group.items.push(item)
  }
  return [...groups.values()]
}

export function refreshLabel(state: QueueSnapshot): string {
  if (!state.lastSuccessAt) {
    return "Never refreshed"
  }
  return `Updated ${age(state.lastSuccessAt)}`
}

export const fullReference = (item: ReviewRequest): string => `${item.repository}#${item.number}`

export type ReadinessMark = { label: string; tone: "success" | "error" | "warning"; detail: string }

const CHECK_MARKS = {
  passing: { label: "✓", tone: "success", detail: "Checks passing" },
  failing: { label: "✗", tone: "error", detail: "Checks failing" },
  pending: { label: "●", tone: "warning", detail: "Checks running" },
} as const satisfies Record<NonNullable<ReviewRequest["checks"]>, ReadinessMark>

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`

/** What GitHub knows about a pull request's readiness; anything it does not know is left out, not guessed. */
export function readinessMarks(item: ReviewRequest): ReadinessMark[] {
  const marks: ReadinessMark[] = []
  if (item.checks) {
    marks.push(CHECK_MARKS[item.checks])
  }
  if (item.conflicts) {
    marks.push({ label: "conflicts", tone: "error", detail: "Conflicts with the base branch" })
  }
  if (item.unresolvedThreads) {
    marks.push({
      label: plural(item.unresolvedThreads, "thread"),
      tone: "warning",
      detail: plural(item.unresolvedThreads, "unresolved review thread"),
    })
  }
  return marks
}

export function readinessSummary(item: ReviewRequest): string | undefined {
  const details = readinessMarks(item).map((mark) => mark.detail)
  if (item.conflicts === false) {
    details.push("No conflicts")
  }
  return details.length > 0 ? details.join(" · ") : undefined
}

/** Cuts at the end: OpenTUI's own `truncate` cuts in the middle of the line. */
export function fitLine(text: string, width: number): string {
  const line = text.split("\n").find((candidate) => candidate.trim() !== "") ?? ""
  const characters = Array.from(line.trimEnd())
  if (characters.length <= width) {
    return characters.join("")
  }
  return `${characters.slice(0, Math.max(0, width - 1)).join("")}…`
}

const FENCE = "```"

/**
 * Agents quote test inputs as escaped strings such as `"a:\n```tsx\n…"`, and Markdown pairs those mid-line backticks
 * into stray code spans. Escaping every fence that does not open its line shows them as written, while real fenced
 * blocks still render. Only for local text: a posted comment must stay exactly as written.
 */
export function escapeInlineFences(markdown: string): string {
  return markdown
    .split("\n")
    .map((line) => {
      const indent = line.length - line.trimStart().length
      const opening = line.trimStart().startsWith(FENCE) ? indent + FENCE.length : 0
      return line.slice(0, opening) + line.slice(opening).replaceAll(FENCE, "\\`\\`\\`")
    })
    .join("\n")
}
