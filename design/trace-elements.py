#!/usr/bin/env python3
"""Produce the three vector elements the tau mark is built from.

Two of them are salvaged from the FFwF logo. That source is a 256x256 PNG of
three flat colours -- white, 0xf00, 0x000 -- so the flame and the crossed
wrenches separate by colour and then by connected component. What comes out is
not a photograph traced into a thousand nodes: each contour is resampled to an
even spacing, smoothed, simplified by Ramer-Douglas-Peucker, and emitted as
Catmull-Rom cubics. That is a few dozen control points per element, which is a
path a human can still open and drag.

The third is the letter, lifted from DejaVu Sans Mono Oblique's own outline
rather than drawn to resemble it. Running this needs the font installed;
composing the logo does not, because the extracted path is committed.

    python3 design/trace-elements.py

Writes design/elements/{flame,wrenches,tau,tau-bold}.svg, which build-logo.py
reads. Re-running is idempotent.
"""

import pathlib

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = pathlib.Path(__file__).resolve().parent
SOURCE = HERE.parent / "packages" / "vscode" / "media" / "ffwf-logo.png"
FONTS = pathlib.Path("/usr/share/fonts/truetype/dejavu")
# The mark uses the text weight, at the size a logo is read. The bold is here
# for the activity bar, where 24 pixels turn the text weight into a hairline.
FACES = {"tau": "DejaVuSansMono-Oblique", "tau-bold": "DejaVuSansMono-BoldOblique"}
OUT = HERE / "elements"

# The source is 256x256 and every downstream coordinate stays in that space, so
# what you read in the SVG is what you can measure on the original PNG.
SIZE = 256

# Contours are found on a 4x supersample: the 256px mask's staircase is then a
# quarter-pixel wobble, which the smoothing pass removes without rounding off
# the flame's actual points.
SCALE = 4


def masks():
    """The three colour regions, split into the parts that are their own shape."""
    rgb = np.array(Image.open(SOURCE).convert("RGB")).astype(int)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    black = (r < 128) & (g < 128) & (b < 128)
    red = (r > 128) & (g < 128) & (b < 128)

    labels, _ = ndimage.label(black)
    # Components by size and position rather than by index: the labelling order
    # is an implementation detail of scipy, the geometry is a fact about the logo.
    parts = []
    for i in range(1, labels.max() + 1):
        ys, xs = np.where(labels == i)
        if len(ys) < 200:
            continue  # the four corner ticks of the source's rounded frame
        parts.append({"mask": labels == i, "top": ys.min(), "size": len(ys)})
    parts.sort(key=lambda p: p["top"])

    if len(parts) != 3:
        raise SystemExit(f"expected cranium, jaw and wrenches; found {len(parts)} shapes")
    cranium, jaw, wrenches = (p["mask"] for p in parts)

    # The flame is behind the skull, so the red alone is three disconnected
    # tongues plus what shows through the eye sockets. Union it with the skull
    # and fill the holes and the flame comes back whole -- except along the
    # bottom, where there is no flame in the source at all: the skull covers it,
    # so every pixel there is invented either way. The closing invents a round
    # base rather than the skull's chin and cheekbones, which is the shape the
    # rest of the outline implies.
    flame = ndimage.binary_fill_holes(red | cranium | jaw)
    flame = ndimage.binary_closing(flame, structure=_disk(10), border_value=0)

    return {"flame": flame, "wrenches": wrenches}


def _disk(radius):
    yy, xx = np.mgrid[-radius : radius + 1, -radius : radius + 1]
    return yy**2 + xx**2 <= radius * radius


def contours(mask):
    """Sub-pixel outlines of a binary mask, outer ring first, holes after."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    big = np.kron(mask.astype(float), np.ones((SCALE, SCALE)))
    big = ndimage.gaussian_filter(big, sigma=SCALE * 0.6)

    fig = plt.figure()
    cs = plt.contour(big, levels=[0.5])
    rings = []
    for path in cs.collections[0].get_paths():
        pts = path.vertices / SCALE
        if len(pts) < 12:
            continue
        rings.append(pts)
    plt.close(fig)
    rings.sort(key=lambda p: -_area(p))
    return rings


def _area(pts):
    x, y = pts[:, 0], pts[:, 1]
    return abs(np.dot(x, np.roll(y, 1)) - np.dot(y, np.roll(x, 1))) / 2


def resample(pts, step=2.0):
    """Even arc-length spacing, so smoothing treats every stretch alike."""
    pts = np.asarray(pts, float)
    if np.allclose(pts[0], pts[-1]):
        pts = pts[:-1]
    closed = np.vstack([pts, pts[:1]])
    seg = np.linalg.norm(np.diff(closed, axis=0), axis=1)
    dist = np.concatenate([[0], np.cumsum(seg)])
    n = max(16, int(round(dist[-1] / step)))
    want = np.linspace(0, dist[-1], n, endpoint=False)
    return np.column_stack([np.interp(want, dist, closed[:, i]) for i in (0, 1)])


def smooth(pts, passes=2):
    """A closed three-tap average. Two passes kills the raster's chatter."""
    for _ in range(passes):
        pts = (np.roll(pts, 1, axis=0) + 2 * pts + np.roll(pts, -1, axis=0)) / 4
    return pts


def rdp(pts, eps=0.45):
    """Ramer-Douglas-Peucker over a closed ring, anchored at its extremes."""
    n = len(pts)
    start = int(np.argmin(pts[:, 1]))
    ring = np.roll(pts, -start, axis=0)
    ring = np.vstack([ring, ring[:1]])
    keep = np.zeros(len(ring), bool)
    keep[0] = keep[-1] = True

    stack = [(0, len(ring) - 1)]
    while stack:
        lo, hi = stack.pop()
        if hi <= lo + 1:
            continue
        a, b = ring[lo], ring[hi]
        ab = b - a
        norm = np.hypot(*ab)
        rel = ring[lo + 1 : hi] - a
        if norm < 1e-9:
            d = np.linalg.norm(rel, axis=1)
        else:
            d = np.abs(rel[:, 0] * ab[1] - rel[:, 1] * ab[0]) / norm
        k = int(np.argmax(d))
        if d[k] > eps:
            keep[lo + 1 + k] = True
            stack += [(lo, lo + 1 + k), (lo + 1 + k, hi)]
    out = ring[keep]
    return out[:-1] if np.allclose(out[0], out[-1]) else out


def catmull_rom(pts, tension=1.0):
    """Closed Catmull-Rom through every point, written as SVG cubics.

    Interpolating rather than approximating matters here: the points that
    survived RDP are the ones that carry the shape, so the curve has to go
    through them, not near them.
    """
    n = len(pts)
    d = [f"M {pts[0][0]:.2f} {pts[0][1]:.2f}"]
    for i in range(n):
        p0, p1, p2, p3 = (pts[(i - 1) % n], pts[i], pts[(i + 1) % n], pts[(i + 2) % n])
        c1 = p1 + (p2 - p0) / (6 * tension)
        c2 = p2 - (p3 - p1) / (6 * tension)
        d.append(
            f"C {c1[0]:.2f} {c1[1]:.2f} {c2[0]:.2f} {c2[1]:.2f} {p2[0]:.2f} {p2[1]:.2f}"
        )
    d.append("Z")
    return " ".join(d)


def trace(mask, eps=0.45):
    return [catmull_rom(rdp(smooth(resample(r)), eps)) for r in contours(mask)]


def greek_tau(path):
    """U+03C4 out of a DejaVu Sans Mono face, as one SVG path.

    Lifted from the font's own outline rather than redrawn to resemble it: the
    letter is the one part of this mark that has to look like a letter, and a
    hand-drawn approximation of a typeface is exactly the kind of nearly-right
    that gets noticed and cannot be fixed.
    """
    from fontTools.pens.svgPathPen import SVGPathPen
    from fontTools.pens.transformPen import TransformPen
    from fontTools.ttLib import TTFont

    if not path.exists():
        raise SystemExit(f"{path} is not installed; the tau comes from that face")

    font = TTFont(path)
    glyphs = font.getGlyphSet()
    name = font.getBestCmap()[0x03C4]
    upem = font["head"].unitsPerEm

    # Font space is y-up with the baseline at 0, SVG is y-down. Baking the flip
    # into the coordinates rather than wrapping the path in a transform leaves
    # the letter in the same 256-unit space as the traced pair, so the composer
    # places all three the same way.
    s = SIZE / upem
    pen = SVGPathPen(glyphs)
    glyphs[name].draw(TransformPen(pen, (s, 0, 0, -s, 0, SIZE)))
    return pen.getCommands()


ORIGINS = {
    "flame": "traced from the FFwF logo's flame",
    "wrenches": "traced from the FFwF logo's crossed wrenches",
    "tau": "U+03C4 from DejaVu Sans Mono Oblique",
    "tau-bold": "U+03C4 from DejaVu Sans Mono Bold Oblique",
}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    glyphs = {
        key: [greek_tau(FONTS / f"{face}.ttf")] for key, face in FACES.items()
    }
    paths = dict(masks_traced(), **glyphs)

    for name, rings in paths.items():
        body = "\n".join(f'  <path d="{d}"/>' for d in rings)
        svg = (
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SIZE} {SIZE}" '
            f'width="{SIZE}" height="{SIZE}">\n'
            f"  <!-- {ORIGINS[name]}. fill-rule evenodd: any inner ring is a\n"
            f"       hole, not a second shape. -->\n"
            f'  <g fill="currentColor" fill-rule="evenodd">\n{body}\n  </g>\n</svg>\n'
        )
        (OUT / f"{name}.svg").write_text(svg)
        print(f"{name}: {len(rings)} ring(s) -> {OUT / (name + '.svg')}")


def masks_traced():
    return {name: trace(mask) for name, mask in masks().items()}


if __name__ == "__main__":
    main()
