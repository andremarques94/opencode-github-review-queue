import type { usePlugin } from "@opencode/plugin/tui"
import { createEffect, onCleanup } from "solid-js"
import { isFindingQuestion } from "../../../domain/review-draft.js"
import { errorMessage } from "../../../shared/rpc.js"

type Context = ReturnType<typeof usePlugin>
type PendingForm = Awaited<ReturnType<Context["client"]["session"]["form"]["list"]>>[number]

function findingField(form: PendingForm) {
  const field = form.fields[0]
  if (form.metadata?.kind !== "question" || form.fields.length !== 1) {
    return undefined
  }
  return field?.type === "string" && field.options && isFindingQuestion(field.title) ? field : undefined
}

async function pickAnswer(context: Context, field: NonNullable<ReturnType<typeof findingField>>, valid: () => boolean) {
  const choice = await context.ui.dialog.select({
    title: field.title ?? "Review finding",
    options: [
      ...(field.options ?? []).map((option) => ({
        title: option.label,
        value: option.value,
        ...(option.description ? { description: option.description } : {}),
      })),
      ...(field.custom ? [{ title: "Type your own answer…", value: null }] : []),
    ],
  })
  if (choice !== null || !valid()) {
    return choice ?? undefined
  }
  return context.ui.dialog.prompt({
    title: field.title ?? "Review finding",
    ...(field.description ? { description: field.description } : {}),
  })
}

/** Use the host's searchable, scrollable selection dialog, not its unbounded inline form. */
export function serveFindingQuestions(context: ReturnType<typeof usePlugin>): void {
  const seen = new Set<string>()
  let active: string | undefined
  let disposed = false
  const forms = context.client.session.form
  const show = async (form: PendingForm) => {
    const field = findingField(form)
    if (!field) {
      return
    }
    seen.add(form.id)
    active = form.id
    try {
      const value = await pickAnswer(context, field, () => !disposed && active === form.id)
      if (disposed || active !== form.id) {
        return
      }
      active = undefined
      if (value === undefined) {
        await forms.cancel({ sessionID: form.sessionID, formID: form.id })
        return
      }
      if (!value.trim()) {
        // Empty typed text is not a decision. Leave the native form available for another answer.
        return
      }
      await forms.reply({ sessionID: form.sessionID, formID: form.id, answer: { [field.key]: value } })
    } catch (error) {
      context.ui.toast.show({
        message: errorMessage(error) ?? "Could not answer the finding question.",
        variant: "error",
      })
    } finally {
      if (active === form.id) {
        active = undefined
      }
    }
  }
  createEffect(() => {
    const route = context.ui.router.current()
    const pending = route.type === "session" ? (context.data.session.form.list(route.sessionID) ?? []) : []
    if (active && !pending.some((form) => form.id === active)) {
      active = undefined
      context.ui.dialog.clear()
    }
    if (active) {
      return
    }
    const next = pending.find((form) => !seen.has(form.id) && findingField(form))
    if (next) {
      void show(next)
    }
  })
  onCleanup(() => {
    disposed = true
    if (active) {
      active = undefined
      context.ui.dialog.clear()
    }
  })
}
