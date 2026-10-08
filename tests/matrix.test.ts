import type { RenderElement } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { decode, detailOf, lookalike, parseZion, rain, rainSvg, repeatOf, toolSummary } from '../hooks/register'
import { SENTINEL_FRAMES, nextSentinels, phraseAt, rainGrid, spansOf, thinRain } from '../hooks/rain-core'
import { actionAt, layoutConstruct, paintConstruct } from '../hooks/construct-core'

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

test('/construct opens a pane of rain with the readout in it and its controls on each surface', async ($, on) => {
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
    if (surface === 'terminal') {
      expect(await ui.find({ type: 'Raster', key: 'construct-rain' })).toBeDefined()
      expect(await ui.find({ key: 'control-0' })).toBeDefined() // [SOUND ●], pressed by a key on the terminal
    } else {
      const client = (await ui.find({ type: 'Client', key: 'construct-rain' })) as { props?: { props?: { construct?: { switches?: object } } } }
      expect(client?.props?.props?.construct?.switches).toBeDefined()
    }
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
  mock.clock(on)
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
  await $.agent.spawn({ prompt: 'look around', description: 'find the bug', subagentType: 'Explore' } as never)
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

const gridRow = (grid: { columns: number; cp: Uint32Array }, y: number) =>
  Array.from({ length: grid.columns }, (_, x) => String.fromCodePoint(grid.cp[y * grid.columns + x]!)).join('')

test('the boot sequence types the opening lines, then fills the jack-in bar', () => {
  const start = rainGrid(80, 3, 0, 0, true, { isBooting: true }, { bootFrames: 0 })
  expect([0, 1, 2].map(y => gridRow(start, y).trim()).join('')).toBe('') // nothing typed yet, no rain
  const end = rainGrid(80, 3, 9, 45, true, { isBooting: true }, { bootFrames: 45 })
  expect(gridRow(end, 0)).toContain('Call trans opt: received.')
  expect(gridRow(end, 1)).toContain('Trace program: running')
  expect(gridRow(end, 2)).toContain('JACKING IN [')
  expect(gridRow(end, 2)).toContain('] 100%')
  // A one-row band shows the bar alone.
  expect(gridRow(rainGrid(80, 1, 0, 45, true, { isBooting: true }, { bootFrames: 45 }), 0)).toContain('JACKING IN')
})

test('a deployed Agent Smith is announced in the band while the rain replicates him', () => {
  const grid = rainGrid(80, 5, 7, 3, true, { smith: 'find the bug' })
  expect(gridRow(grid, 2)).toContain('AGENT SMITH DEPLOYED: find the bug')
  for (const y of [0, 1, 3, 4]) {
    const glyphs = gridRow(grid, y).replace(/ /g, '')
    expect(glyphs.length).toBeGreaterThan(0)
    expect(/^[SMITH]+$/.test(glyphs)).toBe(true)
  }
})

/** The overlay the desktop band hands its rain region right now. */
const bandOverlay = async ($: never) => {
  const ui = await (($ as { ui: { mount: (a: never) => Promise<{ find: (q: object) => Promise<{ props?: { props?: { overlay?: Record<string, unknown> } } } | undefined>; unmount: () => Promise<void> }> } }).ui.mount({ plugin: 'matrix-skin', surface: 'desktop', ...(BAND(false) as object) } as never))
  const client = await ui.find({ type: 'Client', key: 'rain' })
  await ui.unmount()
  return client?.props?.props?.overlay ?? {}
}

test('each session opens with the boot sequence, which ends by itself', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: 0 })
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('session.start', ($, e) => e as never)
  await $.session.start({ source: 'startup', cwd: '/tmp', surface: 'desktop', isInteractive: true } as never)
  expect((await bandOverlay($ as never)).isBooting).toBe(true)
  await clock.advance(4000)
  expect((await bandOverlay($ as never)).isBooting).toBe(false)
})

test('a spawn puts its task in the band for a few seconds', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  on('ui.toast', () => ({ value: undefined }) as never)
  on('agent.spawn', () => ({ model: 'haiku', agentId: 'smith-2' }) as never)
  await $.agent.spawn({ prompt: 'look around', description: 'find the bug', subagentType: 'Explore' } as never)
  expect((await bandOverlay($ as never)).smith).toBe('find the bug')
  await clock.advance(4000)
  expect((await bandOverlay($ as never)).smith).toBe('')
})

/**
 * Records the clips and words the plugin asks to play, on a machine whose OS
 * variable is `os` (Windows_NT plays through PowerShell); `fail` makes every
 * player reject, as a machine without one does.
 */
const listen = (on: never, fail = false, os?: string) => {
  const heard: string[] = []
  const hook = on as (event: string, fn: (...a: never[]) => unknown) => void
  hook('env.get', (($: unknown, e: { name: string }) => ({ value: e.name === 'OS' ? os : undefined })) as never)
  hook('process.run', (($: unknown, e: { argv: readonly string[]; init?: { env?: Record<string, string> } }) => {
    if (fail) throw new Error('no powershell')
    heard.push(`ps: ${e.argv[e.argv.length - 1]}${e.init?.env?.MATRIX_SKIN_CLIP ? ` < ${e.init.env.MATRIX_SKIN_CLIP}` : ''}`)
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  }) as never)
  hook('audio.play', (($: unknown, e: { clip: { asset?: string } }) => {
    if (fail) throw new Error('no player')
    heard.push(e.clip.asset ?? '?')
    return { value: undefined }
  }) as never)
  hook('audio.speak', (($: unknown, e: { text: string }) => {
    if (fail) throw new Error('no synthesizer')
    heard.push(`say: ${e.text}`)
    return { value: { via: 'system' } }
  }) as never)
  return heard
}

test('the jack-in plays its sound when a session starts', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: 0 })
  const heard = listen(on as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('session.start', ($, e) => e as never)
  await $.session.start({ source: 'startup', cwd: '/tmp', surface: 'desktop', isInteractive: true } as never)
  await clock.advance(10)
  expect(heard).toEqual(['sounds/boot.wav'])
})

test('an Agent Smith deploys with his sound, once for several at once, and his voice only when switched on', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: 100_000 })
  const heard = listen(on as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('agent.spawn', () => ({ model: 'haiku', agentId: `smith-${Math.random()}` }) as never)
  for (const description of ['one', 'two', 'three']) await $.agent.spawn({ prompt: 'x', description, subagentType: 'Explore' } as never)
  await clock.advance(10)
  expect(heard).toEqual(['sounds/smith.wav']) // the voice is off by default
  expect((await $.command.run({ ...MATRIX, args: 'voice on' })).text).toMatch(/Voice on/)
  await clock.advance(6000)
  await $.agent.spawn({ prompt: 'x', description: 'four', subagentType: 'Explore' } as never)
  await clock.advance(10)
  expect(heard).toEqual(['sounds/smith.wav', 'sounds/smith.wav', 'say: Mister Anderson.'])
})

test('/matrix sound off keeps the plugin silent, and a missing player is no error', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: 100_000 })
  const heard = listen(on as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('agent.spawn', () => ({ model: 'haiku', agentId: 'smith-quiet' }) as never)
  expect((await $.command.run({ ...MATRIX, args: 'sound off' })).text).toMatch(/Sound off/)
  await $.agent.spawn({ prompt: 'x', description: 'quiet', subagentType: 'Explore' } as never)
  await clock.advance(10)
  expect(heard).toEqual([])
})

test('a machine with no audio player still deploys Smith without an error', async ($, on) => {
  const clock = mock.clock(on, { now: 100_000 })
  listen(on as never, true)
  const toasts: string[] = []
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined } as never
  })
  on('agent.spawn', () => ({ model: 'haiku', agentId: 'smith-mute' }) as never)
  await $.agent.spawn({ prompt: 'x', description: 'mute', subagentType: 'Explore' } as never)
  await clock.advance(10)
  expect(toasts).toContain('Agent Smith deployed: mute')
})

test('on Windows the sounds and the voice go through the built-in player and synthesizer', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: 100_000 })
  const heard = listen(on as never, false, 'Windows_NT')
  on('ui.toast', () => ({ value: undefined }) as never)
  on('agent.spawn', () => ({ model: 'haiku', agentId: 'smith-win' }) as never)
  await $.command.run({ ...MATRIX, args: 'voice on' })
  await $.agent.spawn({ prompt: 'x', description: 'windows', subagentType: 'Explore' } as never)
  await clock.advance(10)
  expect(heard.length).toBe(2)
  expect(heard[0]).toContain('Media.SoundPlayer')
  expect(heard[0]).toContain('/sounds/smith.wav')
  expect(heard[1]).toContain("SpeechSynthesizer")
  expect(heard[1]).toContain("Speak('Mister Anderson.')")
})

const DATA = {
  now: Date.UTC(2026, 9, 8, 9, 30, 0),
  status: { text: 'TRACING Bash', tone: 'trace' },
  stats: { calls: 3, failures: 1, bulletTimes: 0, smiths: 1 },
  trace: [
    { id: 't1', at: Date.UTC(2026, 9, 8, 9, 29, 50), tool: 'Read', summary: 'src/app.ts', who: '', ms: 300, ok: true },
    { id: 't2', at: Date.UTC(2026, 9, 8, 9, 29, 55), tool: 'Bash', summary: 'npm test', who: '', ms: 1200, ok: false },
    { id: 't3', at: Date.UTC(2026, 9, 8, 9, 29, 59), tool: 'Grep', summary: 'TODO', who: 'SMITH › ' },
  ],
  smiths: [{ id: 's1', task: 'find the bug', since: Date.UTC(2026, 9, 8, 9, 29, 18), calls: 7 }],
  switches: { isOn: true, sound: true, voice: false, rows: true, operator: true, morpheus: false },
  zion: { isRepo: true, branch: 'main', ahead: 2, behind: 0, changed: 3 },
  doors: [{ path: 'hooks/register.tsx', reads: 4, edits: 2 }],
  doorCount: 1,
  oracle: null,
  lifetime: { ms: 7_380_000, calls: 3204, failures: 40, smiths: 12, bulletTimes: 9, sessions: 14 },
} as const

test('the Construct lays out its readout: title, trace log, roster and controls, all inside the pane', () => {
  const lines = layoutConstruct(60, 30, DATA as never, DATA.now)
  const text = lines.map(l => l.text).join('\n')
  expect(text).toContain('◢ THE CONSTRUCT')
  expect(text).toContain('◢ TRACE LOG')
  expect(text).toMatch(/✓\s+0\.3s Read  src\/app\.ts/)
  expect(text).toMatch(/✖\s+1\.2s Bash  npm test/)
  expect(text).toMatch(/◌\s+… SMITH › Grep  TODO/)
  expect(text).toContain('◢ find the bug  0:42  7 calls')
  expect(text).toContain('ZION  main ↑2 · 3 changed')
  expect(text).toContain('LIFE  2h 3m jacked in · 3,204 calls · 14 sessions')
  expect(text).toContain('◢ THE KEYMAKER · 1 door opened')
  expect(text).toMatch(/R4\s+E2\s+hooks\/register\.tsx/)
  const controls = lines.filter(l => l.action && !('expand' in l.action)).map(l => l.text)
  expect(controls).toEqual(['[SOUND ●]', '[VOICE ○]', '[ROWS ●]', '[OPERATOR ●]', '[MORPHEUS ○]', '[ORACLE]', '[BLUE PILL]'])
  expect(lines.every(l => l.y >= 0 && l.y < 30 && l.x + Array.from(l.text).length <= 60)).toBe(true)
  // A click on a control finds its action.
  const voice = lines.find(l => l.text === '[VOICE ○]')!
  expect(actionAt(lines, { x: voice.x + 2, y: voice.y })).toEqual({ toggle: 'voice' })
  expect(actionAt(lines, { x: 0, y: 0 })).toBeUndefined()
})

test('a readout line decodes out of the rain, and only its changed characters decode again', () => {
  const grid = () => rainGrid(40, 6, 0, 0, true)
  const read = (g: { columns: number; cp: Uint32Array }, y: number, x: number, n: number) =>
    Array.from({ length: n }, (_, i) => String.fromCodePoint(g.cp[y * g.columns + x + i]!)).join('')
  const memory = new Map()
  const line = { key: 'stats', x: 2, y: 1, text: 'calls 3', color: 0x008f11 }
  const first = grid()
  paintConstruct(first, [line], 0, memory)
  expect(read(first, 1, 2, 7)).not.toBe('calls 3') // still scrambled
  const later = grid()
  paintConstruct(later, [line], 30, memory)
  expect(read(later, 1, 2, 7)).toBe('calls 3')
  // The count ticks up: only the digit scrambles again.
  const changed = grid()
  paintConstruct(changed, [{ ...line, text: 'calls 4' }], 31, memory)
  expect(read(changed, 1, 2, 6)).toBe('calls ')
  expect(read(changed, 1, 8, 1)).not.toBe('4')
})

test('tool calls go into the trace log the desktop Construct shows', async ($, on) => {
  mock.clock(on, { now: 1_000 })
  on('tool.call', () => ({ result: { stdout: 'ok' }, isError: false }) as never)
  await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
  const ui = await $.ui.mount({
    plugin: 'matrix-skin', surface: 'desktop', component: 'Pane', requestId: 'matrix-construct',
    props: { title: 'The Construct', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  } as never)
  const client = (await ui.find({ type: 'Client', key: 'construct-rain' })) as { props?: { props?: { construct?: { trace?: { tool: string; summary: string; ok?: boolean }[] } } } }
  await ui.unmount()
  const entry = client?.props?.props?.construct?.trace?.at(-1)
  expect(entry?.tool).toBe('Bash')
  expect(entry?.summary).toBe('npm test')
  expect(entry?.ok).toBe(true)
})

test('the rain keeps under its glyph budget, dropping the dimmest glyphs first', () => {
  const grid = rainGrid(120, 60, 9, 4, true)
  const lit = () => Array.from(grid.fg).filter(c => c >= 0)
  const brightest = Math.max(...lit().map(c => (c >> 8) & 0xff))
  expect(lit().length).toBeGreaterThan(100) // a tall grid is mostly dark: well under the real budget of 700
  thinRain(grid, 100)
  expect(lit().length).toBe(100)
  expect(Math.max(...lit().map(c => (c >> 8) & 0xff))).toBe(brightest) // the heads survive
})

const ENTRY = (n: number, ok: boolean, more: object = {}) => ({
  id: `t${n}`, at: DATA.now - (60 - n) * 1000, tool: 'Bash', summary: `step ${n}`, who: '', ms: 100, ok, detail: [`$ step ${n}`, `out ${n}`], ...more,
})

test('a short pane keeps its header and controls, drops the lowest blocks first, and keeps the newest calls', () => {
  const data = { ...DATA, trace: Array.from({ length: 30 }, (_, n) => ENTRY(n, true)) }
  const lines = layoutConstruct(60, 16, data as never, DATA.now)
  const text = lines.map(l => l.text).join('\n')
  expect(lines.every(l => l.y < 16)).toBe(true)
  expect(text).toContain('◢ THE CONSTRUCT')
  expect(text).toContain('[BLUE PILL]') // the controls never fall off the bottom
  expect(text).toContain('step 29') // the newest call shows
  expect(text).not.toContain('step 0 ')
  expect(text).not.toContain('LIFE') // the lowest-ranked block went first
  expect(text).not.toContain('KEYMAKER')
  // A tall pane has room for everything.
  const tall = layoutConstruct(60, 60, data as never, DATA.now).map(l => l.text).join('\n')
  expect(tall).toContain('LIFE')
  expect(tall).toContain('KEYMAKER')
})

test('a click on a trace line opens it: its command and the tail of its output, under it', () => {
  const data = { ...DATA, trace: [ENTRY(1, true), ENTRY(2, false)] }
  const closed = layoutConstruct(60, 40, data as never, DATA.now)
  const line = closed.find(l => l.key === 'trace:t2')!
  expect(actionAt(closed, { x: line.x + 3, y: line.y })).toEqual({ expand: 't2' })
  expect(closed.some(l => l.key.startsWith('detail:'))).toBe(false)
  const open = layoutConstruct(60, 40, data as never, DATA.now, 't2')
  const details = open.filter(l => l.key.startsWith('detail:t2:')).map(l => l.text)
  expect(details).toEqual(['│ $ step 2', '│ out 2'])
  expect(open.find(l => l.key === 'detail:t2:0')!.y).toBe(open.find(l => l.key === 'trace:t2')!.y + 1)
})

test('an opened line shows the command, then the last lines of output, without escape codes', () => {
  const output = ['one', 'two', '\x1b[31mthree\x1b[0m', '', 'four', 'five', 'six', 'seven'].join('\n')
  expect(detailOf({ command: 'npm test' }, output)).toEqual(['$ npm test', 'three', 'four', 'five', 'six', 'seven'])
  expect(detailOf({}, '')).toEqual(['(no output)'])
})

test('déjà vu: the same failing call counts its repeats until it succeeds', () => {
  const call = (n: number, ok?: boolean) => ({ id: `d${n}`, at: n, tool: 'Bash', summary: 'npm test', who: '', ok })
  const log = [call(1, false), { ...call(2, true), summary: 'ls' }, call(3, false)]
  expect(repeatOf([...log, call(4)], call(4))).toBe(3)
  expect(repeatOf([call(1, false), call(2, true), call(3)], call(3))).toBe(1) // a success ends the loop
  expect(repeatOf([call(1, false), { ...call(2, false), who: 'SMITH › ' }, call(3)], call(3))).toBe(2) // a Smith's call is his own
})

test('three failures of one command: a déjà vu toast, the status line, and a Sentinel for each', async ($, on) => {
  mock.clock(on, { now: 1_000 })
  const toasts: string[] = []
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined } as never
  })
  on('tool.call', () => ({ result: { stdout: '' }, text: 'Error: 3 tests failed', isError: true }) as never)
  for (const id of ['f1', 'f2', 'f3']) await $.tool.call({ tool: 'Bash', command: 'npm test', tool_use_id: id } as never)
  expect(toasts).toContain('Déjà vu: Bash npm test has failed 3 times in a row.')
  const ui = await $.ui.mount({
    plugin: 'matrix-skin', surface: 'desktop', component: 'Pane', requestId: 'matrix-construct',
    props: { title: 'The Construct', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  } as never)
  const client = (await ui.find({ type: 'Client', key: 'construct-rain' })) as { props?: { props?: { overlay?: { sentinels?: number }; construct?: { status?: { text: string }; trace?: { repeat?: number; detail?: string[] }[] } } } }
  await ui.unmount()
  const props = client?.props?.props
  expect(props?.overlay?.sentinels).toBe(3)
  expect(props?.construct?.status?.text).toMatch(/^DÉJÀ VU  Bash npm test ×3/)
  expect(props?.construct?.trace?.at(-1)?.repeat).toBe(3)
  expect(props?.construct?.trace?.at(-1)?.detail).toEqual(['$ npm test', 'Error: 3 tests failed'])
})

test('a failed call sends a Sentinel across the rain; the first look sends none', () => {
  expect(nextSentinels([], undefined, 5)).toEqual([]) // failures before the rain looked
  const sent = nextSentinels([], 5, 6)
  expect(sent.length).toBe(1)
  let crossing = sent
  for (let k = 0; k < SENTINEL_FRAMES; k++) crossing = nextSentinels(crossing, 6, 6)
  expect(crossing).toEqual([]) // across and gone
  // Midway, his eyes burn red in the rain.
  const grid = rainGrid(60, 9, 0, 0, false, {}, { sentinels: [{ seed: 1, age: 20 }] })
  const eyes = Array.from(grid.cp).map((cp, i) => ({ cp, fg: grid.fg[i]! })).filter(c => c.cp === 0x25cf)
  expect(eyes.length).toBeGreaterThan(0)
  expect(eyes.every(c => (c.fg >> 16) > ((c.fg >> 8) & 0xff))).toBe(true)
})

test('Zion reads the branch, its drift from the remote and what changed', () => {
  expect(parseZion('## main...origin/main [ahead 2, behind 1]\n M a.ts\n?? b.ts\n')).toEqual({ isRepo: true, branch: 'main', ahead: 2, behind: 1, changed: 2 })
  expect(parseZion('## No commits yet on trunk\n')).toEqual({ isRepo: true, branch: 'trunk', ahead: 0, behind: 0, changed: 0 })
  expect(parseZion('## HEAD (no branch)\r\n')).toMatchObject({ branch: 'detached' })
})

test('Zion runs git after a call that can change the working copy', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  const runs: string[] = []
  on('process.run', ($, e) => {
    runs.push(e.argv.join(' '))
    return { value: { exitCode: 0, stdout: '## dev...origin/dev [behind 4]\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } as never
  })
  on('tool.call', () => ({ result: {}, text: 'ok', isError: false }) as never)
  await $.tool.call({ tool: 'Edit', file_path: 'C:\\work\\app\\src\\main.ts', tool_use_id: 'e1' } as never)
  await $.tool.call({ tool: 'Read', file_path: 'C:\\work\\app\\src\\main.ts', tool_use_id: 'r1' } as never)
  expect(runs).toEqual([]) // it waits for the burst to settle
  await clock.advance(2000)
  expect(runs).toEqual(['git status --porcelain=v1 --branch'])
  const ui = await $.ui.mount({
    plugin: 'matrix-skin', surface: 'desktop', component: 'Pane', requestId: 'matrix-construct',
    props: { title: 'The Construct', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  } as never)
  const client = (await ui.find({ type: 'Client', key: 'construct-rain' })) as { props?: { props?: { construct?: { zion?: object; doors?: object[]; doorCount?: number } } } }
  await ui.unmount()
  const data = client?.props?.props?.construct
  expect(data?.zion).toEqual({ isRepo: true, branch: 'dev', ahead: 0, behind: 4, changed: 0 })
  // The Keymaker counts the file once per read and once per edit, by its last two parts.
  expect(data?.doors).toEqual([{ path: 'src/main.ts', reads: 1, edits: 1 }])
  expect(data?.doorCount).toBe(1)
})

test('the Oracle control asks a small model, and her answer reaches the Construct', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  const asked: string[] = []
  on('model.complete', ($, e) => {
    asked.push(e.prompt as string)
    return { value: { isAnswered: true, text: '"The test you keep running is not the test that is failing."', usage: {} } } as never
  })
  const mount = (surface: 'desktop' | 'terminal') => $.ui.mount({
    plugin: 'matrix-skin', surface, component: 'Pane', requestId: 'matrix-construct',
    props: { title: 'The Construct', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  } as never)
  const oracleOf = async () => {
    const ui = await mount('desktop')
    const client = (await ui.find({ type: 'Client', key: 'construct-rain' })) as { props?: { props?: { construct?: { oracle?: { text: string; isConsulting: boolean } | null } } } }
    await ui.unmount()
    return client?.props?.props?.construct?.oracle
  }
  expect(await oracleOf()).toBeNull()
  // [ORACLE], the sixth control: a key on the terminal, a click on the desktop.
  const terminal = await mount('terminal')
  await terminal.press({ key: 'control-5' })
  await terminal.unmount()
  expect((await oracleOf())?.isConsulting).toBe(true)
  await clock.advance(50)
  expect(await oracleOf()).toMatchObject({ text: 'The test you keep running is not the test that is failing.', isConsulting: false })
  expect(asked.length).toBe(1)
})

test('/oracle answers the question asked, and her answer decodes under her name', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: 0 })
  const asked: { system: string; prompt: string }[] = []
  on('model.complete', ($, e) => {
    asked.push({ system: e.system as string, prompt: e.prompt as string })
    return { value: { isAnswered: true, text: '"You already know the answer. You have not *run* the tests yet."', usage: {} } } as never
  })
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', ($, e) => e as never)
  await $.session.start({ source: 'startup', cwd: '/tmp', surface: 'terminal', isInteractive: true } as never)
  await clock.advance(5000)
  const answer = 'You already know the answer. You have not run the tests yet.'
  expect((await $.command.run({ ...MATRIX, command: 'oracle', args: 'will my refactor work?' })).text).toBe(answer)
  expect(asked[0]?.prompt).toMatch(/^The question: will my refactor work\?/)
  expect(asked[0]?.system).toMatch(/comes to your kitchen with a question/)
  const ui = await $.ui.mount({
    plugin: 'matrix-skin', surface: 'terminal', requestId: 'o1', component: 'CommandOutput',
    // The engine puts the plugin's name before its output; her own name replaces it.
    props: { command: 'oracle', args: 'will my refactor work?', text: `matrix-skin: ${answer}`, isErrored: false },
  } as never)
  expect(await ui.find({ type: 'Text', text: /THE ORACLE/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: new RegExp(`^${answer}$`) })).toBeUndefined()
  await clock.advance(3000)
  expect(await ui.find({ type: 'Text', text: new RegExp(`^${answer}$`) })).toBeDefined()
  await ui.unmount()
  // Asked nothing, she reads the session instead.
  expect((await $.command.run({ ...MATRIX, command: 'oracle', args: '' })).text).toBe(answer)
  expect(asked[1]?.system).toMatch(/one short prophecy/)
})

test('life in the Matrix: calls and turns add up, are stored, and a reload is not a new session', async ($, on) => {
  const saved = new Map<string, unknown>()
  on('store.get', ($, e) => ({ value: saved.get(e.key) }) as never)
  on('store.set', ($, e) => {
    saved.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined } as never
  })
  const clock = mock.clock(on, { now: 1_000 })
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('session.start', ($, e) => e as never)
  on('session.id', () => ({ value: 'session-a' }) as never)
  on('process.run', () => ({ value: { exitCode: 128, stdout: '', stderr: 'not a git repository' } }) as never)
  on('tool.call', () => ({ result: {}, text: 'ok', isError: false }) as never)
  on('turn.complete', ($, e) => ({ text: e.answer }) as never)
  on('model.complete', () => ({ value: { isAnswered: true, text: 'Neo listed the files.', usage: {} } }) as never)
  const start = () => $.session.start({ source: 'startup', cwd: '/tmp', surface: 'desktop', isInteractive: true } as never)
  await start()
  await $.tool.call({ tool: 'Bash', command: 'ls', tool_use_id: 'l1' } as never)
  await $.turn.complete({ answer: 'done', durationMs: 90_000, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await clock.advance(16_000)
  expect(saved.get('lifetime')).toMatchObject({ calls: 1, ms: 90_000, sessions: 1 })
  await start() // a reload: the same session
  await clock.advance(16_000)
  expect(saved.get('lifetime')).toMatchObject({ calls: 1, sessions: 1 })
})

test('the Construct sizes itself to the pane, not the whole window', async ($, on) => {
  mock.clock(on)
  const ui = await $.ui.mount({
    plugin: 'matrix-skin', surface: 'desktop', component: 'Pane', requestId: 'matrix-construct',
    viewport: { columns: 200, rows: 70 },
    props: { title: 'The Construct', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 26 }, view: {} },
  } as never)
  const client = (await ui.find({ type: 'Client', key: 'construct-rain' })) as { props?: { height?: number; props?: { rows?: number } } }
  await ui.unmount()
  expect(client?.props?.height).toBe(26)
  expect(client?.props?.props?.rows).toBe(26)
})

test('a long prophecy wraps onto as many rows as a narrow pane needs, and is cut only past six', () => {
  const text = 'You keep knocking on the same door, that access request fails, yet you circle back to docs and memory files instead of waiting for the key.'
  const rows = (oracleText: string) =>
    layoutConstruct(48, 60, { ...DATA, oracle: { text: oracleText, at: DATA.now, isConsulting: false } } as never, DATA.now)
      .filter(l => l.key.startsWith('oracle:')).map(l => l.text)
  const shown = rows(text)
  expect(shown.length).toBeGreaterThan(3)
  expect(shown.join(' ')).toBe(text) // every word, none cut
  const long = rows(`${text} ${text} ${text}`)
  expect(long.length).toBe(6)
  expect(long.at(-1)!.endsWith('…')).toBe(true)
})
