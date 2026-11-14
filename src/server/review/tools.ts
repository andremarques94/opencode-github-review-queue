import type { ToolEditor } from "@opencode/plugin/promise/tool"
import * as v from "valibot"
import { type Finding, FindingFields, Verdict } from "../../domain/review-draft.js"
import type { ReviewService } from "./review-service.js"

const side = { type: "string", enum: ["LEFT", "RIGHT"] }
const findingProperties = {
  path: { type: "string", description: "File path relative to the repository root, as it appears in the diff." },
  line: { type: "integer", minimum: 1, description: "New line number for RIGHT, old line number for LEFT." },
  side: { ...side, description: "RIGHT for added or context lines, LEFT for removed lines." },
  startLine: { type: "integer", minimum: 1, description: "First line of a multi-line comment." },
  startSide: { ...side, description: "Side of startLine; defaults to side." },
  severity: { type: "string", enum: ["blocker", "major", "minor", "nit"] },
  confidence: { type: "string", enum: ["high", "medium", "low"] },
  evidence: { type: "string", description: "Local notes for the user: what you verified and what is uncertain." },
  body: { type: "string", description: "The exact GitHub comment, in the user's voice." },
} as const

const AddInput = v.strictObject(FindingFields)
const UpdateInput = v.strictObject({ id: v.number(), ...v.partial(v.object(FindingFields)).entries })
const DecideInput = v.strictObject({ id: v.number(), decision: v.picklist(["keep", "drop"]) })
const VerdictInput = v.strictObject({ verdict: Verdict, summary: v.pipe(v.string(), v.nonEmpty()) })

function parse<T>(schema: v.GenericSchema<unknown, T>, input: unknown): T {
  const parsed = v.safeParse(schema, input)
  if (!parsed.success) {
    throw new Error(parsed.issues.map((issue) => `${v.getDotPath(issue) ?? "input"}: ${issue.message}`).join("; "))
  }
  return parsed.output
}

const describeFinding = (finding: Finding) =>
  `#${finding.id} ${finding.path}:${finding.line} (${finding.side}) ${finding.severity} [${finding.decision}]`

export function addReviewTools(editor: ToolEditor, service: ReviewService): void {
  editor.namespace({
    name: "review",
    description:
      "Record the pull request review draft for the review queue panel. Only available in review sessions the panel started.",
  })
  editor.add({
    name: "add_finding",
    description: "Add a finding to the review draft. Rejects lines that are not part of the pull request diff.",
    input: {
      type: "object",
      properties: findingProperties,
      required: ["path", "line", "side", "severity", "confidence", "evidence", "body"],
      additionalProperties: false,
    },
    options: { namespace: "review" },
    execute: async (input, context) => {
      const finding = await service.addFinding(context.sessionID, parse(AddInput, input))
      return { content: `Recorded ${describeFinding(finding)}.` }
    },
  })
  editor.add({
    name: "update_finding",
    description:
      "Change a finding the user agreed to revise. Changing it puts it back to pending until the user decides again.",
    input: {
      type: "object",
      properties: { id: { type: "integer" }, ...findingProperties },
      required: ["id"],
      additionalProperties: false,
    },
    options: { namespace: "review" },
    execute: async (input, context) => {
      const { id, ...changes } = parse(UpdateInput, input)
      const finding = await service.updateFinding(context.sessionID, id, changes)
      return { content: `Updated ${describeFinding(finding)}.` }
    },
  })
  editor.add({
    name: "decide",
    description: "Record the user's explicit decision to keep or drop a finding. Never decide on their behalf.",
    input: {
      type: "object",
      properties: { id: { type: "integer" }, decision: { type: "string", enum: ["keep", "drop"] } },
      required: ["id", "decision"],
      additionalProperties: false,
    },
    options: { namespace: "review" },
    execute: async (input, context) => {
      const { id, decision } = parse(DecideInput, input)
      const finding = await service.decide(context.sessionID, id, decision)
      return { content: `Recorded ${describeFinding(finding)}.` }
    },
  })
  editor.add({
    name: "set_verdict",
    description: "Propose the review verdict and the 2-5 sentence overall summary once investigation is done.",
    input: {
      type: "object",
      properties: {
        verdict: { type: "string", enum: ["REQUEST_CHANGES", "COMMENT", "APPROVE"] },
        summary: { type: "string", description: "Main problems and what has to happen before this merges." },
      },
      required: ["verdict", "summary"],
      additionalProperties: false,
    },
    options: { namespace: "review" },
    execute: async (input, context) => {
      const { verdict, summary } = parse(VerdictInput, input)
      const draft = await service.setVerdict(context.sessionID, verdict, summary)
      return { content: `Verdict ${draft.verdict}. ${draft.findings.length} findings in the draft.` }
    },
  })
  editor.add({
    name: "get_draft",
    description: "Read the current review draft, including the user's decisions so far.",
    input: { type: "object", properties: {}, additionalProperties: false },
    options: { namespace: "review" },
    execute: async (_input, context) => {
      const draft = await service.draftForSession(context.sessionID)
      return { content: JSON.stringify(draft, null, 2) }
    },
  })
}
