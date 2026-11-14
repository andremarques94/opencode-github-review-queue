import type { ReviewRequest } from "../../domain/review-request.js"
import { runGh } from "./cli.js"

export async function repositoryForDirectory(directory: string, signal: AbortSignal): Promise<string | undefined> {
  try {
    const result = await runGh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], {
      signal,
      cwd: directory,
    })
    return result.stdout.trim() || undefined
  } catch {
    return undefined
  }
}

export async function openReview(item: ReviewRequest, signal: AbortSignal): Promise<void> {
  await runGh(["pr", "view", String(item.number), "--repo", item.repository, "--web"], { signal })
}
