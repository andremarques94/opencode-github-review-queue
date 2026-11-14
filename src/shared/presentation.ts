import type { QueueSnapshot } from "../domain/review-queue.js"
import type { ReviewRequest } from "../domain/review-request.js"

export type QueueFilter = "current" | "all"

export function filterItems(
  items: readonly ReviewRequest[],
  filter: QueueFilter,
  repository?: string,
): ReviewRequest[] {
  if (filter === "all") {
    return [...items]
  }
  if (!repository) {
    return []
  }
  return items.filter((item) => item.repository.toLowerCase() === repository.toLowerCase())
}

function age(createdAt: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(createdAt)) / 1_000))
  if (seconds < 60) {
    return "now"
  }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return `${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours}h`
  }
  const days = Math.floor(hours / 24)
  if (days < 30) {
    return `${days}d`
  }
  return `${Math.floor(days / 30)}mo`
}

export function ago(createdAt: string, now = Date.now()): string {
  const value = age(createdAt, now)
  return value === "now" ? "just now" : `${value} ago`
}

export interface RepositoryGroup {
  repository: string
  owner: string
  name: string
  items: ReviewRequest[]
}

export function groupByRepository(items: readonly ReviewRequest[]): RepositoryGroup[] {
  const groups = new Map<string, RepositoryGroup>()
  for (const item of items) {
    const key = item.repository.toLowerCase()
    let group = groups.get(key)
    if (!group) {
      const slash = item.repository.indexOf("/")
      group = {
        repository: item.repository,
        owner: slash === -1 ? "" : item.repository.slice(0, slash),
        name: slash === -1 ? item.repository : item.repository.slice(slash + 1),
        items: [],
      }
      groups.set(key, group)
    }
    group.items.push(item)
  }
  return [...groups.values()]
}

export function refreshLabel(state: QueueSnapshot): string {
  if (!state.lastSuccessAt) {
    return "Never refreshed"
  }
  return `Updated ${age(state.lastSuccessAt)}`
}

export const fullReference = (item: ReviewRequest): string => `${item.repository}#${item.number}`
