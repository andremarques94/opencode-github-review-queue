import { describe, expect, it } from "vitest"
import { type Authored, myNotices, myStatus, myStatusLabel } from "../src/domain/my-pull-request.js"
import { type ReviewRequest, requestKey } from "../src/domain/review-request.js"
import { myUpdate, myUpdateText } from "../src/shared/notifications/notification-text.js"
import { filterItems, needingYou, nextFilter } from "../src/shared/presentation.js"
import { reviewLabel } from "../src/shared/review/draft-status.js"

const mine = (number: number, authored: Partial<Authored> = {}, extra: Partial<ReviewRequest> = {}): ReviewRequest => ({
  key: requestKey("acme/api", number),
  repository: "acme/api",
  number,
  title: `PR ${number}`,
  author: "me",
  draft: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  url: `https://github.com/acme/api/pull/${number}`,
  authored: { waitingOn: [], changesRequestedBy: [], ...authored },
  ...extra,
})

describe("myStatus", () => {
  it("puts changes requested before anything else but a draft", () => {
    const requested = { reviewDecision: "CHANGES_REQUESTED" as const, mergeReady: true }

    expect(myStatus(mine(1, requested, { checks: "failing" }))).toBe("changes-requested")
    expect(myStatus(mine(1, requested, { draft: true }))).toBe("draft")
  })

  it("is blocked by conflicts or failing checks, then ready when GitHub can merge it", () => {
    expect(myStatus(mine(1, { mergeReady: true }, { conflicts: true }))).toBe("blocked")
    expect(myStatus(mine(1, { mergeReady: true }, { checks: "failing" }))).toBe("blocked")
    expect(myStatus(mine(1, { mergeReady: true, reviewDecision: "APPROVED" }))).toBe("ready-to-merge")
    expect(myStatus(mine(1, { mergeReady: false, reviewDecision: "APPROVED" }))).toBe("approved")
    expect(myStatus(mine(1, { reviewDecision: "REVIEW_REQUIRED" }))).toBe("waiting")
  })

  it("is nothing for a review request", () => {
    const { authored: _, ...request } = mine(1)

    expect(myStatus(request)).toBeUndefined()
  })
})

describe("myStatusLabel", () => {
  it("names who requested changes, or who it waits on", () => {
    expect(myStatusLabel(mine(1, { reviewDecision: "CHANGES_REQUESTED", changesRequestedBy: ["alice"] }))).toBe(
      "changes requested by @alice",
    )
    expect(myStatusLabel(mine(1, { waitingOn: ["bob", "acme/web"] }))).toBe("waiting on @bob, @acme/web")
    expect(myStatusLabel(mine(1))).toBe("no reviewers requested")
    expect(myStatusLabel(mine(1, {}, { draft: true }))).toBeUndefined()
  })

  it("is the row label, unless a review of it is in progress", () => {
    const item = mine(1, { mergeReady: true })

    expect(reviewLabel(item, undefined, undefined)).toBe("ready to merge")
  })
})

describe("myNotices", () => {
  it("notices changes requested, ready to merge, and checks that start failing", () => {
    const before = [mine(1), mine(2), mine(3, {}, { checks: "passing" }), mine(4, { mergeReady: true })]
    const after = [
      mine(1, { reviewDecision: "CHANGES_REQUESTED" }),
      mine(2, { mergeReady: true }),
      mine(3, {}, { checks: "failing" }),
      mine(4, { mergeReady: true }),
      mine(5, { mergeReady: true }),
    ]

    expect(myNotices(before, after)).toEqual([
      { key: "acme/api#1", kind: "changes-requested" },
      { key: "acme/api#2", kind: "ready-to-merge" },
      { key: "acme/api#3", kind: "checks-failed" },
    ])
  })

  it("says nothing about checks GitHub did not report before", () => {
    expect(myNotices([mine(1)], [mine(1, {}, { checks: "failing" })])).toEqual([])
  })
})

describe("the Mine scope", () => {
  const { authored: _, ...request } = mine(9)
  const state = { items: [request], authored: [mine(1)] }

  it("lists the user's own pull requests, and counts those that need them", () => {
    expect(filterItems(state, "mine").map((item) => item.number)).toEqual([1])
    expect(needingYou({ authored: [mine(1, { mergeReady: true }), mine(2)] })).toBe(1)
    expect(needingYou({})).toBeUndefined()
  })

  it("is reachable only when turned on", () => {
    expect(nextFilter("current", true)).toBe("mine")
    expect(nextFilter("current", false)).toBe("all")
    expect(nextFilter("mine", true)).toBe("all")
  })

  it("words one update, and a batch", () => {
    const changes = myUpdate(
      { key: "acme/api#1", kind: "changes-requested" },
      mine(1, { changesRequestedBy: ["alice"] }),
    )
    const ready = myUpdate({ key: "acme/api#2", kind: "ready-to-merge" }, mine(2))

    expect(myUpdateText([changes])).toEqual({ title: "@alice requested changes · api #1", message: "PR 1" })
    expect(myUpdateText([changes, ready])).toEqual({
      title: "2 updates on your pull requests",
      message: "api #1 @alice requested changes, api #2 ready to merge",
    })
  })
})
