import { strict as assert } from "node:assert"
import type { Host } from "@opencode-cockpit/client/host"
import { RGBA } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { registerCommaBindings } from "@opentui/keymap/addons"
import { registerManagedTextareaLayer } from "@opentui/keymap/addons/opentui"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { render } from "@opentui/solid"
import { onCleanup } from "solid-js"
import { askForNote } from "../../../src/tui/view/dialogs.tsx"

const setup = await createTestRenderer({ width: 80, height: 30, kittyKeyboard: true })
const { renderer, mockInput, renderOnce, resize } = setup
const keymap = createDefaultOpenTuiKeymap(renderer)
const disposeComma = registerCommaBindings(keymap)
const disposeManaged = registerManagedTextareaLayer(keymap, renderer, {})
const colour = RGBA.fromHex("#ffffff")
let component: (() => unknown) | undefined
let result: string | undefined
let closed = false
const api = {
  renderer,
  theme: { current: { text: colour, textMuted: colour, backgroundElement: colour } },
  keymap: {
    useLayer: (layer: () => Parameters<typeof keymap.registerLayer>[0]) => {
      onCleanup(keymap.registerLayer(layer()))
    },
  },
  ui: {
    dialog: {
      replace: (renderDialog: () => unknown) => {
        component = renderDialog
      },
      setSize: () => {},
      clear: () => {
        closed = true
      },
    },
  },
} as unknown as Host

try {
  askForNote(
    api,
    {
      title: "Note",
      description: "Description",
      quoted: Array.from({ length: 30 }, (_, i) => `line ${i + 1}`),
    },
    (text) => {
      result = text
    },
  )
  assert.ok(component)
  await render(component as never, renderer)
  await renderOnce()
  const editor = renderer.currentFocusedEditor
  assert.ok(editor)
  assert.equal(editor.height, 4)
  assert.match(setup.captureCharFrame(), /\[1-12\/31\]/)
  await mockInput.pressKeys(["\x1b[6~"])
  await renderOnce()
  assert.match(setup.captureCharFrame(), /\[13-24\/31\]/)
  await mockInput.pressKeys(["\x1b[5~"])
  await renderOnce()
  assert.match(setup.captureCharFrame(), /\[1-12\/31\]/)

  await mockInput.typeText("alpha")
  mockInput.pressKey("j", { ctrl: true })
  await mockInput.typeText("beta")
  mockInput.pressEnter({ ctrl: true })
  await mockInput.typeText("gamma")
  await mockInput.pressKeys(["\n"])
  await mockInput.typeText("delta")
  assert.equal(editor.plainText, "alpha\nbeta\ngamma\ndelta")
  assert.equal(result, undefined)
  mockInput.pressEnter()
  assert.equal(result, "alpha\nbeta\ngamma\ndelta")
  assert.equal(closed, true)

  editor.setText("one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen")
  await renderOnce()
  await renderOnce()
  resize(30, 30)
  await renderOnce()
  await renderOnce()
  assert.equal(editor.height, 4)
  resize(100, 30)
  await renderOnce()
  await renderOnce()
  assert.equal(editor.height, 4)
  resize(30, 9)
  await renderOnce()
  await renderOnce()
  assert.equal(editor.height, 2)
  assert.match(setup.captureCharFrame(), /Esc cancel/)
} finally {
  disposeManaged()
  disposeComma()
  renderer.destroy()
}
