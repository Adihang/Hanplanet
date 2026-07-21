#!/usr/bin/env python3
"""Build web inventory icons from the installed Minecraft client jar."""

from __future__ import annotations

import argparse
import io
import json
import re
import shutil
import zipfile
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw


DEFAULT_VERSION = "26.2"
DEFAULT_OUTPUT_DIR = Path("static/media/icons/minecraft/items")
ITEM_DEFINITION_PREFIX = "assets/minecraft/items/"
MODEL_PREFIX = "assets/{namespace}/models/{path}.json"
TEXTURE_PREFIX = "assets/{namespace}/textures/{path}.png"
RESOURCE_LOCATION_PATTERN = re.compile(r"^[a-z0-9_.-]+:[a-z0-9_./-]+$")
DYE_COLORS = {
    "white": (249, 255, 254),
    "orange": (249, 128, 29),
    "magenta": (199, 78, 189),
    "light_blue": (58, 179, 218),
    "yellow": (254, 216, 61),
    "lime": (128, 199, 31),
    "pink": (243, 139, 170),
    "gray": (71, 79, 82),
    "light_gray": (157, 157, 151),
    "cyan": (22, 156, 156),
    "purple": (137, 50, 184),
    "blue": (60, 68, 170),
    "brown": (131, 84, 50),
    "green": (94, 124, 22),
    "red": (176, 46, 38),
    "black": (29, 29, 33),
}
CHEST_COLORS = {
    "normal": ((171, 121, 45), (127, 84, 30), (233, 204, 96)),
    "trapped": ((171, 121, 45), (127, 84, 30), (184, 42, 39)),
    "ender": ((20, 37, 39), (7, 18, 22), (94, 220, 190)),
    "copper": ((202, 112, 76), (130, 71, 52), (239, 174, 120)),
    "copper_exposed": ((166, 124, 103), (94, 84, 77), (207, 166, 137)),
    "copper_weathered": ((102, 151, 133), (61, 103, 95), (157, 207, 181)),
    "copper_oxidized": ((82, 169, 145), (53, 116, 106), (145, 222, 191)),
    "exposed_copper": ((166, 124, 103), (94, 84, 77), (207, 166, 137)),
    "weathered_copper": ((102, 151, 133), (61, 103, 95), (157, 207, 181)),
    "oxidized_copper": ((82, 169, 145), (53, 116, 106), (145, 222, 191)),
    "christmas": ((195, 42, 50), (86, 130, 60), (245, 235, 184)),
}
HEAD_TEXTURES = {
    "player": "minecraft:entity/player/wide/steve",
    "skeleton": "minecraft:entity/skeleton/skeleton",
    "wither_skeleton": "minecraft:entity/skeleton/wither_skeleton",
    "zombie": "minecraft:entity/zombie/zombie",
    "creeper": "minecraft:entity/creeper/creeper",
    "piglin": "minecraft:entity/piglin/piglin",
}


@dataclass(frozen=True)
class ModelData:
    resource: str
    textures: dict[str, str]
    parents: tuple[str, ...]
    elements: tuple[dict, ...]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--jar",
        type=Path,
        default=None,
        help="Minecraft client jar path. Defaults to the installed 26.2 jar.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help=f"Output directory for generated icons. Default: {DEFAULT_OUTPUT_DIR}",
    )
    parser.add_argument(
        "--size",
        type=int,
        default=64,
        help="Generated icon size in pixels. Default: 64.",
    )
    parser.add_argument(
        "--clean",
        action="store_true",
        help="Delete the output directory before generating icons.",
    )
    parser.add_argument(
        "--external-icon-dir",
        type=Path,
        default=None,
        help="Optional directory of pre-rendered inventory PNGs keyed by item id. These icons are used before local rendering.",
    )
    return parser.parse_args()


def default_minecraft_home() -> Path:
    return Path.home() / "Library" / "Application Support" / "minecraft"


def find_default_jar() -> Path:
    version_jar = default_minecraft_home() / "versions" / DEFAULT_VERSION / f"{DEFAULT_VERSION}.jar"
    if version_jar.exists():
        return version_jar

    version_dir = default_minecraft_home() / "versions"
    jars = sorted(version_dir.glob("*/*.jar"), key=lambda path: path.stat().st_mtime, reverse=True)
    if not jars:
        raise FileNotFoundError(f"No Minecraft client jar found under {version_dir}")
    return jars[0]


def namespaced(value: str, default_namespace: str = "minecraft") -> tuple[str, str]:
    text = str(value or "").strip()
    if ":" in text:
        namespace, path = text.split(":", 1)
    else:
        namespace, path = default_namespace, text
    return namespace or default_namespace, path.lstrip("/")


def texture_path(value: str) -> str:
    namespace, path = namespaced(value)
    if path.startswith("textures/"):
        path = path.removeprefix("textures/")
    path = path.removesuffix(".png")
    return TEXTURE_PREFIX.format(namespace=namespace, path=path)


def model_path(value: str) -> str:
    namespace, path = namespaced(value)
    return MODEL_PREFIX.format(namespace=namespace, path=path)


def load_json(archive: zipfile.ZipFile, path: str) -> dict:
    with archive.open(path) as fp:
        return json.load(fp)


def load_model(archive: zipfile.ZipFile, resource: str, seen: set[str] | None = None) -> ModelData | None:
    seen = seen or set()
    if resource in seen:
        return None
    seen.add(resource)

    path = model_path(resource)
    if path not in archive.namelist():
        return None

    data = load_json(archive, path)
    textures: dict[str, str] = {}
    parents: list[str] = []
    elements: list[dict] = []

    parent = data.get("parent")
    if isinstance(parent, str):
        parent_data = load_model(archive, parent, seen)
        if parent_data:
            textures.update(parent_data.textures)
            parents.extend(parent_data.parents)
            elements.extend(parent_data.elements)
        parents.append(parent)

    raw_textures = data.get("textures")
    if isinstance(raw_textures, dict):
        for key, value in raw_textures.items():
            texture = texture_resource(value)
            if texture:
                textures[str(key)] = texture

    raw_elements = data.get("elements")
    if isinstance(raw_elements, list):
        elements = [element for element in raw_elements if isinstance(element, dict)]

    return ModelData(resource=resource, textures=textures, parents=tuple(parents), elements=tuple(elements))


def texture_resource(value: object) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        sprite = value.get("sprite")
        return sprite if isinstance(sprite, str) else ""
    return ""


def resolve_texture_ref(textures: dict[str, str], key: str, depth: int = 0) -> str:
    if depth > 12:
        return ""
    value = textures.get(key, "")
    if not value:
        return ""
    if value.startswith("#"):
        return resolve_texture_ref(textures, value[1:], depth + 1)
    return value


def find_model_node(node: object) -> dict | None:
    if not isinstance(node, dict):
        return None

    node_type = str(node.get("type") or "")
    if node_type == "minecraft:model" and isinstance(node.get("model"), str):
        return node

    if node_type == "minecraft:special" and isinstance(node.get("base"), str):
        return {"type": "minecraft:model", "model": node["base"]}

    for key in ("fallback", "on_false", "on_true"):
        child = find_model_node(node.get(key))
        if child:
            return child

    for entry in node.get("entries") or ():
        child = find_model_node(entry.get("model") if isinstance(entry, dict) else None)
        if child:
            return child

    for child_node in node.get("models") or ():
        child = find_model_node(child_node)
        if child:
            return child

    for case in node.get("cases") or ():
        child = find_model_node(case.get("model") if isinstance(case, dict) else None)
        if child:
            return child

    return None


def find_special_node(node: object) -> dict | None:
    if not isinstance(node, dict):
        return None

    node_type = str(node.get("type") or "")
    if node_type == "minecraft:special" and isinstance(node.get("model"), dict):
        return node

    for key in ("fallback", "on_false", "on_true"):
        child = find_special_node(node.get(key))
        if child:
            return child

    for entry in node.get("entries") or ():
        child = find_special_node(entry.get("model") if isinstance(entry, dict) else None)
        if child:
            return child

    for child_node in node.get("models") or ():
        child = find_special_node(child_node)
        if child:
            return child

    for case in node.get("cases") or ():
        child = find_special_node(case.get("model") if isinstance(case, dict) else None)
        if child:
            return child

    return None


def color_from_minecraft_int(value: object) -> tuple[int, int, int] | None:
    if not isinstance(value, int):
        return None
    color = value & 0xFFFFFF
    return (color >> 16) & 0xFF, (color >> 8) & 0xFF, color & 0xFF


def tint_image(image: Image.Image, color: tuple[int, int, int]) -> Image.Image:
    tinted = image.convert("RGBA")
    pixels = tinted.load()
    for y in range(tinted.height):
        for x in range(tinted.width):
            r, g, b, a = pixels[x, y]
            if a:
                pixels[x, y] = (
                    round(r * color[0] / 255),
                    round(g * color[1] / 255),
                    round(b * color[2] / 255),
                    a,
                )
    return tinted


def load_texture(archive: zipfile.ZipFile, resource: str) -> Image.Image | None:
    path = texture_path(resource)
    if path not in archive.namelist():
        return None
    return Image.open(io.BytesIO(archive.read(path))).convert("RGBA")


def resize_icon(image: Image.Image, size: int) -> Image.Image:
    if image.width == size and image.height == size:
        return image.convert("RGBA")
    return image.convert("RGBA").resize((size, size), Image.Resampling.NEAREST)


def fit_icon(image: Image.Image, size: int, padding: int = 2) -> Image.Image:
    source = image.convert("RGBA")
    target = max(1, size - padding * 2)
    scale = min(target / source.width, target / source.height)
    width = max(1, round(source.width * scale))
    height = max(1, round(source.height * scale))
    icon = source.resize((width, height), Image.Resampling.NEAREST)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(icon, ((size - width) // 2, (size - height) // 2))
    return canvas


def load_external_icon_map(icon_dir: Path | None) -> dict[str, Path]:
    if icon_dir is None or not icon_dir.exists():
        return {}
    icons: dict[str, Path] = {}
    for path in sorted(icon_dir.rglob("*.png")):
        item_id = path.stem.strip().lower()
        if not item_id or "__" in item_id:
            continue
        icons.setdefault(item_id, path)
    return icons


def load_external_icon(external_icons: dict[str, Path], item_id: str, size: int) -> Image.Image | None:
    if item_id.endswith("_banner_pattern"):
        return None
    path = external_icons.get(item_id.lower())
    if path is None:
        return None
    try:
        return fit_icon(Image.open(path).convert("RGBA"), size, padding=0)
    except OSError:
        return None


def shade_rgb(color: tuple[int, int, int], factor: float) -> tuple[int, int, int]:
    return (
        max(0, min(255, round(color[0] * factor))),
        max(0, min(255, round(color[1] * factor))),
        max(0, min(255, round(color[2] * factor))),
    )


def normalize_special_key(value: object) -> str:
    namespace, path = namespaced(str(value or ""))
    return path.rsplit("/", 1)[-1].removesuffix(".png").lower()


def compose_shield_icon(size: int) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    factor = size / 32

    def p(points: list[tuple[float, float]]) -> list[tuple[int, int]]:
        return [(round(x * factor), round(y * factor)) for x, y in points]

    outline = (46, 47, 53, 255)
    rim = (126, 128, 137, 255)
    rim_dark = (85, 86, 94, 255)
    wood = (105, 78, 40, 255)
    wood_light = (134, 104, 59, 255)
    wood_dark = (72, 50, 23, 255)
    draw.polygon(p([(10, 2), (22, 2), (27, 7), (27, 18), (16, 30), (5, 18), (5, 7)]), fill=outline)
    draw.polygon(p([(11, 3), (21, 3), (26, 8), (26, 17), (16, 28), (6, 17), (6, 8)]), fill=rim)
    draw.polygon(p([(12, 5), (20, 5), (24, 9), (24, 16), (16, 25), (8, 16), (8, 9)]), fill=wood)
    draw.polygon(p([(12, 5), (16, 5), (16, 25), (8, 16), (8, 9)]), fill=wood_light)
    draw.polygon(p([(17, 5), (20, 5), (24, 9), (24, 16), (17, 24)]), fill=wood_dark)
    draw.rectangle([round(14 * factor), round(4 * factor), round(18 * factor), round(25 * factor)], fill=rim_dark)
    draw.rectangle([round(15 * factor), round(4 * factor), round(17 * factor), round(24 * factor)], fill=rim)
    return canvas


def compose_chest_icon(texture_key: str, size: int) -> Image.Image:
    base, dark, accent = CHEST_COLORS.get(texture_key, CHEST_COLORS["normal"])
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    factor = size / 32

    def box(values: tuple[float, float, float, float]) -> tuple[int, int, int, int]:
        return tuple(round(value * factor) for value in values)

    outline = (*shade_rgb(dark, 0.62), 255)
    top = (*shade_rgb(base, 1.16), 255)
    body = (*base, 255)
    side = (*shade_rgb(base, 0.82), 255)
    low = (*dark, 255)
    draw.rectangle(box((4, 7, 28, 25)), fill=outline)
    draw.rectangle(box((5, 8, 27, 14)), fill=top)
    draw.rectangle(box((5, 15, 27, 24)), fill=body)
    draw.rectangle(box((5, 15, 9, 24)), fill=side)
    draw.rectangle(box((23, 15, 27, 24)), fill=side)
    draw.line([box((5, 14, 27, 14))[0], box((5, 14, 27, 14))[1], box((5, 14, 27, 14))[2], box((5, 14, 27, 14))[3]], fill=low, width=max(1, round(2 * factor)))
    draw.rectangle(box((14, 13, 18, 20)), fill=outline)
    draw.rectangle(box((15, 14, 17, 18)), fill=(*accent, 255))
    draw.point((round(16 * factor), round(17 * factor)), fill=outline)
    if texture_key == "trapped":
        draw.line([round(6 * factor), round(10 * factor), round(26 * factor), round(10 * factor)], fill=(186, 39, 36, 255), width=max(1, round(factor)))
    return canvas


def compose_banner_icon(color_name: str, size: int) -> Image.Image:
    base = DYE_COLORS.get(color_name, DYE_COLORS["white"])
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    factor = size / 32

    def xy(x: float, y: float) -> tuple[int, int]:
        return round(x * factor), round(y * factor)

    pole = (92, 69, 39, 255)
    pole_dark = (56, 42, 25, 255)
    outline = (*shade_rgb(base, 0.48), 255)
    fill = (*base, 255)
    light = (*shade_rgb(base, 1.12), 255)
    dark = (*shade_rgb(base, 0.76), 255)
    draw.rectangle((*xy(22, 3), *xy(25, 29)), fill=pole_dark)
    draw.rectangle((*xy(23, 3), *xy(24, 29)), fill=pole)
    draw.rectangle((*xy(20, 3), *xy(27, 5)), fill=pole_dark)
    flag = [xy(7, 5), xy(22, 5), xy(22, 23), xy(18, 27), xy(14.5, 23), xy(11, 27), xy(7, 23)]
    draw.polygon(flag, fill=outline)
    inner = [xy(8, 6), xy(21, 6), xy(21, 22), xy(18, 24.5), xy(14.5, 21.5), xy(11, 24.5), xy(8, 22)]
    draw.polygon(inner, fill=fill)
    draw.polygon([xy(8, 6), xy(14.5, 6), xy(14.5, 21.5), xy(11, 24.5), xy(8, 22)], fill=light)
    draw.polygon([xy(15.5, 6), xy(21, 6), xy(21, 22), xy(18, 24.5), xy(15.5, 21.8)], fill=dark)
    return canvas


def compose_head_icon(archive: zipfile.ZipFile, kind: str, size: int) -> Image.Image | None:
    if kind == "dragon":
        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        draw = ImageDraw.Draw(canvas)
        factor = size / 32

        def box(values: tuple[float, float, float, float]) -> tuple[int, int, int, int]:
            return tuple(round(value * factor) for value in values)

        draw.rectangle(box((6, 8, 26, 23)), fill=(24, 20, 31, 255), outline=(8, 7, 12, 255))
        draw.rectangle(box((9, 5, 12, 9)), fill=(209, 199, 178, 255))
        draw.rectangle(box((20, 5, 23, 9)), fill=(209, 199, 178, 255))
        draw.rectangle(box((9, 13, 13, 15)), fill=(161, 111, 208, 255))
        draw.rectangle(box((19, 13, 23, 15)), fill=(161, 111, 208, 255))
        draw.rectangle(box((12, 19, 20, 21)), fill=(88, 79, 98, 255))
        return canvas

    texture = HEAD_TEXTURES.get(kind)
    if not texture:
        return None
    source = load_texture(archive, texture)
    if source is None or source.width < 16 or source.height < 16:
        return None
    face = source.crop((8, 8, 16, 16)).convert("RGBA")
    if source.width >= 48 and source.height >= 16:
        overlay = source.crop((40, 8, 48, 16)).convert("RGBA")
        face.alpha_composite(overlay)
    face_size = max(8, round(size * 0.66))
    face = face.resize((face_size, face_size), Image.Resampling.NEAREST)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    x = (size - face_size) // 2
    y = round(size * 0.2)
    draw.rectangle((x - 1, y - 1, x + face_size, y + face_size), fill=(35, 35, 35, 255))
    canvas.alpha_composite(face, (x, y))
    draw.rectangle((x + 2, y + face_size, x + face_size - 3, min(size - 2, y + face_size + 2)), fill=(0, 0, 0, 80))
    return canvas


def compose_decorated_pot_icon(size: int) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    factor = size / 32

    def p(points: list[tuple[float, float]]) -> list[tuple[int, int]]:
        return [(round(x * factor), round(y * factor)) for x, y in points]

    outline = (69, 38, 32, 255)
    clay = (148, 83, 68, 255)
    clay_light = (159, 89, 73, 255)
    clay_dark = (117, 66, 54, 255)
    draw.polygon(p([(9, 7), (23, 7), (25, 11), (23, 26), (20, 29), (12, 29), (9, 26), (7, 11)]), fill=outline)
    draw.rectangle((round(11 * factor), round(4 * factor), round(21 * factor), round(8 * factor)), fill=outline)
    draw.rectangle((round(12 * factor), round(5 * factor), round(20 * factor), round(7 * factor)), fill=clay_light)
    draw.polygon(p([(10, 9), (22, 9), (23, 12), (21, 26), (18, 27), (13, 27), (10, 25), (9, 12)]), fill=clay)
    draw.polygon(p([(10, 9), (15, 9), (15, 27), (13, 27), (10, 25), (9, 12)]), fill=clay_light)
    draw.polygon(p([(17, 9), (22, 9), (23, 12), (21, 26), (18, 27), (17, 27)]), fill=clay_dark)
    draw.rectangle((round(13 * factor), round(13 * factor), round(19 * factor), round(20 * factor)), outline=outline)
    return canvas


def compose_copper_golem_statue_icon(item_id: str, size: int) -> Image.Image:
    key = item_id.removeprefix("waxed_").removesuffix("_golem_statue")
    if key == "copper":
        base = (202, 112, 76)
    elif key == "exposed_copper":
        base = (166, 124, 103)
    elif key == "weathered_copper":
        base = (102, 151, 133)
    elif key == "oxidized_copper":
        base = (82, 169, 145)
    else:
        base = (202, 112, 76)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    factor = size / 32

    def box(values: tuple[float, float, float, float]) -> tuple[int, int, int, int]:
        return tuple(round(value * factor) for value in values)

    outline = (*shade_rgb(base, 0.5), 255)
    fill = (*base, 255)
    light = (*shade_rgb(base, 1.18), 255)
    dark = (*shade_rgb(base, 0.78), 255)
    draw.rectangle(box((11, 5, 21, 14)), fill=outline)
    draw.rectangle(box((12, 6, 20, 13)), fill=fill)
    draw.rectangle(box((13, 8, 15, 10)), fill=(59, 64, 47, 255))
    draw.rectangle(box((17, 8, 19, 10)), fill=(59, 64, 47, 255))
    draw.rectangle(box((10, 15, 22, 25)), fill=outline)
    draw.rectangle(box((12, 15, 20, 24)), fill=fill)
    draw.rectangle(box((12, 15, 15, 24)), fill=light)
    draw.rectangle(box((18, 15, 20, 24)), fill=dark)
    draw.rectangle(box((8, 17, 11, 22)), fill=outline)
    draw.rectangle(box((21, 17, 24, 22)), fill=outline)
    draw.rectangle(box((12, 25, 15, 29)), fill=outline)
    draw.rectangle(box((17, 25, 20, 29)), fill=outline)
    return canvas


def compose_block_item_icon(archive: zipfile.ZipFile, item_id: str, size: int) -> Image.Image | None:
    model = load_model(archive, f"minecraft:block/{item_id}")
    if model is None:
        return None
    return compose_block_icon(archive, model, size) or compose_particle_icon(archive, model, size)


def render_special_icon(
    archive: zipfile.ZipFile,
    item_id: str,
    special_node: dict | None,
    size: int,
) -> Image.Image | None:
    if not special_node:
        return None
    special_model = special_node.get("model")
    if not isinstance(special_model, dict):
        return None
    special_type = str(special_model.get("type") or "")

    if special_type == "minecraft:shield":
        return compose_shield_icon(size)

    if special_type == "minecraft:banner":
        color_name = normalize_special_key(special_model.get("color")) or item_id.removesuffix("_banner")
        return compose_banner_icon(color_name, size)

    if special_type == "minecraft:chest":
        texture_key = normalize_special_key(special_model.get("texture") or "minecraft:normal")
        return compose_chest_icon(texture_key, size)

    if special_type == "minecraft:shulker_box":
        return compose_block_item_icon(archive, item_id, size)

    if special_type == "minecraft:player_head":
        return compose_head_icon(archive, "player", size)

    if special_type == "minecraft:head":
        return compose_head_icon(archive, normalize_special_key(special_model.get("kind")), size)

    if special_type == "minecraft:decorated_pot":
        return compose_decorated_pot_icon(size)

    if special_type == "minecraft:conduit":
        conduit = load_texture(archive, "minecraft:block/conduit") or load_texture(archive, "minecraft:entity/conduit/base")
        return fit_icon(conduit, size, padding=2) if conduit else None

    if special_type == "minecraft:copper_golem_statue":
        return compose_copper_golem_statue_icon(item_id, size)

    return None


def compose_item_layers(
    archive: zipfile.ZipFile,
    model: ModelData,
    tints: list[object],
    size: int,
) -> Image.Image | None:
    layers: list[tuple[int, str]] = []
    for key, value in model.textures.items():
        if not key.startswith("layer"):
            continue
        try:
            index = int(key.removeprefix("layer"))
        except ValueError:
            continue
        texture = resolve_texture_ref(model.textures, key) or value
        if texture:
            layers.append((index, texture))

    if not layers:
        return None

    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    for index, texture in sorted(layers):
        image = load_texture(archive, texture)
        if image is None:
            continue
        if index < len(tints) and isinstance(tints[index], dict):
            color = color_from_minecraft_int(tints[index].get("default"))
            if color:
                image = tint_image(image, color)
        canvas.alpha_composite(resize_icon(image, size))
    return canvas


def shade(color: tuple[int, int, int, int], factor: float) -> tuple[int, int, int, int]:
    r, g, b, a = color
    return (round(r * factor), round(g * factor), round(b * factor), a)


def point_in_parallelogram(
    origin: tuple[float, float],
    axis_u: tuple[float, float],
    axis_v: tuple[float, float],
    u: float,
    v: float,
    scale: int,
) -> tuple[int, int]:
    return (
        round((origin[0] + axis_u[0] * u + axis_v[0] * v) * scale),
        round((origin[1] + axis_u[1] * u + axis_v[1] * v) * scale),
    )


def draw_textured_face(
    canvas: Image.Image,
    texture: Image.Image,
    origin: tuple[float, float],
    axis_u: tuple[float, float],
    axis_v: tuple[float, float],
    brightness: float,
    scale: int,
) -> None:
    source = texture.convert("RGBA").resize((16, 16), Image.Resampling.NEAREST)
    draw = ImageDraw.Draw(canvas)
    pixels = source.load()
    for y in range(16):
        for x in range(16):
            color = pixels[x, y]
            if color[3] == 0:
                continue
            polygon = [
                point_in_parallelogram(origin, axis_u, axis_v, x / 16, y / 16, scale),
                point_in_parallelogram(origin, axis_u, axis_v, (x + 1) / 16, y / 16, scale),
                point_in_parallelogram(origin, axis_u, axis_v, (x + 1) / 16, (y + 1) / 16, scale),
                point_in_parallelogram(origin, axis_u, axis_v, x / 16, (y + 1) / 16, scale),
            ]
            draw.polygon(polygon, fill=shade(color, brightness))


def coerce_float_triplet(value: object) -> tuple[float, float, float] | None:
    if not isinstance(value, list) or len(value) != 3:
        return None
    try:
        return float(value[0]), float(value[1]), float(value[2])
    except (TypeError, ValueError):
        return None


def coerce_uv(value: object) -> tuple[float, float, float, float]:
    if not isinstance(value, list) or len(value) != 4:
        return 0.0, 0.0, 16.0, 16.0
    try:
        return float(value[0]), float(value[1]), float(value[2]), float(value[3])
    except (TypeError, ValueError):
        return 0.0, 0.0, 16.0, 16.0


def block_projection(point: tuple[float, float, float]) -> tuple[float, float]:
    x, y, z = point
    return (x - z) * 0.92, (x + z) * 0.46 - y * 0.86


def element_corners(start: tuple[float, float, float], end: tuple[float, float, float]) -> tuple[tuple[float, float, float], ...]:
    x1, y1, z1 = start
    x2, y2, z2 = end
    return (
        (x1, y1, z1),
        (x1, y1, z2),
        (x1, y2, z1),
        (x1, y2, z2),
        (x2, y1, z1),
        (x2, y1, z2),
        (x2, y2, z1),
        (x2, y2, z2),
    )


def element_face_points(
    direction: str,
    start: tuple[float, float, float],
    end: tuple[float, float, float],
) -> tuple[tuple[float, float, float], ...]:
    x1, y1, z1 = start
    x2, y2, z2 = end
    faces = {
        "up": ((x1, y2, z1), (x2, y2, z1), (x2, y2, z2), (x1, y2, z2)),
        "down": ((x1, y1, z2), (x2, y1, z2), (x2, y1, z1), (x1, y1, z1)),
        "north": ((x2, y2, z1), (x1, y2, z1), (x1, y1, z1), (x2, y1, z1)),
        "south": ((x1, y2, z2), (x2, y2, z2), (x2, y1, z2), (x1, y1, z2)),
        "west": ((x1, y2, z1), (x1, y2, z2), (x1, y1, z2), (x1, y1, z1)),
        "east": ((x2, y2, z2), (x2, y2, z1), (x2, y1, z1), (x2, y1, z2)),
    }
    return faces.get(direction, ())


def draw_textured_quad(
    canvas: Image.Image,
    texture: Image.Image,
    points: tuple[tuple[float, float], tuple[float, float], tuple[float, float], tuple[float, float]],
    uv: tuple[float, float, float, float],
    brightness: float,
    scale: int,
) -> None:
    source = texture.convert("RGBA")
    pixels = source.load()
    draw = ImageDraw.Draw(canvas)
    u1, v1, u2, v2 = uv
    p0, p1, p2, p3 = points

    def lerp(a: float, b: float, value: float) -> float:
        return a + (b - a) * value

    def point_at(u: float, v: float) -> tuple[int, int]:
        top_x = lerp(p0[0], p1[0], u)
        top_y = lerp(p0[1], p1[1], u)
        bottom_x = lerp(p3[0], p2[0], u)
        bottom_y = lerp(p3[1], p2[1], u)
        return round(lerp(top_x, bottom_x, v) * scale), round(lerp(top_y, bottom_y, v) * scale)

    for y in range(16):
        for x in range(16):
            sample_u = u1 + (u2 - u1) * ((x + 0.5) / 16)
            sample_v = v1 + (v2 - v1) * ((y + 0.5) / 16)
            tx = max(0, min(source.width - 1, int(sample_u / 16 * source.width)))
            ty = max(0, min(source.height - 1, int(sample_v / 16 * source.height)))
            color = pixels[tx, ty]
            if color[3] == 0:
                continue
            polygon = [
                point_at(x / 16, y / 16),
                point_at((x + 1) / 16, y / 16),
                point_at((x + 1) / 16, (y + 1) / 16),
                point_at(x / 16, (y + 1) / 16),
            ]
            draw.polygon(polygon, fill=shade(color, brightness))


def first_texture(model: ModelData, keys: tuple[str, ...]) -> str:
    for key in keys:
        texture = resolve_texture_ref(model.textures, key)
        if texture:
            return texture
    return ""


def compose_element_block_icon(archive: zipfile.ZipFile, model: ModelData, size: int) -> Image.Image | None:
    if not model.elements:
        return None

    element_bounds: list[tuple[tuple[float, float, float], tuple[float, float, float]]] = []
    all_projected: list[tuple[float, float]] = []
    for element in model.elements:
        start = coerce_float_triplet(element.get("from"))
        end = coerce_float_triplet(element.get("to"))
        if start is None or end is None:
            continue
        low = tuple(min(start[index], end[index]) for index in range(3))
        high = tuple(max(start[index], end[index]) for index in range(3))
        element_bounds.append((low, high))
        all_projected.extend(block_projection(corner) for corner in element_corners(low, high))

    if not element_bounds or not all_projected:
        return None

    min_x = min(point[0] for point in all_projected)
    max_x = max(point[0] for point in all_projected)
    min_y = min(point[1] for point in all_projected)
    max_y = max(point[1] for point in all_projected)
    width = max_x - min_x
    height = max_y - min_y
    if width <= 0 or height <= 0:
        return None

    padding = 2
    fit = min((size - padding * 2) / width, (size - padding * 2) / height)
    offset_x = padding + ((size - padding * 2) - width * fit) / 2 - min_x * fit
    offset_y = padding + ((size - padding * 2) - height * fit) / 2 - min_y * fit

    def project(point: tuple[float, float, float]) -> tuple[float, float]:
        x, y = block_projection(point)
        return x * fit + offset_x, y * fit + offset_y

    visible_directions = {"north", "east", "up"}
    face_order = {"east": 0, "north": 1, "up": 2}
    brightness = {
        "up": 1.0,
        "south": 0.82,
        "east": 0.7,
        "north": 0.58,
        "west": 0.64,
    }
    faces_to_draw: list[tuple[float, int, str, tuple[tuple[float, float], ...], Image.Image, tuple[float, float, float, float]]] = []

    for element, (start, end) in zip(model.elements, element_bounds):
        raw_faces = element.get("faces")
        if not isinstance(raw_faces, dict):
            continue
        for direction, raw_face in raw_faces.items():
            if direction not in visible_directions or not isinstance(raw_face, dict):
                continue
            points_3d = element_face_points(str(direction), start, end)
            if not points_3d:
                continue
            texture_ref = texture_resource(raw_face.get("texture"))
            if texture_ref.startswith("#"):
                texture_ref = resolve_texture_ref(model.textures, texture_ref[1:])
            elif texture_ref:
                texture_ref = resolve_texture_ref({"texture": texture_ref}, "texture")
            if not texture_ref:
                continue
            texture = load_texture(archive, texture_ref)
            if texture is None:
                continue
            points_2d = tuple(project(point) for point in points_3d)
            depth = sum(point[0] + point[2] + point[1] * 0.02 for point in points_3d) / len(points_3d)
            faces_to_draw.append(
                (
                    depth,
                    face_order.get(str(direction), 0),
                    str(direction),
                    points_2d,
                    texture,
                    coerce_uv(raw_face.get("uv")),
                )
            )

    if not faces_to_draw:
        return None

    scale = 4
    canvas = Image.new("RGBA", (size * scale, size * scale), (0, 0, 0, 0))
    for _, _, direction, points, texture, uv in sorted(faces_to_draw, key=lambda item: (item[1], item[0])):
        draw_textured_quad(canvas, texture, points, uv, brightness.get(direction, 0.72), scale)
    return canvas.resize((size, size), Image.Resampling.NEAREST)


def compose_block_icon(archive: zipfile.ZipFile, model: ModelData, size: int) -> Image.Image | None:
    element_icon = compose_element_block_icon(archive, model, size)
    if element_icon is not None:
        return element_icon

    top_texture_name = first_texture(model, ("top", "up", "end", "all", "particle", "side", "texture", "cross", "plant"))
    side_texture_name = first_texture(model, ("side", "north", "east", "south", "west", "all", "particle", "texture", "cross", "plant"))
    if not top_texture_name and not side_texture_name:
        return None

    top_texture = load_texture(archive, top_texture_name or side_texture_name)
    side_texture = load_texture(archive, side_texture_name or top_texture_name)
    if top_texture is None and side_texture is None:
        return None
    if top_texture is None:
        return resize_icon(side_texture, size)
    if side_texture is None:
        return resize_icon(top_texture, size)

    scale = 4
    canvas = Image.new("RGBA", (size * scale, size * scale), (0, 0, 0, 0))
    factor = size / 32

    def p(x: float, y: float) -> tuple[float, float]:
        return x * factor, y * factor

    draw_textured_face(canvas, side_texture, p(3, 9), p(13, 7), p(0, 14), 0.68, scale)
    draw_textured_face(canvas, side_texture, p(16, 16), p(13, -7), p(0, 14), 0.86, scale)
    draw_textured_face(canvas, top_texture, p(16, 2), p(13, 7), p(-13, 7), 1.0, scale)
    return canvas.resize((size, size), Image.Resampling.NEAREST)


def compose_particle_icon(archive: zipfile.ZipFile, model: ModelData, size: int) -> Image.Image | None:
    texture_name = first_texture(
        model,
        (
            "particle",
            "texture",
            "all",
            "side",
            "top",
            "up",
            "end",
            "cross",
            "plant",
            "layer0",
        ),
    )
    image = load_texture(archive, texture_name) if texture_name else None
    if image is None:
        return None
    return resize_icon(image, size)


def compose_direct_texture_icon(archive: zipfile.ZipFile, model: ModelData, size: int) -> Image.Image | None:
    parent_text = " ".join(model.parents + (model.resource,))
    direct_parent_markers = (
        "block/cube_all",
        "block/cross",
        "block/tinted_cross",
    )
    if not any(marker in parent_text for marker in direct_parent_markers):
        return None

    texture_name = first_texture(
        model,
        (
            "layer0",
            "all",
            "side",
            "cross",
            "plant",
            "flower",
            "texture",
            "particle",
            "top",
            "up",
            "end",
        ),
    )
    image = load_texture(archive, texture_name) if texture_name else None
    if image is None:
        return None
    return resize_icon(image, size)


def render_model_icon(
    archive: zipfile.ZipFile,
    model: ModelData,
    tints: list[object],
    size: int,
) -> Image.Image | None:
    parent_text = " ".join(model.parents + (model.resource,))
    if any(key.startswith("layer") for key in model.textures):
        return compose_item_layers(archive, model, tints, size)
    if "/block/" in parent_text or ":block/" in parent_text or model.resource.startswith("minecraft:block/"):
        return compose_block_icon(archive, model, size) or compose_particle_icon(archive, model, size)
    return compose_particle_icon(archive, model, size)


def build_icons(jar_path: Path, output_dir: Path, size: int, clean: bool, external_icon_dir: Path | None = None) -> dict:
    if clean and output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    external_icons = load_external_icon_map(external_icon_dir)

    manifest = {
        "source": str(jar_path),
        "size": size,
        "external_icon_dir": str(external_icon_dir) if external_icon_dir else "",
        "external_icons": len(external_icons),
        "external_used": [],
        "items": {},
        "missing": [],
    }

    with zipfile.ZipFile(jar_path) as archive:
        item_paths = sorted(
            name
            for name in archive.namelist()
            if name.startswith(ITEM_DEFINITION_PREFIX) and name.endswith(".json")
        )

        for item_path in item_paths:
            item_id = Path(item_path).stem
            if item_id == "air":
                continue
            external_image = load_external_icon(external_icons, item_id, size)
            if external_image is not None:
                output_name = f"{item_id}.png"
                external_image.save(output_dir / output_name, optimize=True)
                manifest["items"][item_id] = output_name
                manifest["external_used"].append(item_id)
                continue
            item_data = load_json(archive, item_path)
            special_node = find_special_node(item_data.get("model"))
            image = render_special_icon(archive, item_id, special_node, size)
            if image is not None:
                output_name = f"{item_id}.png"
                image.save(output_dir / output_name, optimize=True)
                manifest["items"][item_id] = output_name
                continue

            model_node = find_model_node(item_data.get("model"))
            if not model_node:
                manifest["missing"].append(item_id)
                continue

            model_resource = model_node.get("model")
            if not isinstance(model_resource, str):
                manifest["missing"].append(item_id)
                continue

            model = load_model(archive, model_resource)
            if not model:
                manifest["missing"].append(item_id)
                continue

            tints = model_node.get("tints")
            image = render_model_icon(archive, model, tints if isinstance(tints, list) else [], size)
            if image is None:
                manifest["missing"].append(item_id)
                continue

            output_name = f"{item_id}.png"
            image.save(output_dir / output_name, optimize=True)
            manifest["items"][item_id] = output_name

    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
    return manifest


def main() -> None:
    args = parse_args()
    jar_path = args.jar or find_default_jar()
    manifest = build_icons(jar_path, args.output_dir, args.size, args.clean, args.external_icon_dir)
    print(
        "Generated {generated} Minecraft item icons in {output} ({missing} missing, {external} external).".format(
            generated=len(manifest["items"]),
            output=args.output_dir,
            missing=len(manifest["missing"]),
            external=len(manifest["external_used"]),
        )
    )


if __name__ == "__main__":
    main()
