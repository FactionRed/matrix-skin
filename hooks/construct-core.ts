// The Construct's readout, drawn inside its wall of rain: a title and status,
// Zion and life in the Matrix, the Oracle, the trace log, the Keymaker's
// doors, the Agent Smith roster and the controls, each line decoding out of
// the rain. Pure functions, shared by the hooks module (the terminal's Raster)
// and the surface module (the desktop's Client region).
import type { MatrixDoor, MatrixLifetime, MatrixOracle, MatrixSmith, MatrixTraceEntry, MatrixZion } from '../types'
import { KATAKANA, glyph, hash } from './rain-core'
import type { Grid, Point, Region } from './rain-core'

/** A switch the Construct's controls flip. */
export type ConstructSwitch = 'sound' | 'voice' | 'rows' | 'operator' | 'morpheus'

/**
 * What a click or key on a line does: flip a switch, take a pill, consult the
 * Oracle, or open a trace line (the desktop's Client does that one itself).
 */
export type ConstructAction = { toggle: ConstructSwitch } | { pill: 'red' | 'blue' } | { oracle: true } | { expand: string }

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
  /** The working copy's git state; null until first read. */
  zion: MatrixZion | null
  /** The files opened most, most first, their paths shortened; and how many were opened in all. */
  doors: MatrixDoor[]
  doorCount: number
  oracle: MatrixOracle | null
  lifetime: MatrixLifetime
}

/** One line of readout: where it sits, what it says, and what a click on it does. */
export type ConstructLine = {
  key: string
  x: number
  y: number
  text: string
  color: number
  action?: ConstructAction
  /** A déjà vu loop: a few of its letters scramble every frame. */
  isGlitched?: boolean
}

const WHITE = 0xf0fff0
const PALE = 0xa8ffb8
const GREEN = 0x00ff41
const DIM = 0x008f11
const RED = 0xff3030
const DARK_RED = 0xb81818
const SHADE = 0x003b00 // under a trace line the pointer is over
const TONE: Record<ConstructTone, number> = { calm: DIM, trace: GREEN, bullet: WHITE, glitch: RED, smith: WHITE }
const DETAIL_ROWS = 6 // an opened trace line shows at most this many rows under it
const ORACLE_ROWS = 6 // a prophecy wraps onto at most this many rows: a narrow pane needs five or six

const chars = (s: string) => Array.from(s)
/** `s` cut to `n` characters, an ellipsis marking the cut. */
const fit = (s: string, n: number) => (chars(s).length > n ? `${chars(s).slice(0, Math.max(0, n - 1)).join('')}…` : s)
const clockOf = (ms: number) => new Date(ms).toTimeString().slice(0, 8)
const span = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
const count = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
const plural = (n: number, word: string) => `${count(n)} ${word}${n === 1 ? '' : 's'}`
const hours = (ms: number) => {
  const m = Math.floor(ms / 60_000)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`
}

/** `text` broken at spaces into lines of at most `n` characters. */
const wrap = (text: string, n: number) => {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word
    if (chars(next).length <= n || !line) line = next
    else {
      lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  return lines.map(l => fit(l, n))
}

/** Wrapped `lines` kept to `max` rows of `n` characters, the last ending in an ellipsis when words were cut. */
const clampRows = (lines: string[], max: number, n: number) =>
  lines.length <= max ? lines : [...lines.slice(0, max - 1), fit(`${lines.slice(max - 1).join(' ')}`, n)]

/** The control tokens, in order: each switch with its state, the Oracle, then the pill that changes the look. */
export const constructControls = (d: ConstructData): { label: string; action: ConstructAction }[] => [
  ...(['sound', 'voice', 'rows', 'operator', 'morpheus'] as const).map(name => ({
    label: `[${name.toUpperCase()} ${d.switches[name] ? '●' : '○'}]`,
    action: { toggle: name } as ConstructAction,
  })),
  { label: d.oracle?.isConsulting ? '[ORACLE …]' : '[ORACLE]', action: { oracle: true } },
  d.switches.isOn ? { label: '[BLUE PILL]', action: { pill: 'blue' } } : { label: '[RED PILL]', action: { pill: 'red' } },
]

/** Zion's one line: the branch, how far it is from its remote, and what changed. */
const zionLine = (z: MatrixZion | null): [string, number] => {
  if (!z) return ['ZION  dialing in…', DIM]
  if (!z.isRepo) return ['ZION  offline · no git repository here', DIM]
  const drift = `${z.ahead ? ` ↑${z.ahead}` : ''}${z.behind ? ` ↓${z.behind}` : ''}`
  return [`ZION  ${z.branch}${drift} · ${z.changed ? `${z.changed} changed` : 'clean'}`, z.changed ? WHITE : GREEN]
}

const lifeLine = (l: MatrixLifetime) =>
  `LIFE  ${hours(l.ms)} jacked in · ${plural(l.calls, 'call')} · ${plural(l.sessions, 'session')} · ${plural(l.smiths, 'smith')}`

/** A line before its row is known. */
type Token = Omit<ConstructLine, 'y'>

/**
 * A block of the readout. Space runs short from the bottom of the ranks up: the
 * lowest-ranked block goes first, and the header and the controls never go.
 * The flexible block (the trace log) takes what is left, its newest rows kept.
 */
type Section = { rank: number; gap: boolean; rows: Token[][]; flex?: boolean }

/**
 * The readout's lines for a region `columns` by `rows`, the clock at `now`,
 * the trace line `expanded` (its id) opened to show its detail.
 */
export const layoutConstruct = (columns: number, rows: number, d: ConstructData, now: number, expanded?: string): ConstructLine[] => {
  const width = Math.max(8, columns - 4)
  const one = (key: string, text: string, color: number, more: Partial<Token> = {}, x = 2): Token[] => [
    { key, x, text: fit(text, Math.max(1, columns - x - 2)), color, ...more },
  ]

  const header: Section = {
    rank: 100,
    gap: false,
    rows: [
      one('title', '◢ THE CONSTRUCT', WHITE),
      one('status', d.status.text, TONE[d.status.tone]),
      one('stats', `calls ${d.stats.calls} · glitches ${d.stats.failures} · bullet ${d.stats.bulletTimes} · smiths ${d.stats.smiths}`, DIM),
    ],
  }
  const [zionText, zionColor] = zionLine(d.zion)
  const zion: Section = { rank: 40, gap: false, rows: [one('zion', zionText, zionColor)] }
  const life: Section = { rank: 20, gap: false, rows: [one('life', lifeLine(d.lifetime), DIM)] }

  const oracle: Section | undefined = d.oracle
    ? {
        rank: 60,
        gap: true,
        rows: [
          one('oracle-head', '◢ THE ORACLE', WHITE),
          ...(d.oracle.isConsulting && !d.oracle.text
            ? [one('oracle-wait', '  The Oracle will see you now…', DIM)]
            : clampRows(wrap(d.oracle.text, Math.max(8, width - 2)), ORACLE_ROWS, Math.max(8, width - 2)).map((text, k) =>
                one(`oracle:${k}`, text, d.oracle!.isConsulting ? DIM : PALE, {}, 4))),
        ],
      }
    : undefined

  const traceRows: Token[][] = [one('trace-head', `◢ TRACE LOG${d.trace.some(t => t.detail) ? ' · click a call to open it' : ''}`, WHITE)]
  if (d.trace.length === 0) traceRows.push(one('trace-none', '  no calls traced yet', DIM))
  for (const t of d.trace) {
    const mark = t.ok === undefined ? '◌' : t.ok ? '✓' : '✖'
    const time = t.ms === undefined ? '…' : `${(t.ms / 1000).toFixed(1)}s`
    const color = t.ok === undefined ? WHITE : t.ok ? GREEN : RED
    const repeat = t.repeat ? `  ×${t.repeat}` : ''
    const isOpen = expanded === t.id && t.detail !== undefined
    traceRows.push(
      one(`trace:${t.id}`, `${clockOf(t.at)} ${mark} ${time.padStart(5)} ${t.who}${t.tool}  ${t.summary}${repeat}`, isOpen ? WHITE : color, {
        action: t.detail ? { expand: t.id } : undefined,
        isGlitched: (t.repeat ?? 0) >= 2,
      }),
    )
    if (isOpen) {
      t.detail!.slice(0, DETAIL_ROWS).forEach((line, k) =>
        traceRows.push(one(`detail:${t.id}:${k}`, `│ ${line}`, line.startsWith('$ ') ? PALE : t.ok ? DIM : DARK_RED, { action: { expand: t.id } }, 4)))
    }
  }
  const trace: Section = { rank: 80, gap: true, flex: true, rows: traceRows }

  const keymaker: Section = {
    rank: 30,
    gap: true,
    rows: [
      one('keys-head', `◢ THE KEYMAKER · ${plural(d.doorCount, 'door')} opened`, WHITE),
      ...(d.doors.length === 0
        ? [one('keys-none', '  no doors opened yet', DIM)]
        : d.doors.slice(0, 4).map(door =>
            one(`door:${door.path}`, `R${String(door.reads).padEnd(3)}E${String(door.edits).padEnd(3)} ${door.path}`, door.edits ? GREEN : DIM, {}, 4))),
    ],
  }

  const smithList = d.smiths.slice(-5)
  const smiths: Section = {
    rank: 70,
    gap: true,
    rows: [
      one('smith-head', '◢ AGENT SMITHS', WHITE),
      ...(smithList.length === 0 ? [one('smith-none', '  none in the Matrix', DIM)] : []),
      ...smithList.map(s => {
        const calls = plural(s.calls, 'call')
        return s.doneAt === undefined
          ? one(`smith:${s.id}`, `◢ ${s.task}  ${span(now - s.since)}  ${calls}`, WHITE)
          : one(`smith:${s.id}`, `✓ ${s.task}  done in ${span(s.doneAt - s.since)}  ${calls}`, DIM)
      }),
    ],
  }

  // The controls, wrapped to the width.
  const controlRows: Token[][] = [one('controls-head', '◢ CONTROLS · click to switch', WHITE), []]
  let x = 2
  for (const token of constructControls(d)) {
    const length = chars(token.label).length
    if (x > 2 && x + length > 2 + width) {
      controlRows.push([])
      x = 2
    }
    controlRows[controlRows.length - 1]!.push({ key: `control:${JSON.stringify(token.action)}`, x, text: token.label, color: GREEN, action: token.action })
    x += length + 1
  }
  const controls: Section = { rank: 100, gap: true, rows: controlRows }

  // Drop the lowest-ranked blocks until the rest fit a blank row above and below.
  const usable = rows - 2
  const heightOf = (s: Section) => (s.gap ? 1 : 0) + (s.flex ? 2 : s.rows.length)
  let kept = [header, zion, life, oracle, trace, keymaker, smiths, controls].filter((s): s is Section => s !== undefined)
  while (kept.reduce((n, s) => n + heightOf(s), 0) > usable) {
    const droppable = kept.filter(s => s.rank < 100)
    if (droppable.length === 0) break
    const lowest = droppable.reduce((a, b) => (b.rank < a.rank ? b : a))
    kept = kept.filter(s => s !== lowest)
  }
  const room = usable - kept.reduce((n, s) => n + (s.flex ? (s.gap ? 1 : 0) : heightOf(s)), 0)

  const lines: ConstructLine[] = []
  let y = 1
  for (const s of kept) {
    if (s.gap) y += 1
    const shown = s.flex ? [s.rows[0]!, ...s.rows.slice(1).slice(-Math.max(1, room - 1))] : s.rows
    for (const row of shown) {
      for (const token of row) lines.push({ ...token, y })
      y += 1
    }
  }

  return lines.filter(line => line.y < rows)
}

/** What each line showed last, per character, and the frame each character last changed. */
export type DecodeMemory = Map<string, { text: string[]; since: number[] }>

/**
 * Draws the readout into a frame of rain: each line clears its cells (one
 * either side as a margin) and writes its characters. A character that is new
 * or changed decodes: katakana first, white-hot, then itself, sweeping left to
 * right. A control under the pointer is drawn inverted, a trace line shaded;
 * a déjà vu line keeps glitching. Answers the regions that now hold text, for
 * laying the rows out.
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

    const isOver = line.action !== undefined && pointer != null && Math.floor(pointer.y) === line.y && pointer.x >= line.x && pointer.x < line.x + text.length
    const isOpener = line.action !== undefined && 'expand' in line.action
    const isHovered = isOver && !isOpener
    const isShaded = isOver && isOpener
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
        if (ink !== ' ' && f >= lock && line.isGlitched && hash(i + line.y * 131, f) % 12 === 0) {
          ch = glyph(i, f, KATAKANA)
          color = f % 2 === 0 ? WHITE : RED
        } else if (ink === ' ' || f >= lock) {
          ch = ink
          color = isHovered ? 0x000000 : line.color
        } else {
          ch = glyph(i, f, KATAKANA)
          color = f >= lock - 2 ? WHITE : DIM
        }
      }
      grid.cp[at] = ch.codePointAt(0)!
      grid.fg[at] = color
      grid.bg[at] = ink === undefined ? -1 : isHovered ? line.color : isShaded ? SHADE : -1
    }
    const start = Math.max(0, line.x - 1)
    const row = regions.get(line.y) ?? []
    row.push({ x: start, width: Math.min(grid.columns, line.x + text.length + 1) - start })
    regions.set(line.y, row)
  }
  for (const key of memory.keys()) if (!live.has(key)) memory.delete(key)

  return regions
}

/** The action of the line a pointer at `at` is over, if any. */
export const actionAt = (lines: ConstructLine[], at: Point) =>
  lines.find(line => line.action && Math.floor(at.y) === line.y && at.x >= line.x && at.x < line.x + chars(line.text).length)?.action
