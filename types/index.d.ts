export type MatrixFrame = number

/** What the Construct's operator console counts over a session. */
export type MatrixStats = {
  calls: number
  failures: number
  bulletTimes: number
  /** Subagents deployed this session: Agent Smiths. Absent in a session older than the count. */
  smiths?: number
  /** Calls per tool name. */
  tools: Record<string, number>
}

declare module 'claude-code' {
  interface PluginState {
    'matrix-skin': {
      isOn: boolean
      frame: StateFamily<number>
      /** True for a moment after a tool fails: the band glitches red. */
      isGlitching: boolean
      /** The tool running now, shown in the band; empty when none. */
      trace: string
      /** True while a tool has run long enough to slow the world down. */
      isBulletTime: boolean
      /** True while the band offers the red and blue pills. */
      isChoosing: boolean
      stats: MatrixStats
      /** The subagents running now, by agentId: the Agent Smiths. */
      smithIds: string[]
      /** True while the jack-in boot sequence plays at session start. */
      isBooting: boolean
      /** The task of an Agent Smith just deployed, while the band announces him; empty otherwise. */
      smithAnnounce: string
      /** Claude answers in the voice of Morpheus. */
      isMorpheus: boolean
      /** A one-line operator report after each turn. */
      isOperator: boolean
      /** Tool rows drawn as green trace lines. */
      isThemedRows: boolean
      /** Sound for the jack-in and Agent Smith. */
      isSound: boolean
      /** "Mister Anderson." spoken when an Agent Smith deploys. */
      isVoice: boolean
    }
  }
}
