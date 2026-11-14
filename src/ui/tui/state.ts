import type { ReviewDraft } from "../../domain/review-draft.js"
import type { QueueSnapshot } from "../../domain/review-queue.js"

export type TuiState = QueueSnapshot & {
  repository?: string
  drafts: ReviewDraft[]
}
