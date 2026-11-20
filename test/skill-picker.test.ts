import { describe, expect, it, vi } from "vitest"
import { connectSkillPickers, formView, type skillPickerForm } from "../src/shared/review/skill-picker.js"
import type { SkillPicker, SkillPickerTarget } from "../src/shared/rpc.js"

const request: SkillPicker = {
  id: "picker_1",
  sessionID: "ses_1",
  directory: "/reviews/pr-1",
  tool: { messageID: "msg_1", id: "call_1" },
  skills: [{ id: "security", name: "Security", recommended: true }],
}

function createFixture() {
  let onRequest = (_request: SkillPicker) => {}
  let onClose = (_request: SkillPickerTarget) => {}
  const stopRequest = vi.fn()
  const stopClose = vi.fn()
  const host = {
    requests: vi.fn(async (_directory?: string): Promise<{ requests: SkillPicker[] }> => ({ requests: [] })),
    claim: vi.fn(async (_request: SkillPickerTarget) => ({ claimed: true })),
    fail: vi.fn(async (_request: SkillPickerTarget, _message: string) => {}),
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
    cancel: vi.fn(async (_sessionID: string, _formID: string) => {}),
    notify: vi.fn(),
  }
  return {
    host,
    request: () => onRequest(request),
    close: () => onClose(request),
    stopRequest,
    stopClose,
  }
}

function connect(host: ReturnType<typeof createFixture>["host"]) {
  return connectSkillPickers(
    () => ({
      skillPickers: (_input, options) => host.requests(options?.location.directory),
      claimSkillPicker: ({ id }, options) => host.claim({ ...request, id, directory: options.location.directory }),
      failSkillPicker: ({ id, message }, options) =>
        host.fail({ ...request, id, directory: options.location.directory }, message),
      answerSkillPicker: async () => {},
      events: {
        on: (name, callback) =>
          name === "skillPicker"
            ? host.onRequest((data) => callback({ data } as never))
            : host.onClose((data) => callback({ data } as never)),
      },
    }),
    formView(
      () => ({
        create: host.create,
        list: () => host.forms(),
        cancel: ({ sessionID, formID }) => host.cancel(sessionID, formID),
      }),
      host.notify,
    ),
  )
}

describe("native skill picker bridge", () => {
  it("creates the native form with defaults and unsubscribes on unload", async () => {
    const fixture = createFixture()
    const stop = connect(fixture.host)
    fixture.request()
    await vi.waitFor(() => expect(fixture.host.create).toHaveBeenCalledOnce())
    expect(fixture.host.create.mock.calls[0]?.[0]).toMatchObject({
      sessionID: request.sessionID,
      fields: [
        { type: "boolean", title: "Continue without skills", default: false },
        { type: "multiselect", default: ["security"], minItems: 0, required: false },
      ],
    })
    stop.dispose()
    expect(fixture.stopRequest).toHaveBeenCalledOnce()
    expect(fixture.stopClose).toHaveBeenCalledOnce()
  })

  it("does not create a duplicate form when another client claimed the request", async () => {
    const { host, request } = createFixture()
    host.claim.mockResolvedValue({ claimed: false })
    const stop = connect(host)
    request()
    await vi.waitFor(() => expect(host.claim).toHaveBeenCalledOnce())
    expect(host.create).not.toHaveBeenCalled()
    stop.dispose()
  })

  it("cancels only the matching form when the tool stops", async () => {
    const { host, close } = createFixture()
    host.forms.mockResolvedValue([
      { id: "form_1", metadata: { reviewSkillPicker: request.id } },
      { id: "form_other", metadata: { reviewSkillPicker: "other" } },
    ])
    const stop = connect(host)
    close()
    await vi.waitFor(() => expect(host.cancel).toHaveBeenCalledWith(request.sessionID, "form_1"))
    expect(host.cancel).toHaveBeenCalledOnce()
    stop.dispose()
  })

  it("fails the waiting tool when form creation fails", async () => {
    const fixture = createFixture()
    fixture.host.create.mockRejectedValue(new Error("Disconnected"))
    const stop = connect(fixture.host)
    fixture.request()
    await vi.waitFor(() => expect(fixture.host.fail).toHaveBeenCalledWith(request, "Disconnected"))
    stop.dispose()
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
    const stop = connect(fixture.host)
    fixture.request()
    await vi.waitFor(() => expect(fixture.host.create).toHaveBeenCalledOnce())
    fixture.close()
    finish({ id: "form_late" })
    await vi.waitFor(() => expect(fixture.host.cancel).toHaveBeenCalledWith(request.sessionID, "form_late"))
    stop.dispose()
  })

  it("recovers a missed request from the review worktree when its session is opened", async () => {
    const fixture = createFixture()
    const connection = connect(fixture.host)
    await vi.waitFor(() => expect(fixture.host.requests).toHaveBeenCalledOnce())
    fixture.host.requests.mockResolvedValue({ requests: [request] })
    await connection.sync(request.directory)
    expect(fixture.host.requests).toHaveBeenLastCalledWith(request.directory)
    expect(fixture.host.claim).toHaveBeenCalledWith(request)
    expect(fixture.host.create).toHaveBeenCalledOnce()
    connection.dispose()
  })

  it("creates exactly one form when two clients receive a request together", async () => {
    const first = createFixture()
    const second = createFixture()
    let claimed = false
    const claim = async () => {
      const alreadyClaimed = claimed
      claimed = true
      return { claimed: !alreadyClaimed }
    }
    first.host.claim.mockImplementation(claim)
    second.host.claim.mockImplementation(claim)
    const one = connect(first.host)
    const two = connect(second.host)
    first.request()
    second.request()
    await vi.waitFor(() => {
      expect(first.host.claim).toHaveBeenCalledOnce()
      expect(second.host.claim).toHaveBeenCalledOnce()
      expect(first.host.create.mock.calls.length + second.host.create.mock.calls.length).toBe(1)
    })
    one.dispose()
    two.dispose()
  })
})
