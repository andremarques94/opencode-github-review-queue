import { describe, expect, it } from "vitest"
import { type ReviewRequest, requestKey } from "../src/domain/review-request.js"
import { ago, escapeInlineFences, fitLine, groupByRepository } from "../src/shared/presentation.js"

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
