/**
 * Everything the panel *does*.
 *
 * One verb per thing a person can ask for, and each one ends the same way: change the surface, ask for
 * a paint. They lived inside `takeKeys` — four hundred lines nested in the function that registered the
 * keymap — which meant a verb could not be read without reading the keymap, and neither could be moved
 * without moving the other.
 *
 * Nothing here knows which key it is bound to. That table is `keys.ts`, and keeping it separate is what
 * lets a key change without touching what it does.
 *
 * Moving about is `navigation.ts`, what acts on threads and files `threads.ts`; this file adds the
 * rest — sources, the base, stats, the viewer, the keys screen — and is the one table of verbs.
 */

import type { Host } from "@opencode-cockpit/client/host"
import { diffSections, type Gap } from "../../core/diff/hunks.ts"
import type { Guard } from "../../core/guard.ts"
import type { Source } from "../../core/model/review.ts"
import { navigableRows } from "../../core/view/list.ts"
import type { Viewport } from "../../core/view/state.ts"
import { cursorRow, stopsOf, streamScroll } from "../../core/view/stream.ts"
import { baseCandidates } from "../../io/git.ts"
import type { Persistence } from "../../io/persist.ts"
import type { Viewer } from "../../io/viewer.ts"
import type { Store } from "../data/changes.ts"
import { askForBase } from "../view/dialogs.tsx"
import { createNavigation } from "./navigation.ts"
import type { Queries } from "./queries.ts"
import type { Surface } from "./surface.ts"
import { createThreads } from "./threads.ts"

export interface ActionDeps {
  api: Host
  surface: Surface
  store: Store
  guard: Guard
  queries: Queries
  /** Asks for a paint. Every verb ends with one. */
  draw: () => void
  /** The threads on disk for the branch being reviewed — re-read, because the branch can change. */
  persistence: () => Persistence
  /** Saves one thread, and says nothing if it cannot. */
  keep: (id: string | undefined) => void
  /** How many rows of the diff are visible, which scrolling and clicking have to agree on. */
  listHeight: () => number
  /** Reloads the diff. */
  refresh: () => void
  /** The keys, given up while a dialog has them and taken back after. */
  takeKeys: () => void
  dropKeys: () => void
  close: () => void
  /** Right pane, or full screen. */
  cycle: () => void
  /** The package name the tools would be registered under, for deciding what submit sends. */
  reviewPackage: string
  /** The sources to cycle through. */
  sources: readonly Source[]
  /** The commit the working tree is on, for recording on a new thread. */
  head: () => string | undefined
  /** The pane's size, which is what the stream's heights are measured against. */
  viewport: () => Viewport
  /** Opens a binary's two versions in the system viewer. */
  viewer: Viewer
}

export interface Actions {
  move: (delta: number) => void
  scroll: (delta: number) => void
  /** The code sideways, by columns: negative is back towards the start of the lines. */
  pan: (delta: number) => void
  expand: (path?: string, gap?: Gap) => void
  resetContext: () => void
  swap: () => void
  enter: () => void
  toFiles: () => void
  comment: (whole?: boolean) => void
  replyHere: () => void
  commentOrReply: () => void
  selectRange: () => void
  uncomment: () => void
  markRead: () => void
  nextSource: () => void
  chooseBase: () => void
  /** Folds or unfolds a file — the one under the cursor, or the one named. */
  toggleFold: (path?: string) => void
  /** Marks a file viewed or not, without moving the cursor anywhere. */
  toggleViewed: (path?: string) => void
  /** A note on a whole file, from its heading. */
  commentFile: (path: string) => void
  submit: () => void
  toggleStats: () => void
  cycle: () => void
  close: () => void
  reload: () => void
  /** `o`: the file under the cursor, both versions, in the system's viewer. */
  openExternal: () => void
  /** `?`: every key, in the body's place — or back from it. */
  toggleKeys: () => void
  /** Back from the keys screen, if it is showing; true when it was. */
  leaveKeys: () => boolean
  /** `esc`: the keys screen first, then the review. */
  quit: () => void
}

export function createActions(deps: ActionDeps): Actions {
  const { api, surface, store, guard, queries, draw } = deps
  const takeKeys = deps.takeKeys
  const dropKeys = deps.dropKeys
  const close = deps.close
  const SOURCES = deps.sources
  const navigation = createNavigation(deps)
  const { listState, move, scroll, pan, toFiles, swap } = navigation
  const threads = createThreads(deps, navigation)
  const {
    comment,
    selectRange,
    replyHere,
    submit,
    uncomment,
    markRead,
    toggleViewed,
    toggleFold,
    commentFile,
  } = threads

  const changeExpansion = (path: string, expanded: ReadonlySet<number>) => {
    const before = navigation.streamNow()
    const width = navigation.width()
    const row = cursorRow(before, surface.review, surface.view, width)
    const scroll = streamScroll(before, surface.view, deps.listHeight())
    const all = new Map(surface.view.expanded ?? [])
    if (expanded.size) all.set(path, expanded)
    else all.delete(path)
    surface.view = { ...surface.view, expanded: all }
    const after = navigation.streamNow()
    let moved = false
    if (expanded.size === 0 && path === surface.view.file) {
      const segment = after.segments.find((item) => item.path === path)
      const lines = segment
        ? stopsOf(segment, surface.review, surface.view, width).filter(
            (line): line is number => line !== undefined,
          )
        : []
      const line = surface.view.line
      const anchor = surface.view.anchor
      if (line !== undefined && !lines.includes(line)) {
        const nearest = lines.reduce<number | undefined>(
          (best, candidate) =>
            best === undefined ||
            Math.abs(candidate - line) < Math.abs(best - line) ||
            (Math.abs(candidate - line) === Math.abs(best - line) && candidate > best)
              ? candidate
              : best,
          undefined,
        )
        surface.view = { ...surface.view, line: nearest, anchor: undefined }
        moved = true
      } else if (anchor !== undefined && !lines.includes(anchor)) {
        surface.view = { ...surface.view, anchor: undefined }
      }
    }
    const next = cursorRow(after, surface.review, surface.view, width)
    if (row !== undefined && next !== undefined)
      surface.view = { ...surface.view, scroll: Math.max(0, scroll + next - row) }
    if (moved) navigation.follow()
    draw()
  }

  const expand = (path = surface.view.file, selected?: Gap) => {
    if (!path || (!selected && surface.view.pane !== "diff")) return
    const file = store.current().changes.files.find((candidate) => candidate.path === path)
    if (!file || file.binary) return
    const expanded = new Set(surface.view.expanded?.get(path) ?? [])
    const gaps = diffSections(file.before, file.after, {
      context: surface.view.context ?? 3,
      expanded,
    }).filter((section): section is Gap => "start" in section)
    const line = surface.view.line
    const gap =
      selected ??
      (line === undefined
        ? undefined
        : gaps.sort((a, b) => {
            const distance = (g: Gap) => (line < g.start ? g.start - line : line - g.end)
            return distance(a) - distance(b) || b.start - a.start
          })[0])
    if (!gap) return
    if (gap.above) for (let i = gap.start; i <= Math.min(gap.end, gap.start + 9); i++) expanded.add(i)
    if (gap.below) for (let i = Math.max(gap.start, gap.end - 9); i <= gap.end; i++) expanded.add(i)
    changeExpansion(path, expanded)
  }

  const resetContext = () => {
    if (surface.view.pane === "diff" && surface.view.file) changeExpansion(surface.view.file, new Set())
  }

  /** Enter on a folder folds it; on a file it opens it and moves you into the diff. */
  const enter = () => {
    if (surface.view.pane === "diff") return toggleFold()
    const rows = navigableRows(store.current().changes, listState())
    const row = rows.find((candidate) => candidate.path === surface.view.cursor)
    if (!row) return
    if (row.kind === "file") {
      surface.view = { ...surface.view, file: row.path, scroll: undefined, pane: "diff", line: undefined }
    } else {
      const collapsed = new Set(surface.view.collapsed ?? [])
      if (collapsed.has(row.path)) collapsed.delete(row.path)
      else collapsed.add(row.path)
      surface.view = { ...surface.view, collapsed }
    }
    draw()
  }

  /** Uncommitted, then the branch, round and round. */
  const nextSource = () => {
    store.setSource(SOURCES[(SOURCES.indexOf(store.source()) + 1) % SOURCES.length] ?? "branch")
    deps.refresh()
  }

  /**
   * Picks the branch to compare against, and switches to branch mode — choosing a base while looking
   * at uncommitted work would change nothing you can see.
   */
  const chooseBase = () => {
    const cwd = api.state.path.worktree || api.state.path.directory
    void baseCandidates(cwd).then((found) => {
      const candidates = [...found].sort((a, b) => a.own - b.own || a.ref.localeCompare(b.ref))
      dropKeys()
      askForBase(
        api,
        {
          ...(store.base() ? { current: store.base() } : {}),
          ...(store.current().changes.base ? { guessed: store.current().changes.base } : {}),
          candidates,
        },
        (base) => {
          store.setBase(base)
          store.setSource("branch")
          deps.refresh()
        },
        () => {
          if (surface.open) takeKeys()
          draw()
        },
      )
    })
  }

  /**
   * The numbers are always being kept; this is only whether you are looking at them.
   *
   * A debug mode you have to switch on is off during every problem worth seeing, so the counting never
   * stops — and when something feels slow the evidence is already there.
   */
  const toggleStats = () => {
    surface.showStats = !surface.showStats
    guard.clear()
    draw()
  }

  /** Said in the footer, where you are looking, for a few seconds. */
  const tell = (text: string) => {
    surface.said = { text, at: Date.now() }
    draw()
  }

  /**
   * Both versions of the binary under the cursor, in the system's own viewer.
   *
   * Launched and not waited on — nothing here may block the thread the pane draws on. What goes wrong
   * later (the opener failing to start) arrives through the viewer's `report` and is said the same way.
   */
  const openExternal = () => {
    const file = store.current().changes.files.find((each) => each.path === surface.view.file)
    if (!file) return
    if (!file.binary) return tell("o opens images and other binaries in your viewer; this file is text")
    const cwd = api.state.path.worktree || api.state.path.directory
    guard.task("open", async () => {
      const result = await deps.viewer.open(cwd, file)
      if (result.problem) tell(result.problem)
    })
  }

  const toggleKeys = () => {
    surface.view = { ...surface.view, keys: !surface.view.keys }
    draw()
  }

  const leaveKeys = (): boolean => {
    if (!surface.view.keys) return false
    surface.view = { ...surface.view, keys: false }
    draw()
    return true
  }

  /**
   * Escape closes the nearest thing first, and the close is deferred: closing disposes the layer the
   * key is dispatching through.
   */
  const quit = () => {
    if (leaveKeys()) return
    setTimeout(() => close(), 0)
  }

  return {
    move,
    scroll,
    swap,
    enter,
    toFiles,
    comment,
    replyHere,
    /** One key for saying something: a thread where you are standing means you are answering it. */
    commentOrReply: () => (queries.reachableThreadId() ? replyHere() : comment()),
    selectRange,
    uncomment,
    markRead,
    nextSource,
    chooseBase,
    toggleFold,
    toggleViewed,
    commentFile,
    submit,
    toggleStats,
    pan,
    expand,
    resetContext,
    cycle: deps.cycle,
    close,
    reload: deps.refresh,
    openExternal,
    toggleKeys,
    leaveKeys,
    quit,
  }
}
