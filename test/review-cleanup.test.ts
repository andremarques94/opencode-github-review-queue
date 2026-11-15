import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { cleanUpCheckout, managedClonePath, worktreePath } from "../src/server/review/checkout.js"

const git = (...args: string[]) => execFileSync("git", args, { stdio: "ignore" })
const signal = new AbortController().signal
const ACME = { repository: "acme/api" }

let root: string
let cache: string

/** A repository with one commit, cloned bare where the plugin keeps its clones, with a review worktree per number. */
async function managedClone(...numbers: number[]): Promise<string> {
  const source = join(root, "source")
  git("init", "-q", source)
  git("-C", source, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init")
  const clone = managedClonePath(cache, ACME)
  await mkdir(join(clone, ".."), { recursive: true })
  git("clone", "-q", "--bare", source, clone)
  for (const number of numbers) {
    git("-C", clone, "worktree", "add", "-q", "--detach", worktreePath(cache, ACME, number), "HEAD")
  }
  return clone
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "review-cleanup-"))
  cache = join(root, "cache")
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("cleanUpCheckout", () => {
  it("removes the worktree, the clone no review uses, and the empty folders above them", async () => {
    const clone = await managedClone(7)

    await cleanUpCheckout({
      checkout: clone,
      worktree: worktreePath(cache, ACME, 7),
      cacheDirectory: cache,
      keepClones: false,
      signal,
    })

    expect(await readdir(join(cache, "worktrees"))).toEqual([])
    expect(await readdir(join(cache, "repos"))).toEqual([])
  })

  it("keeps a clone that another review still uses", async () => {
    const clone = await managedClone(7, 8)

    await cleanUpCheckout({
      checkout: clone,
      worktree: worktreePath(cache, ACME, 7),
      cacheDirectory: cache,
      keepClones: false,
      signal,
    })

    expect(existsSync(clone)).toBe(true)
    expect(existsSync(worktreePath(cache, ACME, 8))).toBe(true)
    expect(existsSync(worktreePath(cache, ACME, 7))).toBe(false)
  })

  it("keeps clones when asked to", async () => {
    const clone = await managedClone(7)

    await cleanUpCheckout({
      checkout: clone,
      worktree: worktreePath(cache, ACME, 7),
      cacheDirectory: cache,
      keepClones: true,
      signal,
    })

    expect(existsSync(clone)).toBe(true)
  })

  it("never deletes the user's own checkout", async () => {
    const checkout = join(root, "my-checkout")
    git("init", "-q", checkout)
    git("-C", checkout, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init")
    const worktree = worktreePath(cache, ACME, 7)
    git("-C", checkout, "worktree", "add", "-q", "--detach", worktree, "HEAD")

    await cleanUpCheckout({ checkout, worktree, cacheDirectory: cache, keepClones: false, signal })

    expect(existsSync(checkout)).toBe(true)
    expect(existsSync(worktree)).toBe(false)
  })
})
