import type { RenderElement } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { decode, phraseAt, rain, rainSvg } from '../hooks/register'

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
    const joined = (f: number) => decode(text, f).segments.map(s => s.text).join('')
    const clearLetters = (f: number) =>
      decode(text, f).segments.filter(s => s.kind === 'clear').map(s => s.text.replace(/\s/g, '')).join('').length
    // Noise keeps the message's shape: same length, spaces where its spaces are.
    expect(Array.from(joined(0)).length).toBe(Array.from(text).length)
    expect(joined(0).split(' ').length).toBe(text.split(' ').length)
    expect(clearLetters(0)).toBe(0)
    expect(decode(text, 0).isDone).toBe(false)
    // The sweep runs left to right: early on, the start has locked more than the end.
    const mid = decode(text, 22).segments
    expect(mid.some(s => s.kind === 'clear') && mid.some(s => s.kind !== 'clear')).toBe(true)
    expect(clearLetters(22)).toBeLessThan(clearLetters(35))
    const end = decode(text, 45)
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

test("Claude's reply decodes in green, then hands back to the normal formatted reply", async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: 0 })
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', ($, e) => e as never)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, 'formatted reply') as RenderElement
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
  expect(await ui.find({ type: 'Text', text: /formatted reply/ })).toBeUndefined()
  await clock.advance(3000)
  expect(await ui.find({ type: 'Text', text: /formatted reply/ })).toBeDefined()
  await ui.unmount()
})

const BAND = (isWorking: boolean) => ({
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking, maxRows: 20, bodyColumns: 200, scroll: { offset: 0, bodyRows: 19 }, view: {} },
}) as never

test('the desktop band draws an animated SVG rain, idle and working', async ($, on) => {
  mock.clock(on)
  for (const isWorking of [false, true]) {
    const ui = await $.ui.mount({ plugin: 'matrix-skin', surface: 'desktop', ...(BAND(isWorking) as object) } as never)
    expect(await ui.find({ type: 'Svg' })).toBeDefined()
    await ui.unmount()
  }
})

test('the SVG rain stays under the engine limit at the widest band', () => {
  for (const isWorking of [false, true]) {
    const svg = rainSvg(1600, 110, isWorking)
    expect(svg.length).toBeLessThan(131072)
    expect(svg.includes('<animateTransform')).toBe(true)
  }
  expect(rainSvg(1600, 110, false).includes('visibility')).toBe(true)
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

test('the SVG band glitches red, and traces the running tool', () => {
  const glitch = rainSvg(1600, 44, true, { isGlitching: true })
  expect(glitch.includes('Déjà vu.')).toBe(true)
  expect(glitch.includes('#00ff41')).toBe(false)
  expect(rainSvg(1600, 44, true, { trace: 'Read' }).includes('TRACE  Read')).toBe(true)
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

test('bullet time slows the trace and ripples the SVG band', () => {
  const svg = rainSvg(1600, 44, true, { trace: 'Bash', isBulletTime: true })
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
    expect(await ui.find({ type: surface === 'terminal' ? 'Raster' : 'Svg' })).toBeDefined()
    await ui.unmount()
  }
})
