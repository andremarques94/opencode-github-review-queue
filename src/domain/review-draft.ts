import * as v from "valibot"

export const Verdict = v.picklist(["REQUEST_CHANGES", "COMMENT", "APPROVE"])
export type Verdict = v.InferOutput<typeof Verdict>

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
}

const Finding = v.object({
  id: v.number(),
  ...FindingFields,
  decision: Decision,
})
export type Finding = v.InferOutput<typeof Finding>
export type FindingInput = Omit<Finding, "id" | "decision">
export type FindingChanges = { [K in keyof FindingInput]?: FindingInput[K] | undefined }

const DraftStatus = v.picklist(["investigating", "ready", "posted"])

export const ReviewDraft = v.object({
  version: v.literal(1),
  key: v.string(),
  repository: v.string(),
  number: v.number(),
  title: v.string(),
  headSha: v.string(),
  ownPullRequest: v.boolean(),
  checkout: v.string(),
  worktree: v.string(),
  sessionID: v.string(),
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

export function pendingFindings(draft: ReviewDraft): Finding[] {
  return draft.findings.filter((finding) => finding.decision === "pending")
}

const SEVERITY_RANK: Record<Finding["severity"], number> = { blocker: 0, major: 1, minor: 2, nit: 3 }
const CONFIDENCE_RANK: Record<Finding["confidence"], number> = { high: 0, medium: 1, low: 2 }

export function nextFinding(draft: ReviewDraft): Finding | undefined {
  return pendingFindings(draft).sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence] ||
      a.id - b.id,
  )[0]
}

export function postBlocker(draft: ReviewDraft, headSha?: string): string | undefined {
  if (draft.status === "posted") {
    return "This review was already posted."
  }
  if (draft.status === "investigating" || !draft.verdict || draft.summary === undefined) {
    return "The review is still being investigated; no verdict has been proposed yet."
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
    comments: draft.findings
      .filter((finding) => finding.decision === "keep")
      .map((finding) => ({
        path: finding.path,
        line: finding.line,
        side: finding.side,
        ...(finding.startLine === undefined
          ? {}
          : { start_line: finding.startLine, start_side: finding.startSide ?? finding.side }),
        body: finding.body,
      })),
  }
}
