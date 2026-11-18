import { describe, expect, it, vi } from "vitest"
import { connectSkillPickers, type SkillPickerHost, type skillPickerForm } from "../src/shared/review/skill-picker.js"
import type { SkillPicker } from "../src/shared/rpc.js"

const request: SkillPicker = {
  id: "picker_1",
  sessionID: "ses_1",
  tool: { messageID: "msg_1", id: "call_1" },
  skills: [{ id: "security", name: "Security", recommended: true }],
}

function createFixture() {
  let onRequest = (_request: SkillPicker) => {}
  let onClose = (_request: Pick<SkillPicker, "id" | "sessionID">) => {}
  const stopRequest = vi.fn()
  const stopClose = vi.fn()
  const host = {
    requests: vi.fn(async () => ({ requests: [] })),
    claim: vi.fn(async () => ({ claimed: true })),
    fail: vi.fn(async () => {}),
    onRequest: (callback: typeof onRequest) => {
      onRequest = callback
      return stopRequest
    },
    onClose: (callback: typeof onClose) => {
      onClose = callback
      return stopClose
    },
    create: vi.fn(async (_input: ReturnType<typeof skillPickerForm>) => ({ id: "form_1" })),
    forms: vi.fn(async () => [{ id: "form_1", metadata: { reviewSkillPicker: request.id } }]),
    cancel: vi.fn(async () => {}),
    notify: vi.fn(),
  } satisfies SkillPickerHost
  return {
    host,
    request: () => onRequest(request),
    close: () => onClose(request),
    stopRequest,
    stopClose,
  }
}

describe("native skill picker bridge", () => {
  it("creates the native form with defaults and unsubscribes on unload", async () => {
    const fixture = createFixture()
    const stop = connectSkillPickers(fixture.host)
    fixture.request()
    await vi.waitFor(() => expect(fixture.host.create).toHaveBeenCalledOnce())
    expect(fixture.host.create.mock.calls[0]?.[0]).toMatchObject({
      sessionID: request.sessionID,
      fields: [{ type: "multiselect", default: ["security"] }],
    })
    stop()
    expect(fixture.stopRequest).toHaveBeenCalledOnce()
    expect(fixture.stopClose).toHaveBeenCalledOnce()
  })

  it("does not create a duplicate form when another client claimed the request", async () => {
    const { host, request } = createFixture()
    host.claim.mockResolvedValue({ claimed: false })
    const stop = connectSkillPickers(host)
    request()
    await vi.waitFor(() => expect(host.claim).toHaveBeenCalledOnce())
    expect(host.create).not.toHaveBeenCalled()
    stop()
  })

  it("cancels only the matching form when the tool stops", async () => {
    const { host, close } = createFixture()
    host.forms.mockResolvedValue([
      { id: "form_1", metadata: { reviewSkillPicker: request.id } },
      { id: "form_other", metadata: { reviewSkillPicker: "other" } },
    ])
    const stop = connectSkillPickers(host)
    close()
    await vi.waitFor(() => expect(host.cancel).toHaveBeenCalledWith(request.sessionID, "form_1"))
    expect(host.cancel).toHaveBeenCalledOnce()
    stop()
  })

  it("fails the waiting tool when form creation fails", async () => {
    const fixture = createFixture()
    fixture.host.create.mockRejectedValue(new Error("Disconnected"))
    const stop = connectSkillPickers(fixture.host)
    fixture.request()
    await vi.waitFor(() => expect(fixture.host.fail).toHaveBeenCalledWith(request.id, "Disconnected"))
    stop()
  })

  it("cancels a form whose creation finishes after the tool was stopped", async () => {
    const fixture = createFixture()
    let finish = (_form: { id: string }) => {}
    fixture.host.create.mockReturnValue(
      new Promise<{ id: string }>((resolve) => {
        finish = resolve
      }),
    )
    fixture.host.forms.mockResolvedValue([])
    const stop = connectSkillPickers(fixture.host)
    fixture.request()
    await vi.waitFor(() => expect(fixture.host.create).toHaveBeenCalledOnce())
    fixture.close()
    finish({ id: "form_late" })
    await vi.waitFor(() => expect(fixture.host.cancel).toHaveBeenCalledWith(request.sessionID, "form_late"))
    stop()
  })
})
