import { Rpc } from "@opencode/plugin/rpc"
import * as v from "valibot"
import { MyNotice } from "../domain/my-pull-request.js"
import { FindingFields, ReviewDraft, ReviewSubmission } from "../domain/review-draft.js"
import { ReviewedRecord } from "../domain/review-history.js"
import { QueueSnapshot } from "../domain/review-queue.js"
import { ReviewRequest } from "../domain/review-request.js"
import { Snooze, SnoozeUntil } from "../domain/snooze.js"

const empty = v.strictObject({})
const byKey = v.strictObject({ key: v.string() })
/** Everything the panel keeps locally about each pull request, re-read together. */
const drafts = v.strictObject({
  drafts: v.array(ReviewDraft),
  reviewed: v.array(ReviewedRecord),
  snoozes: v.array(Snooze),
  /** Repositories the user collapsed, as lowercase `qualifiedRepository` names. */
  collapsed: v.array(v.string()),
})
export type LocalReviews = v.InferOutput<typeof drafts>
const draft = v.strictObject({ draft: ReviewDraft })
const byFinding = { sessionID: v.string(), id: v.number() }
const errors = { failed: v.undefined() }
export const LineComment = v.strictObject({
  path: FindingFields.path,
  line: FindingFields.line,
  side: FindingFields.side,
  startLine: FindingFields.startLine,
  startSide: FindingFields.startSide,
  note: v.string(),
})
export type LineComment = v.InferOutput<typeof LineComment>
export const ModelRef = v.object({ providerID: v.string(), id: v.string() })
export type ModelRef = v.InferOutput<typeof ModelRef>
const SkillPickerTarget = v.object({
  id: v.string(),
  sessionID: v.string(),
  directory: v.string(),
})
export type SkillPickerTarget = v.InferOutput<typeof SkillPickerTarget>
export const SkillPicker = v.object({
  ...SkillPickerTarget.entries,
  tool: v.object({ messageID: v.string(), id: v.string() }),
  skills: v.array(
    v.object({ id: v.string(), name: v.string(), description: v.exactOptional(v.string()), recommended: v.boolean() }),
  ),
})
export type SkillPicker = v.InferOutput<typeof SkillPicker>

export const ReviewQueue = Rpc.define({
  id: "github-review-queue",
  methods: {
    snapshot: { input: empty, output: QueueSnapshot },
    refresh: { input: empty, output: QueueSnapshot },
    repository: {
      input: v.strictObject({ directory: v.string() }),
      output: v.strictObject({ repository: v.nullable(v.string()) }),
    },
    open: {
      input: byKey,
      output: v.strictObject({ opened: v.boolean() }),
      errors,
    },
    drafts: { input: empty, output: drafts },
    models: {
      input: empty,
      output: v.object({
        models: v.array(v.object({ ...ModelRef.entries, name: v.string(), provider: v.string() })),
        preferred: v.nullable(ModelRef),
      }),
    },
    skillPickers: { input: empty, output: v.object({ requests: v.array(SkillPicker) }) },
    claimSkillPicker: { input: v.strictObject({ id: v.string() }), output: v.object({ claimed: v.boolean() }) },
    failSkillPicker: {
      input: v.strictObject({ id: v.string(), message: v.string() }),
      output: empty,
    },
    /** For a UI that shows its own picker instead of a native form; `null` means the user dismissed it. */
    answerSkillPicker: {
      input: v.strictObject({ id: v.string(), skills: v.nullable(v.array(v.string())) }),
      output: empty,
    },
    startReview: {
      input: v.strictObject({
        key: v.string(),
        directory: v.exactOptional(v.string()),
        clone: v.boolean(),
        mode: v.exactOptional(v.picklist(["full", "changes"])),
        model: v.exactOptional(ModelRef),
      }),
      errors,
      output: v.variant("status", [
        v.object({ status: v.picklist(["started", "resumed"]), sessionID: v.string() }),
        v.object({ status: v.literal("needs-clone"), repository: v.string(), directory: v.string() }),
      ]),
    },
    resetReview: { input: byKey, output: empty, errors },
    postReview: {
      input: v.strictObject({ key: v.string(), allowStale: v.boolean(), review: v.exactOptional(ReviewSubmission) }),
      output: v.variant("status", [
        v.object({ status: v.literal("posted"), url: v.string(), cleanupWarning: v.exactOptional(v.string()) }),
        v.object({ status: v.literal("stale"), reason: v.string() }),
      ]),
      errors,
    },
    decideFinding: {
      input: v.strictObject({ ...byFinding, decision: v.picklist(["keep", "drop"]) }),
      output: draft,
      errors,
    },
    editFinding: {
      /** The comment as posted: a closing suggestion block becomes the finding's suggestion. */
      input: v.strictObject({ ...byFinding, body: FindingFields.body }),
      output: draft,
      errors,
    },
    askAboutFinding: { input: v.strictObject(byFinding), output: empty, errors },
    addLineComments: {
      input: v.strictObject({ sessionID: v.string(), comments: v.pipe(v.array(LineComment), v.nonEmpty()) }),
      output: empty,
      errors,
    },
    summarize: {
      input: v.strictObject({ key: v.string(), model: ModelRef }),
      output: v.strictObject({ summary: v.string(), truncated: v.boolean() }),
      errors,
    },
    addressReview: {
      input: v.strictObject({
        key: v.string(),
        directory: v.exactOptional(v.string()),
        worktree: v.boolean(),
        model: v.exactOptional(ModelRef),
      }),
      output: v.variant("status", [
        v.strictObject({ status: v.picklist(["started", "resumed"]), sessionID: v.string() }),
        v.strictObject({
          status: v.literal("needs-worktree"),
          branch: v.string(),
          current: v.exactOptional(v.string()),
          directory: v.string(),
        }),
        v.strictObject({ status: v.literal("needs-model") }),
      ]),
      errors,
    },
    snooze: { input: v.strictObject({ key: v.string(), until: SnoozeUntil }), output: drafts, errors },
    snoozeRepository: { input: v.strictObject({ key: v.string(), at: v.string() }), output: drafts, errors },
    /** `key` is the snooze's key: a pull request's, or its repository's. */
    wake: { input: byKey, output: drafts, errors },
    collapse: { input: v.strictObject({ repository: v.string(), collapsed: v.boolean() }), output: drafts, errors },
  },
  events: {
    state: { schema: QueueSnapshot },
    discovered: { schema: v.object({ item: ReviewRequest, eventID: v.string() }) },
    notice: { schema: v.object({ notice: MyNotice, item: ReviewRequest, eventID: v.string() }) },
    drafts: { schema: drafts },
    skillPicker: { schema: SkillPicker },
    closeSkillPicker: { schema: SkillPickerTarget },
  },
} satisfies Rpc.PortableDefinition)

export type RpcInput<K extends keyof typeof ReviewQueue.methods> = v.InferOutput<
  (typeof ReviewQueue.methods)[K]["input"]
>
export type RpcOutput<K extends keyof typeof ReviewQueue.methods> = v.InferOutput<
  (typeof ReviewQueue.methods)[K]["output"]
>

/** RPC failures arrive as plain `{ type, message }` objects, not `Error`s. */
export function errorMessage(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return error.message
  }
  return undefined
}
