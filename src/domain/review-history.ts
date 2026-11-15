import * as v from "valibot"
import { Verdict } from "./review-draft.js"
import type { ReviewRequest } from "./review-request.js"

/** Also keeps a stored value from reaching git as an option. */
const CommitSha = v.pipe(v.string(), v.hexadecimal(), v.minLength(40), v.maxLength(64))

/** What the user last posted on a pull request; it outlives the draft, which is forgotten once posted. */
export const ReviewedRecord = v.object({
  version: v.literal(1),
  key: v.string(),
  repository: v.string(),
  number: v.number(),
  headSha: CommitSha,
  baseSha: v.exactOptional(CommitSha),
  verdict: Verdict,
  postedUrl: v.string(),
  postedAt: v.string(),
})
export type ReviewedRecord = v.InferOutput<typeof ReviewedRecord>

export const reviewedFor = (records: readonly ReviewedRecord[], key: string) =>
  records.find((record) => record.key === key)

export function followUpOf(item: ReviewRequest, record: ReviewedRecord | undefined): ReviewedRecord | undefined {
  if (!record || !item.headSha || item.headSha === record.headSha) {
    return undefined
  }
  return record
}
