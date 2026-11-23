import { expect, test } from "bun:test"
import { diffSections } from "../../src/core/diff/hunks.ts"
import { streamWidth, visibleDiffRows } from "../../src/core/view/layout.ts"
import { cursorRow, streamOf, streamScroll } from "../../src/core/view/stream.ts"
import { type ActionDeps, createActions } from "../../src/tui/panel/actions.ts"
import { createSurface, retainExpansion } from "../../src/tui/panel/surface.ts"

const lines = Array.from({ length: 90 }, (_, i) => `line ${i + 1}`)
const before = lines.join("\n")
const after = lines.map((line, i) => (i === 29 || i === 59 ? `changed ${i + 1}` : line)).join("\n")
const file = { path: "a.ts", before, after, additions: 2, deletions: 2 }
const changes = { source: "branch" as const, files: [file] }
const viewport = { width: 100, height: 30 }

function setup(line = 45) {
  const surface = createSurface("pane")
  surface.view = { ...surface.view, file: file.path, cursor: file.path, pane: "diff", line, scroll: 0 }
  const deps = {
    surface,
    store: { current: () => ({ changes }) },
    viewport: () => viewport,
    listHeight: () => 20,
    draw: () => {},
    sources: ["branch"],
  } as unknown as ActionDeps
  return { surface, actions: createActions(deps) }
}

test("given hidden context, when building the diff, then each gap has one clickable row", () => {
  const { surface } = setup()
  const rows = visibleDiffRows(changes, surface.review, surface.view, { ...viewport, height: 120 })
  expect(rows.filter((row) => row.gap).map((row) => row.gap)).toEqual([
    { start: 1, end: 26, above: false, below: true },
    { start: 34, end: 56, above: true, below: true },
    { start: 64, end: 90, above: true, below: false },
  ])
})

test("given a middle gap, when expanded twice, then both ends grow and the hunks merge", () => {
  const { surface, actions } = setup(30)
  const originalLine = surface.view.line
  const width = streamWidth(viewport, changes)
  const beforeStream = streamOf(changes, surface.review, surface.view, width)
  const beforePosition =
    (cursorRow(beforeStream, surface.review, surface.view, width) ?? 0) -
    streamScroll(beforeStream, surface.view, 20)
  actions.expand()
  expect([...(surface.view.expanded?.get(file.path) ?? [])].sort((a, b) => a - b)).toEqual([
    34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56,
  ])
  expect(surface.view.line).toBe(originalLine)
  const afterStream = streamOf(changes, surface.review, surface.view, width)
  expect(
    (cursorRow(afterStream, surface.review, surface.view, width) ?? 0) -
      streamScroll(afterStream, surface.view, 20),
  ).toBe(beforePosition)
  const remaining = diffSections(before, after, { expanded: surface.view.expanded?.get(file.path) }).find(
    (section) => "start" in section && section.start === 44,
  )
  if (!remaining || !("start" in remaining)) throw new Error("missing middle gap")
  actions.expand(file.path, remaining)
  expect(
    diffSections(before, after, { expanded: surface.view.expanded?.get(file.path) }).filter(
      (section) => "start" in section,
    ),
  ).toHaveLength(2)
  actions.resetContext()
  expect(surface.view.expanded?.has(file.path)).toBe(false)
  expect(surface.view.line).toBe(originalLine)
})

test("given a boundary gap, when clicked, then only its adjacent end expands", () => {
  const { surface, actions } = setup(30)
  const gap = diffSections(before, after).find((section) => "start" in section)
  if (!gap || !("start" in gap)) throw new Error("missing gap")
  actions.expand(file.path, gap)
  expect([...(surface.view.expanded?.get(file.path) ?? [])]).toEqual([17, 18, 19, 20, 21, 22, 23, 24, 25, 26])
})

test("given equidistant gaps, when expanding, then the gap below wins", () => {
  const { surface, actions } = setup(30)
  actions.expand()
  expect(surface.view.expanded?.get(file.path)?.has(34)).toBe(true)
  expect(surface.view.expanded?.get(file.path)?.has(26)).toBe(false)
})

test("given a cursor and selection in expanded context, when resetting, then the nearest visible line is selected", () => {
  const { surface, actions } = setup(30)
  actions.expand()
  surface.view = { ...surface.view, line: 40, anchor: 38 }
  actions.resetContext()
  expect(surface.view.line).toBe(33)
  expect(surface.view.anchor).toBeUndefined()
  actions.move(1)
  expect(surface.view.line).toBe(57)
})

test("given a visible cursor and hidden selection anchor, when resetting, then the selection is cleared", () => {
  const { surface, actions } = setup(30)
  actions.expand()
  surface.view = { ...surface.view, anchor: 38 }
  actions.resetContext()
  expect(surface.view.line).toBe(30)
  expect(surface.view.anchor).toBeUndefined()
})

test("given visible cursor and anchor, when resetting, then the selection is preserved", () => {
  const { surface, actions } = setup(30)
  actions.expand()
  surface.view = { ...surface.view, anchor: 29 }
  actions.resetContext()
  expect(surface.view.line).toBe(30)
  expect(surface.view.anchor).toBe(29)
})

test("given a cursor equally distant from visible lines, when resetting, then the lower line wins", () => {
  const { surface, actions } = setup(30)
  actions.expand()
  const gap = diffSections(before, after, { expanded: surface.view.expanded?.get(file.path) }).find(
    (section) => "start" in section && section.start === 44,
  )
  if (!gap || !("start" in gap)) throw new Error("missing gap")
  actions.expand(file.path, gap)
  surface.view = { ...surface.view, line: 45 }
  actions.resetContext()
  expect(surface.view.line).toBe(57)
})

test("given expanded files, when reloading, then only changed files lose their context", () => {
  const { surface } = setup()
  const other = { ...file, path: "b.ts" }
  surface.view.expanded = new Map([
    [file.path, new Set([1])],
    [other.path, new Set([2])],
  ])
  retainExpansion(surface, [file, other], [{ ...file }, { ...other, after: `${other.after}!` }])
  expect(surface.view.expanded?.has(file.path)).toBe(true)
  expect(surface.view.expanded?.has(other.path)).toBe(false)
})
