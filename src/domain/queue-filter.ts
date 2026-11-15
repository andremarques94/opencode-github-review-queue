import type { ReviewRequest } from "./review-request.js"

export type QueueRules = {
  includeDrafts: boolean
  excludeAuthors: readonly string[]
  /** `owner/repo`, or `owner/*` for every repository of an owner. */
  excludeRepositories: readonly string[]
  teamRequests: "show" | "hide"
}

/** GitHub's GraphQL API names bots without the `[bot]` suffix that the web shows. */
const login = (name: string) => name.toLowerCase().replace(/\[bot\]$/, "")

function matchesRepository(repository: string, pattern: string): boolean {
  const lower = pattern.toLowerCase()
  if (lower.endsWith("/*")) {
    return repository.toLowerCase().startsWith(lower.slice(0, -1))
  }
  return repository.toLowerCase() === lower
}

export function applyQueueRules(items: readonly ReviewRequest[], rules: QueueRules): ReviewRequest[] {
  const authors = new Set(rules.excludeAuthors.map(login))
  return items.filter(
    (item) =>
      (rules.includeDrafts || !item.draft) &&
      !authors.has(login(item.author)) &&
      !rules.excludeRepositories.some((pattern) => matchesRepository(item.repository, pattern)) &&
      (rules.teamRequests === "show" || item.requestedVia?.kind !== "team"),
  )
}
