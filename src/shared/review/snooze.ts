import type { ReviewRequest } from "../../domain/review-request.js"
import { qualifiedRepository } from "../../domain/review-request.js"
import {
  isRepositorySnooze,
  parseSnoozeTime,
  repositorySnoozeKey,
  type Snooze,
  type SnoozeUntil,
  snoozeFor,
  snoozeOf,
  tomorrowMorning,
} from "../../domain/snooze.js"
import { fullReference } from "../presentation.js"
import type { LocalReviews, RpcInput } from "../rpc.js"
import type { SelectOption } from "./flows.js"

export type SnoozeFlowHost = {
  select<T>(input: { title: string; options: SelectOption<T>[]; current?: T }): Promise<T | undefined>
  prompt(input: { title: string; description: string; placeholder: string }): Promise<string | undefined>
  notify(message: string): void
  snooze(input: RpcInput<"snooze">): Promise<LocalReviews>
  snoozeRepository(input: RpcInput<"snoozeRepository">): Promise<LocalReviews>
}

const HOUR = 60 * 60_000
const CUSTOM = "custom"

const timeLabel = (at: string | Date, now: number) => {
  const date = new Date(at)
  const sameDay = date.toDateString() === new Date(now).toDateString()
  return date.toLocaleString(undefined, {
    ...(sameDay ? {} : { weekday: "short", month: "short", day: "numeric" }),
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function snoozeLabel(snooze: Snooze, now = Date.now()): string {
  const label = untilLabel(snooze, now)
  return isRepositorySnooze(snooze) ? `with its repository ${label}` : label
}

function untilLabel(snooze: Snooze, now: number): string {
  switch (snooze.until.kind) {
    case "checks":
      return "until checks finish"
    case "push":
      return "until the author pushes"
    case "time":
      return `until ${timeLabel(snooze.until.at, now)}`
  }
}

function timeOptions(now: number): SelectOption<SnoozeUntil | typeof CUSTOM>[] {
  const time = (at: Date) => ({ kind: "time" as const, at: at.toISOString() })
  const tomorrow = tomorrowMorning(now)
  return [
    { title: "For 1 hour", value: time(new Date(now + HOUR)), description: timeLabel(new Date(now + HOUR), now) },
    { title: "Until tomorrow", value: time(tomorrow), description: timeLabel(tomorrow, now) },
    { title: "Until…", value: CUSTOM, description: "A duration, a time, or a date" },
  ]
}

/** Only conditions GitHub can report: waiting on checks needs running checks, waiting on a push needs the head. */
function snoozeOptions(item: ReviewRequest, now: number): SelectOption<SnoozeUntil | typeof CUSTOM>[] {
  return [
    ...(item.checks === "pending" ? [{ title: "Until checks finish", value: { kind: "checks" as const } }] : []),
    ...(item.headSha
      ? [{ title: "Until the author pushes", value: { kind: "push" as const, headSha: item.headSha } }]
      : []),
    ...timeOptions(now),
  ]
}

async function customTime(host: SnoozeFlowHost, now: () => number): Promise<SnoozeUntil | undefined> {
  const text = await host.prompt({
    title: "Snooze until",
    description: "A duration such as 45m, 3h or 2d, a time such as 14:30, or a date such as 2026-11-20 09:00.",
    placeholder: "3h",
  })
  if (text === undefined) {
    return undefined
  }
  const at = parseSnoozeTime(text, now())
  if (!at) {
    throw new Error(`"${text}" is not a future time. Try 3h, 14:30, or 2026-11-20 09:00.`)
  }
  return { kind: "time", at: at.toISOString() }
}

export async function snoozeFlow(
  host: SnoozeFlowHost,
  item: ReviewRequest,
  now: () => number = Date.now,
): Promise<LocalReviews | undefined> {
  const choice = await host.select({ title: `Snooze ${fullReference(item)}`, options: snoozeOptions(item, now()) })
  const until = choice === CUSTOM ? await customTime(host, now) : choice
  if (!until) {
    return undefined
  }
  const local = await host.snooze({ key: item.key, until })
  const snooze = snoozeFor(local.snoozes, item.key)
  host.notify(snooze ? `Snoozed ${fullReference(item)} ${snoozeLabel(snooze, now())}` : "Snoozed")
  return local
}

/** Only time: checks and pushes belong to one pull request. New requests in the repository stay snoozed too. */
export async function snoozeRepositoryFlow(
  host: SnoozeFlowHost,
  item: ReviewRequest,
  now: () => number = Date.now,
): Promise<LocalReviews | undefined> {
  const repository = qualifiedRepository(item)
  const choice = await host.select({ title: `Snooze every pull request in ${repository}`, options: timeOptions(now()) })
  const until = choice === CUSTOM ? await customTime(host, now) : choice
  if (until?.kind !== "time") {
    return undefined
  }
  const local = await host.snoozeRepository({ key: item.key, at: until.at })
  const snooze = snoozeFor(local.snoozes, repositorySnoozeKey(item))
  host.notify(snooze ? `Snoozed ${repository} ${untilLabel(snooze, now())}` : "Snoozed")
  return local
}

// Timed snoozes wake between queue updates, which may be minutes apart.
const CLOCK_MS = 30_000

export function watchClock(update: (now: number) => void): () => void {
  const timer = setInterval(() => update(Date.now()), CLOCK_MS)
  return () => clearInterval(timer)
}

export type QueueView = { items: ReviewRequest[]; snoozed: number }

export function hideSnoozed(
  items: readonly ReviewRequest[],
  snoozes: readonly Snooze[],
  show: boolean,
  now: number,
): QueueView {
  const asleep = items.filter((item) => snoozeOf(snoozes, item, now))
  return { items: show ? [...items] : items.filter((item) => !asleep.includes(item)), snoozed: asleep.length }
}

export const activeSnooze = snoozeOf

/** Whether a pull request that just arrived should notify: not while its repository is snoozed. */
export const awake = (snoozes: readonly Snooze[], item: ReviewRequest, now = Date.now()) =>
  snoozeOf(snoozes, item, now) === undefined

export const snoozedToggleLabel = (view: QueueView, shown: boolean) =>
  shown ? `${view.snoozed} snoozed, shown` : `${view.snoozed} snoozed`
