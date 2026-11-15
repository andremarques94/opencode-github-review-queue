import * as v from "valibot"
import { Authored } from "./my-pull-request.js"

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
  /** Queued for new commits since the user's posted review, not because GitHub asks for a review. */
  followUp: v.exactOptional(v.literal(true)),
  additions: v.exactOptional(v.number()),
  deletions: v.exactOptional(v.number()),
  changedFiles: v.exactOptional(v.number()),
  /** When the user, or one of the requested teams, was last asked to review. */
  requestedAt: v.exactOptional(v.string()),
  lastCommitAt: v.exactOptional(v.string()),
  /** Only on the user's own pull requests. */
  authored: v.exactOptional(Authored),
})
export type ReviewRequest = v.InferOutput<typeof ReviewRequest>

/** A follow-up waits from the last commit, a request from when it was made; the pull request's age is the fallback. */
export const waitingSince = (item: ReviewRequest): string =>
  (item.followUp ? item.lastCommitAt : item.requestedAt) ?? item.createdAt

export const changedLines = (item: ReviewRequest): number | undefined =>
  item.additions === undefined || item.deletions === undefined ? undefined : item.additions + item.deletions

export function requestKey(repository: string, number: number): string {
  return `${repository.toLowerCase()}#${number}`
}
