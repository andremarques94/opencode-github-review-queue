/** @jsxImportSource @opentui/solid */

import { usePlugin } from "@opencode/plugin/tui"
import type { ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createSignal, For, Show } from "solid-js"
import { orderedSkills } from "../../../shared/review/skill-picker.js"
import type { SkillPicker } from "../../../shared/rpc.js"
import { KeyHints } from "./key-hints.js"

// Above the panels' own bindings while the dialog is open.
const DIALOG_PRIORITY = 100
const LIST_HEIGHT = 14

const skillRowID = (id: string) => `github-review-queue:skill:${id}`

/**
 * The host's TUI form lists every option with no scrolling, so a long skill list runs off the screen. This dialog
 * scrolls. `answer` gets the chosen IDs, or `null` when the user dismisses it.
 */
export function openSkillPicker(
  context: ReturnType<typeof usePlugin>,
  request: SkillPicker,
  answer: (skills: string[] | null) => Promise<unknown>,
): () => Promise<void> {
  let open = true
  let sending = false
  const finish = async (skills: string[] | null) => {
    if (!open || sending) {
      return
    }
    sending = true
    try {
      await answer(skills)
      if (open) {
        open = false
        context.ui.dialog.clear()
      }
    } catch (error) {
      context.ui.toast.show({ message: `Could not send the skill selection: ${String(error)}`, variant: "error" })
    } finally {
      sending = false
    }
  }
  context.ui.dialog.show(
    () => (
      <SkillPickerDialog request={request} submit={(skills) => void finish(skills)} cancel={() => void finish(null)} />
    ),
    () => void finish(null),
  )
  context.ui.dialog.set({ size: "large" })
  return async () => {
    if (open) {
      open = false
      context.ui.dialog.clear()
    }
  }
}

function SkillPickerDialog(props: { request: SkillPicker; submit(skills: string[]): void; cancel(): void }) {
  const context = usePlugin()
  const theme = context.theme
  const dimensions = useTerminalDimensions()
  const listHeight = () => Math.min(LIST_HEIGHT, Math.max(3, dimensions().height - 12))
  const skills = orderedSkills(props.request)
  const [cursor, setCursor] = createSignal(0)
  const [chosen, setChosen] = createSignal<ReadonlySet<string>>(
    new Set(skills.filter((skill) => skill.recommended).map((skill) => skill.id)),
  )
  const toggle = (id: string) =>
    setChosen((current) => {
      const next = new Set(current)
      if (!next.delete(id)) {
        next.add(id)
      }
      return next
    })
  const toggleCurrent = () => {
    const skill = skills[cursor()]
    if (skill) {
      toggle(skill.id)
    }
  }
  const move = (step: number) => setCursor((value) => Math.min(Math.max(value + step, 0), skills.length - 1))
  const submit = () => props.submit(skills.filter((skill) => chosen().has(skill.id)).map((skill) => skill.id))
  const none = () => setChosen(new Set<string>())

  let scroll: ScrollBoxRenderable | undefined
  createEffect(() => {
    const skill = skills[cursor()]
    if (skill) {
      scroll?.scrollChildIntoView(skillRowID(skill.id))
    }
  })
  context.keymap.layer(() => ({
    priority: DIALOG_PRIORITY,
    commands: [
      { bind: "down,j", run: () => move(1) },
      { bind: "up,k", run: () => move(-1) },
      { bind: "space", run: toggleCurrent },
      { bind: "n", run: none },
      { bind: "enter", run: submit },
      { bind: "escape", run: props.cancel },
    ],
  }))

  return (
    <box flexDirection="column" gap={1} paddingLeft={2} paddingRight={2}>
      <text fg={theme.text.base}>
        <b>Skills for this review</b>
      </text>
      <text fg={theme.text.muted} wrapMode="word">
        Suggested skills are selected. Toggle any skill, or select none to continue without skills.
      </text>
      <scrollbox
        ref={(element: ScrollBoxRenderable) => {
          scroll = element
        }}
        maxHeight={listHeight()}
      >
        <For each={skills}>
          {(skill, index) => (
            <box
              id={skillRowID(skill.id)}
              flexDirection="column"
              backgroundColor={index() === cursor() ? theme.background.raised.base : undefined}
              onMouseDown={() => setCursor(index())}
              onMouseUp={() => toggle(skill.id)}
            >
              <text wrapMode="none">
                <span style={{ fg: theme.text.action.primary.base }}>{index() === cursor() ? "▌" : " "}</span>
                <span style={{ fg: chosen().has(skill.id) ? theme.text.feedback.success.base : theme.text.muted }}>
                  [{chosen().has(skill.id) ? "✓" : " "}]
                </span>
                <span style={{ fg: theme.text.base }}> {skill.name}</span>
                <span style={{ fg: theme.text.faint }}> ({skill.id})</span>
                <Show when={skill.recommended}>
                  <span style={{ fg: theme.text.action.primary.base }}> Recommended</span>
                </Show>
              </text>
              <Show when={skill.description}>
                {(description) => (
                  <text wrapMode="none" fg={theme.text.muted} paddingLeft={5}>
                    {description()}
                  </text>
                )}
              </Show>
            </box>
          )}
        </For>
      </scrollbox>
      <text fg={theme.text.faint}>
        {chosen().size === 0 ? "No skills selected: the review continues without skills." : `${chosen().size} selected`}
      </text>
      <KeyHints
        hints={[
          { key: "space", label: "toggle", run: toggleCurrent },
          { key: "n", label: "none", run: none },
          { key: "enter", label: "continue", run: submit },
          { key: "esc", label: "dismiss", run: props.cancel },
        ]}
      />
    </box>
  )
}
