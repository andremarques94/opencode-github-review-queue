import { pendingFindings, postBlocker, type ReviewDraft } from "../../domain/review-draft.js"
import { followUpOf, type ReviewedRecord as Reviewed, reviewedFor } from "../../domain/review-history.js"
import type { ReviewRequest } from "../../domain/review-request.js"
import type { LocalReviews } from "../rpc.js"
import { VERDICT_LABELS } from "./preview.js"
import { activeSnooze, snoozeLabel } from "./snooze.js"

export function draftLabel(draft: ReviewDraft | undefined): string | undefined {
  if (!draft) {
    return undefined
  }
  switch (draft.status) {
    case "investigating":
      return "reviewing"
    case "posted":
      return "posted"
    case "ready": {
      const pending = pendingFindings(draft).length
      return pending > 0 ? `${pending} to decide` : "ready to post"
    }
  }
}

export const resumable = (draft: ReviewDraft | undefined) => draft !== undefined && draft.status !== "posted"

/** A draft in progress wins; otherwise new commits matter more than a review that is already posted. */
export function reviewLabel(
  item: ReviewRequest,
  draft: ReviewDraft | undefined,
  previous: Reviewed | undefined,
): string | undefined {
  if (!resumable(draft) && followUpOf(item, previous)) {
    return "new commits since your review"
  }
  return draftLabel(draft)
}

export type DraftAction =
  | { kind: "post"; label: string; draft: ReviewDraft; blocker: string | undefined }
  | { kind: "reset"; label: string; draft: ReviewDraft }

export function draftActions(draft: ReviewDraft | undefined): DraftAction[] {
  if (!draft) {
    return []
  }
  const reset: DraftAction = { kind: "reset", label: "Reset review…", draft }
  if (!resumable(draft)) {
    return [reset]
  }
  return [{ kind: "post", label: "Post review…", draft, blocker: postBlocker(draft) }, reset]
}

export const draftFor = (drafts: readonly ReviewDraft[], key: string) => drafts.find((draft) => draft.key === key)

export function rowLabel(item: ReviewRequest, local: LocalReviews, now: number): string | undefined {
  const snooze = activeSnooze(local.snoozes, item, now)
  const review = reviewLabel(item, draftFor(local.drafts, item.key), reviewedFor(local.reviewed, item.key))
  const labels = [snooze ? `snoozed ${snoozeLabel(snooze, now)}` : undefined, review].filter(Boolean)
  return labels.length > 0 ? labels.join(" · ") : undefined
}

export const draftForSession = (drafts: readonly ReviewDraft[], sessionID: string) =>
  drafts.find((draft) => draft.sessionID === sessionID)

export const replaceDraft = (drafts: readonly ReviewDraft[], next: ReviewDraft) =>
  drafts.some((draft) => draft.key === next.key)
    ? drafts.map((draft) => (draft.key === next.key ? next : draft))
    : [...drafts, next]

export const DECISION_LABELS = { pending: "Pending", keep: "Kept", drop: "Dropped" } as const

export type ReviewProgress = {
  label: string
  tone: "warning" | "success" | undefined
  blocker: string | undefined
}

export function reviewProgress(draft: ReviewDraft): ReviewProgress {
  const blocker = postBlocker(draft)
  switch (draft.status) {
    case "investigating":
      return { label: "Investigating", tone: undefined, blocker }
    case "posted":
      return { label: "Posted", tone: "success", blocker }
    case "ready": {
      const decided = draft.findings.length - pendingFindings(draft).length
      const verdict = draft.verdict ? ` · ${VERDICT_LABELS[draft.verdict]}` : ""
      return {
        label: `${decided} of ${draft.findings.length} decided${verdict}`,
        tone: blocker ? "warning" : "success",
        blocker,
      }
    }
  }
}
