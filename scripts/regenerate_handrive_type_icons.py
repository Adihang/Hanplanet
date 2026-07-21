#!/usr/bin/env python3
"""Build high-resolution HanDrive list icons from the original source assets."""

from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps


ROOT = Path(__file__).resolve().parents[1]
ICON_DIR = ROOT / "static/media/icons/handrive"
CANVAS_SIZE = 248  # 31px list-icon canvas at 8× source resolution.
SCALE = CANVAS_SIZE // 31
SOURCE_RASTER_SIZE = 2048
# These bounds bake in the former 20px `scaleX(1.355) scaleY(1.66)`
# presentation. Keep the source artwork narrow and tall in its own canvas,
# rather than stretching it again in the page stylesheet.
DOCUMENT_BOX = (4.5, 1.2, 26.5, 29.8)
DOCUMENT_CONTENT_BOX = (7.2, 12.5, 23.8, 26.6)
DOCUMENT_CENTER = (15.5, 15.5)
DOCUMENT_X_SCALE = 22 / 24
DOCUMENT_Y_SCALE = 28.6 / 29.6

# Each destination preserves the visible bounds of the 31px list icon while
# retaining sufficient pixels for browser zoom and larger list presentations.
SOURCE_ICONS: dict[str, tuple[str, tuple[int, int, int, int]]] = {
    "audio": ("Audio.png", (3.4, 5.25, 28.6, 27.75)),
    "branch": ("git-branch.svg", (7, 7, 25, 25)),
    "c": ("c.svg", (5, 3, 27, 29)),
    "cpp": ("cpp.svg", (5, 3, 27, 29)),
    "csharp": ("csharp.svg", (5, 3, 27, 29)),
    "css": ("css3.svg", (5, 3, 27, 29)),
    "default-file": ("file.svg", (5, 3, 27, 29)),
    "excel": ("excel.webp", (4, 3, 29, 29)),
    "exe": ("exe.svg", (4, 6, 28, 26)),
    "file": ("file.svg", (6, 3, 26, 29)),
    "folder": ("folder.png", (4, 6, 28, 26)),
    "folder-empty": ("folder_empty.png", (4, 6, 28, 26)),
    "font": ("font.svg", (10, 7, 22, 25)),
    "go": ("go.svg", (7, 3, 25, 28)),
    "google-drive": ("google-drive.svg", (5, 7, 27, 26)),
    "html": ("html5.svg", (5, 3, 27, 29)),
    "image": ("image.svg", (5, 5, 28, 27)),
    "java": ("java.svg", (6, 3, 26, 29)),
    "js": ("js.svg", (4, 3, 28, 29)),
    "jsx": ("react.svg", (5, 4, 27, 28)),
    "kotlin": ("kotlin.svg", (6, 6, 26, 26)),
    "pdf": ("pdf.svg", (6, 3, 26, 29)),
    "php": ("php.svg", (5, 9, 27, 23)),
    "powerpoint": ("powerpoint.svg", (4, 4, 30, 28)),
    "py": ("python.svg", (5, 5, 27, 29)),
    "repo": ("git.svg", (5, 5, 27, 27)),
    "ruby": ("ruby.svg", (5, 3, 27, 29)),
    "rust": ("rust.svg", (5, 3, 27, 29)),
    "scala": ("scala.svg", (8, 3, 25, 29)),
    "shell": ("bash.svg", (5, 3, 27, 29)),
    "swift": ("swift.svg", (5, 3, 27, 29)),
    "trash-empty": ("trash-empty.png", (6, 3, 26, 29)),
    "trash-full": ("trash-full.png", (6, 2, 26, 29)),
    "ts": ("ts.svg", (5, 3, 28, 29)),
    "video": ("video.svg", (5, 5, 28, 27)),
    "word": ("word.webp", (4, 3, 29, 29)),
}

GITHUB_MARK_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="#181717" d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.01.08-2.11 0 0 .67-.21 2.2.82a7.53 7.53 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.91.08 2.11.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8 8 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>"""


def _scale_box(box: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    return tuple(round(value * SCALE) for value in box)


def _rasterize_svg(svg_path: Path) -> Image.Image:
    with tempfile.NamedTemporaryFile(suffix=".png") as target:
        subprocess.run(
            [
                "sips",
                "-s",
                "format",
                "png",
                "-Z",
                str(SOURCE_RASTER_SIZE),
                str(svg_path),
                "--out",
                target.name,
            ],
            check=True,
            capture_output=True,
        )
        return Image.open(target.name).convert("RGBA").copy()


def _load_source(source_name: str) -> Image.Image:
    source_path = ICON_DIR / source_name
    if source_path.suffix.lower() == ".svg":
        return _rasterize_svg(source_path)
    return Image.open(source_path).convert("RGBA")


def _place_source(
    canvas: Image.Image,
    source: Image.Image,
    box: tuple[int, int, int, int],
    *,
    stretch: bool = False,
) -> None:
    alpha_bounds = source.getchannel("A").getbbox()
    if alpha_bounds is None:
        return
    artwork = source.crop(alpha_bounds)
    left, top, right, bottom = _scale_box(box)
    max_size = (right - left, bottom - top)
    if stretch:
        artwork = artwork.resize(max_size, Image.Resampling.LANCZOS)
        x, y = left, top
    else:
        artwork = ImageOps.contain(artwork, max_size, Image.Resampling.LANCZOS)
        x = left + (max_size[0] - artwork.width) // 2
        y = top + (max_size[1] - artwork.height) // 2
    canvas.alpha_composite(artwork, (x, y))


def _canvas_from_source(source_name: str, box: tuple[int, int, int, int]) -> Image.Image:
    canvas = Image.new("RGBA", (CANVAS_SIZE, CANVAS_SIZE), (0, 0, 0, 0))
    _place_source(canvas, _load_source(source_name), box)
    return canvas


def _write_icon(name: str, icon: Image.Image) -> None:
    icon.save(ICON_DIR / f"type-{name}.png", optimize=True)


def _map_document_point(x: float, y: float) -> tuple[float, float]:
    center_x, center_y = DOCUMENT_CENTER
    return (
        center_x + ((x - center_x) * DOCUMENT_X_SCALE),
        center_y + ((y - center_y) * DOCUMENT_Y_SCALE),
    )


def _map_document_box(box: tuple[float, float, float, float]) -> tuple[float, float, float, float]:
    left, top = _map_document_point(box[0], box[1])
    right, bottom = _map_document_point(box[2], box[3])
    return left, top, right, bottom


def _draw_document_base() -> Image.Image:
    icon = Image.new("RGBA", (CANVAS_SIZE, CANVAS_SIZE), (0, 0, 0, 0))
    _place_source(icon, _load_source("file.svg"), DOCUMENT_BOX, stretch=True)
    draw = ImageDraw.Draw(icon)
    draw.rectangle(_scale_box(_map_document_box(DOCUMENT_CONTENT_BOX)), fill="#e8f0ff")
    draw.rounded_rectangle(_scale_box(_map_document_box((8.2, 13.8, 22.8, 15.4))), radius=round(0.64 * SCALE), fill="#2e5fd0")
    draw.rounded_rectangle(_scale_box(_map_document_box((8.2, 17.1, 21.4, 18.5))), radius=round(0.56 * SCALE), fill="#6c95f7")
    draw.rounded_rectangle(_scale_box(_map_document_box((8.2, 20.3, 22.0, 21.7))), radius=round(0.56 * SCALE), fill="#6c95f7")
    draw.rounded_rectangle(_scale_box(_map_document_box((8.2, 23.5, 19.3, 24.9))), radius=round(0.56 * SCALE), fill="#9cb9f8")
    return icon


def _draw_document_variant(kind: str) -> Image.Image:
    icon = _draw_document_base()
    draw = ImageDraw.Draw(icon)
    draw.rectangle(_scale_box(_map_document_box(DOCUMENT_CONTENT_BOX)), fill="#e8f0ff")

    def line(points: list[tuple[float, float]], color: str, width: float) -> None:
        draw.line(
            [
                (round(mapped_x * SCALE), round(mapped_y * SCALE))
                for mapped_x, mapped_y in (_map_document_point(x, y) for x, y in points)
            ],
            fill=color,
            width=round(width * DOCUMENT_X_SCALE * SCALE),
            joint="curve",
        )

    def rounded_box(box: tuple[float, float, float, float], color: str, radius: float) -> None:
        draw.rounded_rectangle(
            _scale_box(_map_document_box(box)),
            radius=round(radius * DOCUMENT_X_SCALE * SCALE),
            fill=color,
        )

    if kind == "text":
        rounded_box((8.2, 13.8, 22.8, 15.4), "#2e5fd0", 0.8)
        rounded_box((8.2, 17.1, 22.0, 18.5), "#6c95f7", 0.7)
        rounded_box((8.2, 20.3, 21.4, 21.7), "#6c95f7", 0.7)
        rounded_box((8.2, 23.5, 18.7, 24.9), "#6c95f7", 0.7)
    elif kind == "data":
        line([(8.4, 14.0), (22.6, 14.0), (22.6, 25.0), (8.4, 25.0), (8.4, 14.0)], "#6c95f7", 1.3)
        line([(13.15, 14.4), (13.15, 24.6)], "#6c95f7", 1.1)
        line([(17.9, 14.4), (17.9, 24.6)], "#6c95f7", 1.1)
        line([(8.8, 19.5), (22.2, 19.5)], "#6c95f7", 1.1)
    elif kind == "code":
        line([(11.3, 15.0), (8.5, 19.5), (11.3, 24.0)], "#2e5fd0", 1.45)
        line([(19.7, 15.0), (22.5, 19.5), (19.7, 24.0)], "#2e5fd0", 1.45)
        line([(16.9, 14.6), (14.2, 24.4)], "#6c95f7", 1.25)
    else:
        raise ValueError(f"Unknown document variant: {kind}")
    return icon


def _draw_pdf_document_icon() -> Image.Image:
    """Use the same balanced document frame for PDF files."""
    icon = Image.new("RGBA", (CANVAS_SIZE, CANVAS_SIZE), (0, 0, 0, 0))
    _place_source(icon, _load_source("pdf.svg"), DOCUMENT_BOX, stretch=True)
    return icon


def _draw_archive_folder_icon() -> Image.Image:
    """Match the exact visible bounds of the ordinary folder icon."""
    icon = Image.new("RGBA", (CANVAS_SIZE, CANVAS_SIZE), (0, 0, 0, 0))
    _place_source(icon, _load_source("zip.png"), (4, 6.125, 28, 25.75), stretch=True)
    return icon


def _draw_folder_variant(kind: str) -> Image.Image:
    icon = _canvas_from_source("folder.png", (4, 6, 28, 26))
    draw = ImageDraw.Draw(icon)
    if kind == "folder-image":
        draw.rounded_rectangle(_scale_box((10, 13, 22, 21)), radius=2 * SCALE, fill="#eef4ff", outline="#4b83f5", width=SCALE)
        draw.ellipse(_scale_box((12, 14.5, 14.5, 17)), fill="#f5b942")
        draw.polygon(
            [(10.8 * SCALE, 20.1 * SCALE), (14.8 * SCALE, 16.8 * SCALE), (17.1 * SCALE, 18.6 * SCALE), (19.8 * SCALE, 15.8 * SCALE), (21.3 * SCALE, 20.1 * SCALE)],
            fill="#6c95f7",
        )
    elif kind == "folder-youtube":
        draw.rounded_rectangle(_scale_box((9.7, 14, 22.3, 20)), radius=1.9 * SCALE, fill="#ff3b30")
        draw.polygon(
            [(14.6 * SCALE, 15.3 * SCALE), (14.6 * SCALE, 18.7 * SCALE), (18.1 * SCALE, 17 * SCALE)],
            fill="#ffffff",
        )
    else:
        raise ValueError(f"Unknown folder variant: {kind}")
    return icon


def _draw_map_icon() -> Image.Image:
    icon = Image.new("RGBA", (CANVAS_SIZE, CANVAS_SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(icon)
    points = [(6, 9), (12, 6), (18, 9), (24, 6), (24, 23), (18, 26), (12, 23), (6, 26), (6, 9)]
    draw.line([(x * SCALE, y * SCALE) for x, y in points], fill="#4f8ef7", width=round(1.8 * SCALE), joint="curve")
    draw.line([(12 * SCALE, 6 * SCALE), (12 * SCALE, 23 * SCALE)], fill="#4f8ef7", width=round(1.8 * SCALE))
    draw.line([(18 * SCALE, 9 * SCALE), (18 * SCALE, 26 * SCALE)], fill="#4f8ef7", width=round(1.8 * SCALE))
    return icon


def _draw_github_icon() -> Image.Image:
    with tempfile.NamedTemporaryFile(suffix=".svg", mode="w", encoding="utf-8") as source:
        source.write(GITHUB_MARK_SVG)
        source.flush()
        return _canvas_from_source(source.name, (5, 5, 27, 27))


def main() -> None:
    for name, (source_name, box) in SOURCE_ICONS.items():
        _write_icon(name, _canvas_from_source(source_name, box))

    document_base = _draw_document_base()
    _write_icon("default-file", document_base)
    _write_icon("file", document_base)

    for name in ("text", "data", "code"):
        icon = _draw_document_variant(name)
        _write_icon(name, icon)
        _write_icon(f"{name}-light", icon)
        _write_icon(f"{name}-dark", icon)

    _write_icon("pdf", _draw_pdf_document_icon())
    _write_icon("folder-image", _draw_folder_variant("folder-image"))
    _write_icon("folder-youtube", _draw_folder_variant("folder-youtube"))
    _write_icon("archive", _draw_archive_folder_icon())
    _write_icon("map", _draw_map_icon())
    github_icon = _draw_github_icon()
    _write_icon("github", github_icon)
    _write_icon("github-dark", github_icon)

    font_icon = _canvas_from_source(*SOURCE_ICONS["font"])
    _write_icon("font-light", font_icon)
    _write_icon("font-dark", font_icon)


if __name__ == "__main__":
    main()
