import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ReviewDraft } from "../src/domain/review-draft.js"
import type { ReviewedRecord as Reviewed } from "../src/domain/review-history.js"

const github = vi.hoisted(() => ({
  fetchCompareDiff: vi.fn(),
  fetchDiff: vi.fn(),
  fetchPullRequest: vi.fn(),
  postReview: vi.fn(),
  pullRequestStates: vi.fn(),
  viewerLogin: vi.fn(),
}))
const checkout = vi.hoisted(() => ({ removeWorktree: vi.fn() }))

vi.mock("../src/server/github/pull-request.js", () => github)
vi.mock("../src/server/git/worktrees.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/server/git/worktrees.js")>()),
  ...checkout,
}))

const { ReviewedRecord } = await import("../src/domain/review-history.js")
const { KeyedStore } = await import("../src/server/keyed-store.js")
const { DraftStore } = await import("../src/server/review/draft-store.js")
const { Findings } = await import("../src/server/review/findings.js")
const { ReviewSessions } = await import("../src/server/review/sessions.js")

const HEAD = "abc123".padEnd(40, "0")
const NEXT_HEAD = "def456".padEnd(40, "0")
const BASE = "ba5e".padEnd(40, "0")

const DIFF = `diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,2 +1,3 @@
 const a = 1
+const b = 2
 export { a }
`

const base: ReviewDraft = {
  version: 1,
  key: "acme/api#7",
  repository: "acme/api",
  number: 7,
  title: "Add b",
  headSha: HEAD,
  baseSha: BASE,
  ownPullRequest: false,
  checkout: "/repos/acme/api",
  worktree: "/cache/worktrees/acme/api/pr-7",
  sessionID: "ses_1",
  status: "investigating",
  findings: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
}

const finding = {
  path: "src/app.ts",
  line: 2,
  side: "RIGHT" as const,
  severity: "minor" as const,
  confidence: "high" as const,
  evidence: "",
  body: "Name this.",
}

const storage = (values: Map<string, unknown>) => ({
  get: async (key: string) => values.get(key),
  list: async () => [...values.values()],
  save: async (draft: ReviewDraft) => void values.set(draft.key, draft),
  remove: async (key: string) => void values.delete(key),
})

const memory = (values: Map<string, unknown>) => ({
  get: async (key: string) => values.get(key),
  list: async () => [...values.values()],
  save: async (key: string, value: unknown) => void values.set(key, value),
  remove: async (key: string) => void values.delete(key),
})

let saved: Map<string, unknown>
let reviewedValues: Map<string, unknown>
let reviewed: InstanceType<typeof KeyedStore<Reviewed>>
let store: InstanceType<typeof DraftStore>
let findings: InstanceType<typeof Findings>
let sessions: InstanceType<typeof ReviewSessions>

beforeEach(async () => {
  for (const mock of [...Object.values(github), ...Object.values(checkout)]) {
    mock.mockReset()
  }
  github.fetchDiff.mockResolvedValue(DIFF)
  github.fetchCompareDiff.mockResolvedValue(DIFF)
  github.fetchPullRequest.mockResolvedValue({ headRefOid: HEAD, state: "OPEN" })
  github.postReview.mockResolvedValue("https://github.com/acme/api/pull/7#pullrequestreview-1")
  checkout.removeWorktree.mockResolvedValue(undefined)
  github.pullRequestStates.mockResolvedValue(new Map())
  saved = new Map()
  reviewedValues = new Map()
  store = new DraftStore(storage(saved))
  reviewed = new KeyedStore<Reviewed>(ReviewedRecord, memory(reviewedValues))
  findings = new Findings(store, 1_000)
  sessions = new ReviewSessions(store, reviewed, { cacheDirectory: "/cache", keepClones: false, timeoutMs: 1_000 })
  await store.put(base)
})

const signal = new AbortController().signal

describe("review workflow", () => {
  it("resumes an unposted draft without touching git or GitHub", async () => {
    const item = { key: base.key, repository: "acme/api", number: 7, title: "Add b", author: "octocat" }
    const result = await sessions.start({
      item: { ...item, draft: false, createdAt: base.createdAt, url: "https://github.com/acme/api/pull/7" },
      clone: false,
      sessions: {} as never,
      signal,
    })

    expect(result).toEqual({ status: "resumed", sessionID: "ses_1" })
    expect(github.fetchPullRequest).not.toHaveBeenCalled()
  })

  it("records findings only on diff lines and only for review sessions", async () => {
    await expect(findings.add("ses_1", { ...finding, line: 9 })).rejects.toThrow(/not a changed/)
    await expect(findings.add("ses_other", finding)).rejects.toThrow(/not a review session/)

    const added = await findings.add("ses_1", finding)

    expect(added).toMatchObject({ id: 1, decision: "pending" })
    expect(github.fetchCompareDiff).toHaveBeenCalledTimes(1)
    expect(github.fetchCompareDiff).toHaveBeenCalledWith("acme/api", BASE, HEAD, expect.any(AbortSignal))
    expect(github.fetchDiff).not.toHaveBeenCalled()
  })

  it("checks lines against the reviewed commits, not the branch the author keeps pushing to", async () => {
    // The branch moved on: its current diff no longer has line 2, but the commits under review still do.
    github.fetchDiff.mockResolvedValue(DIFF.replace("+const b = 2\n", ""))

    await expect(findings.add("ses_1", finding)).resolves.toMatchObject({ id: 1 })
    await expect(findings.add("ses_1", { ...finding, line: 9 })).rejects.toThrow(
      `compare/${BASE}...${HEAD} -H "Accept: application/vnd.github.diff"`,
    )
  })

  it("falls back to the pull request's diff for drafts without a base commit", async () => {
    const { baseSha: _, ...older } = base
    await store.put(older)

    await findings.add("ses_1", finding)

    expect(github.fetchDiff).toHaveBeenCalledWith("acme/api", 7, expect.any(AbortSignal))
    expect(github.fetchCompareDiff).not.toHaveBeenCalled()
  })

  it("keeps every change when tool calls run at the same time", async () => {
    const added = await Promise.all([1, 2, 3].map(() => findings.add("ses_1", finding)))
    expect(added.map((entry) => entry.id)).toEqual([1, 2, 3])

    await Promise.all([findings.decide("ses_1", 1, "keep"), findings.decide("ses_1", 2, "drop")])

    expect((await store.get(base.key))?.findings.map((entry) => entry.decision)).toEqual(["keep", "drop", "pending"])
  })

  it("puts an edited finding back to pending", async () => {
    await findings.add("ses_1", finding)
    await findings.decide("ses_1", 1, "keep")

    const updated = await findings.update("ses_1", 1, { body: "Softer wording.", line: undefined })

    expect(updated).toMatchObject({ body: "Softer wording.", line: 2, decision: "pending" })
  })

  it("refuses approving your own pull request", async () => {
    await store.put({ ...base, ownPullRequest: true })

    await expect(findings.setVerdict("ses_1", "APPROVE", "Looks good.")).rejects.toThrow(/own pull request/)
    expect((await findings.setVerdict("ses_1", "COMMENT", "Looks good.")).status).toBe("ready")
  })

  it("posts only after every finding is decided, then cleans up the worktree", async () => {
    await findings.add("ses_1", finding)
    await findings.setVerdict("ses_1", "COMMENT", "One nit.")
    await expect(sessions.post(base.key, false, signal)).rejects.toThrow(/waiting for your decision/)

    await findings.decide("ses_1", 1, "keep")
    const result = await sessions.post(base.key, false, signal)

    expect(result).toEqual({ status: "posted", url: "https://github.com/acme/api/pull/7#pullrequestreview-1" })
    expect(github.postReview.mock.calls[0]?.[2]).toMatchObject({ commit_id: HEAD, event: "COMMENT" })
    expect(checkout.removeWorktree).toHaveBeenCalledWith(base.checkout, base.worktree, signal)
    expect((await store.get(base.key))?.status).toBe("posted")
    await expect(findings.add("ses_1", finding)).rejects.toThrow(/already posted/)
  })

  it("asks before posting a review of an outdated head", async () => {
    await findings.setVerdict("ses_1", "APPROVE", "Clean.")
    github.fetchPullRequest.mockResolvedValue({ headRefOid: NEXT_HEAD, state: "OPEN" })

    expect(await sessions.post(base.key, false, signal)).toMatchObject({ status: "stale" })
    expect(github.postReview).not.toHaveBeenCalled()
    expect(await sessions.post(base.key, true, signal)).toMatchObject({ status: "posted" })
  })

  it("posts what another location recorded in shared storage", async () => {
    // The review session's location records findings; the panel's location, with its own store, posts.
    const panel = new ReviewSessions(new DraftStore(storage(saved)), reviewed, {
      cacheDirectory: "/cache",
      keepClones: false,
      timeoutMs: 1_000,
    })
    await findings.add("ses_1", finding)
    await findings.decide("ses_1", 1, "keep")
    await findings.setVerdict("ses_1", "COMMENT", "One nit.")

    expect(await panel.post(base.key, false, signal)).toMatchObject({ status: "posted" })
  })

  it("still reports a posted review when its cleanup fails", async () => {
    await findings.setVerdict("ses_1", "APPROVE", "Clean.")
    checkout.removeWorktree.mockRejectedValue(new Error("busy"))

    expect(await sessions.post(base.key, false, signal)).toMatchObject({
      status: "posted",
      cleanupWarning: expect.stringMatching(/could not be removed: busy/),
    })
  })

  it("forgets drafts of pull requests that left the queue once they are posted, closed, or merged", async () => {
    const draft = (number: number, status: ReviewDraft["status"]) => ({
      ...base,
      key: `acme/api#${number}`,
      number,
      sessionID: `ses_${number}`,
      worktree: `/cache/worktrees/acme/api/pr-${number}`,
      status,
    })
    await store.put(draft(8, "posted"))
    await store.put(draft(9, "ready"))
    await store.put(draft(10, "ready"))
    github.fetchPullRequest.mockImplementation(async (_repository: string, number: number) => ({
      headRefOid: HEAD,
      state: number === 9 ? "MERGED" : "OPEN",
    }))

    const queue = { items: [{ key: base.key }], newKeys: [], initialized: true, stale: false }
    await sessions.pruneAfterRefresh({ ...queue, loading: true } as never, signal)
    expect(await store.list()).toHaveLength(4)

    await sessions.pruneAfterRefresh({ ...queue, loading: false } as never, signal)

    expect((await store.list()).map((entry) => entry.key).sort()).toEqual(["acme/api#10", base.key])
    expect(checkout.removeWorktree).toHaveBeenCalledTimes(1)
    expect(checkout.removeWorktree).toHaveBeenCalledWith(base.checkout, "/cache/worktrees/acme/api/pr-9", signal)
  })

  it("records what was posted, and keeps it until the pull request is closed or merged", async () => {
    await findings.setVerdict("ses_1", "REQUEST_CHANGES", "Fix it.")
    await sessions.post(base.key, false, signal)

    expect(await reviewed.get(base.key)).toMatchObject({
      headSha: HEAD,
      baseSha: BASE,
      verdict: "REQUEST_CHANGES",
      postedUrl: "https://github.com/acme/api/pull/7#pullrequestreview-1",
    })

    github.pullRequestStates.mockResolvedValue(new Map([[base.key, "OPEN"]]))
    await sessions.prune(new Set(), signal)
    expect(await store.get(base.key)).toBeUndefined()
    expect(await reviewed.get(base.key)).toBeDefined()

    github.pullRequestStates.mockResolvedValue(new Map([[base.key, "MERGED"]]))
    await sessions.prune(new Set(), signal)
    expect(await reviewed.get(base.key)).toBeUndefined()
  })

  it("does not ask GitHub about reviewed pull requests still in the queue", async () => {
    await findings.setVerdict("ses_1", "COMMENT", "Fine.")
    await sessions.post(base.key, false, signal)

    await sessions.prune(new Set([base.key]), signal)

    expect(github.pullRequestStates).not.toHaveBeenCalled()
    expect(await reviewed.get(base.key)).toBeDefined()
  })

  it("reset removes the worktree and forgets the draft", async () => {
    await sessions.reset(base.key, signal)

    expect(checkout.removeWorktree).toHaveBeenCalledWith(base.checkout, base.worktree, signal)
    expect(saved.has(base.key)).toBe(false)
  })
})

describe("DraftStore", () => {
  it("notifies listeners with every change", async () => {
    const seen: number[] = []
    const stop = store.on((drafts) => seen.push(drafts.length))
    await store.remove(base.key)
    stop()
    await store.put(base)

    expect(seen).toEqual([0])
  })

  it("ignores persisted values that no longer match the schema", async () => {
    const reloaded = new DraftStore(
      storage(
        new Map<string, unknown>([
          ["a", base],
          ["b", { version: 99 }],
        ]),
      ),
    )

    expect((await reloaded.list()).map((draft) => draft.key)).toEqual([base.key])
  })
})
