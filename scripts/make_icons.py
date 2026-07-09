"""Generate placeholder PWA icons (pink 'B' placeholder) into public/icons/.

Good enough to install the PWA; replace with real artwork in week 6.
Usage: python scripts/make_icons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
OUT.mkdir(parents=True, exist_ok=True)
PINK, BLUSH = (199, 91, 122), (255, 247, 249)


def icon(size: int, maskable: bool) -> Image.Image:
    img = Image.new("RGB", (size, size), PINK if maskable else BLUSH)
    d = ImageDraw.Draw(img)
    if not maskable:  # rounded pink tile on blush
        pad = size // 16
        d.rounded_rectangle([pad, pad, size - pad, size - pad],
                            radius=size // 5, fill=PINK)
    font = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", int(size * 0.52))
    box = d.textbbox((0, 0), "B", font=font)
    d.text(((size - box[2] - box[0]) / 2, (size - box[3] - box[1]) / 2 - size * 0.02),
           "B", font=font, fill="white")
    return img


icon(192, False).save(OUT / "icon-192.png")
icon(512, False).save(OUT / "icon-512.png")
icon(512, True).save(OUT / "icon-512-maskable.png")
print(f"wrote 3 icons to {OUT}")
