import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ReviewedRecord } from "../src/domain/review-history.js"
import { type ReviewRequest, requestKey } from "../src/domain/review-request.js"
import { parseOptions } from "../src/shared/options.js"

const github = vi.hoisted(() => ({
  fetchReviewRequests: vi.fn(),
  fetchReviewedPullRequests: vi.fn(),
  fetchAuthoredPullRequests: vi.fn(),
}))

vi.mock("../src/server/github/review-requests.js", () => github)

const { queueSource } = await import("../src/server/queue-source.js")

const OLD_HEAD = "a".repeat(40)
const NEW_HEAD = "b".repeat(40)

const item = (number: number, extra: Partial<ReviewRequest> = {}): ReviewRequest => ({
  key: requestKey("acme/api", number),
  repository: "acme/api",
  number,
  title: `PR ${number}`,
  author: "octocat",
  draft: false,
  createdAt: `2026-01-0${number}T00:00:00.000Z`,
  url: `https://github.com/acme/api/pull/${number}`,
  headSha: NEW_HEAD,
  ...extra,
})

const record = (number: number): ReviewedRecord => ({
  version: 1,
  key: requestKey("acme/api", number),
  repository: "acme/api",
  number,
  headSha: OLD_HEAD,
  verdict: "COMMENT",
  postedUrl: `https://github.com/acme/api/pull/${number}#pullrequestreview-1`,
  postedAt: "2026-01-01T00:00:00.000Z",
})

const records = (...entries: ReviewedRecord[]) => ({ list: async () => entries })
const signal = new AbortController().signal
const numbers = (items: readonly ReviewRequest[]) => items.map((entry) => [entry.number, entry.followUp ?? false])

beforeEach(() => {
  github.fetchReviewRequests.mockReset().mockResolvedValue({ items: [] })
  github.fetchReviewedPullRequests.mockReset().mockResolvedValue({ items: [] })
  github.fetchAuthoredPullRequests.mockReset().mockResolvedValue({ items: [] })
})

describe("queueSource", () => {
  it("adds reviewed pull requests with commits since the posted review", async () => {
    github.fetchReviewRequests.mockResolvedValue({ items: [item(2)] })
    github.fetchReviewedPullRequests.mockResolvedValue({
      items: [item(1), item(3, { headSha: OLD_HEAD }), item(4)],
    })

    const result = await queueSource(parseOptions({}), records(record(1), record(3)))(signal)

    // #3 has no new commits and #4 was reviewed outside the plugin, so neither is a follow-up.
    expect(numbers(result.items)).toEqual([
      [1, true],
      [2, false],
    ])
  })

  it("lets a request win over a follow-up, and drops the teams of a follow-up", async () => {
    const team = { requestedVia: { kind: "team" as const, teams: ["acme/web"] } }
    github.fetchReviewRequests.mockResolvedValue({ items: [item(1)] })
    github.fetchReviewedPullRequests.mockResolvedValue({ items: [item(1), item(2, team)] })

    const result = await queueSource(parseOptions({ teamRequests: "hide" }), records(record(1), record(2)))(signal)

    expect(numbers(result.items)).toEqual([
      [1, false],
      [2, true],
    ])
    expect(result.items[1]).not.toHaveProperty("requestedVia")
  })

  it("skips the second search without a posted review, or when follow-ups are off", async () => {
    await queueSource(parseOptions({}), records())(signal)
    await queueSource(parseOptions({ followUps: false }), records(record(1)))(signal)

    expect(github.fetchReviewedPullRequests).not.toHaveBeenCalled()
  })

  it("applies the queue rules to follow-ups too", async () => {
    github.fetchReviewedPullRequests.mockResolvedValue({ items: [item(1, { author: "dependabot" })] })

    const result = await queueSource(parseOptions({ excludeAuthors: ["dependabot"] }), records(record(1)))(signal)

    expect(result.items).toEqual([])
  })

  it("waits for the later rate-limit reset", async () => {
    github.fetchReviewRequests.mockResolvedValue({ items: [], retryAt: "2026-01-01T01:00:00Z" })
    github.fetchReviewedPullRequests.mockResolvedValue({ items: [], retryAt: "2026-01-01T02:00:00Z" })

    expect((await queueSource(parseOptions({}), records(record(1)))(signal)).retryAt).toBe("2026-01-01T02:00:00Z")
  })

  it("lists the user's own pull requests apart from the queue, unless turned off", async () => {
    github.fetchAuthoredPullRequests.mockResolvedValue({ items: [item(5, { author: "dependabot" })] })

    const on = await queueSource(parseOptions({ excludeAuthors: ["dependabot"] }), records())(signal)
    const off = await queueSource(parseOptions({ myPullRequests: false }), records())(signal)

    expect(on.authored?.map((entry) => entry.number)).toEqual([5])
    expect(on.items).toEqual([])
    expect(off).not.toHaveProperty("authored")
    expect(github.fetchAuthoredPullRequests).toHaveBeenCalledTimes(1)
  })

  it("fails the refresh when the follow-up search fails", async () => {
    github.fetchReviewedPullRequests.mockRejectedValue(new Error("boom"))

    await expect(queueSource(parseOptions({}), records(record(1)))(signal)).rejects.toThrow("boom")
  })
})
