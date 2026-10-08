import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { MatrixDoor, MatrixLifetime, MatrixOracle, MatrixSmith, MatrixStats, MatrixTraceEntry, MatrixZion } from '../types'
import { constructControls, layoutConstruct, paintConstruct } from './construct-core'
import type { ConstructAction, ConstructData, DecodeMemory } from './construct-core'
import { BOOT_FRAMES, DEJA_VU, GLITCH_TRAIL, KATAKANA, RAIN_MS, TRAIL, colorName, crawlOf, glyph, hash, nextSentinels, rainGrid } from './rain-core'
import type { Field, Grid, Overlay, Sentinel } from './rain-core'

// Palette: phosphor greens on the terminal's own background.
const GREEN = TRAIL[2]!
const DARK = TRAIL[5]!
const HEAD = '#d6ffd6'
const RED = GLITCH_TRAIL[2]!
const BLUE = '#3a8bff'

const SPINNER_WORDS = [
  'Decoding', 'Jacking in', 'Following the white rabbit', 'Bending the spoon',
  'Loading the construct', 'Reading the code', 'Dodging bullets', 'Tracing the call',
]
const DONE_WORDS = ['Jacked out', 'Decoded', 'Unplugged', 'Exited the construct']

const TICK_MS = 60 // message decode frame rate: each frame redraws the row, so keep it modest
const DECODE_FRAMES = 30 // a message decodes in about 1.8s whatever its length
const JITTER = 8 // frames a character's lock-in wanders from the sweep
const HOT = 2 // frames a character burns white before it locks in
const GRACE_MS = 1500 // rows drawn this soon after load are history: no animation
const BULLET_FRAMES = 50 // a tool running this long (4s at RAIN_MS) drops into bullet time
const GLITCH_FRAMES = 30 // the band glitches for about 2.4s at RAIN_MS
const BOOT_MS = BOOT_FRAMES * RAIN_MS // the jack-in sequence at session start
const SMITH_MS = 3500 // how long the band announces a newly deployed Agent Smith
const SMITH_SOUND_GAP_MS = 5000 // several Smiths deployed at once share one sound
const ANDERSON_GAP_MS = 10 * 60_000 // "Mr. Anderson..." at most once in ten minutes

const CONSTRUCT = 'matrix-construct'
const BAND_ROWS = 3 // the band's rain, in rows
const CONSTRUCT_ROWS = 12 // the least rain the Construct shows, in rows
const TRACE_KEEP = 40 // tool calls the trace log keeps
const SMITH_KEEP_MS = 60_000 // how long a finished Agent Smith stays on the roster
const DOOR_KEEP = 60 // files the Keymaker keeps count of
const ZION_DELAY_MS = 1500 // a burst of edits reads git once, after it settles
const LIFE_FLUSH_MS = 15_000 // how often this session's totals go into the store
const DETAIL_LINES = 6 // lines of a call's command and output kept for its opened trace line

// Calls that can change the working copy: Zion reads git again after each.
const ZION_TOOLS = new Set(['Bash', 'PowerShell', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
// Calls that open a file: the Keymaker counts them.
const READ_TOOLS = new Set(['Read'])
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

/**
 * Tool rows drawn as green trace lines, and the one line each shows. Tools not
 * listed keep the engine's own row: their bodies are diffs, checklists and
 * dialogs a one-line row would hide.
 */
const SUMMARY: Record<string, (first: (...keys: string[]) => string) => string> = {
  Bash: first => first('command'),
  PowerShell: first => first('command'),
  Read: first => first('file_path', 'path'),
  LS: first => first('file_path', 'path'),
  Grep: first => [first('pattern'), first('path')].filter(Boolean).join('  in '),
  Glob: first => [first('pattern'), first('path')].filter(Boolean).join('  in '),
  WebFetch: first => first('url'),
  WebSearch: first => first('query'),
  ToolSearch: first => first('query'),
  Agent: first => first('description', 'prompt'),
  Task: first => first('description', 'prompt'),
  Skill: first => first('skill'),
}

const MORPHEUS_VOICE = [
  '# Voice: Morpheus',
  'The person switched on Morpheus mode in the matrix-skin plugin. Write the prose of your replies in the voice of',
  'Morpheus from The Matrix: calm, certain, unhurried, a little cryptic, fond of its metaphors (the red pill, the',
  'construct, the white rabbit, "what is real?", "free your mind"). Keep it light: a turn of phrase, not a monologue.',
  'The voice never costs accuracy: code, commands, paths, numbers, errors and caveats stay exact and plain, and every',
  'other instruction still holds.',
].join('\n')

const OPERATOR_SYSTEM = [
  'You are Tank, the operator on the Nebuchadnezzar in The Matrix. You read what a coding assistant just told its',
  'user and radio a one-line report in Matrix slang (jacked in, the construct, the code, agents, a glitch, the white',
  'rabbit). Under 14 words. Plain text: no quotes, no emoji, no markdown. Say what was done or found; if the',
  'assistant asks the user something, say what it asks.',
].join(' ')

const ORACLE_SYSTEM = [
  'You are the Oracle from The Matrix: warm, wry, unhurried, a little cryptic. You are shown what a coding assistant',
  'has done this session: its recent tool calls (FAILED marks a failure), its subagents and the files it touched.',
  'Give one short prophecy about how the work is going or what to watch next, under 25 words. Ground it in the trace:',
  'name the real thing (a command that keeps failing, a file edited again and again) through a Matrix metaphor.',
  'Plain text: no quotes, no emoji, no markdown.',
].join(' ')

const isOn = atom({ plugin: 'matrix-skin', key: 'isOn' } as const, true)
const frame = atom({ plugin: 'matrix-skin', key: 'frame' } as const, 0)
const isGlitching = atom({ plugin: 'matrix-skin', key: 'isGlitching' } as const, false)
const trace = atom({ plugin: 'matrix-skin', key: 'trace' } as const, '')
const isBulletTime = atom({ plugin: 'matrix-skin', key: 'isBulletTime' } as const, false)
const isChoosing = atom({ plugin: 'matrix-skin', key: 'isChoosing' } as const, false)
const traceLog = atom({ plugin: 'matrix-skin', key: 'traceLog' } as const, [] as MatrixTraceEntry[])
const smithRoster = atom({ plugin: 'matrix-skin', key: 'smithRoster' } as const, [] as MatrixSmith[])
const isBooting = atom({ plugin: 'matrix-skin', key: 'isBooting' } as const, false)
const smithAnnounce = atom({ plugin: 'matrix-skin', key: 'smithAnnounce' } as const, '')
const isMorpheus = atom({ plugin: 'matrix-skin', key: 'isMorpheus' } as const, false)
const isOperator = atom({ plugin: 'matrix-skin', key: 'isOperator' } as const, true)
const isThemedRows = atom({ plugin: 'matrix-skin', key: 'isThemedRows' } as const, true)
const isSound = atom({ plugin: 'matrix-skin', key: 'isSound' } as const, true)
const isVoice = atom({ plugin: 'matrix-skin', key: 'isVoice' } as const, false)
const stats = atom({ plugin: 'matrix-skin', key: 'stats' } as const, { calls: 0, failures: 0, bulletTimes: 0, smiths: 0, tools: {} } as MatrixStats)
const sentinels = atom({ plugin: 'matrix-skin', key: 'sentinels' } as const, 0)
const zion = atom({ plugin: 'matrix-skin', key: 'zion' } as const, null as MatrixZion | null)
const doors = atom({ plugin: 'matrix-skin', key: 'doors' } as const, [] as MatrixDoor[])
const oracle = atom({ plugin: 'matrix-skin', key: 'oracle' } as const, null as MatrixOracle | null)
const ZERO_LIFE: MatrixLifetime = { ms: 0, calls: 0, failures: 0, smiths: 0, bulletTimes: 0, sessions: 0 }
const lifetime = atom({ plugin: 'matrix-skin', key: 'lifetime' } as const, ZERO_LIFE)

// The switches /matrix flips, each remembered across sessions under its store key.
const SWITCH_NAMES = ['morpheus', 'operator', 'rows', 'sound', 'voice'] as const
type SwitchName = (typeof SWITCH_NAMES)[number]
const STORE_KEY: Record<SwitchName, string> = { morpheus: 'isMorpheus', operator: 'isOperator', rows: 'isThemedRows', sound: 'isSound', voice: 'isVoice' }
const SAID: Record<SwitchName, [whenOn: string, whenOff: string]> = {
  morpheus: ['Morpheus mode on. "I can only show you the door."', 'Morpheus mode off.'],
  operator: ['Operator reports on: one line after each turn.', 'Operator reports off.'],
  rows: ['Tool rows drawn as trace lines.', 'Tool rows back to normal.'],
  sound: ['Sound on: the jack-in and Agent Smith.', 'Sound off.'],
  voice: ['Voice on: "Mister Anderson." when an Agent Smith deploys.', 'Voice off.'],
}

const pick = (list: string[], seed: string) => {
  let n = 0
  for (const ch of seed) n = (n * 31 + ch.charCodeAt(0)) >>> 0
  return list[n % list.length]!
}

const duration = (ms: number) => {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

/** How a turn ended, in one line: `◢ Jacked out after 12s`. */
const doneLine = (seed: string, ms: number) => `◢ ${pick(DONE_WORDS, seed)} after ${duration(ms)}`

/** The frame character `i` of `n` locks in: a left-to-right sweep that wanders. */
const lockAt = (i: number, n: number) => 1 + Math.floor((i / Math.max(1, n)) * (DECODE_FRAMES - JITTER - 1)) + (hash(i, 99) % JITTER)

export type Segment = { kind: 'clear' | 'hot' | 'noise'; text: string }

/** How a scrambled character is drawn: katakana, or a letter of like width. */
type Swap = (ch: string, i: number, f: number) => string

// A proportional font sets letters at different widths: a stand-in of the
// same width keeps every line where it wraps, so the row never changes height.
const LIKE_WIDTH = ['ijlt', 'fr', 'abcdeghknopqsuvxyz', 'mw', 'IJ', 'ABCDEFGHKLNOPRSTUVXYZ', 'MWQ', '0123456789']
const BUCKET: Record<string, string> = {}
for (const set of LIKE_WIDTH) for (const ch of set) BUCKET[ch] = set

/** The terminal is monospaced, and a half-width katakana is one cell: pure Matrix. */
const katakana: Swap = (_ch, i, f) => glyph(i, f, KATAKANA)
/** Other surfaces: a random letter from the original's width class. */
export const lookalike: Swap = (ch, i, f) => (BUCKET[ch] ? glyph(i, f, BUCKET[ch]) : ch)
const swapFor = (surface: string): Swap => (surface === 'terminal' ? katakana : lookalike)

/** Letters and digits scramble; spaces, punctuation and markdown's markers stay put. */
const isScrambled = (ch: string) => /[\p{L}\p{N}]/u.test(ch)

const LINK = /\]\([^)\s]*\)|https?:\/\/\S+/g

/** Code-point indexes inside link targets and bare URLs: scrambling them would break the link. */
const keptRanges = (text: string) => {
  const kept = new Set<number>()
  let unit = 0 // where the last match ended, in UTF-16 units
  let point = 0 // the same place, in code points
  for (const m of text.matchAll(LINK)) {
    for (const _ of text.slice(unit, m.index)) point++
    const length = Array.from(m[0]).length
    for (let i = 0; i < length; i++) kept.add(point + i)
    point += length
    unit = m.index! + m[0].length
  }
  return kept
}

/** A text's characters and the frame each locks in (0: never scrambled), worked out once per text. */
type Plan = { chars: string[]; lock: number[] }
const plans = new Map<string, Plan>()
const planOf = (text: string) => {
  let plan = plans.get(text)
  if (!plan) {
    const chars = Array.from(text)
    const kept = keptRanges(text)
    plan = { chars, lock: chars.map((ch, i) => (kept.has(i) || !isScrambled(ch) ? 0 : lockAt(i, chars.length))) }
    if (plans.size >= 32) plans.delete(plans.keys().next().value!)
    plans.set(text, plan)
  }
  return plan
}

/**
 * The text at frame f: every letter arrives scrambled in place, then burns
 * white and locks in, in a rippling sweep. Only letters and digits change, so
 * the message keeps its shape, its markdown and its line breaks throughout.
 */
export const decode = (text: string, f: number, swap: Swap = katakana) => {
  const { chars, lock } = planOf(text)
  const segments: Segment[] = []
  const push = (kind: Segment['kind'], ch: string) => {
    const last = segments[segments.length - 1]
    if (last && last.kind === kind) last.text += ch
    else segments.push({ kind, text: ch })
  }
  chars.forEach((ch, i) => {
    const at = lock[i]!
    if (f >= at) push('clear', ch)
    else if (f >= at - HOT) push('hot', swap(ch, i, f))
    else push('noise', swap(ch, i, Math.floor(f / 2)))
  })

  return { segments, text: segments.map(s => s.text).join(''), isDone: f >= DECODE_FRAMES }
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const toBase64 = (bytes: Uint8Array) => {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += BASE64[(n >> 18) & 63]! + BASE64[(n >> 12) & 63]!
    out += i + 1 < bytes.length ? BASE64[(n >> 6) & 63]! : '='
    out += i + 2 < bytes.length ? BASE64[n & 63]! : '='
  }
  return out
}

const DEFAULT = 0x01000000

/** A grid as the terminal's Raster cells. */
const cellsOf = (grid: Grid) => {
  const words = new Uint32Array(grid.columns * grid.rows * 3)
  for (let i = 0, j = 0; i < grid.columns * grid.rows; i++, j += 3) {
    words[j] = grid.cp[i]!
    words[j + 1] = grid.fg[i]! < 0 ? DEFAULT : grid.fg[i]!
    words[j + 2] = grid.bg[i]! < 0 ? DEFAULT : grid.bg[i]!
  }
  return toBase64(new Uint8Array(words.buffer))
}

/** One frame of code rain, as the terminal's Raster cells. */
export const rain = (columns: number, rows: number, t: number, f = 0, isWorking = true, overlay: Overlay = {}, field: Field = {}) =>
  cellsOf(rainGrid(columns, rows, t, f, isWorking, overlay, field))

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * Code rain as one self-animating SVG (SMIL), for the surfaces without a
 * Client region (the editor, mobile), where only the Construct draws it.
 */
export const rainSvg = (width: number, height: number, overlay: Overlay = {}) => {
  const trail = overlay.isGlitching ? GLITCH_TRAIL : TRAIL
  const slow = overlay.isBulletTime ? 7 : 1
  const CELL = 13
  const n = Math.floor(width / CELL)
  const r = (v: number) => Math.round(v * 100) / 100
  const columns: string[] = []
  for (let c = 0; c < n; c++) {
    const seed = hash(c, 11)
    if (seed % 100 >= 72) continue
    const len = 7 + (seed % 9)
    const span = len * CELL
    const dur = r((1.4 + ((seed >>> 8) % 25) / 10) * slow * Math.max(1, height / 120))
    const begin = r(-(((seed >>> 4) % 100) / 100) * dur)
    const xs = Array(len).fill('0').join(' ')
    const ys = Array.from({ length: len }, (_, i) => i * CELL).join(' ')
    const glyphs = Array.from({ length: len }, (_, i) => glyph(c * 17 + i, 1)).join('')
    columns.push(
      `<g><animateTransform attributeName="transform" type="translate" from="${c * CELL + 2} ${-span - CELL}" to="${c * CELL + 2} ${height + CELL}" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/>` +
        `<text x="${xs}" y="${ys}" fill="url(#tr)">${esc(glyphs)}</text>` +
        `<text y="${span}" fill="${trail[0]}" filter="url(#gl)">${esc(glyph(c, 3))}</text></g>`,
    )
  }

  const fontSize = Math.min(20, Math.round(Math.min(height, 56) * 0.36))
  const center = (text: string, size: number, fill: string) =>
    `<rect x="${width / 2 - text.length * size * 0.33 - 14}" y="${height / 2 - size * 0.85}" width="${text.length * size * 0.66 + 28}" height="${size * 1.7}" fill="#000" opacity="0.75" rx="3"/>` +
    `<text x="${width / 2}" y="${height / 2 + size * 0.35}" text-anchor="middle" font-size="${size}" fill="${fill}" filter="url(#gl)" xml:space="preserve">${esc(text)}</text>`
  const ripples = overlay.isBulletTime
    ? [0, 0.8, 1.6].map(d =>
        `<ellipse cx="${width / 2}" cy="${height / 2}" rx="0" ry="0" fill="none" stroke="${trail[1]}" stroke-width="1.5" opacity="0">` +
          `<animate attributeName="rx" values="10;${width / 4}" dur="2.4s" begin="${d}s" repeatCount="indefinite"/>` +
          `<animate attributeName="ry" values="3;${height}" dur="2.4s" begin="${d}s" repeatCount="indefinite"/>` +
          `<animate attributeName="opacity" values="0.8;0" dur="2.4s" begin="${d}s" repeatCount="indefinite"/></ellipse>`,
      ).join('')
    : ''
  const readout = overlay.isGlitching
    ? `<g><animateTransform attributeName="transform" type="translate" values="0 0;5 -1;-4 1;2 0;0 0" dur="0.25s" repeatCount="indefinite"/>${center(DEJA_VU, fontSize, trail[2]!)}</g>`
    : overlay.trace
    ? ripples + center(overlay.isBulletTime ? `◢ TRACE  ${overlay.trace}  ·  BULLET TIME` : `◢ TRACE  ${overlay.trace}`, Math.round(fontSize * 0.8), overlay.isBulletTime ? trail[1]! : trail[2]!)
    : ''

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid slice">` +
    `<defs>` +
    `<linearGradient id="tr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${trail[7]}" stop-opacity="0"/><stop offset="0.55" stop-color="${trail[5]}"/><stop offset="0.9" stop-color="${trail[2]}"/><stop offset="1" stop-color="${trail[1]}"/></linearGradient>` +
    `<filter id="gl" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>` +
    `</defs>` +
    `<rect width="100%" height="100%" fill="#000"/>` +
    `<g font-family="'MS Gothic','Osaka-Mono',ui-monospace,monospace" font-size="12">${columns.join('')}</g>` +
    `<g font-family="ui-monospace,'Cascadia Mono',Consolas,monospace">${readout}</g>` +
    `<path d="M0 0.5H${width}M0 ${height - 0.5}H${width}" stroke="${trail[2]}" stroke-opacity="0.35"/>` +
    `</svg>`
  )
}

/** The one line of a tool call worth showing: its command, path, pattern or task. */
export const toolSummary = (tool: string, input: unknown) => {
  const i = (input ?? {}) as Record<string, unknown>
  const first = (...keys: string[]) => {
    for (const k of keys) if (typeof i[k] === 'string' && i[k]) return i[k] as string
    return ''
  }
  return (SUMMARY[tool]?.(first) ?? '').split('\n')[0]!.slice(0, 160)
}

/** A tool call's line in the trace log: its summary, else its first text argument. */
const traceSummary = (tool: string, input: Record<string, unknown>) => {
  const fallback = Object.entries(input).find(([k, v]) => typeof v === 'string' && v && !['tool', 'tool_use_id', 'agentId'].includes(k))
  return (toolSummary(tool, input) || String(fallback?.[1] ?? '')).split('\n')[0]!.slice(0, 160)
}

/** A path's last two parts, `hooks/register.tsx`: enough to know the file, and no more of the machine. */
const shortPath = (path: string) => path.split(/[\\/]/).filter(Boolean).slice(-2).join('/')

// Escape sequences and control characters: a tool's output carries colors no Text draws.
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f]/g

/** What an opened trace line shows: the call's command, then the tail of its output. */
export const detailOf = (input: Record<string, unknown>, output: string) => {
  const clean = (line: string) => line.replace(ANSI, '').replace(/\t/g, '  ').replace(CONTROL, '').trimEnd().slice(0, 200)
  const command = typeof input.command === 'string' ? input.command : ''
  const head = command.split('\n').map(clean).filter(l => l.trim()).slice(0, 2).map(l => `$ ${l.trim()}`)
  const tail = output.split(/\r?\n/).map(clean).filter(l => l.trim()).slice(-(DETAIL_LINES - head.length))
  return [...head, ...(tail.length ? tail : ['(no output)'])]
}

/**
 * How many times in a row the same call has now failed, `entry` counted: the
 * same tool, input and caller, back through the recent log to its last success.
 */
export const repeatOf = (log: MatrixTraceEntry[], entry: MatrixTraceEntry) => {
  let n = 1
  for (const t of log.slice(-12).reverse()) {
    if (t.id === entry.id || t.ok === undefined || t.who !== entry.who || t.tool !== entry.tool || t.summary !== entry.summary) continue
    if (t.ok) break
    n += 1
  }
  return n
}

/** `git status --porcelain --branch`, read as Zion: the branch, its drift from the remote, and what changed. */
export const parseZion = (out: string): MatrixZion => {
  const lines = out.split(/\r?\n/).filter(Boolean)
  const head = lines[0]?.startsWith('## ') ? lines.shift()!.slice(3) : ''
  const branch = head.startsWith('No commits yet on ') ? head.slice('No commits yet on '.length)
    : head.startsWith('HEAD (no branch)') ? 'detached'
    : head.split('...')[0]!.split(' ')[0]!
  return {
    isRepo: true,
    branch: branch || 'unknown',
    ahead: Number(/ahead (\d+)/.exec(head)?.[1] ?? 0),
    behind: Number(/behind (\d+)/.exec(head)?.[1] ?? 0),
    changed: lines.length,
  }
}

const addLife = (a: MatrixLifetime, b: Partial<MatrixLifetime>): MatrixLifetime => ({
  ms: a.ms + (b.ms ?? 0),
  calls: a.calls + (b.calls ?? 0),
  failures: a.failures + (b.failures ?? 0),
  smiths: a.smiths + (b.smiths ?? 0),
  bulletTimes: a.bulletTimes + (b.bulletTimes ?? 0),
  sessions: a.sessions + (b.sessions ?? 0),
})
/** The stored totals, whatever the store holds. */
const lifeOf = (value: unknown): MatrixLifetime => {
  const v = (value ?? {}) as Record<string, unknown>
  const n = (k: keyof MatrixLifetime) => (typeof v[k] === 'number' && Number.isFinite(v[k]) ? (v[k] as number) : 0)
  return { ms: n('ms'), calls: n('calls'), failures: n('failures'), smiths: n('smiths'), bulletTimes: n('bulletTimes'), sessions: n('sessions') }
}

/** What the Oracle is shown: the session's recent calls, its Smiths and the files it touched. */
const oraclePrompt = (log: MatrixTraceEntry[], roster: MatrixSmith[], s: MatrixStats, opened: MatrixDoor[]) =>
  [
    `Tool calls: ${s.calls}, failures: ${s.failures}, subagents: ${s.smiths ?? 0}.`,
    log.length ? 'Recent tool calls, oldest first:' : 'No tool calls yet.',
    ...log.slice(-20).map(t => `${t.ok === false ? 'FAILED ' : ''}${t.who}${t.tool}: ${t.summary}${t.repeat ? ` (failed ${t.repeat} times in a row)` : ''}`),
    roster.length ? `Subagents: ${roster.map(r => r.task).join('; ')}` : '',
    opened.length ? `Files touched most: ${opened.slice(0, 5).map(d => `${shortPath(d.path)} (read ${d.reads}, edited ${d.edits})`).join('; ')}` : '',
  ].filter(Boolean).join('\n').slice(0, 4000)

/** A terminal site whose Raster the rain timer repaints: the band or the Construct. */
type RainSite = {
  key: string
  id: string
  columns: number
  rows: number
  isWorking: boolean
  t: number
  f: number
  overlay: Overlay
  bootF?: number
  /** The Sentinels crossing, and the failed calls it has sent them for. */
  sentinels: Sentinel[]
  failures?: number
  /** The Construct's readout, the frame it arrived on, and its decode memory. */
  data?: ConstructData
  dataF?: number
  memory?: DecodeMemory
}

/** A site's boot frames so far (counted from when its overlay starts booting) and its Sentinels. */
const fieldOf = (site: RainSite): Field => {
  site.bootF = site.overlay.isBooting ? (site.bootF ?? site.f) : undefined
  return { bootFrames: site.bootF === undefined ? 0 : site.f - site.bootF, sentinels: site.sentinels }
}

/** The Construct's Raster: its rain, with the readout decoding into it. */
const constructCells = (site: RainSite) => {
  const grid = rainGrid(site.columns, site.rows, site.t, site.f, true, site.overlay, fieldOf(site))
  if (site.data && !site.overlay.isBooting) {
    const now = site.data.now + (site.f - (site.dataF ?? site.f)) * RAIN_MS
    paintConstruct(grid, layoutConstruct(site.columns, site.rows, site.data, now), site.f, (site.memory ??= new Map()))
  }
  return cellsOf(grid)
}

const clockState = { loadedAt: 0 }
type Timer = { cancel: () => void }
const timers: { ticker?: Timer; rain?: Timer; boot?: Timer; life?: Timer; isTicking: boolean } = { isTicking: false }
const seen = new Set<string>()
const active = new Set<string>() // the rows decoding now, by requestId
const band: RainSite = { key: 'rain', id: '', columns: 0, rows: 0, isWorking: false, t: 0, f: 0, overlay: {}, sentinels: [] }
const construct: RainSite = { key: 'construct-rain', id: '', columns: 0, rows: 0, isWorking: true, t: 0, f: 0, overlay: {}, sentinels: [] }
const glitchState = { frames: 0 }
const tools = { running: 0, since: 0, frames: 0, isBullet: false }
const statusLine = { trace: '', done: '', operator: '', turnId: '' }
const announce = { token: 0 } // the latest Smith announcement, so an older one's timer leaves it be
const heard = { smith: -Infinity, anderson: -Infinity } // when each Smith sound last played
const zionRead = { token: 0 } // the latest git read asked for, so an older one's timer leaves it be
const life = { pending: { ...ZERO_LIFE }, isDirty: false } // this session's totals not yet stored

async function tick($: EngineInterface) {
  if (timers.isTicking || active.size === 0) return
  timers.isTicking = true
  try {
    await Promise.all(
      [...active].map(async requestId => {
        const f = await update($, memberOf(frame, { requestId }), n => n + 1)
        if (f >= DECODE_FRAMES) active.delete(requestId)
      }),
    )
  } finally {
    timers.isTicking = false
  }
}

/** Whether this row should play its decode: first seen after load, look on. */
async function shouldAnimate($: EngineInterface, requestId: string) {
  if (!seen.has(requestId)) {
    seen.add(requestId)
    if ((await $.clock.now()) - clockState.loadedAt >= GRACE_MS) active.add(requestId)
  }

  return active.has(requestId)
}

// The engine has no clip player or synthesizer on Windows, so there the
// plugin hands its WAV files to Windows' own SoundPlayer and speaks with
// Windows' own voice, through PowerShell.
const host: { isWindows?: Promise<boolean> } = {}
const isWindows = ($: EngineInterface) =>
  (host.isWindows ??= $.env.get('OS').then(os => os === 'Windows_NT', () => false))

/** Plays one of the plugin's clips while the look and sound are on; silent where nothing can play it. */
async function playSound($: EngineInterface, asset: string) {
  const [lookOn, soundOn] = await Promise.all([read($, isOn), read($, isSound)])
  if (!lookOn || !soundOn) return
  try {
    if (await isWindows($)) {
      // The clip's path goes in through the environment, so the command itself never changes.
      await $.process.run(
        ['powershell', '-NoProfile', '-NonInteractive', '-Command', '(New-Object Media.SoundPlayer $env:MATRIX_SKIN_CLIP).PlaySync()'],
        { timeoutMs: 15000, env: { MATRIX_SKIN_CLIP: `${$.plugin.root}/${asset}` } }, // .NET takes forward slashes on Windows
      )
    } else {
      await $.audio.play({ asset }, { gain: 0.8 })
    }
  } catch {
    // No player on this machine (a Linux terminal has none): the look stays silent.
  }
}

/** Agent Smith says "Mister Anderson." in a low, slow voice, where the machine can speak. */
async function sayAnderson($: EngineInterface) {
  try {
    if (await isWindows($)) {
      await $.process.run(
        [
          'powershell', '-NoProfile', '-NonInteractive', '-Command',
          "Add-Type -AssemblyName System.Speech; $v = New-Object System.Speech.Synthesis.SpeechSynthesizer; try { $v.SelectVoiceByHints('Male') } catch {}; $v.Rate = -3; $v.Speak('Mister Anderson.')",
        ],
        { timeoutMs: 15000 },
      )
    } else {
      await $.audio.speak('Mister Anderson.')
    }
  } catch {
    // No speech synthesizer here: the stab alone will do.
  }
}

/** Agent Smith's sound: the stab for a deployment, and now and then his voice. */
async function smithSound($: EngineInterface) {
  const now = await $.clock.now()
  if (now - heard.smith < SMITH_SOUND_GAP_MS) return
  heard.smith = now
  await playSound($, 'sounds/smith.wav')
  const [soundOn, voiceOn] = await Promise.all([read($, isSound), read($, isVoice)])
  if (!soundOn || !voiceOn || now - heard.anderson < ANDERSON_GAP_MS) return
  heard.anderson = now
  await sayAnderson($)
}

/** What the rain shows over itself now. */
async function readOverlay($: EngineInterface): Promise<Overlay> {
  const [traced, glitching, bulletTime, booting, smith, failures] = await Promise.all([
    read($, trace),
    read($, isGlitching),
    read($, isBulletTime),
    read($, isBooting),
    read($, smithAnnounce),
    read($, sentinels),
  ])
  return { trace: traced, isGlitching: glitching, isBulletTime: bulletTime, isBooting: booting, smith, sentinels: failures }
}

/** Everything the Construct's readout shows, gathered from state: the last `keep` calls of the trace log. */
async function constructData($: EngineInterface, overlay: Overlay, keep = TRACE_KEEP): Promise<ConstructData> {
  const [now, s, log, roster, lookOn, sound, voice, rows, operator, morpheus, git, opened, word, totals] = await Promise.all([
    $.clock.now(),
    read($, stats),
    read($, traceLog),
    read($, smithRoster),
    read($, isOn),
    read($, isSound),
    read($, isVoice),
    read($, isThemedRows),
    read($, isOperator),
    read($, isMorpheus),
    read($, zion),
    read($, doors),
    read($, oracle),
    read($, lifetime),
  ])
  const running = roster.filter(r => r.doneAt === undefined).length
  // A déjà vu loop: the last call to finish failed as the ones before it did.
  const last = [...log].reverse().find(t => t.ok !== undefined)
  const loop = last && last.ok === false && (last.repeat ?? 0) >= 2 ? `DÉJÀ VU  ${last.who}${last.tool} ${last.summary} ×${last.repeat}` : ''
  const status: ConstructData['status'] = overlay.isGlitching
    ? { text: loop ? `${loop} · going in circles` : 'GLITCH: déjà vu. They changed something.', tone: 'glitch' }
    : overlay.isBulletTime
    ? { text: `BULLET TIME: ${overlay.trace} is taking its time`, tone: 'bullet' }
    : running > 0
    ? { text: `${running} AGENT SMITH${running === 1 ? '' : 'S'} IN THE MATRIX`, tone: 'smith' }
    : overlay.trace
    ? { text: `TRACING ${overlay.trace}`, tone: 'trace' }
    : loop
    ? { text: loop, tone: 'glitch' }
    : { text: 'OPERATOR STANDING BY', tone: 'calm' }

  return {
    now,
    status,
    stats: { calls: s.calls, failures: s.failures, bulletTimes: s.bulletTimes, smiths: s.smiths ?? 0 },
    trace: log.slice(-keep),
    smiths: roster.filter(r => r.doneAt === undefined || now - r.doneAt < SMITH_KEEP_MS),
    switches: { isOn: lookOn, sound, voice, rows, operator, morpheus },
    zion: git,
    doors: opened.slice(0, 4).map(d => ({ ...d, path: shortPath(d.path) })),
    doorCount: opened.length,
    oracle: word,
    lifetime: totals,
  }
}

/** What a Construct control does: flip its switch, take its pill, or consult the Oracle. */
async function act($: EngineInterface, action: ConstructAction) {
  if ('pill' in action) await choose($, action.pill)
  else if ('toggle' in action) await flip($, action.toggle, '')
  else if ('oracle' in action) {
    const word = await read($, oracle)
    if (word?.isConsulting) return
    const at = await $.clock.now()
    await update($, oracle, () => ({ text: word?.text ?? '', at, isConsulting: true }))
    // Off the click's own dispatch: she takes her time.
    $.clock.after(1, () => void consultOracle($))
  }
}

/** The Oracle's prophecy on the session so far, from a small model. */
async function consultOracle($: EngineInterface) {
  const [log, roster, s, opened] = await Promise.all([read($, traceLog), read($, smithRoster), read($, stats), read($, doors)])
  let text = 'The Oracle is not taking visitors right now. Come back later.'
  try {
    const r = await $.model.complete({ model: 'haiku', system: ORACLE_SYSTEM, prompt: oraclePrompt(log, roster, s, opened), maxTokens: 120, effort: 'low', timeoutMs: 20000 })
    const said = r.isAnswered ? r.text.replace(/\s+/g, ' ').trim().replace(/^["'“]+|["'”]+$/g, '').slice(0, 240) : ''
    if (said) text = said
  } catch {
    // No answer: she is out.
  }
  const at = await $.clock.now()
  await update($, oracle, () => ({ text, at, isConsulting: false }))
}

/** Reads git again once a burst of calls settles: Zion's line. */
function refreshZion($: EngineInterface, delay = ZION_DELAY_MS) {
  const token = ++zionRead.token
  $.clock.after(delay, async () => {
    if (zionRead.token !== token) return
    let git: MatrixZion = { isRepo: false, branch: '', ahead: 0, behind: 0, changed: 0 }
    try {
      const r = await $.process.run(['git', 'status', '--porcelain=v1', '--branch'], { timeoutMs: 10000, env: { GIT_OPTIONAL_LOCKS: '0' } })
      if (r.exitCode === 0) git = parseZion(r.stdout)
    } catch {
      // No git on this machine: Zion is offline.
    }
    await update($, zion, () => git)
  })
}

/** Counts a file a call opened: a door the Keymaker knows. */
async function openDoor($: EngineInterface, tool: string, input: Record<string, unknown>) {
  const raw = typeof input.file_path === 'string' ? input.file_path : typeof input.notebook_path === 'string' ? input.notebook_path : ''
  const isEdit = EDIT_TOOLS.has(tool)
  if (!raw || (!isEdit && !READ_TOOLS.has(tool))) return
  const path = raw.replace(/\\/g, '/')
  const weight = (d: MatrixDoor) => d.edits * 2 + d.reads
  await update($, doors, list => {
    const found = list.some(d => d.path === path)
    const next = found ? list.map(d => (d.path === path ? { ...d, reads: d.reads + (isEdit ? 0 : 1), edits: d.edits + (isEdit ? 1 : 0) } : d))
      : [...list, { path, reads: isEdit ? 0 : 1, edits: isEdit ? 1 : 0 }]
    return next.sort((a, b) => weight(b) - weight(a)).slice(0, DOOR_KEEP)
  })
}

/** Adds to the totals across sessions: shown at once, stored on the next flush. */
function bumpLife($: EngineInterface, delta: Partial<MatrixLifetime>) {
  life.pending = addLife(life.pending, delta)
  life.isDirty = true
  return update($, lifetime, l => addLife(l, delta))
}

/** Puts this session's new totals into the store, on top of whatever other sessions put there. */
async function flushLife($: EngineInterface) {
  if (!life.isDirty) return
  const delta = life.pending
  Object.assign(life, { pending: { ...ZERO_LIFE }, isDirty: false })
  const total = addLife(lifeOf(await $.store.get('lifetime')), delta)
  await $.store.set('lifetime', total)
  await update($, lifetime, () => addLife(total, life.pending))
}

/** The rows the terminal's control Buttons wrap onto, at `columns` across. */
const buttonRows = (d: ConstructData, columns: number) => {
  let rows = 1
  let x = 0
  for (const { label } of constructControls(d)) {
    const width = Array.from(label).length
    if (x > 0 && x + width > columns) {
      rows += 1
      x = 0
    }
    x += width + 1
  }
  return rows
}

/** The one writer of the status line: the running tool's trace, else how the last turn went. */
function renderStatus($: EngineInterface) {
  const line = tools.running > 0 ? statusLine.trace : [statusLine.done, statusLine.operator].filter(Boolean).join(' · ')
  $.ui.status(line || undefined)
}

/** Red or blue: the look on or off, remembered, and the choice put away. */
async function choose($: EngineInterface, pill: 'red' | 'blue') {
  const isRed = pill === 'red'
  await Promise.all([update($, isOn, () => isRed), $.store.set('isOn', isRed), update($, isChoosing, () => false)])
  if (!isRed) {
    Object.assign(statusLine, { trace: '', done: '', operator: '' })
    $.ui.status(undefined)
  }
  $.ui.toast(isRed ? 'Welcome to the real world.' : 'The story ends. You wake up in your bed.')

  return isRed
}

/** Sets a /matrix switch (`on`, `off`, or the other way round) and remembers it. */
async function flip($: EngineInterface, name: SwitchName, value: string) {
  const to = (was: boolean) => (value === 'on' ? true : value === 'off' ? false : !was)
  const now =
    name === 'morpheus' ? await update($, isMorpheus, to)
    : name === 'operator' ? await update($, isOperator, to)
    : name === 'rows' ? await update($, isThemedRows, to)
    : name === 'sound' ? await update($, isSound, to)
    : await update($, isVoice, to)
  await $.store.set(STORE_KEY[name], now)
  return now
}

/** The operator's one-line radio report on a finished turn, from a small model. */
async function operatorReport($: EngineInterface, answer: string, turnId: string) {
  const r = await $.model.complete({ model: 'haiku', system: OPERATOR_SYSTEM, prompt: answer, maxTokens: 60, effort: 'low', timeoutMs: 10000 }).catch(() => undefined)
  if (!r?.isAnswered || statusLine.turnId !== turnId) return
  const line = r.text.replace(/\s+/g, ' ').trim().replace(/^["'“]+|["'”]+$/g, '').slice(0, 100)
  if (!line) return
  statusLine.operator = `Operator: ${line}`
  renderStatus($)
}

const HELP = [
  '/matrix: choose the red pill (on) or the blue pill (off).',
  '/matrix red | blue: choose at once.',
  '/matrix morpheus [on|off]: Claude answers in the voice of Morpheus.',
  '/matrix operator [on|off]: a one-line operator report after each turn (a small model call).',
  '/matrix rows [on|off]: tool rows as green trace lines.',
  '/matrix sound [on|off]: sound for the jack-in and Agent Smith.',
  '/matrix voice [on|off]: "Mister Anderson." when an Agent Smith deploys (needs sound on).',
  '/construct: the operator console. Click a trace line to open it, and [ORACLE] for a prophecy (a small model call).',
].join('\n')

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    clockState.loadedAt = await $.clock.now()
    const [saved, morpheus, operator, rows, sound, voice] = await Promise.all([
      $.store.get('isOn'),
      $.store.get('isMorpheus'),
      $.store.get('isOperator'),
      $.store.get('isThemedRows'),
      $.store.get('isSound'),
      $.store.get('isVoice'),
    ])
    // Life in the Matrix: the stored totals, and this session counted once (a reload is the same session).
    const [storedLife, seenSessions] = await Promise.all([$.store.get('lifetime'), $.store.get('seenSessions')])
    let sessionId = ''
    try {
      sessionId = await $.session.id()
    } catch {
      // No id to tell this session from the last: count none.
    }
    const seenIds = Array.isArray(seenSessions) ? (seenSessions as unknown[]).filter((v): v is string => typeof v === 'string') : []
    if (sessionId && !seenIds.includes(sessionId)) {
      life.pending = addLife(life.pending, { sessions: 1 })
      life.isDirty = true
      await $.store.set('seenSessions', [...seenIds, sessionId].slice(-20))
    }
    await update($, lifetime, () => addLife(lifeOf(storedLife), life.pending))
    const restore = (value: unknown) => (was: boolean) => (typeof value === 'boolean' ? value : was)
    await Promise.all([
      update($, isOn, restore(saved)),
      update($, isMorpheus, restore(morpheus)),
      update($, isOperator, restore(operator)),
      update($, isThemedRows, restore(rows)),
      update($, isSound, restore(sound)),
      update($, isVoice, restore(voice)),
      // A reload starts this module's counters over but keeps $.state: put the
      // passing effects back to rest so none outlives the counter that ends it.
      update($, isGlitching, () => false),
      update($, isBulletTime, () => false),
      update($, trace, () => ''),
      update($, smithRoster, () => []),
      update($, traceLog, log => log.filter(t => t.ok !== undefined)), // calls cut short by the reload
      update($, smithAnnounce, () => ''),
      // Every session opens with the jack-in sequence while the look is on.
      update($, isBooting, () => saved !== false),
      $.command.register({ name: 'matrix', description: 'Red pill or blue pill; also /matrix morpheus, operator, rows (on|off), help' }),
      $.command.register({ name: 'construct', description: 'Open the Construct: a live operator console of the Matrix' }),
    ])
    // A visible sign the mod loaded in this session.
    $.ui.toast(saved === false ? 'Matrix skin loaded (off): type /matrix red to switch it on' : '◢ Matrix skin loaded. Wake up, Neo...')
    timers.ticker?.cancel()
    timers.rain?.cancel()
    timers.boot?.cancel()
    timers.life?.cancel()
    timers.life = $.clock.every(LIFE_FLUSH_MS, () => void flushLife($))
    refreshZion($)
    timers.boot = $.clock.after(BOOT_MS, () => void update($, isBooting, () => false))
    // The jack-in's sound, off the session's own dispatch so start never waits for it.
    if (saved !== false) $.clock.after(1, () => void playSound($, 'sounds/boot.wav'))
    timers.ticker = $.clock.every(TICK_MS, () => void tick($))
    timers.rain = $.clock.every(RAIN_MS, () => {
      tools.frames += 1
      if (glitchState.frames > 0 && --glitchState.frames === 0) void update($, isGlitching, () => false)
      // A tool that runs long enough slows the world down.
      if (tools.running > 0 && !tools.isBullet && tools.frames - tools.since >= BULLET_FRAMES) {
        tools.isBullet = true
        void update($, isBulletTime, () => true)
        void update($, stats, s => ({ ...s, bulletTimes: s.bulletTimes + 1 }))
        void bumpLife($, { bulletTimes: 1 })
      }
      // Only the terminal's Rasters are pushed from here: a Client animates itself.
      for (const site of [band, construct]) {
        if (!site.id) continue
        site.f += 1
        if (site.f % crawlOf(site.isWorking, site.overlay) === 0) site.t += 1
        site.sentinels = nextSentinels(site.sentinels, site.failures, site.overlay.sentinels ?? 0)
        site.failures = site.overlay.sentinels ?? 0
        const cells = site === construct ? constructCells(site) : rain(site.columns, site.rows, site.t, site.f, site.isWorking, site.overlay, fieldOf(site))
        void $.ui.blit({ requestId: site.id, key: site.key, cells })
      }
    })

    return next(e)
  })

  on('command.run', { command: 'matrix' }, async ($, e) => {
    const [word = '', value = ''] = e.args.trim().toLowerCase().split(/\s+/)
    if (word === 'red' || word === 'on') {
      await choose($, 'red')
      return { text: 'You took the red pill. Welcome to the real world.' }
    }
    if (word === 'blue' || word === 'off') {
      await choose($, 'blue')
      return { text: 'You took the blue pill. Matrix look off.' }
    }
    if (word === 'help') return { text: HELP }
    if ((SWITCH_NAMES as readonly string[]).includes(word)) {
      const name = word as SwitchName
      return { text: SAID[name][(await flip($, name, value)) ? 0 : 1] }
    }
    await update($, isChoosing, () => true)

    return { text: 'This is your last chance. Choose in the band above the prompt: 1 for the red pill, 2 for the blue.' }
  })

  on('command.run', { command: 'construct' }, async $ => {
    await $.ui.open({ id: CONSTRUCT, title: '◢ The Construct' })
    refreshZion($, 1)

    return { text: 'Loading the Construct.' }
  })

  // Your prompts: a green `>` and green text that decodes out of the rain.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (!(await read($, isOn)) || e.props.origin.kind !== 'composer') return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const text = e.props.text
    const isAnimating = await shouldAnimate($, e.requestId)
    const { segments } = isAnimating
      ? decode(text, await read($, memberOf(frame, e)), swapFor(e.surface))
      : { segments: [{ kind: 'clear', text }] as Segment[] }

    return (
      <Box flexDirection="row" marginTop={1}>
        <Text color={GREEN} bold>{'> '}</Text>
        <Box flexShrink={1}>
          <Text color={GREEN}>
            {segments.map(s => (
              <Text color={s.kind === 'clear' ? GREEN : s.kind === 'hot' ? HEAD : DARK} bold={s.kind === 'hot'}>{s.text}</Text>
            ))}
          </Text>
        </Box>
      </Box>
    )
  })

  // Claude's replies: the engine draws the reply itself with its letters
  // scrambled, so the decode has the reply's own layout and nothing jumps when
  // it ends; a tree of our own would reflow when it handed back to markdown.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (!(await read($, isOn))) return next(e)
    const isAnimating = await shouldAnimate($, e.requestId)
    if (!isAnimating) return next(e)
    const { text, isDone } = decode(e.props.text, await read($, memberOf(frame, e)), swapFor(e.surface))
    if (isDone) {
      active.delete(e.requestId)
      return next(e)
    }

    return next({ ...e, props: { ...e.props, text } })
  })

  // The spinner: Matrix words for the main loop; a subagent's is an Agent Smith.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (!(await read($, isOn)) || e.props.message !== null) return next(e)
    const [roster, bulletTime] = await Promise.all([read($, smithRoster), read($, isBulletTime)])
    const word = roster.some(r => r.id === e.requestId && r.doneAt === undefined) ? `Agent Smith · ${e.props.word}`
      : bulletTime ? 'Dodging bullets'
      : pick(SPINNER_WORDS, e.props.word)

    return next({ ...e, props: { ...e.props, word, suffix: ' ▌' } })
  })

  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    if (!(await read($, isOn))) return next(e)
    const { Text } = $.ui.resolve(e)

    return <Text color={DARK}>{doneLine(e.props.word, e.props.durationMs)}</Text>
  })

  // Code rain above the prompt: it pours while Claude works; idle, it drizzles
  // and the phrases type themselves into it. /matrix puts the pills here.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    band.id = '' // set again below while a terminal Raster shows
    if (e.props.hasSurvey) return next(e)
    if (await read($, isChoosing)) {
      const { Box, Text, Button } = $.ui.resolve(e)

      return (
        <Box flexDirection="column" paddingX={1}>
          <Text color={GREEN}>This is your last chance. After this, there is no turning back.</Text>
          <Box flexDirection="row" gap={2}>
            <Box flexDirection="row">
              <Text color={RED}>● </Text>
              <Button key="red" hotkey="1" variant="primary" onPress={() => void choose($, 'red')}>Red pill</Button>
            </Box>
            <Box flexDirection="row">
              <Text color={BLUE}>● </Text>
              <Button key="blue" hotkey="2" onPress={() => void choose($, 'blue')}>Blue pill</Button>
            </Box>
          </Box>
        </Box>
      )
    }
    if (!(await read($, isOn))) return next(e)
    const overlay = await readOverlay($)
    if (e.surface === 'terminal') {
      const { Raster } = $.ui.resolve(e)
      Object.assign(band, {
        id: e.requestId,
        overlay,
        columns: Math.min(512, Math.max(1, e.props.bodyColumns)),
        rows: e.props.maxRows >= 10 ? BAND_ROWS : 1,
        isWorking: e.props.isWorking,
      })

      return <Raster key="rain" columns={band.columns} rows={band.rows} cells={rain(band.columns, band.rows, band.t, band.f, band.isWorking, overlay, fieldOf(band))} />
    }
    if (e.surface !== 'desktop') return next(e)
    // A Client region keeps animating across redraws, where an SVG frame was
    // rebuilt (and blinked) every time the band drew again.
    const { Client } = $.ui.resolve(e)

    return <Client key="rain" module="./rain-client.tsx" props={{ rows: BAND_ROWS, isWorking: e.props.isWorking, overlay }} width="100%" height={BAND_ROWS} />
  })

  // The Construct: a wall of rain filling the pane, the operator's readout
  // decoding inside it, and controls a click (or a key, on the terminal) flips.
  on('ui.render', { component: 'Pane', requestId: CONSTRUCT }, async ($, e) => {
    construct.id = '' // set again below while a terminal Raster shows
    // The pane's own height: the surface's whole height counts rows a pane
    // sharing its column (the desktop's browser, say) does not have.
    const body = e.props.scroll?.bodyRows ?? 0
    const rows = Math.max(CONSTRUCT_ROWS, Math.min(80, body > 0 ? body : (e.viewport?.rows ?? 40) - 2))
    const overlay = await readOverlay($)
    const data = await constructData($, overlay, rows)

    if (e.surface === 'desktop') {
      const { Client } = $.ui.resolve(e)
      return <Client key="construct-rain" module="./rain-client.tsx" props={{ rows, isWorking: true, overlay, construct: data }} width="100%" height={rows} />
    }
    // Only the desktop opens a trace line: elsewhere its detail stays out of the readout.
    const closed = { ...data, trace: data.trace.map(t => ({ ...t, detail: undefined })) }
    const { Box, Text, Button } = $.ui.resolve(e)
    const controls = (
      <Box flexDirection="row" flexWrap="wrap" gap={1}>
        {constructControls(data).map((control, i) => (
          <Button key={`control-${i}`} hotkey={String(i + 1)} plain onPress={() => void act($, control.action)}>{control.label}</Button>
        ))}
      </Box>
    )
    if (e.surface === 'terminal') {
      const { Raster } = $.ui.resolve(e)
      Object.assign(construct, {
        id: e.requestId,
        overlay,
        columns: Math.min(512, Math.max(1, e.props.bodyColumns)),
        rows: Math.max(4, rows - buttonRows(data, e.props.bodyColumns)),
        dataF: construct.data?.now === data.now ? construct.dataF : construct.f,
        data: closed,
      })

      return (
        <Box flexDirection="column">
          <Raster key="construct-rain" columns={construct.columns} rows={construct.rows} cells={constructCells(construct)} />
          {controls}
        </Box>
      )
    }
    // The editor and mobile: rain as an SVG, and the readout as plain lines under it.
    const { Svg } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        <Svg source={rainSvg(1600, 160, overlay)} alt="The Construct: a wall of green code rain" height={160} isInteractive />
        {layoutConstruct(80, 60, closed, data.now)
          .filter(line => !line.action)
          .map(line => <Text color={colorName(line.color)}>{line.text}</Text>)}
        {controls}
      </Box>
    )
  })

  // A click on a control in the desktop's Construct.
  on('ui.message', async ($, e, next) => {
    if (e.element !== 'construct-rain') return next(e)
    const action = (e.data as { action?: ConstructAction } | null)?.action
    const isValid = action !== undefined && (
      'pill' in action ? action.pill === 'red' || action.pill === 'blue'
      : 'oracle' in action ? action.oracle === true
      : 'toggle' in action && (SWITCH_NAMES as readonly string[]).includes(action.toggle))
    if (isValid) await act($, action)
    return {}
  })

  // Tool rows as green trace lines: `◢ Bash › npm test`, red when it failed.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (!(e.props.tool in SUMMARY)) return next(e)
    const [lookOn, rowsOn] = await Promise.all([read($, isOn), read($, isThemedRows)])
    if (!lookOn || !rowsOn) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const p = e.props
    const color = p.isErrored ? RED : GREEN
    const state = p.isInterrupted ? ' ⏸ unplugged' : p.isErrored ? ' ✖ déjà vu' : p.isRunning ? ' ◌ tracing' : ''

    return (
      <Box flexDirection="row">
        <Text color={color}>◢ </Text>
        <Text color={color} bold>{p.tool}</Text>
        <Text color={DARK}> › </Text>
        <Box flexShrink={1}>
          <Text color={TRAIL[1]} wrap="truncate-end">{toolSummary(p.tool, p.input)}</Text>
        </Box>
        {state ? <Text color={p.isErrored ? RED : DARK}>{state}</Text> : null}
      </Box>
    )
  })

  // While a tool runs, the status line and the band trace it; a failure glitches.
  on('tool.call', async ($, e, next) => {
    if (!(await read($, isOn))) return next(e)
    const who = e.agentId ? 'SMITH › ' : ''
    if (tools.running === 0) tools.since = tools.frames
    tools.running += 1
    statusLine.trace = `◢ tracing ${who}${e.tool} ${glyph(tools.running, e.tool.length)}${glyph(e.tool.length, tools.running)}`
    renderStatus($)
    const at = await $.clock.now()
    const entry: MatrixTraceEntry = { id: e.tool_use_id, at, tool: e.tool, summary: traceSummary(e.tool, e as Record<string, unknown>), who }
    const agentId = e.agentId
    await Promise.all([
      update($, trace, () => `${who}${e.tool}`),
      update($, stats, s => ({ ...s, calls: s.calls + 1, tools: { ...s.tools, [e.tool]: (s.tools[e.tool] ?? 0) + 1 } })),
      update($, traceLog, log => [...log, entry].slice(-TRACE_KEEP)),
      agentId ? update($, smithRoster, roster => roster.map(r => (r.id === agentId ? { ...r, calls: r.calls + 1 } : r))) : undefined,
      bumpLife($, { calls: 1 }),
    ])
    let ok = false
    let failed = false
    let output = ''
    try {
      const ran = await next(e)
      ok = ran.deny === undefined && ran.isError !== true
      failed = ran.deny === undefined && ran.isError === true
      output = ran.deny ?? ran.text ?? ''
      // A failed call is a glitch in the Matrix: déjà vu, and a Sentinel sent through the rain.
      if (failed) {
        glitchState.frames = GLITCH_FRAMES
        await Promise.all([
          update($, isGlitching, () => true),
          update($, stats, s => ({ ...s, failures: s.failures + 1 })),
          update($, sentinels, n => n + 1),
          bumpLife($, { failures: 1 }),
        ])
      }
      return ran
    } finally {
      const ms = (await $.clock.now()) - at
      const input = e as Record<string, unknown>
      const repeat = failed ? repeatOf(await read($, traceLog), entry) : 1
      const detail = detailOf(input, output)
      await update($, traceLog, log => log.map(t => (t.id === entry.id ? { ...t, ms, ok, detail, ...(repeat >= 2 ? { repeat } : {}) } : t)))
      if (repeat === 3) $.ui.toast(`Déjà vu: ${who}${e.tool} ${entry.summary} has failed 3 times in a row.`)
      if (ok) await openDoor($, e.tool, input)
      if (ZION_TOOLS.has(e.tool)) refreshZion($)
      tools.running -= 1
      if (tools.running === 0) {
        renderStatus($) // back to how the last turn went
        await Promise.all([
          update($, trace, () => ''),
          tools.isBullet ? update($, isBulletTime, () => false) : undefined,
        ])
        tools.isBullet = false
      }
    }
  })

  // Subagents are Agent Smiths: counted, announced, and named on their spinners.
  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    const agentId = r.agentId
    if (agentId && (await read($, isOn))) {
      const since = await $.clock.now()
      const smith: MatrixSmith = { id: agentId, task: e.description || 'on assignment', since, calls: 0 }
      await Promise.all([
        update($, smithRoster, roster =>
          [...roster.filter(r => r.doneAt === undefined || since - r.doneAt < SMITH_KEEP_MS), smith].slice(-8)),
        update($, stats, s => ({ ...s, smiths: (s.smiths ?? 0) + 1 })),
        bumpLife($, { smiths: 1 }),
      ])
      $.ui.toast(`Agent Smith deployed: ${e.description}`)
      // The band announces him, and the rain replicates him, for a few seconds.
      const token = ++announce.token
      await update($, smithAnnounce, () => e.description || 'on assignment')
      $.clock.after(SMITH_MS, () => {
        if (announce.token === token) void update($, smithAnnounce, () => '')
      })
      $.clock.after(1, () => void smithSound($))
    }
    return r
  })

  // A turn's end: the status line says how it went (the desktop draws no
  // TurnDuration row), and the operator radios in a one-line report.
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    const agentId = e.agentId
    if (agentId) {
      const doneAt = await $.clock.now()
      await update($, smithRoster, roster => roster.map(s => (s.id === agentId && s.doneAt === undefined ? { ...s, doneAt } : s)))
      return r
    }
    if (!(await read($, isOn))) return r
    await bumpLife($, { ms: e.durationMs })
    Object.assign(statusLine, { turnId: e.turnId, done: doneLine(e.turnId, e.durationMs), operator: '' })
    renderStatus($)
    if (!e.isAborted && e.answer.trim() && (await read($, isOperator))) {
      const answer = e.answer.slice(0, 4000)
      const turnId = e.turnId
      // Off the turn's own dispatch, so the report never holds the turn up.
      $.clock.after(1, () => void operatorReport($, answer, turnId))
    }
    return r
  })

  // Morpheus mode: one section added to the system prompt, after the cache boundary.
  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    if (!(await read($, isOn)) || !(await read($, isMorpheus))) return r

    return { ...r, sections: [...r.sections, { id: 'matrix-skin:morpheus', text: MORPHEUS_VOICE, scope: 'session' as const }] }
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (!(await read($, isOn))) return next(e)
    const modes = (await read($, isMorpheus)) ? ['◢ matrix', 'morpheus'] : ['◢ matrix']

    return next({ ...e, props: { ...e.props, modes: [...e.props.modes, ...modes] } })
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (!(await read($, isOn))) return next(e)

    return next({ ...e, props: { ...e.props, tail: ' · ◢ follow the white rabbit' } })
  })
}
