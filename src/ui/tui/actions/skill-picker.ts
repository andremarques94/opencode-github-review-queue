import type { usePlugin } from "@opencode/plugin/tui"
import { connectSkillPickers } from "../../../shared/review/skill-picker.js"
import { ReviewQueue } from "../../../shared/rpc.js"

export function serveSkillPickers(context: ReturnType<typeof usePlugin>): () => void {
  const rpc = context.client.rpc(ReviewQueue)
  const forms = context.client.session.form
  return connectSkillPickers({
    requests: () => rpc.skillPickers({}),
    claim: (id) => rpc.claimSkillPicker({ id }),
    fail: (id, message) => rpc.failSkillPicker({ id, message }),
    onRequest: (callback) => rpc.events.on("skillPicker", (event) => callback(event.data)),
    onClose: (callback) => rpc.events.on("closeSkillPicker", (event) => callback(event.data)),
    create: (input) => forms.create(input),
    forms: (sessionID) => forms.list({ sessionID }),
    cancel: (sessionID, formID) => forms.cancel({ sessionID, formID }),
    notify: (message) => context.ui.toast.show({ message, variant: "error" }),
  })
}
