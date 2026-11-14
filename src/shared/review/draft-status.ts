import { pendingFindings, postBlocker, type ReviewDraft } from "../../domain/review-draft.js"

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
