import type { ReviewDraft } from "../../domain/review-draft.js"
import type { ReviewedRecord } from "../../domain/review-history.js"
import type { QueueSnapshot } from "../../domain/review-queue.js"

export type TuiState = QueueSnapshot & {
  repository?: string
  drafts: ReviewDraft[]
  reviewed: ReviewedRecord[]
}
