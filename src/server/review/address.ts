import type { Location, Plugin } from "@opencode/plugin"
import type { AddressSession } from "../../domain/my-pull-request.js"
import type { ReviewRequest } from "../../domain/review-request.js"
import { createBranchWorktree, currentBranch } from "../git/worktrees.js"
import { fetchOpenThreads, fetchPullRequestBranch } from "../github/pull-request.js"
import type { KeyedStore } from "../keyed-store.js"
import { addressInstructions, addressPrompt } from "./agent/address-instructions.js"
import { addressWorktreePath, sessionCheckout } from "./checkout.js"

type SessionModel = NonNullable<NonNullable<Parameters<Plugin.Context["session"]["create"]>[0]>["model"]>

export type AddressResult =
  | { status: "started" | "resumed"; sessionID: string }
  | { status: "needs-worktree"; branch: string; current?: string; directory: string }
  | { status: "needs-model" }

const INSTRUCTIONS_KEY = "github-review-queue.address"

/**
 * File edits stay allowed: fixing the code is the point. What reaches GitHub stays with the user, so pushing,
 * merging, reviewing, commenting, and GraphQL mutations such as resolving a thread are denied.
 */
const PERMISSIONS = ["git push *", "gh pr merge *", "gh pr review *", "gh pr comment *", "gh api graphql *"].map(
  (resource) => ({ action: "shell", resource, effect: "deny" as const }),
)

/** Sessions that address the reviews of the user's own pull requests, in their own checkout and branch. */
export class AddressSessions {
  constructor(
    private readonly store: KeyedStore<AddressSession>,
    private readonly cacheDirectory: string,
  ) {}

  /**
   * Checks before it acts: a checkout on another branch comes back as `needs-worktree` for the user to confirm, and
   * without a model as `needs-model`. Nothing is created until both are settled.
   */
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
      await createBranchWorktree({ checkout, branch, worktree, repository: item.repository, signal })
    }
    const directory = place.worktree ?? place.checkout
    const threads = await fetchOpenThreads(item.repository, item.number, signal)
    const session = await input.sessions.create({
      title: `Address review of ${item.repository}#${item.number}`,
      location: { directory: directory as Location.PublicRef["directory"] },
      model: input.model as SessionModel,
      permissions: PERMISSIONS,
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

  /** Where the session works: the user's checkout when it is on the branch, otherwise a worktree to add. */
  private async place(item: ReviewRequest, directory: string | undefined, signal: AbortSignal) {
    if (!item.authored) {
      throw new Error("Only your own pull requests have a review to address.")
    }
    const [pullRequest, checkout] = await Promise.all([
      fetchPullRequestBranch(item.repository, item.number, signal),
      sessionCheckout({ repository: item.repository, directory, signal }),
    ])
    if (pullRequest.state !== "OPEN") {
      throw new Error(
        `${item.repository}#${item.number} is ${pullRequest.state.toLowerCase()}; there is nothing to address.`,
      )
    }
    if (!checkout) {
      throw new Error(`Open OpenCode in your clone of ${item.repository} to address its review there.`)
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
      worktree: addressWorktreePath(this.cacheDirectory, item.repository, item.number),
    }
  }

  /**
   * Forgets the sessions of pull requests no longer among the user's open ones. Their worktrees stay: they may hold
   * the user's commits.
   */
  async prune(open: ReadonlySet<string>): Promise<void> {
    for (const record of await this.store.list()) {
      if (!open.has(record.key)) {
        await this.store.remove(record.key)
      }
    }
  }
}

const now = () => new Date().toISOString()
