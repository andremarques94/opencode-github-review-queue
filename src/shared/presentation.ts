import { needsYou } from "../domain/my-pull-request.js"
import type { QueueSnapshot } from "../domain/review-queue.js"
import { type ReviewRequest, waitingSince } from "../domain/review-request.js"

/** **Mine** lists the user's own pull requests instead of the review queue. */
export type QueueFilter = "current" | "all" | "mine"

export function filterItems(
  state: Pick<QueueSnapshot, "items" | "authored">,
  filter: QueueFilter,
  repository?: string,
): ReviewRequest[] {
  switch (filter) {
    case "all":
      return [...state.items]
    case "mine":
      return [...(state.authored ?? [])]
    case "current":
      return repository ? state.items.filter((item) => item.repository.toLowerCase() === repository.toLowerCase()) : []
  }
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

/** All, Current, then Mine when the user's own pull requests are on. */
export function nextFilter(filter: QueueFilter, mine: boolean): QueueFilter {
  switch (filter) {
    case "all":
      return "current"
    case "current":
      return mine ? "mine" : "all"
    case "mine":
      return "all"
  }
}

export function emptyMessage(filter: QueueFilter): string {
  switch (filter) {
    case "all":
      return "You're all caught up."
    case "current":
      return "No review requests in this repository."
    case "mine":
      return "You have no open pull requests."
  }
}

/** How many of the user's own pull requests need them; undefined when that list is off. */
export const needingYou = (state: Pick<QueueSnapshot, "authored">): number | undefined =>
  state.authored?.filter(needsYou).length

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
    const detail = plural(item.unresolvedThreads, "unresolved review thread")
    marks.push(
      item.unresolvedThreadsCapped
        ? { label: `${item.unresolvedThreads}+ threads`, tone: "warning", detail: `At least ${detail}` }
        : { label: plural(item.unresolvedThreads, "thread"), tone: "warning", detail },
    )
  }
  return marks
}

const count = new Intl.NumberFormat("en-US")

export function sizeMark(item: ReviewRequest): { label: string; detail: string } | undefined {
  if (item.additions === undefined || item.deletions === undefined) {
    return undefined
  }
  const files = item.changedFiles === undefined ? "" : ` in ${plural(item.changedFiles, "file")}`
  return {
    label: `+${count.format(item.additions)} −${count.format(item.deletions)}`,
    detail: `${count.format(item.additions)} added, ${count.format(item.deletions)} removed${files}`,
  }
}

/** How long the pull request has waited on the user, flagged once it passes `staleAfterMs`. */
export function waitMark(
  item: ReviewRequest,
  staleAfterMs: number | undefined,
  now = Date.now(),
): { label: string; detail: string; stale: boolean } {
  const since = waitingSince(item)
  const known = item.followUp ? item.lastCommitAt : item.requestedAt
  const reason = !known ? "Opened" : item.followUp ? "New commits" : "Requested"
  return {
    label: ago(since, now),
    detail: `${reason} ${new Date(since).toLocaleString()}`,
    stale: staleAfterMs !== undefined && now - Date.parse(since) > staleAfterMs,
  }
}

/** Only team requests are marked: a direct request is what the queue is for. */
export function teamRequest(item: ReviewRequest): { label: string; detail: string } | undefined {
  if (item.requestedVia?.kind !== "team") {
    return undefined
  }
  const [first, ...rest] = item.requestedVia.teams
  if (first && rest.length === 0) {
    return { label: `via @${first.slice(first.indexOf("/") + 1)}`, detail: `Requested from @${first}` }
  }
  return {
    label: "via team",
    detail: `Requested from one of ${item.requestedVia.teams.map((team) => `@${team}`).join(", ")}`,
  }
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
