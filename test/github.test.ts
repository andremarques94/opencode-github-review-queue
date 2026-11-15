import { beforeEach, describe, expect, it, vi } from "vitest"

const runGh = vi.hoisted(() => vi.fn())

vi.mock("../src/server/github/cli.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/server/github/cli.js")>()),
  runGh,
}))

const { classifyGhError } = await import("../src/server/github/cli.js")
const { fetchReviewRequests } = await import("../src/server/github/review-requests.js")

const node = (number: number, createdAt: string) => ({
  number,
  title: `PR ${number}`,
  url: `https://github.com/acme/api/pull/${number}`,
  createdAt,
  isDraft: false,
  author: { login: "octocat" },
  repository: { nameWithOwner: "acme/api" },
})
const page = (nodes: unknown[], rateLimit = { remaining: 10, resetAt: "2026-01-01T01:00:00Z" }) => ({
  data: { search: { nodes }, rateLimit },
})
const respond = (value: unknown) => runGh.mockResolvedValue({ stdout: JSON.stringify(value), stderr: "" })
const signal = new AbortController().signal

beforeEach(() => {
  runGh.mockReset()
})

describe("fetchReviewRequests", () => {
  it("collects every page sorted by creation time", async () => {
    respond([page([node(2, "2026-01-02T00:00:00Z")]), page([node(1, "2026-01-01T00:00:00Z")])])

    const result = await fetchReviewRequests(signal)

    expect(result.items.map((entry) => [entry.key, entry.author])).toEqual([
      ["acme/api#1", "octocat"],
      ["acme/api#2", "octocat"],
    ])
    expect(result.retryAt).toBeUndefined()
  })

  it("reports the reset time when the rate limit is exhausted", async () => {
    respond([page([], { remaining: 0, resetAt: "2026-01-01T01:00:00Z" })])

    expect((await fetchReviewRequests(signal)).retryAt).toBe("2026-01-01T01:00:00Z")
  })

  it("falls back to ghost for deleted authors", async () => {
    respond([page([{ ...node(3, "2026-01-01T00:00:00Z"), author: null }])])

    expect((await fetchReviewRequests(signal)).items[0]?.author).toBe("ghost")
  })

  it("reads readiness and leaves out what GitHub does not know", async () => {
    respond([
      page([
        {
          ...node(1, "2026-01-01T00:00:00Z"),
          headRefOid: "head1",
          baseRefOid: "base1",
          mergeable: "CONFLICTING",
          commits: { nodes: [{ commit: { statusCheckRollup: { state: "ERROR" } } }] },
          reviewThreads: { nodes: [{ isResolved: false }, { isResolved: true }, { isResolved: false }] },
        },
        {
          ...node(2, "2026-01-02T00:00:00Z"),
          mergeable: "UNKNOWN",
          commits: { nodes: [{ commit: { statusCheckRollup: null } }] },
          reviewThreads: "unexpected",
        },
      ]),
    ])

    const [first, second] = (await fetchReviewRequests(signal)).items

    expect(first).toMatchObject({
      headSha: "head1",
      baseSha: "base1",
      checks: "failing",
      conflicts: true,
      unresolvedThreads: 2,
    })
    for (const field of ["headSha", "checks", "conflicts", "unresolvedThreads"]) {
      expect(second).not.toHaveProperty(field)
    }
  })

  it.each([
    ["malformed JSON", "{", "malformed JSON"],
    ["a non-array response", "{}", "an incomplete response"],
    ["GraphQL errors", JSON.stringify([{ errors: [{ message: "boom" }] }]), "a partial GraphQL response"],
    ["a missing search", JSON.stringify([{ data: {} }]), "a partial response"],
    ["an incomplete pull request", JSON.stringify([page([{ number: 1 }])]), "a partial pull request"],
  ])("rejects %s without replacing the queue", async (_, stdout, problem) => {
    runGh.mockResolvedValue({ stdout, stderr: "" })

    await expect(fetchReviewRequests(signal)).rejects.toMatchObject({
      detail: { kind: "unknown", message: `GitHub returned ${problem}; the saved queue was left unchanged.` },
    })
  })
})

describe("classifyGhError", () => {
  it.each([
    ["HTTP 401: Bad credentials", "authentication"],
    ["could not resolve host: api.github.com", "offline"],
    ["HTTP 403: Forbidden", "unavailable"],
    ["something else entirely", "unknown"],
  ])("classifies %j as %s", (stderr, kind) => {
    expect(classifyGhError(stderr).detail.kind).toBe(kind)
  })

  it("derives the retry time from a rate-limit response", () => {
    const now = Date.now()
    const detail = classifyGhError("API rate limit exceeded. Retry-After: 30").detail

    expect(detail.kind).toBe("rate-limit")
    expect(Date.parse(detail.retryAt ?? "") - now).toBeGreaterThanOrEqual(29_000)
  })

  it("keeps the first line of an unknown failure", () => {
    expect(classifyGhError("boom\nstack").detail.message).toBe("GitHub request failed: boom")
  })
})
