import { needsYou, type ReviewDecision } from "../domain/my-pull-request.js"
import type { Verdict } from "../domain/review-draft.js"
import type { QueueSnapshot } from "../domain/review-queue.js"
import {
  qualifiedRepository,
  type Review,
  type ReviewRequest,
  type ReviewState,
  waitingSince,
} from "../domain/review-request.js"

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
      return repository
        ? state.items.filter((item) => qualifiedRepository(item).toLowerCase() === repository.toLowerCase())
        : []
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

export const needingYou = (state: Pick<QueueSnapshot, "authored">): number | undefined =>
  state.authored?.filter(needsYou).length

export function elapsedLabel(startedAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1_000))
  const minutes = Math.floor(seconds / 60)
  return minutes > 0 ? `(${minutes}m ${String(seconds % 60).padStart(2, "0")}s)` : `(${seconds}s)`
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
    const key = qualifiedRepository(item).toLowerCase()
    let group = groups.get(key)
    if (!group) {
      const slash = item.repository.indexOf("/")
      group = {
        repository: qualifiedRepository(item),
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

const BEHIND = "Behind the base branch; needs a rebase or merge"

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
  if (item.behind && !item.conflicts) {
    marks.push({ label: "behind", tone: "warning", detail: BEHIND })
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

export type Detail = { label: string; value: string; tone?: ReadinessMark["tone"] }

const handles = (logins: readonly string[]) => logins.map((login) => `@${login}`).join(", ")

const REVIEW_VERBS: Record<ReviewState, string> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "requested changes",
  COMMENTED: "commented",
  DISMISSED: "had a review dismissed",
}

const VERDICT_VERBS: Record<Verdict, string> = {
  APPROVE: "Approved",
  REQUEST_CHANGES: "Requested changes",
  COMMENT: "Commented",
}

function reviewDetails(reviews: readonly Review[], now: number): Detail[] {
  const by = (state: ReviewState) => reviews.filter((review) => review.state === state).map((review) => review.author)
  const details: Detail[] = []
  const rows = [
    ["Approved by", by("APPROVED"), "success"],
    ["Changes requested by", by("CHANGES_REQUESTED"), "error"],
    ["Commented", by("COMMENTED"), undefined],
  ] as const
  for (const [label, logins, tone] of rows) {
    if (logins.length > 0) {
      details.push({ label, value: handles(logins), ...(tone ? { tone } : {}) })
    }
  }
  const last = reviews
    .filter((review) => review.submittedAt)
    .sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? ""))[0]
  if (last?.submittedAt) {
    details.push({
      label: "Last review",
      value: `@${last.author} ${REVIEW_VERBS[last.state]} ${ago(last.submittedAt, now)}`,
    })
  }
  return details
}

const DECISIONS: Record<ReviewDecision, Omit<Detail, "label">> = {
  APPROVED: { value: "Approved", tone: "success" },
  CHANGES_REQUESTED: { value: "Changes requested", tone: "error" },
  REVIEW_REQUIRED: { value: "Review required" },
}

function mergeDetail(item: ReviewRequest): Detail | undefined {
  if (item.conflicts) {
    return { label: "Merge", value: "Conflicts with the base branch", tone: "error" }
  }
  if (item.behind) {
    return { label: "Merge", value: BEHIND, tone: "warning" }
  }
  return item.conflicts === false ? { label: "Merge", value: "No conflicts" } : undefined
}

function requestDetail(item: ReviewRequest, now: number): Detail | undefined {
  if (item.authored) {
    const waiting = item.authored.waitingOn
    return waiting.length > 0 ? { label: "Waiting on", value: handles(waiting) } : undefined
  }
  if (item.followUp) {
    return { label: "Follow-up", value: "New commits since your review" }
  }
  const from = item.requestedVia?.kind === "you" ? "you" : teamRequest(item)?.detail.replace(/^Requested from /, "")
  const when = item.requestedAt ? ago(item.requestedAt, now) : undefined
  const value = [from, when].filter((part) => part !== undefined).join(", ")
  return value ? { label: "Requested", value } : undefined
}

/** Everything the row's marks and tooltips say, spelled out; facts GitHub did not report are left out. */
export function pullRequestDetails(
  item: ReviewRequest,
  reviewed: { verdict: Verdict; postedAt: string } | undefined,
  now = Date.now(),
): Detail[] {
  const details: Detail[] = [{ label: "Author", value: `@${item.author}, opened ${ago(item.createdAt, now)}` }]
  if (item.host) {
    details.push({ label: "Host", value: item.host })
  }
  if (item.draft) {
    details.push({ label: "Draft", value: "Not ready for review yet", tone: "warning" })
  }
  if (item.lastCommitAt) {
    details.push({ label: "Last commit", value: ago(item.lastCommitAt, now) })
  }
  const size = sizeMark(item)
  if (size) {
    details.push({ label: "Changes", value: size.detail })
  }
  if (item.checks) {
    const mark = CHECK_MARKS[item.checks]
    details.push({ label: "Checks", value: mark.detail.replace(/^Checks /, ""), tone: mark.tone })
  }
  const merge = mergeDetail(item)
  if (merge) {
    details.push(merge)
  }
  if (item.unresolvedThreads !== undefined) {
    const count = `${item.unresolvedThreads}${item.unresolvedThreadsCapped ? "+" : ""} unresolved`
    details.push({ label: "Threads", value: item.unresolvedThreads === 0 ? "All resolved" : count })
  }
  const request = requestDetail(item, now)
  if (request) {
    details.push(request)
  }
  if (item.reviewDecision) {
    details.push({ label: "Review status", ...DECISIONS[item.reviewDecision] })
  }
  details.push(...reviewDetails(item.reviews ?? [], now))
  if (reviewed) {
    details.push({ label: "Your review", value: `${VERDICT_VERBS[reviewed.verdict]} ${ago(reviewed.postedAt, now)}` })
  }
  return details
}

export function readinessSummary(item: ReviewRequest): string | undefined {
  const details = readinessMarks(item).map((mark) => mark.detail)
  if (item.conflicts === false && !item.behind) {
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
