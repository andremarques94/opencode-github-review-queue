import type { QueueSnapshot } from "../../domain/review-queue.js"

export type TuiState = QueueSnapshot & {
  repository?: string
}
