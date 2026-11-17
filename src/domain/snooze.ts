import * as v from "valibot"
import { parseDuration } from "./duration.js"
import { qualifiedRepository, type RepositoryRef, type ReviewRequest } from "./review-request.js"

export const SnoozeUntil = v.variant("kind", [
  v.object({ kind: v.literal("checks") }),
  v.object({ kind: v.literal("push"), headSha: v.string() }),
  v.object({ kind: v.literal("time"), at: v.string() }),
])
export type SnoozeUntil = v.InferOutput<typeof SnoozeUntil>

export const Snooze = v.object({
  version: v.literal(1),
  key: v.string(),
  until: SnoozeUntil,
  createdAt: v.string(),
})
export type Snooze = v.InferOutput<typeof Snooze>

export const snoozeFor = (snoozes: readonly Snooze[], key: string) => snoozes.find((snooze) => snooze.key === key)

const REPOSITORY_PREFIX = "repo:"

/** Pull request keys always hold a `#`, so this key never matches one. */
export const repositorySnoozeKey = (ref: RepositoryRef) =>
  `${REPOSITORY_PREFIX}${qualifiedRepository(ref).toLowerCase()}`

export const isRepositorySnooze = (snooze: Snooze) => snooze.key.startsWith(REPOSITORY_PREFIX)

/** A repository snooze only ends with time, so it covers pull requests that arrive while it lasts. */
export function snoozeOf(snoozes: readonly Snooze[], item: ReviewRequest, now: number): Snooze | undefined {
  const own = snoozeFor(snoozes, item.key)
  if (snoozing(own, item, now)) {
    return own
  }
  const repository = snoozeFor(snoozes, repositorySnoozeKey(item))
  return snoozing(repository, item, now) ? repository : undefined
}

export function snoozing(snooze: Snooze | undefined, item: ReviewRequest, now: number): snooze is Snooze {
  if (!snooze) {
    return false
  }
  switch (snooze.until.kind) {
    case "checks":
      return item.checks === "pending"
    case "push":
      return item.headSha === undefined || item.headSha === snooze.until.headSha
    case "time":
      return Date.parse(snooze.until.at) > now
  }
}

const MORNING_HOUR = 9

export function tomorrowMorning(now: number): Date {
  const date = new Date(now)
  date.setDate(date.getDate() + 1)
  date.setHours(MORNING_HOUR, 0, 0, 0)
  return date
}

const within = (value: number | undefined, max: number): value is number =>
  value !== undefined && Number.isInteger(value) && value >= 0 && value <= max

function clockTime(text: string, now: number): Date | undefined {
  const [hours, minutes, extra] = text.split(":").map(Number)
  if (extra !== undefined || !within(hours, 23) || !within(minutes, 59)) {
    return undefined
  }
  const date = new Date(now)
  date.setHours(hours, minutes, 0, 0)
  if (date.getTime() <= now) {
    date.setDate(date.getDate() + 1)
  }
  return date
}

/**
 * A custom snooze time: a duration such as `45m`, `3h` or `2d`, a clock time such as `14:30` (the next one), or a
 * date and time JavaScript can parse, such as `2026-11-20 09:00`. Only future times count.
 */
export function parseSnoozeTime(input: string, now: number): Date | undefined {
  const duration = parseDuration(input)
  if (duration !== undefined) {
    return new Date(now + duration)
  }
  const parsed = clockTime(input.trim().toLowerCase(), now) ?? new Date(Date.parse(input.trim()))
  return parsed.getTime() > now ? parsed : undefined
}
