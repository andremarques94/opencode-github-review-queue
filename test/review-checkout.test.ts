import { describe, expect, it, vi } from "vitest"

const runProcess = vi.hoisted(() => vi.fn())

vi.mock("../src/server/process.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/server/process.js")>()),
  runProcess,
}))

const { remoteFor } = await import("../src/server/git/remotes.js")
const { managedClonePath, worktreePath } = await import("../src/server/review/checkout.js")

const signal = new AbortController().signal

describe("remoteFor", () => {
  it("finds the remote that points at the repository, whatever its URL form", async () => {
    runProcess.mockResolvedValue({
      stdout: [
        "origin\tgit@github.com:me/api.git (fetch)",
        "upstream\thttps://github.com/Acme/API (fetch)",
        "mirror\tssh://git@github.com/acme/web.git/ (fetch)",
      ].join("\n"),
      stderr: "",
    })

    expect(await remoteFor("/repo", "acme/api", signal)).toBe("upstream")
    expect(await remoteFor("/repo", "acme/web", signal)).toBe("mirror")
    expect(await remoteFor("/repo", "acme/cli", signal)).toBeUndefined()
  })

  it("ignores hosts that only start with github.com", async () => {
    runProcess.mockResolvedValue({ stdout: "evil\thttps://github.com.example.org/acme/api (fetch)", stderr: "" })

    expect(await remoteFor("/repo", "acme/api", signal)).toBeUndefined()
  })
})

describe("cache paths", () => {
  it("places clones and worktrees under the cache directory", () => {
    expect(managedClonePath("/cache", "acme/api")).toBe("/cache/repos/acme/api.git")
    expect(worktreePath("/cache", "acme/api", 7)).toBe("/cache/worktrees/acme/api/pr-7")
  })

  it.each(["acme/../etc", "../acme", "acme/api/extra", "acme/", "acme\\x/api"])("rejects %s", (repository) => {
    expect(() => managedClonePath("/cache", repository)).toThrow("Unexpected repository name")
  })
})
