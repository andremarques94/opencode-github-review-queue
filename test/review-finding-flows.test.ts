import { describe, expect, it, vi } from "vitest"
import type { Finding, ReviewDraft } from "../src/domain/review-draft.js"
import { reviewProgress } from "../src/shared/review/draft-status.js"
import {
  askAboutFindingFlow,
  decideFindingFlow,
  editFindingFlow,
  type FindingFlowHost,
  findingQuestion,
  type PendingQuestion,
} from "../src/shared/review/finding-flows.js"

const finding = (id: number, overrides: Partial<Finding> = {}): Finding => ({
  id,
  path: "src/app.ts",
  line: id,
  side: "RIGHT",
  severity: "minor",
  confidence: "high",
  evidence: "",
  body: `Comment ${id}`,
  decision: "pending",
  ...overrides,
})

const draft: ReviewDraft = {
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
  status: "ready",
  verdict: "REQUEST_CHANGES",
  summary: "Fix it.",
  findings: [finding(1), finding(2, { decision: "keep" })],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
}

const question = (id: string, title: string, kind = "question"): PendingQuestion => ({
  id,
  metadata: { kind },
  fields: [{ title }],
})

function host(questions: PendingQuestion[] = [], overrides: Partial<FindingFlowHost> = {}): FindingFlowHost {
  return {
    decideFinding: vi.fn(async () => ({ draft })),
    editFinding: vi.fn(async () => ({ draft })),
    askAboutFinding: vi.fn(async () => ({})),
    editBody: vi.fn(async () => "New wording."),
    questions: vi.fn(async () => questions),
    cancelQuestion: vi.fn(async () => undefined),
    ...overrides,
  }
}

describe("findingQuestion", () => {
  it("matches the agent's question about one finding by its header", () => {
    const questions = [
      question("frm_other", "Deploy?"),
      question("frm_1", "Finding #1"),
      question("frm_2", "Finding #2"),
    ]

    expect(findingQuestion(questions, 2)?.id).toBe("frm_2")
    expect(findingQuestion(questions)?.id).toBe("frm_1")
    expect(findingQuestion([question("frm_x", "Finding #1", "integration")], 1)).toBeUndefined()
  })
})

describe("finding flows", () => {
  it("closes the agent's question about a finding decided in the panel", async () => {
    const flow = host([question("frm_2", "Finding #2"), question("frm_1", "Finding #1")])

    await decideFindingFlow(flow, draft, finding(1), "drop")

    expect(flow.decideFinding).toHaveBeenCalledWith({ sessionID: "ses_1", id: 1, decision: "drop" })
    expect(flow.cancelQuestion).toHaveBeenCalledTimes(1)
    expect(flow.cancelQuestion).toHaveBeenCalledWith({
      sessionID: "ses_1",
      formID: "frm_1",
      message: expect.stringMatching(/dropped Finding #1 in the review panel\. Call review_next_finding/),
    })
  })

  it("leaves a question about another finding open", async () => {
    const flow = host([question("frm_2", "Finding #2")])

    await decideFindingFlow(flow, draft, finding(1), "keep")

    expect(flow.cancelQuestion).not.toHaveBeenCalled()
  })

  it("saves a rewritten comment, and nothing when the dialog is dismissed or unchanged", async () => {
    const saved = host([question("frm_1", "Finding #1")])
    expect(await editFindingFlow(saved, draft, finding(1))).toBe(draft)
    expect(saved.editFinding).toHaveBeenCalledWith({ sessionID: "ses_1", id: 1, body: "New wording." })
    expect(saved.cancelQuestion).toHaveBeenCalledWith(expect.objectContaining({ formID: "frm_1" }))

    for (const body of [undefined, "Comment 1"]) {
      const skipped = host([], { editBody: vi.fn(async () => body) })
      expect(await editFindingFlow(skipped, draft, finding(1))).toBeUndefined()
      expect(skipped.editFinding).not.toHaveBeenCalled()
    }
  })

  it("frees the agent from any open finding question before asking about another", async () => {
    const flow = host([question("frm_2", "Finding #2")])

    await askAboutFindingFlow(flow, draft, finding(1))

    expect(flow.cancelQuestion).toHaveBeenCalledWith(expect.objectContaining({ formID: "frm_2" }))
    expect(flow.askAboutFinding).toHaveBeenCalledWith({ sessionID: "ses_1", id: 1 })
  })

  it("does not record anything when the decision fails", async () => {
    const flow = host([question("frm_1", "Finding #1")], {
      decideFinding: vi.fn(async () => Promise.reject({ type: "failed", message: "already posted" })),
    })

    await expect(decideFindingFlow(flow, draft, finding(1), "keep")).rejects.toMatchObject({ type: "failed" })
    expect(flow.cancelQuestion).not.toHaveBeenCalled()
  })
})

describe("reviewProgress", () => {
  it("counts decisions and blocks posting until all are made", () => {
    expect(reviewProgress(draft)).toEqual({
      label: "1 of 2 decided · Request changes",
      tone: "warning",
      blocker: "1 finding is still waiting for your decision.",
    })
    expect(reviewProgress({ ...draft, findings: [finding(1, { decision: "drop" })] })).toMatchObject({
      label: "1 of 1 decided · Request changes",
      tone: "success",
      blocker: undefined,
    })
    expect(reviewProgress({ ...draft, status: "investigating" }).label).toBe("Investigating")
  })
})
