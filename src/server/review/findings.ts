import {
  type CommentableLines,
  commentableLines,
  commentProblem,
  suggestionProblem,
} from "../../domain/pull-request-diff.js"
import {
  type Decision,
  type Finding,
  type FindingChanges,
  type FindingInput,
  type ReviewDraft,
  splitComment,
  type Verdict,
} from "../../domain/review-draft.js"
import { fetchCompareDiff, fetchDiff } from "../github/pull-request.js"
import type { DraftStore } from "./draft-store.js"

/** The draft edits behind the agent's review tools, each scoped to the review session that calls it. */
export class Findings {
  private diffs = new Map<string, Promise<CommentableLines>>()

  constructor(
    private readonly store: DraftStore,
    private readonly timeoutMs: number,
  ) {}

  async draftForSession(sessionID: string): Promise<ReviewDraft> {
    const draft = await this.store.bySession(sessionID)
    if (!draft) {
      throw new Error("This is not a review session started from the review queue panel, or its draft was reset.")
    }
    return draft
  }

  async add(sessionID: string, input: FindingInput): Promise<Finding> {
    const draft = await this.editableDraft(sessionID)
    await this.assertCommentable(draft, input)
    let id = 0
    const saved = await this.store.update(draft.key, (next) => {
      id = Math.max(0, ...next.findings.map((finding) => finding.id)) + 1
      next.findings.push({ ...input, id, decision: "pending" })
    })
    return findingIn(saved, id)
  }

  /** A `null` suggestion removes it; other fields left out stay as they are. */
  async update(sessionID: string, id: number, changes: FindingChanges): Promise<Finding> {
    const draft = await this.editableDraft(sessionID)
    const { suggestion, ...current } = findingIn(draft, id)
    const kept = changes.suggestion === null || suggestion === undefined ? {} : { suggestion }
    const defined = Object.fromEntries(
      Object.entries(changes).filter(([, value]) => value !== undefined && value !== null),
    )
    const updated: Finding = { ...current, ...kept, ...defined, decision: "pending" }
    await this.assertCommentable(draft, updated)
    const saved = await this.store.update(draft.key, (next) => {
      findingIn(next, id)
      next.findings = next.findings.map((finding) => (finding.id === id ? updated : finding))
    })
    return findingIn(saved, id)
  }

  /**
   * The user's own wording from the panel. Unlike the agent's `update`, it counts as keeping the finding: the user
   * wrote the comment that gets posted, so there is nothing left for them to approve.
   */
  async reword(sessionID: string, id: number, text: string): Promise<ReviewDraft> {
    const draft = await this.editableDraft(sessionID)
    const { body, suggestion } = splitComment(text)
    if (!body.trim()) {
      throw new Error("Write a comment above the suggestion; GitHub posts the two together.")
    }
    const { suggestion: _, ...rest } = findingIn(draft, id)
    const reworded = { ...rest, body, ...(suggestion === undefined ? {} : { suggestion }) }
    await this.assertCommentable(draft, reworded)
    return this.store.update(draft.key, (next) => {
      next.findings = next.findings.map((finding) =>
        finding.id === id ? { ...reworded, decision: "keep" as const } : finding,
      )
    })
  }

  async find(sessionID: string, id: number): Promise<Finding> {
    return findingIn(await this.draftForSession(sessionID), id)
  }

  async decide(sessionID: string, id: number, decision: Exclude<Decision, "pending">): Promise<Finding> {
    const draft = await this.editableDraft(sessionID)
    findingIn(draft, id)
    const saved = await this.store.update(draft.key, (next) => {
      next.findings = next.findings.map((finding) => (finding.id === id ? { ...finding, decision } : finding))
    })
    return findingIn(saved, id)
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

  private async editableDraft(sessionID: string): Promise<ReviewDraft> {
    const draft = await this.draftForSession(sessionID)
    if (draft.status === "posted") {
      throw new Error("This review was already posted; start a new review from the panel to draft another.")
    }
    return draft
  }

  private async assertCommentable(draft: ReviewDraft, target: FindingInput): Promise<void> {
    const lines = await this.commentableLines(draft)
    const problem = commentProblem(lines, target)
    if (problem) {
      throw new Error(`${problem} Check \`${diffCommand(draft)}\` and pick a line in a hunk.`)
    }
    if (splitComment(target.body).suggestion !== undefined) {
      throw new Error("Put the replacement lines in `suggestion`, without the fence, and keep the body to the comment.")
    }
    const suggestion = suggestionProblem(lines, target)
    if (suggestion) {
      throw new Error(suggestion)
    }
  }

  private commentableLines(draft: ReviewDraft): Promise<CommentableLines> {
    const key = `${draft.key}@${draft.headSha}`
    const cached = this.diffs.get(key)
    if (cached) {
      return cached
    }
    const signal = AbortSignal.timeout(this.timeoutMs)
    const diff = draft.baseSha
      ? fetchCompareDiff(draft.repository, draft.baseSha, draft.headSha, signal)
      : fetchDiff(draft.repository, draft.number, signal)
    const loading = diff.then(commentableLines)
    loading.catch(() => this.diffs.delete(key))
    this.diffs.set(key, loading)
    return loading
  }
}

/** Drafts started before the base commit was recorded fall back to the pull request's current diff. */
export function diffCommand(draft: Pick<ReviewDraft, "repository" | "number" | "headSha" | "baseSha">): string {
  if (!draft.baseSha) {
    return `gh pr diff ${draft.number} --repo ${draft.repository}`
  }
  return `gh api repos/${draft.repository}/compare/${draft.baseSha}...${draft.headSha} -H "Accept: application/vnd.github.diff"`
}

function findingIn(draft: ReviewDraft, id: number): Finding {
  const finding = draft.findings.find((candidate) => candidate.id === id)
  if (!finding) {
    throw new Error(`There is no finding #${id} in this draft.`)
  }
  return finding
}
