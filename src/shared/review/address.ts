import type { ReviewRequest } from "../../domain/review-request.js"
import { fullReference } from "../presentation.js"
import type { RpcInput, RpcOutput } from "../rpc.js"
import { pickModel, type ReviewFlowHost } from "./flows.js"

export type AddressFlowHost = Pick<ReviewFlowHost, "confirm" | "models" | "select" | "notify"> & {
  addressReview(input: RpcInput<"addressReview">): Promise<RpcOutput<"addressReview">>
}

/**
 * Opens, or returns to, a session that addresses the review in the user's own checkout. A checkout on another branch
 * is never switched: the user confirms a worktree on the pull request's branch instead.
 */
export async function addressReviewFlow(
  host: AddressFlowHost,
  item: ReviewRequest,
  directory: string | undefined,
): Promise<string | undefined> {
  const base = { key: item.key, ...(directory ? { directory } : {}) }
  let worktree = false
  let result = await host.addressReview({ ...base, worktree })
  if (result.status === "needs-worktree") {
    const approved = await host.confirm({
      title: `Check out ${result.branch}?`,
      message: `${result.current ? `Your checkout is on ${result.current}, and` : "Your checkout is on a detached head, and"} it stays that way. The plugin will add a worktree on ${result.branch} at ${result.directory} for this session. It is kept after the session, since it may hold your commits.`,
      confirm: "Add worktree",
    })
    if (!approved) {
      return undefined
    }
    worktree = true
    result = await host.addressReview({ ...base, worktree })
  }
  if (result.status === "needs-model") {
    const model = await pickModel(host, `Address the review of ${fullReference(item)}? Pick the model`)
    if (!model) {
      return undefined
    }
    host.notify(`Preparing ${fullReference(item)}…`)
    result = await host.addressReview({ ...base, worktree, model: { providerID: model.providerID, id: model.id } })
  }
  return result.status === "started" || result.status === "resumed" ? result.sessionID : undefined
}
