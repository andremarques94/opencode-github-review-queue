import { existsSync } from "node:fs"
import { mkdir, rm, rmdir } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, isAbsolute, join, relative, sep } from "node:path"
import * as v from "valibot"
import { qualifiedRepository, type RepositoryRef } from "../../domain/review-request.js"
import { runGit } from "../git/cli.js"
import { remoteFor } from "../git/remotes.js"
import { linkedWorktrees, removeWorktree } from "../git/worktrees.js"
import { repoName, runGh } from "../github/cli.js"
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

/** github.com keeps `owner/name`, where earlier clones live; other hosts get a folder of their own. */
function segments(ref: RepositoryRef): string[] {
  const parsed = v.safeParse(Repository, ref.repository)
  const host = ref.host === undefined ? undefined : v.safeParse(PathSegment, ref.host)
  if (!parsed.success || host?.success === false) {
    throw new Error(`Unexpected repository name: ${qualifiedRepository(ref)}`)
  }
  return host ? [host.output, ...parsed.output] : parsed.output
}

const withLast = (parts: string[], last: (name: string) => string) =>
  parts.map((part, index) => (index === parts.length - 1 ? last(part) : part))

const clonesDirectory = (cacheDirectory: string) => join(cacheDirectory, "repos")
const worktreesDirectory = (cacheDirectory: string) => join(cacheDirectory, "worktrees")

const isInside = (path: string, root: string) => {
  const fromRoot = relative(root, path)
  return fromRoot !== "" && !isAbsolute(fromRoot) && fromRoot.split(sep)[0] !== ".."
}

export function managedClonePath(cacheDirectory: string, ref: RepositoryRef): string {
  return join(clonesDirectory(cacheDirectory), ...withLast(segments(ref), (name) => `${name}.git`))
}

export function worktreePath(cacheDirectory: string, ref: RepositoryRef, number: number): string {
  return join(worktreesDirectory(cacheDirectory), ...segments(ref), `pr-${number}`)
}

export function addressWorktreePath(cacheDirectory: string, ref: RepositoryRef, number: number): string {
  return join(cacheDirectory, "address", ...segments(ref), `pr-${number}`)
}

export async function sessionCheckout(input: {
  host?: string | undefined
  repository: string
  directory?: string | undefined
  signal: AbortSignal
}): Promise<string | undefined> {
  if (!input.directory) {
    return undefined
  }
  const found = await repositoryForDirectory(input.directory, input.signal)
  if (!found || qualifiedRepository(found).toLowerCase() !== qualifiedRepository(input).toLowerCase()) {
    return undefined
  }
  const root = await runGit(input.directory, ["rev-parse", "--show-toplevel"], input.signal)
  return (await remoteFor(root, input, input.signal)) ? root : undefined
}

/** Why `sessionCheckout` found no clone of the repository in `directory`, in words the user can act on. */
export async function checkoutProblem(input: {
  host?: string | undefined
  repository: string
  directory?: string | undefined
  signal: AbortSignal
}): Promise<string> {
  const wanted = qualifiedRepository(input)
  if (!input.directory) {
    return `OpenCode did not say which folder this session is in. Open it in your clone of ${wanted} and try again.`
  }
  const found = await repositoryForDirectory(input.directory, input.signal)
  if (!found) {
    return `${input.directory} is not a clone of a GitHub repository that gh recognizes. Open OpenCode in your clone of ${wanted}.`
  }
  if (qualifiedRepository(found).toLowerCase() !== wanted.toLowerCase()) {
    return `${input.directory} is a clone of ${qualifiedRepository(found)}, not ${wanted}. Open OpenCode in your clone of ${wanted}.`
  }
  return `None of the git remotes in ${input.directory} points at ${wanted}. Check \`git remote -v\` there.`
}

export async function findCheckout(input: {
  host?: string | undefined
  repository: string
  directory?: string | undefined
  cacheDirectory: string
  signal: AbortSignal
}): Promise<string | undefined> {
  const own = await sessionCheckout(input)
  if (own) {
    return own
  }
  const managed = managedClonePath(input.cacheDirectory, input)
  return existsSync(managed) ? managed : undefined
}

export async function cloneRepository(
  ref: RepositoryRef,
  cacheDirectory: string,
  signal: AbortSignal,
): Promise<string> {
  const target = managedClonePath(cacheDirectory, ref)
  await mkdir(dirname(target), { recursive: true })
  // A bare, blobless clone keeps the cache small; the worktree fetches the blobs it checks out.
  await runGh(["repo", "clone", repoName(ref), target, "--", "--bare", "--filter=blob:none"], { signal })
  return target
}

/** Removes the now empty `owner/repo` folders above `path`, stopping at `root`. */
async function removeEmptyParents(path: string, root: string): Promise<void> {
  for (let directory = dirname(path); isInside(directory, root); directory = dirname(directory)) {
    const removed = await rmdir(directory).then(
      () => true,
      () => false,
    )
    if (!removed) {
      return
    }
  }
}

/** Deletes a clone this plugin made once no review worktree uses it; the user's own checkouts are never touched. */
async function removeUnusedClone(checkout: string, cacheDirectory: string, signal: AbortSignal): Promise<void> {
  const clones = clonesDirectory(cacheDirectory)
  if (!isInside(checkout, clones) || !existsSync(checkout)) {
    return
  }
  if ((await linkedWorktrees(checkout, signal)).length > 0) {
    return
  }
  await rm(checkout, { recursive: true, force: true })
  await removeEmptyParents(checkout, clones)
}

export async function cleanUpCheckout(input: {
  checkout: string
  worktree: string
  cacheDirectory: string
  keepClones: boolean
  signal: AbortSignal
}): Promise<void> {
  await removeWorktree(input.checkout, input.worktree, input.signal)
  await removeEmptyParents(input.worktree, worktreesDirectory(input.cacheDirectory))
  if (!input.keepClones) {
    await removeUnusedClone(input.checkout, input.cacheDirectory, input.signal)
  }
}
