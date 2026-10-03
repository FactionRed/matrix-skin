import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { MatrixStats } from '../types'

// Palette: phosphor greens on the terminal's own background.
const GREEN = '#00ff41'
const DARK = '#008f11'
const HEAD = '#d6ffd6'
const RED = '#ff3030'
const BLUE = '#3a8bff'

// Half-width katakana and digits, the glyphs of the Matrix rain.
const GLYPHS = 'ｦｱｳｴｵｶｷｹｺｻｼｽｾｿﾀﾂﾃﾅﾆﾇﾈﾊﾋﾎﾏﾐﾑﾒﾓﾔﾕﾗﾘﾜ0123456789Z:.=*+-<>'

const SPINNER_WORDS = [
  'Decoding', 'Jacking in', 'Following the white rabbit', 'Bending the spoon',
  'Loading the construct', 'Reading the code', 'Dodging bullets', 'Tracing the call',
]
const DONE_WORDS = ['Jacked out', 'Decoded', 'Unplugged', 'Exited the construct']

// Typed into the rain while Claude is idle, one after another.
const PHRASES = ['Wake up, Neo...', 'The Matrix has you...', 'Follow the white rabbit.', 'Knock, knock, Neo.']

// The rain's trail, from the white-hot head back to the dark tail.
const TRAIL = ['#f0fff0', '#a8ffb8', '#00ff41', '#00e03a', '#00b82e', '#008f11', '#006b0d', '#004a09', '#002e05']

const TICK_MS = 40 // message decode frame rate
const RAIN_MS = 80 // code rain frame rate
const DECODE_FRAMES = 45 // a message decodes in about 1.8s whatever its length
const JITTER = 12 // frames a character's lock-in wanders from the sweep
const HOT = 3 // frames a character burns white before it locks in
const GRACE_MS = 1500 // rows drawn this soon after load are history: no animation
const BULLET_FRAMES = 50 // a tool running this long (4s at RAIN_MS) drops into bullet time

const CONSTRUCT = 'matrix-construct'

const isOn = atom({ plugin: 'matrix-skin', key: 'isOn' } as const, true)
const frame = atom({ plugin: 'matrix-skin', key: 'frame' } as const, 0)
const isGlitching = atom({ plugin: 'matrix-skin', key: 'isGlitching' } as const, false)
const trace = atom({ plugin: 'matrix-skin', key: 'trace' } as const, '')
const isBulletTime = atom({ plugin: 'matrix-skin', key: 'isBulletTime' } as const, false)
const isChoosing = atom({ plugin: 'matrix-skin', key: 'isChoosing' } as const, false)
const stats = atom({ plugin: 'matrix-skin', key: 'stats' } as const, { calls: 0, failures: 0, bulletTimes: 0, tools: {} } as MatrixStats)

const hash = (a: number, b: number) => {
  let n = (a * 374761393 + b * 668265263) >>> 0
  n = ((n ^ (n >>> 13)) * 1274126177) >>> 0
  return (n ^ (n >>> 16)) >>> 0
}
const glyph = (a: number, b: number) => GLYPHS[hash(a, b) % GLYPHS.length]!

const pick = (list: string[], seed: string) => {
  let n = 0
  for (const ch of seed) n = (n * 31 + ch.charCodeAt(0)) >>> 0
  return list[n % list.length]!
}

const duration = (ms: number) => {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

/** Markdown's markers would decode as noise: the decode shows the words alone. */
const plain = (text: string) => text.replace(/\*\*|__|`/g, '').replace(/^#{1,6}\s+/gm, '')

/** The frame character `i` of `n` locks in: a left-to-right sweep that wanders. */
const lockAt = (i: number, n: number) => Math.floor((i / Math.max(1, n)) * (DECODE_FRAMES - JITTER)) + (hash(i, 99) % JITTER)

export type Segment = { kind: 'clear' | 'hot' | 'noise'; text: string }

/**
 * The text at frame f: the whole message arrives as glyph noise in its own
 * shape, and each character burns white, then locks in, in a rippling sweep.
 */
export const decode = (text: string, f: number) => {
  const chars = Array.from(text)
  const segments: Segment[] = []
  const push = (kind: Segment['kind'], ch: string) => {
    const last = segments[segments.length - 1]
    if (last && (last.kind === kind || ch === ' ' || ch === '\n')) last.text += ch
    else segments.push({ kind, text: ch })
  }
  chars.forEach((ch, i) => {
    if (ch === ' ' || ch === '\n') return push('clear', ch)
    const at = lockAt(i, chars.length)
    if (f >= at) push('clear', ch)
    else if (f >= at - HOT) push('hot', glyph(i, f))
    else push('noise', glyph(i, Math.floor(f / 2) + i))
  })

  return { segments, isDone: f >= DECODE_FRAMES }
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
const hex = (color: string) => parseInt(color.slice(1), 16)

const TRAIL_HEX = TRAIL.map(hex)
// The same trail when the Matrix glitches: a red déjà vu.
const GLITCH_TRAIL = ['#fff0f0', '#ffb0b0', '#ff3030', '#e02020', '#b81818', '#8f1010', '#6b0a0a', '#4a0606', '#2e0303']
const GLITCH_HEX = GLITCH_TRAIL.map(hex)
const DEJA_VU = 'Déjà vu.'
const GLITCH_FRAMES = 30 // the band glitches for about 2.4s at RAIN_MS

export type Overlay = { trace?: string; isGlitching?: boolean; isBulletTime?: boolean }

/** Write `text` centered on row `y`, with a clear margin so it reads. */
const label = (words: Uint32Array, columns: number, y: number, text: string, color: number, scramble: (k: number) => boolean, f: number) => {
  const chars = Array.from(text)
  const start = Math.max(0, Math.floor((columns - chars.length) / 2))
  for (let k = -2; k < chars.length + 2; k++) {
    const x = start + k
    if (x < 0 || x >= columns) continue
    const ch = chars[k]
    const i = (y * columns + x) * 3
    if (ch === undefined || ch === ' ') words.set([0x20, DEFAULT, DEFAULT], i)
    else words.set([(scramble(k) ? glyph(k, f) : ch).codePointAt(0)!, color, DEFAULT], i)
  }
}

/** The phrase typed into the rain at frame `f`: its text and how much of it shows. */
export const phraseAt = (f: number) => {
  const PHRASE_FRAMES = 60 // about 5s a phrase at RAIN_MS
  const n = Math.floor(f / PHRASE_FRAMES)
  const local = f % PHRASE_FRAMES
  const text = PHRASES[n % PHRASES.length]!
  const typed = Math.min(text.length, Math.floor(local / 1.5))
  const isFading = local >= PHRASE_FRAMES - 8 // scrambles back into the rain

  return { text, typed, isFading, local }
}

/**
 * One frame of code rain, as Raster cells. `t` moves the drops; `f` counts
 * every frame, and while idle the rain drizzles and a phrase types into it.
 */
export const rain = (columns: number, rows: number, t: number, f = 0, isWorking = true, overlay: Overlay = {}) => {
  const pal = overlay.isGlitching ? GLITCH_HEX : TRAIL_HEX
  const words = new Uint32Array(columns * rows * 3)
  for (let i = 0; i < words.length; i += 3) words.set([0x20, DEFAULT, DEFAULT], i)

  for (let x = 0; x < columns; x++) {
    const seed = hash(x, 7)
    if (seed % 100 >= 58) continue // a little over half the columns carry a drop
    const speed = 1 + (seed % 3)
    const trail = 4 + (seed % 5)
    const cycle = rows + trail + 2 + (seed % 9)
    const head = (Math.floor((t * speed) / 2) + seed) % cycle
    for (let y = 0; y < rows; y++) {
      const d = head - y
      if (d < 0 || d > trail) continue
      // Deeper in the trail the color falls off; a few glyphs flicker every frame.
      const shade = Math.min(pal.length - 1, d === 0 ? 0 : 1 + Math.floor(((d - 1) * (pal.length - 2)) / trail))
      // In bullet time the glyphs hold still while the drops crawl.
      const flicker = overlay.isBulletTime ? 0 : hash(x, y + t) % 7 === 0 ? t : Math.floor(t / 4)
      words.set([glyph(x * 31 + y, flicker).codePointAt(0)!, pal[shade]!, DEFAULT], (y * columns + x) * 3)
    }
  }

  const mid = Math.floor(rows / 2)
  if (overlay.isGlitching && columns >= 12) {
    // Déjà vu: the label shudders, a few of its letters scrambling every frame.
    label(words, columns, mid, DEJA_VU, f % 2 === 0 ? GLITCH_HEX[0]! : GLITCH_HEX[2]!, k => hash(k, f) % 4 === 0, f)
  } else if (isWorking && overlay.trace && columns >= 24) {
    const text = overlay.isBulletTime ? `>> TRACE ${overlay.trace} . bullet time` : `>> TRACE ${overlay.trace}`
    // Bullet time pulses the readout between white and green.
    const color = overlay.isBulletTime && Math.floor(f / 6) % 2 === 0 ? TRAIL_HEX[0]! : TRAIL_HEX[2]!
    label(words, columns, mid, text, color, k => k > 8 && !overlay.isBulletTime && hash(k, f) % 9 === 0, f)
  } else if (!isWorking && columns >= 24) {
    // While idle, a phrase decodes out of the rain on the middle row.
    const { text, typed, isFading, local } = phraseAt(f)
    const start = Math.max(0, Math.floor((columns - text.length) / 2))
    for (let k = -2; k < text.length + 2; k++) {
      const x = start + k
      if (x < 0 || x >= columns) continue
      const i = (mid * columns + x) * 3
      const ch = text[k]
      if (ch === undefined) {
        words.set([0x20, DEFAULT, DEFAULT], i) // a clear margin so the phrase reads
      } else if (isFading && hash(k, local) % 3 !== 0) {
        words.set([glyph(k, f).codePointAt(0)!, TRAIL_HEX[5]!, DEFAULT], i)
      } else if (k < typed) {
        words.set([ch.codePointAt(0)!, k === typed - 1 && typed < text.length ? TRAIL_HEX[0]! : TRAIL_HEX[2]!, DEFAULT], i)
      } else if (k < typed + 3 && ch !== ' ') {
        words.set([glyph(k, f).codePointAt(0)!, TRAIL_HEX[1]!, DEFAULT], i)
      } else {
        words.set([0x20, DEFAULT, DEFAULT], i)
      }
    }
    // A blinking block cursor after the typed text.
    const cx = start + typed
    if (!isFading && cx < columns && Math.floor(f / 4) % 2 === 0) {
      words.set([0x2588, TRAIL_HEX[2]!, DEFAULT], (mid * columns + cx) * 3)
    }
  }

  return toBase64(new Uint8Array(words.buffer))
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * Code rain as one self-animating SVG (SMIL), for the desktop and editor:
 * a black monitor with glowing columns, scanlines and a vignette. Idle, the
 * rain dims and slows and the phrases type themselves in the middle; in
 * bullet time it crawls and ripples spread from the readout.
 */
export const rainSvg = (width: number, height: number, isWorking: boolean, overlay: Overlay = {}) => {
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
    const dur = r(((isWorking ? 1.4 : 5.5) + ((h >>> 8) % 25) / (isWorking ? 10 : 4)) * slow * Math.max(1, height / 120))
    const begin = r(-(((h >>> 4) % 100) / 100) * dur)
    const xs = Array(len).fill('0').join(' ')
    const ys = Array.from({ length: len }, (_, i) => i * CELL).join(' ')
    const glyphs = Array.from({ length: len }, (_, i) => glyph(c * 17 + i, 1)).join('')
    const alt = Array.from({ length: len }, (_, i) => glyph(c * 17 + i, 2)).join('')
    const flick = h % 3 === 0 && !overlay.isBulletTime
      ? `<text x="${xs}" y="${ys}" fill="url(#tr)" opacity="0">${esc(alt)}<animate attributeName="opacity" values="0;1;0" dur="${r(0.3 + (h % 5) / 10)}s" calcMode="discrete" repeatCount="indefinite"/></text>`
      : ''
    columns.push(
      `<g><animateTransform attributeName="transform" type="translate" from="${c * CELL + 2} ${-span - CELL}" to="${c * CELL + 2} ${height + CELL}" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/>` +
        `<text x="${xs}" y="${ys}" fill="url(#tr)">${esc(glyphs)}</text>${flick}` +
        `<text y="${span}" fill="${trail[0]}" filter="url(#gl)">${esc(glyph(c, 3))}</text></g>`,
    )
  }

  const PHRASE_S = 4.5
  const cycle = PHRASES.length * PHRASE_S
  const fontSize = Math.min(20, Math.round(Math.min(height, 56) * 0.36))
  const center = (text: string, size: number, fill: string) =>
    `<rect x="${width / 2 - text.length * size * 0.33 - 14}" y="${height / 2 - size * 0.85}" width="${text.length * size * 0.66 + 28}" height="${size * 1.7}" fill="#000" opacity="0.75" rx="3"/>` +
    `<text x="${width / 2}" y="${height / 2 + size * 0.35}" text-anchor="middle" font-size="${size}" fill="${fill}" filter="url(#gl)" xml:space="preserve">${esc(text)}</text>`
  // Bullet time: rings spread from the readout, as the air did around the bullets.
  const ripples = overlay.isBulletTime
    ? [0, 0.8, 1.6].map(d =>
        `<ellipse cx="${width / 2}" cy="${height / 2}" rx="0" ry="0" fill="none" stroke="${trail[1]}" stroke-width="1.5" opacity="0">` +
          `<animate attributeName="rx" values="10;${width / 4}" dur="2.4s" begin="${d}s" repeatCount="indefinite"/>` +
          `<animate attributeName="ry" values="3;${height}" dur="2.4s" begin="${d}s" repeatCount="indefinite"/>` +
          `<animate attributeName="opacity" values="0.8;0" dur="2.4s" begin="${d}s" repeatCount="indefinite"/></ellipse>`,
      ).join('')
    : ''
  const phrases = overlay.isGlitching
    ? `<g><animateTransform attributeName="transform" type="translate" values="0 0;5 -1;-4 1;2 0;0 0" dur="0.25s" repeatCount="indefinite"/>${center(DEJA_VU, fontSize, trail[2]!)}</g>` +
      `<rect x="0" y="${height * 0.2}" width="${width}" height="2" fill="${trail[2]}" opacity="0"><animate attributeName="opacity" values="0;0.8;0;0;0.6;0" dur="0.5s" repeatCount="indefinite"/><animate attributeName="y" values="${height * 0.2};${height * 0.7};${height * 0.4}" dur="0.5s" repeatCount="indefinite"/></rect>`
    : isWorking && overlay.trace
    ? ripples + center(overlay.isBulletTime ? `◢ TRACE  ${overlay.trace}  ·  BULLET TIME` : `◢ TRACE  ${overlay.trace}`, Math.round(fontSize * 0.8), overlay.isBulletTime ? trail[1]! : trail[2]!)
    : isWorking
    ? ''
    : PHRASES.map((text, p) => {
        const from = p * PHRASE_S
        const chars = Array.from(text).map((ch, i) => {
          const on = (from + 0.3 + i * 0.07) / cycle
          const off = (from + PHRASE_S - 0.4) / cycle
          return `<tspan visibility="hidden">${esc(ch)}<animate attributeName="visibility" values="hidden;visible;hidden" keyTimes="0;${r(on * 100) / 100};${r(off * 100) / 100}" dur="${cycle}s" calcMode="discrete" repeatCount="indefinite"/></tspan>`
        })
        return `<text x="${width / 2}" y="${height / 2 + fontSize * 0.35}" text-anchor="middle" font-size="${fontSize}" fill="${GREEN}" filter="url(#gl)" xml:space="preserve">${chars.join('')}</text>`
      }).join('')

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid slice">` +
    `<defs>` +
    `<linearGradient id="tr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${trail[7]}" stop-opacity="0"/><stop offset="0.55" stop-color="${trail[5]}"/><stop offset="0.9" stop-color="${trail[2]}"/><stop offset="1" stop-color="${trail[1]}"/></linearGradient>` +
    `<filter id="gl" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>` +
    `<filter id="bloom"><feGaussianBlur stdDeviation="1.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>` +
    `<linearGradient id="vg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.8"/><stop offset="0.3" stop-color="#000" stop-opacity="0"/><stop offset="0.7" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.8"/></linearGradient>` +
    `<pattern id="sl" width="4" height="3" patternUnits="userSpaceOnUse"><rect width="4" height="1" fill="#000" opacity="0.35"/></pattern>` +
    `</defs>` +
    `<rect width="100%" height="100%" fill="#000"/>` +
    `<g font-family="'MS Gothic','Osaka-Mono',ui-monospace,monospace" font-size="12" filter="url(#bloom)" opacity="${isWorking ? 1 : 0.5}">${columns.join('')}</g>` +
    (!isWorking && !overlay.isGlitching ? `<rect x="${width / 2 - 150}" y="${height / 2 - fontSize * 0.85}" width="300" height="${fontSize * 1.7}" fill="#000" opacity="0.75" rx="3"/>` : '') +
    `<g font-family="ui-monospace,'Cascadia Mono',Consolas,monospace">${phrases}</g>` +
    `<rect width="100%" height="100%" fill="url(#sl)"/>` +
    `<rect width="100%" height="100%" fill="url(#vg)"/>` +
    `<path d="M0 0.5H${width}M0 ${height - 0.5}H${width}" stroke="${trail[2]}" stroke-opacity="0.35"/>` +
    `</svg>`
  )
}

const clockState = { loadedAt: 0 }
const timers: { ticker?: { cancel: () => void }; rain?: { cancel: () => void }; isTicking: boolean } = { isTicking: false }
const seen = new Set<string>()
const active = new Set<string>() // the rows decoding now, by requestId
const band = { id: '', columns: 0, rows: 0, isWorking: false, t: 0, f: 0, overlay: {} as Overlay }
const construct = { id: '', columns: 0, rows: 0, t: 0, overlay: {} as Overlay }
const glitchState = { frames: 0 }
const tools = { running: 0, since: 0, frames: 0, isBullet: false }

async function tick($: EngineInterface) {
  if (timers.isTicking || active.size === 0) return
  timers.isTicking = true
  try {
    for (const requestId of active) {
      const f = await update($, memberOf(frame, { requestId }), n => n + 1)
      if (f >= DECODE_FRAMES) active.delete(requestId)
    }
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

/** Red or blue: the look on or off, remembered, and the choice put away. */
async function choose($: EngineInterface, pill: 'red' | 'blue') {
  const on = pill === 'red'
  await update($, isOn, () => on)
  await $.store.set('isOn', on)
  await update($, isChoosing, () => false)
  $.ui.toast(on ? 'Welcome to the real world.' : 'The story ends. You wake up in your bed.')

  return on
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    clockState.loadedAt = await $.clock.now()
    const saved = await $.store.get('isOn')
    if (saved === false) await update($, isOn, () => false)
    await $.command.register({ name: 'matrix', description: 'Take the red pill or the blue pill (/matrix red, /matrix blue)' })
    await $.command.register({ name: 'construct', description: 'Open the Construct: a live operator console of the Matrix' })
    timers.ticker?.cancel()
    timers.rain?.cancel()
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
      const crawl = band.overlay.isBulletTime ? 12 : band.isWorking ? 1 : 4
      if (band.id) {
        band.f += 1
        if (band.f % crawl === 0) band.t += 1
        void $.ui.blit({ requestId: band.id, key: 'rain', cells: rain(band.columns, band.rows, band.t, band.f, band.isWorking, band.overlay) })
      }
      if (construct.id) {
        if (tools.frames % (construct.overlay.isBulletTime ? 12 : 1) === 0) construct.t += 1
        void $.ui.blit({ requestId: construct.id, key: 'construct-rain', cells: rain(construct.columns, construct.rows, construct.t, tools.frames, true, construct.overlay) })
      }
    })

    return next(e)
  })

  on('command.run', { command: 'matrix' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'red' || arg === 'on') {
      await choose($, 'red')
      return { text: 'You took the red pill. Welcome to the real world.' }
    }
    if (arg === 'blue' || arg === 'off') {
      await choose($, 'blue')
      return { text: 'You took the blue pill. Matrix look off.' }
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
      ? decode(text, await read($, memberOf(frame, e)))
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

  // Claude's replies: arrive as glyph noise, decode in green, then settle into the formatted reply.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (!(await read($, isOn))) return next(e)
    const isAnimating = await shouldAnimate($, e.requestId)
    if (!isAnimating) return next(e)
    const { segments, isDone } = decode(plain(e.props.text), await read($, memberOf(frame, e)))
    if (isDone) {
      active.delete(e.requestId)
      return next(e)
    }
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="row">
        <Text color={GREEN}>{e.props.isFirstOfReply ? '● ' : '  '}</Text>
        <Box flexShrink={1}>
          <Text color={GREEN}>
            {segments.map(s => (
              <Text color={s.kind === 'clear' ? GREEN : s.kind === 'hot' ? HEAD : TRAIL[6]} bold={s.kind === 'hot'}>{s.text}</Text>
            ))}
          </Text>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (!(await read($, isOn)) || e.props.message !== null) return next(e)
    const word = (await read($, isBulletTime)) ? 'Dodging bullets' : pick(SPINNER_WORDS, e.props.word)

    return next({ ...e, props: { ...e.props, word, suffix: ' ▌' } })
  })

  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    if (!(await read($, isOn))) return next(e)
    const { Text } = $.ui.resolve(e)

    return (
      <Text color={DARK}>
        ◢ {pick(DONE_WORDS, e.props.word)} after {duration(e.props.durationMs)}
      </Text>
    )
  })

  // Code rain above the prompt: it pours while Claude works; idle, it drizzles
  // and the phrases type themselves into it. /matrix puts the pills here.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      band.id = ''
      return next(e)
    }
    if (await read($, isChoosing)) {
      band.id = ''
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
    if (!(await read($, isOn))) {
      band.id = ''
      return next(e)
    }
    const overlay: Overlay = {
      trace: await read($, trace),
      isGlitching: await read($, isGlitching),
      isBulletTime: await read($, isBulletTime),
    }
    if (e.surface === 'terminal') {
      const { Raster } = $.ui.resolve(e)
      band.id = e.requestId
      band.overlay = overlay
      band.columns = Math.min(512, Math.max(1, e.props.bodyColumns))
      band.rows = e.props.maxRows >= 10 ? 3 : 1
      band.isWorking = e.props.isWorking

      return (
        <Raster
          key="rain"
          columns={band.columns}
          rows={band.rows}
          cells={rain(band.columns, band.rows, band.t, band.f, band.isWorking, overlay)}
        />
      )
    }
    band.id = '' // the SVG animates itself: no frames to push
    const { Svg } = $.ui.resolve(e)
    // Wider than any band: the surface trims it to the slot, so it always fills it.
    const width = 1600
    const height = 44

    return (
      <Svg
        source={rainSvg(width, height, e.props.isWorking, overlay)}
        alt={overlay.isGlitching ? 'Red code rain glitching: déjà vu' : e.props.isWorking ? 'Green code rain pouring down' : 'Green code rain, with "Wake up, Neo..." typing itself'}
        height={height}
        isInteractive
      />
    )
  })

  // The Construct: a tall screen of rain over an operator's readout of the session.
  on('ui.render', { component: 'Pane', requestId: CONSTRUCT }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const s = await read($, stats)
    const overlay: Overlay = {
      trace: await read($, trace),
      isGlitching: await read($, isGlitching),
      isBulletTime: await read($, isBulletTime),
    }
    const top = Object.entries(s.tools).sort((a, b) => b[1] - a[1]).slice(0, 5)
    const status = overlay.isGlitching
      ? { text: 'GLITCH: déjà vu. They changed something.', color: RED }
      : overlay.isBulletTime
      ? { text: `BULLET TIME: ${overlay.trace} is taking its time`, color: HEAD }
      : overlay.trace
      ? { text: `TRACING ${overlay.trace}`, color: GREEN }
      : { text: 'Operator standing by.', color: DARK }

    let screen
    if (e.surface === 'terminal') {
      const { Raster } = $.ui.resolve(e)
      construct.id = e.requestId
      construct.overlay = overlay
      construct.columns = Math.min(512, Math.max(1, e.props.bodyColumns))
      construct.rows = Math.max(3, Math.min(12, (e.viewport?.rows ?? 24) - 12))
      screen = (
        <Raster
          key="construct-rain"
          columns={construct.columns}
          rows={construct.rows}
          cells={rain(construct.columns, construct.rows, construct.t, tools.frames, true, overlay)}
        />
      )
    } else {
      construct.id = ''
      const { Svg } = $.ui.resolve(e)
      screen = <Svg source={rainSvg(1600, 220, true, overlay)} alt="The Construct: a wall of green code rain" height={220} isInteractive />
    }

    return (
      <Box flexDirection="column">
        {screen}
        <Box flexDirection="column" paddingX={1} marginTop={1}>
          <Text color={GREEN} bold>◢ OPERATOR CONSOLE</Text>
          <Text color={status.color}>{status.text}</Text>
          <Text color={DARK}>{'─'.repeat(Math.max(8, Math.min(40, (e.props.bodyColumns ?? 40) - 2)))}</Text>
          <Text color={GREEN}>Calls traced    <Text color={HEAD} bold>{String(s.calls)}</Text></Text>
          <Text color={GREEN}>Glitches        <Text color={s.failures > 0 ? RED : HEAD} bold>{String(s.failures)}</Text></Text>
          <Text color={GREEN}>Bullet time     <Text color={HEAD} bold>{String(s.bulletTimes)}</Text></Text>
          {top.length > 0 && <Text color={DARK}>Most traced</Text>}
          {top.map(([tool, count]) => (
            <Text color={GREEN}>
              {'  '}{tool.padEnd(14).slice(0, 14)} <Text color={TRAIL[4]}>{'▮'.repeat(Math.min(20, count))}</Text> <Text color={HEAD}>{String(count)}</Text>
            </Text>
          ))}
        </Box>
      </Box>
    )
  })

  // While a tool runs, the status line and the band trace it; a failure glitches.
  on('tool.call', async ($, e, next) => {
    if (!(await read($, isOn))) return next(e)
    if (tools.running === 0) tools.since = tools.frames
    tools.running += 1
    $.ui.status(`◢ tracing ${e.tool} ${glyph(tools.running, e.tool.length)}${glyph(e.tool.length, tools.running)}`)
    await update($, trace, () => e.tool)
    await update($, stats, s => ({ ...s, calls: s.calls + 1, tools: { ...s.tools, [e.tool]: (s.tools[e.tool] ?? 0) + 1 } }))
    try {
      const ran = await next(e)
      // A failed call is a glitch in the Matrix: déjà vu.
      if (ran.deny === undefined && ran.isError === true) {
        glitchState.frames = GLITCH_FRAMES
        await update($, isGlitching, () => true)
        await update($, stats, s => ({ ...s, failures: s.failures + 1 }))
      }
      return ran
    } finally {
      tools.running -= 1
      if (tools.running === 0) {
        $.ui.status(undefined)
        await update($, trace, () => '')
        if (tools.isBullet) {
          tools.isBullet = false
          await update($, isBulletTime, () => false)
        }
      }
    }
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (!(await read($, isOn))) return next(e)

    return next({ ...e, props: { ...e.props, modes: [...e.props.modes, '◢ matrix'] } })
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (!(await read($, isOn))) return next(e)

    return next({ ...e, props: { ...e.props, tail: ' · ◢ follow the white rabbit' } })
  })
}
