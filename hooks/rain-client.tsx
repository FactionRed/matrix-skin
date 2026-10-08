// The desktop's code rain: a Client region the engine keeps alive across the
// plugin's redraws, so the rain never blinks out when the hooks module draws
// again. It animates on the surface's own frame clock, and the pointer parts
// the code around it; a click sends a ring of light through the rain, and each
// failed call a Sentinel. Given a Construct readout, it decodes the readout's
// lines into the rain; a click on a trace line opens it, and a click on a
// control posts the control's action to the hooks module.
import type { ClientModule } from 'claude-code'

import { actionAt, layoutConstruct, paintConstruct } from './construct-core'
import type { ConstructData, ConstructLine, DecodeMemory } from './construct-core'
import { RAIN_MS, crawlOf, nextSentinels, rainGrid, rowParts, thinRain } from './rain-core'
import type { Overlay, Point, Region, Ripple, Sentinel } from './rain-core'

type RainProps = { rows: number; isWorking: boolean; overlay: Overlay; construct?: ConstructData }

type RainState = {
  /**
   * Mutated in place, never redrawn for: the newest props for the frame
   * clock's tick, the readout's decode memory, the lines last drawn (to know
   * what a click hit), the frame the readout's data arrived on, and the failed
   * calls the rain has sent Sentinels for.
   */
  live: { props: RainProps; memory: DecodeMemory; lines: ConstructLine[]; dataNow: number; dataF: number; failures?: number }
  t: number
  f: number
  pointer: Point | null
  ripples: Ripple[]
  sentinels: Sentinel[]
  /** The trace line opened by a click, by its call's id. */
  expanded?: string
  /** The frame the boot sequence began on; absent while it is not running. */
  bootF?: number
}

const RIPPLE_FRAMES = 18
const MAX_ROWS = 80
// Glyphs of rain drawn at most: each is a node serialized every frame, and the
// surface draws nothing of a tree past 100,000 characters.
const GLYPH_BUDGET = 700

const Rain: ClientModule<RainProps, RainState> = (props, surface) => {
  const { Box, Text } = surface.elements
  if (surface.state === undefined) {
    surface.every(RAIN_MS, () => {
      const s = surface.state
      if (!s) return
      const f = s.f + 1
      const failures = s.live.props.overlay.sentinels ?? 0
      const sentinels = nextSentinels(s.sentinels, s.live.failures, failures)
      s.live.failures = failures
      surface.setState({
        ...s,
        f,
        sentinels,
        bootF: s.live.props.overlay.isBooting ? (s.bootF ?? f) : undefined,
        t: f % crawlOf(s.live.props.isWorking, s.live.props.overlay) === 0 ? s.t + 1 : s.t,
        ripples: s.ripples.map(r => ({ ...r, age: r.age + 1 })).filter(r => r.age < RIPPLE_FRAMES),
      })
    })
    surface.onPointer(event => {
      const s = surface.state
      if (!s) return
      const at = { x: event.x, y: event.y }
      if (event.type === 'leave') surface.setState({ ...s, pointer: null })
      else if (event.type === 'down') {
        const action = actionAt(s.live.lines, at)
        const ripples = [...s.ripples, { ...at, age: 0 }].slice(-6)
        if (action && 'expand' in action) {
          surface.setState({ ...s, pointer: at, ripples, expanded: s.expanded === action.expand ? undefined : action.expand })
          return
        }
        if (action) surface.post({ action })
        surface.setState({ ...s, pointer: at, ripples })
      } else if (event.type === 'move' || event.type === 'enter') surface.setState({ ...s, pointer: at })
    })
    surface.setState({ live: { props, memory: new Map(), lines: [], dataNow: 0, dataF: 0 }, t: 0, f: 0, pointer: null, ripples: [], sentinels: [] })
  }

  const state = surface.state
  if (state) state.live.props = props
  // The hooks module sizes the region and says how tall: the surface reports
  // its laid-out rows as 1 before the region grows into the height it was given.
  const rows = Math.max(1, Math.min(MAX_ROWS, props.rows))
  const columns = Math.min(240, surface.columns)
  if (columns <= 0) return <Box height={rows} />

  const f = state?.f ?? 0
  const bootFrames = state?.bootF === undefined ? 0 : f - state.bootF
  const grid = rainGrid(columns, rows, state?.t ?? 0, f, props.isWorking, props.overlay, { ...state, bootFrames })

  // The Construct's readout, decoding into the rain; elapsed times run on from
  // when the data arrived, counted in frames.
  let regions = new Map<number, Region[]>()
  if (props.construct && state && !props.overlay.isBooting) {
    const live = state.live
    if (live.dataNow !== props.construct.now) Object.assign(live, { dataNow: props.construct.now, dataF: f })
    live.lines = layoutConstruct(columns, rows, props.construct, live.dataNow + (f - live.dataF) * RAIN_MS, state.expanded)
    regions = paintConstruct(grid, live.lines, f, live.memory, state.pointer)
  }
  thinRain(grid, GLYPH_BUDGET, regions)

  return (
    <Box flexDirection="column" backgroundColor="#000000" width={columns} height={rows}>
      {Array.from({ length: rows }, (_, y) => (
        <Box flexDirection="row" width={columns} height={1}>
          {rowParts(grid, y, regions.get(y)).map(part =>
            part.kind === 'gap' ? (
              <Box width={part.span} />
            ) : part.kind === 'cell' ? (
              <Box width={1}>
                <Text color={part.color}>{part.ch}</Text>
              </Box>
            ) : (
              <Box width={part.width}>
                <Text wrap="truncate">
                  {part.runs.map(run => (
                    <Text color={run.color} backgroundColor={run.bg}>{run.text}</Text>
                  ))}
                </Text>
              </Box>
            ),
          )}
        </Box>
      ))}
    </Box>
  )
}

export default Rain
