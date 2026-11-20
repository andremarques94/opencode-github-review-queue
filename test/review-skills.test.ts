import type { Plugin } from "@opencode/plugin"
import type { ToolEditor } from "@opencode/plugin/promise/tool"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ReviewDraft } from "../src/domain/review-draft.js"
import { nextStep, reviewInstructions } from "../src/server/review/agent/instructions.js"
import { addSkillTools, waitForSkillSelection } from "../src/server/review/agent/skill-tools.js"
import { DraftStore } from "../src/server/review/draft-store.js"
import { watchSkillForms } from "../src/server/review/skill-events.js"
import { ReviewSkills, type SkillSelectionHost } from "../src/server/review/skills.js"
import { skillPickerForm } from "../src/shared/review/skill-picker.js"
import type { SkillPicker } from "../src/shared/rpc.js"
import { serveGuiSkillPickers } from "../src/ui/gui/actions/skill-picker.js"
import { serveTuiSkillPickers } from "../src/ui/tui/actions/skill-picker.js"

const tuiPicker = vi.hoisted(() => ({ open: vi.fn() }))
vi.mock("../src/ui/tui/components/skill-picker-dialog.js", () => ({ openSkillPicker: tuiPicker.open }))

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
  tuiPicker.open.mockReset()
})

function answer(request: SkillPicker, selected: unknown = ["testing"]) {
  expect(skills.claim(request.id)).toBe(true)
  skills.created({ id: "form_1", sessionID: request.sessionID, metadata: { reviewSkillPicker: request.id } })
  skills.answered("form_1", request.sessionID, selected)
}

const select = (recommended = ["security"]) =>
  skills.select({ sessionID: base.sessionID, recommended, tool, registry, host, signal: controller.signal })

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
      expect(form.fields[0]).toMatchObject({ type: "boolean", title: "Continue without skills", default: false })
      expect(form.fields[1]).toMatchObject({
        type: "multiselect",
        default: ["security"],
        custom: false,
        minItems: 0,
        required: false,
      })
      expect(form.fields[1].options.map((option) => option.value)).toEqual(["security", "frontend", "testing"])
      expect(form.fields[1].options[0]?.label).toContain("(Recommended)")
      expect(form.fields[1].options[1]?.description).toBe("Review interfaces")
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

  it("continues with no skills when the native UI omits an emptied multiselect", async () => {
    host.open = vi.fn(async (request) => {
      skills.claim(request.id)
      skills.created({ id: "form_1", sessionID: request.sessionID, metadata: { reviewSkillPicker: request.id } })
      skills.answered("form_1", request.sessionID, undefined, false)
    })
    expect(await select()).toEqual({ ids: [], content: [] })
    expect(host.load).not.toHaveBeenCalled()
    expect((await store.get(base.key))?.skillIDs).toEqual([])
  })

  it("lets Continue without skills override every checked recommendation", async () => {
    host.open = vi.fn(async (request) => {
      skills.claim(request.id)
      skills.created({ id: "form_1", sessionID: request.sessionID, metadata: { reviewSkillPicker: request.id } })
      skills.answered("form_1", request.sessionID, ["security", "testing"], true)
    })
    expect(await select()).toEqual({ ids: [], content: [] })
    expect(host.load).not.toHaveBeenCalled()
    expect((await store.get(base.key))?.skillIDs).toEqual([])
    await select()
    expect(host.open).toHaveBeenCalledOnce()
  })

  it("continues without a form when no skills are installed", async () => {
    list.mockResolvedValue({ data: [] })
    expect(await select([])).toEqual({
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
    await expect(select(["invented"])).rejects.toThrow(/unavailable/)
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

  it("fails visibly if no UI opens the form instead of waiting indefinitely", async () => {
    vi.useFakeTimers()
    try {
      const pending = select()
      const rejected = expect(pending).rejects.toThrow(/could not be opened in a connected UI/)
      await vi.advanceTimersByTimeAsync(0)
      expect(skills.requests()).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(30_000)
      await rejected
      expect(host.load).not.toHaveBeenCalled()
      expect(skills.requests()).toEqual([])
      expect(host.close).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it("does not time out while the user is choosing in an opened form", async () => {
    vi.useFakeTimers()
    try {
      host.open = vi.fn(async (request) => {
        skills.claim(request.id)
        skills.created({ id: "form_1", sessionID: request.sessionID, metadata: { reviewSkillPicker: request.id } })
      })
      const pending = select()
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(skills.requests()).toHaveLength(1)
      skills.answered("form_1", base.sessionID, [])
      expect(await pending).toEqual({ ids: [], content: [] })
    } finally {
      vi.useRealTimers()
    }
  })

  it("accepts an empty selection from the claimed TUI dialog", async () => {
    host.open = async (request) => {
      expect(skills.claim(request.id)).toBe(true)
      skills.answer(request.id, [])
    }
    expect(await select()).toEqual({ ids: [], content: [] })
    expect(host.load).not.toHaveBeenCalled()
    expect((await store.get(base.key))?.skillIDs).toEqual([])
  })

  it("does not accept an unclaimed dialog answer or let it bypass a native form", async () => {
    host.open = async (request) => {
      skills.answer(request.id, ["security"])
      expect(skills.claim(request.id)).toBe(true)
      skills.created({ id: "form_1", sessionID: request.sessionID, metadata: { reviewSkillPicker: request.id } })
      skills.answer(request.id, ["security"])
      skills.answered("form_1", request.sessionID, ["testing"])
    }
    expect((await select()).ids).toEqual(["testing"])
  })

  it("does not treat dismissing the TUI dialog as selecting none", async () => {
    host.open = async (request) => {
      skills.claim(request.id)
      skills.answer(request.id, null)
    }
    await expect(select()).rejects.toThrow(/cancelled/)
    expect((await store.get(base.key))?.skillIDs).toBeUndefined()
  })

  it.each([false, true])("ends an opened picker when the form-event stream ends (throws=%s)", async (throws) => {
    host.open = async (request) => {
      skills.claim(request.id)
      skills.created({ id: "form_1", sessionID: request.sessionID, metadata: { reviewSkillPicker: request.id } })
      await watchSkillForms(
        skills,
        {
          subscribe: async function* () {
            yield {
              type: "form.created",
              data: {
                form: { id: "form_1", sessionID: request.sessionID, metadata: { reviewSkillPicker: request.id } },
              },
            }
            if (throws) {
              throw new Error("Disconnected")
            }
          },
        } as never,
        controller.signal,
      )
    }
    await expect(select()).rejects.toThrow(/connection to review skill forms was lost/)
    expect(host.close).toHaveBeenCalledOnce()
    expect(host.load).not.toHaveBeenCalled()
    await expect(select()).rejects.toThrow(/Reload the plugin/)
  })
})

describe.each([
  ["Desktop", serveGuiSkillPickers],
  ["TUI", serveTuiSkillPickers],
] as const)("%s cross-location skill picker", (_name, serve) => {
  function connect(answerSelection = true) {
    // Local plugin modules are isolated per location, even though their draft storage is shared.
    const defaultLocation = new ReviewSkills(store)
    const listeners = new Map<string, (event: { data: SkillPicker }) => void>()
    type RpcOptions = { location?: { directory?: string } } | undefined
    const at = (options: RpcOptions) => (options?.location?.directory === base.worktree ? skills : defaultLocation)
    const rpc = {
      skillPickers: vi.fn(async (_input: unknown, options?: RpcOptions) => ({ requests: at(options).requests() })),
      claimSkillPicker: vi.fn(async (input: { id: string }, options?: RpcOptions) => ({
        claimed: at(options).claim(input.id),
      })),
      failSkillPicker: vi.fn(async (input: { id: string; message: string }, options?: RpcOptions) => {
        at(options).fail(input.id, input.message)
        return {}
      }),
      answerSkillPicker: vi.fn(async (input: { id: string; skills: string[] | null }, options?: RpcOptions) => {
        at(options).answer(input.id, input.skills)
      }),
      events: {
        on: (name: string, callback: (event: { data: SkillPicker }) => void) => {
          listeners.set(name, callback)
          return () => listeners.delete(name)
        },
      },
    }
    const forms = {
      create: vi.fn(async (input: ReturnType<typeof skillPickerForm>) => {
        skills.created({ id: "form_1", sessionID: input.sessionID, metadata: input.metadata })
        if (answerSelection) {
          skills.answered("form_1", input.sessionID, ["testing"])
        }
        return { id: "form_1" }
      }),
      list: vi.fn(async () => []),
      cancel: vi.fn(async () => {}),
    }
    const notify = vi.fn()
    tuiPicker.open.mockImplementation((_context, _request, submit) => {
      if (answerSelection) {
        void submit(["testing"])
      }
      return async () => {}
    })
    const connection = serve({
      client: { rpc: () => rpc, session: { form: forms } },
      toast: { show: notify },
      ui: { toast: { show: notify } },
    } as never)
    host.open = async (request) => {
      expect(defaultLocation.claim(request.id)).toBe(false)
      listeners.get("skillPicker")?.({ data: request })
    }
    host.close = async (request) => {
      listeners.get("closeSkillPicker")?.({ data: request as SkillPicker })
    }
    return { connection, rpc, forms, notify }
  }

  it("routes the claim to the location that owns the request and displays every skill", async () => {
    const { connection, rpc, forms, notify } = connect()
    try {
      expect((await select()).ids).toEqual(["testing"])
      expect(rpc.claimSkillPicker).toHaveBeenCalledWith(
        { id: expect.any(String) },
        { location: { directory: base.worktree } },
      )
      const request = skills.requests()[0]
      expect(request).toBeUndefined()
      const field =
        _name === "Desktop"
          ? forms.create.mock.calls[0]?.[0].fields[1]
          : skillPickerForm(tuiPicker.open.mock.calls[0]?.[1]).fields[1]
      expect(field?.default).toEqual(["security"])
      expect(field?.options.map((option) => option.value)).toEqual(["security", "frontend", "testing"])
      expect(notify).not.toHaveBeenCalled()
    } finally {
      connection.dispose()
    }
  })

  it("reports form creation errors to the owning location instead of leaving the tool hanging", async () => {
    const { connection, rpc, forms } = connect()
    forms.create.mockRejectedValue(new Error("Could not render"))
    tuiPicker.open.mockImplementation(() => {
      throw new Error("Could not render")
    })
    try {
      await expect(select()).rejects.toThrow("Could not render")
      expect(rpc.failSkillPicker).toHaveBeenCalledWith(
        { id: expect.any(String), message: "Could not render" },
        { location: { directory: base.worktree } },
      )
      expect(host.load).not.toHaveBeenCalled()
    } finally {
      connection.dispose()
    }
  })

  it("recovers a pending request after the UI misses its event", async () => {
    const { connection, rpc, forms } = connect()
    host.open = vi.fn(async () => {})
    const pending = select()
    try {
      await vi.waitFor(() => expect(skills.requests()).toHaveLength(1))
      await connection.sync(base.worktree)
      expect((await pending).ids).toEqual(["testing"])
      expect(rpc.skillPickers).toHaveBeenCalledWith({}, { location: { directory: base.worktree } })
      expect(_name === "Desktop" ? forms.create : tuiPicker.open).toHaveBeenCalledOnce()
    } finally {
      controller.abort()
      connection.dispose()
    }
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
    const toolList = vi.fn(async () => [{ id: "skill", execute }])
    addSkillTools(
      editor as unknown as ToolEditor,
      skills,
      { skill: registry, permission, tool: { list: toolList } } as never,
      {
        open: async (request) => answer(request),
        close: host.close,
      },
      controller.signal,
    )
    const context = { sessionID: base.sessionID, ...tool, agent: "build", signal: controller.signal }
    expect(toolList).not.toHaveBeenCalled()
    const result = await registered.get("select_skills")?.execute({ recommended: ["security"] }, context as never)
    expect(execute).toHaveBeenCalledWith({ id: "testing" }, { ...context, signal: expect.any(AbortSignal) })
    expect(permission.assert).toHaveBeenCalledWith(expect.objectContaining({ action: "question" }))
    expect(result?.content).toContain("Full skill instructions and resource paths")
    expect(result?.content).toContain('User-confirmed skills: ["testing"]')
    expect(toolList).toHaveBeenCalledOnce()
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
