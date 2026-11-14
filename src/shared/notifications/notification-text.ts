import type { ReviewRequest } from "../../domain/review-request.js"

const repositoryName = (repository: string) => repository.split("/").pop() ?? repository
const shortReference = (item: ReviewRequest) => `${repositoryName(item.repository)} #${item.number}`
const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text)

export function notificationText(items: readonly ReviewRequest[]): { title: string; message: string } {
  const [first] = items
  if (items.length === 1 && first) {
    return { title: `Review requested · ${shortReference(first)}`, message: truncate(first.title, 80) }
  }
  const listed = items.slice(0, 3).map(shortReference).join(", ")
  const more = items.length > 3 ? ` +${items.length - 3} more` : ""
  return { title: `${items.length} new review requests`, message: `${listed}${more}` }
}
