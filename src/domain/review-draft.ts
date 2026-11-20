import * as v from "valibot"

export const Verdict = v.picklist(["REQUEST_CHANGES", "COMMENT", "APPROVE"])
export type Verdict = v.InferOutput<typeof Verdict>

/** The final comment and state confirmed by the user, without another model turn. */
export const ReviewSubmission = v.strictObject({ verdict: Verdict, summary: v.string() })
export type ReviewSubmission = v.InferOutput<typeof ReviewSubmission>

const Side = v.picklist(["LEFT", "RIGHT"])
const Severity = v.picklist(["blocker", "major", "minor", "nit"])
const Confidence = v.picklist(["high", "medium", "low"])
const Decision = v.picklist(["pending", "keep", "drop"])
export type Decision = v.InferOutput<typeof Decision>

const LineNumber = v.pipe(v.number(), v.integer(), v.minValue(1))

export const FindingFields = {
  path: v.pipe(v.string(), v.nonEmpty()),
  line: LineNumber,
  side: Side,
  startLine: v.exactOptional(LineNumber),
  startSide: v.exactOptional(Side),
  severity: Severity,
  confidence: Confidence,
  evidence: v.string(),
  body: v.pipe(v.string(), v.nonEmpty()),
  /** Empty deletes the commented lines. */
  suggestion: v.exactOptional(v.string()),
}

const Finding = v.object({
  id: v.number(),
  ...FindingFields,
  decision: Decision,
})
export type Finding = v.InferOutput<typeof Finding>
export type FindingInput = Omit<Finding, "id" | "decision">
/** `suggestion: null` removes the suggestion. */
export type FindingChanges = { [K in Exclude<keyof FindingInput, "suggestion">]?: FindingInput[K] | undefined } & {
  suggestion?: string | null | undefined
}

const DraftStatus = v.picklist(["investigating", "ready", "posted"])

export const ReviewDraft = v.object({
  version: v.literal(1),
  key: v.string(),
  /** Left out for github.com. */
  host: v.exactOptional(v.string()),
  repository: v.string(),
  number: v.number(),
  title: v.string(),
  headSha: v.string(),
  /** Missing on drafts started before it was recorded. */
  baseSha: v.exactOptional(v.string()),
  /** The head of the last posted review, when this one only covers the changes since. */
  sinceSha: v.exactOptional(v.string()),
  ownPullRequest: v.boolean(),
  checkout: v.string(),
  worktree: v.string(),
  sessionID: v.string(),
  /** Confirmed skill IDs; missing until the user submits the skill picker. Empty means no skills. */
  skillIDs: v.exactOptional(v.array(v.string())),
  status: DraftStatus,
  verdict: v.exactOptional(Verdict),
  summary: v.exactOptional(v.string()),
  findings: v.array(Finding),
  createdAt: v.string(),
  updatedAt: v.string(),
  postedUrl: v.exactOptional(v.string()),
})
export type ReviewDraft = v.InferOutput<typeof ReviewDraft>

export type ReviewPayload = {
  commit_id: string
  event: Verdict
  body: string
  comments: {
    path: string
    line: number
    side: "LEFT" | "RIGHT"
    start_line?: number
    start_side?: "LEFT" | "RIGHT"
    body: string
  }[]
}

const SUGGESTION_OPENING = /^(`{3,})suggestion[ \t]*$/

/** Longer than any backtick run inside, so a suggestion that quotes a fence still closes. */
function fenceFor(text: string): string {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((run) => run.length))
  return "`".repeat(longest + 1)
}

export function commentBody(finding: Pick<Finding, "body" | "suggestion">): string {
  if (finding.suggestion === undefined) {
    return finding.body
  }
  const fence = fenceFor(finding.suggestion)
  const lines = finding.suggestion === "" ? "" : `${finding.suggestion}\n`
  return `${finding.body.trimEnd()}\n\n${fence}suggestion\n${lines}${fence}`
}

export function splitComment(text: string): { body: string; suggestion?: string } {
  const lines = text.trimEnd().split("\n")
  const closing = lines.at(-1)?.trim()
  const opening = lines.findLastIndex(
    (line, index) => index < lines.length - 1 && SUGGESTION_OPENING.exec(line.trim())?.[1] === closing,
  )
  if (opening === -1) {
    return { body: text }
  }
  return { body: lines.slice(0, opening).join("\n").trimEnd(), suggestion: lines.slice(opening + 1, -1).join("\n") }
}

export const keptFindings = (draft: ReviewDraft) => draft.findings.filter((finding) => finding.decision === "keep")

/** `src/app.ts:12`, or `src/app.ts:10-12` for a range. */
export const findingLocation = (finding: Pick<Finding, "path" | "line" | "startLine">) =>
  `${finding.path}:${finding.startLine === undefined ? "" : `${finding.startLine}-`}${finding.line}`

export function pendingFindings(draft: ReviewDraft): Finding[] {
  return draft.findings.filter((finding) => finding.decision === "pending")
}

const SEVERITY_RANK: Record<Finding["severity"], number> = { blocker: 0, major: 1, minor: 2, nit: 3 }
const CONFIDENCE_RANK: Record<Finding["confidence"], number> = { high: 0, medium: 1, low: 2 }

export function walkthroughOrder(draft: ReviewDraft): Finding[] {
  return draft.findings.toSorted(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence] ||
      a.id - b.id,
  )
}

export function nextFinding(draft: ReviewDraft): Finding | undefined {
  return walkthroughOrder(draft).find((finding) => finding.decision === "pending")
}

const QUESTION_PREFIX = "Finding #"

/** The header of the agent's question about a finding; the panel matches it to close that question. */
export const questionHeader = (id: number) => `${QUESTION_PREFIX}${id}`

export const isFindingQuestion = (header: string | undefined) => header?.startsWith(QUESTION_PREFIX) === true

export function postBlocker(draft: ReviewDraft, headSha?: string): string | undefined {
  if (draft.status === "posted") {
    return "This review was already posted."
  }
  if (draft.status === "investigating" || !draft.verdict || draft.summary === undefined) {
    return "The review is still being investigated; no verdict has been proposed yet."
  }
  if (draft.ownPullRequest && draft.verdict !== "COMMENT") {
    return "GitHub does not let you approve or request changes on your own pull request; use COMMENT."
  }
  const pending = pendingFindings(draft).length
  if (pending > 0) {
    return `${pending} finding${pending === 1 ? " is" : "s are"} still waiting for your decision.`
  }
  if (headSha && headSha !== draft.headSha) {
    return "New commits were pushed since this review was drafted."
  }
  return undefined
}

export function reviewPayload(draft: ReviewDraft): ReviewPayload {
  return {
    commit_id: draft.headSha,
    event: draft.verdict ?? "COMMENT",
    body: draft.summary ?? "",
    comments: keptFindings(draft).map((finding) => ({
      path: finding.path,
      line: finding.line,
      side: finding.side,
      ...(finding.startLine === undefined
        ? {}
        : { start_line: finding.startLine, start_side: finding.startSide ?? finding.side }),
      body: commentBody(finding),
    })),
  }
}
