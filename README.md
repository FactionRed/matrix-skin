# matrix-skin

A Matrix look for Claude Code.

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
  turns red and "Déjà vu." shudders in the band.
- Tool rows read as green trace lines: `◢ Bash › npm test`, red when a call
  failed. Rows whose body matters (edits, checklists, questions) keep their
  normal look.
- Subagents are Agent Smiths: announced when deployed, named on their
  spinners, and traced as `SMITH › Bash`.
- After each turn the status line says how it went ("◢ Jacked out after
  12s"). Then the Operator radios in a one-line report that a small model writes.
- `/construct` opens the Construct: a pane with a tall wall of rain over an
  operator console (calls traced, glitches, bullet times, Agent Smiths,
  most-traced tools).
- The footer's mode labels gain "◢ matrix" while the look is on.

## Commands

| Command | What it does |
| --- | --- |
| `/matrix` | Offers the red pill (on) and the blue pill (off) in the band above the prompt: click, or press 1 or 2 |
| `/matrix red`, `/matrix blue` | Choose at once |
| `/matrix morpheus [on\|off]` | Claude answers in the voice of Morpheus (off by default) |
| `/matrix operator [on\|off]` | The Operator's one-line report after each turn (on by default; one small model call per turn) |
| `/matrix rows [on\|off]` | Tool rows as green trace lines (on by default) |
| `/matrix help` | Lists these |
| `/construct` | Opens the operator console |

The plugin remembers every choice across sessions.

## Install

In Claude Code (terminal or the desktop app's Code tab):

```
/plugin marketplace add FactionRed/matrix-skin
/plugin install matrix-skin@matrix-skin
```

Then start a new session, or reload plugins. Type `/matrix` to choose your pill.

It needs a recent Claude Code with plugin hook modules (built and tested on
2.1.286). To try it from a clone without installing:
`claude --plugin-dir /path/to/matrix-skin`

The code rain is drawn in the terminal and in the desktop app; the editor
extensions and mobile get the decoding messages and the rest.

Tune it: colors, speeds and glyphs are constants at the top of
`hooks/register.tsx` and `hooks/rain-core.ts`. DECODE_FRAMES sets how long a
message takes to decode. BULLET_FRAMES sets how long a tool runs before bullet
time. PHRASES sets what types into the rain, and TRAIL sets the trail's colors.

## License

Copyright (c) 2026 DoomLord. All rights reserved. You may install and use the
plugin; no license is granted to copy, modify or redistribute its source.
