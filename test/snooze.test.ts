import { describe, expect, it, vi } from "vitest"
import type { ReviewRequest } from "../src/domain/review-request.js"
import {
  parseSnoozeTime,
  type Snooze,
  Snooze as SnoozeSchema,
  snoozing,
  tomorrowMorning,
} from "../src/domain/snooze.js"
import { KeyedStore } from "../src/server/keyed-store.js"
import { pruneSnoozes } from "../src/server/snoozes.js"
import { rowLabel } from "../src/shared/review/draft-status.js"
import { hideSnoozed, type SnoozeFlowHost, snoozeFlow } from "../src/shared/review/snooze.js"

const NOW = new Date(2026, 10, 15, 10, 0).getTime()
const HEAD = "a".repeat(40)

const item = (number: number, overrides: Partial<ReviewRequest> = {}): ReviewRequest => ({
  key: `acme/api#${number}`,
  repository: "acme/api",
  number,
  title: `PR ${number}`,
  author: "octocat",
  draft: false,
  createdAt: "2026-01-01T00:00:00Z",
  url: `https://github.com/acme/api/pull/${number}`,
  headSha: HEAD,
  ...overrides,
})

const snooze = (number: number, until: Snooze["until"]): Snooze => ({
  version: 1,
  key: `acme/api#${number}`,
  until,
  createdAt: new Date(NOW).toISOString(),
})

describe("snoozing", () => {
  it("wakes once checks finish", () => {
    const waiting = snooze(1, { kind: "checks" })

    expect(snoozing(waiting, item(1, { checks: "pending" }), NOW)).toBe(true)
    expect(snoozing(waiting, item(1, { checks: "failing" }), NOW)).toBe(false)
    expect(snoozing(waiting, item(1), NOW)).toBe(false)
  })

  it("wakes once the author pushes", () => {
    const waiting = snooze(1, { kind: "push", headSha: HEAD })

    expect(snoozing(waiting, item(1), NOW)).toBe(true)
    expect(snoozing(waiting, item(1, { headSha: "b".repeat(40) }), NOW)).toBe(false)
  })

  it("wakes at its time", () => {
    const waiting = snooze(1, { kind: "time", at: new Date(NOW + 60_000).toISOString() })

    expect(snoozing(waiting, item(1), NOW)).toBe(true)
    expect(snoozing(waiting, item(1), NOW + 60_000)).toBe(false)
  })
})

describe("parseSnoozeTime", () => {
  it.each([
    ["45m", NOW + 45 * 60_000],
    ["3h", NOW + 3 * 3_600_000],
    ["2d", NOW + 2 * 86_400_000],
    ["14:30", new Date(2026, 10, 15, 14, 30).getTime()],
    ["09:15", new Date(2026, 10, 16, 9, 15).getTime()],
    ["2026-11-20T09:00", new Date(2026, 10, 20, 9, 0).getTime()],
  ])("reads %j", (text, expected) => {
    expect(parseSnoozeTime(text, NOW)?.getTime()).toBe(expected)
  })

  it.each(["", "soon", "0h", "-2h", "25:00", "2020-01-01"])("rejects %j", (text) => {
    expect(parseSnoozeTime(text, NOW)).toBeUndefined()
  })

  it("puts tomorrow at 9:00", () => {
    expect(tomorrowMorning(NOW).getTime()).toBe(new Date(2026, 10, 16, 9, 0).getTime())
  })
})

describe("queue view", () => {
  const snoozes = [snooze(1, { kind: "push", headSha: HEAD }), snooze(2, { kind: "checks" })]
  const items = [item(1), item(2, { checks: "passing" }), item(3)]

  it("hides snoozed pull requests and counts them", () => {
    expect(hideSnoozed(items, snoozes, false, NOW)).toEqual({ items: [items[1], items[2]], snoozed: 1 })
    expect(hideSnoozed(items, snoozes, true, NOW)).toEqual({ items, snoozed: 1 })
  })

  it("labels a shown snoozed row next to its review status", () => {
    const local = { drafts: [], reviewed: [], snoozes }

    expect(rowLabel(items[0] as ReviewRequest, local, NOW)).toBe("snoozed until the author pushes")
    expect(rowLabel(items[1] as ReviewRequest, local, NOW)).toBeUndefined()
  })
})

describe("snoozeFlow", () => {
  const host = (choose: (titles: string[]) => number, typed?: string) => {
    const flow: SnoozeFlowHost = {
      select: vi.fn(async ({ options }: { options: { title: string; value: unknown }[] }) => {
        return options[choose(options.map((option) => option.title))]?.value
      }) as SnoozeFlowHost["select"],
      prompt: vi.fn(async () => typed),
      notify: vi.fn(),
      snooze: vi.fn(async (input) => ({
        drafts: [],
        reviewed: [],
        snoozes: [{ version: 1 as const, key: input.key, until: input.until, createdAt: "" }],
      })),
    }
    return flow
  }

  it("offers waiting on checks only while they run", async () => {
    const flow = host(() => 0)

    await snoozeFlow(flow, item(1, { checks: "pending" }), () => NOW)
    await snoozeFlow(flow, item(1, { checks: "passing" }), () => NOW)

    const titles = vi.mocked(flow.select).mock.calls.map(([input]) => input.options.map((option) => option.title))
    expect(titles[0]).toEqual([
      "Until checks finish",
      "Until the author pushes",
      "For 1 hour",
      "Until tomorrow",
      "Until…",
    ])
    expect(titles[1]?.[0]).toBe("Until the author pushes")
    expect(vi.mocked(flow.snooze).mock.calls[0]?.[0]).toEqual({ key: "acme/api#1", until: { kind: "checks" } })
  })

  it("reads a custom time", async () => {
    const flow = host((titles) => titles.indexOf("Until…"), "2h")

    await snoozeFlow(flow, item(1), () => NOW)

    expect(vi.mocked(flow.snooze).mock.calls[0]?.[0].until).toEqual({
      kind: "time",
      at: new Date(NOW + 2 * 3_600_000).toISOString(),
    })
  })

  it("refuses a custom time in the past", async () => {
    const flow = host((titles) => titles.indexOf("Until…"), "2020-01-01")

    await expect(snoozeFlow(flow, item(1), () => NOW)).rejects.toThrow(/not a future time/)
    expect(flow.snooze).not.toHaveBeenCalled()
  })
})

describe("pruneSnoozes", () => {
  it("drops snoozes that woke and those of pull requests that left the queue", async () => {
    const values = new Map<string, unknown>()
    const store = new KeyedStore<Snooze>(SnoozeSchema, {
      get: async (key) => values.get(key),
      list: async () => [...values.values()],
      save: async (key, value) => void values.set(key, value),
      remove: async (key) => void values.delete(key),
    })
    await store.put(snooze(1, { kind: "push", headSha: HEAD }))
    await store.put(snooze(2, { kind: "checks" }))
    await store.put(snooze(3, { kind: "push", headSha: HEAD }))

    await pruneSnoozes(store, [item(1), item(2, { checks: "passing" })], NOW)

    expect((await store.list()).map((entry) => entry.key)).toEqual(["acme/api#1"])
  })
})
