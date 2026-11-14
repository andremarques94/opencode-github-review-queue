import { findingLocation, keptFindings, type ReviewDraft, reviewPayload } from "../../domain/review-draft.js"

const VERDICT_LABELS = { REQUEST_CHANGES: "Request changes", COMMENT: "Comment", APPROVE: "Approve" } as const

export type ReviewPreview = {
  title: string
  verdict: string
  summary: string
  comments: { location: string; body: string }[]
}

export function reviewPreview(draft: ReviewDraft): ReviewPreview {
  const payload = reviewPayload(draft)
  return {
    title: `Post review on ${draft.repository}#${draft.number}?`,
    verdict: VERDICT_LABELS[payload.event],
    summary: payload.body,
    comments: keptFindings(draft).map((finding) => ({ location: findingLocation(finding), body: finding.body })),
  }
}

export const commentCount = (count: number) => `${count} inline comment${count === 1 ? "" : "s"}`

const PREVIEW_LINE = 72

export function previewText(preview: ReviewPreview): string {
  const shorten = (text: string) => {
    const line = text.split("\n")[0] ?? ""
    return line.length > PREVIEW_LINE ? `${line.slice(0, PREVIEW_LINE - 1)}…` : line
  }
  const comments = preview.comments.map((comment) => `• ${comment.location}  ${shorten(comment.body)}`)
  return [`${preview.verdict} · ${commentCount(preview.comments.length)}`, preview.summary, comments.join("\n")]
    .filter(Boolean)
    .join("\n\n")
}
