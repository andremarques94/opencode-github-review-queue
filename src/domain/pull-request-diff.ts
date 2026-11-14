export type DiffSide = "LEFT" | "RIGHT"

/** Lines GitHub accepts review comments on, per file: old line numbers on LEFT, new line numbers on RIGHT. */
export type CommentableLines = ReadonlyMap<string, { LEFT: ReadonlySet<number>; RIGHT: ReadonlySet<number> }>

type FileLines = { LEFT: Set<number>; RIGHT: Set<number> }

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

function pathFrom(header: string | undefined): string | undefined {
  const path = header?.slice(4).replace(/\t.*$/, "")
  if (!path || path === "/dev/null") {
    return undefined
  }
  return path.replace(/^[ab]\//, "")
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

/** One `diff --git` section; binary files and sections without hunks have no commentable lines. */
function parseFile(section: string): [string, FileLines] | undefined {
  const lines = section.split("\n")
  const header = lines.findIndex((line) => line.startsWith("+++ "))
  const path = header === -1 ? undefined : (pathFrom(lines[header]) ?? pathFrom(lines[header - 1]))
  if (!path) {
    return undefined
  }
  const file: FileLines = { LEFT: new Set(), RIGHT: new Set() }
  const cursor = { old: 0, new: 0 }
  for (const line of lines.slice(header + 1)) {
    const hunk = line.match(HUNK)
    if (hunk) {
      cursor.old = Number(hunk[1])
      cursor.new = Number(hunk[2])
      continue
    }
    recordLine(file, line[0], cursor)
  }
  return [path, file]
}

export function commentableLines(diff: string): CommentableLines {
  const files = new Map<string, FileLines>()
  for (const section of diff.split(/^diff --git .*$/m).slice(1)) {
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
