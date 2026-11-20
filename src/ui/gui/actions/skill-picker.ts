import type { Context } from "@opencode/plugin/gui"
import { connectSkillPickers, formView } from "../../../shared/review/skill-picker.js"
import { ReviewQueue } from "../../../shared/rpc.js"

/** Read the client per call: it changes after the desktop app's server restarts. */
export const serveGuiSkillPickers = (context: Context) =>
  connectSkillPickers(
    () => context.client.rpc(ReviewQueue),
    formView(
      () => context.client.session.form,
      (message) => context.toast.show({ title: message, icon: "github" }),
    ),
  )
