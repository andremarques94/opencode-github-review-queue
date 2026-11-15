export type DiffSide = "LEFT" | "RIGHT"

export type CommentableLines = ReadonlyMap<string, { LEFT: ReadonlySet<number>; RIGHT: ReadonlySet<number> }>

type FileLines = { LEFT: Set<number>; RIGHT: Set<number> }

const FILE_HEADER = "diff --git "
const HUNK_HEADER = "@@ "
const NO_FILE = "/dev/null"

/** `+++ b/src/app.ts` or `--- a/src/app.ts` → `src/app.ts`; undefined for a created or deleted file's missing side. */
function pathFrom(header: string | undefined): string | undefined {
  const path = header?.slice("+++ ".length).split("\t")[0]
  if (!path || path === NO_FILE) {
    return undefined
  }
  return path.startsWith("a/") || path.startsWith("b/") ? path.slice(2) : path
}

/** `@@ -12,6 +12,24 @@ …` → the first old and new line numbers of the hunk. */
function hunkStart(line: string): { old: number; new: number } | undefined {
  if (!line.startsWith(HUNK_HEADER)) {
    return undefined
  }
  const [, oldRange = "", newRange = ""] = line.split(" ")
  const start = (range: string) => Number(range.slice(1).split(",")[0])
  return { old: start(oldRange), new: start(newRange) }
}

function recordLine(file: FileLines, marker: string | undefined, cursor: { old: number; new: number }): void {
  switch (marker) {
    case "+":
      file.RIGHT.add(cursor.new++)
      return
    case "-":
      file.LEFT.add(cursor.old++)
      return
    case " ":
      file.LEFT.add(cursor.old++)
      file.RIGHT.add(cursor.new++)
      return
  }
}

function parseFile(lines: readonly string[]): [string, FileLines] | undefined {
  const header = lines.findIndex((line) => line.startsWith("+++ "))
  const path = header === -1 ? undefined : (pathFrom(lines[header]) ?? pathFrom(lines[header - 1]))
  if (!path) {
    return undefined
  }
  const file: FileLines = { LEFT: new Set(), RIGHT: new Set() }
  let cursor = { old: 0, new: 0 }
  for (const line of lines.slice(header + 1)) {
    const hunk = hunkStart(line)
    if (hunk) {
      cursor = hunk
      continue
    }
    recordLine(file, line[0], cursor)
  }
  return [path, file]
}

function fileSections(diff: string): string[][] {
  const sections: string[][] = []
  for (const line of diff.split("\n")) {
    if (line.startsWith(FILE_HEADER)) {
      sections.push([])
      continue
    }
    sections.at(-1)?.push(line)
  }
  return sections
}

export function commentableLines(diff: string): CommentableLines {
  const files = new Map<string, FileLines>()
  for (const section of fileSections(diff)) {
    const parsed = parseFile(section)
    if (parsed) {
      files.set(...parsed)
    }
  }
  return files
}

export function commentProblem(
  lines: CommentableLines,
  target: { path: string; line: number; side: DiffSide; startLine?: number; startSide?: DiffSide },
): string | undefined {
  const file = lines.get(target.path)
  if (!file) {
    return `${target.path} is not part of this pull request's diff.`
  }
  if (!file[target.side].has(target.line)) {
    return `${target.path}:${target.line} (${target.side}) is not a changed or context line in the diff.`
  }
  if (target.startLine === undefined) {
    return undefined
  }
  const startSide = target.startSide ?? target.side
  if (!file[startSide].has(target.startLine)) {
    return `${target.path}:${target.startLine} (${startSide}) is not a changed or context line in the diff.`
  }
  if (startSide === target.side && target.startLine >= target.line) {
    return "startLine must be before line."
  }
  return undefined
}

/**
 * A suggestion replaces new lines, so it needs RIGHT on both ends, and GitHub only applies one whose lines run
 * unbroken through a single hunk: a gap in the new lines means the range spans two.
 */
export function suggestionProblem(
  lines: CommentableLines,
  target: { path: string; line: number; side: DiffSide; startLine?: number; startSide?: DiffSide; suggestion?: string },
): string | undefined {
  if (target.suggestion === undefined) {
    return undefined
  }
  if (target.side !== "RIGHT" || (target.startSide ?? target.side) !== "RIGHT") {
    return "A suggestion replaces new lines, so it needs side RIGHT; describe a fix for removed lines in the body."
  }
  const right = lines.get(target.path)?.RIGHT
  for (let line = target.startLine ?? target.line; line <= target.line; line++) {
    if (!right?.has(line)) {
      return `A suggestion must cover lines of one hunk, and ${target.path}:${line} is not in the diff.`
    }
  }
  return undefined
}
