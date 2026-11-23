import { describe, expect, test } from "bun:test"
import { noteContextPosition, noteDialogKey, noteDialogLayout } from "../../src/tui/view/dialogs.tsx"

describe("note dialog layout", () => {
  test("given sufficient space, when laying out the dialog, then the editor has four lines", () => {
    expect(noteDialogLayout(30, 100)).toEqual({ editor: 4, context: 12 })
  })

  test("given a short terminal, when laying out the dialog, then editor and hints remain", () => {
    expect(noteDialogLayout(6, 100)).toEqual({ editor: 1, context: 0 })
    expect(noteDialogLayout(9, 100)).toEqual({ editor: 2, context: 0 })
  })

  test("given short context, when laying out the dialog, then it does not reserve unused rows", () => {
    expect(noteDialogLayout(30, 3)).toEqual({ editor: 4, context: 3 })
  })
})

describe("note context position", () => {
  test("given clipped context, when viewing different pages, then the visible range is shown", () => {
    expect(noteContextPosition(0, 5, 12)).toBe("[1-5/12] ")
    expect(noteContextPosition(7, 5, 12)).toBe("[8-12/12] ")
  })

  test("given context that fits or has no room, when viewing it, then the position is accurate", () => {
    expect(noteContextPosition(0, 5, 5)).toBe("")
    expect(noteContextPosition(0, 0, 5)).toBe("[0/5] ")
  })
})

describe("note dialog keys", () => {
  test("given terminal enter variants, when editing, then submit and newline stay distinct", () => {
    expect(noteDialogKey({ name: "return", ctrl: false })).toBe("submit")
    expect(noteDialogKey({ name: "return", ctrl: true })).toBe("newline")
    expect(noteDialogKey({ name: "j", ctrl: true })).toBe("newline")
    expect(noteDialogKey({ name: "linefeed", ctrl: false })).toBe("newline")
  })

  test("given page keys, when editing, then they scroll context rather than the editor", () => {
    expect(noteDialogKey({ name: "pageup", ctrl: false })).toBe("previous")
    expect(noteDialogKey({ name: "pagedown", ctrl: false })).toBe("next")
    expect(noteDialogKey({ name: "a", ctrl: false })).toBeUndefined()
  })
})

test("given the managed textarea keymap, when editing and resizing, then submission and wrapping work", () => {
  const process = Bun.spawnSync(
    [
      "bun",
      "--conditions",
      "browser",
      "--preload",
      "@opentui/solid/preload",
      "test/view/fixtures/note-dialog-runtime.ts",
    ],
    { cwd: `${import.meta.dir}/../..`, stdout: "pipe", stderr: "pipe" },
  )
  expect(process.stderr.toString()).toBe("")
  expect(process.exitCode).toBe(0)
})
