import { readFile } from "node:fs/promises"
import type { Location, Plugin } from "@opencode/plugin"
import { type CommentableLines, commentableLines, commentProblem } from "../../domain/pull-request-diff.js"
import {
  type Decision,
  type Finding,
  type FindingChanges,
  type FindingInput,
  postBlocker,
  type ReviewDraft,
  reviewPayload,
  type Verdict,
} from "../../domain/review-draft.js"
import type { ReviewRequest } from "../../domain/review-request.js"
import { fetchDiff, fetchPullRequest, postReview, viewerLogin } from "../github/pull-request.js"
import {
  cloneRepository,
  createWorktree,
  findCheckout,
  managedClonePath,
  removeWorktree,
  worktreePath,
} from "./checkout.js"
import type { DraftStore } from "./draft-store.js"
import { DEFAULT_GUIDELINES, reviewInstructions, startPrompt } from "./instructions.js"

type SessionModel = NonNullable<NonNullable<Parameters<Plugin.Context["session"]["create"]>[0]>["model"]>

export type StartResult =
  | { status: "started" | "resumed"; sessionID: string }
  | { status: "needs-clone"; repository: string; directory: string }
export type PostResult = { status: "posted"; url: string } | { status: "stale"; reason: string }

const INSTRUCTIONS_KEY = "github-review-queue"

export class ReviewService {
  private diffs = new Map<string, Promise<CommentableLines>>()

  constructor(
    private readonly store: DraftStore,
    private readonly options: { cacheDirectory: string; guidelinesFile?: string | undefined; timeoutMs: number },
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
      await removeWorktree(checkout, worktree, AbortSignal.timeout(this.options.timeoutMs)).catch(() => undefined)
      throw error
    }
  }

  /** Deletes the local draft and worktree. The review session and anything already on GitHub are left alone. */
  async reset(key: string, signal: AbortSignal): Promise<void> {
    const draft = await this.store.get(key)
    if (!draft) {
      return
    }
    if (draft.status !== "posted") {
      await removeWorktree(draft.checkout, draft.worktree, signal)
    }
    this.diffs.delete(key)
    await this.store.remove(key)
  }

  async post(key: string, allowStale: boolean, signal: AbortSignal): Promise<PostResult> {
    const draft = this.requireDraft(await this.store.get(key))
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
    this.diffs.delete(key)
    await removeWorktree(draft.checkout, draft.worktree, signal).catch(() => undefined)
    return { status: "posted", url }
  }

  async draftForSession(sessionID: string): Promise<ReviewDraft> {
    return this.requireDraft(await this.store.bySession(sessionID))
  }

  async addFinding(sessionID: string, input: FindingInput): Promise<Finding> {
    const draft = await this.editableDraft(sessionID)
    await this.assertCommentable(draft, input)
    let id = 0
    const saved = await this.store.update(draft.key, (next) => {
      id = Math.max(0, ...next.findings.map((finding) => finding.id)) + 1
      next.findings.push({ ...input, id, decision: "pending" })
    })
    return this.findingIn(saved, id)
  }

  async updateFinding(sessionID: string, id: number, changes: FindingChanges): Promise<Finding> {
    const draft = await this.editableDraft(sessionID)
    const defined = Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined))
    await this.assertCommentable(draft, { ...this.findingIn(draft, id), ...defined })
    const saved = await this.store.update(draft.key, (next) => {
      this.findingIn(next, id)
      next.findings = next.findings.map((finding) =>
        finding.id === id ? { ...finding, ...defined, decision: "pending" as const } : finding,
      )
    })
    return this.findingIn(saved, id)
  }

  async decide(sessionID: string, id: number, decision: Exclude<Decision, "pending">): Promise<Finding> {
    const draft = await this.editableDraft(sessionID)
    this.findingIn(draft, id)
    const saved = await this.store.update(draft.key, (next) => {
      next.findings = next.findings.map((finding) => (finding.id === id ? { ...finding, decision } : finding))
    })
    return this.findingIn(saved, id)
  }

  async setVerdict(sessionID: string, verdict: Verdict, summary: string): Promise<ReviewDraft> {
    const draft = await this.editableDraft(sessionID)
    if (draft.ownPullRequest && verdict !== "COMMENT") {
      throw new Error("GitHub does not let you approve or request changes on your own pull request; use COMMENT.")
    }
    return this.store.update(draft.key, (next) => {
      next.verdict = verdict
      next.summary = summary
      next.status = "ready"
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

  private requireDraft(draft: ReviewDraft | undefined): ReviewDraft {
    if (!draft) {
      throw new Error("This is not a review session started from the review queue panel, or its draft was reset.")
    }
    return draft
  }

  private async editableDraft(sessionID: string): Promise<ReviewDraft> {
    const draft = await this.draftForSession(sessionID)
    if (draft.status === "posted") {
      throw new Error("This review was already posted; start a new review from the panel to draft another.")
    }
    return draft
  }

  private findingIn(draft: ReviewDraft, id: number): Finding {
    const finding = draft.findings.find((candidate) => candidate.id === id)
    if (!finding) {
      throw new Error(`There is no finding #${id} in this draft.`)
    }
    return finding
  }

  private async assertCommentable(draft: ReviewDraft, target: FindingInput): Promise<void> {
    const problem = commentProblem(await this.commentableLines(draft), target)
    if (problem) {
      throw new Error(
        `${problem} Check \`gh pr diff ${draft.number} --repo ${draft.repository}\` and pick a line in a hunk.`,
      )
    }
  }

  private commentableLines(draft: ReviewDraft): Promise<CommentableLines> {
    const cached = this.diffs.get(draft.key)
    if (cached) {
      return cached
    }
    const loading = fetchDiff(draft.repository, draft.number, AbortSignal.timeout(this.options.timeoutMs)).then(
      commentableLines,
    )
    loading.catch(() => this.diffs.delete(draft.key))
    this.diffs.set(draft.key, loading)
    return loading
  }
}
