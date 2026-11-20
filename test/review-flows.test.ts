import { describe, expect, it, vi } from "vitest"
import type { ReviewDraft } from "../src/domain/review-draft.js"
import type { ReviewedRecord } from "../src/domain/review-history.js"
import type { ReviewRequest } from "../src/domain/review-request.js"
import { postReviewFlow, type ReviewFlowHost, startReviewFlow } from "../src/shared/review/flows.js"

const item: ReviewRequest = {
  key: "acme/api#7",
  repository: "acme/api",
  number: 7,
  title: "Add b",
  author: "octocat",
  draft: false,
  createdAt: "2026-01-01T00:00:00Z",
  url: "https://github.com/acme/api/pull/7",
}

const model = { providerID: "acme", id: "fast", name: "Fast", provider: "Acme" }

const draft: ReviewDraft = {
  version: 1,
  key: item.key,
  repository: item.repository,
  number: item.number,
  title: item.title,
  headSha: "abc123",
  ownPullRequest: false,
  checkout: "/repos/acme/api",
  worktree: "/cache/worktrees/acme/api/pr-7",
  sessionID: "ses_1",
  status: "ready",
  verdict: "COMMENT",
  summary: "One nit.",
  findings: [],
  createdAt: item.createdAt,
  updatedAt: item.createdAt,
}

function host(overrides: Partial<ReviewFlowHost> = {}): ReviewFlowHost {
  return {
    confirm: vi.fn(async () => true),
    confirmPost: vi.fn(async (preview) => ({ verdict: preview.event, summary: preview.summary })),
    select: vi.fn(async ({ options }) => options[0]?.value),
    models: vi.fn(async () => ({ models: [model], preferred: null })),
    notify: vi.fn(),
    startReview: vi.fn(async () => ({ status: "started" as const, sessionID: "ses_new" })),
    postReview: vi.fn(async () => ({ status: "posted" as const, url: "https://github.com/review" })),
    resetReview: vi.fn(async () => ({})),
    ...overrides,
  }
}

const OLD_HEAD = "a".repeat(40)
const NEW_HEAD = "b".repeat(40)
const previous: ReviewedRecord = {
  version: 1,
  key: item.key,
  repository: item.repository,
  number: item.number,
  headSha: OLD_HEAD,
  verdict: "REQUEST_CHANGES",
  postedUrl: "https://github.com/acme/api/pull/7#pullrequestreview-1",
  postedAt: "2026-01-02T00:00:00Z",
}

describe("startReviewFlow after an earlier review", () => {
  it("offers to review only the changes, and picks that by default", async () => {
    const flow = host()

    expect(await startReviewFlow(flow, { ...item, headSha: NEW_HEAD }, "/repo", false, previous)).toBe("ses_new")
    expect(vi.mocked(flow.select).mock.calls[0]?.[0]).toMatchObject({
      options: [{ title: "Review changes since last review" }, { title: "Full review" }],
      current: "changes",
    })
    expect(flow.startReview).toHaveBeenCalledWith(expect.objectContaining({ mode: "changes" }))
  })

  it("starts nothing when the choice is cancelled", async () => {
    const flow = host({ select: vi.fn(async () => undefined) })

    expect(await startReviewFlow(flow, { ...item, headSha: NEW_HEAD }, "/repo", false, previous)).toBeUndefined()
    expect(flow.select).toHaveBeenCalledTimes(1)
    expect(flow.startReview).not.toHaveBeenCalled()
  })

  it("asks nothing when the head has not moved", async () => {
    const flow = host()

    await startReviewFlow(flow, { ...item, headSha: OLD_HEAD }, "/repo", false, previous)

    expect(flow.select).toHaveBeenCalledTimes(1)
    expect(flow.startReview).toHaveBeenCalledWith(expect.not.objectContaining({ mode: expect.anything() }))
  })
})

describe("startReviewFlow", () => {
  it("starts with the picked model", async () => {
    const flow = host()

    expect(await startReviewFlow(flow, item, "/repo", false)).toBe("ses_new")
    expect(flow.startReview).toHaveBeenCalledWith({
      key: item.key,
      directory: "/repo",
      model: { providerID: "acme", id: "fast" },
      clone: false,
    })
  })

  it("starts nothing when the model picker is dismissed", async () => {
    const flow = host({ select: vi.fn(async () => undefined) })

    expect(await startReviewFlow(flow, item, undefined, false)).toBeUndefined()
    expect(flow.startReview).not.toHaveBeenCalled()
  })

  it("resumes without asking for a model", async () => {
    const flow = host({ startReview: vi.fn(async () => ({ status: "resumed" as const, sessionID: "ses_1" })) })

    expect(await startReviewFlow(flow, item, undefined, true)).toBe("ses_1")
    expect(flow.models).not.toHaveBeenCalled()
  })

  it("clones only after the user approves", async () => {
    const needsClone = { status: "needs-clone" as const, repository: item.repository, directory: "/cache/repos" }
    const startReview = vi
      .fn<ReviewFlowHost["startReview"]>()
      .mockResolvedValueOnce(needsClone)
      .mockResolvedValueOnce({ status: "started", sessionID: "ses_new" })

    expect(await startReviewFlow(host({ startReview }), item, undefined, false)).toBe("ses_new")
    expect(startReview).toHaveBeenLastCalledWith(expect.objectContaining({ clone: true }))

    const declined = host({ startReview: vi.fn(async () => needsClone), confirm: vi.fn(async () => false) })
    expect(await startReviewFlow(declined, item, undefined, false)).toBeUndefined()
    expect(declined.startReview).toHaveBeenCalledTimes(1)
  })
})

describe("postReviewFlow", () => {
  it("posts the user's edited comment and state without starting another model turn", async () => {
    const review = { verdict: "APPROVE" as const, summary: "My final comment.\n\nLooks good ✅" }
    const flow = host({ confirmPost: vi.fn(async () => review) })

    await postReviewFlow(flow, draft)

    expect(flow.postReview).toHaveBeenCalledWith({ key: draft.key, allowStale: false, review })
    expect(flow.startReview).not.toHaveBeenCalled()
    expect(flow.models).not.toHaveBeenCalled()
  })

  it("does not post or change the draft when the final editor is cancelled", async () => {
    const flow = host({ confirmPost: vi.fn(async () => undefined) })
    expect(await postReviewFlow(flow, draft)).toBeUndefined()
    expect(flow.postReview).not.toHaveBeenCalled()
    expect(draft.summary).toBe("One nit.")
  })

  it("retains the edited comment and state when confirming a stale review", async () => {
    const review = { verdict: "REQUEST_CHANGES" as const, summary: "Please fix this first." }
    const postReview = vi
      .fn<ReviewFlowHost["postReview"]>()
      .mockResolvedValueOnce({ status: "stale", reason: "New commits were pushed." })
      .mockResolvedValueOnce({ status: "posted", url: "https://github.com/review" })
    await postReviewFlow(host({ confirmPost: vi.fn(async () => review), postReview }), draft)
    expect(postReview).toHaveBeenNthCalledWith(1, { key: draft.key, allowStale: false, review })
    expect(postReview).toHaveBeenNthCalledWith(2, { key: draft.key, allowStale: true, review })
  })

  it("posts after the preview is confirmed", async () => {
    expect(await postReviewFlow(host(), draft)).toEqual({ status: "posted", url: "https://github.com/review" })
  })

  it("refuses a draft that still has blockers", async () => {
    await expect(postReviewFlow(host(), { ...draft, status: "investigating" })).rejects.toThrow(/investigated/)
  })

  it("asks again before posting over new commits", async () => {
    const postReview = vi
      .fn<ReviewFlowHost["postReview"]>()
      .mockResolvedValueOnce({ status: "stale", reason: "New commits were pushed." })
      .mockResolvedValueOnce({ status: "posted", url: "https://github.com/review" })

    expect(await postReviewFlow(host({ postReview }), draft)).toMatchObject({ url: "https://github.com/review" })
    expect(postReview).toHaveBeenLastCalledWith({
      key: draft.key,
      allowStale: true,
      review: { verdict: draft.verdict, summary: draft.summary },
    })

    const declined = host({
      postReview: vi.fn(async () => ({ status: "stale" as const, reason: "New commits were pushed." })),
      confirm: vi.fn(async () => false),
    })
    expect(await postReviewFlow(declined, draft)).toBeUndefined()
  })
})
