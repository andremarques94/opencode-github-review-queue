import { pendingFindings, postBlocker, type ReviewDraft, reviewPayload } from "../domain/review-draft.js"
import type { ReviewRequest } from "../domain/review-request.js"
import { fullReference } from "./presentation.js"
import type { RpcInput, RpcOutput } from "./rpc.js"

/** What each UI provides so both run the same review workflow. */
export type SelectOption<T> = { title: string; value: T; description?: string; group?: string }

export type ReviewFlowHost = {
  confirm(input: { title: string; message: string; confirm: string; danger?: boolean }): Promise<boolean>
  confirmPost(preview: ReviewPreview): Promise<boolean>
  select<T>(input: { title: string; options: SelectOption<T>[]; current?: T }): Promise<T | undefined>
  models(): Promise<RpcOutput<"models">>
  notify(message: string): void
  startReview(input: RpcInput<"startReview">): Promise<RpcOutput<"startReview">>
  postReview(input: RpcInput<"postReview">): Promise<RpcOutput<"postReview">>
  resetReview(input: RpcInput<"resetReview">): Promise<unknown>
}

/** The message of a thrown `Error` or of an RPC failure, which arrives as a plain `{ type, message }` object. */
export function errorMessage(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return error.message
  }
  return undefined
}

export function draftLabel(draft: ReviewDraft | undefined): string | undefined {
  if (!draft) {
    return undefined
  }
  switch (draft.status) {
    case "investigating":
      return "reviewing"
    case "posted":
      return "posted"
    case "ready": {
      const pending = pendingFindings(draft).length
      return pending > 0 ? `${pending} to decide` : "ready to post"
    }
  }
}

/** Activating a queue row reopens this draft's session instead of starting a new review. */
export const resumable = (draft: ReviewDraft | undefined) => draft !== undefined && draft.status !== "posted"

/** A draft's actions in a row's menu; starting or resuming is the row's own action. */
export type DraftAction =
  | { kind: "post"; label: string; draft: ReviewDraft; blocker: string | undefined }
  | { kind: "reset"; label: string; draft: ReviewDraft }

export function draftActions(draft: ReviewDraft | undefined): DraftAction[] {
  if (!draft) {
    return []
  }
  const reset: DraftAction = { kind: "reset", label: "Reset review…", draft }
  if (!resumable(draft)) {
    return [reset]
  }
  return [{ kind: "post", label: "Post review…", draft, blocker: postBlocker(draft) }, reset]
}

export const draftFor = (drafts: readonly ReviewDraft[], key: string) => drafts.find((draft) => draft.key === key)

type ModelOption = RpcOutput<"models">["models"][number]

/** Asks which model reviews, preselecting the last pick. Undefined when the user cancels. */
async function pickModel(host: ReviewFlowHost, item: ReviewRequest): Promise<ModelOption | undefined> {
  const { models, preferred } = await host.models()
  if (models.length === 0) {
    throw new Error("No chat models are available. Connect a provider first.")
  }
  const current = models.find((model) => model.providerID === preferred?.providerID && model.id === preferred.id)
  return host.select({
    title: `Start a review of ${fullReference(item)}? Pick the model`,
    options: models.map((model) => ({
      title: model.name,
      description: model.provider,
      group: model.provider,
      value: model,
    })),
    ...(current ? { current } : {}),
  })
}

/**
 * Starts the review session with a model the user picks, or resumes an existing one, asking before the plugin clones
 * a repository. Returns the session ID.
 */
export async function startReviewFlow(
  host: ReviewFlowHost,
  item: ReviewRequest,
  directory: string | undefined,
  resuming: boolean,
): Promise<string | undefined> {
  const model = resuming ? undefined : await pickModel(host, item)
  if (!resuming && !model) {
    return undefined
  }
  const base = {
    key: item.key,
    ...(directory ? { directory } : {}),
    ...(model ? { model: { providerID: model.providerID, id: model.id } } : {}),
  }
  host.notify(`Preparing review of ${fullReference(item)}…`)
  const first = await host.startReview({ ...base, clone: false })
  if (first.status !== "needs-clone") {
    return first.sessionID
  }
  const approved = await host.confirm({
    title: `Clone ${first.repository}?`,
    message: `No local clone of ${first.repository} was found here. The plugin will make a bare clone in ${first.directory} and reuse it for later reviews.`,
    confirm: "Clone and review",
  })
  if (!approved) {
    return undefined
  }
  host.notify(`Cloning ${first.repository}…`)
  const second = await host.startReview({ ...base, clone: true })
  return second.status === "needs-clone" ? undefined : second.sessionID
}

const VERDICT_LABELS = { REQUEST_CHANGES: "Request changes", COMMENT: "Comment", APPROVE: "Approve" } as const

/** Exactly what posting sends, shaped for a confirmation dialog. */
export type ReviewPreview = {
  title: string
  verdict: string
  summary: string
  comments: { location: string; body: string }[]
}

export function reviewPreview(draft: ReviewDraft): ReviewPreview {
  const payload = reviewPayload(draft)
  return {
    title: `Post review on ${draft.repository}#${draft.number}?`,
    verdict: VERDICT_LABELS[payload.event],
    summary: payload.body,
    comments: payload.comments.map((comment) => ({
      location: `${comment.path}:${comment.start_line ? `${comment.start_line}-` : ""}${comment.line}`,
      body: comment.body,
    })),
  }
}

export const commentCount = (count: number) => `${count} inline comment${count === 1 ? "" : "s"}`

const PREVIEW_LINE = 72

/** The preview as plain text, one short line per comment, for dialogs that only show text. */
export function previewText(preview: ReviewPreview): string {
  const shorten = (text: string) => {
    const line = text.split("\n")[0] ?? ""
    return line.length > PREVIEW_LINE ? `${line.slice(0, PREVIEW_LINE - 1)}…` : line
  }
  const comments = preview.comments.map((comment) => `• ${comment.location}  ${shorten(comment.body)}`)
  return [`${preview.verdict} · ${commentCount(preview.comments.length)}`, preview.summary, comments.join("\n")]
    .filter(Boolean)
    .join("\n\n")
}

/** Shows exactly what will be posted and posts it only after the user confirms. Returns the review URL. */
export async function postReviewFlow(host: ReviewFlowHost, draft: ReviewDraft): Promise<string | undefined> {
  const blocker = postBlocker(draft)
  if (blocker) {
    throw new Error(blocker)
  }
  if (!(await host.confirmPost(reviewPreview(draft)))) {
    return undefined
  }
  const first = await host.postReview({ key: draft.key, allowStale: false })
  if (first.status === "posted") {
    return first.url
  }
  const anyway = await host.confirm({
    title: "Post anyway?",
    message: `${first.reason} Comments may point at code that changed. Start a fresh review to recheck them instead.`,
    confirm: "Post anyway",
    danger: true,
  })
  if (!anyway) {
    return undefined
  }
  const second = await host.postReview({ key: draft.key, allowStale: true })
  return second.status === "posted" ? second.url : undefined
}

export async function resetReviewFlow(host: ReviewFlowHost, draft: ReviewDraft): Promise<boolean> {
  const approved = await host.confirm({
    title: `Reset review of ${draft.repository}#${draft.number}?`,
    message:
      draft.status === "posted"
        ? "This forgets the posted review locally. It stays on GitHub."
        : "This deletes the local draft and its worktree. The review session's chat history is kept.",
    confirm: "Reset review",
    danger: true,
  })
  if (approved) {
    await host.resetReview({ key: draft.key })
  }
  return approved
}
