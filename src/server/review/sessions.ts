import { readFile } from "node:fs/promises"
import type { Location, Plugin } from "@opencode/plugin"
import { postBlocker, type ReviewDraft, reviewPayload } from "../../domain/review-draft.js"
import type { QueueSnapshot } from "../../domain/review-queue.js"
import type { ReviewRequest } from "../../domain/review-request.js"
import { createWorktree } from "../git/worktrees.js"
import { fetchPullRequest, postReview, viewerLogin } from "../github/pull-request.js"
import { DEFAULT_GUIDELINES, reviewInstructions, startPrompt } from "./agent/instructions.js"
import { cleanUpCheckout, cloneRepository, findCheckout, managedClonePath, worktreePath } from "./checkout.js"
import type { DraftStore } from "./draft-store.js"

type SessionModel = NonNullable<NonNullable<Parameters<Plugin.Context["session"]["create"]>[0]>["model"]>

export type StartResult =
  | { status: "started" | "resumed"; sessionID: string }
  | { status: "needs-clone"; repository: string; directory: string }
export type PostResult =
  | { status: "posted"; url: string; cleanupWarning?: string }
  | { status: "stale"; reason: string }

const INSTRUCTIONS_KEY = "github-review-queue"

/** Starting, resetting, and posting a review: the panel's side of the workflow. */
export class ReviewSessions {
  private pruning: Promise<void> | undefined

  constructor(
    private readonly store: DraftStore,
    private readonly options: {
      cacheDirectory: string
      guidelinesFile?: string | undefined
      keepClones: boolean
      timeoutMs: number
    },
  ) {}

  async start(input: {
    item: ReviewRequest
    directory?: string | undefined
    clone: boolean
    model?: { providerID: string; id: string } | undefined
    sessions: Plugin.Context["session"]
    signal: AbortSignal
  }): Promise<StartResult> {
    const { item, signal } = input
    const existing = await this.store.get(item.key)
    if (existing && existing.status !== "posted") {
      return { status: "resumed", sessionID: existing.sessionID }
    }
    const cacheDirectory = this.options.cacheDirectory
    const found = await findCheckout({
      repository: item.repository,
      directory: input.directory,
      cacheDirectory,
      signal,
    })
    const checkout = found ?? (input.clone ? await cloneRepository(item.repository, cacheDirectory, signal) : undefined)
    if (!checkout) {
      return {
        status: "needs-clone",
        repository: item.repository,
        directory: managedClonePath(cacheDirectory, item.repository),
      }
    }

    const [pullRequest, viewer, guidelines] = await Promise.all([
      fetchPullRequest(item.repository, item.number, signal),
      viewerLogin(signal),
      this.guidelines(),
    ])
    if (pullRequest.state !== "OPEN") {
      throw new Error(
        `${item.repository}#${item.number} is ${pullRequest.state.toLowerCase()}; there is nothing to review.`,
      )
    }
    const worktree = worktreePath(cacheDirectory, item.repository, item.number)
    const headSha = await createWorktree({
      checkout,
      repository: item.repository,
      number: item.number,
      worktree,
      signal,
    })

    try {
      const session = await input.sessions.create({
        title: `Review ${item.repository}#${item.number}`,
        location: { directory: worktree as Location.PublicRef["directory"] },
        ...(input.model ? { model: input.model as SessionModel } : {}),
        permissions: [{ action: "edit", resource: "*", effect: "deny" }],
      })
      const now = new Date().toISOString()
      const draft = await this.store.put({
        version: 1,
        key: item.key,
        repository: item.repository,
        number: item.number,
        title: pullRequest.title,
        headSha,
        ownPullRequest: pullRequest.author.login.toLowerCase() === viewer.toLowerCase(),
        checkout,
        worktree,
        sessionID: session.id,
        status: "investigating",
        findings: [],
        createdAt: now,
        updatedAt: now,
      })
      await input.sessions.instructions.entry.put({
        sessionID: session.id,
        key: INSTRUCTIONS_KEY,
        value: reviewInstructions(draft, pullRequest.baseRefName, guidelines),
      })
      await input.sessions.prompt({ sessionID: session.id, text: startPrompt(draft) })
      return { status: "started", sessionID: session.id }
    } catch (error) {
      await this.store.remove(item.key)
      await this.cleanUp({ checkout, worktree }, AbortSignal.timeout(this.options.timeoutMs)).catch(() => undefined)
      throw error
    }
  }

  async reset(key: string, signal: AbortSignal): Promise<void> {
    const draft = await this.store.get(key)
    if (!draft) {
      return
    }
    if (draft.status !== "posted") {
      await this.cleanUp(draft, signal)
    }
    await this.store.remove(key)
  }

  async post(key: string, allowStale: boolean, signal: AbortSignal): Promise<PostResult> {
    const draft = await this.store.get(key)
    if (!draft) {
      throw new Error("There is no review draft for this pull request.")
    }
    const pullRequest = await fetchPullRequest(draft.repository, draft.number, signal)
    const blocker = postBlocker(draft)
    if (blocker) {
      throw new Error(blocker)
    }
    const stale = postBlocker(draft, pullRequest.headRefOid)
    if (stale && !allowStale) {
      return { status: "stale", reason: stale }
    }
    const url = await postReview(draft.repository, draft.number, reviewPayload(draft), signal)
    await this.store.update(key, (saved) => {
      saved.status = "posted"
      saved.postedUrl = url
    })
    const cleanupWarning = await this.cleanUp(draft, signal).then(
      () => undefined,
      (error: unknown) =>
        `The review was posted, but its worktree at ${draft.worktree} could not be removed: ${error instanceof Error ? error.message : String(error)}`,
    )
    return { status: "posted", url, ...(cleanupWarning ? { cleanupWarning } : {}) }
  }

  /**
   * Forgets the drafts of pull requests that left the queue: posted ones right away, unposted ones once the pull
   * request is closed or merged. An open pull request keeps its draft, since the user may still post it.
   */
  /** Prunes after each successful queue refresh, one run at a time. */
  pruneAfterRefresh(state: QueueSnapshot, signal: AbortSignal): Promise<void> {
    if (state.loading || state.error || this.pruning) {
      return this.pruning ?? Promise.resolve()
    }
    const queued = new Set(state.items.map((item) => item.key))
    this.pruning = this.prune(queued, signal)
      .catch(() => undefined)
      .finally(() => {
        this.pruning = undefined
      })
    return this.pruning
  }

  async prune(queued: ReadonlySet<string>, signal: AbortSignal): Promise<void> {
    for (const draft of await this.store.list()) {
      if (queued.has(draft.key) || !(await this.finished(draft, signal))) {
        continue
      }
      if (draft.status !== "posted") {
        await this.cleanUp(draft, signal).catch(() => undefined)
      }
      await this.store.remove(draft.key)
    }
  }

  private async finished(draft: ReviewDraft, signal: AbortSignal): Promise<boolean> {
    if (draft.status === "posted") {
      return true
    }
    const pullRequest = await fetchPullRequest(draft.repository, draft.number, signal).catch(() => undefined)
    return pullRequest !== undefined && pullRequest.state !== "OPEN"
  }

  private cleanUp(draft: Pick<ReviewDraft, "checkout" | "worktree">, signal: AbortSignal): Promise<void> {
    return cleanUpCheckout({
      checkout: draft.checkout,
      worktree: draft.worktree,
      cacheDirectory: this.options.cacheDirectory,
      keepClones: this.options.keepClones,
      signal,
    })
  }

  private async guidelines(): Promise<string> {
    if (!this.options.guidelinesFile) {
      return DEFAULT_GUIDELINES
    }
    try {
      return await readFile(this.options.guidelinesFile, "utf8")
    } catch {
      throw new Error(`Could not read the review guidelines file at ${this.options.guidelinesFile}.`)
    }
  }
}
