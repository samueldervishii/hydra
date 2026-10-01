#!/usr/bin/env python3
"""Generate Hydra's app icon, logo, splash image and tray icons.

The sources are the two artworks in assets/branding/. Each draws its design on
a rounded square inside a slightly darker frame, so both are cropped to the
square, and everything outside its rounded corners is made transparent:

- assets/branding/hydra-icon.png and hydra-splash.png, 1024 pixel masters
- build/icon.png, icon.ico, icon.icns and build/icons/<size>x<size>.png, the
  app icon electron-builder packages (build.linux.icon is build/icons)
- assets/hydra-logo.png, the icon the About window and notifications show
- assets/hydra-splash.png, the image on the loading screen: the splash
  hydra cut out of its square, so it sits straight on the splash background
- assets/icons/hydra-tray*.png and hydraTemplate*.png, the tray icons: a
  monochrome silhouette of the three heads in the variants src/tray.ts picks

Only Pillow is needed. Run it from anywhere: just generate-assets calls it.
"""

import io
import struct
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

root = Path(__file__).resolve().parent.parent
branding = root / "assets/branding"
build = root / "build"
icons = root / "assets/icons"

MASTER = 1024
SIZES = (16, 24, 32, 48, 64, 128, 256, 512, 1024)
ICO_SIZES = SIZES[:7]
# Cap Linux icons at 512 pixels because hicolor has no 1024x1024 directory.
# An icon in an unregistered directory is not discoverable by the desktop.
LINUX_SIZES = tuple(size for size in SIZES if size <= 512)
ICNS_SLOTS = {
    b"icp4": 16,
    b"icp5": 32,
    b"icp6": 64,
    b"ic07": 128,
    b"ic08": 256,
    b"ic09": 512,
    b"ic10": 1024,
    b"ic11": 32,
    b"ic12": 64,
    b"ic13": 256,
    b"ic14": 512,
}

# The rounded square in each 2048 pixel source, measured as the strongest
# brightness step between the frame and the square (left, top, right, bottom)
# and the corner radius found along each diagonal. INSET pulls the crop a few
# pixels inside so no frame pixel survives at the anti-aliased edge.
SOURCES = {
    "icon": ("hydra-icon.jpeg", (133, 124, 1914, 1898), 395),
    "splash": ("hydra-splash.jpeg", (141, 139, 1908, 1898), 424),
}
INSET = 8

# Tray glyph colours. The GNOME variant is white with a dark border so it reads
# on light and dark top bars alike, as the outline Sidra shipped did.
TRAY_BLACK = (0, 0, 0)
TRAY_WHITE = (255, 255, 255)
TRAY_BORDER = (32, 33, 36)
# Thicken the heads by this many target pixels before scaling down, so the
# necks stay about three pixels wide at 24 and do not break up at 16. More
# than about 0.6 merges the heads.
TRAY_BOLD_PX = 0.5


def png_bytes(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def rounded_mask(size: int, radius: float, scale: int = 4) -> Image.Image:
    """An anti-aliased rounded-square alpha mask, drawn large and reduced."""
    big = Image.new("L", (size * scale, size * scale), 0)
    ImageDraw.Draw(big).rounded_rectangle(
        (0, 0, size * scale - 1, size * scale - 1), radius=radius * scale, fill=255
    )
    return big.resize((size, size), Image.LANCZOS)


def master(name: str) -> Image.Image:
    """Crop a source to its rounded square and clear the corners."""
    filename, (left, top, right, bottom), radius = SOURCES[name]
    source = Image.open(branding / filename).convert("RGB")
    side = min(right - left, bottom - top) - 2 * INSET
    cx, cy = (left + right) / 2, (top + bottom) / 2
    box = tuple(round(v) for v in (cx - side / 2, cy - side / 2, cx + side / 2, cy + side / 2))
    square = source.crop(box).resize((MASTER, MASTER), Image.LANCZOS).convert("RGBA")
    square.putalpha(rounded_mask(MASTER, (radius - INSET) * MASTER / side))
    return square


def scaled(image: Image.Image, size: int) -> Image.Image:
    return image.resize((size, size), Image.LANCZOS)


# Coverage at or below this is the square's own gradient, not artwork; left in,
# it draws a faint ghost of the square around a cut-out.
ALPHA_FLOOR = 24


def teal_alpha(image: Image.Image):
    """Coverage of the teal artwork, unmixed from the dark square behind it.

    Each pixel is projected onto the line from the square's colour to the teal,
    so anti-aliased edges keep partial coverage instead of a hard threshold.
    Returns the coverage and the teal.
    """
    rgb = image.convert("RGB")
    background = rgb.getpixel((MASTER // 8, MASTER // 2))
    pixels = list(rgb.getdata())
    teal = max(pixels, key=lambda p: p[1] - p[0])
    axis = [t - b for t, b in zip(teal, background)]
    length = sum(a * a for a in axis)
    span = 255 - ALPHA_FLOOR
    alpha = Image.new("L", rgb.size)
    alpha.putdata([
        max(0, min(255, round(
            (255 * sum((c - b) * a for c, b, a in zip(p, background, axis)) / length - ALPHA_FLOOR)
            * 255 / span
        )))
        for p in pixels
    ])
    return ImageChops.multiply(alpha, image.getchannel("A")), teal


def cutout(image: Image.Image) -> Image.Image:
    """The teal artwork alone, on transparency."""
    alpha, teal = teal_alpha(image)
    out = Image.new("RGBA", image.size, teal + (0,))
    out.putalpha(alpha)
    return out


def heads_alpha(icon: Image.Image) -> Image.Image:
    """The icon's three heads as coverage, cropped square with a small margin."""
    alpha, _ = teal_alpha(icon)
    # Crop to the heads with a margin, centred on a square canvas.
    box = alpha.point(lambda v: 255 if v > 32 else 0).getbbox()
    side = max(box[2] - box[0], box[3] - box[1])
    side = round(side * 1.04)
    cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    square = Image.new("L", (side, side), 0)
    square.paste(alpha.crop(box), (round(side / 2 - (box[2] - box[0]) / 2), round(side / 2 - (box[3] - box[1]) / 2)))
    return square


def bold(alpha: Image.Image, size: int) -> Image.Image:
    """Dilate the heads by TRAY_BOLD_PX as measured at the target size."""
    grow = round(alpha.size[0] / size * TRAY_BOLD_PX) | 1
    return alpha.filter(ImageFilter.MaxFilter(grow)) if grow > 1 else alpha


def glyph(alpha: Image.Image, size: int, colour) -> Image.Image:
    image = Image.new("RGBA", (size, size), colour + (0,))
    image.putalpha(bold(alpha, size).resize((size, size), Image.LANCZOS))
    return image


def outlined_glyph(alpha: Image.Image, size: int) -> Image.Image:
    """White heads on a dark border about one pixel wide at the target size."""
    big = alpha.size[0]
    grow = max(3, round(big / size * 1.4)) | 1
    border = bold(alpha, size).filter(ImageFilter.MaxFilter(grow))
    out = Image.new("RGBA", (size, size), TRAY_BORDER + (0,))
    out.putalpha(border.resize((size, size), Image.LANCZOS))
    out.alpha_composite(glyph(alpha, size, TRAY_WHITE))
    return out


def write_app_icons(icon: Image.Image) -> None:
    images = {size: png_bytes(scaled(icon, size)) for size in SIZES}
    chunks = b"".join(
        struct.pack(">4sI", slot, 8 + len(images[size])) + images[size]
        for slot, size in ICNS_SLOTS.items()
    )
    (build / "icon.icns").write_bytes(struct.pack(">4sI", b"icns", 8 + len(chunks)) + chunks)

    # ICO offsets are absolute, and a zero dimension denotes 256 pixels.
    directory = bytearray(struct.pack("<HHH", 0, 1, len(ICO_SIZES)))
    offset = 6 + 16 * len(ICO_SIZES)
    for size in ICO_SIZES:
        length = len(images[size])
        directory.extend(struct.pack("<BBBBHHII", size % 256, size % 256, 0, 0, 1, 32, length, offset))
        offset += length
    (build / "icon.ico").write_bytes(directory + b"".join(images[size] for size in ICO_SIZES))
    (build / "icon.png").write_bytes(images[1024])

    # electron-builder packages every PNG in build/icons as a hicolor icon.
    # Remove unwanted sizes so stale files cannot remain in a later package.
    linux = build / "icons"
    linux.mkdir(exist_ok=True)
    wanted = {f"{size}x{size}.png" for size in LINUX_SIZES}
    for stale in linux.glob("*.png"):
        if stale.name not in wanted:
            stale.unlink()
    for size in LINUX_SIZES:
        (linux / f"{size}x{size}.png").write_bytes(images[size])


def write_tray_icons(alpha: Image.Image) -> None:
    variants = {
        # Linux on a light panel, Linux on a dark panel, and Windows.
        "hydra-tray-light": lambda s: glyph(alpha, s, TRAY_BLACK),
        "hydra-tray-dark": lambda s: glyph(alpha, s, TRAY_WHITE),
        "hydra-tray": lambda s: glyph(alpha, s, TRAY_BLACK),
        # GNOME, whose top bar can be either.
        "hydra-tray-outline": lambda s: outlined_glyph(alpha, s),
    }
    for name, render in variants.items():
        render(24).save(icons / f"{name}.png", optimize=True)
        render(48).save(icons / f"{name}@2x.png", optimize=True)
    # macOS template images: black on transparent, the system tints them.
    glyph(alpha, 16, TRAY_BLACK).save(icons / "hydraTemplate.png", optimize=True)
    glyph(alpha, 32, TRAY_BLACK).save(icons / "hydraTemplate@2x.png", optimize=True)


def main() -> None:
    icon = master("icon")
    splash = master("splash")
    icon.save(branding / "hydra-icon.png", optimize=True)
    splash.save(branding / "hydra-splash.png", optimize=True)
    write_app_icons(icon)
    scaled(icon, 256).save(root / "assets/hydra-logo.png", optimize=True)
    # Shown at 128 CSS pixels; 256 keeps it sharp on a 2x display.
    scaled(cutout(splash), 256).save(root / "assets/hydra-splash.png", optimize=True)
    write_tray_icons(heads_alpha(icon))


if __name__ == "__main__":
    main()
