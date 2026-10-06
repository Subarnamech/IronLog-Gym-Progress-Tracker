"""Icon generator for OmniPorta and its tools.

    python3 tools/make_icons.py            # rebuild OmniPorta + Iron Log icons into public/

Each app gets four PNGs: icon-192, icon-512, icon-maskable-512 (art kept inside the safe zone so
Android can crop it into any shape) and apple-touch-icon (full-bleed square, iOS rounds it itself).
add_tool.py reuses monogram_set() to give every new tool a matching starter icon.
"""
import os
import sys
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC = os.path.join(ROOT, "public")
SS = 4  # supersampling factor

# shadcn/ui zinc palette
ZINC_950 = (9, 9, 11, 255)
ZINC_50 = (250, 250, 250, 255)
ZINC_400 = (161, 161, 170, 255)
ZINC_600 = (82, 82, 91, 255)

# Iron Log palette (matches the app)
IL_CHARCOAL = (20, 20, 23, 255)
IL_EMBER = (255, 107, 53, 255)
IL_CHALK = (242, 241, 236, 255)
IL_STEEL = (154, 154, 158, 255)


def _canvas(size, bg, rounded):
    S = size * SS
    if rounded:
        img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        ImageDraw.Draw(img).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=bg)
    else:
        img = Image.new("RGBA", (S, S), bg)
    return img, ImageDraw.Draw(img), S


def _finish(img, size, flatten):
    img = img.resize((size, size), Image.LANCZOS)
    return img.convert("RGB") if flatten else img


def _round_arc(d, cx, cy, r, a0, a1, width, fill):
    """Arc with round end caps. Angles in degrees, 0 = 3 o'clock, clockwise (PIL convention)."""
    import math
    ro = r + width / 2  # PIL strokes inward from the box, so grow the box to centre the stroke on r
    d.arc([cx - ro, cy - ro, cx + ro, cy + ro], a0, a1, fill=fill, width=int(round(width)))
    for a in (a0, a1):
        x, y = cx + r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a))
        d.ellipse([x - width / 2, y - width / 2, x + width / 2, y + width / 2], fill=fill)


# ---------------------------------------------------------------- OmniPorta
def omniporta_icon(size, safe=1.0, rounded=True, flatten=False):
    """A portal: an open outer ring (the doorway), an inner ring, and a solid centre."""
    img, d, S = _canvas(size, ZINC_950, rounded)
    u = S * safe / 100.0
    c = S / 2
    # outer ring is open in the upper right: the gap is the "door"
    _round_arc(d, c, c, 34 * u, -20, 290, 7 * u, ZINC_50)
    ri = 21 * u + 2.5 * u  # ring centreline 21, stroke 5
    d.ellipse([c - ri, c - ri, c + ri, c + ri], outline=ZINC_400, width=int(round(5 * u)))
    d.ellipse([c - 8 * u, c - 8 * u, c + 8 * u, c + 8 * u], fill=ZINC_50)
    return _finish(img, size, flatten)


# ----------------------------------------------------------------- Iron Log
def ironlog_icon(size, safe=1.0, rounded=True, flatten=False):
    img, d, S = _canvas(size, IL_CHARCOAL, rounded)
    cx = cy = S / 2
    u = S * safe / 100.0

    def rect(x0, y0, x1, y1, fill, r=0):
        box = [cx + x0 * u, cy + y0 * u, cx + x1 * u, cy + y1 * u]
        d.rounded_rectangle(box, radius=r * u, fill=fill) if r else d.rectangle(box, fill=fill)

    rect(-40, -2.5, 40, 2.5, IL_STEEL, r=2)
    rect(-26, -6, -23, 6, IL_CHALK, r=1)
    rect(23, -6, 26, 6, IL_CHALK, r=1)
    for sign in (-1, 1):
        a = sorted([sign * 14, sign * 22]); rect(a[0], -26, a[1], 26, IL_EMBER, r=3)
        b = sorted([sign * 24, sign * 29]); rect(b[0], -17, b[1], 17, IL_EMBER, r=2.5)
        c = sorted([sign * 30, sign * 34]); rect(c[0], -9, c[1], 9, IL_CHALK, r=2)
    return _finish(img, size, flatten)


# ---------------------------------------------------------- generic monogram
def _font(px):
    for p in ("/usr/share/fonts/opentype/inter/Inter-Bold.otf",
              "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
              "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"):
        if os.path.exists(p):
            return ImageFont.truetype(p, px)
    return ImageFont.load_default(size=px)


def monogram_icon(size, letter, bg, fg=(255, 255, 255, 255), safe=1.0, rounded=True, flatten=False):
    img, d, S = _canvas(size, bg, rounded)
    font = _font(int(S * 0.56 * safe))
    d.text((S / 2, S / 2), letter.upper()[:1], font=font, fill=fg, anchor="mm")
    return _finish(img, size, flatten)


def _save_set(out_dir, make):
    os.makedirs(out_dir, exist_ok=True)
    make(512, safe=0.92).save(os.path.join(out_dir, "icon-512.png"))
    make(192, safe=0.92).save(os.path.join(out_dir, "icon-192.png"))
    make(512, safe=0.68, rounded=False, flatten=True).save(os.path.join(out_dir, "icon-maskable-512.png"))
    make(180, safe=0.85, rounded=False, flatten=True).save(os.path.join(out_dir, "apple-touch-icon.png"))


def monogram_set(out_dir, letter, hex_color):
    h = hex_color.lstrip("#")
    bg = tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) + (255,)
    _save_set(out_dir, lambda size, **kw: monogram_icon(size, letter, bg, **kw))


if __name__ == "__main__":
    _save_set(os.path.join(PUBLIC, "icons"), omniporta_icon)
    _save_set(os.path.join(PUBLIC, "ironlog", "icons"), ironlog_icon)
    print("OmniPorta + Iron Log icons written to", PUBLIC)
