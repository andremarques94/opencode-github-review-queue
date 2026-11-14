import { describe, expect, it } from "vitest"
import { type ReviewRequest, requestKey } from "../src/domain/review-request.js"
import { ago, groupByRepository } from "../src/shared/presentation.js"

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
