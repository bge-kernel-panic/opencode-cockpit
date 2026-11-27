import { expect, test } from "bun:test"
import { emptyReview, open } from "../../src/core/model/review.ts"
import { metrics } from "../../src/core/perf.ts"
import { cursorRow } from "../../src/core/view/stream.ts"
import { type ActionDeps, createActions } from "../../src/tui/panel/actions.ts"
import { createNavigation } from "../../src/tui/panel/navigation.ts"
import { createQueries } from "../../src/tui/panel/queries.ts"
import { createSurface } from "../../src/tui/panel/surface.ts"

function setup() {
  const files = ["a.ts", "b.ts"].map((path) => ({
    path,
    before: "old\n",
    after: "new\n",
    additions: 1,
    deletions: 1,
  }))
  const changes = { source: "branch" as const, files }
  const surface = createSurface("pane")
  let review = open(emptyReview(), { file: "a.ts" }, "whole", "you", 1)
  review = open(review, { file: "a.ts", line: 1 }, "line", "you", 2)
  review = open(review, { file: "b.ts", line: 1 }, "other", "agent", 3)
  review = open(review, { file: "away.ts", line: 4 }, "away", "you", 4)
  const [whole, line] = review.threads
  if (!whole || !line) throw new Error("missing test threads")
  review = {
    ...review,
    threads: [
      whole,
      { ...whole, id: "whole-two", status: "resolved" },
      line,
      { ...line, id: "line-two", status: "resolved" },
      ...review.threads.slice(2),
    ],
  }
  surface.review = review
  surface.view = { pane: "diff", file: "a.ts", cursor: "a.ts", folded: new Set(["a.ts"]) }
  const navigation = createNavigation({
    surface,
    store: { current: () => ({ changes }) },
    viewport: () => ({ width: 100, height: 30 }),
    listHeight: () => 20,
    draw: () => {},
  } as unknown as ActionDeps)
  return { surface, navigation, review }
}

test("given folded files and mixed notes, when jumping, then each thread follows visual order and wraps", () => {
  const { surface, navigation, review } = setup()
  const ids = [
    review.threads[0]?.id,
    "whole-two",
    review.threads[2]?.id,
    "line-two",
    review.threads[4]?.id,
    review.threads[5]?.id,
  ]
  for (const id of ids) {
    navigation.jumpNote(1)
    expect(surface.view.thread).toBe(id)
    const stream = navigation.streamNow()
    expect(stream.segments.find((segment) => segment.path === surface.view.file)?.open).toBe(true)
    expect(cursorRow(stream, review, surface.view, navigation.width())).toBeGreaterThanOrEqual(
      surface.view.scroll ?? 0,
    )
  }
  navigation.jumpNote(1)
  expect(surface.view.thread).toBe(ids[0])
  navigation.jumpNote(-1)
  expect(surface.view.thread).toBe(ids.at(-1))
})

test("given file-wide notes, when moving through the diff, then each is a separate stop", () => {
  const { surface, navigation, review } = setup()
  surface.view = { ...surface.view, folded: new Set() }
  navigation.move(1)
  expect(surface.view.thread).toBe(review.threads[0]?.id)
  navigation.move(1)
  expect(surface.view.thread).toBe("whole-two")
  navigation.move(-1)
  expect(surface.view.thread).toBe(review.threads[0]?.id)
})

test("given many noted files, when jumping to a nearby note, then unrelated diffs are not built", () => {
  const files = Array.from({ length: 30 }, (_, i) => ({
    path: `perf-${String(i).padStart(2, "0")}.ts`,
    before: `old ${i}\n`,
    after: `new ${i}\n`,
    additions: 1,
    deletions: 1,
  }))
  const changes = { source: "branch" as const, files }
  const surface = createSurface("pane")
  surface.review = files.reduce(
    (review, file, i) => open(review, { file: file.path, line: 1 }, "note", "you", i + 1),
    emptyReview(),
  )
  surface.view = { pane: "diff", file: files[0]?.path, folded: new Set(files.map((file) => file.path)) }
  const navigation = createNavigation({
    surface,
    store: { current: () => ({ changes }) },
    viewport: () => ({ width: 100, height: 30 }),
    listHeight: () => 20,
    draw: () => {},
  } as unknown as ActionDeps)
  const before = metrics.snapshot().counts.builds
  navigation.jumpNote(1)
  expect(surface.view.thread).toBe(surface.review.threads[0]?.id)
  expect(metrics.snapshot().counts.builds - before).toBeLessThanOrEqual(2)
})

test("given the file list, when jumping backwards, then the preceding file's last note is selected", () => {
  const { surface, navigation } = setup()
  surface.view = { ...surface.view, pane: "files", file: "b.ts", cursor: "b.ts", thread: "ignored" }
  navigation.jumpNote(-1)
  expect(surface.view.pane).toBe("diff")
  expect(surface.view.thread).toBe("line-two")
})

test("given a note within a long diff, when jumping in either direction, then the note is centered", () => {
  const lines = Array.from({ length: 80 }, (_, i) => `line ${i}`)
  const file = {
    path: "long.ts",
    before: lines.join("\n"),
    after: lines.map((line, i) => (i === 40 ? "changed" : line)).join("\n"),
    additions: 1,
    deletions: 1,
  }
  const changes = { source: "branch" as const, files: [file] }
  const surface = createSurface("pane")
  surface.review = open(emptyReview(), { file: file.path, line: 41 }, "A note\nwith several lines", "you", 1)
  surface.view = { pane: "diff", file: file.path }
  const navigation = createNavigation({
    surface,
    store: { current: () => ({ changes }) },
    viewport: () => ({ width: 100, height: 30 }),
    listHeight: () => 20,
    draw: () => {},
  } as unknown as ActionDeps)
  for (const direction of [1, -1]) {
    navigation.jumpNote(direction)
    const row = cursorRow(navigation.streamNow(), surface.review, surface.view, navigation.width())
    expect(row).toBeDefined()
    expect((row ?? 0) - (surface.view.scroll ?? 0)).toBeGreaterThan(1)
    expect((row ?? 0) - (surface.view.scroll ?? 0)).toBeLessThan(10)
  }
})

test("given a selected line note, when folding and removing at the heading, then the hidden note remains", () => {
  const file = { path: "fold-test.ts", before: "old\n", after: "new\n", additions: 1, deletions: 1 }
  const changes = { source: "branch" as const, files: [file] }
  const surface = createSurface("pane")
  surface.review = open(emptyReview(), { file: file.path, line: 1 }, "note", "you", 1)
  surface.view = { pane: "diff", file: file.path }
  const store = { current: () => ({ changes }) } as ActionDeps["store"]
  const api = {} as ActionDeps["api"]
  let removed = false
  const actions = createActions({
    api,
    surface,
    store,
    queries: createQueries(api, surface, store),
    viewport: () => ({ width: 100, height: 30 }),
    listHeight: () => 20,
    draw: () => {},
    persistence: () => ({
      remove: async () => {
        removed = true
      },
    }),
  } as unknown as ActionDeps)
  actions.jumpNote(1)
  expect(surface.view.thread).toBe(surface.review.threads[0]?.id)
  actions.toggleFold()
  expect(surface.view.thread).toBeUndefined()
  actions.uncomment()
  expect(surface.review.threads).toHaveLength(1)
  expect(removed).toBe(false)
  actions.jumpNote(1)
  actions.toggleViewed()
  expect(surface.view.thread).toBeUndefined()
  expect(surface.view.line).toBeUndefined()
})
