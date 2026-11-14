import type { RpcInput, RpcOutput } from "../../shared/rpc.js"
import { askPrompt } from "./agent/instructions.js"
import type { Findings } from "./findings.js"

export function triage(findings: Findings, prompt: (input: { sessionID: string; text: string }) => Promise<unknown>) {
  return {
    async decide(input: RpcInput<"decideFinding">): Promise<RpcOutput<"decideFinding">> {
      await findings.decide(input.sessionID, input.id, input.decision)
      return { draft: await findings.draftForSession(input.sessionID) }
    },
    async edit(input: RpcInput<"editFinding">): Promise<RpcOutput<"editFinding">> {
      return { draft: await findings.reword(input.sessionID, input.id, input.body) }
    },
    async ask(input: RpcInput<"askAboutFinding">): Promise<RpcOutput<"askAboutFinding">> {
      const finding = await findings.find(input.sessionID, input.id)
      await prompt({ sessionID: input.sessionID, text: askPrompt(finding) })
      return {}
    },
  }
}
