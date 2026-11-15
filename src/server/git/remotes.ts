import { posix } from "node:path"
import { hostOf, type RepositoryRef } from "../../domain/review-request.js"
import { runGit } from "./cli.js"

/** `git@host:acme/api.git`, `ssh://git@host/acme/api.git` or `https://host/acme/api` → `host` and `acme/api`. */
function remoteRepository(remote: string): { host: string; repository: string } | undefined {
  // The scp-like `user@host:path` form is not a URL; read it as `ssh://user@host/path`.
  const url = URL.parse(remote.includes("://") ? remote : `ssh://${remote.replace(":", "/")}`)
  if (!url) {
    return undefined
  }
  return {
    host: url.hostname.toLowerCase(),
    repository: `${posix.basename(posix.dirname(url.pathname))}/${posix.basename(url.pathname, ".git")}`,
  }
}

/** The remote of `directory` that points at the repository on its host, so forks' `origin` is never assumed. */
export async function remoteFor(
  directory: string,
  target: RepositoryRef,
  signal: AbortSignal,
): Promise<string | undefined> {
  const output = await runGit(directory, ["remote", "-v"], signal)
  for (const line of output.split("\n")) {
    // `<name>\t<url> (fetch)`
    const [name, entry = ""] = line.split("\t")
    const remote = remoteRepository(entry.split(" ")[0] ?? "")
    if (
      name &&
      remote?.host === hostOf(target).toLowerCase() &&
      remote.repository.toLowerCase() === target.repository.toLowerCase()
    ) {
      return name
    }
  }
  return undefined
}
