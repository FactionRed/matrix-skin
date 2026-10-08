# matrix-skin

A Matrix look for Claude Code. An unofficial, free fan project, not affiliated
with or endorsed by Warner Bros. (see [License](#license)).

![The rain band, a tool trace, bullet time and a déjà vu glitch in the Claude Code desktop app](https://github.com/FactionRed/matrix-skin/releases/download/v1.3.1/demo.gif)

- Each session opens with a jack-in sequence in the band: the film's opening
  lines type out ("Call trans opt: received."), a bar fills, then the rain
  starts. A phone line dials and a modem screeches while it runs.
- Every message you send arrives as glyph noise in its own shape. Then each
  letter burns white and locks in, in a sweep from left to right (about two
  seconds). Claude's replies decode the same way inside their normal
  formatting, so nothing jumps when they finish.
- Green code rain falls in a band above the prompt. While Claude works it
  pours, with white-hot heads, fading trails and flickering glyphs. While idle
  it drizzles, and "Wake up, Neo...", "The Matrix has you..." and friends type
  themselves into it. In the desktop app, move the pointer through the rain to
  part it, and click to send a ring of light through it.
- While a tool runs, the status line reads "◢ tracing Bash ｱﾂ" and the band
  shows "◢ TRACE  Bash". A tool that runs past four seconds drops the band
  into bullet time: the rain crawls and the spinner says "Dodging bullets".
- When a tool fails, the Matrix glitches: for a couple of seconds the rain
  turns red and "Déjà vu." shudders in the band, and a Sentinel (a head of red
  eyes trailing tentacles) swims across the rain.
- When the same call fails again and again, that is a real déjà vu. Its trace
  line glitches, the Construct's status reads `DÉJÀ VU  Bash npm test ×3`, and
  on the third failure a toast says Claude is going in circles.
- Tool rows read as green trace lines: `◢ Bash › npm test`, red when a call
  failed. Rows whose body matters (edits, checklists, questions) keep their
  normal look.
- Subagents are Agent Smiths. When one deploys, the band announces him and
  the rain replicates him for a few seconds, over a low stab of sound. Switch
  on his voice for a "Mister Anderson." now and then. His spinner shows his name, and his
  tool calls show as `SMITH › Bash`.
- After each turn the status line says how it went ("◢ Jacked out after
  12s"). Then the Operator radios in a one-line report that a small model writes.
- `/construct` opens the Construct: a pane that is all rain, with the
  operator's readout decoding inside it. When a line changes, only the changed
  characters decode again. The readout fits the pane's height; when the pane
  is short, the least important blocks give way first. It shows:
  - **Status and counters**: what the operator sees now, and the session's
    calls, glitches, bullet times and Smiths.
  - **Zion**: the git state of the working folder, such as
    `ZION  main ↑2 · 3 changed`, read again after each call that can change it.
  - **Life in the Matrix**: totals across every session: time Claude spent
    working, calls, sessions and Smiths.
  - **The Oracle**: click `[ORACLE]` and a small model reads the trace log and
    gives a one-line prophecy about how the work is going.
  - **Trace log**: one line per tool call (time, ✓ or ✖, duration, what ran).
    In the desktop app, click a line to open it: the full command and the last
    lines of its output. Click it again to close it.
  - **The Keymaker**: the files Claude opened most, with read and edit counts
    (`R3  E4   src/auth.ts`).
  - **Agent Smiths**: each running subagent's task, time in the Matrix and calls.
  - **Controls**: click `[SOUND ●]`, `[ORACLE]`, `[BLUE PILL]` and the rest. In
    the terminal, press its number.
- The footer's mode labels gain "◢ matrix" while the look is on.

## Commands

| Command | What it does |
| --- | --- |
| `/matrix` | Offers the red pill (on) and the blue pill (off) in the band above the prompt: click, or press 1 or 2 |
| `/matrix red`, `/matrix blue` | Choose at once |
| `/matrix morpheus [on\|off]` | Claude answers in the voice of Morpheus (off by default) |
| `/matrix operator [on\|off]` | The Operator's one-line report after each turn (on by default; one small model call per turn) |
| `/matrix rows [on\|off]` | Tool rows as green trace lines (on by default) |
| `/matrix sound [on\|off]` | Sound for the jack-in and Agent Smith (on by default) |
| `/matrix voice [on\|off]` | "Mister Anderson." when an Agent Smith deploys (off by default; needs sound on) |
| `/matrix help` | Lists these |
| `/construct` | Opens the operator console (each `[ORACLE]` click is one small model call) |

The plugin remembers every choice, and the lifetime totals, across sessions.
Zion runs `git status` in the session's folder; outside a repository it reads
"offline".

## Install

In Claude Code (terminal or the desktop app's Code tab):

```
/plugin marketplace add FactionRed/matrix-skin
/plugin install matrix-skin@matrix-skin
```

Then start a new session, or reload plugins. Type `/matrix` to choose your pill.

It needs Claude Code 2.1.287 or later in the terminal, or the Desktop app's
Code tab from 2.1.286, where mods are on by default; no setting is needed. It
was built and tested on 2.1.289. To try it from a clone without installing:
`claude --plugin-dir /path/to/matrix-skin`

macOS plays the sounds and the voice through Claude Code's own player. On
Windows, which Claude Code has no player for, the plugin plays them with
Windows' built-in SoundPlayer and voice, through PowerShell. A Linux terminal
stays silent. Every sound is
synthesized by `tools/make_sounds.py`, so the plugin ships no recorded audio.

The code rain is drawn in the terminal and in the desktop app; the editor
extensions and mobile get the decoding messages and the rest.

Tune it: colors, speeds and glyphs are constants at the top of
`hooks/register.tsx` and `hooks/rain-core.ts`. DECODE_FRAMES sets how long a
message takes to decode. BULLET_FRAMES sets how long a tool runs before bullet
time. PHRASES sets what types into the rain, and TRAIL sets the trail's colors.

## What it runs and sends

matrix-skin makes no network requests of its own and sends no telemetry.
Everything it does outside its own code goes through Claude Code:

- **Model calls, on your Claude plan or API key.** The Operator's report is one
  small model call (Haiku) after each turn. It sends the first 4,000
  characters of Claude's final answer. Turn it off with `/matrix operator off`.
  Each `[ORACLE]` click in the Construct is one more Haiku call. It sends the
  last 20 tool calls (tool, command or path, and whether each failed), the
  running subagents' tasks and the most-opened files (last two path parts).
- **Processes.** `git status --porcelain=v1 --branch` runs in the session's
  folder after Bash and edit calls, and when `/construct` opens, for Zion. On
  Windows, which Claude Code has no audio player for, two fixed `powershell`
  commands run: one plays the plugin's own WAV file through
  `Media.SoundPlayer` (the file's path goes in through the `MATRIX_SKIN_CLIP`
  environment variable), and one speaks "Mister Anderson." through
  `System.Speech` when the voice is on. Nothing else is started, and no
  command ever takes text from the conversation.
- **Environment.** It reads the `OS` variable, to know whether it runs on
  Windows.
- **System prompt.** Morpheus mode, off by default, adds one section that sets
  Claude's voice. Nothing else changes the prompt.
- **Storage.** The plugin's own store keeps your switches, the lifetime totals
  and the ids of the last 20 sessions (so a reload isn't counted as a new
  session). The trace log, the Keymaker's files and the Oracle's answer are
  kept for the session only.

### What each hook does

The plugin never approves, denies or rewrites a tool call, a subagent or a
setting, and it starts no agents or tools of its own.

- `tool.call`: watches each call to draw the trace log, the band's trace and
  the status line. It passes the call on unchanged and reads only the result's
  text, for the trace line's detail.
- `agent.spawn`: passes the spawn on unchanged, then records the subagent as
  an Agent Smith (his task and call count) for the band and the roster.
- `turn.complete`: notes how long the turn took, and hands the final answer to
  the Operator's report (above).
- `prompt.compose`: adds the Morpheus voice section while Morpheus mode is on,
  and changes nothing else.
- `command.run`: answers its own `/matrix` and `/construct` commands only.
- `ui.render`, `ui.message`, `session.start`: draw the look, take clicks on
  the Construct's controls, and start the rain and the boot sequence.

The files in `tests/` run only under `claude plugin test`, against the test
kit's stand-ins. They call `$.command.run`, `$.agent.spawn` and `$.tool.call`
and hook `process.run` there to check the plugin; Claude Code never loads them
in a session.

## License

Copyright (c) 2026 DoomLord. All rights reserved. You may install and use the
plugin; no license is granted to copy, modify or redistribute its source. See
[LICENSE](LICENSE).

matrix-skin is an unofficial, free fan project. It is not affiliated with,
sponsored by or endorsed by Warner Bros. Entertainment Inc. or any other owner
of The Matrix. "The Matrix" and its related names, characters and quotations
are the property of their respective owners. The plugin ships no footage,
images or audio from the films: its sounds are synthesized by
`tools/make_sounds.py`.
