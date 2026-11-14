import { Rpc } from "@opencode/plugin/rpc"
import * as v from "valibot"
import { ReviewDraft } from "../domain/review-draft.js"
import { QueueSnapshot } from "../domain/review-queue.js"
import { ReviewRequest } from "../domain/review-request.js"

const empty = v.strictObject({})
const byKey = v.strictObject({ key: v.string() })
const drafts = v.strictObject({ drafts: v.array(ReviewDraft) })
/** Failures whose message the UI shows as is, instead of a generic internal error. */
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
        v.object({ status: v.literal("posted"), url: v.string() }),
        v.object({ status: v.literal("stale"), reason: v.string() }),
      ]),
      errors,
    },
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
