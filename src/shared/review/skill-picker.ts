import { errorMessage, type SkillPicker } from "../rpc.js"

export function skillPickerForm(request: SkillPicker) {
  return {
    sessionID: request.sessionID,
    title: "Skills for this review",
    // OpenCode 2.3's question dock ignores field defaults. Its generic form dock uses this kind and honors them.
    metadata: { kind: "mcp-elicitation", reviewSkillPicker: request.id, tool: request.tool },
    fields: [
      {
        key: "skills",
        type: "multiselect",
        title: "Review skills",
        description: "Suggested skills are selected. Toggle any skill on or off, or deselect all to use none.",
        custom: false,
        minItems: 0,
        default: request.skills.filter((skill) => skill.recommended).map((skill) => skill.id),
        options: request.skills
          .toSorted((a, b) => Number(b.recommended) - Number(a.recommended) || a.name.localeCompare(b.name))
          .map((skill) => ({
            value: skill.id,
            label: `${skill.name} (${skill.id})${skill.recommended ? " (Recommended)" : ""}`,
            ...(skill.description ? { description: skill.description } : {}),
          })),
      },
    ],
  } as const
}

type Close = Pick<SkillPicker, "id" | "sessionID">
export type SkillPickerHost = {
  requests(): Promise<{ requests: SkillPicker[] }>
  claim(id: string): Promise<{ claimed: boolean }>
  fail(id: string, message: string): Promise<unknown>
  onRequest(callback: (request: SkillPicker) => void): () => void
  onClose(callback: (request: Close) => void): () => void
  create(input: ReturnType<typeof skillPickerForm>): Promise<{ id: string }>
  forms(sessionID: string): Promise<{ id: string; metadata?: Record<string, unknown> | undefined }[]>
  cancel(sessionID: string, formID: string): Promise<unknown>
  notify(message: string): void
}

/** One client claims creation; the native form and its answer remain available to every connected client. */
export function connectSkillPickers(host: SkillPickerHost): () => void {
  let disposed = false
  const closing = new Set<string>()
  const opening = new Set<string>()
  const report = (error: unknown) => host.notify(errorMessage(error) ?? "Could not open the review skill picker.")
  const open = async (request: SkillPicker) => {
    if (disposed || opening.has(request.id)) {
      return
    }
    opening.add(request.id)
    try {
      if (!(await host.claim(request.id)).claimed) {
        return
      }
      const form = await host.create(skillPickerForm(request))
      if (closing.has(request.id)) {
        await host.cancel(request.sessionID, form.id)
      }
    } catch (error) {
      await host.fail(request.id, errorMessage(error) ?? "Could not open the review skill picker.").catch(report)
      report(error)
    } finally {
      opening.delete(request.id)
      closing.delete(request.id)
    }
  }
  const close = async (request: Close) => {
    if (opening.has(request.id)) {
      closing.add(request.id)
    }
    const forms = await host.forms(request.sessionID)
    await Promise.all(
      forms
        .filter((form) => form.metadata?.reviewSkillPicker === request.id)
        .map((form) => host.cancel(request.sessionID, form.id)),
    )
  }
  const stopRequest = host.onRequest((request) => void open(request))
  const stopClose = host.onClose((request) => void close(request).catch(report))
  void host
    .requests()
    .then(({ requests }) => Promise.all(requests.map(open)))
    .catch(report)
  return () => {
    disposed = true
    stopRequest()
    stopClose()
  }
}
