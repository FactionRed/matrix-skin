import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { MatrixStats } from '../types'
import { BOOT_FRAMES, DEJA_VU, GLITCH_TRAIL, KATAKANA, RAIN_MS, TRAIL, crawlOf, glyph, hash, rainGrid } from './rain-core'
import type { Field, Overlay } from './rain-core'

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
const CONSTRUCT_ROWS = 12 // the Construct's wall of rain, in rows

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

const isOn = atom({ plugin: 'matrix-skin', key: 'isOn' } as const, true)
const frame = atom({ plugin: 'matrix-skin', key: 'frame' } as const, 0)
const isGlitching = atom({ plugin: 'matrix-skin', key: 'isGlitching' } as const, false)
const trace = atom({ plugin: 'matrix-skin', key: 'trace' } as const, '')
const isBulletTime = atom({ plugin: 'matrix-skin', key: 'isBulletTime' } as const, false)
const isChoosing = atom({ plugin: 'matrix-skin', key: 'isChoosing' } as const, false)
const smithIds = atom({ plugin: 'matrix-skin', key: 'smithIds' } as const, [] as string[])
const isBooting = atom({ plugin: 'matrix-skin', key: 'isBooting' } as const, false)
const smithAnnounce = atom({ plugin: 'matrix-skin', key: 'smithAnnounce' } as const, '')
const isMorpheus = atom({ plugin: 'matrix-skin', key: 'isMorpheus' } as const, false)
const isOperator = atom({ plugin: 'matrix-skin', key: 'isOperator' } as const, true)
const isThemedRows = atom({ plugin: 'matrix-skin', key: 'isThemedRows' } as const, true)
const isSound = atom({ plugin: 'matrix-skin', key: 'isSound' } as const, true)
const isVoice = atom({ plugin: 'matrix-skin', key: 'isVoice' } as const, false)
const stats = atom({ plugin: 'matrix-skin', key: 'stats' } as const, { calls: 0, failures: 0, bulletTimes: 0, smiths: 0, tools: {} } as MatrixStats)

// The switches /matrix flips, each remembered across sessions under its store key.
const SWITCH_NAMES = ['morpheus', 'operator', 'rows', 'sound', 'voice'] as const
type SwitchName = (typeof SWITCH_NAMES)[number]
const STORE_KEY: Record<SwitchName, string> = { morpheus: 'isMorpheus', operator: 'isOperator', rows: 'isThemedRows', sound: 'isSound', voice: 'isVoice' }
const SAID: Record<SwitchName, [on: string, off: string]> = {
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

/** One frame of code rain, as the terminal's Raster cells. */
export const rain = (columns: number, rows: number, t: number, f = 0, isWorking = true, overlay: Overlay = {}, field: Field = {}) => {
  const grid = rainGrid(columns, rows, t, f, isWorking, overlay, field)
  const words = new Uint32Array(columns * rows * 3)
  for (let i = 0, j = 0; i < columns * rows; i++, j += 3) {
    words[j] = grid.cp[i]!
    words[j + 1] = grid.fg[i]! < 0 ? DEFAULT : grid.fg[i]!
    words[j + 2] = DEFAULT
  }
  return toBase64(new Uint8Array(words.buffer))
}

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
    const h = hash(c, 11)
    if (h % 100 >= 72) continue
    const len = 7 + (h % 9)
    const span = len * CELL
    const dur = r((1.4 + ((h >>> 8) % 25) / 10) * slow * Math.max(1, height / 120))
    const begin = r(-(((h >>> 4) % 100) / 100) * dur)
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

/** A terminal site whose Raster the rain timer repaints: the band or the Construct. */
type RainSite = { key: string; id: string; columns: number; rows: number; isWorking: boolean; t: number; f: number; overlay: Overlay; bootF?: number }

/** A site's boot frames so far, starting the count when its overlay starts booting. */
const bootField = (site: RainSite): Field => {
  site.bootF = site.overlay.isBooting ? (site.bootF ?? site.f) : undefined
  return { bootFrames: site.bootF === undefined ? 0 : site.f - site.bootF }
}

const clockState = { loadedAt: 0 }
type Timer = { cancel: () => void }
const timers: { ticker?: Timer; rain?: Timer; boot?: Timer; isTicking: boolean } = { isTicking: false }
const seen = new Set<string>()
const active = new Set<string>() // the rows decoding now, by requestId
const band: RainSite = { key: 'rain', id: '', columns: 0, rows: 0, isWorking: false, t: 0, f: 0, overlay: {} }
const construct: RainSite = { key: 'construct-rain', id: '', columns: 0, rows: 0, isWorking: true, t: 0, f: 0, overlay: {} }
const glitchState = { frames: 0 }
const tools = { running: 0, since: 0, frames: 0, isBullet: false }
const statusLine = { trace: '', done: '', operator: '', turnId: '' }
const announce = { token: 0 } // the latest Smith announcement, so an older one's timer leaves it be
const heard = { smith: -Infinity, anderson: -Infinity } // when each Smith sound last played

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
const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`
const powershell = ($: EngineInterface, script: string) =>
  $.process.run(['powershell', '-NoProfile', '-NonInteractive', '-Command', script], { timeoutMs: 15000 })

/** Plays one of the plugin's clips while the look and sound are on; silent where nothing can play it. */
async function playSound($: EngineInterface, asset: string) {
  const [lookOn, soundOn] = await Promise.all([read($, isOn), read($, isSound)])
  if (!lookOn || !soundOn) return
  try {
    if (await isWindows($)) {
      const path = `${$.plugin.root}/${asset}` // .NET takes forward slashes on Windows
      await powershell($, `(New-Object Media.SoundPlayer ${psQuote(path)}).PlaySync()`)
    } else {
      await $.audio.play({ asset }, { gain: 0.8 })
    }
  } catch {
    // No player on this machine (a Linux terminal has none): the look stays silent.
  }
}

/** Says a line in a low, slow voice, where the machine can speak. */
async function say($: EngineInterface, text: string) {
  try {
    if (await isWindows($)) {
      await powershell(
        $,
        'Add-Type -AssemblyName System.Speech; $v = New-Object System.Speech.Synthesis.SpeechSynthesizer; ' +
          `try { $v.SelectVoiceByHints('Male') } catch {}; $v.Rate = -3; $v.Speak(${psQuote(text)})`,
      )
    } else {
      await $.audio.speak(text)
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
  await say($, 'Mister Anderson.')
}

/** What the rain shows over itself now. */
async function readOverlay($: EngineInterface): Promise<Overlay> {
  const [traced, glitching, bulletTime, booting, smith] = await Promise.all([
    read($, trace),
    read($, isGlitching),
    read($, isBulletTime),
    read($, isBooting),
    read($, smithAnnounce),
  ])
  return { trace: traced, isGlitching: glitching, isBulletTime: bulletTime, isBooting: booting, smith }
}

/** The one writer of the status line: the running tool's trace, else how the last turn went. */
function renderStatus($: EngineInterface) {
  const line = tools.running > 0 ? statusLine.trace : [statusLine.done, statusLine.operator].filter(Boolean).join(' · ')
  $.ui.status(line || undefined)
}

/** Red or blue: the look on or off, remembered, and the choice put away. */
async function choose($: EngineInterface, pill: 'red' | 'blue') {
  const on = pill === 'red'
  await Promise.all([update($, isOn, () => on), $.store.set('isOn', on), update($, isChoosing, () => false)])
  if (!on) {
    Object.assign(statusLine, { trace: '', done: '', operator: '' })
    $.ui.status(undefined)
  }
  $.ui.toast(on ? 'Welcome to the real world.' : 'The story ends. You wake up in your bed.')

  return on
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
  const r = await $.model.complete({ model: 'haiku', system: OPERATOR_SYSTEM, prompt: answer, maxTokens: 60, effort: 'low', timeoutMs: 10000 })
  if (!r.isAnswered || statusLine.turnId !== turnId) return
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
  '/construct: the operator console.',
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
      update($, smithIds, () => []),
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
      }
      // Only the terminal's Rasters are pushed from here: a Client animates itself.
      for (const site of [band, construct]) {
        if (!site.id) continue
        site.f += 1
        if (site.f % crawlOf(site.isWorking, site.overlay) === 0) site.t += 1
        void $.ui.blit({ requestId: site.id, key: site.key, cells: rain(site.columns, site.rows, site.t, site.f, site.isWorking, site.overlay, bootField(site)) })
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
    const [smiths, bulletTime] = await Promise.all([read($, smithIds), read($, isBulletTime)])
    const word = smiths.includes(e.requestId) ? `Agent Smith · ${e.props.word}`
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

      return <Raster key="rain" columns={band.columns} rows={band.rows} cells={rain(band.columns, band.rows, band.t, band.f, band.isWorking, overlay, bootField(band))} />
    }
    if (e.surface !== 'desktop') return next(e)
    // A Client region keeps animating across redraws, where an SVG frame was
    // rebuilt (and blinked) every time the band drew again.
    const { Client } = $.ui.resolve(e)

    return <Client key="rain" module="./rain-client.tsx" props={{ rows: BAND_ROWS, isWorking: e.props.isWorking, overlay }} width="100%" height={BAND_ROWS} />
  })

  // The Construct: a wall of rain over an operator's readout of the session.
  on('ui.render', { component: 'Pane', requestId: CONSTRUCT }, async ($, e) => {
    construct.id = '' // set again below while a terminal Raster shows
    const { Box, Text } = $.ui.resolve(e)
    const [s, smiths, overlay] = await Promise.all([read($, stats), read($, smithIds), readOverlay($)])
    const top = Object.entries(s.tools).sort((a, b) => b[1] - a[1]).slice(0, 5)
    const status = overlay.isGlitching
      ? { text: 'GLITCH: déjà vu. They changed something.', color: RED }
      : overlay.isBulletTime
      ? { text: `BULLET TIME: ${overlay.trace} is taking its time`, color: HEAD }
      : smiths.length > 0
      ? { text: `${smiths.length} Agent Smith${smiths.length === 1 ? '' : 's'} in the Matrix`, color: HEAD }
      : overlay.trace
      ? { text: `TRACING ${overlay.trace}`, color: GREEN }
      : { text: 'Operator standing by.', color: DARK }

    let screen
    if (e.surface === 'terminal') {
      const { Raster } = $.ui.resolve(e)
      Object.assign(construct, {
        id: e.requestId,
        overlay,
        columns: Math.min(512, Math.max(1, e.props.bodyColumns)),
        rows: Math.max(3, Math.min(CONSTRUCT_ROWS, (e.viewport?.rows ?? 24) - 12)),
      })
      screen = <Raster key="construct-rain" columns={construct.columns} rows={construct.rows} cells={rain(construct.columns, construct.rows, construct.t, construct.f, true, overlay, bootField(construct))} />
    } else if (e.surface === 'desktop') {
      const { Client } = $.ui.resolve(e)
      screen = <Client key="construct-rain" module="./rain-client.tsx" props={{ rows: CONSTRUCT_ROWS, isWorking: true, overlay }} width="100%" height={CONSTRUCT_ROWS} />
    } else {
      const { Svg } = $.ui.resolve(e)
      screen = <Svg source={rainSvg(1600, 220, overlay)} alt="The Construct: a wall of green code rain" height={220} isInteractive />
    }

    return (
      <Box flexDirection="column">
        {screen}
        <Box flexDirection="column" paddingX={1} marginTop={1}>
          <Text color={GREEN} bold>◢ OPERATOR CONSOLE</Text>
          <Text color={status.color}>{status.text}</Text>
          {e.surface === 'desktop' ? <Text color={DARK}>Move the pointer through the rain; click to send a ripple.</Text> : null}
          <Text color={DARK}>{'─'.repeat(Math.max(8, Math.min(40, (e.props.bodyColumns ?? 40) - 2)))}</Text>
          <Text color={GREEN}>Calls traced    <Text color={HEAD} bold>{String(s.calls)}</Text></Text>
          <Text color={GREEN}>Glitches        <Text color={s.failures > 0 ? RED : HEAD} bold>{String(s.failures)}</Text></Text>
          <Text color={GREEN}>Bullet time     <Text color={HEAD} bold>{String(s.bulletTimes)}</Text></Text>
          <Text color={GREEN}>Agent Smiths    <Text color={HEAD} bold>{String(s.smiths ?? 0)}</Text></Text>
          {top.length > 0 ? <Text color={DARK}>Most traced</Text> : null}
          {top.map(([tool, count]) => (
            <Text color={GREEN}>
              {'  '}{tool.padEnd(14).slice(0, 14)} <Text color={TRAIL[4]}>{'▮'.repeat(Math.min(20, count))}</Text> <Text color={HEAD}>{String(count)}</Text>
            </Text>
          ))}
        </Box>
      </Box>
    )
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
    await Promise.all([
      update($, trace, () => `${who}${e.tool}`),
      update($, stats, s => ({ ...s, calls: s.calls + 1, tools: { ...s.tools, [e.tool]: (s.tools[e.tool] ?? 0) + 1 } })),
    ])
    try {
      const ran = await next(e)
      // A failed call is a glitch in the Matrix: déjà vu.
      if (ran.deny === undefined && ran.isError === true) {
        glitchState.frames = GLITCH_FRAMES
        await Promise.all([update($, isGlitching, () => true), update($, stats, s => ({ ...s, failures: s.failures + 1 }))])
      }
      return ran
    } finally {
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
      await Promise.all([
        update($, smithIds, ids => [...ids, agentId]),
        update($, stats, s => ({ ...s, smiths: (s.smiths ?? 0) + 1 })),
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
      await update($, smithIds, ids => ids.filter(id => id !== agentId))
      return r
    }
    if (!(await read($, isOn))) return r
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
