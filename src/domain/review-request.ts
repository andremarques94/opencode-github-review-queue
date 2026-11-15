import * as v from "valibot"

const Checks = v.picklist(["passing", "failing", "pending"])
export type Checks = v.InferOutput<typeof Checks>

/** Teams are `org/slug`. Every requested team is listed: which ones the user belongs to is not fetched. */
const RequestedVia = v.variant("kind", [
  v.object({ kind: v.literal("you") }),
  v.object({ kind: v.literal("team"), teams: v.pipe(v.array(v.string()), v.nonEmpty()) }),
])
export type RequestedVia = v.InferOutput<typeof RequestedVia>

/** Readiness fields are optional: GitHub may not know them yet, and older saved queues lack them. */
export const ReviewRequest = v.object({
  key: v.string(),
  repository: v.string(),
  number: v.number(),
  title: v.string(),
  author: v.string(),
  draft: v.boolean(),
  createdAt: v.string(),
  url: v.string(),
  headSha: v.exactOptional(v.string()),
  baseSha: v.exactOptional(v.string()),
  checks: v.exactOptional(Checks),
  conflicts: v.exactOptional(v.boolean()),
  unresolvedThreads: v.exactOptional(v.number()),
  /** Only the first page of threads was counted, so `unresolvedThreads` is a lower bound. */
  unresolvedThreadsCapped: v.exactOptional(v.boolean()),
  requestedVia: v.exactOptional(RequestedVia),
})
export type ReviewRequest = v.InferOutput<typeof ReviewRequest>

export function requestKey(repository: string, number: number): string {
  return `${repository.toLowerCase()}#${number}`
}
