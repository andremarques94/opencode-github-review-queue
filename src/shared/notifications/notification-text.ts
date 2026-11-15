import type { MyNotice } from "../../domain/my-pull-request.js"
import type { ReviewRequest } from "../../domain/review-request.js"

const repositoryName = (repository: string) => repository.split("/").pop() ?? repository
const shortReference = (item: ReviewRequest) => `${repositoryName(item.repository)} #${item.number}`
const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text)

function batchTitle(items: readonly ReviewRequest[]): string {
  const followUps = items.filter((item) => item.followUp).length
  if (followUps === 0) {
    return `${items.length} new review requests`
  }
  if (followUps === items.length) {
    return `${items.length} pull requests with new commits since your review`
  }
  return `${items.length} pull requests to review`
}

/** One notice on one of the user's own pull requests, keyed by pull request and kind for the batcher. */
export type MyUpdate = { key: string; notice: MyNotice; item: ReviewRequest }

export const myUpdate = (notice: MyNotice, item: ReviewRequest): MyUpdate => ({
  key: `${notice.key}:${notice.kind}`,
  notice,
  item,
})

function noticeTitle({ notice, item }: MyUpdate): string {
  switch (notice.kind) {
    case "changes-requested": {
      const by = item.authored?.changesRequestedBy ?? []
      return by.length > 0 ? `@${by.join(", @")} requested changes` : "Changes requested"
    }
    case "ready-to-merge":
      return "Ready to merge"
    case "checks-failed":
      return "Checks failing"
  }
}

export function myUpdateText(updates: readonly MyUpdate[]): { title: string; message: string } {
  const [first] = updates
  if (updates.length === 1 && first) {
    return { title: `${noticeTitle(first)} · ${shortReference(first.item)}`, message: truncate(first.item.title, 80) }
  }
  const listed = updates
    .slice(0, 3)
    .map((update) => `${shortReference(update.item)} ${noticeTitle(update).toLowerCase()}`)
    .join(", ")
  const more = updates.length > 3 ? ` +${updates.length - 3} more` : ""
  return { title: `${updates.length} updates on your pull requests`, message: `${listed}${more}` }
}

export function notificationText(items: readonly ReviewRequest[]): { title: string; message: string } {
  const [first] = items
  if (items.length === 1 && first) {
    const reason = first.followUp ? "New commits since your review" : "Review requested"
    return { title: `${reason} · ${shortReference(first)}`, message: truncate(first.title, 80) }
  }
  const listed = items.slice(0, 3).map(shortReference).join(", ")
  const more = items.length > 3 ? ` +${items.length - 3} more` : ""
  return { title: batchTitle(items), message: `${listed}${more}` }
}
