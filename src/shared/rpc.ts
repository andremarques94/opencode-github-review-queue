import { Rpc } from "@opencode/plugin/rpc"
import * as v from "valibot"
import { FindingFields, ReviewDraft } from "../domain/review-draft.js"
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
})
export type LocalReviews = v.InferOutput<typeof drafts>
const draft = v.strictObject({ draft: ReviewDraft })
const byFinding = { sessionID: v.string(), id: v.number() }
const errors = { failed: v.undefined() }
export const ModelRef = v.object({ providerID: v.string(), id: v.string() })
export type ModelRef = v.InferOutput<typeof ModelRef>

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
      input: v.strictObject({ key: v.string(), allowStale: v.boolean() }),
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
      input: v.strictObject({ ...byFinding, body: FindingFields.body }),
      output: draft,
      errors,
    },
    askAboutFinding: { input: v.strictObject(byFinding), output: empty, errors },
    summarize: {
      input: v.strictObject({ key: v.string(), model: ModelRef }),
      output: v.strictObject({ summary: v.string(), truncated: v.boolean() }),
      errors,
    },
    snooze: { input: v.strictObject({ key: v.string(), until: SnoozeUntil }), output: drafts, errors },
    wake: { input: byKey, output: drafts, errors },
  },
  events: {
    state: { schema: QueueSnapshot },
    discovered: { schema: v.object({ item: ReviewRequest, eventID: v.string() }) },
    drafts: { schema: drafts },
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
