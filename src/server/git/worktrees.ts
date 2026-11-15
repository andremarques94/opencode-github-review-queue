import { existsSync } from "node:fs"
import { mkdir, realpath } from "node:fs/promises"
import { dirname } from "node:path"
import { runGit } from "./cli.js"
import { remoteFor } from "./remotes.js"

const resolved = (path: string) => realpath(path).catch(() => path)

async function registeredWorktrees(directory: string, signal: AbortSignal): Promise<string[]> {
  const output = await runGit(directory, ["worktree", "list", "--porcelain"], signal)
  const prefix = "worktree "
  return output
    .split("\n")
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length))
}

/** The worktrees added to `directory`, without the repository's own main or bare entry. */
export async function linkedWorktrees(directory: string, signal: AbortSignal): Promise<string[]> {
  return (await registeredWorktrees(directory, signal)).slice(1)
}

/** Fetches the pull request head into a detached worktree and returns the commit it checked out. */
export async function createWorktree(input: {
  checkout: string
  repository: string
  number: number
  worktree: string
  signal: AbortSignal
}): Promise<string> {
  if (existsSync(input.worktree)) {
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

export async function currentBranch(directory: string, signal: AbortSignal): Promise<string | undefined> {
  const branch = await runGit(directory, ["rev-parse", "--abbrev-ref", "HEAD"], signal)
  return branch === "HEAD" ? undefined : branch
}

const hasLocalBranch = (checkout: string, branch: string, signal: AbortSignal) =>
  runGit(checkout, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], signal).then(
    () => true,
    () => false,
  )

/** Git refuses a branch checked out elsewhere, and that refusal is the error the user sees. */
export async function createBranchWorktree(input: {
  checkout: string
  repository: string
  branch: string
  worktree: string
  signal: AbortSignal
}): Promise<void> {
  if (existsSync(input.worktree)) {
    if ((await currentBranch(input.worktree, input.signal)) !== input.branch) {
      throw new Error(`${input.worktree} already exists and is not on ${input.branch}.`)
    }
    return
  }
  const remote = await remoteFor(input.checkout, input.repository, input.signal)
  if (!remote) {
    throw new Error(`${input.checkout} has no remote for ${input.repository}.`)
  }
  await runGit(input.checkout, ["fetch", "--no-tags", remote, input.branch], input.signal)
  await mkdir(dirname(input.worktree), { recursive: true })
  if (await hasLocalBranch(input.checkout, input.branch, input.signal)) {
    await runGit(input.checkout, ["worktree", "add", input.worktree, input.branch], input.signal)
    return
  }
  await runGit(
    input.checkout,
    ["worktree", "add", "--track", "-b", input.branch, input.worktree, `${remote}/${input.branch}`],
    input.signal,
  )
}

export async function fetchCommit(checkout: string, repository: string, sha: string, signal: AbortSignal) {
  const remote = await remoteFor(checkout, repository, signal)
  if (remote) {
    await runGit(checkout, ["fetch", "--no-tags", remote, sha], signal)
  }
}

/** Removes the worktree only when `checkout` has it registered, so an unrelated directory is never deleted. */
export async function removeWorktree(checkout: string, worktree: string, signal: AbortSignal): Promise<void> {
  if (!existsSync(checkout)) {
    return
  }
  const target = await resolved(worktree)
  const registered = await Promise.all((await registeredWorktrees(checkout, signal)).map(resolved))
  if (registered.includes(target)) {
    await runGit(checkout, ["worktree", "remove", "--force", target], signal)
    return
  }
  await runGit(checkout, ["worktree", "prune"], signal)
  if (existsSync(worktree)) {
    throw new Error(`${worktree} is not a worktree of ${checkout}; it was left in place.`)
  }
}
