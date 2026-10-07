import type { RenderElement } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { decode, lookalike, rain, rainSvg, toolSummary } from '../hooks/register'
import { phraseAt, rainGrid, spansOf } from '../hooks/rain-core'

const PROMPT = {
  component: 'UserMessage',
  props: { text: 'there is no spoon', origin: { kind: 'composer' }, isExpanded: false },
} as const

const MATRIX = {
  command: 'matrix',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 120 },
} as const

describe('matrix-skin', () => {
  test('decode turns the whole message to noise, then locks it in left to right', () => {
    const text = 'there is no spoon, only the code'
    const joined = (f: number) => decode(text, f).text
    const clearLetters = (f: number) =>
      decode(text, f).segments.filter(s => s.kind === 'clear').map(s => s.text.replace(/[^\p{L}\p{N}]/gu, '')).join('').length
    // Noise keeps the message's shape: same length, spaces where its spaces are.
    expect(Array.from(joined(0)).length).toBe(Array.from(text).length)
    expect(joined(0).split(' ').length).toBe(text.split(' ').length)
    expect(clearLetters(0)).toBe(0)
    expect(decode(text, 0).isDone).toBe(false)
    // The sweep runs left to right: early on, the start has locked more than the end.
    const mid = decode(text, 14).segments
    expect(mid.some(s => s.kind === 'clear') && mid.some(s => s.kind !== 'clear')).toBe(true)
    expect(clearLetters(14)).toBeLessThan(clearLetters(24))
    const end = decode(text, 30)
    expect(end.isDone).toBe(true)
    expect(end.segments).toEqual([{ kind: 'clear', text }])
  })

  test('your prompt is drawn green with its text on every surface', async ($, on) => {
    mock.clock(on)
    for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
      const ui = await $.ui.mount({ plugin: 'matrix-skin', surface, ...PROMPT })
      expect(await ui.find({ type: 'Text', text: /there is no spoon/ })).toBeDefined()
      await ui.unmount()
    }
  })

  test('/matrix turns the look off and on again', async ($, on) => {
    mock.store(on)
    mock.clock(on)
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return h(Text, {}, 'engine row') as RenderElement
    })
    expect((await $.command.run({ ...MATRIX, args: 'blue' })).text).toMatch(/blue pill/)
    const ui = await $.ui.mount({ plugin: 'matrix-skin', surface: 'terminal', ...PROMPT })
    expect(await ui.find({ type: 'Text', text: /engine row/ })).toBeDefined()
    await ui.unmount()
    expect((await $.command.run({ ...MATRIX, args: 'red' })).text).toMatch(/real world/)
  })

  test('the code rain band draws a Raster on the terminal', async ($, on) => {
    mock.clock(on)
    const ui = await $.ui.mount({
      plugin: 'matrix-skin',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: {
        hasSurvey: false, isWorking: true, maxRows: 20, bodyColumns: 80,
        scroll: { offset: 0, bodyRows: 19 }, view: {},
      } as never,
    })
    expect(await ui.find({ key: 'rain' })).toBeDefined()
    await ui.unmount()
  })
})

test('a prompt sent after load decodes over about a second', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: 0 })
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', ($, e) => e as never)
  await $.session.start({ source: 'startup', cwd: '/tmp', surface: 'terminal', isInteractive: true } as never)
  await clock.advance(5000)
  const ui = await $.ui.mount({ plugin: 'matrix-skin', surface: 'terminal', requestId: 'm1', ...PROMPT })
  expect(await ui.find({ type: 'Text', text: /^there is no spoon$/ })).toBeUndefined()
  await clock.advance(3000)
  expect(await ui.find({ type: 'Text', text: /^there is no spoon$/ })).toBeDefined()
  await ui.unmount()
})

test("Claude's reply is drawn by the engine with its letters scrambled, then as written", async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: 0 })
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', ($, e) => e as never)
  // The engine's own row: it draws whatever text the chain hands it.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, `engine: ${(e.props as { text: string }).text}`) as RenderElement
  })
  await $.session.start({ source: 'startup', cwd: '/tmp', surface: 'terminal', isInteractive: true } as never)
  await clock.advance(5000)
  const ui = await $.ui.mount({
    plugin: 'matrix-skin',
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: 'a1',
    props: { text: 'Wake up. The Matrix has you.', isFirstOfReply: true },
  })
  // Mid-decode the engine draws the row, scrambled but the same shape.
  expect(await ui.find({ type: 'Text', text: /^engine: / })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^engine: Wake up\. The Matrix has you\.$/ })).toBeUndefined()
  await clock.advance(3000)
  expect(await ui.find({ type: 'Text', text: /^engine: Wake up\. The Matrix has you\.$/ })).toBeDefined()
  await ui.unmount()
})

const BAND = (isWorking: boolean) => ({
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking, maxRows: 20, bodyColumns: 200, scroll: { offset: 0, bodyRows: 19 }, view: {} },
}) as never

test('the desktop band draws its rain as a Client region, idle and working', async ($, on) => {
  mock.clock(on)
  for (const isWorking of [false, true]) {
    const ui = await $.ui.mount({ plugin: 'matrix-skin', surface: 'desktop', ...(BAND(isWorking) as object) } as never)
    expect(await ui.find({ type: 'Client', key: 'rain' })).toBeDefined()
    await ui.unmount()
  }
})

test('the SVG Construct stays under the engine limit at full size', () => {
  const svg = rainSvg(1600, 220, { trace: 'Bash', isBulletTime: true })
  expect(svg.length).toBeLessThan(131072)
  expect(svg.includes('<animateTransform')).toBe(true)
})

test('idle terminal rain types a phrase on its middle row', () => {
  const columns = 80
  const rows = 3
  const f = 40 // well into the first phrase
  const { text, typed } = phraseAt(f)
  const bytes = Uint8Array.from(atob(rain(columns, rows, 0, f, false)), c => c.charCodeAt(0))
  const words = new Uint32Array(bytes.buffer)
  const start = Math.floor((columns - text.length) / 2)
  const row = Array.from({ length: typed }, (_, k) => String.fromCodePoint(words[(1 * columns + start + k) * 3]!)).join('')
  expect(row).toBe(text.slice(0, typed))
})

const middleRow = (cells: string, columns: number, rows: number) => {
  const bytes = Uint8Array.from(atob(cells), c => c.charCodeAt(0))
  const words = new Uint32Array(bytes.buffer)
  const y = Math.floor(rows / 2)
  return {
    text: Array.from({ length: columns }, (_, x) => String.fromCodePoint(words[(y * columns + x) * 3]!)).join(''),
    colors: Array.from({ length: columns }, (_, x) => words[(y * columns + x) * 3 + 1]!),
  }
}

test('a running tool shows as a trace in the working terminal rain', () => {
  const { text } = middleRow(rain(80, 3, 5, 2, true, { trace: 'Bash' }), 80, 3)
  expect(text.includes('>> TRACE')).toBe(true)
})

test('a glitch turns the terminal rain red around "Déjà vu"', () => {
  const { colors } = middleRow(rain(80, 3, 5, 2, false, { isGlitching: true }), 80, 3)
  const lit = colors.filter(c => c !== 0x01000000)
  expect(lit.length).toBeGreaterThan(0)
  expect(lit.every(c => (c >> 16) > ((c >> 8) & 0xff))).toBe(true) // red over green
})

test('the SVG Construct glitches red, and traces the running tool', () => {
  const glitch = rainSvg(1600, 220, { isGlitching: true })
  expect(glitch.includes('Déjà vu.')).toBe(true)
  expect(glitch.includes('#00ff41')).toBe(false)
  expect(rainSvg(1600, 220, { trace: 'Read' }).includes('TRACE  Read')).toBe(true)
})

test('/matrix offers the pills in the band, and the red pill turns the look on', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  on('ui.toast', () => undefined as never)
  await $.command.run({ ...MATRIX, args: 'blue' })
  expect((await $.command.run(MATRIX)).text).toMatch(/last chance/)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'matrix-skin', surface, ...(BAND(false) as object) } as never)
    expect(await ui.find({ key: 'red' })).toBeDefined()
    expect(await ui.find({ key: 'blue' })).toBeDefined()
    await ui.unmount()
  }
  const ui = await $.ui.mount({ plugin: 'matrix-skin', surface: 'terminal', ...(BAND(false) as object) } as never)
  await ui.press({ key: 'red' })
  expect(await ui.find({ key: 'red' })).toBeUndefined()
  expect(await ui.find({ key: 'rain' })).toBeDefined()
  await ui.unmount()
})

test('bullet time slows the trace and ripples the SVG Construct', () => {
  const svg = rainSvg(1600, 220, { trace: 'Bash', isBulletTime: true })
  expect(svg.includes('BULLET TIME')).toBe(true)
  expect(svg.includes('<ellipse')).toBe(true)
  const { text } = middleRow(rain(100, 3, 5, 2, true, { trace: 'Bash', isBulletTime: true }), 100, 3)
  expect(text.includes('bullet time')).toBe(true)
})

test('/construct opens a pane with rain and the operator console on each surface', async ($, on) => {
  mock.clock(on)
  on('ui.open', () => ({ value: undefined }) as never)
  expect((await $.command.run({ ...MATRIX, command: 'construct' })).text).toMatch(/Construct/)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'matrix-skin',
      surface,
      component: 'Pane',
      requestId: 'matrix-construct',
      props: { title: 'The Construct', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
    } as never)
    expect(await ui.find({ type: 'Text', text: /OPERATOR CONSOLE/ })).toBeDefined()
    expect(await ui.find(surface === 'terminal' ? { type: 'Raster' } : { type: 'Client', key: 'construct-rain' })).toBeDefined()
    await ui.unmount()
  }
})

test('a decoding reply keeps its markdown, its links and its letter widths', () => {
  const text = '## Done\n\n- **Bold** item, see [docs](https://example.com/x) and `code`.\n- 42 lines'
  const { text: scrambled } = decode(text, 0, lookalike)
  // Markers, punctuation, spacing and the link target never change.
  expect(scrambled.replace(/[\p{L}\p{N}]/gu, '')).toBe(text.replace(/[\p{L}\p{N}]/gu, ''))
  expect(scrambled.includes('](https://example.com/x)')).toBe(true)
  // Every scrambled letter keeps its width class (a narrow i never becomes a wide m).
  const narrow = /[ijlt]/
  Array.from(text).forEach((ch, i) => {
    if (narrow.test(ch)) expect(narrow.test(Array.from(scrambled)[i]!)).toBe(true)
  })
  expect(scrambled).not.toBe(text)
})

test('the pointer parts the rain, and a click sends a ring of light through it', () => {
  const columns = 60
  const rows = 9
  const at = (g: { cp: Uint32Array; fg: Int32Array }, x: number, y: number) => ({ cp: g.cp[y * columns + x]!, fg: g.fg[y * columns + x]! })
  // Find a frame where the cell under the pointer carries a glyph, then part it.
  let t = 0
  while (at(rainGrid(columns, rows, t, 0, true), 30, 4).cp === 0x20 && t < 500) t++
  expect(at(rainGrid(columns, rows, t, 0, true), 30, 4).cp).not.toBe(0x20)
  const parted = rainGrid(columns, rows, t, 0, true, {}, { pointer: { x: 30, y: 4 } })
  expect(at(parted, 30, 4)).toEqual({ cp: 0x20, fg: -1 })
  expect(at(parted, 34, 4).fg).toBe(0xa8ffb8) // the rim burns bright
  // A ripple of age 5 is a ring 8 cells out: lit there, on an otherwise idle row.
  const ring = rainGrid(columns, rows, 0, 0, true, {}, { ripples: [{ x: 30, y: 4, age: 5 }] })
  expect(at(ring, 38, 4).fg).toBe(0xa8ffb8)
})

test('tool summaries pick the command, path, pattern or task', () => {
  expect(toolSummary('Bash', { command: 'npm test\nmore', description: 'x' })).toBe('npm test')
  expect(toolSummary('Read', { file_path: 'src/app.ts' })).toBe('src/app.ts')
  expect(toolSummary('Grep', { pattern: 'TODO', path: 'src' })).toBe('TODO  in src')
  expect(toolSummary('Agent', { description: 'find the bug', prompt: 'long' })).toBe('find the bug')
})

test('Bash rows are drawn as green trace lines; Edit rows keep the engine\'s own', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, 'engine row') as RenderElement
  })
  const row = (tool: string, input: unknown) => ({
    plugin: 'matrix-skin', component: 'ToolUse', requestId: `t-${tool}`,
    props: { tool_use_id: `t-${tool}`, tool, input, isRunning: false, isErrored: false, isInterrupted: false },
  }) as never
  for (const surface of ['terminal', 'desktop'] as const) {
    const bash = await $.ui.mount({ ...(row('Bash', { command: 'npm test' }) as object), surface } as never)
    expect(await bash.find({ type: 'Text', text: /npm test/ })).toBeDefined()
    expect(await bash.find({ type: 'Text', text: /engine row/ })).toBeUndefined()
    await bash.unmount()
    const edit = await $.ui.mount({ ...(row('Edit', { file_path: 'a.ts' }) as object), surface } as never)
    expect(await edit.find({ type: 'Text', text: /engine row/ })).toBeDefined()
    await edit.unmount()
  }
})

test('a subagent is an Agent Smith: announced, counted and named on its spinner', async ($, on) => {
  const toasts: string[] = []
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined } as never
  })
  on('agent.spawn', () => ({ model: 'haiku', agentId: 'smith-1' }) as never)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, `engine: ${(e.props as { word: string }).word}`) as RenderElement
  })
  await $.agent.spawn({ prompt: 'look around', description: 'find the bug', subagentType: 'Explore' })
  expect(toasts).toContain('Agent Smith deployed: find the bug')
  const spinner = await $.ui.mount({
    plugin: 'matrix-skin', surface: 'desktop', component: 'Spinner', requestId: 'smith-1',
    props: { word: 'Searching', message: null, suffix: '…', mode: 'tool-use' },
  } as never)
  expect(await spinner.find({ type: 'Text', text: /Agent Smith · Searching/ })).toBeDefined()
  await spinner.unmount()
})

test('a finished turn puts its time on the status line, then the operator\'s report', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const lines: (string | undefined)[] = []
  on('ui.status', ($, e) => {
    lines.push(e.text)
    return { value: undefined } as never
  })
  on('model.complete', () => ({ value: { isAnswered: true, text: '"Neo patched the auth glitch."', usage: {} } }) as never)
  on('turn.complete', ($, e) => ({ text: e.answer }) as never)
  await $.turn.complete({ answer: 'I fixed the null check in auth.ts.', durationMs: 12000, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  expect(lines.at(-1)).toMatch(/◢ .+ after 12s$/)
  await clock.advance(50)
  expect(lines.at(-1)).toMatch(/after 12s · Operator: Neo patched the auth glitch\.$/)
})

test('/matrix morpheus adds the Morpheus voice to the system prompt, and takes it away', async ($, on) => {
  mock.store(on)
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude.', scope: 'shared' }] }) as never)
  const ids = async () => (await $.prompt.compose({ model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['desktop'], tools: [], outputStyle: null, traits: [] })).sections.map(s => s.id)
  expect(await ids()).not.toContain('matrix-skin:morpheus')
  expect((await $.command.run({ ...MATRIX, args: 'morpheus on' })).text).toMatch(/Morpheus mode on/)
  expect(await ids()).toContain('matrix-skin:morpheus')
  expect((await $.command.run({ ...MATRIX, args: 'morpheus' })).text).toMatch(/Morpheus mode off/)
  expect(await ids()).not.toContain('matrix-skin:morpheus')
})

test('a rain row lays out as one cell per glyph and one span per run of blanks', async () => {
  const grid = rainGrid(40, 5, 7, 3, true)
  for (let y = 0; y < 5; y++) {
    const spans = spansOf(grid, y)
    expect(spans.reduce((n, s) => n + s.span, 0)).toBe(40) // exactly as wide as the region
    for (const s of spans) if (s.ch !== undefined) expect(Array.from(s.ch).length).toBe(1)
    for (let k = 1; k < spans.length; k++) expect(spans[k]!.ch === undefined && spans[k - 1]!.ch === undefined).toBe(false)
  }
})
