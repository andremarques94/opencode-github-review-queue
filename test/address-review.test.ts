import { beforeEach, describe, expect, it, vi } from "vitest"
import { AddressSession, canAddress } from "../src/domain/my-pull-request.js"
import { type ReviewRequest, requestKey } from "../src/domain/review-request.js"
import type { AddressFlowHost } from "../src/shared/review/address.js"

const git = vi.hoisted(() => ({ currentBranch: vi.fn(), createBranchWorktree: vi.fn() }))
const github = vi.hoisted(() => ({ fetchPullRequestBranch: vi.fn(), fetchOpenThreads: vi.fn() }))
const checkout = vi.hoisted(() => ({
  sessionCheckout: vi.fn(),
  addressWorktreePath: vi.fn(() => "/cache/address/acme/api/pr-7"),
}))
vi.mock("../src/server/git/worktrees.js", () => git)
vi.mock("../src/server/github/pull-request.js", () => github)
vi.mock("../src/server/review/checkout.js", () => checkout)

const { AddressSessions } = await import("../src/server/review/address.js")
const { KeyedStore } = await import("../src/server/keyed-store.js")
const { addressInstructions } = await import("../src/server/review/agent/address-instructions.js")
const { addressReviewFlow } = await import("../src/shared/review/address.js")

const item: ReviewRequest = {
  key: requestKey("acme/api", 7),
  repository: "acme/api",
  number: 7,
  title: "Add b",
  author: "me",
  draft: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  url: "https://github.com/acme/api/pull/7",
  authored: { reviewDecision: "CHANGES_REQUESTED", waitingOn: [], changesRequestedBy: ["alice"] },
}
const model = { providerID: "acme", id: "fast" }
const thread = { path: "src/app.ts", line: 3, outdated: false, comments: [{ author: "alice", body: "Name this." }] }

const memory = () => {
  const values = new Map<string, unknown>()
  return {
    values,
    store: new KeyedStore(AddressSession, {
      get: async (key) => values.get(key),
      list: async () => [...values.values()],
      save: async (key, value) => void values.set(key, value),
      remove: async (key) => void values.delete(key),
    }),
  }
}
const sessions = () => ({
  create: vi.fn(async (_input: { permissions: { action: string }[] }) => ({ id: "ses_9" })),
  instructions: { entry: { put: vi.fn(async (_input: { value: string }) => undefined) } },
  prompt: vi.fn(async () => undefined),
})
const signal = new AbortController().signal

let saved: ReturnType<typeof memory>
let session: ReturnType<typeof sessions>
const start = (input: { worktree?: boolean; model?: typeof model; item?: ReviewRequest } = {}) =>
  new AddressSessions(saved.store, "/cache").start({
    item: input.item ?? item,
    directory: "/work/api",
    worktree: input.worktree ?? false,
    model: input.model,
    sessions: session as never,
    signal,
  })

beforeEach(() => {
  saved = memory()
  session = sessions()
  git.currentBranch.mockReset().mockResolvedValue("feature/b")
  git.createBranchWorktree.mockReset().mockResolvedValue(undefined)
  github.fetchPullRequestBranch
    .mockReset()
    .mockResolvedValue({ state: "OPEN", headRefName: "feature/b", isCrossRepository: false })
  github.fetchOpenThreads.mockReset().mockResolvedValue([thread])
  checkout.sessionCheckout.mockReset().mockResolvedValue("/work/api")
})

describe("AddressSessions", () => {
  it("works in the user's checkout when it is on the branch, after a model is picked", async () => {
    expect(await start()).toEqual({ status: "needs-model" })
    expect(session.create).not.toHaveBeenCalled()

    expect(await start({ model })).toEqual({ status: "started", sessionID: "ses_9" })
    expect(git.createBranchWorktree).not.toHaveBeenCalled()
    expect(session.create).toHaveBeenCalledWith(
      expect.objectContaining({
        location: { directory: "/work/api" },
        permissions: expect.arrayContaining([{ action: "shell", resource: "git push *", effect: "deny" }]),
      }),
    )
    expect(session.create.mock.calls[0]?.[0].permissions.map((rule) => rule.action)).not.toContain("edit")
    expect(session.instructions.entry.put.mock.calls[0]?.[0].value).toContain("Name this.")
    expect(await start({ model })).toEqual({ status: "resumed", sessionID: "ses_9" })
  })

  it("asks before adding a worktree when the checkout is on another branch, and never switches it", async () => {
    git.currentBranch.mockResolvedValue("main")

    expect(await start({ model })).toEqual({
      status: "needs-worktree",
      branch: "feature/b",
      current: "main",
      directory: "/cache/address/acme/api/pr-7",
    })
    expect(git.createBranchWorktree).not.toHaveBeenCalled()

    await start({ worktree: true, model })
    expect(git.createBranchWorktree).toHaveBeenCalledWith(
      expect.objectContaining({ checkout: "/work/api", branch: "feature/b", worktree: "/cache/address/acme/api/pr-7" }),
    )
    expect(session.create).toHaveBeenCalledWith(
      expect.objectContaining({ location: { directory: "/cache/address/acme/api/pr-7" } }),
    )
  })

  it("refuses without the user's own clone, a fork branch elsewhere, a closed pull request, or a review request", async () => {
    checkout.sessionCheckout.mockResolvedValueOnce(undefined)
    await expect(start({ model })).rejects.toThrow(/your clone of acme\/api/)

    git.currentBranch.mockResolvedValueOnce("main")
    github.fetchPullRequestBranch.mockResolvedValueOnce({ state: "OPEN", headRefName: "b", isCrossRepository: true })
    await expect(start({ worktree: true, model })).rejects.toThrow(/fork/)

    github.fetchPullRequestBranch.mockResolvedValueOnce({ state: "MERGED", headRefName: "b", isCrossRepository: false })
    await expect(start({ model })).rejects.toThrow(/merged/)

    const { authored: _, ...request } = item
    await expect(start({ item: request, model })).rejects.toThrow(/own pull requests/)
    expect(session.create).not.toHaveBeenCalled()
  })

  it("forgets sessions of pull requests that are no longer open, keeping the rest", async () => {
    await start({ model })
    const addressing = new AddressSessions(saved.store, "/cache")

    await addressing.prune(new Set([item.key]))
    expect(saved.values.size).toBe(1)
    await addressing.prune(new Set())
    expect(saved.values.size).toBe(0)
  })
})

describe("addressReviewFlow", () => {
  const host = (results: Awaited<ReturnType<AddressFlowHost["addressReview"]>>[], approve = true) => ({
    addressReview: vi.fn(
      async (_input: Parameters<AddressFlowHost["addressReview"]>[0]) =>
        results.shift() ?? { status: "needs-model" as const },
    ),
    confirm: vi.fn(async (_input: { message: string }) => approve),
    models: async () => ({ models: [{ ...model, name: "Fast", provider: "Acme" }], preferred: null }),
    select: vi.fn(async ({ options }) => options[0]?.value) as AddressFlowHost["select"],
    notify: vi.fn(),
  })

  it("confirms the worktree, picks a model, then starts", async () => {
    const flow = host([
      { status: "needs-worktree", branch: "feature/b", current: "main", directory: "/cache/x" },
      { status: "needs-model" },
      { status: "started", sessionID: "ses_9" },
    ])

    expect(await addressReviewFlow(flow, item, "/work/api")).toBe("ses_9")
    expect(flow.confirm.mock.calls[0]?.[0].message).toContain("Your checkout is on main")
    expect(flow.addressReview.mock.calls.at(-1)?.[0]).toEqual({
      key: item.key,
      directory: "/work/api",
      worktree: true,
      model,
    })
  })

  it("returns to an existing session without asking anything", async () => {
    const flow = host([{ status: "resumed", sessionID: "ses_1" }])

    expect(await addressReviewFlow(flow, item, undefined)).toBe("ses_1")
    expect(flow.confirm).not.toHaveBeenCalled()
    expect(flow.select).not.toHaveBeenCalled()
  })

  it("stops when the user declines the worktree", async () => {
    const flow = host([{ status: "needs-worktree", branch: "b", directory: "/cache/x" }], false)

    expect(await addressReviewFlow(flow, item, undefined)).toBeUndefined()
    expect(flow.addressReview).toHaveBeenCalledTimes(1)
  })
})

describe("addressing", () => {
  it("is offered for changes requested or unresolved threads on the user's own pull requests", () => {
    const { authored: _, ...request } = item
    const waiting = { ...item, authored: { waitingOn: [], changesRequestedBy: [] } }

    expect(canAddress(item)).toBe(true)
    expect(canAddress(waiting)).toBe(false)
    expect(canAddress({ ...waiting, unresolvedThreads: 2 })).toBe(true)
    expect(canAddress({ ...request, unresolvedThreads: 2 })).toBe(false)
  })

  it("hands the agent every open comment and the rules about GitHub", () => {
    const text = addressInstructions(item, "feature/b", [
      thread,
      { path: "src/old.ts", outdated: true, comments: [{ author: "bob", body: "Why?\nReally?" }] },
    ])

    expect(text).toContain("1. `src/app.ts:3`\n   @alice:\n   > Name this.")
    expect(text).toContain("2. `src/old.ts` (outdated")
    expect(text).toContain("   > Really?")
    expect(text).toContain("Never push, never resolve threads")
    expect(addressInstructions(item, "feature/b", [])).toContain("None are open on GitHub right now.")
  })
})
