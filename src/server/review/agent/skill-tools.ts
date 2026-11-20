import type { Plugin } from "@opencode/plugin"
import type { ToolEditor } from "@opencode/plugin/promise/tool"
import * as v from "valibot"
import type { ReviewDraft } from "../../../domain/review-draft.js"
import type { ReviewSkills, SkillSelectionHost } from "../skills.js"

const OPTIONS = { namespace: "review", codemode: false } as const
const Selection = v.strictObject({ recommended: v.array(v.string()) })

export function waitForSkillSelection(tools: Record<string, unknown>, draft: ReviewDraft): void {
  if (draft.status !== "investigating" || draft.skillIDs !== undefined) {
    return
  }
  delete tools.skill
  delete tools.review_add_finding
  delete tools.review_set_verdict
}

export function addSkillTools(
  editor: ToolEditor,
  skills: ReviewSkills,
  plugin: Pick<Plugin.Context, "skill" | "permission" | "tool">,
  picker: Omit<SkillSelectionHost, "load">,
  lifetime: AbortSignal,
): void {
  editor.add({
    name: "list_skills",
    description: "Discover all skills available in this review's location, with IDs and descriptions.",
    input: { type: "object", properties: {}, additionalProperties: false },
    options: OPTIONS,
    execute: async (_input, context) => ({
      content: JSON.stringify(await skills.list(context.sessionID, plugin.skill, context.signal)),
    }),
  })
  editor.add({
    name: "select_skills",
    description:
      "Ask the user which skills to add as context. Shows every available skill with your recommended IDs preselected; waits for confirmation and loads only the user's selection. Call before investigating findings.",
    input: {
      type: "object",
      properties: {
        recommended: {
          type: "array",
          items: { type: "string" },
          description: "IDs from review_list_skills matching the actual changes. Use [] if none match.",
        },
      },
      required: ["recommended"],
      additionalProperties: false,
    },
    options: OPTIONS,
    execute: async (input, context) => {
      const signal = AbortSignal.any([context.signal, lifetime])
      const { recommended } = v.parse(Selection, input)
      // Looked up per call: the registry is rebuilt on reload, and a captured definition could go stale.
      const loadSkill = (await plugin.tool.list()).find((tool) => tool.id === "skill")
      if (!loadSkill) {
        throw new Error("OpenCode's skill tool is unavailable. Enable it before choosing review skills.")
      }
      await plugin.permission.assert({
        action: "question",
        resources: ["*"],
        sessionID: context.sessionID,
        agent: context.agent,
        source: { type: "tool", messageID: context.messageID, id: context.id },
      })
      const selected = await skills.select({
        sessionID: context.sessionID,
        recommended,
        tool: { messageID: context.messageID, id: context.id },
        registry: plugin.skill,
        host: {
          ...picker,
          load: async (id) => {
            const result = await loadSkill.execute({ id }, { ...context, signal })
            return typeof result.content === "string" ? result.content : JSON.stringify(result.content)
          },
        },
        signal,
      })
      return {
        content: [
          `User-confirmed skills: ${JSON.stringify(selected.ids)}. Do not load unselected skills. Continue investigating the review.`,
          ...selected.content,
        ].join("\n\n"),
      }
    },
  })
}
