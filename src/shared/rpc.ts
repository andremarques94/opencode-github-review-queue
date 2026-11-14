import { Rpc } from "@opencode/plugin/rpc"
import * as v from "valibot"
import { QueueSnapshot } from "../domain/review-queue.js"
import { ReviewRequest } from "../domain/review-request.js"

const empty = v.strictObject({})

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
      input: v.strictObject({ key: v.string() }),
      output: v.strictObject({ opened: v.boolean() }),
    },
  },
  events: {
    state: { schema: QueueSnapshot },
    discovered: { schema: v.object({ item: ReviewRequest, eventID: v.string() }) },
  },
} satisfies Rpc.PortableDefinition)
