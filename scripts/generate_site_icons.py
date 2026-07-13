#!/usr/bin/env python3
"""Generate shared Hanplanet favicon and PWA icon assets."""

from pathlib import Path

from PIL import Image


BASE_DIR = Path(__file__).resolve().parent.parent
SOURCE_PATH = BASE_DIR / "static/media/icons/favicon-source-1024.png"
PWA_SIZES = (180, 192, 512)
ICO_SIZES = (16, 24, 32, 48, 64, 128, 256)


def resize_square(image, size):
    return image.resize((size, size), Image.Resampling.LANCZOS)


def save_png(image, path, size):
    path.parent.mkdir(parents=True, exist_ok=True)
    resize_square(image, size).save(path, "PNG", optimize=True)


def save_ico(image, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, "ICO", sizes=[(size, size) for size in ICO_SIZES])


def main():
    source = Image.open(SOURCE_PATH).convert("RGBA")

    for size in PWA_SIZES:
        save_png(source, BASE_DIR / f"static/media/icons/pwa-{size}.png", size)

    save_png(source, BASE_DIR / "forgejo/custom/public/assets/img/apple-touch-icon.png", 180)
    save_png(source, BASE_DIR / "forgejo/custom/public/assets/img/favicon.png", 192)

    ico_paths = (
        BASE_DIR / "static/favicon.ico",
        BASE_DIR / "forgejo/custom/public/assets/img/favicon.ico",
        BASE_DIR / "Wargame/public/favicon.ico",
        BASE_DIR / "Wargame/public/assets/favicon.ico",
    )
    for path in ico_paths:
        save_ico(source, path)


if __name__ == "__main__":
    main()
