import { isFindingQuestion } from "../../domain/review-draft.js"
import { reviewPickerStyles } from "./components/styles.js"

export type ReviewPickerForm = {
  metadata?: Record<string, unknown> | undefined
  fields: readonly { title?: string | undefined }[]
}

const isReviewPicker = (form: ReviewPickerForm) =>
  typeof form.metadata?.reviewSkillPicker === "string" ||
  (form.metadata?.kind === "question" && form.fields.some((field) => isFindingQuestion(field.title)))

/** Bounds the docks only while the session shows a review picker; other plugins' forms and questions keep theirs. */
export const pickerStyles = (forms: readonly ReviewPickerForm[]): string | undefined =>
  forms.some(isReviewPicker) ? reviewPickerStyles : undefined
