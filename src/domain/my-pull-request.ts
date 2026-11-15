import * as v from "valibot"
import type { ReviewRequest } from "./review-request.js"

/** What GitHub says about reviews of the user's own pull request. Reviewers are logins, or `org/slug` for teams. */
export const Authored = v.object({
  reviewDecision: v.exactOptional(v.picklist(["APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"])),
  /** GitHub's merge state says it can be merged as it is; unknown while GitHub is still computing it. */
  mergeReady: v.exactOptional(v.boolean()),
  waitingOn: v.array(v.string()),
  changesRequestedBy: v.array(v.string()),
})
export type Authored = v.InferOutput<typeof Authored>

export type MyStatus = "draft" | "changes-requested" | "blocked" | "ready-to-merge" | "approved" | "waiting"

/** Changes requested come first: it is the one status that waits on the user rather than on someone else. */
export function myStatus(item: ReviewRequest): MyStatus | undefined {
  const authored = item.authored
  if (!authored) {
    return undefined
  }
  if (item.draft) {
    return "draft"
  }
  if (authored.reviewDecision === "CHANGES_REQUESTED") {
    return "changes-requested"
  }
  if (item.conflicts || item.checks === "failing") {
    return "blocked"
  }
  if (authored.mergeReady) {
    return "ready-to-merge"
  }
  return authored.reviewDecision === "APPROVED" ? "approved" : "waiting"
}

const names = (reviewers: readonly string[]) => reviewers.map((reviewer) => `@${reviewer}`).join(", ")

export function myStatusLabel(item: ReviewRequest): string | undefined {
  const status = myStatus(item)
  switch (status) {
    case undefined:
    case "draft":
      return undefined
    case "changes-requested": {
      const by = item.authored?.changesRequestedBy ?? []
      return by.length > 0 ? `changes requested by ${names(by)}` : "changes requested"
    }
    case "blocked":
      return "blocked"
    case "ready-to-merge":
      return "ready to merge"
    case "approved":
      return "approved"
    case "waiting": {
      const on = item.authored?.waitingOn ?? []
      return on.length > 0 ? `waiting on ${names(on)}` : "no reviewers requested"
    }
  }
}

export const needsYou = (item: ReviewRequest) => {
  const status = myStatus(item)
  return status === "changes-requested" || status === "ready-to-merge"
}

/** The session addressing a review of the user's pull request, so the panel can return to it. */
export const AddressSession = v.object({
  version: v.literal(1),
  key: v.string(),
  sessionID: v.string(),
  directory: v.string(),
  createdAt: v.string(),
})
export type AddressSession = v.InferOutput<typeof AddressSession>

/** Worth addressing: someone asked for changes, or left threads nobody resolved. */
export const canAddress = (item: ReviewRequest) =>
  item.authored !== undefined && (myStatus(item) === "changes-requested" || (item.unresolvedThreads ?? 0) > 0)

const MyNoticeKind = v.picklist(["changes-requested", "ready-to-merge", "checks-failed"])
export const MyNotice = v.object({ key: v.string(), kind: MyNoticeKind })
export type MyNotice = v.InferOutput<typeof MyNotice>

/**
 * What changed for the user since the last poll: changes requested, ready to merge, or checks that started failing.
 * A pull request seen for the first time says nothing, so a restart or a new pull request does not notify.
 */
export function myNotices(previous: readonly ReviewRequest[], current: readonly ReviewRequest[]): MyNotice[] {
  const before = new Map(previous.map((item) => [item.key, item]))
  return current.flatMap((item): MyNotice[] => {
    const last = before.get(item.key)
    if (!last) {
      return []
    }
    const status = myStatus(item)
    if (status !== myStatus(last) && (status === "changes-requested" || status === "ready-to-merge")) {
      return [{ key: item.key, kind: status }]
    }
    if (last.checks !== undefined && last.checks !== "failing" && item.checks === "failing") {
      return [{ key: item.key, kind: "checks-failed" }]
    }
    return []
  })
}
