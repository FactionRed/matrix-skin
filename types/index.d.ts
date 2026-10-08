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

/** One tool call in the Construct's trace log. */
export type MatrixTraceEntry = {
  /** The call's tool_use_id. */
  id: string
  /** When it started, in epoch ms. */
  at: number
  tool: string
  /** Its command, path, pattern or task, on one line. */
  summary: string
  /** `SMITH › ` for a subagent's call, else empty. */
  who: string
  /** How long it ran; absent while it runs. */
  ms?: number
  /** Whether it succeeded; absent while it runs. */
  ok?: boolean
  /** Its full command and the tail of its output, a few lines, shown when the line is opened; absent while it runs. */
  detail?: string[]
  /** How many times in a row this same call has failed, this one counted: a déjà vu loop. Absent below 2. */
  repeat?: number
}

/** The git state of the session's working copy: Zion. */
export type MatrixZion = {
  /** False outside a git repository, or where git could not be run. */
  isRepo: boolean
  branch: string
  ahead: number
  behind: number
  /** Files changed, staged or untracked. */
  changed: number
}

/** A file the session opened: one of the Keymaker's doors. */
export type MatrixDoor = { path: string; reads: number; edits: number }

/** The Oracle's last word on the session. */
export type MatrixOracle = {
  text: string
  /** When the Oracle was consulted, in epoch ms. */
  at: number
  /** True while she is still thinking it over. */
  isConsulting: boolean
}

/** Totals across every session, kept in the plugin's store: life in the Matrix. */
export type MatrixLifetime = {
  /** Time Claude spent working on main turns, in ms. */
  ms: number
  calls: number
  failures: number
  smiths: number
  bulletTimes: number
  sessions: number
}

/** One subagent in the Construct's Agent Smith roster. */
export type MatrixSmith = {
  /** The subagent's agentId. */
  id: string
  /** The task he was given. */
  task: string
  /** When he deployed, in epoch ms. */
  since: number
  /** His tool calls so far. */
  calls: number
  /** When he finished; absent while he runs. */
  doneAt?: number
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
      /** The latest tool calls, oldest first, for the Construct's trace log. */
      traceLog: MatrixTraceEntry[]
      /** The subagents deployed lately, running or just finished: the Agent Smiths. */
      smithRoster: MatrixSmith[]
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
      /** Failed calls this session: each one sends a Sentinel through the rain. */
      sentinels: number
      /** The working copy's git state; null until first read. */
      zion: MatrixZion | null
      /** The files opened this session, most touched first. */
      doors: MatrixDoor[]
      /** The Oracle's last word; null until she is consulted. */
      oracle: MatrixOracle | null
      /** Totals across every session, as last stored plus this session's since. */
      lifetime: MatrixLifetime
    }
  }
}
