import type { usePlugin } from "@opencode/plugin/tui"
import { connectSkillPickers, dismissForms } from "../../../shared/review/skill-picker.js"
import { ReviewQueue } from "../../../shared/rpc.js"
import { openSkillPicker } from "../components/skill-picker-dialog.js"

/** The TUI shows its own scrollable dialog; the host's form cannot scroll a long skill list. */
export const serveTuiSkillPickers = (context: ReturnType<typeof usePlugin>) =>
  connectSkillPickers(() => context.client.rpc(ReviewQueue), {
    show: async (request, answer) => openSkillPicker(context, request, answer),
    dismiss: (request) => dismissForms(context.client.session.form, request),
    notify: (message) => context.ui.toast.show({ message, variant: "error" }),
  })
