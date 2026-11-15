import { readFile } from "node:fs/promises"
import type { Location, Plugin } from "@opencode/plugin"
import { postBlocker, type ReviewDraft, reviewPayload } from "../../domain/review-draft.js"
import type { ReviewedRecord } from "../../domain/review-history.js"
import { everyPullRequest, type QueueSnapshot } from "../../domain/review-queue.js"
import { hostField, hostOf, qualifiedRepository, type ReviewRequest } from "../../domain/review-request.js"
import { createWorktree, fetchCommit } from "../git/worktrees.js"
import { fetchPullRequest, postReview, pullRequestStates, viewerLogin } from "../github/pull-request.js"
import type { KeyedStore } from "../keyed-store.js"
import { DEFAULT_GUIDELINES, reviewInstructions, startPrompt } from "./agent/instructions.js"
import { REVIEW_PERMISSIONS } from "./agent/permissions.js"
import { cleanUpCheckout, cloneRepository, findCheckout, managedClonePath, worktreePath } from "./checkout.js"
import type { DraftStore } from "./draft-store.js"

type PullRequest = Awaited<ReturnType<typeof fetchPullRequest>>
type SessionModel = NonNullable<NonNullable<Parameters<Plugin.Context["session"]["create"]>[0]>["model"]>

export type ReviewMode = "full" | "changes"

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
    private readonly reviewed: KeyedStore<ReviewedRecord>,
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
    mode?: ReviewMode | undefined
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
    const checkout = await this.checkout(input)
    if (!checkout) {
      return {
        status: "needs-clone",
        repository: qualifiedRepository(item),
        directory: managedClonePath(cacheDirectory, item),
      }
    }

    const [pullRequest, viewer, guidelines, previous] = await Promise.all([
      fetchPullRequest(item, signal),
      viewerLogin(item.host, signal),
      this.guidelines(),
      input.mode === "changes" ? this.reviewed.get(item.key) : undefined,
    ])
    if (pullRequest.state !== "OPEN") {
      throw new Error(
        `${item.repository}#${item.number} is ${pullRequest.state.toLowerCase()}; there is nothing to review.`,
      )
    }
    const worktree = worktreePath(cacheDirectory, item, item.number)
    const headSha = await createWorktree({
      checkout,
      host: item.host,
      repository: item.repository,
      number: item.number,
      worktree,
      signal,
    })
    const since = await this.followUp(
      previous,
      { checkout, host: item.host, repository: item.repository, headSha },
      signal,
    )

    try {
      const sessionID = await this.openSession(input, {
        pullRequest,
        viewer,
        guidelines,
        since,
        checkout,
        worktree,
        headSha,
      })
      return { status: "started", sessionID }
    } catch (error) {
      await this.store.remove(item.key)
      await this.cleanUp({ checkout, worktree }, AbortSignal.timeout(this.options.timeoutMs)).catch(() => undefined)
      throw error
    }
  }

  private async checkout(input: {
    item: ReviewRequest
    directory?: string | undefined
    clone: boolean
    signal: AbortSignal
  }): Promise<string | undefined> {
    const { item, signal } = input
    const cacheDirectory = this.options.cacheDirectory
    const found = await findCheckout({
      host: item.host,
      repository: item.repository,
      directory: input.directory,
      cacheDirectory,
      signal,
    })
    if (found || !input.clone) {
      return found
    }
    return cloneRepository(item, cacheDirectory, signal)
  }

  private async openSession(
    input: {
      item: ReviewRequest
      model?: { providerID: string; id: string } | undefined
      sessions: Plugin.Context["session"]
    },
    review: {
      pullRequest: PullRequest
      viewer: string
      guidelines: string
      since: ReviewedRecord | undefined
      checkout: string
      worktree: string
      headSha: string
    },
  ): Promise<string> {
    const { item } = input
    const { pullRequest, viewer, since } = review
    const session = await input.sessions.create({
      title: `Review ${item.repository}#${item.number}`,
      location: { directory: review.worktree as Location.PublicRef["directory"] },
      ...(input.model ? { model: input.model as SessionModel } : {}),
      permissions: REVIEW_PERMISSIONS,
    })
    const now = new Date().toISOString()
    const draft = await this.store.put({
      version: 1,
      key: item.key,
      ...hostField(hostOf(item)),
      repository: item.repository,
      number: item.number,
      title: pullRequest.title,
      headSha: review.headSha,
      baseSha: pullRequest.baseRefOid,
      ...(since ? { sinceSha: since.headSha } : {}),
      ownPullRequest: pullRequest.author.login.toLowerCase() === viewer.toLowerCase(),
      checkout: review.checkout,
      worktree: review.worktree,
      sessionID: session.id,
      status: "investigating",
      findings: [],
      createdAt: now,
      updatedAt: now,
    })
    await input.sessions.instructions.entry.put({
      sessionID: session.id,
      key: INSTRUCTIONS_KEY,
      value: reviewInstructions(draft, pullRequest.baseRefName, review.guidelines, since && { record: since, viewer }),
    })
    await input.sessions.prompt({ sessionID: session.id, text: startPrompt(draft) })
    return session.id
  }

  private async followUp(
    previous: ReviewedRecord | undefined,
    target: { checkout: string; host?: string | undefined; repository: string; headSha: string },
    signal: AbortSignal,
  ): Promise<ReviewedRecord | undefined> {
    if (!previous || previous.headSha === target.headSha) {
      return undefined
    }
    // A managed clone may have been deleted since, and a force-push leaves the old head out of the new fetch.
    await fetchCommit(target.checkout, target, previous.headSha, signal).catch(() => undefined)
    return previous
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
    const pullRequest = await fetchPullRequest(draft, signal)
    const blocker = postBlocker(draft)
    if (blocker) {
      throw new Error(blocker)
    }
    const stale = postBlocker(draft, pullRequest.headRefOid)
    if (stale && !allowStale) {
      return { status: "stale", reason: stale }
    }
    const url = await postReview(draft, reviewPayload(draft), signal)
    await this.store.update(key, (saved) => {
      saved.status = "posted"
      saved.postedUrl = url
    })
    // Only the follow-up offer depends on this record, so failing to save it must not report the post as failed.
    await this.reviewed
      .put({
        version: 1,
        key,
        ...hostField(hostOf(draft)),
        repository: draft.repository,
        number: draft.number,
        headSha: draft.headSha,
        ...(draft.baseSha ? { baseSha: draft.baseSha } : {}),
        verdict: draft.verdict ?? "COMMENT",
        postedUrl: url,
        postedAt: new Date().toISOString(),
      })
      .catch(() => undefined)
    const cleanupWarning = await this.cleanUp(draft, signal).then(
      () => undefined,
      (error: unknown) =>
        `The review was posted, but its worktree at ${draft.worktree} could not be removed: ${error instanceof Error ? error.message : String(error)}`,
    )
    return { status: "posted", url, ...(cleanupWarning ? { cleanupWarning } : {}) }
  }

  /** Prunes after each successful queue refresh, one run at a time. */
  pruneAfterRefresh(state: QueueSnapshot, signal: AbortSignal): Promise<void> {
    if (state.loading || state.error || this.pruning) {
      return this.pruning ?? Promise.resolve()
    }
    const queued = new Set(everyPullRequest(state).map((item) => item.key))
    this.pruning = this.prune(queued, signal)
      .catch(() => undefined)
      .finally(() => {
        this.pruning = undefined
      })
    return this.pruning
  }

  /**
   * Forgets the drafts of pull requests that left the queue: posted ones right away, unposted ones once the pull
   * request is closed or merged. An open pull request keeps its draft, since the user may still post it. A record of
   * a posted review is kept until its pull request is closed or merged, so a re-request can follow up on it.
   */
  async prune(queued: ReadonlySet<string>, signal: AbortSignal): Promise<void> {
    await this.pruneReviewed(queued, signal).catch(() => undefined)
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

  private async pruneReviewed(queued: ReadonlySet<string>, signal: AbortSignal): Promise<void> {
    const candidates = (await this.reviewed.list()).filter((record) => !queued.has(record.key))
    if (candidates.length === 0) {
      return
    }
    const states = await pullRequestStates(candidates, signal)
    for (const record of candidates) {
      const state = states.get(record.key)
      if (state && state !== "OPEN") {
        await this.reviewed.remove(record.key)
      }
    }
  }

  private async finished(draft: ReviewDraft, signal: AbortSignal): Promise<boolean> {
    if (draft.status === "posted") {
      return true
    }
    const pullRequest = await fetchPullRequest(draft, signal).catch(() => undefined)
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
