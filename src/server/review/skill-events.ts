import type { Plugin } from "@opencode/plugin"
import type { ReviewSkills } from "./skills.js"

/** Fail pending pickers on either a failed or gracefully ended subscription, not only on an exception. */
export async function watchSkillForms(
  skills: ReviewSkills,
  events: Plugin.Context["event"],
  signal: AbortSignal,
): Promise<void> {
  try {
    for await (const event of events.subscribe({
      types: ["form.created", "form.replied", "form.cancelled"],
      signal,
    })) {
      switch (event.type) {
        case "form.created":
          skills.created(event.data.form)
          break
        case "form.replied":
          skills.answered(
            event.data.id,
            event.data.sessionID,
            event.data.answer.skills,
            event.data.answer.withoutSkills,
          )
          break
        case "form.cancelled":
          skills.cancelled(event.data.id, event.data.sessionID)
          break
      }
    }
  } catch {
    // Both error and normal completion reach the same failure path below.
  } finally {
    if (!signal.aborted) {
      skills.failAll(
        "The connection to review skill forms was lost. Reload the plugin before retrying skill selection.",
      )
    }
  }
}
