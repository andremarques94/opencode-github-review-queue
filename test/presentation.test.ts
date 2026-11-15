import { describe, expect, it } from "vitest"
import { type ReviewRequest, requestKey } from "../src/domain/review-request.js"
import {
  ago,
  escapeInlineFences,
  fitLine,
  groupByRepository,
  readinessMarks,
  readinessSummary,
  teamRequest,
} from "../src/shared/presentation.js"

const item = (repository: string, number: number): ReviewRequest => ({
  key: requestKey(repository, number),
  repository,
  number,
  title: `PR ${number}`,
  author: "octocat",
  draft: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  url: `https://github.com/${repository}/pull/${number}`,
})

describe("ago", () => {
  const created = "2026-01-01T00:00:00.000Z"

  it("says just now for recent requests", () => {
    expect(ago(created, Date.parse(created) + 10_000)).toBe("just now")
  })

  it("appends ago to older ages", () => {
    expect(ago(created, Date.parse(created) + 16 * 60_000)).toBe("16m ago")
  })
})

describe("groupByRepository", () => {
  it("groups case-insensitively in first-seen order", () => {
    const groups = groupByRepository([item("acme/api", 1), item("acme/web", 2), item("Acme/API", 3)])

    expect(groups.map((group) => [group.owner, group.name, group.items.map((entry) => entry.number)])).toEqual([
      ["acme", "api", [1, 3]],
      ["acme", "web", [2]],
    ])
  })
})

describe("fitLine", () => {
  it("keeps the first non-empty line and cuts it at the end", () => {
    expect(fitLine("\n`slice(tmp + 1)` drops the opening fence\nsecond", 20)).toBe("`slice(tmp + 1)` dr…")
    expect(fitLine("Short.  \nmore", 20)).toBe("Short.")
    expect(fitLine("", 20)).toBe("")
  })
})

describe("escapeInlineFences", () => {
  it("escapes fences inside a line and keeps fenced blocks", () => {
    expect(escapeInlineFences('returns ("a:\\n```tsx\\nx")')).toBe('returns ("a:\\n\\`\\`\\`tsx\\nx")')
    expect(escapeInlineFences("```ts\nconst a = 1\n  ```")).toBe("```ts\nconst a = 1\n  ```")
  })
})

describe("readiness", () => {
  it("shows nothing GitHub does not know", () => {
    expect(readinessMarks(item("acme/api", 1))).toEqual([])
    expect(readinessSummary(item("acme/api", 1))).toBeUndefined()
  })

  it("marks checks, conflicts, and unresolved threads", () => {
    const ready = { ...item("acme/api", 1), checks: "failing" as const, conflicts: true, unresolvedThreads: 1 }

    expect(readinessMarks(ready).map((mark) => mark.label)).toEqual(["✗", "conflicts", "1 thread"])
    expect(readinessSummary(ready)).toBe("Checks failing · Conflicts with the base branch · 1 unresolved review thread")
  })

  it("shows a capped thread count as a lower bound", () => {
    const busy = { ...item("acme/api", 1), unresolvedThreads: 1, unresolvedThreadsCapped: true }

    expect(readinessMarks(busy).map((mark) => mark.label)).toEqual(["1+ threads"])
    expect(readinessSummary(busy)).toBe("At least 1 unresolved review thread")
  })

  it("marks team requests and names the teams", () => {
    const one = { ...item("acme/api", 1), requestedVia: { kind: "team" as const, teams: ["acme/web"] } }
    const two = { ...item("acme/api", 2), requestedVia: { kind: "team" as const, teams: ["acme/web", "acme/api"] } }

    expect(teamRequest(one)).toEqual({ label: "via @web", detail: "Requested from @acme/web" })
    expect(teamRequest(two)).toEqual({ label: "via team", detail: "Requested from one of @acme/web, @acme/api" })
    expect(teamRequest({ ...item("acme/api", 3), requestedVia: { kind: "you" } })).toBeUndefined()
  })

  it("mentions a clean merge only in the summary", () => {
    const clean = { ...item("acme/api", 1), checks: "passing" as const, conflicts: false, unresolvedThreads: 0 }

    expect(readinessMarks(clean).map((mark) => mark.label)).toEqual(["✓"])
    expect(readinessSummary(clean)).toBe("Checks passing · No conflicts")
  })
})
