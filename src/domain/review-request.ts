import * as v from "valibot"

const Checks = v.picklist(["passing", "failing", "pending"])
export type Checks = v.InferOutput<typeof Checks>

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
})
export type ReviewRequest = v.InferOutput<typeof ReviewRequest>

export function requestKey(repository: string, number: number): string {
  return `${repository.toLowerCase()}#${number}`
}
