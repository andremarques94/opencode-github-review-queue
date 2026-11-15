import { describe, expect, it } from "vitest"
import { type ReviewRequest, requestKey } from "../src/domain/review-request.js"
import {
  ago,
  escapeInlineFences,
  filterItems,
  fitLine,
  groupByRepository,
  pullRequestDetails,
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

  it("keeps a repository of the same name on another host apart", () => {
    const enterprise = { ...item("acme/api", 2), host: "ghe.acme.com", key: requestKey("acme/api", 2, "ghe.acme.com") }

    const groups = groupByRepository([item("acme/api", 1), enterprise])

    expect(groups.map((group) => group.repository)).toEqual(["acme/api", "ghe.acme.com/acme/api"])
  })
})

describe("pullRequestDetails", () => {
  const now = Date.parse("2026-01-03T00:00:00.000Z")
  const rows = (details: ReturnType<typeof pullRequestDetails>) => details.map((detail) => [detail.label, detail.value])

  it("spells out what the row's marks and tooltips say, and who reviewed", () => {
    const details = pullRequestDetails(
      {
        ...item("acme/api", 1),
        additions: 120,
        deletions: 30,
        changedFiles: 4,
        checks: "failing",
        conflicts: false,
        unresolvedThreads: 2,
        requestedVia: { kind: "team", teams: ["acme/web"] },
        requestedAt: "2026-01-02T00:00:00.000Z",
        reviews: [
          { author: "alice", state: "APPROVED", submittedAt: "2026-01-02T12:00:00.000Z" },
          { author: "bob", state: "CHANGES_REQUESTED", submittedAt: "2026-01-02T18:00:00.000Z" },
          { author: "carol", state: "COMMENTED" },
        ],
      },
      { verdict: "APPROVE", postedAt: "2026-01-01T00:00:00.000Z" },
      now,
    )

    expect(rows(details)).toEqual([
      ["Author", "@octocat, opened 2d ago"],
      ["Changes", "120 added, 30 removed in 4 files"],
      ["Checks", "failing"],
      ["Merge", "No conflicts"],
      ["Threads", "2 unresolved"],
      ["Requested", "@acme/web, 1d ago"],
      ["Approved by", "@alice"],
      ["Changes requested by", "@bob"],
      ["Commented", "@carol"],
      ["Last review", "@bob requested changes 6h ago"],
      ["Your review", "Approved 2d ago"],
    ])
    expect(details.find((detail) => detail.label === "Checks")?.tone).toBe("error")
  })

  it("shows the host, draft state, last commit, review status, and a branch behind its base", () => {
    const details = pullRequestDetails(
      {
        ...item("acme/api", 1),
        host: "ghe.acme.com",
        draft: true,
        lastCommitAt: "2026-01-02T21:00:00.000Z",
        conflicts: false,
        behind: true,
        reviewDecision: "REVIEW_REQUIRED",
      },
      undefined,
      now,
    )

    expect(rows(details)).toEqual([
      ["Author", "@octocat, opened 2d ago"],
      ["Host", "ghe.acme.com"],
      ["Draft", "Not ready for review yet"],
      ["Last commit", "3h ago"],
      ["Merge", "Behind the base branch; needs a rebase or merge"],
      ["Review status", "Review required"],
    ])
  })

  it("leaves out what GitHub did not report", () => {
    expect(rows(pullRequestDetails(item("acme/api", 1), undefined, now))).toEqual([
      ["Author", "@octocat, opened 2d ago"],
    ])
  })

  it("says who your own pull request waits on", () => {
    const mine = {
      ...item("acme/api", 1),
      authored: { waitingOn: ["bob", "acme/web"], changesRequestedBy: [] },
    }

    expect(rows(pullRequestDetails(mine, undefined, now))).toContainEqual(["Waiting on", "@bob, @acme/web"])
  })
})

describe("filterItems", () => {
  it("matches the current checkout's host as well as its repository", () => {
    const enterprise = { ...item("acme/api", 2), host: "ghe.acme.com", key: requestKey("acme/api", 2, "ghe.acme.com") }
    const state = { items: [item("acme/api", 1), enterprise] }

    expect(filterItems(state, "current", "ghe.acme.com/acme/api").map((entry) => entry.number)).toEqual([2])
    expect(filterItems(state, "current", "acme/api").map((entry) => entry.number)).toEqual([1])
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

  it("marks a branch behind its base, unless conflicts already say more", () => {
    const behind = { ...item("acme/api", 1), conflicts: false, behind: true as const }

    expect(readinessMarks(behind).map((mark) => mark.label)).toEqual(["behind"])
    expect(readinessSummary(behind)).toBe("Behind the base branch; needs a rebase or merge")
    expect(readinessMarks({ ...behind, conflicts: true }).map((mark) => mark.label)).toEqual(["conflicts"])
  })

  it("mentions a clean merge only in the summary", () => {
    const clean = { ...item("acme/api", 1), checks: "passing" as const, conflicts: false, unresolvedThreads: 0 }

    expect(readinessMarks(clean).map((mark) => mark.label)).toEqual(["✓"])
    expect(readinessSummary(clean)).toBe("Checks passing · No conflicts")
  })
})
