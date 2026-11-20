import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ReviewPreview } from "../src/shared/review/preview.js"
import { confirmPost } from "../src/ui/tui/components/post-review-dialog.js"

const editor = vi.hoisted(() => ({ edit: vi.fn() }))
vi.mock("../src/ui/tui/components/findings/edit-finding-dialog.js", () => ({ editFindingBody: editor.edit }))
vi.mock("../src/ui/tui/components/markdown-text.js", () => ({ MarkdownText: vi.fn() }))
vi.mock("@opencode/plugin/tui", () => ({ usePlugin: vi.fn() }))
vi.mock("@opentui/solid", () => ({ useTerminalDimensions: vi.fn() }))

const preview: ReviewPreview = {
  title: "Post review?",
  reference: "acme/api#7",
  verdict: "Comment",
  event: "COMMENT",
  ownPullRequest: false,
  summary: "Original.",
  comments: [],
}

type Element = { props: Record<string, unknown>; children: Element[] }

beforeEach(() => {
  editor.edit.mockReset()
  // Capture JSX props, not a native render. This suite exercises dialog callbacks under Node.
  vi.stubGlobal("React", {
    createElement: (_type: unknown, props: Record<string, unknown>, ...children: Element[]) => ({ props, children }),
  })
})
afterEach(() => vi.unstubAllGlobals())

function fixture() {
  let current: { preview: ReviewPreview; decide(action: string): void } | undefined
  let closed = () => {}
  const dialog = {
    show: vi.fn((draw: () => Element, onClose: () => void) => {
      closed = onClose
      current = draw().props as typeof current
    }),
    set: vi.fn(),
    clear: vi.fn(() => closed()),
    select: vi.fn(async (_input: unknown): Promise<string | undefined> => "APPROVE"),
  }
  const context = { ui: { dialog } }
  return { context, dialog, current: () => current, decide: (action: string) => current?.decide(action) }
}

describe("TUI final review editor callbacks", () => {
  it("returns the original proposal when posted without edits", async () => {
    const f = fixture()
    const pending = confirmPost(f.context as never, preview)
    f.decide("post")
    expect(await pending).toEqual({ verdict: "COMMENT", summary: "Original." })
  })

  it("edits both fields, reopens the updated preview, and waits for explicit posting", async () => {
    const f = fixture()
    editor.edit.mockResolvedValue("My comment.\n\nExactly this.")
    const pending = confirmPost(f.context as never, preview)
    f.decide("edit")
    await vi.waitFor(() => expect(f.dialog.show).toHaveBeenCalledTimes(2))
    expect(f.current()?.preview.summary).toBe("My comment.\n\nExactly this.")
    f.decide("state")
    await vi.waitFor(() => expect(f.dialog.show).toHaveBeenCalledTimes(3))
    expect(f.current()?.preview).toMatchObject({
      event: "APPROVE",
      verdict: "Approve",
      summary: "My comment.\n\nExactly this.",
    })
    f.decide("post")
    expect(await pending).toEqual({ verdict: "APPROVE", summary: "My comment.\n\nExactly this." })
  })

  it("keeps the previous values when the text editor or state picker is dismissed", async () => {
    const f = fixture()
    editor.edit.mockResolvedValue(undefined)
    f.dialog.select.mockResolvedValue(undefined)
    const pending = confirmPost(f.context as never, preview)
    f.decide("edit")
    await vi.waitFor(() => expect(f.dialog.show).toHaveBeenCalledTimes(2))
    f.decide("state")
    await vi.waitFor(() => expect(f.dialog.show).toHaveBeenCalledTimes(3))
    f.decide("post")
    expect(await pending).toEqual({ verdict: "COMMENT", summary: "Original." })
  })

  it("allows clearing the final comment for an approval", async () => {
    const f = fixture()
    editor.edit.mockResolvedValue("")
    const pending = confirmPost(f.context as never, { ...preview, event: "APPROVE", verdict: "Approve" })
    f.decide("edit")
    await vi.waitFor(() => expect(f.dialog.show).toHaveBeenCalledTimes(2))
    expect(editor.edit).toHaveBeenCalledWith(f.context, expect.objectContaining({ allowEmpty: true }))
    f.decide("post")
    expect(await pending).toEqual({ verdict: "APPROVE", summary: "" })
  })

  it("offers only Comment for the user's own pull request", async () => {
    const f = fixture()
    f.dialog.select.mockResolvedValue(undefined)
    const pending = confirmPost(f.context as never, { ...preview, ownPullRequest: true })
    f.decide("state")
    await vi.waitFor(() => expect(f.dialog.show).toHaveBeenCalledTimes(2))
    expect(f.dialog.select).toHaveBeenCalledWith({
      title: "Review state",
      current: "COMMENT",
      options: [{ title: "Comment", value: "COMMENT" }],
    })
    f.decide("cancel")
    expect(await pending).toBeUndefined()
  })

  it("does not post when the preview is closed externally", async () => {
    const f = fixture()
    const pending = confirmPost(f.context as never, preview)
    f.dialog.clear()
    expect(await pending).toBeUndefined()
  })
})

describe("TUI multiline editor callbacks", () => {
  it.each([
    { allowEmpty: true, expected: "" },
    { allowEmpty: false, expected: undefined },
  ])("handles an empty saved comment (allowEmpty=$allowEmpty)", async ({ allowEmpty, expected }) => {
    const { editFindingBody } = await vi.importActual<
      typeof import("../src/ui/tui/components/findings/edit-finding-dialog.js")
    >("../src/ui/tui/components/findings/edit-finding-dialog.js")
    let node: Element | undefined
    let closed = () => {}
    const dialog = {
      show: (draw: () => Element, onClose: () => void) => {
        node = draw()
        closed = onClose
      },
      set: vi.fn(),
      clear: () => closed(),
    }
    const context = { theme: { text: {}, background: { raised: {} } }, ui: { dialog } }
    const pending = editFindingBody(context as never, { title: "Edit comment", body: "Original.", allowEmpty })
    const textarea = node?.children[1]
    const ref = textarea?.props.ref as (value: { plainText: string }) => void
    ref({ plainText: "" })
    const submit = textarea?.props.onSubmit as () => void
    submit()
    dialog.clear()
    expect(await pending).toBe(expected)
  })
})
