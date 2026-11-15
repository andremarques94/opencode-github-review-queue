import { changedLines, type ReviewRequest, waitingSince } from "./review-request.js"

export type QueueSort = "oldest" | "ready" | "smallest"

const ready = (item: ReviewRequest) => item.checks === "passing" && item.conflicts !== true

const oldest = (a: ReviewRequest, b: ReviewRequest) => waitingSince(a).localeCompare(waitingSince(b))

const smallest = (a: ReviewRequest, b: ReviewRequest) =>
  (changedLines(a) ?? Number.POSITIVE_INFINITY) - (changedLines(b) ?? Number.POSITIVE_INFINITY)

export function sortQueue(items: readonly ReviewRequest[], sort: QueueSort): ReviewRequest[] {
  switch (sort) {
    case "oldest":
      return [...items].sort(oldest)
    case "smallest":
      return [...items].sort((a, b) => smallest(a, b) || oldest(a, b))
    case "ready":
      return [...items].sort((a, b) => Number(ready(b)) - Number(ready(a)) || smallest(a, b) || oldest(a, b))
  }
}
