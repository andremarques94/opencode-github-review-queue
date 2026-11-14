import { describe, expect, it } from "vitest"
import { type Finding, nextFinding, type ReviewDraft } from "../src/domain/review-draft.js"
import { findingCard, nextStep } from "../src/server/review/instructions.js"

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

const draft = (findings: Finding[], overrides: Partial<ReviewDraft> = {}): ReviewDraft => ({
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
  findings,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  ...overrides,
})

describe("walkthrough", () => {
  it("presents blockers first and low-confidence findings last", () => {
    const findings = [
      finding(1, { severity: "nit" }),
      finding(2, { severity: "blocker", confidence: "low" }),
      finding(3, { severity: "blocker" }),
      finding(4, { severity: "major", decision: "keep" }),
    ]
    const order: number[] = []
    let current = draft(findings)
    for (let next = nextFinding(current); next; next = nextFinding(current)) {
      order.push(next.id)
      current = draft(current.findings.map((entry) => (entry.id === next?.id ? { ...entry, decision: "keep" } : entry)))
    }

    expect(order).toEqual([3, 2, 1])
  })

  it("tells the agent what to do at each stage", () => {
    expect(nextStep(draft([], { status: "investigating" }))).toMatch(/without presenting them/)
    expect(nextStep(draft([finding(1, { decision: "keep" }), finding(2)]))).toMatch(
      /1 of 2 findings decided\. Present exactly one finding per message/,
    )
    expect(nextStep(draft([finding(1, { decision: "drop" })]))).toMatch(/every finding is decided/)
    expect(nextStep(draft([], { status: "posted" }))).toBeUndefined()
  })

  it("shows one finding with its position and the exact comment", () => {
    const current = draft([finding(1, { decision: "keep" }), finding(2, { startLine: 1, body: "One\nTwo" })])

    expect(findingCard(current, finding(2, { startLine: 1, body: "One\nTwo" }))).toBe(
      "**Finding #2 (2 of 2) · `src/app.ts:1-2` · minor · high confidence**\n\n**Proposed comment:**\n> One\n> Two",
    )
  })
})
