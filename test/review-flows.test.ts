import { describe, expect, it, vi } from "vitest"
import type { ReviewDraft } from "../src/domain/review-draft.js"
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
    confirmPost: vi.fn(async () => true),
    select: vi.fn(async ({ options }) => options[0]?.value),
    models: vi.fn(async () => ({ models: [model], preferred: null })),
    notify: vi.fn(),
    startReview: vi.fn(async () => ({ status: "started" as const, sessionID: "ses_new" })),
    postReview: vi.fn(async () => ({ status: "posted" as const, url: "https://github.com/review" })),
    resetReview: vi.fn(async () => ({})),
    ...overrides,
  }
}

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
  it("posts after the preview is confirmed", async () => {
    expect(await postReviewFlow(host(), draft)).toBe("https://github.com/review")
  })

  it("refuses a draft that still has blockers", async () => {
    await expect(postReviewFlow(host(), { ...draft, status: "investigating" })).rejects.toThrow(/investigated/)
  })

  it("asks again before posting over new commits", async () => {
    const postReview = vi
      .fn<ReviewFlowHost["postReview"]>()
      .mockResolvedValueOnce({ status: "stale", reason: "New commits were pushed." })
      .mockResolvedValueOnce({ status: "posted", url: "https://github.com/review" })

    expect(await postReviewFlow(host({ postReview }), draft)).toBe("https://github.com/review")
    expect(postReview).toHaveBeenLastCalledWith({ key: draft.key, allowStale: true })

    const declined = host({
      postReview: vi.fn(async () => ({ status: "stale" as const, reason: "New commits were pushed." })),
      confirm: vi.fn(async () => false),
    })
    expect(await postReviewFlow(declined, draft)).toBeUndefined()
  })
})
