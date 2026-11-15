import { describe, expect, it } from "vitest"
import { commentableLines, suggestionProblem } from "../src/domain/pull-request-diff.js"
import { commentBody, type ReviewDraft, reviewPayload, splitComment } from "../src/domain/review-draft.js"
import { reviewPreview } from "../src/shared/review/preview.js"

const DIFF = `diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,3 @@
 const a = 1
-const b = 2
+const b = 3
 const c = 4
@@ -20,2 +20,3 @@
 return a
+// done
 }
`
const lines = commentableLines(DIFF)
const at = (line: number, extra: object = {}) => ({ path: "src/app.ts", line, side: "RIGHT" as const, ...extra })

describe("commentBody and splitComment", () => {
  it("puts the suggestion under the body, and reads it back", () => {
    const finding = { body: "Use the constant.\n", suggestion: "const b = LIMIT" }
    const text = commentBody(finding)

    expect(text).toBe("Use the constant.\n\n```suggestion\nconst b = LIMIT\n```")
    expect(splitComment(text)).toEqual({ body: "Use the constant.", suggestion: "const b = LIMIT" })
  })

  it("posts an empty suggestion as a deletion", () => {
    const text = commentBody({ body: "Drop this.", suggestion: "" })

    expect(text).toBe("Drop this.\n\n```suggestion\n```")
    expect(splitComment(text)).toEqual({ body: "Drop this.", suggestion: "" })
  })

  it("fences a suggestion that quotes a fence with more backticks", () => {
    const finding = { body: "Show the example.", suggestion: "/**\n * ```ts\n * run()\n * ```\n */" }
    const text = commentBody(finding)

    expect(text.split("\n")[2]).toBe("````suggestion")
    expect(splitComment(text)).toEqual(finding)
  })

  it("leaves a comment without a closing suggestion block alone", () => {
    for (const text of ["Plain.", "```suggestion\nx\n```\nThen more text.", "```ts\nx\n```"]) {
      expect(splitComment(text)).toEqual({ body: text })
    }
  })

  it("posts and previews the composed comment", () => {
    const finding = {
      id: 1,
      ...at(2),
      severity: "minor" as const,
      confidence: "high" as const,
      evidence: "",
      body: "Use the constant.",
      suggestion: "const b = LIMIT",
      decision: "keep" as const,
    }
    const draft = {
      key: "acme/api#7",
      repository: "acme/api",
      number: 7,
      headSha: "abc",
      status: "ready",
      verdict: "COMMENT",
      summary: "One nit.",
      findings: [finding],
    } as ReviewDraft

    expect(reviewPayload(draft).comments[0]?.body).toBe(commentBody(finding))
    expect(reviewPreview(draft).comments[0]?.body).toBe(commentBody(finding))
  })
})

describe("suggestionProblem", () => {
  it("accepts new lines of one hunk", () => {
    expect(suggestionProblem(lines, at(2, { suggestion: "const b = LIMIT" }))).toBeUndefined()
    expect(suggestionProblem(lines, at(3, { startLine: 1, suggestion: "" }))).toBeUndefined()
    expect(suggestionProblem(lines, at(40))).toBeUndefined()
  })

  it("rejects removed lines", () => {
    expect(suggestionProblem(lines, { ...at(2, { suggestion: "x" }), side: "LEFT" })).toMatch(/side RIGHT/)
    expect(suggestionProblem(lines, at(2, { startLine: 1, startSide: "LEFT", suggestion: "x" }))).toMatch(/RIGHT/)
  })

  it("rejects a range that spans two hunks", () => {
    expect(suggestionProblem(lines, at(21, { startLine: 3, suggestion: "x" }))).toMatch(/src\/app.ts:4 is not/)
  })
})
