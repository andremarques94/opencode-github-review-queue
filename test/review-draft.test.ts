import { describe, expect, it } from "vitest"
import { commentableLines, commentProblem } from "../src/domain/pull-request-diff.js"
import { postBlocker, type ReviewDraft, reviewPayload } from "../src/domain/review-draft.js"
import { draftActions, draftLabel, pillStatus, resumable, reviewLabel } from "../src/shared/review/draft-status.js"
import { reviewPreview } from "../src/shared/review/preview.js"

const DIFF = `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -10,4 +10,5 @@ export function app() {
 const a = 1
-const b = 2
+const b = 3
+const c = 4
 return a
diff --git a/src/gone.ts b/src/gone.ts
deleted file mode 100644
--- a/src/gone.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-export const gone = true
-export const removed = true
diff --git a/assets/logo.png b/assets/logo.png
Binary files a/assets/logo.png and b/assets/logo.png differ
`

const draft = (overrides: Partial<ReviewDraft> = {}): ReviewDraft => ({
  version: 1,
  key: "acme/api#7",
  repository: "acme/api",
  number: 7,
  title: "Tune constants",
  headSha: "abc123",
  ownPullRequest: false,
  checkout: "/repos/acme/api",
  worktree: "/cache/worktrees/acme/api/pr-7",
  sessionID: "ses_1",
  status: "ready",
  verdict: "REQUEST_CHANGES",
  summary: "Constants need names.",
  findings: [
    {
      id: 1,
      path: "src/app.ts",
      line: 11,
      side: "RIGHT",
      severity: "major",
      confidence: "high",
      evidence: "local only",
      body: "Name this constant.\nIt is a magic number.",
      decision: "keep",
    },
    {
      id: 2,
      path: "src/app.ts",
      line: 12,
      side: "RIGHT",
      startLine: 11,
      severity: "nit",
      confidence: "low",
      evidence: "",
      body: "Dropped one.",
      decision: "drop",
    },
  ],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  ...overrides,
})

describe("commentableLines", () => {
  const lines = commentableLines(DIFF)

  it("maps added and context lines to RIGHT and removed and context lines to LEFT", () => {
    const file = lines.get("src/app.ts")
    expect([...(file?.RIGHT ?? [])]).toEqual([10, 11, 12, 13])
    expect([...(file?.LEFT ?? [])]).toEqual([10, 11, 12])
  })

  it("keeps deleted files under their old path", () => {
    expect([...(lines.get("src/gone.ts")?.LEFT ?? [])]).toEqual([1, 2])
  })

  it("explains lines outside the diff", () => {
    expect(commentProblem(lines, { path: "src/app.ts", line: 11, side: "RIGHT" })).toBeUndefined()
    expect(commentProblem(lines, { path: "src/app.ts", line: 40, side: "RIGHT" })).toMatch(/not a changed/)
    expect(commentProblem(lines, { path: "README.md", line: 1, side: "RIGHT" })).toMatch(/not part/)
    expect(commentProblem(lines, { path: "assets/logo.png", line: 1, side: "RIGHT" })).toMatch(/not part/)
    expect(commentProblem(lines, { path: "src/app.ts", line: 11, side: "RIGHT", startLine: 12 })).toMatch(/before/)
  })
})

describe("posting rules", () => {
  it("only posts kept findings, without local notes", () => {
    expect(reviewPayload(draft())).toEqual({
      commit_id: "abc123",
      event: "REQUEST_CHANGES",
      body: "Constants need names.",
      comments: [{ path: "src/app.ts", line: 11, side: "RIGHT", body: "Name this constant.\nIt is a magic number." }],
    })
  })

  it("adds the start side to multi-line comments", () => {
    const kept = draft({ findings: draft().findings.map((finding) => ({ ...finding, decision: "keep" as const })) })
    expect(reviewPayload(kept).comments[1]).toMatchObject({ start_line: 11, start_side: "RIGHT" })
  })

  it("blocks posting until the user decided every finding", () => {
    const pending = draft({
      findings: draft().findings.map((finding) => ({ ...finding, decision: "pending" as const })),
    })
    expect(postBlocker(pending)).toBe("2 findings are still waiting for your decision.")
    expect(draftLabel(pending)).toBe("2 to decide")
  })

  it("blocks posting while investigating, after posting, and when the head moved", () => {
    expect(postBlocker(draft({ status: "investigating" }))).toMatch(/still being investigated/)
    expect(postBlocker(draft({ status: "posted" }))).toMatch(/already posted/)
    expect(postBlocker(draft(), "def456")).toMatch(/New commits/)
    expect(postBlocker(draft(), "abc123")).toBeUndefined()
    expect(draftLabel(draft())).toBe("ready to post")
  })

  it("offers resume, post, and reset only when they apply", () => {
    expect(resumable(undefined)).toBe(false)
    expect(draftActions(undefined)).toEqual([])
    expect(resumable(draft({ status: "posted" }))).toBe(false)
    expect(draftActions(draft({ status: "posted" })).map((action) => action.kind)).toEqual(["reset"])
    expect(resumable(draft({ status: "investigating" }))).toBe(true)
    expect(draftActions(draft({ status: "investigating" }))).toMatchObject([
      { kind: "post", blocker: expect.stringMatching(/investigated/) },
      { kind: "reset" },
    ])
  })

  it("previews exactly what will be posted", () => {
    const kept = draft({ findings: draft().findings.map((finding) => ({ ...finding, decision: "keep" as const })) })
    expect(reviewPreview(kept)).toEqual({
      title: "Post review on acme/api#7?",
      reference: "acme/api#7",
      verdict: "Request changes",
      event: "REQUEST_CHANGES",
      ownPullRequest: false,
      summary: "Constants need names.",
      comments: [
        { location: "src/app.ts:11", body: "Name this constant.\nIt is a magic number." },
        { location: "src/app.ts:11-12", body: "Dropped one." },
      ],
    })
  })
})

describe("pillStatus", () => {
  it("keeps the composer pill to a few words", () => {
    expect(pillStatus(draft({ status: "investigating" }))).toBe("Reviewing")
    expect(pillStatus(draft())).toBe("Ready to post")
    expect(pillStatus(draft({ status: "posted" }))).toBe("Posted")
  })
})

describe("reviewLabel", () => {
  const previous = {
    version: 1 as const,
    key: "acme/api#7",
    repository: "acme/api",
    number: 7,
    headSha: "a".repeat(40),
    verdict: "COMMENT" as const,
    postedUrl: "https://github.com/acme/api/pull/7#pullrequestreview-1",
    postedAt: "2026-01-02T00:00:00Z",
  }
  const item = {
    key: "acme/api#7",
    repository: "acme/api",
    number: 7,
    title: "Tune constants",
    author: "octocat",
    draft: false,
    createdAt: "2026-01-01T00:00:00Z",
    url: "https://github.com/acme/api/pull/7",
  }

  it("flags new commits since the posted review, unless a new draft is under way", () => {
    const moved = { ...item, headSha: "b".repeat(40) }

    expect(reviewLabel(moved, draft({ status: "posted" }), previous)).toBe("new commits since your review")
    expect(reviewLabel(moved, undefined, previous)).toBe("new commits since your review")
    expect(reviewLabel(moved, draft({ status: "investigating" }), previous)).toBe("reviewing")
  })

  it("says nothing new when the head did not move or is unknown", () => {
    expect(reviewLabel({ ...item, headSha: "a".repeat(40) }, undefined, previous)).toBeUndefined()
    expect(reviewLabel(item, undefined, previous)).toBeUndefined()
    expect(reviewLabel({ ...item, headSha: "b".repeat(40), reviewedHead: true }, undefined, previous)).toBeUndefined()
  })
})
