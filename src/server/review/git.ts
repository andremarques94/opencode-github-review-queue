import { ExitError, runProcess } from "../process.js"

class GitError extends Error {}

export async function runGit(directory: string, args: readonly string[], signal: AbortSignal): Promise<string> {
  try {
    const result = await runProcess("git", ["-C", directory, ...args], { signal })
    return result.stdout.trim()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new GitError("Git was not found. Install it to review pull requests locally.")
    }
    if (error instanceof ExitError) {
      throw new GitError(`git ${args[0]} failed: ${error.message}`)
    }
    throw error
  }
}

const GITHUB_REMOTE = /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/

/** The remote of `directory` that points at `repository` on GitHub, so forks' `origin` is never assumed. */
export async function remoteFor(
  directory: string,
  repository: string,
  signal: AbortSignal,
): Promise<string | undefined> {
  const output = await runGit(directory, ["remote", "-v"], signal)
  for (const line of output.split("\n")) {
    const [name, url] = line.split(/\s+/)
    const match = url?.match(GITHUB_REMOTE)?.[1]
    if (name && match?.toLowerCase() === repository.toLowerCase()) {
      return name
    }
  }
  return undefined
}

export async function registeredWorktrees(directory: string, signal: AbortSignal): Promise<string[]> {
  const output = await runGit(directory, ["worktree", "list", "--porcelain"], signal)
  return output
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length))
}
