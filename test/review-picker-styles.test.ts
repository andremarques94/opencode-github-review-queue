import { describe, expect, it } from "vitest"
import { pickerStyles } from "../src/ui/gui/picker-styles.js"

const skillPicker = { metadata: { reviewSkillPicker: "picker_1" }, fields: [{ title: "Review skills" }] }
const findingQuestion = { metadata: { kind: "question" }, fields: [{ title: "Finding #4" }] }
const otherQuestion = { metadata: { kind: "question" }, fields: [{ title: "Choose a framework" }] }

describe("review picker scrolling", () => {
  it("bounds the skill list and both finding question UIs without scrolling the footer away", () => {
    const styles = pickerStyles([skillPicker])
    expect(styles).toContain('data-component="session-elicitation-dock"')
    expect(styles).toContain('data-component="session-question-dock"')
    expect(styles).toContain("max-block-size: min(42dvh, 380px)")
    expect(styles).toContain('data-slot="elicitation-fields"')
    expect(styles).toContain('data-slot="question-options"')
    expect(styles).toContain("overflow-y: auto")
    expect(styles).toContain("overscroll-behavior: contain")
    expect(styles).toContain('data-slot="question-details-frame"')
    expect(styles).not.toContain('data-slot="question-footer"')
  })

  it("applies the same limits to Keep, Drop, Explain and Investigate questions", () => {
    expect(pickerStyles([findingQuestion])).toBe(pickerStyles([skillPicker]))
  })

  it("finds a review picker that is not the first open form", () => {
    expect(pickerStyles([otherQuestion, skillPicker])).toBe(pickerStyles([skillPicker]))
    expect(pickerStyles([otherQuestion, findingQuestion])).toBe(pickerStyles([skillPicker]))
  })

  it("leaves unrelated questions and forms unchanged", () => {
    expect(pickerStyles([])).toBeUndefined()
    expect(pickerStyles([{ fields: [] }])).toBeUndefined()
    expect(pickerStyles([otherQuestion])).toBeUndefined()
    expect(pickerStyles([{ metadata: { kind: "mcp-elicitation" }, fields: [{ title: "Finding #4" }] }])).toBeUndefined()
  })
})
