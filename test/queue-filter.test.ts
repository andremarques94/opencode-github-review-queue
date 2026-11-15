import { describe, expect, it } from "vitest"
import { applyQueueRules, type QueueRules } from "../src/domain/queue-filter.js"
import { type ReviewRequest, requestKey } from "../src/domain/review-request.js"
import { parseOptions } from "../src/shared/options.js"

const item = (repository: string, number: number, extra: Partial<ReviewRequest> = {}): ReviewRequest => ({
  key: requestKey(repository, number),
  repository,
  number,
  title: `PR ${number}`,
  author: "octocat",
  draft: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  url: `https://github.com/${repository}/pull/${number}`,
  ...extra,
})

const everything: QueueRules = {
  includeDrafts: true,
  excludeAuthors: [],
  excludeRepositories: [],
  teamRequests: "show",
}
const numbers = (items: readonly ReviewRequest[]) => items.map((entry) => entry.number)

describe("applyQueueRules", () => {
  it("keeps everything by default", () => {
    const items = [item("acme/api", 1, { draft: true }), item("acme/api", 2)]

    expect(applyQueueRules(items, parseOptions({}))).toEqual(items)
  })

  it("hides drafts when asked", () => {
    const items = [item("acme/api", 1, { draft: true }), item("acme/api", 2)]

    expect(numbers(applyQueueRules(items, { ...everything, includeDrafts: false }))).toEqual([2])
  })

  it("matches authors case-insensitively, with or without the bot suffix", () => {
    const items = [
      item("acme/api", 1, { author: "dependabot" }),
      item("acme/api", 2, { author: "Renovate" }),
      item("acme/api", 3),
    ]

    const rules = { ...everything, excludeAuthors: ["dependabot[bot]", "renovate"] }

    expect(numbers(applyQueueRules(items, rules))).toEqual([3])
  })

  it("excludes exact repositories and whole owners", () => {
    const items = [item("acme/api", 1), item("Acme/Legacy", 2), item("other/web", 3), item("acme-labs/x", 4)]

    const rules = { ...everything, excludeRepositories: ["acme/legacy", "other/*"] }

    expect(numbers(applyQueueRules(items, rules))).toEqual([1, 4])
  })

  it("hides known team requests only", () => {
    const items = [
      item("acme/api", 1, { requestedVia: { kind: "team", teams: ["acme/web"] } }),
      item("acme/api", 2, { requestedVia: { kind: "you" } }),
      item("acme/api", 3),
    ]

    expect(numbers(applyQueueRules(items, { ...everything, teamRequests: "hide" }))).toEqual([2, 3])
  })
})

describe("queue options", () => {
  it("reads lists and the team setting, ignoring anything malformed", () => {
    const options = parseOptions({
      includeDrafts: false,
      excludeAuthors: [" dependabot ", 3, ""],
      excludeRepositories: "acme/legacy",
      teamRequests: "HIDE",
    })

    expect(options).toMatchObject({
      includeDrafts: false,
      excludeAuthors: ["dependabot"],
      excludeRepositories: [],
      teamRequests: "show",
    })
  })
})
