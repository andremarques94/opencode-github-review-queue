import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ReviewedRecord } from "../src/domain/review-history.js"
import { type ReviewRequest, requestKey } from "../src/domain/review-request.js"
import { GhError } from "../src/server/github/cli.js"
import type { FetchContext } from "../src/server/review-queue-poller.js"
import { parseOptions } from "../src/shared/options.js"

const github = vi.hoisted(() => ({
  fetchReviewRequests: vi.fn(),
  fetchReviewedPullRequests: vi.fn(),
  fetchAuthoredPullRequests: vi.fn(),
}))
const hosts = vi.hoisted(() => ({ checkGhVersion: vi.fn(), discoverHosts: vi.fn() }))

vi.mock("../src/server/github/review-requests.js", () => github)
vi.mock("../src/server/github/hosts.js", () => hosts)

const { queueSource } = await import("../src/server/queue-source.js")

const OLD_HEAD = "a".repeat(40)
const NEW_HEAD = "b".repeat(40)
const ENTERPRISE = "ghe.acme.com"

const item = (number: number, extra: Partial<ReviewRequest> = {}): ReviewRequest => ({
  key: requestKey("acme/api", number, extra.host),
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
const onEnterprise = (number: number) => item(number, { host: ENTERPRISE })

const record = (number: number, host?: string): ReviewedRecord => ({
  version: 1,
  key: requestKey("acme/api", number, host),
  ...(host ? { host } : {}),
  repository: "acme/api",
  number,
  headSha: OLD_HEAD,
  verdict: "COMMENT",
  postedUrl: `https://github.com/acme/api/pull/${number}#pullrequestreview-1`,
  postedAt: "2026-01-01T00:00:00.000Z",
})

const records = (...entries: ReviewedRecord[]) => ({ list: async () => entries })
const signal = new AbortController().signal
const context = (extra: Partial<FetchContext> = {}): FetchContext => ({
  manual: false,
  previous: { items: [] },
  ...extra,
})
const numbers = (items: readonly ReviewRequest[]) => items.map((entry) => [entry.number, entry.followUp ?? false])
const offline = (host: string) =>
  new GhError({
    kind: "offline",
    message: `GitHub is unreachable (${host}). The last successful queue is still shown.`,
  })

/** Answers each search by host, so one host can fail while another works. */
const byHost = (answers: Record<string, ReviewRequest[] | Error>) => async (host: string) => {
  const answer = answers[host] ?? []
  if (answer instanceof Error) {
    throw answer
  }
  return { items: answer }
}

beforeEach(() => {
  github.fetchReviewRequests.mockReset().mockResolvedValue({ items: [] })
  github.fetchReviewedPullRequests.mockReset().mockResolvedValue({ items: [] })
  github.fetchAuthoredPullRequests.mockReset().mockResolvedValue({ items: [] })
  hosts.checkGhVersion.mockReset().mockResolvedValue(undefined)
  hosts.discoverHosts.mockReset().mockResolvedValue([{ host: "github.com" }])
})

describe("queueSource", () => {
  it("adds reviewed pull requests with commits since the posted review", async () => {
    github.fetchReviewRequests.mockResolvedValue({ items: [item(2)] })
    github.fetchReviewedPullRequests.mockResolvedValue({
      items: [item(1), item(3, { headSha: OLD_HEAD }), item(4)],
    })

    const result = await queueSource(parseOptions({}), records(record(1), record(3)))(signal, context())

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

    const source = queueSource(parseOptions({ teamRequests: "hide" }), records(record(1), record(2)))
    const result = await source(signal, context())

    expect(numbers(result.items)).toEqual([
      [1, false],
      [2, true],
    ])
    expect(result.items[1]).not.toHaveProperty("requestedVia")
  })

  it("skips the second search without a posted review, or when follow-ups are off", async () => {
    await queueSource(parseOptions({}), records())(signal, context())
    await queueSource(parseOptions({ followUps: false }), records(record(1)))(signal, context())

    expect(github.fetchReviewedPullRequests).not.toHaveBeenCalled()
  })

  it("applies the queue rules to follow-ups too", async () => {
    github.fetchReviewedPullRequests.mockResolvedValue({ items: [item(1, { author: "dependabot" })] })

    const source = queueSource(parseOptions({ excludeAuthors: ["dependabot"] }), records(record(1)))

    expect((await source(signal, context())).items).toEqual([])
  })

  it("waits for the later rate-limit reset", async () => {
    github.fetchReviewRequests.mockResolvedValue({ items: [], retryAt: "2026-01-01T01:00:00Z" })
    github.fetchReviewedPullRequests.mockResolvedValue({ items: [], retryAt: "2026-01-01T02:00:00Z" })

    const result = await queueSource(parseOptions({}), records(record(1)))(signal, context())

    expect(result.retryAt).toBe("2026-01-01T02:00:00Z")
  })

  it("lists the user's own pull requests apart from the queue, unless turned off", async () => {
    github.fetchAuthoredPullRequests.mockResolvedValue({ items: [item(5, { author: "dependabot" })] })

    const on = await queueSource(parseOptions({ excludeAuthors: ["dependabot"] }), records())(signal, context())
    const off = await queueSource(parseOptions({ myPullRequests: false }), records())(signal, context())

    expect(on.authored?.map((entry) => entry.number)).toEqual([5])
    expect(on.items).toEqual([])
    expect(off).not.toHaveProperty("authored")
    expect(github.fetchAuthoredPullRequests).toHaveBeenCalledTimes(1)
  })

  it("fails the refresh when the follow-up search of the only host fails", async () => {
    github.fetchReviewedPullRequests.mockRejectedValue(new Error("boom"))

    await expect(queueSource(parseOptions({}), records(record(1)))(signal, context())).rejects.toThrow("boom")
  })
})

describe("queueSource on several hosts", () => {
  beforeEach(() => {
    hosts.discoverHosts.mockResolvedValue([{ host: "github.com" }, { host: ENTERPRISE }])
  })

  it("queries every host and merges their queues", async () => {
    github.fetchReviewRequests.mockImplementation(byHost({ "github.com": [item(2)], [ENTERPRISE]: [onEnterprise(1)] }))

    const result = await queueSource(parseOptions({}), records())(signal, context())

    expect(result.items.map((entry) => entry.key)).toEqual(["ghe.acme.com/acme/api#1", "acme/api#2"])
    expect(result).not.toHaveProperty("error")
    expect(github.fetchReviewRequests.mock.calls.map((call) => call[0])).toEqual(["github.com", ENTERPRISE])
  })

  it("keeps a failing host's last items, and names it, while the others refresh", async () => {
    github.fetchReviewRequests.mockImplementation(
      byHost({ "github.com": [item(2)], [ENTERPRISE]: offline(ENTERPRISE) }),
    )
    const previous = { items: [item(9), onEnterprise(1)], authored: [onEnterprise(5)] }

    const result = await queueSource(parseOptions({}), records())(signal, context({ previous }))

    expect(result.items.map((entry) => entry.key)).toEqual(["ghe.acme.com/acme/api#1", "acme/api#2"])
    expect(result.authored?.map((entry) => entry.key)).toEqual(["ghe.acme.com/acme/api#5"])
    expect(result.error).toEqual({
      kind: "offline",
      message: `${ENTERPRISE}: GitHub is unreachable (${ENTERPRISE}). The last successful queue is still shown.`,
      hosts: [ENTERPRISE],
    })
  })

  it("backs off a failing host alone, until a manual refresh", async () => {
    let now = 0
    github.fetchReviewRequests.mockImplementation(byHost({ [ENTERPRISE]: offline(ENTERPRISE) }))
    const source = queueSource(parseOptions({ intervalMs: 60_000 }), records(), () => now)

    await source(signal, context())
    now += 60_000
    const backingOff = await source(signal, context())
    now += 60_000
    await source(signal, context())
    await source(signal, context({ manual: true }))

    const asked = github.fetchReviewRequests.mock.calls.map((call) => call[0])
    // The first failure waits two intervals; github.com is asked every time.
    expect(asked.filter((host) => host === ENTERPRISE)).toHaveLength(3)
    expect(asked.filter((host) => host === "github.com")).toHaveLength(4)
    expect(backingOff.error?.hosts).toEqual([ENTERPRISE])
  })

  it("fails the refresh only when every host fails", async () => {
    github.fetchReviewRequests.mockImplementation(
      byHost({ "github.com": offline("github.com"), [ENTERPRISE]: offline(ENTERPRISE) }),
    )

    const failure = await queueSource(parseOptions({}), records())(signal, context()).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(GhError)
    expect((failure as GhError).detail).toMatchObject({ kind: "offline", message: expect.stringContaining(ENTERPRISE) })
    expect((failure as GhError).detail).not.toHaveProperty("hosts")
  })

  it("checks a host again after a check that failed offline, without a manual refresh", async () => {
    let now = 0
    const unreachable = { kind: "offline" as const, message: "ghe.acme.com is unreachable." }
    hosts.discoverHosts
      .mockResolvedValueOnce([{ host: "github.com" }, { host: ENTERPRISE, error: unreachable }])
      .mockResolvedValue([{ host: "github.com" }, { host: ENTERPRISE }])
    github.fetchReviewRequests.mockImplementation(byHost({ [ENTERPRISE]: [onEnterprise(1)] }))
    const source = queueSource(parseOptions({ intervalMs: 60_000 }), records(), () => now)

    const offlineResult = await source(signal, context())
    now += 120_000
    const recovered = await source(signal, context())

    expect(offlineResult.error).toMatchObject({ kind: "offline", hosts: [ENTERPRISE] })
    expect(recovered).not.toHaveProperty("error")
    expect(recovered.items.map((entry) => entry.key)).toEqual(["ghe.acme.com/acme/api#1"])
  })

  it("keeps a host whose login failed, and checks it again once its backoff lapses", async () => {
    let now = 0
    const failed = { kind: "authentication" as const, message: "Log in again." }
    hosts.discoverHosts.mockResolvedValue([{ host: "github.com" }, { host: ENTERPRISE, error: failed }])
    const source = queueSource(parseOptions({ intervalMs: 60_000 }), records(), () => now)

    const first = await source(signal, context({ previous: { items: [onEnterprise(1)] } }))
    now += 60_000
    await source(signal, context())
    now += 60_000
    await source(signal, context())

    expect(first.items.map((entry) => entry.key)).toEqual(["ghe.acme.com/acme/api#1"])
    expect(first.error).toMatchObject({ kind: "authentication", hosts: [ENTERPRISE] })
    expect(hosts.discoverHosts).toHaveBeenCalledTimes(2)
    expect(github.fetchReviewRequests.mock.calls.map((call) => call[0])).not.toContain(ENTERPRISE)
  })

  it("finds hosts at start and on a manual refresh, not on every poll", async () => {
    const source = queueSource(parseOptions({}), records())

    await source(signal, context())
    await source(signal, context())
    await source(signal, context({ manual: true }))

    expect(hosts.discoverHosts).toHaveBeenCalledTimes(2)
    expect(hosts.checkGhVersion).toHaveBeenCalledTimes(1)
  })

  it("rediscovers after a host reports an authentication failure", async () => {
    let now = 0
    const denied = new GhError({ kind: "authentication", message: "Bad credentials." })
    github.fetchReviewRequests.mockImplementation(byHost({ [ENTERPRISE]: denied }))
    const source = queueSource(parseOptions({ intervalMs: 60_000 }), records(), () => now)

    await source(signal, context())
    now += 120_000
    await source(signal, context())

    expect(hosts.discoverHosts).toHaveBeenCalledTimes(2)
  })

  it("follows up only on the records of each host", async () => {
    github.fetchReviewedPullRequests.mockImplementation(
      byHost({ "github.com": [item(1)], [ENTERPRISE]: [onEnterprise(1)] }),
    )

    const result = await queueSource(parseOptions({}), records(record(1, ENTERPRISE)))(signal, context())

    expect(result.items.map((entry) => entry.key)).toEqual(["ghe.acme.com/acme/api#1"])
    expect(github.fetchReviewedPullRequests.mock.calls.map((call) => call[0])).toEqual([ENTERPRISE])
  })

  it("stops before GitHub while gh is too old, and checks again next time", async () => {
    hosts.checkGhVersion.mockRejectedValueOnce(new GhError({ kind: "outdated-gh", message: "Upgrade gh." }))
    const source = queueSource(parseOptions({}), records())

    await expect(source(signal, context())).rejects.toMatchObject({ detail: { kind: "outdated-gh" } })
    expect(hosts.discoverHosts).not.toHaveBeenCalled()
    await source(signal, context())

    expect(hosts.checkGhVersion).toHaveBeenCalledTimes(2)
    expect(hosts.discoverHosts).toHaveBeenCalledTimes(1)
  })
})
