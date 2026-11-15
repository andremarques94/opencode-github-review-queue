import * as v from "valibot"
import { hostField, type RepositoryRef, type ReviewRequest } from "../../domain/review-request.js"
import { repoName, runGh } from "./cli.js"

const RepositoryView = v.object({ nameWithOwner: v.string(), url: v.pipe(v.string(), v.url()) })

/** `gh` picks the remote of a host it is logged into, so an Enterprise checkout resolves to its own host. */
export async function repositoryForDirectory(
  directory: string,
  signal: AbortSignal,
): Promise<RepositoryRef | undefined> {
  try {
    const result = await runGh(["repo", "view", "--json", "nameWithOwner,url"], { signal, cwd: directory })
    const view = v.parse(RepositoryView, JSON.parse(result.stdout))
    return { ...hostField(new URL(view.url).hostname), repository: view.nameWithOwner }
  } catch {
    return undefined
  }
}

export async function openReview(item: ReviewRequest, signal: AbortSignal): Promise<void> {
  await runGh(["pr", "view", String(item.number), "--repo", repoName(item), "--web"], { signal })
}
