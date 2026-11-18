import { randomUUID } from "node:crypto"
import type { Plugin } from "@opencode/plugin"
import * as v from "valibot"
import type { SkillPicker } from "../../shared/rpc.js"
import type { DraftStore } from "./draft-store.js"

type Pending = {
  request: SkillPicker
  claimed: boolean
  formID?: string
  resolve(ids: string[]): void
  reject(error: Error): void
}

export type SkillSelectionHost = {
  open(request: SkillPicker): Promise<unknown>
  close(request: Pick<SkillPicker, "id" | "sessionID">): Promise<unknown>
  load(id: string): Promise<string>
}

/** The registry is location-scoped; requests are shared so any connected UI can present the native form. */
export class ReviewSkills {
  private readonly pending = new Map<string, Pending>()
  private readonly selecting = new Set<string>()

  constructor(private readonly store: DraftStore) {}

  async list(sessionID: string, skills: Plugin.Context["skill"], signal: AbortSignal) {
    const draft = await this.draft(sessionID)
    const { data } = await skills.list({ location: { directory: draft.worktree } }, { signal })
    return data.map(({ id, name, description }) => ({ id, name, ...(description ? { description } : {}) }))
  }

  requests(): SkillPicker[] {
    return [...this.pending.values()].map((pending) => pending.request)
  }

  claim(id: string): boolean {
    const pending = this.pending.get(id)
    if (!pending || pending.claimed) {
      return false
    }
    pending.claimed = true
    return true
  }

  fail(id: string, message: string): void {
    this.pending.get(id)?.reject(new Error(message))
  }

  created(form: { id: string; sessionID: string; metadata?: Record<string, unknown> | undefined }): void {
    const id = form.metadata?.reviewSkillPicker
    if (typeof id !== "string") {
      return
    }
    const pending = this.pending.get(id)
    if (pending?.claimed && pending.request.sessionID === form.sessionID && !pending.formID) {
      pending.formID = form.id
    }
  }

  answered(formID: string, sessionID: string, answer: unknown): void {
    const pending = this.forForm(formID, sessionID)
    if (!pending) {
      return
    }
    const parsed = v.safeParse(v.array(v.string()), answer ?? [])
    if (!parsed.success) {
      pending.reject(new Error("The skill picker returned an invalid selection."))
      return
    }
    const selected = [...new Set(parsed.output)]
    const available = new Set(pending.request.skills.map((skill) => skill.id))
    if (selected.some((id) => !available.has(id))) {
      pending.reject(new Error("The skill picker returned a skill that was not offered."))
      return
    }
    pending.resolve(selected)
  }

  cancelled(formID: string, sessionID: string): void {
    this.forForm(formID, sessionID)?.reject(
      new Error("Skill selection was cancelled. Wait for the user before continuing the review."),
    )
  }

  async select(
    sessionID: string,
    recommended: string[],
    tool: SkillPicker["tool"],
    registry: Plugin.Context["skill"],
    host: SkillSelectionHost,
    signal: AbortSignal,
  ): Promise<{ ids: string[]; content: string[] }> {
    if (this.selecting.has(sessionID)) {
      throw new Error("A skill selection is already in progress for this review. Wait for the user's answer.")
    }
    this.selecting.add(sessionID)
    try {
      return await this.choose(sessionID, recommended, tool, registry, host, signal)
    } finally {
      this.selecting.delete(sessionID)
    }
  }

  private async choose(
    sessionID: string,
    recommended: string[],
    tool: SkillPicker["tool"],
    registry: Plugin.Context["skill"],
    host: SkillSelectionHost,
    signal: AbortSignal,
  ): Promise<{ ids: string[]; content: string[] }> {
    const draft = await this.draft(sessionID)
    if (draft.skillIDs !== undefined) {
      return { ids: draft.skillIDs, content: [] }
    }
    const skills = await this.list(sessionID, registry, signal)
    if (recommended.some((id) => !skills.some((skill) => skill.id === id))) {
      throw new Error("A recommended skill is unavailable. Call review_list_skills again.")
    }
    const request: SkillPicker = {
      id: randomUUID(),
      sessionID,
      tool,
      skills: skills.map((skill) => ({ ...skill, recommended: recommended.includes(skill.id) })),
    }
    const selected = skills.length === 0 ? [] : await this.ask(request, host, signal)
    const content: string[] = []
    for (const id of selected) {
      signal.throwIfAborted()
      content.push(await host.load(id))
    }
    signal.throwIfAborted()
    await this.store.update(draft.key, (saved) => {
      if (saved.sessionID !== sessionID || saved.status === "posted") {
        throw new Error("This review was reset or posted while choosing skills.")
      }
      saved.skillIDs = selected
    })
    return { ids: selected, content }
  }

  private async ask(request: SkillPicker, host: SkillSelectionHost, signal: AbortSignal): Promise<string[]> {
    signal.throwIfAborted()
    let abort = () => {}
    try {
      return await new Promise<string[]>((resolve, reject) => {
        this.pending.set(request.id, { request, claimed: false, resolve, reject })
        abort = () => reject(new Error("Skill selection was interrupted."))
        signal.addEventListener("abort", abort, { once: true })
        void host.open(request).catch(reject)
      })
    } finally {
      signal.removeEventListener("abort", abort)
      this.pending.delete(request.id)
      await host.close({ id: request.id, sessionID: request.sessionID }).catch(() => undefined)
    }
  }

  private forForm(formID: string, sessionID: string): Pending | undefined {
    return [...this.pending.values()].find(
      (pending) => pending.formID === formID && pending.request.sessionID === sessionID,
    )
  }

  private async draft(sessionID: string) {
    const draft = await this.store.bySession(sessionID)
    if (!draft || draft.status === "posted") {
      throw new Error("This is not an active review session started from the review queue panel.")
    }
    return draft
  }
}
