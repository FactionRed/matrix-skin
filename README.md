# matrix-skin

A Matrix look for Claude Code.

- Every message you send and every reply from Claude arrives as green glyph
  noise in the message's own shape, then decodes: each character burns white
  and locks in, in a rippling left-to-right sweep (about two seconds). Replies
  then settle into the normal formatted text.
- Green code rain falls in a band above the prompt. While Claude works it
  pours, with white-hot heads, fading trails and flickering glyphs; while idle
  it drizzles and "Wake up, Neo...", "The Matrix has you..." and friends type
  themselves into it. In the desktop app the band is an animated SVG monitor
  with glow, scanlines and a vignette.
- While a tool runs, the status line reads "◢ tracing Bash ｱﾂ" and the band
  shows "◢ TRACE  Bash". A tool that runs past four seconds drops the band
  into bullet time: the rain crawls, ripples spread from the readout, and the
  spinner says "Dodging bullets".
- When a tool fails, the Matrix glitches: for a couple of seconds the rain
  turns red and "Déjà vu." shudders in the band.
- `/construct` opens the Construct: a pane with a tall wall of rain over an
  operator console (calls traced, glitches, bullet times, most-traced tools).
- The footer's mode labels gain "◢ matrix" while the look is on.

`/matrix` offers the red pill and the blue pill in the band above the prompt
(click, or press 1 or 2); `/matrix red` and `/matrix blue` choose at once. The
choice is remembered.

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
`hooks/register.tsx`. DECODE_FRAMES sets how long a message takes to decode,
BULLET_FRAMES how long a tool runs before bullet time, PHRASES what types into
the rain and TRAIL the trail's colors.

## License

Copyright (c) 2026 DoomLord. All rights reserved. You may install and use the
plugin; no license is granted to copy, modify or redistribute its source.
