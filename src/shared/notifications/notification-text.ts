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
