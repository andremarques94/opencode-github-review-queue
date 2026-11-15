import { beforeEach, describe, expect, it, vi } from "vitest"

const runGh = vi.hoisted(() => vi.fn())

vi.mock("../src/server/github/cli.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/server/github/cli.js")>()),
  runGh,
}))

const { classifyGhError } = await import("../src/server/github/cli.js")
const { checkGhVersion, discoverHosts, ghVersion } = await import("../src/server/github/hosts.js")
const { fetchOpenThreads, fetchPullRequestBranch } = await import("../src/server/github/pull-request.js")
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

    const result = await fetchReviewRequests("github.com", signal)

    expect(result.items.map((entry) => [entry.key, entry.author])).toEqual([
      ["acme/api#1", "octocat"],
      ["acme/api#2", "octocat"],
    ])
    expect(result.retryAt).toBeUndefined()
  })

  it("passes each search as a variable, never inside the query", async () => {
    respond([page([])])
    await fetchReviewRequests("github.com", signal)
    await fetchReviewedPullRequests("github.com", signal)

    const searches = runGh.mock.calls.map((call) => (call[0] as string[]).find((arg) => arg.startsWith("search=")))
    expect(searches).toEqual([
      "search=is:pr is:open review-requested:@me",
      "search=is:pr is:open reviewed-by:@me -review-requested:@me",
    ])
  })

  it("reports the reset time when the rate limit is exhausted", async () => {
    respond([page([], { remaining: 0, resetAt: "2026-01-01T01:00:00Z" })])

    expect((await fetchReviewRequests("github.com", signal)).retryAt).toBe("2026-01-01T01:00:00Z")
  })

  it("falls back to ghost for deleted authors", async () => {
    respond([page([{ ...node(3, "2026-01-01T00:00:00Z"), author: null }])])

    expect((await fetchReviewRequests("github.com", signal)).items[0]?.author).toBe("ghost")
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

    const [first, second] = (await fetchReviewRequests("github.com", signal)).items

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

    const [direct, teams, unknown] = (await fetchReviewRequests("github.com", signal)).items

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

    const [mine, teams] = (await fetchReviewRequests("github.com", signal)).items

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

    const [blocked, ready, unknown] = (await fetchAuthoredPullRequests("github.com", signal)).items

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

  it("reads each reviewer's latest review, without pending ones or deleted authors", async () => {
    const review = (state: string, login: string | null, submittedAt?: string) => ({
      state,
      submittedAt: submittedAt ?? null,
      author: login ? { login } : null,
    })
    respond([
      page([
        {
          ...node(1, "2026-01-01T00:00:00Z"),
          latestReviews: {
            nodes: [
              review("APPROVED", "alice", "2026-01-02T00:00:00Z"),
              review("COMMENTED", "bob"),
              review("PENDING", "me"),
              review("APPROVED", null),
            ],
          },
        },
        node(2, "2026-01-02T00:00:00Z"),
      ]),
    ])

    const [reviewed, unknown] = (await fetchReviewRequests("github.com", signal)).items

    expect(reviewed?.reviews).toEqual([
      { author: "alice", state: "APPROVED", submittedAt: "2026-01-02T00:00:00Z" },
      { author: "bob", state: "COMMENTED" },
    ])
    expect(unknown).not.toHaveProperty("reviews")
  })

  it("reads the review status, and a branch behind its base, on every pull request", async () => {
    respond([
      page([
        { ...node(1, "2026-01-01T00:00:00Z"), reviewDecision: "APPROVED", mergeStateStatus: "BEHIND" },
        { ...node(2, "2026-01-02T00:00:00Z"), reviewDecision: "SOMETHING_NEW", mergeStateStatus: "CLEAN" },
      ]),
    ])

    const [behind, clean] = (await fetchReviewRequests("github.com", signal)).items

    expect(behind).toMatchObject({ reviewDecision: "APPROVED", behind: true })
    expect(clean).not.toHaveProperty("reviewDecision")
    expect(clean).not.toHaveProperty("behind")
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

    expect((await fetchReviewRequests("github.com", signal)).items[0]).not.toHaveProperty("requestedVia")
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

    const [some, none] = (await fetchReviewRequests("github.com", signal)).items

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

    await expect(fetchReviewRequests("github.com", signal)).rejects.toMatchObject({
      detail: { kind: "unknown", message: `GitHub returned ${problem}; the saved queue was left unchanged.` },
    })
  })
})

describe("other hosts", () => {
  it("targets the host and qualifies the keys of its pull requests", async () => {
    respond([page([node(1, "2026-01-01T00:00:00Z")])])

    const [onEnterprise] = (await fetchReviewRequests("GHE.acme.com", signal)).items
    const [onGitHub] = (await fetchReviewRequests("github.com", signal)).items

    expect(onEnterprise).toMatchObject({ key: "ghe.acme.com/acme/api#1", host: "ghe.acme.com" })
    expect(onGitHub?.key).toBe("acme/api#1")
    expect(onGitHub).not.toHaveProperty("host")
    expect(runGh.mock.calls.map((call) => (call[0] as string[]).slice(0, 4))).toEqual([
      ["api", "graphql", "--hostname", "GHE.acme.com"],
      ["api", "graphql", "--hostname", "github.com"],
    ])
  })

  it("reads a reduced Enterprise Server node, without the readiness it lacks", async () => {
    respond([
      page([
        {
          ...node(1, "2026-01-01T00:00:00Z"),
          mergeable: "MERGEABLE",
          timelineItems: { nodes: [{}] },
          reviewRequests: null,
          reviewThreads: { nodes: [{ isResolved: false }] },
        },
      ]),
    ])

    const [item] = (await fetchReviewRequests("ghe.acme.com", signal)).items

    expect(item).toMatchObject({ host: "ghe.acme.com", conflicts: false, unresolvedThreads: 1 })
    for (const field of ["checks", "additions", "requestedAt", "requestedVia", "unresolvedThreadsCapped"]) {
      expect(item).not.toHaveProperty(field)
    }
  })

  it("names the host in every pull request command", async () => {
    respond({ state: "OPEN", headRefName: "main", isCrossRepository: false })
    await fetchPullRequestBranch({ host: "ghe.acme.com", repository: "acme/api", number: 7 }, signal)
    await fetchPullRequestBranch({ repository: "acme/api", number: 7 }, signal)

    expect(runGh.mock.calls.map((call) => (call[0] as string[])[4])).toEqual([
      "ghe.acme.com/acme/api",
      "github.com/acme/api",
    ])
  })
})

describe("discoverHosts", () => {
  const account = (host: string, state: string, active = true) => ({
    host,
    login: "me",
    active,
    state,
    token: "never read",
    scopes: "repo",
  })

  it("keeps each host by its active account, and a failed one with its error", async () => {
    respond({
      hosts: {
        "github.com": [account("github.com", "error", false), account("github.com", "success")],
        "ghe.acme.com": [{ ...account("ghe.acme.com", "error"), error: "HTTP 401: Bad credentials" }],
      },
    })

    expect(await discoverHosts(signal)).toEqual([
      { host: "github.com" },
      {
        host: "ghe.acme.com",
        error: {
          kind: "authentication",
          message: "GitHub authentication failed for ghe.acme.com. Run `gh auth login --hostname ghe.acme.com`.",
        },
      },
    ])
    expect(runGh.mock.calls[0]?.[0]).toEqual(["auth", "status", "--json", "hosts"])
  })

  it("tells a host it cannot reach from a rejected login", async () => {
    respond({
      hosts: {
        "github.com": [{ ...account("github.com", "error"), error: "dial tcp: lookup api.github.com: no such host" }],
        "ghe.acme.com": [account("ghe.acme.com", "timeout")],
        "ghe.other.com": [{ ...account("ghe.other.com", "error"), error: "HTTP 401: Bad credentials" }],
      },
    })

    const kinds = (await discoverHosts(signal)).map((host) => [host.host, host.error?.kind])

    expect(kinds).toEqual([
      ["github.com", "offline"],
      ["ghe.acme.com", "offline"],
      ["ghe.other.com", "authentication"],
    ])
  })

  it("asks to log in when gh knows no host", async () => {
    respond({ hosts: {} })

    await expect(discoverHosts(signal)).rejects.toMatchObject({ detail: { kind: "authentication" } })
  })

  it.each([
    ["malformed JSON", "{"],
    ["an unexpected shape", JSON.stringify({ hosts: "none" })],
  ])("rejects %s", async (_, stdout) => {
    runGh.mockResolvedValue({ stdout, stderr: "" })

    await expect(discoverHosts(signal)).rejects.toMatchObject({ detail: { kind: "unknown" } })
  })
})

describe("checkGhVersion", () => {
  const version = (stdout: string) => runGh.mockResolvedValue({ stdout, stderr: "" })

  it("refuses gh before 2.81.0 with the version it found", async () => {
    version("gh version 2.74.0 (2025-06-01)\nhttps://github.com/cli/cli/releases/tag/v2.74.0\n")

    await expect(checkGhVersion(signal)).rejects.toMatchObject({
      detail: {
        kind: "outdated-gh",
        message:
          "GitHub CLI 2.81.0 or later is required (found 2.74.0). Run `brew upgrade gh` or see https://cli.github.com.",
      },
    })
  })

  it.each(["gh version 2.81.0 (2025-10-01)", "gh version 3.0.0", "gh version 2.104.0 (2026-11-12)", "gh devel"])(
    "accepts %j",
    async (stdout) => {
      version(stdout)

      await expect(checkGhVersion(signal)).resolves.toBeUndefined()
    },
  )

  it.each([
    ["gh version 2.80.9", [2, 80, 9]],
    ["not gh", undefined],
  ])("parses %j", (output, expected) => {
    expect(ghVersion(output)).toEqual(expected)
  })
})

describe("addressing a review", () => {
  it("keeps only unresolved threads, without a line once the code moved on", async () => {
    const thread = (isResolved: boolean, line: number | null, body: string) => ({
      isResolved,
      isOutdated: line === null,
      path: "src/app.ts",
      line,
      comments: {
        nodes: [
          { author: { login: "alice" }, body },
          { author: null, body: "+1" },
        ],
      },
    })
    respond({
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: [thread(false, 3, "Name this."), thread(true, 4, "Done"), thread(false, null, "Why?")],
            },
          },
        },
      },
    })

    expect(await fetchOpenThreads({ repository: "acme/api", number: 7 }, signal)).toEqual([
      {
        path: "src/app.ts",
        line: 3,
        outdated: false,
        comments: [
          { author: "alice", body: "Name this." },
          { author: "ghost", body: "+1" },
        ],
      },
      { path: "src/app.ts", outdated: true, comments: expect.any(Array) },
    ])
    expect(runGh.mock.calls[0]?.[0]).toEqual(expect.arrayContaining(["owner=acme", "name=api", "number=7"]))
  })

  it("refuses a branch name git could read as an option", async () => {
    const branch = (headRefName: string) => respond({ state: "OPEN", headRefName, isCrossRepository: false })

    branch("feature/b")
    expect((await fetchPullRequestBranch({ repository: "acme/api", number: 7 }, signal)).headRefName).toBe("feature/b")
    for (const name of ["--upload-pack=evil", "a..b", "feature/", "x.lock", "has space"]) {
      branch(name)
      await expect(fetchPullRequestBranch({ repository: "acme/api", number: 7 }, signal)).rejects.toThrow(
        /unexpected response/,
      )
    }
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
