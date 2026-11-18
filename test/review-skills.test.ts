import type { Plugin } from "@opencode/plugin"
import type { ToolEditor } from "@opencode/plugin/promise/tool"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ReviewDraft } from "../src/domain/review-draft.js"
import { nextStep, reviewInstructions } from "../src/server/review/agent/instructions.js"
import { addSkillTools, waitForSkillSelection } from "../src/server/review/agent/skill-tools.js"
import { DraftStore } from "../src/server/review/draft-store.js"
import { ReviewSkills, type SkillSelectionHost } from "../src/server/review/skills.js"
import { skillPickerForm } from "../src/shared/review/skill-picker.js"
import type { SkillPicker } from "../src/shared/rpc.js"

const base: ReviewDraft = {
  version: 1,
  key: "acme/api#7",
  repository: "acme/api",
  number: 7,
  title: "Update auth",
  headSha: "abc123",
  ownPullRequest: false,
  checkout: "/repos/acme/api",
  worktree: "/cache/worktrees/acme/api/pr-7",
  sessionID: "ses_review",
  status: "investigating",
  findings: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
}
const tool = { messageID: "msg_1", id: "call_1" }
const available = [
  { id: "security", name: "Security", description: "Review authentication", content: "Never expose tokens." },
  { id: "frontend", name: "Frontend", description: "Review interfaces", content: "Check keyboard access." },
  { id: "testing", name: "Testing", description: "Review tests", content: "Check failure paths." },
]

let store: DraftStore
let skills: ReviewSkills
let registry: Plugin.Context["skill"]
let list: ReturnType<typeof vi.fn>
let host: SkillSelectionHost
let controller: AbortController

beforeEach(async () => {
  const saved = new Map<string, unknown>()
  store = new DraftStore({
    get: async (key) => saved.get(key),
    list: async () => [...saved.values()],
    save: async (draft) => void saved.set(draft.key, draft),
    remove: async (key) => void saved.delete(key),
  })
  await store.put(base)
  skills = new ReviewSkills(store)
  list = vi.fn(async () => ({ data: available }))
  registry = { list } as unknown as Plugin.Context["skill"]
  host = {
    open: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    load: vi.fn(async (id) => `Loaded ${id}`),
  }
  controller = new AbortController()
})

function answer(request: SkillPicker, selected: unknown = ["testing"]) {
  expect(skills.claim(request.id)).toBe(true)
  skills.created({ id: "form_1", sessionID: request.sessionID, metadata: { reviewSkillPicker: request.id } })
  skills.answered("form_1", request.sessionID, selected)
}

const select = () => skills.select(base.sessionID, ["security"], tool, registry, host, controller.signal)

describe("review skills", () => {
  it("discovers skills in the review worktree without loading their contents", async () => {
    expect(await skills.list(base.sessionID, registry, controller.signal)).toEqual(
      available.map(({ content: _, ...skill }) => skill),
    )
    expect(list).toHaveBeenCalledWith({ location: { directory: base.worktree } }, { signal: controller.signal })
    expect(host.load).not.toHaveBeenCalled()
    await expect(skills.list("ses_other", registry, controller.signal)).rejects.toThrow(/active review session/)
  })

  it("offers every skill, preselects recommendations, and loads only the user's choices", async () => {
    host.open = vi.fn(async (request) => {
      const form = skillPickerForm(request)
      expect(form.metadata.tool).toEqual(tool)
      expect(form.metadata.kind).toBe("mcp-elicitation")
      expect(form.fields[0]).toMatchObject({ type: "multiselect", default: ["security"], custom: false, minItems: 0 })
      expect(form.fields[0].options.map((option) => option.value)).toEqual(["security", "frontend", "testing"])
      expect(form.fields[0].options[0]?.label).toContain("(Recommended)")
      expect(form.fields[0].options[1]?.description).toBe("Review interfaces")
      expect(host.load).not.toHaveBeenCalled()
      // The user removes the recommendation and adds two different skills.
      answer(request, ["frontend", "testing", "testing"])
    })
    expect(await select()).toEqual({ ids: ["frontend", "testing"], content: ["Loaded frontend", "Loaded testing"] })
    expect(host.load).toHaveBeenCalledTimes(2)
    expect(host.load).not.toHaveBeenCalledWith("security")
    expect((await store.get(base.key))?.skillIDs).toEqual(["frontend", "testing"])
    expect(skills.requests()).toEqual([])
    expect(host.close).toHaveBeenCalledOnce()
  })

  it("allows deselecting every skill and remembers the empty selection on resume", async () => {
    host.open = vi.fn(async (request) => answer(request, []))
    expect(await select()).toEqual({ ids: [], content: [] })
    expect(host.load).not.toHaveBeenCalled()
    expect((await store.get(base.key))?.skillIDs).toEqual([])
    await select()
    expect(host.open).toHaveBeenCalledOnce()
  })

  it("continues without a form when no skills are installed", async () => {
    list.mockResolvedValue({ data: [] })
    expect(await skills.select(base.sessionID, [], tool, registry, host, controller.signal)).toEqual({
      ids: [],
      content: [],
    })
    expect(host.open).not.toHaveBeenCalled()
    expect((await store.get(base.key))?.skillIDs).toEqual([])
  })

  it("never interprets cancellation as accepting defaults", async () => {
    host.open = vi.fn(async (request) => {
      skills.claim(request.id)
      skills.created({ id: "form_1", sessionID: base.sessionID, metadata: { reviewSkillPicker: request.id } })
      skills.cancelled("form_1", base.sessionID)
    })
    await expect(select()).rejects.toThrow(/cancelled/)
    expect(host.load).not.toHaveBeenCalled()
    expect((await store.get(base.key))?.skillIDs).toBeUndefined()
  })

  it("cleans up a stopped picker without loading skills", async () => {
    host.open = vi.fn(async () => controller.abort())
    await expect(select()).rejects.toThrow(/interrupted/)
    expect(skills.requests()).toEqual([])
    expect(host.close).toHaveBeenCalledOnce()
    expect(host.load).not.toHaveBeenCalled()
  })

  it("rejects invented recommendations and unoffered or malformed answers", async () => {
    await expect(skills.select(base.sessionID, ["invented"], tool, registry, host, controller.signal)).rejects.toThrow(
      /unavailable/,
    )
    expect(host.open).not.toHaveBeenCalled()
    for (const invalid of [["invented"], "security"]) {
      host.open = vi.fn(async (request) => answer(request, invalid))
      await expect(select()).rejects.toThrow(/skill picker returned/)
    }
    expect(host.load).not.toHaveBeenCalled()
  })

  it("matches the native form and session, and lets only one UI create it", async () => {
    host.open = vi.fn(async (request) => {
      expect(skills.requests()).toEqual([request])
      expect(skills.claim(request.id)).toBe(true)
      expect(skills.claim(request.id)).toBe(false)
      skills.created({ id: "form_other", sessionID: "ses_other", metadata: { reviewSkillPicker: request.id } })
      skills.answered("form_other", "ses_other", ["security"])
      skills.created({ id: "form_1", sessionID: base.sessionID, metadata: { reviewSkillPicker: request.id } })
      skills.answered("form_1", "ses_other", ["security"])
      skills.answered("form_1", base.sessionID, ["testing"])
    })
    expect((await select()).ids).toEqual(["testing"])
  })

  it("does not mark skills confirmed when loading fails or the review is reset", async () => {
    host.open = vi.fn(async (request) => answer(request))
    host.load = vi.fn(async () => {
      throw new Error("Permission denied")
    })
    await expect(select()).rejects.toThrow(/Permission denied/)
    expect((await store.get(base.key))?.skillIDs).toBeUndefined()
    host.load = vi.fn(async () => {
      await store.remove(base.key)
      return "Loaded testing"
    })
    await expect(select()).rejects.toThrow(/no longer exists/)
  })

  it("does not open duplicate pickers for concurrent tool calls", async () => {
    host.open = vi.fn(async (request) => {
      await expect(select()).rejects.toThrow(/already in progress/)
      answer(request)
    })
    expect((await select()).ids).toEqual(["testing"])
  })
})

describe("skill tool and instructions", () => {
  it("uses OpenCode's skill executor, preserving permissions and full skill context", async () => {
    const registered = new Map<string, { execute: (input: unknown, context: never) => Promise<{ content: string }> }>()
    const execute = vi.fn(async () => ({ content: "Full skill instructions and resource paths" }))
    const editor = {
      get: vi.fn(() => ({ execute })),
      add: (definition: { name: string; execute: never; options: unknown }) => {
        expect(definition.options).toEqual({ namespace: "review", codemode: false })
        registered.set(definition.name, definition)
      },
    }
    const permission = { assert: vi.fn(async () => {}) }
    addSkillTools(
      editor as unknown as ToolEditor,
      skills,
      { skill: registry, permission } as never,
      {
        open: async (request) => answer(request),
        close: host.close,
      },
      controller.signal,
    )
    const context = { sessionID: base.sessionID, ...tool, agent: "build", signal: controller.signal }
    const result = await registered.get("select_skills")?.execute({ recommended: ["security"] }, context as never)
    expect(execute).toHaveBeenCalledWith({ id: "testing" }, { ...context, signal: expect.any(AbortSignal) })
    expect(permission.assert).toHaveBeenCalledWith(expect.objectContaining({ action: "question" }))
    expect(result?.content).toContain("Full skill instructions and resource paths")
    expect(result?.content).toContain('User-confirmed skills: ["testing"]')
  })

  it("withholds skill loading and finding tools until the user has confirmed a selection", () => {
    const toolNames = [
      "read",
      "skill",
      "review_list_skills",
      "review_select_skills",
      "review_add_finding",
      "review_set_verdict",
    ]
    const tools = Object.fromEntries(toolNames.map((name) => [name, {}]))
    waitForSkillSelection(tools, base)
    expect(Object.keys(tools)).toEqual(["read", "review_list_skills", "review_select_skills"])
    const confirmed = Object.fromEntries(toolNames.map((name) => [name, {}]))
    waitForSkillSelection(confirmed, { ...base, skillIDs: [] })
    expect(Object.keys(confirmed)).toEqual(toolNames)
  })

  it("requires selection before investigation, but not again after confirmation", () => {
    const instructions = reviewInstructions(base, "main", "Guidelines")
    expect(instructions).toContain("review_list_skills")
    expect(instructions).toContain("review_select_skills")
    expect(instructions).toContain("do not load skills or record")
    expect(instructions).toContain("Cancellation is not consent")
    expect(nextStep(base)).toContain("Wait for the user's confirmed selection")
    expect(nextStep({ ...base, skillIDs: [] })).toContain("User-confirmed skills: []")
    expect(nextStep({ ...base, skillIDs: ["testing"] })).not.toContain("call review_list_skills")
  })
})
