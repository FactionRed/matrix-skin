// The code rain itself: pure functions shared by the hooks module (the
// terminal's Raster) and the surface module (the desktop's Client region).

// Half-width katakana, then digits and symbols: the glyphs of the Matrix rain.
export const KATAKANA = 'ｦｱｳｴｵｶｷｹｺｻｼｽｾｿﾀﾂﾃﾅﾆﾇﾈﾊﾋﾎﾏﾐﾑﾒﾓﾔﾕﾗﾘﾜ'
export const GLYPHS = `${KATAKANA}0123456789Z:.=*+-<>`

// Typed into the rain while Claude is idle, one after another.
export const PHRASES = ['Wake up, Neo...', 'The Matrix has you...', 'Follow the white rabbit.', 'Knock, knock, Neo.']

// The rain's trail, from the white-hot head back to the dark tail.
export const TRAIL = ['#f0fff0', '#a8ffb8', '#00ff41', '#00e03a', '#00b82e', '#008f11', '#006b0d', '#004a09', '#002e05']
// The same trail when the Matrix glitches: a red déjà vu.
export const GLITCH_TRAIL = ['#fff0f0', '#ffb0b0', '#ff3030', '#e02020', '#b81818', '#8f1010', '#6b0a0a', '#4a0606', '#2e0303']
export const DEJA_VU = 'Déjà vu.'

/** One frame of the rain, on every surface. */
export const RAIN_MS = 80

export const hash = (a: number, b: number) => {
  let n = (a * 374761393 + b * 668265263) >>> 0
  n = ((n ^ (n >>> 13)) * 1274126177) >>> 0
  return (n ^ (n >>> 16)) >>> 0
}
/** A glyph picked by `a` and `b`, from GLYPHS or another alphabet. */
export const glyph = (a: number, b: number, from = GLYPHS) => from[hash(a, b) % from.length]!

const hex = (color: string) => parseInt(color.slice(1), 16)
const TRAIL_HEX = TRAIL.map(hex)
const GLITCH_HEX = GLITCH_TRAIL.map(hex)
// A grid holds colors as numbers; Text takes strings: every palette color, back again.
const COLOR_NAME = new Map([...TRAIL, ...GLITCH_TRAIL].map(color => [hex(color), color] as const))

/** What the rain shows over itself: the running tool, a glitch, bullet time. */
export type Overlay = { trace?: string; isGlitching?: boolean; isBulletTime?: boolean }

/** A position in a Client region, in cells. */
export type Point = { x: number; y: number }
/** A click's ring of light, `age` frames old. */
export type Ripple = Point & { age: number }
/** The pointer over a Client region and the ripples its clicks sent. */
export type Field = { pointer?: Point | null; ripples?: Ripple[] }

/** One frame of rain: a code point and a color (`-1`, the default) per cell, row-major. */
export type Grid = { columns: number; rows: number; cp: Uint32Array; fg: Int32Array }

/**
 * How many frames a drop takes to fall one step: every frame while Claude
 * works, a drizzle while idle, a crawl in bullet time.
 */
export const crawlOf = (isWorking: boolean, overlay: Overlay) => (overlay.isBulletTime ? 12 : isWorking ? 1 : 4)

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
 * One frame of code rain. `t` moves the drops; `f` counts every frame. While
 * idle a phrase types itself into the middle row; a pointer parts the rain
 * around itself and each click sends a ring of light through it.
 */
export const rainGrid = (columns: number, rows: number, t: number, f = 0, isWorking = true, overlay: Overlay = {}, field: Field = {}): Grid => {
  const pal = overlay.isGlitching ? GLITCH_HEX : TRAIL_HEX
  const cp = new Uint32Array(columns * rows).fill(0x20)
  const fg = new Int32Array(columns * rows).fill(-1)
  const set = (x: number, y: number, ch: string, color: number) => {
    if (x < 0 || y < 0 || x >= columns || y >= rows) return
    cp[y * columns + x] = ch.codePointAt(0)!
    fg[y * columns + x] = color
  }

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
      set(x, y, glyph(x * 31 + y, flicker), pal[shade]!)
    }
  }

  // The pointer: the code parts around it, and its rim burns bright.
  const pointer = field.pointer
  if (pointer) {
    const RX = 5
    const RY = 2.2
    for (let y = Math.floor(pointer.y - RY); y <= Math.ceil(pointer.y + RY); y++) {
      for (let x = Math.floor(pointer.x - RX); x <= Math.ceil(pointer.x + RX); x++) {
        const dx = (x - pointer.x) / RX
        const dy = (y - pointer.y) / RY
        const d = Math.sqrt(dx * dx + dy * dy)
        if (d < 0.72) set(x, y, ' ', -1)
        else if (d < 1) set(x, y, glyph(x * 13 + y, f), pal[1]!)
      }
    }
  }
  // Each click: a ring of light that spreads out and fades. Only the cells
  // around the ring are tested, not the whole region.
  for (const ring of field.ripples ?? []) {
    const radius = ring.age * 1.6
    const color = pal[ring.age < 4 ? 0 : ring.age < 9 ? 1 : 3]!
    const reach = radius + 1
    const y0 = Math.max(0, Math.floor(ring.y - reach / 2.2))
    const y1 = Math.min(rows - 1, Math.ceil(ring.y + reach / 2.2))
    const x0 = Math.max(0, Math.floor(ring.x - reach))
    const x1 = Math.min(columns - 1, Math.ceil(ring.x + reach))
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - ring.x
        const dy = (y - ring.y) * 2.2
        if (Math.abs(Math.sqrt(dx * dx + dy * dy) - radius) < 0.8) set(x, y, glyph(x + ring.age, y + f), color)
      }
    }
  }

  const mid = Math.floor(rows / 2)
  const label = (text: string, color: number, scramble: (k: number) => boolean) => {
    const chars = Array.from(text)
    const start = Math.max(0, Math.floor((columns - chars.length) / 2))
    for (let k = -2; k < chars.length + 2; k++) {
      const ch = chars[k]
      if (ch === undefined || ch === ' ') set(start + k, mid, ' ', -1)
      else set(start + k, mid, scramble(k) ? glyph(k, f) : ch, color)
    }
  }
  if (overlay.isGlitching && columns >= 12) {
    // Déjà vu: the label shudders, a few of its letters scrambling every frame.
    label(DEJA_VU, f % 2 === 0 ? GLITCH_HEX[0]! : GLITCH_HEX[2]!, k => hash(k, f) % 4 === 0)
  } else if (isWorking && overlay.trace && columns >= 24) {
    const text = overlay.isBulletTime ? `>> TRACE ${overlay.trace} . bullet time` : `>> TRACE ${overlay.trace}`
    // Bullet time pulses the readout between white and green.
    const color = overlay.isBulletTime && Math.floor(f / 6) % 2 === 0 ? TRAIL_HEX[0]! : TRAIL_HEX[2]!
    label(text, color, k => k > 8 && !overlay.isBulletTime && hash(k, f) % 9 === 0)
  } else if (!isWorking && columns >= 24) {
    // While idle, a phrase decodes out of the rain on the middle row.
    const { text, typed, isFading, local } = phraseAt(f)
    const start = Math.max(0, Math.floor((columns - text.length) / 2))
    for (let k = -2; k < text.length + 2; k++) {
      const ch = text[k]
      if (ch === undefined) set(start + k, mid, ' ', -1) // a clear margin so the phrase reads
      else if (isFading && hash(k, local) % 3 !== 0) set(start + k, mid, glyph(k, f), TRAIL_HEX[5]!)
      else if (k < typed) set(start + k, mid, ch, k === typed - 1 && typed < text.length ? TRAIL_HEX[0]! : TRAIL_HEX[2]!)
      else if (k < typed + 3 && ch !== ' ') set(start + k, mid, glyph(k, f), TRAIL_HEX[1]!)
      else set(start + k, mid, ' ', -1)
    }
    // A blinking block cursor after the typed text.
    if (!isFading && Math.floor(f / 4) % 2 === 0) set(start + typed, mid, '█', TRAIL_HEX[2]!)
  }

  return { columns, rows, cp, fg }
}

/**
 * A grid row as cells to lay out one per column: each glyph alone in its cell,
 * and each run of blanks as one span. A proportional font (the desktop's)
 * sets glyphs at their own widths, so only a cell per glyph keeps the columns
 * of rain straight and the row as wide as the region.
 */
export const spansOf = (grid: Grid, y: number) => {
  const spans: ({ ch: string; color: string; span: 1 } | { ch?: undefined; color?: undefined; span: number })[] = []
  for (let x = 0; x < grid.columns; x++) {
    const i = y * grid.columns + x
    const last = spans[spans.length - 1]
    if (grid.cp[i] === 0x20 || grid.fg[i]! < 0) {
      if (last && last.ch === undefined) last.span += 1
      else spans.push({ span: 1 })
    } else {
      const color = COLOR_NAME.get(grid.fg[i]!) ?? `#${grid.fg[i]!.toString(16).padStart(6, '0')}`
      spans.push({ ch: String.fromCodePoint(grid.cp[i]!), color, span: 1 })
    }
  }
  return spans
}
