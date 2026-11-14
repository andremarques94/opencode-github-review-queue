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

const GITHUB_HOST = "github.com"

/** `git@github.com:acme/api.git` or `https://github.com/acme/api` → `acme/api`. */
function githubRepository(url: string): string | undefined {
  const host = url.indexOf(GITHUB_HOST)
  const separator = url[host + GITHUB_HOST.length]
  if (host === -1 || (separator !== ":" && separator !== "/")) {
    return undefined
  }
  const path = url.slice(host + GITHUB_HOST.length + 1)
  const trimmed = path.endsWith("/") ? path.slice(0, -1) : path
  return trimmed.endsWith(".git") ? trimmed.slice(0, -".git".length) : trimmed
}

/** The remote of `directory` that points at `repository` on GitHub, so forks' `origin` is never assumed. */
export async function remoteFor(
  directory: string,
  repository: string,
  signal: AbortSignal,
): Promise<string | undefined> {
  const output = await runGit(directory, ["remote", "-v"], signal)
  for (const line of output.split("\n")) {
    // `git remote -v` prints `<name>\t<url> (fetch)`.
    const [name, entry = ""] = line.split("\t")
    const remote = githubRepository(entry.split(" ")[0] ?? "")
    if (name && remote?.toLowerCase() === repository.toLowerCase()) {
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
