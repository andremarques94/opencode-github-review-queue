import { describe, expect, it } from "vitest"
import { lineComment } from "../src/shared/review/line-comments.js"

describe("lineComment", () => {
  it("comments on one line of the file as checked out on the new side", () => {
    expect(lineComment({ file: "src/app.ts", selection: { start: 4, end: 4 }, comment: "Why?" })).toEqual({
      path: "src/app.ts",
      line: 4,
      side: "RIGHT",
      note: "Why?",
    })
  })

  it("keeps a range, and a range that starts on the removed side", () => {
    expect(
      lineComment({
        file: "src/app.ts",
        selection: { start: 2, end: 5, side: "deletions", endSide: "additions" },
        comment: "",
      }),
    ).toEqual({ path: "src/app.ts", line: 5, side: "RIGHT", startLine: 2, startSide: "LEFT", note: "" })
  })

  it("puts a removed line on the old side", () => {
    expect(
      lineComment({ file: "a.ts", selection: { start: 7, end: 7, side: "deletions" }, comment: "" }),
    ).toMatchObject({
      line: 7,
      side: "LEFT",
    })
  })
})
