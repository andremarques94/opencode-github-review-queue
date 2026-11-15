import type { LineComment } from "../rpc.js"

/** The parts of a Desktop line comment this needs; a selection without a side is on the file as checked out. */
export type ScreenComment = {
  file: string
  selection: { start: number; end: number; side?: "additions" | "deletions"; endSide?: "additions" | "deletions" }
  comment: string
}

const sideOf = (side: ScreenComment["selection"]["side"]) => (side === "deletions" ? "LEFT" : "RIGHT")

export function lineComment(comment: ScreenComment): LineComment {
  const { start, end } = comment.selection
  const startSide = sideOf(comment.selection.side)
  const side = sideOf(comment.selection.endSide ?? comment.selection.side)
  const single = start === end && startSide === side
  return {
    path: comment.file,
    line: end,
    side,
    ...(single ? {} : { startLine: start, startSide }),
    note: comment.comment,
  }
}
