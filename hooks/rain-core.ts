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
/** How long the jack-in boot sequence runs, in frames (about 3.6s). */
export const BOOT_FRAMES = 45

// The boot sequence's lines, as the film opens.
const BOOT_LINES = ['Call trans opt: received. 2-19-98 13:24:18 REC:Log>', 'Trace program: running']
// While an Agent Smith deploys, the rain replicates him.
const SMITH = 'SMITH'

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

/**
 * What the rain shows over itself: the running tool, a glitch, bullet time,
 * the jack-in boot sequence, and an Agent Smith being deployed (his task).
 */
export type Overlay = { trace?: string; isGlitching?: boolean; isBulletTime?: boolean; isBooting?: boolean; smith?: string }

/** A position in a Client region, in cells. */
export type Point = { x: number; y: number }
/** A click's ring of light, `age` frames old. */
export type Ripple = Point & { age: number }
/** The pointer over a Client region, the ripples its clicks sent, and how far the boot sequence has run. */
export type Field = { pointer?: Point | null; ripples?: Ripple[]; bootFrames?: number }

/** One frame of rain: a code point, a color and a background (`-1`, the default) per cell, row-major. */
export type Grid = { columns: number; rows: number; cp: Uint32Array; fg: Int32Array; bg: Int32Array }

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
  const bg = new Int32Array(columns * rows).fill(-1)
  const set = (x: number, y: number, ch: string, color: number) => {
    if (x < 0 || y < 0 || x >= columns || y >= rows) return
    cp[y * columns + x] = ch.codePointAt(0)!
    fg[y * columns + x] = color
  }

  if (overlay.isBooting) {
    bootScreen(columns, rows, Math.max(0, field.bootFrames ?? 0), f, set)
    return { columns, rows, cp, fg, bg }
  }

  const alphabet = overlay.smith ? SMITH : GLYPHS
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
      set(x, y, glyph(x * 31 + y, flicker, alphabet), pal[shade]!)
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
  } else if (overlay.smith && columns >= 24) {
    // "Mr. Anderson...": the announcement holds steady while the rain replicates.
    const room = columns - 26
    const task = overlay.smith.length > room ? `${overlay.smith.slice(0, Math.max(0, room - 1))}…` : overlay.smith
    label(task ? `AGENT SMITH DEPLOYED: ${task}` : 'AGENT SMITH DEPLOYED', TRAIL_HEX[0]!, () => false)
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

  return { columns, rows, cp, fg, bg }
}

/**
 * The jack-in boot sequence, `b` frames in: the film's opening lines type
 * themselves out, then a bar fills while the session jacks in.
 */
const bootScreen = (columns: number, rows: number, b: number, f: number, set: (x: number, y: number, ch: string, color: number) => void) => {
  const pct = Math.min(100, Math.round((b / BOOT_FRAMES) * 100))
  const width = Math.max(8, Math.min(30, columns - 22))
  const filled = Math.round((width * pct) / 100)
  const bar = `JACKING IN [${'█'.repeat(filled)}${'░'.repeat(width - filled)}] ${pct}%`
  // Each line starts typing at its frame, about two characters a frame.
  const lines = [
    { text: BOOT_LINES[0]!, typed: Math.floor(b * 2.5) },
    { text: BOOT_LINES[1]!, typed: Math.floor((b - 20) * 2) },
    { text: bar, typed: b >= 26 ? bar.length : 0 },
  ]
  const shown = rows >= 3 ? lines : rows === 2 ? [lines[0]!, lines[2]!] : [lines[2]!]
  const top = Math.max(0, Math.floor((rows - shown.length) / 2))
  shown.forEach((line, k) => {
    const chars = Array.from(line.text)
    const typed = Math.max(0, Math.min(chars.length, line.typed))
    chars.slice(0, typed).forEach((ch, x) => set(2 + x, top + k, ch, ch === '░' ? TRAIL_HEX[7]! : TRAIL_HEX[2]!))
    // A blinking block cursor on the line still typing.
    if (typed > 0 && typed < chars.length && Math.floor(f / 3) % 2 === 0) set(2 + typed, top + k, '█', TRAIL_HEX[0]!)
  })
}

/**
 * Keeps at most `budget` glyphs of rain outside the text regions, dropping the
 * dimmest first: every drawn glyph is a node the surface serializes each
 * frame, and a tree past its bounds is not drawn at all.
 */
export const thinRain = (grid: Grid, budget: number, regions: Map<number, Region[]> = new Map()) => {
  const inText = (x: number, y: number) => (regions.get(y) ?? []).some(r => x >= r.x && x < r.x + r.width)
  const glyphs: { i: number; light: number }[] = []
  for (let y = 0; y < grid.rows; y++) {
    for (let x = 0; x < grid.columns; x++) {
      const i = y * grid.columns + x
      if (grid.cp[i] === 0x20 || grid.fg[i]! < 0 || inText(x, y)) continue
      const c = grid.fg[i]!
      glyphs.push({ i, light: Math.max((c >> 16) & 0xff, (c >> 8) & 0xff) })
    }
  }
  if (glyphs.length <= budget) return
  glyphs.sort((a, b) => a.light - b.light)
  for (const { i } of glyphs.slice(0, glyphs.length - budget)) {
    grid.cp[i] = 0x20
    grid.fg[i] = -1
  }
}

/** A palette color, or any other, as the `#rrggbb` string Text takes. */
export const colorName = (color: number) => COLOR_NAME.get(color) ?? `#${color.toString(16).padStart(6, '0')}`

/** A stretch of a row that holds text: drawn as one block, its cells kept together. */
export type Region = { x: number; width: number }

/** One part of a laid-out row: a glyph in its own cell, a run of blanks, or a block of text. */
export type RowPart =
  | { kind: 'cell'; ch: string; color: string }
  | { kind: 'gap'; span: number }
  | { kind: 'text'; width: number; runs: { text: string; color?: string; bg?: string }[] }

/**
 * A grid row as parts to lay out left to right. Each glyph of rain sits alone
 * in its cell and each run of blanks is one span: a proportional font (the
 * desktop's) sets glyphs at their own widths, so only a cell per glyph keeps
 * the columns of rain straight and the row as wide as the region. A region of
 * text is one block of colored runs, so a line of readout stays one line.
 */
export const rowParts = (grid: Grid, y: number, regions: Region[] = []) => {
  const parts: RowPart[] = []
  const sorted = [...regions].sort((a, b) => a.x - b.x)
  let x = 0
  for (const region of [...sorted, { x: grid.columns, width: 0 }]) {
    for (; x < Math.min(region.x, grid.columns); x++) {
      const i = y * grid.columns + x
      const last = parts[parts.length - 1]
      if (grid.cp[i] === 0x20 || grid.fg[i]! < 0) {
        if (last?.kind === 'gap') last.span += 1
        else parts.push({ kind: 'gap', span: 1 })
      } else {
        parts.push({ kind: 'cell', ch: String.fromCodePoint(grid.cp[i]!), color: colorName(grid.fg[i]!) })
      }
    }
    const end = Math.min(grid.columns, region.x + region.width)
    if (x >= end) continue
    const runs: { text: string; color?: string; bg?: string }[] = []
    for (; x < end; x++) {
      const i = y * grid.columns + x
      const color = grid.fg[i]! < 0 ? undefined : colorName(grid.fg[i]!)
      const bg = grid.bg[i]! < 0 ? undefined : colorName(grid.bg[i]!)
      const ch = String.fromCodePoint(grid.cp[i]!)
      const last = runs[runs.length - 1]
      if (last && last.color === color && last.bg === bg) last.text += ch
      else runs.push({ text: ch, color, bg })
    }
    parts.push({ kind: 'text', width: end - region.x, runs })
  }
  return parts
}

/** A rain row with no text in it, as cells and spans of blanks. */
export const spansOf = (grid: Grid, y: number) =>
  rowParts(grid, y).map(part =>
    part.kind === 'cell' ? { ch: part.ch, color: part.color, span: 1 as const } : { ch: undefined, color: undefined, span: part.kind === 'gap' ? part.span : 0 },
  )
