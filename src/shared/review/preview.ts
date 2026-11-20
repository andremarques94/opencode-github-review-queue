import {
  commentBody,
  findingLocation,
  keptFindings,
  type ReviewDraft,
  reviewPayload,
  type Verdict,
} from "../../domain/review-draft.js"

export const VERDICT_LABELS = { REQUEST_CHANGES: "Request changes", COMMENT: "Comment", APPROVE: "Approve" } as const

export type ReviewPreview = {
  title: string
  reference: string
  verdict: string
  event: Verdict
  ownPullRequest: boolean
  summary: string
  comments: { location: string; body: string }[]
}

export function reviewPreview(draft: ReviewDraft): ReviewPreview {
  const payload = reviewPayload(draft)
  return {
    title: `Post review on ${draft.repository}#${draft.number}?`,
    reference: `${draft.repository}#${draft.number}`,
    verdict: VERDICT_LABELS[payload.event],
    event: payload.event,
    ownPullRequest: draft.ownPullRequest,
    summary: payload.body,
    comments: keptFindings(draft).map((finding) => ({
      location: findingLocation(finding),
      body: commentBody(finding),
    })),
  }
}

export const commentCount = (count: number) => `${count} inline comment${count === 1 ? "" : "s"}`
