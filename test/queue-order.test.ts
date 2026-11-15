import { describe, expect, it } from "vitest"
import { parseDuration } from "../src/domain/duration.js"
import { sortQueue } from "../src/domain/queue-order.js"
import { type ReviewRequest, requestKey, waitingSince } from "../src/domain/review-request.js"
import { parseOptions } from "../src/shared/options.js"
import { sizeMark, waitMark } from "../src/shared/presentation.js"

const item = (number: number, extra: Partial<ReviewRequest> = {}): ReviewRequest => ({
  key: requestKey("acme/api", number),
  repository: "acme/api",
  number,
  title: `PR ${number}`,
  author: "octocat",
  draft: false,
  createdAt: `2026-01-0${number}T00:00:00.000Z`,
  url: `https://github.com/acme/api/pull/${number}`,
  ...extra,
})

const numbers = (items: readonly ReviewRequest[]) => items.map((entry) => entry.number)

describe("waitingSince", () => {
  it("waits from the request, a follow-up from its last commit, and falls back to creation", () => {
    const commit = { lastCommitAt: "2026-02-02T00:00:00.000Z", requestedAt: "2026-02-01T00:00:00.000Z" }

    expect(waitingSince(item(1, commit))).toBe("2026-02-01T00:00:00.000Z")
    expect(waitingSince(item(1, { ...commit, followUp: true }))).toBe("2026-02-02T00:00:00.000Z")
    expect(waitingSince(item(1))).toBe("2026-01-01T00:00:00.000Z")
  })
})

describe("sortQueue", () => {
  it("puts the longest wait first", () => {
    const items = [item(1, { requestedAt: "2026-03-01T00:00:00.000Z" }), item(2), item(3)]

    expect(numbers(sortQueue(items, "oldest"))).toEqual([2, 3, 1])
  })

  it("puts the smallest first, unknown sizes last", () => {
    const items = [item(1), item(2, { additions: 500, deletions: 0 }), item(3, { additions: 5, deletions: 5 })]

    expect(numbers(sortQueue(items, "smallest"))).toEqual([3, 2, 1])
  })

  it("puts passing pull requests without conflicts first, smallest among them", () => {
    const small = { additions: 1, deletions: 0 }
    const items = [
      item(1, { ...small, checks: "failing" }),
      item(2, { checks: "passing", additions: 300, deletions: 0 }),
      item(3, { ...small, checks: "passing", conflicts: true }),
      item(4, { ...small, checks: "passing", conflicts: false }),
    ]

    expect(numbers(sortQueue(items, "ready"))).toEqual([4, 2, 1, 3])
  })
})

describe("durations and wait options", () => {
  it("parses minutes, hours, and days, and nothing else", () => {
    expect(parseDuration("45m")).toBe(45 * 60_000)
    expect(parseDuration(" 2D ")).toBe(2 * 24 * 60 * 60_000)
    for (const input of ["", "d", "0h", "-1d", "2w", "two days"]) {
      expect(parseDuration(input)).toBeUndefined()
    }
  })

  it("reads the sort and stale options, falling back on anything unknown", () => {
    expect(parseOptions({ sort: "ready", staleAfter: "2d" })).toMatchObject({
      sort: "ready",
      staleAfterMs: 172_800_000,
    })
    expect(parseOptions({ sort: "newest", staleAfter: 3 })).toMatchObject({ sort: "oldest" })
    expect(parseOptions({ staleAfter: "soon" })).not.toHaveProperty("staleAfterMs")
  })
})

describe("row marks", () => {
  it("shows the size, and nothing when GitHub did not say", () => {
    expect(sizeMark(item(1, { additions: 1_200, deletions: 30, changedFiles: 4 }))).toEqual({
      label: "+1,200 −30",
      detail: "1,200 added, 30 removed in 4 files",
    })
    expect(sizeMark(item(1))).toBeUndefined()
  })

  it("flags a wait past the stale threshold", () => {
    const now = Date.parse("2026-01-04T00:00:00.000Z")
    const requested = item(1, { requestedAt: "2026-01-01T00:00:00.000Z" })

    expect(waitMark(requested, 2 * 24 * 60 * 60_000, now)).toMatchObject({ label: "3d ago", stale: true })
    expect(waitMark(requested, 4 * 24 * 60 * 60_000, now).stale).toBe(false)
    expect(waitMark(requested, undefined, now).stale).toBe(false)
    expect(waitMark(requested, undefined, now).detail).toMatch(/^Requested /)
    // A follow-up without a commit date waits from creation, and says so.
    expect(waitMark({ ...requested, followUp: true }, undefined, now).detail).toMatch(/^Opened /)
    const pushed = { ...requested, followUp: true as const, lastCommitAt: "2026-01-03T00:00:00.000Z" }
    expect(waitMark(pushed, undefined, now)).toMatchObject({ label: "1d ago" })
    expect(waitMark(pushed, undefined, now).detail).toMatch(/^New commits /)
  })
})
