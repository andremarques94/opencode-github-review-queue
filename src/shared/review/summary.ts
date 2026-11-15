import { changedLines, type ReviewRequest } from "../../domain/review-request.js"
import { fullReference } from "../presentation.js"
import { errorMessage, type RpcInput, type RpcOutput } from "../rpc.js"
import { pickModel, type ReviewFlowHost } from "./flows.js"

export type SummaryView = { title: string; note: string | undefined; markdown: string }

export type SummaryFlowHost = Pick<ReviewFlowHost, "models" | "select"> & {
  notify(message: string): void
  summarize(input: RpcInput<"summarize">): Promise<RpcOutput<"summarize">>
  showSummary(view: SummaryView): void
}

/** Roughly what fits in the server's 80,000-character diff: some 50 characters a changed line, context included. */
const SUMMARY_LINE_BUDGET = 1_500

function pickTitle(item: ReviewRequest): string {
  const lines = changedLines(item)
  if (lines === undefined || lines <= SUMMARY_LINE_BUDGET) {
    return `Summarize ${fullReference(item)}? Pick the model`
  }
  return `Summarize ${fullReference(item)}? It changes ${lines.toLocaleString("en-US")} lines, so only part of the diff will fit. Pick the model`
}

export async function summaryFlow(host: SummaryFlowHost, item: ReviewRequest): Promise<void> {
  const model = await pickModel(host, pickTitle(item))
  if (!model) {
    return
  }
  host.notify(`Summarizing ${fullReference(item)} with ${model.name}…`)
  const result = await host
    .summarize({ key: item.key, model: { providerID: model.providerID, id: model.id } })
    .catch((error: unknown) => {
      throw new Error(`${model.name} (${model.provider}): ${errorMessage(error) ?? "the request failed."}`)
    })
  const notes = [
    `By ${model.name}`,
    result.truncated ? "The diff was too large and was cut short, so this covers only part of it." : undefined,
  ].filter(Boolean)
  host.showSummary({
    title: `${fullReference(item)} · ${item.title}`,
    note: notes.length > 0 ? notes.join(" · ") : undefined,
    markdown: result.summary,
  })
}
