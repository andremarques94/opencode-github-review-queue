import type { QueueSnapshot } from "../../domain/review-queue.js"

export interface TuiState extends QueueSnapshot {
  repository?: string
}
