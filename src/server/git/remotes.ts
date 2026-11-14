import { posix } from "node:path"
import { runGit } from "./cli.js"

/** `git@github.com:acme/api.git`, `ssh://git@github.com/acme/api.git` or `https://github.com/acme/api` → `acme/api`. */
function githubRepository(remote: string): string | undefined {
  // The scp-like `user@host:path` form is not a URL; read it as `ssh://user@host/path`.
  const url = URL.parse(remote.includes("://") ? remote : `ssh://${remote.replace(":", "/")}`)
  if (url?.hostname !== "github.com") {
    return undefined
  }
  return `${posix.basename(posix.dirname(url.pathname))}/${posix.basename(url.pathname, ".git")}`
}

/** The remote of `directory` that points at `repository` on GitHub, so forks' `origin` is never assumed. */
export async function remoteFor(
  directory: string,
  repository: string,
  signal: AbortSignal,
): Promise<string | undefined> {
  const output = await runGit(directory, ["remote", "-v"], signal)
  for (const line of output.split("\n")) {
    // `<name>\t<url> (fetch)`
    const [name, entry = ""] = line.split("\t")
    const remote = githubRepository(entry.split(" ")[0] ?? "")
    if (name && remote?.toLowerCase() === repository.toLowerCase()) {
      return name
    }
  }
  return undefined
}
