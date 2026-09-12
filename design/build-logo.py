#!/usr/bin/env python3
"""Compose the tau mark from the FFwF elements, and render every size we ship.

The FFwF logo is a skull over crossed wrenches on a flame. The tau mark keeps
the flame and the wrenches and puts a tau where the skull was -- higher, because
a letter has no jaw, which is what lets the whole thing square up.

    python3 design/build-logo.py

Everything the composition depends on is a constant in the LAYOUT block below,
in the elements' shared 256-unit coordinate space. Move a number, re-run,
look at design/preview.png. Nothing else in the file needs touching to
re-position a piece.

Outputs, each as an SVG and a PNG beside it:
    design/logo-colour.svg           red flame, black tau and wrenches
    design/logo-mono.svg             one colour, gaps instead of colour
    design/logo-layers.svg           the same, as five stacked black/white objects
    design/icon-dark.svg             the mark on a near-black plate
    design/icon-light.svg            the mark on a white plate
    packages/vscode/media/icon.svg   the activity bar icon, the letter alone
    design/preview.png               every variant at every size, to look at
    packages/vscode/media/icon.png   the marketplace icon, from icon-dark

Each element is read from its own SVG in design/elements/, whatever drew it --
the machine trace, Inkscape, or a font. Every visible path in the file is part
of the element and its transforms are carried through, so an Inkscape file can
be dropped in and edited in place without flattening anything first.
"""

import pathlib
import re
import subprocess
import xml.etree.ElementTree as ET

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
ELEMENTS = HERE / "elements"
MEDIA = ROOT / "packages" / "vscode" / "media"

# Which file each element comes from. The two hand-drawn ones are Inkscape
# masters: the flame in particular is drawn as separate tongues with the gap
# the skull used to fill, which the machine trace could only guess at, and the
# wrenches are one wrench mirrored rather than two traced blobs. flame.svg and
# wrenches.svg are still written by trace-elements.py and are what these
# replaced; point a line back at them to compare.
ELEMENT_FILES = {
    "flame": "flame_hand-drawn.svg",
    "wrenches": "wrenches_hand-drawn.svg",
    "tau": "tau.svg",
    "sidebar": "tau-bold.svg",
}

# ------------------------------------------------------------------- LAYOUT
CANVAS = 256

RED = "#ff0000"
BLACK = "#000000"
WHITE = "#ffffff"

# Each element is placed as `translate(tx ty) scale(s)` over the traced
# coordinates. The comment on each line says where that lands it.
FLAME = dict(scale=1.34, cx=128, top=2)        # y 2..245, wide enough to hold the bar
WRENCH = dict(scale=1.24, cx=128, bottom=254)  # y 188..252, across the flame's foot

# The letter is U+03C4 from DejaVu Sans Mono Oblique, extracted by
# trace-elements.py, and is placed exactly like the other two elements.
TAU = dict(scale=0.66, cx=131, top=90)         # y 90..180, below the fork.
# cx is 131, not 128: the oblique bar overhangs to the left and the foot kicks
# right, so a box centred on the canvas reads as sitting left of centre.

# How much daylight each element gets when there is no colour to separate it
# from the flame. The negative is the element's own outline stroked this wide,
# with a MITRED join: the join is what decides whether the tau's corners
# survive the cutaway, and a mitre carries each corner out to its point.
#
# Scaling a copy of the path up would also keep the corners, but the gap it
# leaves is proportional to distance from whatever centre it grew about --
# thin at the middle of the letter, thick at the ends of the bar, and no
# choice of centre fixes both. A stroke is the same width everywhere, which
# is what makes the positive sit centred in its own hole.
GAP = 7.0

# Beyond this ratio a mitre is cut off square rather than run to a spike. It
# only comes up at the sharpest points of the wrenches.
MITRE = 6.0

# How much of the activity bar's 24-unit box the letter fills. Higher reads
# better at 24px, which is the size that matters; what is left is the margin
# VS Code's own icons keep.
SIDEBAR_FILL = 20.0

# What the letter does in one ink. "gapped" keeps the tau solid and rings it
# with daylight; "knockout" cuts it clean out of the flame, so the letter is
# the ground showing through. Knockout wants a flame that is one solid mass
# behind the whole letter. This flame is drawn as separate licks with daylight
# between them, so a knocked-out letter loses its stem down the nearest gap and
# stops being a letter: gapped is what this artwork wants.
MONO_TAU = "gapped"

# A gap crossing a lick splits it, which is fine -- two licks read as two licks.
# What is not fine is a crumb: a sliver with no reason to be there. Anything
# under this share of the flame's area is one of those.
CRUMB = 0.02

# The letter must not touch the wrenches -- that is the whole reason it sits
# where the skull's cranium was and not where its jaw was.
CLEARANCE = 8.0

# ---------------------------------------------------------------------------


def _offsets(bbox, scale, cx=None, top=None, bottom=None):
    (x0, y0, x1, y1) = bbox
    tx = cx - scale * (x0 + x1) / 2 if cx is not None else 0.0
    if top is not None:
        ty = top - scale * y0
    elif bottom is not None:
        ty = bottom - scale * y1
    else:
        ty = 0.0
    return scale, tx, ty


def place(bbox, **layout):
    """A transform string putting an element where LAYOUT asks."""
    scale, tx, ty = _offsets(bbox, **layout)
    return f"translate({tx:.2f} {ty:.2f}) scale({scale})"



SVG_NS = "{http://www.w3.org/2000/svg}"


def load_element(path):
    """Every visible path in an SVG, each with the transform that applies to it.

    Returned as (d, transform) pairs rather than one flattened path string,
    because flattening would rewrite coordinates an author has to recognise
    when they open the file again. The transform travels with the path instead
    and is re-emitted verbatim.

    A path inside a hidden layer is skipped: Inkscape files carry their tracing
    reference under `display:none` and that is not part of the artwork.
    """
    out = []

    def walk(node, inherited, hidden):
        for child in node:
            if child.tag in (f"{SVG_NS}defs", f"{SVG_NS}image"):
                continue
            style = child.get("style") or ""
            invisible = hidden or "display:none" in style.replace(" ", "")
            chain = inherited + ([child.get("transform")] if child.get("transform") else [])
            if child.tag == f"{SVG_NS}path" and not invisible:
                out.append((child.get("d"), " ".join(chain)))
            walk(child, chain, invisible)

    walk(ET.parse(path).getroot(), [], False)
    if not out:
        raise SystemExit(f"{path} has no visible path in it")
    return out


def element_bbox(parts):
    """The tight box around every part of an element, curves evaluated."""
    boxes = [path_bbox(d, transform) for d, transform in parts]
    return (
        min(b[0] for b in boxes),
        min(b[1] for b in boxes),
        max(b[2] for b in boxes),
        max(b[3] for b in boxes),
    )


def path_bbox(d, transform=""):
    """The tight box of one path, curves evaluated rather than guessed.

    Reading the extremes off the control points is off by however far a curve
    falls short of its handles, which for the glyph's shoulders is several
    units. Layout constants are in the same space as the numbers this returns,
    so they had better be the real ones.
    """
    pts = [p for ring in path_rings(d, transform) for p in ring]
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return (min(xs), min(ys), max(xs), max(ys))


def path_rings(d, transform=""):
    """The path's subpaths, each as a list of points, under `transform`."""
    a, b, c, dd, e, f = parse_transform(transform)
    return [
        [(a * x + c * y + e, b * x + dd * y + f) for x, y in ring]
        for ring in _path_points(d)
    ]



def _path_points(d):
    """A path's subpaths, each a list of points: nodes, plus sampled curves.

    Kept as subpaths rather than one stream because an area calculation has to
    know where one ring ends and the next begins. Handles the subset SVG editors
    and font pens actually emit. An elliptical arc raises rather than being
    ignored, because a silently mis-measured element would move the whole
    composition and look like a layout mistake.
    """
    tokens = re.findall(r"[A-Za-z]|-?\d*\.?\d+(?:[eE][-+]?\d+)?", d)
    counts = {"M": 2, "L": 2, "H": 1, "V": 1, "C": 6, "S": 4, "Q": 4, "T": 2}
    rings, pts, cursor, start, ctrl, op, i = [], [], (0.0, 0.0), (0.0, 0.0), None, None, 0

    while i < len(tokens):
        if tokens[i].isalpha():
            op = tokens[i]
            i += 1
        elif op in ("M", "m"):
            op = "L" if op == "M" else "l"  # repeated moveto coordinates are lines
        if op is None:
            raise SystemExit(f"path data starts with a number: {d[:40]!r}")

        upper = op.upper()
        if upper == "Z":
            cursor, ctrl = start, None
            continue
        if upper == "A":
            raise SystemExit(
                "elliptical arcs are not measured here. In Inkscape, "
                "Path > Object to Path turns them into curves."
            )
        if upper not in counts:
            raise SystemExit(f"unknown path command {op!r}")

        n = counts[upper]
        nums = [float(v) for v in tokens[i : i + n]]
        i += n
        rel = op.islower()

        if upper == "H":
            nodes = [(nums[0] + (cursor[0] if rel else 0), cursor[1])]
        elif upper == "V":
            nodes = [(cursor[0], nums[0] + (cursor[1] if rel else 0))]
        else:
            nodes = [
                (
                    nums[k] + (cursor[0] if rel else 0),
                    nums[k + 1] + (cursor[1] if rel else 0),
                )
                for k in range(0, n, 2)
            ]

        if upper in ("S", "T"):
            # The reflected handle: the smooth commands' whole point.
            mirror = ctrl if ctrl else cursor
            reflected = (2 * cursor[0] - mirror[0], 2 * cursor[1] - mirror[1])
            nodes = [reflected] + nodes

        if upper == "M":
            if pts:
                rings.append(pts)
            cursor = start = nodes[0]
            pts = [cursor]
            ctrl = None
        elif upper in ("L", "H", "V"):
            cursor = nodes[0]
            pts.append(cursor)
            ctrl = None
        else:
            pts += _bezier_samples([cursor] + nodes)
            ctrl = nodes[-2]
            cursor = nodes[-1]

    if pts:
        rings.append(pts)
    return rings


def parse_transform(text):
    """An SVG transform list as one (a b c d e f) matrix."""
    matrix = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
    for name, args in re.findall(r"(\w+)\s*\(([^)]*)\)", text or ""):
        v = [float(n) for n in re.findall(r"-?\d*\.?\d+(?:[eE][-+]?\d+)?", args)]
        if name == "translate":
            m = (1, 0, 0, 1, v[0], v[1] if len(v) > 1 else 0)
        elif name == "scale":
            m = (v[0], 0, 0, v[1] if len(v) > 1 else v[0], 0, 0)
        elif name == "matrix":
            m = tuple(v[:6])
        elif name == "rotate" and len(v) == 1:
            import math

            cos, sin = math.cos(math.radians(v[0])), math.sin(math.radians(v[0]))
            m = (cos, sin, -sin, cos, 0, 0)
        else:
            raise SystemExit(f"transform {name}({args}) is not handled here")
        matrix = _compose(matrix, m)
    return matrix


def _compose(outer, inner):
    a1, b1, c1, d1, e1, f1 = outer
    a2, b2, c2, d2, e2, f2 = inner
    return (
        a1 * a2 + c1 * b2,
        b1 * a2 + d1 * b2,
        a1 * c2 + c1 * d2,
        b1 * c2 + d1 * d2,
        a1 * e2 + c1 * f2 + e1,
        b1 * e2 + d1 * f2 + f1,
    )


def _bezier_samples(nodes, steps=24):
    """De Casteljau at fixed t, which is plenty for a bounding box."""
    out = []
    for step in range(steps + 1):
        t = step / steps
        pts = list(nodes)
        while len(pts) > 1:
            pts = [
                (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
                for a, b in zip(pts, pts[1:])
            ]
        out.append(pts[0])
    return out


def svg(body, size=CANVAS):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" '
        f'width="{size}" height="{size}">\n{body}\n</svg>\n'
    )


def main():
    element = {k: load_element(ELEMENTS / f) for k, f in ELEMENT_FILES.items()}
    layouts = {"flame": FLAME, "wrenches": WRENCH, "tau": TAU}
    boxes = {k: element_bbox(element[k]) for k in layouts}
    where = {k: place(boxes[k], **v) for k, v in layouts.items()}

    def negative(name, colour):
        """The element as the hole it leaves: its outline, stroked GAP wide.

        Painted before the positive, so the half of the stroke that falls inside
        the shape is covered again and only the outward half is daylight.
        """
        width = 2 * GAP / layouts[name]["scale"]
        return shape(
            name,
            colour,
            extra=(
                f' stroke="{colour}" stroke-width="{width:.2f}"'
                f' stroke-linejoin="miter" stroke-miterlimit="{MITRE}"'
            ),
            ident=f"{name}-negative",
        )

    def shape(name, fill, extra="", ident=""):
        """One element as a group: its own paths, under its own placement.

        fill-rule evenodd, so a part drawn inside another part is a hole. The
        author's own transforms stay on the paths and the layout transform goes
        on the group around them, which keeps the two kinds of positioning --
        theirs and this file's -- separable when reading the output.

        """
        inner = "".join(
            f'<path d="{d}"' + (f' transform="{t}"' if t else "") + "/>"
            for d, t in element[name]
        )
        # `id` and not `inkscape:label`: the label needs a namespace declared,
        # and an undeclared prefix is malformed XML that a renderer is free to
        # choke on. It choked on the mask. Inkscape's object list reads ids.
        label = f' id="{ident}"' if ident else ""
        return (
            f'<g transform="{where[name]}" fill="{fill}"'
            f' fill-rule="evenodd"{label}{extra}>{inner}</g>'
        )

    # --- colour: the FFwF palette, black on red exactly as the skull was
    (HERE / "logo-colour.svg").write_text(
        svg(
            f'  {shape("flame", RED)}\n'
            f'  {shape("tau", BLACK)}\n'
            f'  {shape("wrenches", BLACK)}'
        )
    )

    # --- mono: one colour, and the gaps do what red was doing. Three layers,
    # in this order: the flame, then the grown negatives of the letter and the
    # wrenches taken out of it, then those two again at their real size on top.
    # Every gap is a real hole, not a white line, so the mark works on any
    # ground -- and every corner in a gap is the corner the element has.
    cut_tau = (
        shape("tau", "#000") if MONO_TAU == "knockout" else negative("tau", "#000")
    )
    mask = (
        f'    <rect width="{CANVAS}" height="{CANVAS}" fill="#fff"/>\n'
        f"    {cut_tau}\n"
        f'    {negative("wrenches", "#000")}'
    )
    letter = "" if MONO_TAU == "knockout" else f'\n  {shape("tau", "currentColor")}'
    # The mask goes on a wrapper with no transform of its own. Put it on the
    # flame's own group and the mask's coordinates are read in that group's
    # space -- scaled by 1.34 along with the flame -- which cuts a hole the
    # wrong size in the right shape, and looks like a layout error rather than
    # what it is. The wrapper keeps the mask in canvas units.
    holed = f'<g mask="url(#gaps)">{shape("flame", "currentColor")}</g>'
    masked_flame = (
        f'  <mask id="gaps" maskUnits="userSpaceOnUse" x="0" y="0"'
        f' width="{CANVAS}" height="{CANVAS}">\n{mask}\n  </mask>\n'
        f"  {holed}"
    )
    (HERE / "logo-mono.svg").write_text(
        svg(f'{masked_flame}\n  {shape("wrenches", "currentColor")}{letter}')
    )

    # --- the same five layers, painted rather than masked, so each is an
    # object you can select and nudge. Black is ink, white is what comes out;
    # nothing else is in the file, so keying white to transparent after
    # rasterising gives the mono mark and cannot catch anything it should not.
    # Edit here, then move the numbers in LAYOUT to match what you arrived at.
    (HERE / "logo-layers.svg").write_text(
        svg(
            f'  {shape("flame", BLACK, ident="flame")}\n'
            f'  {negative("tau", WHITE)}\n'
            f'  {negative("wrenches", WHITE)}\n'
            f'  {shape("tau", BLACK, ident="tau")}\n'
            f'  {shape("wrenches", BLACK, ident="wrenches")}'
        )
    )

    # --- the marketplace icon. Black plate: the listing sits on VS Code's own
    # dark chrome more often than not, and black/white/red is the palette.
    for name, plate, ink in (("icon-dark", "#101014", WHITE), ("icon-light", WHITE, BLACK)):
        (HERE / f"{name}.svg").write_text(
            svg(
                f'  <rect width="{CANVAS}" height="{CANVAS}"'
                f' rx="{CANVAS * 0.18:.0f}" fill="{plate}"/>\n'
                f'  {shape("flame", RED)}\n'
                f'  {shape("tau", ink)}\n'
                f'  {shape("wrenches", ink)}'
            )
        )

    # --- the activity bar icon: the same letter, nothing else. The flame and
    # the wrenches are 24 pixels of mud at that size, and VS Code recolours the
    # icon to match the theme, so the one thing left that can carry the brand
    # is the glyph -- in the bold face, because the text weight is a hairline
    # here. This is packages/vscode/media/icon.svg, which the manifest points at.
    x0, y0, x1, y1 = element_bbox(element["sidebar"])
    s = SIDEBAR_FILL / max(x1 - x0, y1 - y0)
    glyph = "".join(f'<path d="{d}"/>' for d, _ in element["sidebar"])
    (MEDIA / "icon.svg").write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" '
        f'width="24" height="24" fill="currentColor">\n'
        f'  <g transform="'
        f"translate({12 - s * (x0 + x1) / 2:.2f} {12 - s * (y0 + y1) / 2:.2f}) "
        f'scale({s:.4f})">{glyph}</g>\n</svg>\n'
    )

    check_every_output_parses()
    check_the_two_mono_builds_agree()
    check_clearance(element_bbox(element["tau"]), element_bbox(element["wrenches"]))
    check_flame_survives_the_gaps(svg(masked_flame), svg(f'  {shape("flame", "#000")}'))

    for name in ("logo-colour", "logo-mono", "icon-dark", "icon-light"):
        render(HERE / f"{name}.svg", HERE / f"{name}.png", 512)
    for name in ("flame", "wrenches", "tau", "tau-bold"):
        render(ELEMENTS / f"{name}.svg", ELEMENTS / f"{name}.png", 512)

    render(HERE / "icon-dark.svg", MEDIA / "icon.png", 256)
    contact_sheet()
    print("wrote design/*.svg, design/elements/*.svg, their PNGs, and the icon")


def contact_sheet():
    """Every variant at every size that matters, on one image, to look at.

    A logo is not finished when the 512px render looks right. The activity bar
    draws it at 24 and the extensions list at 42, and a mark that turns to soup
    there is a mark that is wrong, so the sheet shows the small sizes at the
    size they will actually be.
    """
    from PIL import Image

    sizes = (16, 24, 32, 48, 64, 128)
    variants = ("logo-colour", "logo-mono", "icon-light", "icon-dark")
    pad, big = 12, 192
    width = pad + big + pad + sum(s + pad for s in sizes)
    height = pad + len(variants) * (big + pad)
    sheet = Image.new("RGBA", (width, height), (128, 128, 128, 255))

    for row, name in enumerate(variants):
        src = HERE / f"{name}.svg"
        y = pad + row * (big + pad)
        # Mono is drawn in currentColor, which renders black; the row is laid on
        # the mid grey of the sheet, where black and white both have to work.
        tile = HERE / f".sheet-{name}.png"
        render(src, tile, big)
        sheet.alpha_composite(Image.open(tile), (pad, y))
        tile.unlink()
        x = pad + big + pad
        for s in sizes:
            tile = HERE / f".sheet-{name}-{s}.png"
            render(src, tile, s)
            sheet.alpha_composite(Image.open(tile), (x, y + big - s))
            tile.unlink()
            x += s + pad

    sheet.convert("RGB").save(HERE / "preview.png")


def check_every_output_parses():
    """Every SVG written here has to be well-formed XML.

    A renderer that meets a namespace prefix nobody declared may drop the
    element, and the one it dropped was a mask -- which does not fail, it just
    quietly draws the wrong picture. Cheap to check, and it caught that.
    """
    written = sorted(HERE.glob("*.svg")) + sorted(ELEMENTS.glob("*.svg"))
    for path in written + [MEDIA / "icon.svg"]:
        try:
            ET.parse(path)
        except ET.ParseError as exc:
            raise SystemExit(f"{path.name} is not well-formed XML: {exc}")
    print("every SVG written parses")


def check_the_two_mono_builds_agree():
    """The masked mono and the painted layers must be the same picture.

    They exist so one can be edited and the other shipped, which is only true
    while they agree. Rendered on white, since white is what the layers file
    uses for the gaps the masked one leaves transparent.
    """
    import numpy as np
    from PIL import Image

    shots = []
    for name in ("logo-mono", "logo-layers"):
        png = HERE / f".agree-{name}.png"
        render(HERE / f"{name}.svg", png, 512, background="white")
        shots.append(np.array(Image.open(png).convert("L")).astype(int))
        png.unlink()

    differ = int((np.abs(shots[0] - shots[1]) > 128).sum())
    if differ > 0:
        raise SystemExit(
            f"logo-mono.svg and logo-layers.svg render {differ} pixels apart "
            f"at 512px. They are built from the same numbers, so one of the "
            f"two compositions in main() has drifted from the other."
        )
    print("mono: the masked build and the painted layers render identically")


def check_clearance(tau_bbox, wrench_bbox):
    """The letter has to stop before the wrenches start, with room to spare."""
    tau_bottom = TAU["top"] + TAU["scale"] * (tau_bbox[3] - tau_bbox[1])
    wrench_top = WRENCH["bottom"] - WRENCH["scale"] * (wrench_bbox[3] - wrench_bbox[1])
    room = wrench_top - tau_bottom
    if room < CLEARANCE:
        raise SystemExit(
            f"the tau ends at y={tau_bottom:.1f} and the wrenches start at "
            f"y={wrench_top:.1f}: {room:.1f} units apart, want {CLEARANCE}. "
            f"Shrink or raise the letter, or push WRENCH['bottom'] down."
        )
    print(f"clearance: {room:.1f} units between the tau's foot and the wrenches")


def check_flame_survives_the_gaps(masked_flame_svg, plain_flame_svg):
    """Burning the gaps into the flame must not leave crumbs.

    Gaps are what replaces colour in a single ink, and a gap wide enough to read
    is wide enough to cut a lick in half. Cutting one is not the fault: two
    licks read as two licks. The fault is a sliver -- a crumb of flame with no
    reason to be there, which at small sizes is a speck of dirt beside the mark.
    Two layouts that looked plausible left one.
    """
    total = _pieces(plain_flame_svg)
    after = _pieces(masked_flame_svg)
    crumbs = [n for n in after if n < CRUMB * sum(total)]
    if crumbs:
        raise SystemExit(
            f"the gaps crumble the flame: pieces {sorted(after)} out of "
            f"{sum(total)} px, and {crumbs} are under {CRUMB:.0%}. Move "
            f"TAU['top'] or TAU['cx'] so the letter crosses a lick squarely "
            f"instead of clipping its edge, or shrink TAU['scale']."
        )
    print(f"mono: {len(total)} lick(s) become {len(after)}, none of them crumbs")


def _pieces(markup, floor=20):
    """Sizes of a rendered SVG's connected components, antialiasing specks out.

    `floor` is in pixels of a 256-wide render. Nothing that small is artwork;
    it is the corner of a curve clipping a mask edge.
    """
    import numpy as np
    from PIL import Image
    from scipy import ndimage

    scratch = HERE / ".flame-check.svg"
    png = scratch.with_suffix(".png")
    scratch.write_text(markup)
    render(scratch, png, 256)
    alpha = np.array(Image.open(png).convert("RGBA"))[..., 3] > 128
    scratch.unlink()
    png.unlink()

    labels, count = ndimage.label(alpha)
    sizes = [int((labels == i).sum()) for i in range(1, count + 1)]
    return [n for n in sizes if n >= floor]


def render(src, dst, px, background=None):
    subprocess.run(
        [
            "inkscape",
            "--export-type=png",
            f"--export-filename={dst}",
            "-w",
            str(px),
            "-h",
            str(px),
            *(["-b", background] if background else []),
            str(src),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


if __name__ == "__main__":
    main()
