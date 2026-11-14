import { postBlocker, type ReviewDraft } from "../../domain/review-draft.js"
import type { ReviewRequest } from "../../domain/review-request.js"
import { fullReference } from "../presentation.js"
import type { RpcInput, RpcOutput } from "../rpc.js"
import { type ReviewPreview, reviewPreview } from "./preview.js"

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

type ModelOption = RpcOutput<"models">["models"][number]

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
