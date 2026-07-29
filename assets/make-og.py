#!/usr/bin/env python3
"""Regenerate assets/og-image.png (1200x630 social share card).

Every page's og:image pointed at a file that never existed, so every share of
thestaleysocial.com rendered a blank card. This builds the real one.

Run:  python3 assets/make-og.py
Needs: a Bricolage Grotesque variable TTF (site display font). Path below.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1200, 630
BG = (8, 8, 14)
BLUE = (45, 99, 216)
TEXT = (235, 235, 242)
MUTED = (140, 140, 168)

REPO = Path(__file__).resolve().parent.parent
FONT = Path("/private/tmp/claude-501/-Users-jami-ARIS/2becdb27-400d-466c-b122-ee76853dac13/scratchpad/bric.ttf")
OUT = REPO / "assets" / "og-image.png"


def face(size, weight):
    f = ImageFont.truetype(str(FONT), size)
    # Axis order in this file is opsz, wght, wdth. Getting it wrong silently
    # clamps to ExtraLight instead of erroring, so assert it.
    axes = [a["name"] for a in f.get_variation_axes()]
    assert axes == [b"Optical size", b"Weight", b"Width"], axes
    f.set_variation_by_axes([min(size, 96), weight, 100])
    return f


def main():
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    # Soft blue bleed off the top-right corner. Blurred hard, so it reads as
    # light falloff rather than a pasted circle.
    glow = Image.new("RGB", (W, H), BG)
    ImageDraw.Draw(glow).ellipse([W - 300, -420, W + 560, 300], fill=(24, 42, 96))
    img = Image.blend(img, glow.filter(ImageFilter.GaussianBlur(150)), 0.9)
    d = ImageDraw.Draw(img)

    pad = 72

    # Eyebrow: dot + wordmark
    d.ellipse([pad, 60, pad + 13, 73], fill=BLUE)
    d.text((pad + 26, 55), "THE STALEY SOCIAL", font=face(21, 700), fill=TEXT)

    # Headline — same promise as the H1, KC in blue.
    big = face(88, 800)
    lines = [[("We make ", TEXT), ("KC", BLUE)],
             [("businesses", BLUE)],
             [("impossible to ignore.", TEXT)]]
    y = 196
    for line in lines:
        x = pad
        for text, color in line:
            d.text((x, y), text, font=big, fill=color)
            x += d.textlength(text, font=big)
        y += 104

    # Baseline rule + the guarantee, which is the only differentiator worth the space.
    d.line([pad, H - 108, W - pad, H - 108], fill=(255, 255, 255), width=1)
    d.text((pad, H - 84), "Kansas City marketing agency", font=face(25, 500), fill=MUTED)
    tail = "Results in 90 days or month 2 is free."
    tf = face(25, 600)
    d.text((W - pad - d.textlength(tail, font=tf), H - 84), tail, font=tf, fill=TEXT)

    img.save(OUT, "PNG", optimize=True)
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
    assert OUT.exists() and Image.open(OUT).size == (W, H), "og image wrong size"
    print("self-check ok: 1200x630")
