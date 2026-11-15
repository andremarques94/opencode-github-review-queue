import {
  commentBody,
  type Finding,
  isFindingQuestion,
  questionHeader,
  type ReviewDraft,
} from "../../domain/review-draft.js"
import type { RpcInput, RpcOutput } from "../rpc.js"

/** The part of a pending OpenCode form this needs; the question tool puts each question's header in `title`. */
export type PendingQuestion = {
  id: string
  metadata?: { readonly [key: string]: unknown } | undefined
  fields: readonly { title?: string | undefined }[]
}

export type FindingFlowHost = {
  decideFinding(input: RpcInput<"decideFinding">): Promise<RpcOutput<"decideFinding">>
  editFinding(input: RpcInput<"editFinding">): Promise<RpcOutput<"editFinding">>
  askAboutFinding(input: RpcInput<"askAboutFinding">): Promise<RpcOutput<"askAboutFinding">>
  editBody(input: { title: string; body: string }): Promise<string | undefined>
  questions(sessionID: string): Promise<readonly PendingQuestion[]>
  cancelQuestion(input: { sessionID: string; formID: string; message: string }): Promise<void>
}

const DECIDED = { keep: "kept", drop: "dropped" } as const

export function findingQuestion(questions: readonly PendingQuestion[], id?: number): PendingQuestion | undefined {
  return questions.find((question) => {
    const header = question.fields[0]?.title
    if (question.metadata?.kind !== "question") {
      return false
    }
    return id === undefined ? isFindingQuestion(header) : header === questionHeader(id)
  })
}

/**
 * The agent waits on its question tool, so a choice made in the panel would leave it asking about a finding that is
 * already decided. Cancelling with a message hands the agent that message as the question's result.
 */
async function closeQuestion(host: FindingFlowHost, sessionID: string, id: number | undefined, message: string) {
  const question = findingQuestion(await host.questions(sessionID), id)
  if (question) {
    await host.cancelQuestion({ sessionID, formID: question.id, message })
  }
}

export async function decideFindingFlow(
  host: FindingFlowHost,
  draft: ReviewDraft,
  finding: Finding,
  decision: "keep" | "drop",
): Promise<ReviewDraft> {
  const result = await host.decideFinding({ sessionID: draft.sessionID, id: finding.id, decision })
  await closeQuestion(
    host,
    draft.sessionID,
    finding.id,
    `The user ${DECIDED[decision]} ${questionHeader(finding.id)} in the review panel. Call review_next_finding and go on.`,
  )
  return result.draft
}

export async function editFindingFlow(
  host: FindingFlowHost,
  draft: ReviewDraft,
  finding: Finding,
): Promise<ReviewDraft | undefined> {
  const current = commentBody(finding)
  const body = await host.editBody({ title: `Edit the comment for ${questionHeader(finding.id)}`, body: current })
  if (body === undefined || body === current) {
    return undefined
  }
  const result = await host.editFinding({ sessionID: draft.sessionID, id: finding.id, body })
  await closeQuestion(
    host,
    draft.sessionID,
    finding.id,
    `The user rewrote and kept ${questionHeader(finding.id)} in the review panel. Call review_next_finding and go on.`,
  )
  return result.draft
}

export async function askAboutFindingFlow(host: FindingFlowHost, draft: ReviewDraft, finding: Finding): Promise<void> {
  // Any open question holds the agent's turn, so the request below would wait behind it.
  await closeQuestion(
    host,
    draft.sessionID,
    undefined,
    `The user asked about ${questionHeader(finding.id)} in the review panel; their request follows.`,
  )
  await host.askAboutFinding({ sessionID: draft.sessionID, id: finding.id })
}
