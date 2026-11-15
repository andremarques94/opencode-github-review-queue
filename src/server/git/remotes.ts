import { posix } from "node:path"
import { hostOf, type RepositoryRef } from "../../domain/review-request.js"
import { runProcess } from "../process.js"
import { runGit } from "./cli.js"

type Remote = { host: string; repository: string; ssh: boolean }

/** `git@host:acme/api.git`, `ssh://git@host/acme/api.git` or `https://host/acme/api` → `host` and `acme/api`. */
function remoteRepository(remote: string): Remote | undefined {
  // The scp-like `user@host:path` form is not a URL; read it as `ssh://user@host/path`.
  const url = URL.parse(remote.includes("://") ? remote : `ssh://${remote.replace(":", "/")}`)
  if (!url) {
    return undefined
  }
  return {
    host: url.hostname.toLowerCase(),
    repository: `${posix.basename(posix.dirname(url.pathname))}/${posix.basename(url.pathname, ".git")}`,
    ssh: url.protocol === "ssh:",
  }
}

/**
 * The host an SSH alias such as `github-work` stands for in `~/.ssh/config`, as `ssh` itself resolves it: a common way
 * to keep two accounts on one host. `gh` resolves these aliases too.
 */
async function sshHostname(alias: string, signal: AbortSignal): Promise<string | undefined> {
  if (alias.startsWith("-")) {
    return undefined
  }
  try {
    const { stdout } = await runProcess("ssh", ["-G", alias], { signal })
    return stdout.match(/^hostname (\S+)$/m)?.[1]?.toLowerCase()
  } catch {
    return undefined
  }
}

async function pointsAt(remote: Remote, target: RepositoryRef, signal: AbortSignal): Promise<boolean> {
  if (remote.repository.toLowerCase() !== target.repository.toLowerCase()) {
    return false
  }
  const host = hostOf(target).toLowerCase()
  if (remote.host === host) {
    return true
  }
  return remote.ssh && (await sshHostname(remote.host, signal)) === host
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
    if (name && remote && (await pointsAt(remote, target, signal))) {
      return name
    }
  }
  return undefined
}
