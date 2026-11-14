import type { ToolEditor } from "@opencode/plugin/promise/tool"
import * as v from "valibot"
import { type Finding, FindingFields, nextFinding, type ReviewDraft, Verdict } from "../../../domain/review-draft.js"
import type { Findings } from "../findings.js"
import { nextStep, presentFinding } from "./instructions.js"

const NAMESPACE = "review"
// Direct tools, because the `context` hook can only hide tools the model calls directly; Code Mode tools are folded
// into the `execute` tool. It also gives them the `review_*` names the instructions use.
const REVIEW_TOOL_OPTIONS = { namespace: NAMESPACE, codemode: false } as const

export function hideReviewTools(tools: Record<string, unknown>): void {
  for (const name of Object.keys(tools)) {
    if (name.startsWith(`${NAMESPACE}_`)) {
      delete tools[name]
    }
  }
}

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

// The long fields sit in one nested object because the TUI draws a tool call as its name plus every top-level
// string, number, and boolean argument; nested objects are left out, so the row stays `review_update_finding [id=2]`.
const AddInput = v.strictObject({ finding: v.strictObject(FindingFields) })
const UpdateInput = v.strictObject({
  id: v.number(),
  changes: v.strictObject(v.partial(v.object(FindingFields)).entries),
})
const DecideInput = v.strictObject({ id: v.number(), decision: v.picklist(["keep", "drop"]) })
const VerdictInput = v.strictObject({
  review: v.strictObject({ verdict: Verdict, summary: v.pipe(v.string(), v.nonEmpty()) }),
})

function parse<T>(schema: v.GenericSchema<unknown, T>, input: unknown): T {
  const parsed = v.safeParse(schema, input)
  if (!parsed.success) {
    throw new Error(parsed.issues.map((issue) => `${v.getDotPath(issue) ?? "input"}: ${issue.message}`).join("; "))
  }
  return parsed.output
}

const describeFinding = (finding: Finding) =>
  `#${finding.id} ${finding.path}:${finding.line} (${finding.side}) ${finding.severity} [${finding.decision}]`

const reply = (text: string, draft: ReviewDraft) => ({ content: [text, nextStep(draft)].filter(Boolean).join("\n\n") })

export function addReviewTools(editor: ToolEditor, findings: Findings): void {
  editor.namespace({
    name: NAMESPACE,
    description:
      "Record the pull request review draft for the review queue panel. Only available in review sessions the panel started.",
  })
  editor.add({
    name: "add_finding",
    description: "Add a finding to the review draft. Rejects lines that are not part of the pull request diff.",
    input: {
      type: "object",
      properties: {
        finding: {
          type: "object",
          properties: findingProperties,
          required: ["path", "line", "side", "severity", "confidence", "evidence", "body"],
          additionalProperties: false,
        },
      },
      required: ["finding"],
      additionalProperties: false,
    },
    options: REVIEW_TOOL_OPTIONS,
    execute: async (input, context) => {
      const finding = await findings.add(context.sessionID, parse(AddInput, input).finding)
      return reply(`Recorded ${describeFinding(finding)}.`, await findings.draftForSession(context.sessionID))
    },
  })
  editor.add({
    name: "update_finding",
    description:
      "Change a finding the user agreed to revise. Changing it puts it back to pending until the user decides again.",
    input: {
      type: "object",
      properties: {
        id: { type: "integer" },
        changes: {
          type: "object",
          description: "Only the fields to change.",
          properties: findingProperties,
          additionalProperties: false,
        },
      },
      required: ["id", "changes"],
      additionalProperties: false,
    },
    options: REVIEW_TOOL_OPTIONS,
    execute: async (input, context) => {
      const { id, changes } = parse(UpdateInput, input)
      const finding = await findings.update(context.sessionID, id, changes)
      return reply(`Updated ${describeFinding(finding)}.`, await findings.draftForSession(context.sessionID))
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
    options: REVIEW_TOOL_OPTIONS,
    execute: async (input, context) => {
      const { id, decision } = parse(DecideInput, input)
      const finding = await findings.decide(context.sessionID, id, decision)
      return reply(`Recorded ${describeFinding(finding)}.`, await findings.draftForSession(context.sessionID))
    },
  })
  editor.add({
    name: "set_verdict",
    description: "Propose the review verdict and the 2-5 sentence overall summary once investigation is done.",
    input: {
      type: "object",
      properties: {
        review: {
          type: "object",
          properties: {
            verdict: { type: "string", enum: ["REQUEST_CHANGES", "COMMENT", "APPROVE"] },
            summary: { type: "string", description: "Main problems and what has to happen before this merges." },
          },
          required: ["verdict", "summary"],
          additionalProperties: false,
        },
      },
      required: ["review"],
      additionalProperties: false,
    },
    options: REVIEW_TOOL_OPTIONS,
    execute: async (input, context) => {
      const { verdict, summary } = parse(VerdictInput, input).review
      const draft = await findings.setVerdict(context.sessionID, verdict, summary)
      return reply(
        `Verdict ${draft.verdict}. ${draft.findings.length} findings in the draft. Send the overview now without describing any finding.`,
        draft,
      )
    },
  })
  editor.add({
    name: "next_finding",
    description:
      "Get the one finding to present next, as a card to show the user. Present only this finding, then wait for the user's decision.",
    input: { type: "object", properties: {}, additionalProperties: false },
    options: REVIEW_TOOL_OPTIONS,
    execute: async (_input, context) => {
      const draft = await findings.draftForSession(context.sessionID)
      const finding = nextFinding(draft)
      if (!finding) {
        return reply("No finding is waiting for a decision.", draft)
      }
      return { content: presentFinding(draft, finding) }
    },
  })
  editor.add({
    name: "get_draft",
    description:
      "Read the whole review draft to check decisions or the final summary. Never use it to present several findings at once.",
    input: { type: "object", properties: {}, additionalProperties: false },
    options: REVIEW_TOOL_OPTIONS,
    execute: async (_input, context) => {
      const draft = await findings.draftForSession(context.sessionID)
      return reply(JSON.stringify(draft, null, 2), draft)
    },
  })
}
