// The Construct's readout, drawn inside its wall of rain: a title and status,
// the trace log, the Agent Smith roster and the controls, each line decoding
// out of the rain. Pure functions, shared by the hooks module (the terminal's
// Raster) and the surface module (the desktop's Client region).
import type { MatrixSmith, MatrixTraceEntry } from '../types'
import { KATAKANA, glyph, hash } from './rain-core'
import type { Grid, Point, Region } from './rain-core'

/** A switch the Construct's controls flip. */
export type ConstructSwitch = 'sound' | 'voice' | 'rows' | 'operator' | 'morpheus'

/** What a control does when it is clicked or pressed. */
export type ConstructAction = { toggle: ConstructSwitch } | { pill: 'red' | 'blue' }

/** How the status line reads: at rest, tracing, slowed, glitched, or with Smiths about. */
export type ConstructTone = 'calm' | 'trace' | 'bullet' | 'glitch' | 'smith'

/** Everything the readout shows, as the hooks module gathers it. */
export type ConstructData = {
  /** When the hooks module gathered it, in epoch ms: the clock elapsed times count from. */
  now: number
  status: { text: string; tone: ConstructTone }
  stats: { calls: number; failures: number; bulletTimes: number; smiths: number }
  trace: MatrixTraceEntry[]
  smiths: MatrixSmith[]
  switches: Record<ConstructSwitch, boolean> & { isOn: boolean }
}

/** One line of readout: where it sits, what it says, and what a click on it does. */
export type ConstructLine = { key: string; x: number; y: number; text: string; color: number; action?: ConstructAction }

const WHITE = 0xf0fff0
const GREEN = 0x00ff41
const DIM = 0x008f11
const RED = 0xff3030
const TONE: Record<ConstructTone, number> = { calm: DIM, trace: GREEN, bullet: WHITE, glitch: RED, smith: WHITE }

const chars = (s: string) => Array.from(s)
/** `s` cut to `n` characters, an ellipsis marking the cut. */
const fit = (s: string, n: number) => (chars(s).length > n ? `${chars(s).slice(0, Math.max(0, n - 1)).join('')}…` : s)
const clockOf = (ms: number) => new Date(ms).toTimeString().slice(0, 8)
const span = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** The control tokens, in order: each switch with its state, then the pill that changes the look. */
export const constructControls = (d: ConstructData): { label: string; action: ConstructAction }[] => [
  ...(['sound', 'voice', 'rows', 'operator', 'morpheus'] as const).map(name => ({
    label: `[${name.toUpperCase()} ${d.switches[name] ? '●' : '○'}]`,
    action: { toggle: name } as ConstructAction,
  })),
  d.switches.isOn ? { label: '[BLUE PILL]', action: { pill: 'blue' } } : { label: '[RED PILL]', action: { pill: 'red' } },
]

/**
 * The readout's lines for a region `columns` by `rows`, the clock at `now`.
 * The controls and the roster keep their rows at the foot; the trace log
 * takes what is left, newest at the bottom.
 */
export const layoutConstruct = (columns: number, rows: number, d: ConstructData, now: number): ConstructLine[] => {
  const width = Math.max(8, columns - 4)
  const lines: ConstructLine[] = []
  let y = 1
  const add = (key: string, text: string, color: number, x = 2, action?: ConstructAction) =>
    lines.push({ key, x, y, text: fit(text, Math.max(1, columns - x - 2)), color, action })
  const row = (key: string, text: string, color: number) => {
    add(key, text, color)
    y += 1
  }

  row('title', '◢ THE CONSTRUCT', WHITE)
  row('status', d.status.text, TONE[d.status.tone])
  row('stats', `calls ${d.stats.calls} · glitches ${d.stats.failures} · bullet ${d.stats.bulletTimes} · smiths ${d.stats.smiths}`, DIM)
  y += 1

  // Lay the controls out first, wrapped to the width, to know the rows they need.
  const tokens = constructControls(d)
  const controlRows: { label: string; action: ConstructAction; x: number }[][] = [[]]
  let x = 2
  for (const token of tokens) {
    const length = chars(token.label).length
    if (x > 2 && x + length > 2 + width) {
      controlRows.push([])
      x = 2
    }
    controlRows[controlRows.length - 1]!.push({ ...token, x })
    x += length + 1
  }
  const smiths = d.smiths.slice(-5)
  const footer = 1 + Math.max(1, smiths.length) + 1 + 1 + controlRows.length + 1
  const traceRows = Math.max(1, rows - y - 1 - 1 - footer)

  row('trace-head', '◢ TRACE LOG', WHITE)
  const recent = d.trace.slice(-traceRows)
  if (recent.length === 0) row('trace-none', '  no calls traced yet', DIM)
  for (const t of recent) {
    const mark = t.ok === undefined ? '◌' : t.ok ? '✓' : '✖'
    const time = t.ms === undefined ? '…' : `${(t.ms / 1000).toFixed(1)}s`
    const color = t.ok === undefined ? WHITE : t.ok ? GREEN : RED
    row(`trace:${t.id}`, `${clockOf(t.at)} ${mark} ${time.padStart(5)} ${t.who}${t.tool}  ${t.summary}`, color)
  }
  y += 1

  row('smith-head', '◢ AGENT SMITHS', WHITE)
  if (smiths.length === 0) row('smith-none', '  none in the Matrix', DIM)
  for (const s of smiths) {
    const calls = `${s.calls} call${s.calls === 1 ? '' : 's'}`
    if (s.doneAt === undefined) row(`smith:${s.id}`, `◢ ${s.task}  ${span(now - s.since)}  ${calls}`, WHITE)
    else row(`smith:${s.id}`, `✓ ${s.task}  done in ${span(s.doneAt - s.since)}  ${calls}`, DIM)
  }
  y += 1

  row('controls-head', '◢ CONTROLS · click to switch', WHITE)
  for (const tokensOnRow of controlRows) {
    for (const token of tokensOnRow) add(`control:${JSON.stringify(token.action)}`, token.label, GREEN, token.x, token.action)
    y += 1
  }

  return lines.filter(line => line.y < rows)
}

/** What each line showed last, per character, and the frame each character last changed. */
export type DecodeMemory = Map<string, { text: string[]; since: number[] }>

/**
 * Draws the readout into a frame of rain: each line clears its cells (one
 * either side as a margin) and writes its characters. A character that is new
 * or changed decodes: katakana first, white-hot, then itself, sweeping left to
 * right. A control under the pointer is drawn inverted. Answers the regions
 * that now hold text, for laying the rows out.
 */
export const paintConstruct = (grid: Grid, lines: ConstructLine[], f: number, memory: DecodeMemory, pointer?: Point | null) => {
  const regions = new Map<number, Region[]>()
  const live = new Set<string>()
  for (const line of lines) {
    live.add(line.key)
    const text = chars(line.text)
    let seen = memory.get(line.key)
    if (!seen) memory.set(line.key, (seen = { text: [], since: [] }))
    text.forEach((ch, i) => {
      if (seen!.text[i] !== ch) {
        seen!.text[i] = ch
        seen!.since[i] = f
      }
    })
    seen.text.length = text.length
    seen.since.length = text.length

    const isHovered =
      line.action !== undefined && pointer != null && Math.floor(pointer.y) === line.y && pointer.x >= line.x && pointer.x < line.x + text.length
    const keyHash = hash(line.key.length, line.y)
    for (let i = -1; i <= text.length; i++) {
      const x = line.x + i
      if (x < 0 || x >= grid.columns || line.y >= grid.rows) continue
      const at = line.y * grid.columns + x
      let ch = ' '
      let color = -1
      const ink = text[i]
      if (ink !== undefined) {
        const lock = seen.since[i]! + 1 + Math.floor(i / 3) + ((keyHash + hash(i, 5)) % 5)
        if (ink === ' ' || f >= lock) {
          ch = ink
          color = isHovered ? 0x000000 : line.color
        } else {
          ch = glyph(i, f, KATAKANA)
          color = f >= lock - 2 ? WHITE : DIM
        }
      }
      grid.cp[at] = ch.codePointAt(0)!
      grid.fg[at] = color
      grid.bg[at] = isHovered && ink !== undefined ? line.color : -1
    }
    const start = Math.max(0, line.x - 1)
    const row = regions.get(line.y) ?? []
    row.push({ x: start, width: Math.min(grid.columns, line.x + text.length + 1) - start })
    regions.set(line.y, row)
  }
  for (const key of memory.keys()) if (!live.has(key)) memory.delete(key)

  return regions
}

/** The control a pointer at `at` is over, if any. */
export const actionAt = (lines: ConstructLine[], at: Point) =>
  lines.find(line => line.action && Math.floor(at.y) === line.y && at.x >= line.x && at.x < line.x + chars(line.text).length)?.action
