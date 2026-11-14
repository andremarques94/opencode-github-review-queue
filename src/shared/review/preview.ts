import { findingLocation, keptFindings, type ReviewDraft, reviewPayload } from "../../domain/review-draft.js"

export const VERDICT_LABELS = { REQUEST_CHANGES: "Request changes", COMMENT: "Comment", APPROVE: "Approve" } as const

export type ReviewPreview = {
  title: string
  reference: string
  verdict: string
  summary: string
  comments: { location: string; body: string }[]
}

export function reviewPreview(draft: ReviewDraft): ReviewPreview {
  const payload = reviewPayload(draft)
  return {
    title: `Post review on ${draft.repository}#${draft.number}?`,
    reference: `${draft.repository}#${draft.number}`,
    verdict: VERDICT_LABELS[payload.event],
    summary: payload.body,
    comments: keptFindings(draft).map((finding) => ({ location: findingLocation(finding), body: finding.body })),
  }
}

export const commentCount = (count: number) => `${count} inline comment${count === 1 ? "" : "s"}`
