import { beforeEach, describe, expect, it, vi } from "vitest"

const runGh = vi.hoisted(() => vi.fn())

vi.mock("../src/server/github/cli.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/server/github/cli.js")>()),
  runGh,
}))

const { classifyGhError } = await import("../src/server/github/cli.js")
const { fetchAuthoredPullRequests, fetchReviewRequests, fetchReviewedPullRequests } = await import(
  "../src/server/github/review-requests.js"
)

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

  it("passes each search as a variable, never inside the query", async () => {
    respond([page([])])
    await fetchReviewRequests(signal)
    await fetchReviewedPullRequests(signal)

    const searches = runGh.mock.calls.map((call) => (call[0] as string[]).find((arg) => arg.startsWith("search=")))
    expect(searches).toEqual([
      "search=is:pr is:open review-requested:@me",
      "search=is:pr is:open reviewed-by:@me -review-requested:@me",
    ])
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
    expect(first).not.toHaveProperty("unresolvedThreadsCapped")
    for (const field of ["headSha", "checks", "conflicts", "unresolvedThreads"]) {
      expect(second).not.toHaveProperty(field)
    }
  })

  it("tells direct requests from team requests", async () => {
    const reviewers = (...requestedReviewer: unknown[]) => ({
      reviewRequests: { nodes: requestedReviewer.map((entry) => ({ requestedReviewer: entry })) },
    })
    const team = (slug: string) => ({ __typename: "Team", slug, organization: { login: "acme" } })
    const viewer = { __typename: "User", login: "Me" }
    respond([
      {
        data: {
          ...page([
            { ...node(1, "2026-01-01T00:00:00Z"), ...reviewers(team("web"), viewer) },
            { ...node(2, "2026-01-02T00:00:00Z"), ...reviewers(team("web"), team("api")) },
            { ...node(3, "2026-01-03T00:00:00Z"), ...reviewers(null, { __typename: "Bot", login: "copilot" }) },
          ]).data,
          viewer: { login: "me" },
        },
      },
    ])

    const [direct, teams, unknown] = (await fetchReviewRequests(signal)).items

    expect(direct?.requestedVia).toEqual({ kind: "you" })
    expect(teams?.requestedVia).toEqual({ kind: "team", teams: ["acme/web", "acme/api"] })
    expect(unknown).not.toHaveProperty("requestedVia")
  })

  it("reads the size, the last commit, and when the user or their team was last asked", async () => {
    const user = (login: string) => ({ __typename: "User", login })
    const team = { __typename: "Team", slug: "web", organization: { login: "acme" } }
    const asked = (createdAt: string, requestedReviewer: unknown) => ({ createdAt, requestedReviewer })
    respond([
      {
        data: {
          ...page([
            {
              ...node(1, "2026-01-01T00:00:00Z"),
              additions: 10,
              deletions: 2,
              changedFiles: 3,
              commits: { nodes: [{ commit: { committedDate: "2026-01-05T00:00:00Z", statusCheckRollup: null } }] },
              reviewRequests: { nodes: [{ requestedReviewer: user("me") }] },
              timelineItems: {
                nodes: [asked("2026-01-02T00:00:00Z", user("me")), asked("2026-01-03T00:00:00Z", user("other")), {}],
              },
            },
            {
              ...node(2, "2026-01-01T00:00:00Z"),
              reviewRequests: { nodes: [{ requestedReviewer: team }] },
              timelineItems: { nodes: [asked("2026-01-04T00:00:00Z", team), asked("2026-01-06T00:00:00Z", null)] },
            },
          ]).data,
          viewer: { login: "me" },
        },
      },
    ])

    const [mine, teams] = (await fetchReviewRequests(signal)).items

    expect(mine).toMatchObject({
      additions: 10,
      deletions: 2,
      changedFiles: 3,
      lastCommitAt: "2026-01-05T00:00:00Z",
      requestedAt: "2026-01-02T00:00:00Z",
    })
    expect(teams?.requestedAt).toBe("2026-01-04T00:00:00Z")
  })

  it("reads how the reviews of the user's own pull requests stand", async () => {
    respond([
      {
        data: {
          ...page([
            {
              ...node(1, "2026-01-01T00:00:00Z"),
              author: { login: "me" },
              reviewDecision: "CHANGES_REQUESTED",
              mergeStateStatus: "BLOCKED",
              reviewRequests: {
                nodes: [
                  { requestedReviewer: { __typename: "User", login: "bob" } },
                  { requestedReviewer: { __typename: "Team", slug: "web", organization: { login: "acme" } } },
                ],
              },
              latestReviews: {
                nodes: [
                  { state: "CHANGES_REQUESTED", author: { login: "alice" } },
                  { state: "APPROVED", author: { login: "carol" } },
                ],
              },
            },
            { ...node(2, "2026-01-02T00:00:00Z"), mergeStateStatus: "HAS_HOOKS" },
            { ...node(3, "2026-01-03T00:00:00Z"), mergeStateStatus: "UNKNOWN", reviewDecision: "SOMETHING_NEW" },
          ]).data,
          viewer: { login: "me" },
        },
      },
    ])

    const [blocked, ready, unknown] = (await fetchAuthoredPullRequests(signal)).items

    expect(blocked?.authored).toEqual({
      reviewDecision: "CHANGES_REQUESTED",
      mergeReady: false,
      waitingOn: ["bob", "acme/web"],
      changesRequestedBy: ["alice"],
    })
    expect(ready?.authored).toEqual({ mergeReady: true, waitingOn: [], changesRequestedBy: [] })
    expect(unknown?.authored).toEqual({ waitingOn: [], changesRequestedBy: [] })
    expect(runGh.mock.calls[0]?.[0]).toContain("search=is:pr is:open author:@me")
  })

  it("claims no source without the viewer's login", async () => {
    respond([
      page([
        {
          ...node(1, "2026-01-01T00:00:00Z"),
          reviewRequests: {
            nodes: [{ requestedReviewer: { __typename: "Team", slug: "web", organization: { login: "acme" } } }],
          },
        },
      ]),
    ])

    expect((await fetchReviewRequests(signal)).items[0]).not.toHaveProperty("requestedVia")
  })

  it("marks the thread count as a lower bound past the first page", async () => {
    const threads = (isResolved: boolean) => ({
      pageInfo: { hasNextPage: true },
      nodes: [{ isResolved }, { isResolved: true }],
    })
    respond([
      page([
        { ...node(1, "2026-01-01T00:00:00Z"), reviewThreads: threads(false) },
        { ...node(2, "2026-01-02T00:00:00Z"), reviewThreads: threads(true) },
      ]),
    ])

    const [some, none] = (await fetchReviewRequests(signal)).items

    expect(some).toMatchObject({ unresolvedThreads: 1, unresolvedThreadsCapped: true })
    expect(none).not.toHaveProperty("unresolvedThreads")
    expect(none).not.toHaveProperty("unresolvedThreadsCapped")
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
