import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ReviewDraft } from "../src/domain/review-draft.js"

const github = vi.hoisted(() => ({
  fetchDiff: vi.fn(),
  fetchPullRequest: vi.fn(),
  postReview: vi.fn(),
  viewerLogin: vi.fn(),
}))
const checkout = vi.hoisted(() => ({ removeWorktree: vi.fn() }))

vi.mock("../src/server/github/pull-request.js", () => github)
vi.mock("../src/server/review/checkout.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/server/review/checkout.js")>()),
  ...checkout,
}))

const { DraftStore } = await import("../src/server/review/draft-store.js")
const { ReviewService } = await import("../src/server/review/review-service.js")

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
  headSha: "abc123",
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

let saved: Map<string, unknown>
let store: InstanceType<typeof DraftStore>
let service: InstanceType<typeof ReviewService>

beforeEach(async () => {
  for (const mock of [...Object.values(github), ...Object.values(checkout)]) {
    mock.mockReset()
  }
  github.fetchDiff.mockResolvedValue(DIFF)
  github.fetchPullRequest.mockResolvedValue({ headRefOid: "abc123", state: "OPEN" })
  github.postReview.mockResolvedValue("https://github.com/acme/api/pull/7#pullrequestreview-1")
  checkout.removeWorktree.mockResolvedValue(undefined)
  saved = new Map()
  store = new DraftStore(storage(saved))
  service = new ReviewService(store, { cacheDirectory: "/cache", timeoutMs: 1_000 })
  await store.put(base)
})

const signal = new AbortController().signal

describe("ReviewService", () => {
  it("resumes an unposted draft without touching git or GitHub", async () => {
    const item = { key: base.key, repository: "acme/api", number: 7, title: "Add b", author: "octocat" }
    const result = await service.start({
      item: { ...item, draft: false, createdAt: base.createdAt, url: "https://github.com/acme/api/pull/7" },
      clone: false,
      sessions: {} as never,
      signal,
    })

    expect(result).toEqual({ status: "resumed", sessionID: "ses_1" })
    expect(github.fetchPullRequest).not.toHaveBeenCalled()
  })

  it("records findings only on diff lines and only for review sessions", async () => {
    await expect(service.addFinding("ses_1", { ...finding, line: 9 })).rejects.toThrow(/not a changed/)
    await expect(service.addFinding("ses_other", finding)).rejects.toThrow(/not a review session/)

    const added = await service.addFinding("ses_1", finding)

    expect(added).toMatchObject({ id: 1, decision: "pending" })
    expect(github.fetchDiff).toHaveBeenCalledTimes(1)
  })

  it("keeps every change when tool calls run at the same time", async () => {
    const added = await Promise.all([1, 2, 3].map(() => service.addFinding("ses_1", finding)))
    expect(added.map((entry) => entry.id)).toEqual([1, 2, 3])

    await Promise.all([service.decide("ses_1", 1, "keep"), service.decide("ses_1", 2, "drop")])

    expect((await store.get(base.key))?.findings.map((entry) => entry.decision)).toEqual(["keep", "drop", "pending"])
  })

  it("puts an edited finding back to pending", async () => {
    await service.addFinding("ses_1", finding)
    await service.decide("ses_1", 1, "keep")

    const updated = await service.updateFinding("ses_1", 1, { body: "Softer wording.", line: undefined })

    expect(updated).toMatchObject({ body: "Softer wording.", line: 2, decision: "pending" })
  })

  it("refuses approving your own pull request", async () => {
    await store.put({ ...base, ownPullRequest: true })

    await expect(service.setVerdict("ses_1", "APPROVE", "Looks good.")).rejects.toThrow(/own pull request/)
    expect((await service.setVerdict("ses_1", "COMMENT", "Looks good.")).status).toBe("ready")
  })

  it("posts only after every finding is decided, then cleans up the worktree", async () => {
    await service.addFinding("ses_1", finding)
    await service.setVerdict("ses_1", "COMMENT", "One nit.")
    await expect(service.post(base.key, false, signal)).rejects.toThrow(/waiting for your decision/)

    await service.decide("ses_1", 1, "keep")
    const result = await service.post(base.key, false, signal)

    expect(result).toEqual({ status: "posted", url: "https://github.com/acme/api/pull/7#pullrequestreview-1" })
    expect(github.postReview.mock.calls[0]?.[2]).toMatchObject({ commit_id: "abc123", event: "COMMENT" })
    expect(checkout.removeWorktree).toHaveBeenCalledWith(base.checkout, base.worktree, signal)
    expect((await store.get(base.key))?.status).toBe("posted")
    await expect(service.addFinding("ses_1", finding)).rejects.toThrow(/already posted/)
  })

  it("asks before posting a review of an outdated head", async () => {
    await service.setVerdict("ses_1", "APPROVE", "Clean.")
    github.fetchPullRequest.mockResolvedValue({ headRefOid: "def456", state: "OPEN" })

    expect(await service.post(base.key, false, signal)).toMatchObject({ status: "stale" })
    expect(github.postReview).not.toHaveBeenCalled()
    expect(await service.post(base.key, true, signal)).toMatchObject({ status: "posted" })
  })

  it("posts what another location recorded in shared storage", async () => {
    // The review session's location records findings; the panel's location, with its own store, posts.
    const panel = new ReviewService(new DraftStore(storage(saved)), { cacheDirectory: "/cache", timeoutMs: 1_000 })
    await service.addFinding("ses_1", finding)
    await service.decide("ses_1", 1, "keep")
    await service.setVerdict("ses_1", "COMMENT", "One nit.")

    expect(await panel.post(base.key, false, signal)).toMatchObject({ status: "posted" })
  })

  it("reset removes the worktree and forgets the draft", async () => {
    await service.reset(base.key, signal)

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
