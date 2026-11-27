import { expect, test } from "bun:test"
import { createPainter, type PaintDeps } from "../../src/tui/panel/paint.ts"
import { createSurface } from "../../src/tui/panel/surface.ts"

test("given a queued paint, when disposed before the slot is destroyed, then no stale renderables are touched", async () => {
  let destroyed = false
  let reads = 0
  const painter = createPainter({
    surface: createSurface("pane"),
    boxes: () => {
      reads++
      if (destroyed) throw new Error("Native scene Yoga node is freed")
      return {}
    },
  } as unknown as PaintDeps)

  painter.draw()
  painter.dispose()
  destroyed = true
  painter.draw()
  await new Promise((resolve) => setTimeout(resolve, 10))
  expect(reads).toBe(0)
})

test("given an active painter, when drawing a hidden panel, then it still clears the pool", async () => {
  let cleared = 0
  const painter = createPainter({
    api: {
      renderer: { width: 80, height: 24, requestRender: () => {} },
      theme: { current: { backgroundPanel: { a: 1 } } },
    },
    surface: createSurface("pane"),
    boxes: () => ({ backdrop: {}, panel: {}, pool: { clear: () => cleared++ } }),
    guard: { run: (_where: string, run: () => void) => run() },
  } as unknown as PaintDeps)

  painter.draw()
  await new Promise((resolve) => setTimeout(resolve, 10))
  expect(cleared).toBe(1)
  painter.dispose()
})

test("given a paint that queued cursor hiding, when disposed, then the cursor is not hidden afterward", async () => {
  let cursorChanges = 0
  const surface = createSurface("pane")
  surface.open = true
  const painter = createPainter({
    api: {
      renderer: { width: 80, height: 24, requestRender: () => {}, setCursorPosition: () => cursorChanges++ },
      theme: { current: { backgroundPanel: { a: 1, r: 0, g: 0, b: 0 } } },
    },
    surface,
    store: { current: () => ({ changes: { source: "branch", files: [] } }) },
    queries: { label: () => "", hereThreadId: () => undefined },
    notice: () => undefined,
    looks: () => new Map(),
    boxes: () => ({ backdrop: {}, panel: {}, pool: { draw: () => {} } }),
    guard: {
      run: (_where: string, run: () => void) => {
        run()
        painter.dispose()
      },
    },
  } as unknown as PaintDeps)

  painter.draw()
  await new Promise((resolve) => setTimeout(resolve, 10))
  expect(cursorChanges).toBe(0)
})
