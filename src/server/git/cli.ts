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
