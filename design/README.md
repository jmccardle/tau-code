# The tau mark

The FFwF logo is a skull over crossed wrenches on a flame, assembled from public
domain hazard symbols: the toxic skull, the flammable flame, a gear for the
cranium and wrenches for the crossbones. The tau mark keeps the flame and the
wrenches and puts a **τ** where the skull was.

The letter sits higher than the skull did, because a letter has no jaw. That is
what lets the mark square up: the flame fills the canvas, the wrenches cross its
foot, and the tau clears them by eight units with nothing overlapping.

## The pieces

`ELEMENT_FILES` at the top of `build-logo.py` says which file each element is
read from. What is in use:

| File | What it is |
|---|---|
| `elements/flame_hand-drawn.svg` | **in use.** Drawn in Inkscape: separate licks, with the daylight between them the skull used to fill |
| `elements/wrenches_hand-drawn.svg` | **in use.** One wrench, duplicated and mirrored |
| `elements/tau.svg` | **in use.** U+03C4, DejaVu Sans Mono Oblique |
| `elements/tau-bold.svg` | **in use** by the activity-bar candidate. Bold Oblique, because the text weight is a hairline at 24px |
| `elements/flame.svg` | the machine trace the hand-drawn flame replaced |
| `elements/wrenches.svg` | likewise |

Every element lives in the same 256-unit box, so a coordinate in one is
comparable with a coordinate in another, and an element can be swapped for
another drawing of itself without touching the layout.

The two machine traces are kept for comparison, not for use. The tracer could
only guess at the flame's interior and underside — the skull covers both in the
source, so every pixel there is invented — and what it invented was one solid
mass. The hand-drawn flame has the licks the original actually has.

The composer reads whatever is in these files, including transforms, so an
Inkscape file can be edited in place and does not need flattening first. Only
a path inside a `display:none` layer is skipped, which is where Inkscape keeps
a tracing reference.

## The variants

| File | Where it goes |
|---|---|
| `logo-colour.svg` | the mark in FFwF's three colours, transparent ground |
| `logo-mono.svg` | one ink. Gaps do what red was doing |
| `icon-dark.svg` | on a near-black plate. This is the extension icon |
| `icon-light.svg` | on a white plate |
| `sidebar-tau.svg` | a candidate activity-bar icon. Nothing points at it yet |
| `preview.png` | every variant at 16, 24, 32, 48, 64 and 128 |

`packages/vscode/media/icon.png` is rendered from `icon-dark.svg`. Nothing else
in the repository is generated here.

## Changing it

```bash
python3 design/trace-elements.py    # needs the FFwF PNG and the DejaVu fonts
python3 design/build-logo.py        # needs neither: it reads paths.json
```

Tracing is the slow, one-time half and its output is committed. Composing is the
half you iterate on: every position is a constant in the `LAYOUT` block at the
top of `build-logo.py`, in those same 256 units. Move a number, re-run, look at
`preview.png`.

Two things are checked rather than eyeballed, because both failed silently while
this was being built:

- **Clearance.** The tau must stop before the wrenches start.
- **The gaps do not crumble the flame.** A hole wide enough to read is wide
  enough to cut a lick. Cutting one is fine — two licks read as two licks. A
  sliver is not: at small sizes it is a speck of dirt beside the mark. The
  build rasterises the flame with its holes and fails on any piece under
  `CRUMB` of the total.

A layout that breaks either one stops the build and says which number to move.

## How the one-ink version is built

Five layers, in this order:

1. the flame, positive;
2. the letter's negative — its own outline stroked `GAP` wide;
3. the wrenches' negative, the same way;
4. the letter, positive;
5. the wrenches, positive.

`logo-mono.svg` builds those as a mask, so the file is three objects and the
gaps are real transparency. **`logo-layers.svg` paints the same five as separate
objects**, black for ink and white for what comes out, and nothing else is in
the file — so it is the one to open when you want to select a piece and nudge
it, and keying white to transparent after rasterising cannot catch anything it
should not. The two are built from the same numbers and render identically.

The join is `miter`, and that is the whole trick: it carries each corner of the
letter out to its point, so the cutaway has the glyph's own corners rather than
a router-bit radius. `MITRE` is where a spike gets cut off square instead,
which only comes up at the sharpest points of the wrenches.

Scaling a copy of the path up keeps the corners too, and was tried. It leaves a
gap proportional to distance from whatever centre it grew about — thin at the
middle of the letter, thick at the ends of the bar — and no choice of centre
fixes both, including the centre of mass. That is what reads as the positive
sitting off-centre in its own hole. A stroke is the same width everywhere.

`MONO_TAU` picks what the letter does. `gapped` keeps it solid and rings it with
daylight; `knockout` cuts it out of the flame so the letter is the ground
showing through. Knockout is the better-looking of the two, but it wants a flame
that is one solid mass behind the whole letter — against the hand-drawn flame
the stem falls down a gap between licks and the letter stops being a letter.
