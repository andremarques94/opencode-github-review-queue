import { parseDuration } from "../domain/duration.js"
import type { QueueRules } from "../domain/queue-filter.js"
import type { QueueSort } from "../domain/queue-order.js"

export type PluginOptions = QueueRules & {
  intervalMs: number
  timeoutMs: number
  maxBackoffMs: number
  notifications: boolean
  keepClones: boolean
  followUps: boolean
  sort: QueueSort
  /** How long a pull request may wait before its age is highlighted. */
  staleAfterMs?: number
  cacheDirectory?: string
  reviewGuidelines?: string
}

const SORTS: readonly QueueSort[] = ["oldest", "ready", "smallest"]

const sortOption = (value: unknown): QueueSort => SORTS.find((sort) => sort === value) ?? "oldest"

function staleOption(value: unknown) {
  const staleAfterMs = typeof value === "string" ? parseDuration(value) : undefined
  return staleAfterMs === undefined ? {} : { staleAfterMs }
}

const numberOption = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback

const pathOption = (key: "cacheDirectory" | "reviewGuidelines", value: unknown) =>
  typeof value === "string" && value.trim() ? { [key]: value.trim() } : {}

const listOption = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "")
        .map((entry) => entry.trim())
    : []

export function parseOptions(input: Readonly<Record<string, unknown>>): PluginOptions {
  return {
    intervalMs: Math.max(10_000, numberOption(input.intervalMs, 60_000)),
    timeoutMs: Math.max(1_000, numberOption(input.timeoutMs, 20_000)),
    maxBackoffMs: Math.max(60_000, numberOption(input.maxBackoffMs, 15 * 60_000)),
    notifications: input.notifications !== false,
    keepClones: input.keepClones === true,
    followUps: input.followUps !== false,
    sort: sortOption(input.sort),
    ...staleOption(input.staleAfter),
    includeDrafts: input.includeDrafts !== false,
    excludeAuthors: listOption(input.excludeAuthors),
    excludeRepositories: listOption(input.excludeRepositories),
    teamRequests: input.teamRequests === "hide" ? "hide" : "show",
    ...pathOption("cacheDirectory", input.cacheDirectory),
    ...pathOption("reviewGuidelines", input.reviewGuidelines),
  }
}
