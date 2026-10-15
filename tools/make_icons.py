# Generates SatPass icons (structure adapted from rf-toolbox/tools/make_icons.py). Run from repo root: python3 tools/make_icons.py
from PIL import Image, ImageDraw
import math
S = 1024
def gradient(size):
    im = Image.new("RGB", (size, size)); px = im.load()
    c1 = (6, 10, 28); c2 = (20, 60, 120)
    for y in range(size):
        for x in range(size):
            t = (x * 0.35 + y * 0.65) / size
            px[x, y] = tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))
    return im
def art(scale):
    L = Image.new("RGBA", (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(L)
    cx, cy = S / 2, S / 2
    def P(x, y): return (cx + x * scale, cy + y * scale)
    # stars
    for (x, y, r) in [(-380, -330, 7), (300, -380, 9), (-250, -120, 5), (400, -60, 6), (-420, 80, 6), (120, -260, 5)]:
        a = P(x, y); d.ellipse([a[0] - r * scale, a[1] - r * scale, a[0] + r * scale, a[1] + r * scale], fill=(226, 232, 240, 230))
    # Earth limb (big circle below)
    R = 780 * scale; ec = P(0, 760)
    d.ellipse([ec[0] - R, ec[1] - R, ec[0] + R, ec[1] + R], fill=(14, 116, 144, 255), outline=(103, 232, 249, 255), width=int(12 * scale))
    R2 = 700 * scale
    d.ellipse([ec[0] - R2, ec[1] - R2, ec[0] + R2, ec[1] + R2], outline=(8, 80, 110, 255), width=int(8 * scale))
    # orbit arc (dashed)
    ro = 600 * scale
    for k in range(0, 120, 6):
        a0, a1 = 200 + k, 200 + k + 3.4
        d.arc([ec[0] - ro - 140 * scale, ec[1] - ro - 140 * scale, ec[0] + ro + 140 * scale, ec[1] + ro + 140 * scale], a0 + 0, a1 + 0, fill=(250, 204, 21, 255), width=int(10 * scale))
    # satellite at top-right of the orbit
    sa = math.radians(268)
    sx = ec[0] + (ro + 140 * scale) * math.cos(sa) + 150 * scale
    sy = ec[1] + (ro + 140 * scale) * math.sin(sa) - 0 * scale
    sx, sy = cx + 120 * scale, cy - 250 * scale
    def rot(pt, ang):
        c, s = math.cos(ang), math.sin(ang); return (sx + pt[0] * c - pt[1] * s, sy + pt[0] * s + pt[1] * c)
    ang = math.radians(-30)
    def poly(pts, fill, outline=None):
        d.polygon([rot((x * scale, y * scale), ang) for x, y in pts], fill=fill, outline=outline)
    poly([(-45, -45), (45, -45), (45, 45), (-45, 45)], (226, 232, 240, 255))              # body
    poly([(-250, -30), (-70, -30), (-70, 30), (-250, 30)], (34, 211, 238, 255), (8, 47, 73, 255))   # panels
    poly([(70, -30), (250, -30), (250, 30), (70, 30)], (34, 211, 238, 255), (8, 47, 73, 255))
    for x in (-190, -130, 130, 190): d.line([rot((x * scale, -30 * scale), ang), rot((x * scale, 30 * scale), ang)], fill=(8, 47, 73, 255), width=int(5 * scale))
    # antenna
    d.line([rot((0, -45 * scale), ang), rot((0, -110 * scale), ang)], fill=(226, 232, 240, 255), width=int(8 * scale))
    r = 14 * scale; a = rot((0, -115 * scale), ang); d.ellipse([a[0] - r, a[1] - r, a[0] + r, a[1] + r], fill=(244, 114, 182, 255))
    # signal arcs toward the ground
    for i, rr in enumerate((110, 170, 230)):
        d.arc([sx - rr * scale, sy - rr * scale + 70 * scale, sx + rr * scale, sy + rr * scale + 70 * scale], 40, 140, fill=(244, 114, 182, 255 - i * 55), width=int(10 * scale))
    return L
def make(size, maskable=False, rounded=True, fname=None):
    bg = gradient(512).resize((S, S), Image.BICUBIC).convert("RGBA")
    bg.alpha_composite(art(0.72 if maskable else 0.95))
    if rounded and not maskable:
        m = Image.new("L", (S, S), 0); ImageDraw.Draw(m).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=255)
        out = Image.new("RGBA", (S, S), (0, 0, 0, 0)); out.paste(bg, (0, 0), m); bg = out
    else:
        bg = bg.convert("RGB")
    bg.resize((size, size), Image.LANCZOS).save(fname, optimize=True)
make(192, fname="icons/icon-192.png")
make(512, fname="icons/icon-512.png")
make(512, maskable=True, fname="icons/maskable-512.png")
make(180, rounded=False, fname="icons/apple-touch-icon.png")
make(32, fname="icons/favicon-32.png")
