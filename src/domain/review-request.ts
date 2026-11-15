import * as v from "valibot"
import { Authored, ReviewDecision } from "./my-pull-request.js"

const Checks = v.picklist(["passing", "failing", "pending"])
export type Checks = v.InferOutput<typeof Checks>

/** Lists every requested team: which ones the user belongs to is not fetched. */
const RequestedVia = v.variant("kind", [
  v.object({ kind: v.literal("you") }),
  v.object({ kind: v.literal("team"), teams: v.pipe(v.array(v.string()), v.nonEmpty()) }),
])
export type RequestedVia = v.InferOutput<typeof RequestedVia>

const ReviewState = v.picklist(["APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED"])
export type ReviewState = v.InferOutput<typeof ReviewState>

/** A reviewer's latest review. */
const Review = v.object({ author: v.string(), state: ReviewState, submittedAt: v.exactOptional(v.string()) })
export type Review = v.InferOutput<typeof Review>

/** Readiness fields are optional: GitHub may not know them yet, and older saved queues lack them. */
export const ReviewRequest = v.object({
  key: v.string(),
  /** Left out for github.com. */
  host: v.exactOptional(v.string()),
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
  /** GitHub only says so where the base branch requires branches to be up to date. */
  behind: v.exactOptional(v.literal(true)),
  /** Missing when the repository requires no reviews. */
  reviewDecision: v.exactOptional(ReviewDecision),
  unresolvedThreads: v.exactOptional(v.number()),
  /** Only the first page of threads was counted, so `unresolvedThreads` is a lower bound. */
  unresolvedThreadsCapped: v.exactOptional(v.boolean()),
  requestedVia: v.exactOptional(RequestedVia),
  /** Queued for new commits since the user's posted review, not because GitHub asks for a review. */
  followUp: v.exactOptional(v.literal(true)),
  additions: v.exactOptional(v.number()),
  deletions: v.exactOptional(v.number()),
  changedFiles: v.exactOptional(v.number()),
  requestedAt: v.exactOptional(v.string()),
  lastCommitAt: v.exactOptional(v.string()),
  reviews: v.exactOptional(v.array(Review)),
  authored: v.exactOptional(Authored),
})
export type ReviewRequest = v.InferOutput<typeof ReviewRequest>

export const waitingSince = (item: ReviewRequest): string =>
  (item.followUp ? item.lastCommitAt : item.requestedAt) ?? item.createdAt

export const changedLines = (item: ReviewRequest): number | undefined =>
  item.additions === undefined || item.deletions === undefined ? undefined : item.additions + item.deletions

export const GITHUB_COM = "github.com"

/** A pull request on one GitHub host; `host` is left out for github.com. */
export type PullRequestRef = { host?: string | undefined; repository: string; number: number }
export type RepositoryRef = Pick<PullRequestRef, "host" | "repository">

/** `owner/repo` on github.com, `host/owner/repo` elsewhere. */
export const qualifiedRepository = (ref: RepositoryRef): string =>
  ref.host ? `${ref.host}/${ref.repository}` : ref.repository

/** Keys on github.com stay `owner/repo#n`, so drafts, records and snoozes saved before other hosts still match. */
export function requestKey(repository: string, number: number, host?: string): string {
  return `${qualifiedRepository({ host, repository }).toLowerCase()}#${number}`
}

export const hostOf = (ref: Pick<PullRequestRef, "host">): string => ref.host ?? GITHUB_COM

/** Left out for github.com, so its items keep their shape. */
export const hostField = (host: string): { host?: string } =>
  host.toLowerCase() === GITHUB_COM ? {} : { host: host.toLowerCase() }
