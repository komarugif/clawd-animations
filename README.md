# clawd-animations

Animations of Claude's mascot as scenes of rectangles, for KomaruGram's
About section, which downloads them from this repository: removing the
repository removes the mascot from every build of KomaruGram.

## Whose they are

- **The character** and the Claude brand belong to
  [Anthropic](https://www.anthropic.com). This repository is not
  affiliated with Anthropic, and KomaruGram does not use Claude's name or
  brand in its own name.
- **The reconstruction and the animation** are the work of
  Wale-Durojaye Ayotomiwa, who rebuilt the mascot's animations from its
  public posts on X: [ayotomcs.me/claude-mascot](https://ayotomcs.me/claude-mascot),
  described in
  [Reverse-engineering Claude AI's mascot animations with SVG and GSAP](https://tympanus.net/codrops/2026/05/05/reverse-engineering-claude-ais-mascot-animations-with-svg-and-gsap/)
  on Codrops. The scenes here are extracted from that page.

Should Anthropic or the author ask, the repository goes.

## The scenes

`animations/index.json` lists them:

| Scene | What |
|---|---|
| `walk` | looks around, walks across its stage, four times as wide as itself, and jumps back |
| `gym` | works out, frame by frame |
| `flag` | waves a flag, its intro once, then a loop |
| `juggle` | hops, throwing confetti |

A scene file holds:

- `viewBox`, the picture's box, and `stage`, how many times as wide as it
  the space it moves in is;
- `version`: 2, the format's;
- `nodes`: groups and filled rectangles, each with its `parent` (`-1` for
  the root), its `matrix`, the SVG transform `[a, b, c, d, e, f]`
  (x' = a x + c y + e, y' = b x + d y + f: the frames mirror and turn
  rectangles so), and a group's `clip`;
- `tracks`: timelines that run side by side, each with its `delay`,
  `duration`, whether it `repeat`s and from where (`loopFrom`), and its
  `events`. An event sets a node's property at `start`, or tweens it over
  `duration` with an `ease` (GSAP's names) from `from` to `to`. The
  properties are GSAP's `x`, `y`, `rotation`, `scaleX`, `scaleY`,
  `origin` (svgOrigin, in the node's coordinates), `display`, the
  `transform` attribute (as a matrix) and a rectangle's `attr.x`,
  `attr.y`, `attr.width`, `attr.height`.

Every tween's start value is resolved, so a player only interpolates: the
picture at any time is a function of that time. KomaruGram's player is
`pkg/rectanim`.

## Extracting them again

```sh
node extract/extract.mjs https://ayotomcs.me/claude-mascot animations
```

The extractor downloads the page's scripts into `extract/cache` (kept out
of the repository), runs the mascot's modules with stand-ins for React and
GSAP, and writes what their timelines do. It needs Node 18 or later.
