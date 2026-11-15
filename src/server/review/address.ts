import type { Location, Plugin } from "@opencode/plugin"
import type { AddressSession } from "../../domain/my-pull-request.js"
import type { ReviewRequest } from "../../domain/review-request.js"
import { createBranchWorktree, currentBranch } from "../git/worktrees.js"
import { fetchOpenThreads, fetchPullRequestBranch } from "../github/pull-request.js"
import type { KeyedStore } from "../keyed-store.js"
import { addressInstructions, addressPrompt } from "./agent/address-instructions.js"
import { ADDRESS_PERMISSIONS } from "./agent/permissions.js"
import { addressWorktreePath, checkoutProblem, sessionCheckout } from "./checkout.js"

type SessionModel = NonNullable<NonNullable<Parameters<Plugin.Context["session"]["create"]>[0]>["model"]>

export type AddressResult =
  | { status: "started" | "resumed"; sessionID: string }
  | { status: "needs-worktree"; branch: string; current?: string; directory: string }
  | { status: "needs-model" }

const INSTRUCTIONS_KEY = "github-review-queue.address"

export class AddressSessions {
  constructor(
    private readonly store: KeyedStore<AddressSession>,
    private readonly cacheDirectory: string,
  ) {}

  async start(input: {
    item: ReviewRequest
    directory?: string | undefined
    worktree: boolean
    model?: { providerID: string; id: string } | undefined
    sessions: Plugin.Context["session"]
    signal: AbortSignal
  }): Promise<AddressResult> {
    const { item, signal } = input
    const existing = await this.store.get(item.key)
    if (existing) {
      return { status: "resumed", sessionID: existing.sessionID }
    }
    const place = await this.place(item, input.directory, signal)
    if (place.worktree && !input.worktree) {
      const { branch, current, worktree: directory } = place
      return { status: "needs-worktree", branch, ...(current ? { current } : {}), directory }
    }
    if (!input.model) {
      return { status: "needs-model" }
    }
    if (place.worktree) {
      const { checkout, branch, worktree } = place
      await createBranchWorktree({ checkout, branch, worktree, host: item.host, repository: item.repository, signal })
    }
    const directory = place.worktree ?? place.checkout
    const threads = await fetchOpenThreads(item, signal)
    const session = await input.sessions.create({
      title: `Address review of ${item.repository}#${item.number}`,
      location: { directory: directory as Location.PublicRef["directory"] },
      model: input.model as SessionModel,
      permissions: ADDRESS_PERMISSIONS,
    })
    await input.sessions.instructions.entry.put({
      sessionID: session.id,
      key: INSTRUCTIONS_KEY,
      value: addressInstructions(item, place.branch, threads),
    })
    await this.store.put({ version: 1, key: item.key, sessionID: session.id, directory, createdAt: now() })
    await input.sessions.prompt({ sessionID: session.id, text: addressPrompt(item) })
    return { status: "started", sessionID: session.id }
  }

  private async place(item: ReviewRequest, directory: string | undefined, signal: AbortSignal) {
    if (!item.authored) {
      throw new Error("Only your own pull requests have a review to address.")
    }
    const [pullRequest, checkout] = await Promise.all([
      fetchPullRequestBranch(item, signal),
      sessionCheckout({ host: item.host, repository: item.repository, directory, signal }),
    ])
    if (pullRequest.state !== "OPEN") {
      throw new Error(
        `${item.repository}#${item.number} is ${pullRequest.state.toLowerCase()}; there is nothing to address.`,
      )
    }
    if (!checkout) {
      throw new Error(await checkoutProblem({ host: item.host, repository: item.repository, directory, signal }))
    }
    const branch = pullRequest.headRefName
    const current = await currentBranch(checkout, signal)
    if (current === branch) {
      return { checkout, branch, current, worktree: undefined }
    }
    if (pullRequest.isCrossRepository) {
      throw new Error(`${branch} lives on a fork. Check it out in your clone first, then try again.`)
    }
    return {
      checkout,
      branch,
      current,
      worktree: addressWorktreePath(this.cacheDirectory, item, item.number),
    }
  }

  /** Worktrees stay: they may hold the user's commits. */
  async prune(open: ReadonlySet<string>): Promise<void> {
    for (const record of await this.store.list()) {
      if (!open.has(record.key)) {
        await this.store.remove(record.key)
      }
    }
  }
}

const now = () => new Date().toISOString()
