import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import * as v from "valibot"
import { runGit } from "../git/cli.js"
import { remoteFor } from "../git/remotes.js"
import { runGh } from "../github/cli.js"
import { repositoryForDirectory } from "../github/repository.js"

/** One directory name, so a repository name can never escape the cache directory. */
const PathSegment = v.pipe(v.string(), v.nonEmpty(), v.notValues([".", ".."]), v.excludes("\\"))
const Repository = v.pipe(
  v.string(),
  v.transform((repository) => repository.split("/")),
  v.strictTuple([PathSegment, PathSegment]),
)

export const expandHome = (path: string) =>
  path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(1)) : path

export function defaultCacheDirectory(): string {
  return join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "opencode-github-review-queue")
}

function segments(repository: string): [string, string] {
  const parsed = v.safeParse(Repository, repository)
  if (!parsed.success) {
    throw new Error(`Unexpected repository name: ${repository}`)
  }
  return parsed.output
}

export function managedClonePath(cacheDirectory: string, repository: string): string {
  const [owner, name] = segments(repository)
  return join(cacheDirectory, "repos", owner, `${name}.git`)
}

export function worktreePath(cacheDirectory: string, repository: string, number: number): string {
  const [owner, name] = segments(repository)
  return join(cacheDirectory, "worktrees", owner, name, `pr-${number}`)
}

export async function findCheckout(input: {
  repository: string
  directory?: string | undefined
  cacheDirectory: string
  signal: AbortSignal
}): Promise<string | undefined> {
  if (input.directory) {
    const repository = await repositoryForDirectory(input.directory, input.signal)
    if (repository?.toLowerCase() === input.repository.toLowerCase()) {
      const root = await runGit(input.directory, ["rev-parse", "--show-toplevel"], input.signal)
      if (await remoteFor(root, input.repository, input.signal)) {
        return root
      }
    }
  }
  const managed = managedClonePath(input.cacheDirectory, input.repository)
  return existsSync(managed) ? managed : undefined
}

export async function cloneRepository(
  repository: string,
  cacheDirectory: string,
  signal: AbortSignal,
): Promise<string> {
  const target = managedClonePath(cacheDirectory, repository)
  await mkdir(dirname(target), { recursive: true })
  // A bare, blobless clone keeps the cache small; the worktree fetches the blobs it checks out.
  await runGh(["repo", "clone", repository, target, "--", "--bare", "--filter=blob:none"], { signal })
  return target
}
