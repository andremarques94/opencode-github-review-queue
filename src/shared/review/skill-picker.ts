import { errorMessage, type SkillPicker, type SkillPickerTarget } from "../rpc.js"

export function skillPickerForm(request: SkillPicker) {
  return {
    sessionID: request.sessionID,
    title: "Skills for this review",
    // OpenCode 2.3's question dock ignores field defaults. Its generic form dock uses this kind and honors them.
    metadata: { kind: "mcp-elicitation", reviewSkillPicker: request.id, tool: request.tool },
    fields: [
      {
        key: "withoutSkills",
        type: "boolean",
        title: "Continue without skills",
        description: "Skip all skills, including any checked recommendations below.",
        default: false,
        required: false,
      },
      {
        key: "skills",
        type: "multiselect",
        title: "Review skills",
        description: "Suggested skills are selected. Toggle any skill, or clear all and submit to continue with none.",
        required: false,
        custom: false,
        minItems: 0,
        default: request.skills.filter((skill) => skill.recommended).map((skill) => skill.id),
        options: orderedSkills(request).map((skill) => ({
          value: skill.id,
          label: `${skill.name} (${skill.id})${skill.recommended ? " (Recommended)" : ""}`,
          ...(skill.description ? { description: skill.description } : {}),
        })),
      },
    ],
  } as const
}

/** Recommended skills first, then by name. */
export const orderedSkills = (request: SkillPicker) =>
  request.skills.toSorted((a, b) => Number(b.recommended) - Number(a.recommended) || a.name.localeCompare(b.name))

export type SkillPickerLocation = { location: { directory: string } }
const at = (target: SkillPickerTarget): SkillPickerLocation => ({ location: { directory: target.directory } })

/** The part of the plugin's RPC client the picker uses. */
export type SkillPickerRpc = {
  skillPickers(input: Record<string, never>, options?: SkillPickerLocation): Promise<{ requests: SkillPicker[] }>
  claimSkillPicker(input: { id: string }, options: SkillPickerLocation): Promise<{ claimed: boolean }>
  failSkillPicker(input: { id: string; message: string }, options: SkillPickerLocation): Promise<unknown>
  answerSkillPicker(input: { id: string; skills: string[] | null }, options: SkillPickerLocation): Promise<unknown>
  events: {
    on(name: "skillPicker", listener: (event: { data: SkillPicker }) => void): () => void
    on(name: "closeSkillPicker", listener: (event: { data: SkillPickerTarget }) => void): () => void
  }
}

export type SkillPickerForms = {
  create(input: ReturnType<typeof skillPickerForm>): Promise<{ id: string }>
  list(input: { sessionID: string }): Promise<readonly { id: string; metadata?: Record<string, unknown> | undefined }[]>
  cancel(input: { sessionID: string; formID: string }): Promise<unknown>
}

export type CloseSkillPicker = () => Promise<unknown>

/** How one UI shows a picker it claimed. */
export type SkillPickerView = {
  /** A native form survives this client; a private dialog does not. */
  retainOnDispose?: boolean
  /** Shows the picker; `answer` reports a choice made outside a native form (`null` dismisses). */
  show(request: SkillPicker, answer: (skills: string[] | null) => Promise<unknown>): Promise<CloseSkillPicker>
  /** Closes a native form that a client which has since gone away opened. */
  dismiss(request: SkillPickerTarget): Promise<unknown>
  notify(message: string): void
}

/** Shows the picker as OpenCode's native form, which every connected client renders and can answer. */
export function formView(forms: () => SkillPickerForms, notify: (message: string) => void): SkillPickerView {
  return {
    retainOnDispose: true,
    async show(request) {
      const form = await forms().create(skillPickerForm(request))
      return () => forms().cancel({ sessionID: request.sessionID, formID: form.id })
    },
    dismiss: (request) => dismissForms(forms(), request),
    notify,
  }
}

export async function dismissForms(forms: SkillPickerForms, request: SkillPickerTarget): Promise<void> {
  const open = await forms.list({ sessionID: request.sessionID })
  await Promise.all(
    open
      .filter((form) => form.metadata?.reviewSkillPicker === request.id)
      .map((form) => forms.cancel({ sessionID: request.sessionID, formID: form.id })),
  )
}

/** One client claims each request, so only one picker opens, wherever the review session runs. */
export function connectSkillPickers(rpc: () => SkillPickerRpc, view: SkillPickerView) {
  let disposed = false
  const clientClosed = () => disposed && !view.retainOnDispose
  const closing = new Set<string>()
  const opening = new Set<string>()
  const shown = new Map<string, CloseSkillPicker>()
  const owned = new Map<string, SkillPicker>()
  const failed = (error: unknown) => errorMessage(error) ?? "Could not open the review skill picker."
  const open = async (request: SkillPicker) => {
    if (disposed || opening.has(request.id) || shown.has(request.id)) {
      return
    }
    opening.add(request.id)
    try {
      if (!(await rpc().claimSkillPicker({ id: request.id }, at(request))).claimed) {
        return
      }
      owned.set(request.id, request)
      if (clientClosed()) {
        await rpc().failSkillPicker({ id: request.id, message: "The skill picker UI closed. Try again." }, at(request))
        return
      }
      const close = await view.show(request, (skills) =>
        rpc().answerSkillPicker({ id: request.id, skills }, at(request)),
      )
      shown.set(request.id, close)
      if (closing.has(request.id) || clientClosed()) {
        await closeShown(request.id)
      }
    } catch (error) {
      owned.delete(request.id)
      await rpc()
        .failSkillPicker({ id: request.id, message: failed(error) }, at(request))
        .catch(() => undefined)
      view.notify(failed(error))
    } finally {
      opening.delete(request.id)
      closing.delete(request.id)
    }
  }
  // Closing a picker the user already answered fails harmlessly; nothing is left to report.
  const closeShown = async (id: string) => {
    const close = shown.get(id)
    shown.delete(id)
    owned.delete(id)
    await close?.().catch(() => undefined)
  }
  const close = async (request: SkillPickerTarget) => {
    if (opening.has(request.id)) {
      closing.add(request.id)
      return
    }
    if (shown.has(request.id)) {
      await closeShown(request.id)
      return
    }
    await view.dismiss(request).catch(() => undefined)
  }
  const stopRequest = rpc().events.on("skillPicker", (event) => void open(event.data))
  const stopClose = rpc().events.on("closeSkillPicker", (event) => void close(event.data))
  const sync = async (directory?: string) => {
    if (disposed) {
      return
    }
    try {
      const { requests } = await rpc().skillPickers({}, directory ? { location: { directory } } : undefined)
      await Promise.all(requests.map(open))
    } catch (error) {
      view.notify(failed(error))
    }
  }
  void sync()
  return {
    sync,
    dispose: () => {
      disposed = true
      stopRequest()
      stopClose()
      if (!view.retainOnDispose) {
        for (const request of owned.values()) {
          void rpc()
            .failSkillPicker({ id: request.id, message: "The skill picker UI closed. Try again." }, at(request))
            .catch(() => undefined)
          void closeShown(request.id)
        }
      }
    },
  }
}
