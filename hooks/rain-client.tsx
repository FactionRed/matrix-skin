// The desktop's code rain: a Client region the engine keeps alive across the
// plugin's redraws, so the rain never blinks out when the hooks module draws
// again. It animates on the surface's own frame clock, and the pointer parts
// the code around it; a click sends a ring of light through the rain.
import type { ClientModule } from 'claude-code'

import { RAIN_MS, crawlOf, rainGrid, spansOf } from './rain-core'
import type { Overlay, Point, Ripple } from './rain-core'

type RainProps = { rows: number; isWorking: boolean; overlay: Overlay }

type RainState = {
  /** The newest props, for the frame clock's tick; mutated in place, never redrawn for. */
  live: { props: RainProps }
  t: number
  f: number
  pointer: Point | null
  ripples: Ripple[]
  /** The frame the boot sequence began on; absent while it is not running. */
  bootF?: number
}

const RIPPLE_FRAMES = 18

const Rain: ClientModule<RainProps, RainState> = (props, surface) => {
  const { Box, Text } = surface.elements
  if (surface.state === undefined) {
    surface.every(RAIN_MS, () => {
      const s = surface.state
      if (!s) return
      const f = s.f + 1
      surface.setState({
        ...s,
        f,
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
      else if (event.type === 'down') surface.setState({ ...s, pointer: at, ripples: [...s.ripples, { ...at, age: 0 }].slice(-6) })
      else if (event.type === 'move' || event.type === 'enter') surface.setState({ ...s, pointer: at })
    })
    surface.setState({ live: { props }, t: 0, f: 0, pointer: null, ripples: [] })
  }

  const state = surface.state
  if (state) state.live.props = props
  // The hooks module sizes the region and says how tall: the surface reports
  // its laid-out rows as 1 before the region grows into the height it was given.
  const rows = Math.max(1, Math.min(40, props.rows))
  const columns = Math.min(240, surface.columns)
  if (columns <= 0) return <Box height={rows} />

  const bootFrames = state?.bootF === undefined ? 0 : state.f - state.bootF
  const grid = rainGrid(columns, rows, state?.t ?? 0, state?.f ?? 0, props.isWorking, props.overlay, { ...state, bootFrames })

  return (
    <Box flexDirection="column" backgroundColor="#000000" width={columns} height={rows}>
      {Array.from({ length: rows }, (_, y) => (
        <Box flexDirection="row" width={columns} height={1}>
          {spansOf(grid, y).map(cell =>
            cell.ch === undefined ? (
              <Box width={cell.span} />
            ) : (
              <Box width={1}>
                <Text color={cell.color}>{cell.ch}</Text>
              </Box>
            ),
          )}
        </Box>
      ))}
    </Box>
  )
}

export default Rain
