import { mkdir, realpath, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { runGh } from "../github/cli.js"
import { repositoryForDirectory } from "../github/repository.js"
import { registeredWorktrees, remoteFor, runGit } from "./git.js"

const SEGMENT = /^[A-Za-z0-9_.-]+$/

export const expandHome = (path: string) =>
  path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(1)) : path

export function defaultCacheDirectory(): string {
  return join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "opencode-github-review-queue")
}

function segments(repository: string): [string, string] {
  const [owner, name, ...rest] = repository.split("/")
  const valid = (part: string | undefined): part is string =>
    !!part && SEGMENT.test(part) && part !== "." && part !== ".."
  if (!valid(owner) || !valid(name) || rest.length > 0) {
    throw new Error(`Unexpected repository name: ${repository}`)
  }
  return [owner, name]
}

export function managedClonePath(cacheDirectory: string, repository: string): string {
  const [owner, name] = segments(repository)
  return join(cacheDirectory, "repos", owner, `${name}.git`)
}

export function worktreePath(cacheDirectory: string, repository: string, number: number): string {
  const [owner, name] = segments(repository)
  return join(cacheDirectory, "worktrees", owner, name, `pr-${number}`)
}

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  )

/**
 * A local repository to create the review worktree from: the caller's checkout when it is a clone of `repository`,
 * else a clone this plugin made earlier. Undefined means the user has to approve a new clone.
 */
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
  return (await exists(managed)) ? managed : undefined
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

/** Fetches the pull request head into a detached worktree and returns the commit it checked out. */
export async function createWorktree(input: {
  checkout: string
  repository: string
  number: number
  worktree: string
  signal: AbortSignal
}): Promise<string> {
  if (await exists(input.worktree)) {
    throw new Error(`A review worktree already exists at ${input.worktree}. Reset the review to start over.`)
  }
  const remote = await remoteFor(input.checkout, input.repository, input.signal)
  if (!remote) {
    throw new Error(`${input.checkout} has no remote for ${input.repository}.`)
  }
  await runGit(input.checkout, ["fetch", "--no-tags", remote, `pull/${input.number}/head`], input.signal)
  const sha = await runGit(input.checkout, ["rev-parse", "FETCH_HEAD"], input.signal)
  await mkdir(dirname(input.worktree), { recursive: true })
  await runGit(input.checkout, ["worktree", "add", "--detach", input.worktree, sha], input.signal)
  return sha
}

/** Removes a review worktree only when `checkout` has it registered; anything else is left alone. */
export async function removeWorktree(checkout: string, worktree: string, signal: AbortSignal): Promise<void> {
  if (!(await exists(checkout))) {
    return
  }
  const target = await realpath(worktree).catch(() => worktree)
  const registered = await registeredWorktrees(checkout, signal)
  const resolved = await Promise.all(registered.map((path) => realpath(path).catch(() => path)))
  if (resolved.includes(target)) {
    await runGit(checkout, ["worktree", "remove", "--force", target], signal)
    return
  }
  await runGit(checkout, ["worktree", "prune"], signal)
  if (await exists(worktree)) {
    throw new Error(`${worktree} is not a worktree of ${checkout}; it was left in place.`)
  }
}
