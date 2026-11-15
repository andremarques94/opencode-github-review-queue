import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ReviewedRecord } from "../src/domain/review-history.js"
import type { ReviewRequest } from "../src/domain/review-request.js"

const github = vi.hoisted(() => ({
  fetchCompareDiff: vi.fn(),
  fetchDiff: vi.fn(),
  fetchPullRequest: vi.fn(),
  postReview: vi.fn(),
  pullRequestStates: vi.fn(),
  viewerLogin: vi.fn(),
}))
const git = vi.hoisted(() => ({ createWorktree: vi.fn(), fetchCommit: vi.fn(), removeWorktree: vi.fn() }))

vi.mock("../src/server/github/pull-request.js", () => github)
vi.mock("../src/server/git/worktrees.js", () => git)
vi.mock("../src/server/review/checkout.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/server/review/checkout.js")>()),
  findCheckout: vi.fn(async () => "/repos/acme/api"),
}))

const { ReviewedRecord: RecordSchema } = await import("../src/domain/review-history.js")
const { KeyedStore } = await import("../src/server/keyed-store.js")
const { DraftStore } = await import("../src/server/review/draft-store.js")
const { ReviewSessions } = await import("../src/server/review/sessions.js")
const { nextStep } = await import("../src/server/review/agent/instructions.js")

const OLD_HEAD = "a".repeat(40)
const NEW_HEAD = "b".repeat(40)

const item: ReviewRequest = {
  key: "acme/api#7",
  repository: "acme/api",
  number: 7,
  title: "Add b",
  author: "octocat",
  draft: false,
  createdAt: "2026-01-01T00:00:00Z",
  url: "https://github.com/acme/api/pull/7",
  headSha: NEW_HEAD,
}

const record: ReviewedRecord = {
  version: 1,
  key: item.key,
  repository: item.repository,
  number: item.number,
  headSha: OLD_HEAD,
  verdict: "REQUEST_CHANGES",
  postedUrl: "https://github.com/acme/api/pull/7#pullrequestreview-1",
  postedAt: "2026-01-02T00:00:00Z",
}

const memory = () => {
  const values = new Map<string, unknown>()
  return {
    get: async (key: string) => values.get(key),
    list: async () => [...values.values()],
    save: async (key: string, value: unknown) => void values.set(key, value),
    remove: async (key: string) => void values.delete(key),
  }
}

let drafts: InstanceType<typeof DraftStore>
let sessions: InstanceType<typeof ReviewSessions>
const agent = {
  create: vi.fn(async () => ({ id: "ses_9" })),
  instructions: { entry: { put: vi.fn() } },
  prompt: vi.fn(),
}
const signal = new AbortController().signal

beforeEach(async () => {
  vi.clearAllMocks()
  github.fetchPullRequest.mockResolvedValue({
    title: "Add b",
    state: "OPEN",
    headRefOid: NEW_HEAD,
    baseRefOid: "c".repeat(40),
    baseRefName: "main",
    author: { login: "octocat" },
  })
  github.viewerLogin.mockResolvedValue("reviewer")
  git.createWorktree.mockResolvedValue(NEW_HEAD)
  git.fetchCommit.mockResolvedValue(undefined)
  const draftValues = memory()
  drafts = new DraftStore({ ...draftValues, save: (draft) => draftValues.save(draft.key, draft) })
  const reviewed = new KeyedStore<ReviewedRecord>(RecordSchema, memory())
  await reviewed.put(record)
  sessions = new ReviewSessions(drafts, reviewed, { cacheDirectory: "/cache", keepClones: false, timeoutMs: 1_000 })
})

const start = (mode: "full" | "changes") =>
  sessions.start({ item, clone: false, mode, sessions: agent as never, signal })

describe("follow-up reviews", () => {
  it("focuses the agent on the commits since the last posted review", async () => {
    expect(await start("changes")).toEqual({ status: "started", sessionID: "ses_9" })

    const draft = await drafts.get(item.key)
    expect(draft).toMatchObject({ headSha: NEW_HEAD, sinceSha: OLD_HEAD, baseSha: "c".repeat(40) })
    expect(git.fetchCommit).toHaveBeenCalledWith("/repos/acme/api", "acme/api", OLD_HEAD, signal)
    const instructions = agent.instructions.entry.put.mock.calls[0]?.[0].value as string
    expect(instructions).toContain(`git diff ${OLD_HEAD} ${NEW_HEAD}`)
    expect(instructions).toContain('select(.user.login == "reviewer")')
    expect(instructions).toContain("make an earlier issue worse")
    expect(agent.prompt).toHaveBeenCalledWith({
      sessionID: "ses_9",
      text: "Review the changes to acme/api#7 since my last review: Add b",
    })
    expect(draft && nextStep(draft)).toContain(`changes since ${OLD_HEAD}`)
  })

  it("still starts when the earlier head can no longer be fetched", async () => {
    git.fetchCommit.mockRejectedValue(new Error("not our ref"))

    expect(await start("changes")).toMatchObject({ status: "started" })
    expect((await drafts.get(item.key))?.sinceSha).toBe(OLD_HEAD)
  })

  it("reviews the whole pull request when asked to", async () => {
    await start("full")

    expect((await drafts.get(item.key))?.sinceSha).toBeUndefined()
    expect(git.fetchCommit).not.toHaveBeenCalled()
    expect(agent.instructions.entry.put.mock.calls[0]?.[0].value).not.toContain("Follow-up review")
  })
})
