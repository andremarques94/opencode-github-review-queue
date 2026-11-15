import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Real git against a local "remote"; only the lookup that wants a github.com URL is stubbed.
vi.mock("../src/server/git/remotes.js", () => ({ remoteFor: async () => "origin" }))

const { createBranchWorktree, currentBranch } = await import("../src/server/git/worktrees.js")

const git = (directory: string, ...args: string[]) =>
  execFileSync("git", ["-C", directory, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()

const signal = new AbortController().signal
let root: string
let checkout: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "grq-branch-"))
  const remote = join(root, "remote.git")
  const seed = join(root, "seed")
  checkout = join(root, "checkout")
  execFileSync("git", ["init", "--quiet", "--bare", remote])
  execFileSync("git", ["init", "--quiet", "-b", "main", seed])
  for (const [key, value] of [
    ["user.email", "test@example.com"],
    ["user.name", "Test"],
    ["commit.gpgsign", "false"],
  ] as const) {
    git(seed, "config", key, value)
  }
  git(seed, "commit", "--quiet", "--allow-empty", "-m", "base")
  git(seed, "checkout", "--quiet", "-b", "feature/b")
  git(seed, "commit", "--quiet", "--allow-empty", "-m", "feature")
  git(seed, "remote", "add", "origin", remote)
  git(seed, "push", "--quiet", "origin", "main", "feature/b")
  execFileSync("git", ["clone", "--quiet", "--branch", "main", remote, checkout])
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe("createBranchWorktree", () => {
  it("checks the branch out in a new worktree, tracking the remote, and leaves the checkout alone", async () => {
    const worktree = join(root, "address", "pr-7")

    await createBranchWorktree({ checkout, repository: "acme/api", branch: "feature/b", worktree, signal })

    expect(await currentBranch(worktree, signal)).toBe("feature/b")
    expect(git(worktree, "rev-parse", "--abbrev-ref", "@{upstream}")).toBe("origin/feature/b")
    expect(await currentBranch(checkout, signal)).toBe("main")
  })

  it("reuses a worktree already on the branch, and refuses one on another", async () => {
    const worktree = join(root, "address", "pr-7")
    await createBranchWorktree({ checkout, repository: "acme/api", branch: "feature/b", worktree, signal })

    await expect(
      createBranchWorktree({ checkout, repository: "acme/api", branch: "feature/b", worktree, signal }),
    ).resolves.toBeUndefined()
    await expect(
      createBranchWorktree({ checkout, repository: "acme/api", branch: "main", worktree, signal }),
    ).rejects.toThrow(/not on main/)
  })

  it("uses an existing local branch, and lets git refuse one checked out elsewhere", async () => {
    git(checkout, "branch", "--quiet", "feature/b", "origin/feature/b")
    const worktree = join(root, "address", "pr-7")
    await createBranchWorktree({ checkout, repository: "acme/api", branch: "feature/b", worktree, signal })
    expect(await currentBranch(worktree, signal)).toBe("feature/b")

    await expect(
      createBranchWorktree({
        checkout,
        repository: "acme/api",
        branch: "feature/b",
        worktree: join(root, "x"),
        signal,
      }),
    ).rejects.toThrow(/git worktree failed/)
  })

  it("reports a detached head as no branch", async () => {
    git(checkout, "checkout", "--quiet", "--detach")

    expect(await currentBranch(checkout, signal)).toBeUndefined()
  })
})
