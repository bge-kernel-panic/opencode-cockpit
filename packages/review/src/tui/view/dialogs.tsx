/** @jsxImportSource @opentui/solid */
import type { Host } from "@opencode-cockpit/client/host"
import type { TextareaRenderable } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { createSignal } from "solid-js"
import type { BaseCandidate } from "../../core/git/changes.ts"
import { type Thread, threadWhere } from "../../core/model/thread.ts"
import { cardRows } from "../../core/view/card.ts"
import type { Fill, Row, Tone } from "../../core/view/rows.ts"
import { languageOf, type SyntaxState, tokenize } from "../../core/view/syntax/index.ts"
import { fillColour, toneColour } from "../view/pool.ts"

/**
 * What each dialog says.
 *
 * Kept here rather than beside the verbs that open them: a verb is about what changes, and none of
 * these sentences change anything. They were three blocks of copy in the middle of `panel/actions.ts`,
 * which is how "nothing is sent until you submit the review" ended up written three slightly
 * different ways.
 */
export const noteFields = (
  file: string,
  where: { from?: number; to?: number; existing?: Thread; quoted?: string[] },
): AskOptions => ({
  title: where.existing
    ? `Reply · ${file}:${threadWhere(where.existing)}`
    : where.from === undefined
      ? `Note on ${file}`
      : where.to !== undefined && where.to > where.from
        ? `Note on ${file}:${where.from}-${where.to}`
        : `Note on ${file}:${where.from}`,
  description: where.existing
    ? "Continues the thread. Nothing is sent until you submit."
    : where.from === undefined
      ? "About the file as a whole. Nothing is sent until you submit."
      : "Nothing is sent until you submit the review.",
  ...(where.existing ? { thread: where.existing } : {}),
  /** The lines being commented on, so a note is not written blind either. */
  ...(where.quoted ? { quoted: where.quoted } : {}),
})

export const replyFields = (thread: Thread): AskOptions => ({
  title: `Reply · ${thread.file}`,
  description:
    thread.status === "resolved"
      ? "Replying reopens this thread, so the agent sees it again."
      : "Continues the thread. Nothing is sent until you submit.",
  thread,
  ...(thread.quoted ? { quoted: thread.quoted } : {}),
})

/** A covering sentence is optional, so this is the one dialog that accepts an empty answer. */
export const submitFields = (label: string, comments: number): AskOptions => ({
  title: `Submit · ${label}`,
  description: `${comments} comment${comments === 1 ? "" : "s"} go to the agent. A sentence of your own is optional.`,
  allowEmpty: true,
})

export interface AskOptions {
  title: string
  description: string
  /** The thread being answered, shown above the field so replying is not done blind. */
  thread?: Thread
  /** The code the thread was written against, for a new note on a line. */
  quoted?: string[]
  value?: string
  /**
   * Whether an empty answer still counts.
   *
   * A note has to say something; a submit does not — handing over a review with no covering sentence
   * is an ordinary thing to do, and refusing it silently would look like a broken key.
   */
  allowEmpty?: boolean
}

export function noteDialogLayout(terminalHeight: number, contextLines: number) {
  const height = Math.max(3, Math.floor((terminalHeight * 2) / 3) - 2)
  const editor = Math.max(1, Math.min(4, height - 2))
  return { editor, context: Math.max(0, Math.min(contextLines, height - editor - 2)) }
}

export function noteContextPosition(start: number, visible: number, total: number): string {
  if (visible >= total) return ""
  return visible === 0 ? `[0/${total}] ` : `[${start + 1}-${start + visible}/${total}] `
}

export function noteDialogKey(event: {
  name: string
  ctrl: boolean
}): "previous" | "next" | "newline" | "submit" | undefined {
  if (event.name === "pageup") return "previous"
  if (event.name === "pagedown") return "next"
  if (
    event.name === "linefeed" ||
    (event.ctrl && (event.name === "j" || event.name === "return" || event.name === "enter"))
  )
    return "newline"
  if (event.name === "return" || event.name === "enter") return "submit"
}

/**
 * Writing a note, or answering one.
 *
 * **What is being answered is shown above the field.** The first version opened an empty box titled
 * "Reply", which is the same box you get for a new comment — so answering meant remembering what you
 * were answering, while the thing you were answering was hidden behind the dialog.
 *
 * **And it is shown the way the pane shows it.** The context here is built from the same `cardRows`
 * and the same tokenizer as the review itself, so a thread looks identical whether you are reading it
 * or replying to it. A dialog that renders the same content in a plainer style is a second design to
 * keep in step, and the two had already drifted: the pane had badges and syntax colour while the
 * dialog had a list of grey lines.
 */
export function askForNote(
  api: Host,
  { title, description, thread, quoted, value, allowEmpty }: AskOptions,
  onConfirm: (text: string) => void,
  onClose?: () => void,
): void {
  const theme = () => api.theme.current

  /**
   * Wide enough for code, narrow enough to stay a dialog rather than a second pane.
   *
   * The quote is the point of this box, and a quote of code that wraps mid-expression is worse than
   * no quote at all — it reads as different code. So the width is a code width (96 columns, the same
   * order as the diff pane it came from) rather than a dialog width, and long lines are *clipped*
   * rather than wrapped: a line you can see the start of is still the line you commented on.
   */
  const width = () => Math.max(40, Math.min(96, api.renderer.width - 12))

  /**
   * The quoted code, coloured as code.
   *
   * On the band's own surface, so it reads as something being *shown to you* rather than something
   * you are editing — the field below is the only place in this dialog that takes typing.
   */
  const quotedRows = (): Row[] => {
    const lines = quoted ?? []
    if (lines.length === 0) return []
    const language = languageOf(thread?.file ?? "")
    let state: SyntaxState = { inBlockComment: false }
    const room = width() - 4
    return lines.map((line) => {
      const scanned = tokenize(line.slice(0, room), language, state)
      state = scanned.state
      const used = scanned.runs.reduce((sum, run) => sum + run.text.length, 0)
      return {
        runs: [
          { text: "  ", fill: "comment" as Fill },
          ...scanned.runs.map((run) => ({ ...run, fill: "comment" as Fill })),
          { text: " ".repeat(Math.max(0, room - used + 2)), fill: "comment" as Fill },
        ],
      }
    })
  }

  const context = (): Row[] => [
    { runs: [{ text: description, tone: "muted" }] },
    ...quotedRows(),
    ...(thread ? cardRows(thread, { width: width(), height: 40 }, "current", { inline: true }) : []),
  ]

  const colour = (tone: Tone | undefined) => toneColour(theme(), tone)
  const behind = (fill: Fill | undefined) => fillColour(theme(), fill)

  const Dialog = () => {
    const dimensions = useTerminalDimensions()
    const rows = () => context()
    const [offset, setOffset] = createSignal(thread ? Number.MAX_SAFE_INTEGER : 0)
    const layout = () => noteDialogLayout(dimensions().height, rows().length)
    const start = () => Math.max(0, Math.min(offset(), rows().length - layout().context))
    let editor: TextareaRenderable | undefined
    const submit = () => {
      const text = editor?.plainText.trim() ?? ""
      if (text || allowEmpty) {
        onConfirm(text)
        api.ui.dialog.clear()
      }
    }
    const move = (direction: number) => {
      setOffset(Math.max(0, start() + direction * Math.max(1, layout().context)))
    }

    api.keymap.useLayer(() => ({
      priority: 100,
      commands: [
        { name: "cockpit.review.note.submit", title: "Submit note", run: () => editor?.submit() },
        { name: "cockpit.review.note.newline", title: "Insert newline", run: () => editor?.insertText("\n") },
        { name: "cockpit.review.note.previous", title: "Previous context page", run: () => move(-1) },
        { name: "cockpit.review.note.next", title: "Next context page", run: () => move(1) },
      ],
      bindings: [
        { key: "return", cmd: "cockpit.review.note.submit" },
        { key: "ctrl+j,linefeed,ctrl+return", cmd: "cockpit.review.note.newline" },
        { key: "pageup", cmd: "cockpit.review.note.previous" },
        { key: "pagedown", cmd: "cockpit.review.note.next" },
      ],
    }))

    useKeyboard((event) => {
      const action = noteDialogKey(event)
      if (!action) return
      event.preventDefault()
      event.stopPropagation()
      if (action === "previous" || action === "next") {
        move(action === "previous" ? -1 : 1)
      } else if (action === "newline") {
        editor?.insertText("\n")
      } else {
        editor?.submit()
      }
    })

    return (
      <box flexDirection="column">
        <text fg={theme().text} wrapMode="none">
          {noteContextPosition(start(), layout().context, rows().length)}
          {title}
        </text>
        {rows()
          .slice(start(), start() + layout().context)
          .map((row) => (
            <text wrapMode="none">
              {row.runs.map((run) => (
                <span
                  style={{
                    fg: colour(run.tone),
                    ...(behind(run.fill) ? { bg: behind(run.fill) } : {}),
                    ...(run.bold ? { bold: true } : {}),
                  }}
                >
                  {run.text}
                </span>
              ))}
            </text>
          ))}
        <textarea
          ref={(ref) => {
            editor = ref
          }}
          focused
          height={layout().editor}
          wrapMode="word"
          initialValue={value ?? ""}
          placeholder="what should change, and why"
          onSubmit={submit}
        />
        <text fg={theme().textMuted} wrapMode="none">
          Esc cancel · Enter send · ^J newline · PgUp/Dn
        </text>
      </box>
    )
  }
  api.ui.dialog.replace(() => <Dialog />, onClose)
  api.ui.dialog.setSize("xlarge")
}

/**
 * Choosing what the branch is compared against.
 *
 * The nearest parent is a guess, and a good one, but only you know whether this stack is reviewed a
 * layer at a time or all the way down to `main` — so "auto" is the first option, and each branch says
 * how many commits of yours it would show, which is the number that decides it.
 */
export function askForBase(
  api: Host,
  {
    current,
    guessed,
    candidates,
  }: { current?: string; guessed?: string; candidates: readonly BaseCandidate[] },
  onSelect: (base: string | undefined) => void,
  onClose?: () => void,
): void {
  const AUTO = "\0auto"
  const plural = (n: number) => `${n} commit${n === 1 ? "" : "s"}`
  void api.ui
    .select<string>({
      title: "Compare the branch against",
      current: current ?? AUTO,
      options: [
        {
          title: "auto: nearest parent",
          value: AUTO,
          description: guessed ? `currently ${guessed}` : "the branch this one grew from",
        },
        ...candidates.map((each) => ({
          title: each.ref,
          value: each.ref,
          description: `${plural(each.own)} of yours${each.other ? ` · it is ${plural(each.other)} ahead` : ""}`,
        })),
      ],
    })
    .then((value) => {
      onClose?.()
      if (value !== undefined) onSelect(value === AUTO ? undefined : value)
    })
}
