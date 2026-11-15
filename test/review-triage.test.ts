import type { ToolEditor } from "@opencode/plugin/promise/tool"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { nextFinding, type ReviewDraft } from "../src/domain/review-draft.js"

const github = vi.hoisted(() => ({ fetchDiff: vi.fn() }))
vi.mock("../src/server/github/pull-request.js", () => github)

const { DraftStore } = await import("../src/server/review/draft-store.js")
const { Findings } = await import("../src/server/review/findings.js")
const { triage } = await import("../src/server/review/triage.js")
const { addReviewTools, hideReviewTools } = await import("../src/server/review/agent/tools.js")

const DIFF = `diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,2 +1,4 @@
 const a = 1
+const b = 2
+const c = 3
 export { a }
`

const base: ReviewDraft = {
  version: 1,
  key: "acme/api#7",
  repository: "acme/api",
  number: 7,
  title: "Add b",
  headSha: "abc123",
  ownPullRequest: false,
  checkout: "/repos/acme/api",
  worktree: "/cache/worktrees/acme/api/pr-7",
  sessionID: "ses_1",
  status: "investigating",
  findings: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
}

const finding = {
  path: "src/app.ts",
  line: 2,
  side: "RIGHT" as const,
  severity: "minor" as const,
  confidence: "high" as const,
  evidence: "",
  body: "Name this.",
}

const storage = (values: Map<string, unknown>) => ({
  get: async (key: string) => values.get(key),
  list: async () => [...values.values()],
  save: async (draft: ReviewDraft) => void values.set(draft.key, draft),
  remove: async (key: string) => void values.delete(key),
})

let saved: Map<string, unknown>
let agent: InstanceType<typeof Findings>
let panel: InstanceType<typeof Findings>
let prompt: ReturnType<typeof vi.fn<(input: { sessionID: string; text: string }) => Promise<unknown>>>

beforeEach(async () => {
  github.fetchDiff.mockReset().mockResolvedValue(DIFF)
  saved = new Map()
  // The agent's tools run in the review session's location and the panel's RPC in another; only storage is shared.
  agent = new Findings(new DraftStore(storage(saved)), 1_000)
  panel = new Findings(new DraftStore(storage(saved)), 1_000)
  prompt = vi.fn(async () => ({}))
  await new DraftStore(storage(saved)).put(base)
  await agent.add("ses_1", finding)
  await agent.add("ses_1", { ...finding, line: 3, severity: "blocker" })
  await agent.setVerdict("ses_1", "REQUEST_CHANGES", "Fix it.")
})

describe("line comments", () => {
  it("hands the marked lines to the agent, relative to the worktree", async () => {
    await triage(panel, prompt).addLineComments({
      sessionID: "ses_1",
      comments: [
        {
          path: `${base.worktree}/src/app.ts`,
          line: 3,
          startLine: 2,
          side: "RIGHT",
          startSide: "RIGHT",
          note: "Leaks?",
        },
        { path: "src/old.ts", line: 4, side: "LEFT", note: "" },
      ],
    })

    const text = prompt.mock.calls[0]?.[0].text ?? ""
    expect(text).toContain("- `src/app.ts:2-3` on the new side (RIGHT): Leaks?")
    expect(text).toContain("- `src/old.ts:4` on the old side (LEFT)\n")
    expect(text).toContain("review_add_finding")
  })

  it("refuses once the review is posted", async () => {
    await new DraftStore(storage(saved)).update(base.key, (draft) => {
      draft.status = "posted"
    })

    await expect(
      triage(panel, prompt).addLineComments({
        sessionID: "ses_1",
        comments: [{ path: "src/app.ts", line: 2, side: "RIGHT", note: "" }],
      }),
    ).rejects.toThrow(/already posted/)
    expect(prompt).not.toHaveBeenCalled()
  })
})

describe("panel triage", () => {
  it("records the user's decision where the agent's next finding sees it", async () => {
    expect(nextFinding(await agent.draftForSession("ses_1"))?.id).toBe(2)

    const { draft } = await triage(panel, prompt).decide({ sessionID: "ses_1", id: 2, decision: "drop" })

    expect(draft.findings.find((entry) => entry.id === 2)?.decision).toBe("drop")
    expect(nextFinding(await agent.draftForSession("ses_1"))?.id).toBe(1)
  })

  it("keeps a finding the user rewrote, unlike an agent edit", async () => {
    const { draft } = await triage(panel, prompt).edit({ sessionID: "ses_1", id: 1, body: "Call it `total`." })

    expect(draft.findings.find((entry) => entry.id === 1)).toMatchObject({
      body: "Call it `total`.",
      line: 2,
      decision: "keep",
    })
  })

  it("reads a closing suggestion block from the user's rewrite, and drops one they deleted", async () => {
    const actions = triage(panel, prompt)
    const text = "Use a constant.\n\n```suggestion\nconst b = LIMIT\n```"

    const { draft } = await actions.edit({ sessionID: "ses_1", id: 1, body: text })
    expect(draft.findings.find((entry) => entry.id === 1)).toMatchObject({
      body: "Use a constant.",
      suggestion: "const b = LIMIT",
    })

    const cleared = (await actions.edit({ sessionID: "ses_1", id: 1, body: "Use a constant." })).draft
    expect(cleared.findings.find((entry) => entry.id === 1)).not.toHaveProperty("suggestion")
    await expect(actions.edit({ sessionID: "ses_1", id: 1, body: "```suggestion\nx\n```" })).rejects.toThrow(
      /comment above/,
    )
  })

  it("asks the agent about one finding in the review session", async () => {
    await triage(panel, prompt).ask({ sessionID: "ses_1", id: 2 })

    expect(prompt).toHaveBeenCalledWith({ sessionID: "ses_1", text: "Explain finding #2" })
  })

  it("applies the same rules as the agent's tools", async () => {
    const actions = triage(panel, prompt)

    await expect(actions.decide({ sessionID: "ses_other", id: 1, decision: "keep" })).rejects.toThrow(
      /not a review session/,
    )
    await expect(actions.ask({ sessionID: "ses_1", id: 9 })).rejects.toThrow(/no finding #9/)
    expect(prompt).not.toHaveBeenCalled()

    saved.set(base.key, { ...(saved.get(base.key) as ReviewDraft), status: "posted" })
    await expect(actions.edit({ sessionID: "ses_1", id: 1, body: "Late." })).rejects.toThrow(/already posted/)
  })
})

describe("agent suggestions", () => {
  it("records a suggestion on new lines", async () => {
    const added = await agent.add("ses_1", { ...finding, line: 3, startLine: 2, suggestion: "const b = 2, c = 3" })

    expect(added.suggestion).toBe("const b = 2, c = 3")
    expect((await agent.update("ses_1", added.id, { body: "Merge them." })).suggestion).toBe("const b = 2, c = 3")
    expect(await agent.update("ses_1", added.id, { suggestion: null })).not.toHaveProperty("suggestion")
  })

  it("rejects a suggestion on removed lines, or one written into the body", async () => {
    await expect(agent.add("ses_1", { ...finding, line: 1, side: "LEFT", suggestion: "x" })).rejects.toThrow(
      /side RIGHT/,
    )
    await expect(agent.add("ses_1", { ...finding, body: "Do this:\n```suggestion\nx\n```" })).rejects.toThrow(
      /in `suggestion`/,
    )
    await expect(agent.update("ses_1", 1, { side: "LEFT", line: 1, suggestion: "x" })).rejects.toThrow(/side RIGHT/)
  })
})

describe("review tool scope", () => {
  const registered = () => {
    const names: string[] = []
    const editor = {
      namespace: vi.fn(),
      add: (tool: { name: string; options?: { namespace?: string; codemode?: boolean } }) => {
        expect(tool.options).toMatchObject({ namespace: "review", codemode: false })
        names.push(`${tool.options?.namespace}_${tool.name}`)
      },
    }
    addReviewTools(editor as unknown as ToolEditor, agent)
    return names
  }

  it("registers the six review tools as direct tools", () => {
    expect(registered().sort()).toEqual([
      "review_add_finding",
      "review_decide",
      "review_get_draft",
      "review_next_finding",
      "review_set_verdict",
      "review_update_finding",
    ])
  })

  it("takes long fields nested, so the TUI's tool row shows only short arguments", async () => {
    const tools = new Map<string, (input: unknown, context: { sessionID: string }) => Promise<{ content: string }>>()
    const editor = {
      namespace: vi.fn(),
      add: (tool: { name: string; execute: never }) => tools.set(tool.name, tool.execute),
    }
    addReviewTools(editor as unknown as ToolEditor, agent)
    const context = { sessionID: "ses_1" }

    await expect(tools.get("add_finding")?.(finding, context)).rejects.toThrow(/finding/)
    expect((await tools.get("add_finding")?.({ finding }, context))?.content).toMatch(/^Recorded #3 src\/app\.ts:2/)
    expect((await tools.get("update_finding")?.({ id: 3, changes: { body: "Shorter." } }, context))?.content).toMatch(
      /^Updated #3/,
    )
    expect(
      (await tools.get("set_verdict")?.({ review: { verdict: "COMMENT", summary: "Nits only." } }, context))?.content,
    ).toMatch(/^Verdict COMMENT/)
  })

  it("hides only the review tools", () => {
    const tools = Object.fromEntries(["read", "question", "execute", ...registered()].map((name) => [name, {}]))

    hideReviewTools(tools)

    expect(Object.keys(tools)).toEqual(["read", "question", "execute"])
  })
})
