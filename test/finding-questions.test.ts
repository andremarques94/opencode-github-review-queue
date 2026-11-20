import { beforeEach, describe, expect, it, vi } from "vitest"
import { serveFindingQuestions } from "../src/ui/tui/actions/finding-questions.js"

const reactive = vi.hoisted(() => ({ effects: [] as (() => void)[], cleanups: [] as (() => void)[] }))
vi.mock("solid-js", () => ({
  createEffect: (run: () => void) => {
    reactive.effects.push(run)
    run()
  },
  onCleanup: (run: () => void) => reactive.cleanups.push(run),
}))

const finding = {
  id: "form_1",
  sessionID: "ses_1",
  metadata: { kind: "question" },
  fields: [
    {
      key: "q0",
      type: "string",
      title: "Finding #1",
      custom: true,
      options: ["Keep", "Edit wording", "Drop", "Explain", "Investigate"].map((value) => ({ value, label: value })),
    },
  ],
}

function fixture() {
  let pending = [finding]
  const select = vi.fn(async (_input: unknown): Promise<string | null | undefined> => "Keep")
  const forms = { reply: vi.fn(async () => {}), cancel: vi.fn(async () => {}) }
  const prompt = vi.fn(async (_input: unknown): Promise<string | undefined> => "Please investigate the caller")
  const clear = vi.fn()
  const context = {
    client: { session: { form: forms } },
    data: { session: { form: { list: () => pending } } },
    ui: {
      router: { current: () => ({ type: "session", sessionID: "ses_1" }) },
      dialog: { select, prompt, clear },
      toast: { show: vi.fn() },
    },
  }
  return {
    context,
    select,
    forms,
    prompt,
    clear,
    remove: () => {
      pending = []
      for (const effect of reactive.effects) {
        effect()
      }
    },
  }
}

beforeEach(() => {
  reactive.effects.length = 0
  reactive.cleanups.length = 0
})

describe("compact TUI finding questions", () => {
  it("offers all finding decisions in the scrollable selector and replies to the original form", async () => {
    const f = fixture()
    serveFindingQuestions(f.context as never)
    await vi.waitFor(() =>
      expect(f.forms.reply).toHaveBeenCalledWith({ sessionID: "ses_1", formID: "form_1", answer: { q0: "Keep" } }),
    )
    expect(f.select.mock.calls[0]?.[0]).toMatchObject({
      title: "Finding #1",
      options: [
        { title: "Keep" },
        { title: "Edit wording" },
        { title: "Drop" },
        { title: "Explain" },
        { title: "Investigate" },
        { title: "Type your own answer…" },
      ],
    })
  })

  it("preserves custom answers", async () => {
    const f = fixture()
    f.select.mockResolvedValue(null)
    serveFindingQuestions(f.context as never)
    await vi.waitFor(() =>
      expect(f.forms.reply).toHaveBeenCalledWith(
        expect.objectContaining({ answer: { q0: "Please investigate the caller" } }),
      ),
    )
    expect(f.prompt).toHaveBeenCalledOnce()
  })

  it("cancels the form when dismissed, without deciding for the user", async () => {
    const f = fixture()
    f.select.mockResolvedValue(undefined)
    serveFindingQuestions(f.context as never)
    await vi.waitFor(() => expect(f.forms.cancel).toHaveBeenCalledWith({ sessionID: "ses_1", formID: "form_1" }))
    expect(f.forms.reply).not.toHaveBeenCalled()
  })

  it("does not answer again if the review panel or another client already settled the form", async () => {
    const f = fixture()
    let choose = (_answer: string) => {}
    f.select.mockReturnValue(
      new Promise((resolve) => {
        choose = resolve
      }),
    )
    serveFindingQuestions(f.context as never)
    f.remove()
    choose("Keep")
    await Promise.resolve()
    expect(f.clear).toHaveBeenCalledOnce()
    expect(f.forms.reply).not.toHaveBeenCalled()
    expect(f.forms.cancel).not.toHaveBeenCalled()
  })

  it("does not answer on plugin unload", async () => {
    const f = fixture()
    let choose = (_answer: string) => {}
    f.select.mockReturnValue(
      new Promise((resolve) => {
        choose = resolve
      }),
    )
    serveFindingQuestions(f.context as never)
    for (const cleanup of reactive.cleanups) {
      cleanup()
    }
    choose("Drop")
    await Promise.resolve()
    expect(f.forms.reply).not.toHaveBeenCalled()
    expect(f.forms.cancel).not.toHaveBeenCalled()
  })
})
