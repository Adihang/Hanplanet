import html
import re
from urllib.parse import unquote, urlparse

from django.db import migrations, models
import portfolio.models


LEADING_URL_BLOCK_RE = re.compile(
    r"\A\s*\*\*(?P<label>GitHub|서비스 URL|Service URL)\*\*\s*:\s*"
    r"(?:\r?\n)+\s*"
    r"<a\b[^>]*\bhref\s*=\s*['\"]\s*(?P<url>https?://[^'\"]+?)\s*['\"][^>]*>.*?</a>\s*"
    r"(?:\r?\n)+\*\*\*\s*",
    re.IGNORECASE | re.DOTALL,
)
ROOTI_STORE_LINK_RE = re.compile(
    r"\s*<a\b[^>]*\bhref\s*=\s*['\"]\s*"
    r"(?P<url>https://play\.google\.com/store/apps/details\?id=com\.hivits\.rooti[^'\"]*)"
    r"\s*['\"][^>]*>\s*(?P<label>[^<]+?)\s*</a>\s*",
    re.IGNORECASE | re.DOTALL,
)
IMG_TAG_RE = re.compile(r"<img\b[^>]*\bsrc\s*=\s*['\"](?P<src>[^'\"]+)['\"][^>]*>", re.IGNORECASE | re.DOTALL)
ALT_ATTR_RE = re.compile(r"\balt\s*=\s*(['\"])(?P<alt>.*?)\1", re.IGNORECASE | re.DOTALL)
IMAGE_CONTAINER_RES = [
    re.compile(r"\s*<div\b[^>]*display\s*:\s*flex[^>]*>.*?<img\b.*?</div>\s*", re.IGNORECASE | re.DOTALL),
    re.compile(r"\s*<div\b[^>]*text-align\s*:\s*center[^>]*>.*?<img\b.*?</div>\s*", re.IGNORECASE | re.DOTALL),
    re.compile(r"\s*<p\b[^>]*align\s*=\s*['\"]center['\"][^>]*>.*?<img\b.*?</p>\s*", re.IGNORECASE | re.DOTALL),
]
PROJECT_OUTPUT_EMPTY_RE = re.compile(
    r"\*\*(?:프로젝트 결과물|Project Deliverables|Project Output)\*\*\s*(?:\r?\n)+\*\*\*\s*",
    re.IGNORECASE,
)
HTML_COMMENT_RE = re.compile(r"\s*<!--.*?-->\s*", re.DOTALL)


def _clean_markdown_spacing(value):
    value = re.sub(r"[ \t]+\n", "\n", value or "")
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()


def _normalize_project_url(url):
    cleaned = html.unescape(str(url or "")).strip()
    match = re.match(r"^(https?://(?:www\.)?hanplanet\.com)/(?:ko|en)(/handrive(?:/|$).*)$", cleaned, re.IGNORECASE)
    if match:
        return f"{match.group(1)}{match.group(2)}"
    return cleaned


def _normalize_project_url_label(label):
    cleaned = re.sub(r"\s+", " ", html.unescape(str(label or ""))).strip()
    if cleaned in {"서비스 URL", "Service URL"}:
        return ""
    return cleaned


def _extract_leading_url_block(content):
    match = LEADING_URL_BLOCK_RE.match(content or "")
    if not match:
        return None, None, content or ""
    label = _normalize_project_url_label(match.group("label"))
    url = _normalize_project_url(match.group("url"))
    return label, url, _clean_markdown_spacing((content or "")[match.end() :])


def _extract_rooti_store_link(content):
    match = ROOTI_STORE_LINK_RE.search(content or "")
    if not match:
        return None, None, content or ""
    label = re.sub(r"\s+", " ", html.unescape(match.group("label"))).strip()
    url = _normalize_project_url(match.group("url"))
    updated = f"{(content or '')[:match.start()]}\n{(content or '')[match.end():]}"
    return label, url, _clean_markdown_spacing(updated)


def _image_alt_from_tag(tag):
    match = ALT_ATTR_RE.search(tag or "")
    if not match:
        return ""
    return re.sub(r"\s+", " ", html.unescape(match.group("alt"))).strip()


def _extract_image_items(*contents):
    items = []
    seen = set()
    for content in contents:
        for match in IMG_TAG_RE.finditer(content or ""):
            src = html.unescape(match.group("src") or "").strip()
            if not src or src.startswith("data:") or src in seen:
                continue
            seen.add(src)
            items.append({"src": src, "alt": _image_alt_from_tag(match.group(0))})
    return items


def _image_fields_from_src(src):
    parsed = urlparse(src)
    if parsed.scheme in {"http", "https"}:
        return "", src
    path = unquote(parsed.path or src).strip()
    if path.startswith("/media/"):
        return path[len("/media/") :].lstrip("/"), ""
    if path.startswith("media/"):
        return path[len("media/") :].lstrip("/"), ""
    return path.lstrip("/"), ""


def _remove_image_markup(content):
    updated = content or ""
    for pattern in IMAGE_CONTAINER_RES:
        updated = pattern.sub("\n", updated)
    updated = IMG_TAG_RE.sub("", updated)
    updated = HTML_COMMENT_RE.sub("\n", updated)
    updated = PROJECT_OUTPUT_EMPTY_RE.sub("", updated)
    return _clean_markdown_spacing(updated)


def migrate_project_content_assets(apps, schema_editor):
    PortfolioProject = apps.get_model("portfolio", "PortfolioProject")
    PortfolioProjectImage = apps.get_model("portfolio", "PortfolioProjectImage")

    for project in PortfolioProject.objects.all().order_by("id"):
        content = project.content or ""
        content_en = project.content_en or ""
        image_items = _extract_image_items(content, content_en)
        url_candidates = []

        for field_name, source in (("content", content), ("content_en", content_en)):
            label, url, updated = _extract_leading_url_block(source)
            if url:
                url_candidates.append((label, url))
            if field_name == "content":
                content = updated
            else:
                content_en = updated

        for field_name, source in (("content", content), ("content_en", content_en)):
            label, url, updated = _extract_rooti_store_link(source)
            if url:
                url_candidates.append((label, url))
            if field_name == "content":
                content = updated
            else:
                content_en = updated

        content = _remove_image_markup(content)
        content_en = _remove_image_markup(content_en)

        changed_fields = []
        if content != (project.content or ""):
            project.content = content
            changed_fields.append("content")
        if content_en != (project.content_en or ""):
            project.content_en = content_en
            changed_fields.append("content_en")

        if not project.project_url:
            for label, url in url_candidates:
                if not url:
                    continue
                project.project_url = url[:500]
                changed_fields.append("project_url")
                if label and not project.project_url_name:
                    project.project_url_name = label[:120]
                    changed_fields.append("project_url_name")
                break
        elif not project.project_url_name:
            for label, _url in url_candidates:
                if label:
                    project.project_url_name = label[:120]
                    changed_fields.append("project_url_name")
                    break

        if changed_fields:
            project.save(update_fields=sorted(set(changed_fields)))

        if not image_items:
            continue

        existing_keys = set()
        max_order = 0
        for saved_image in PortfolioProjectImage.objects.filter(project=project):
            max_order = max(max_order, saved_image.order or 0)
            if saved_image.external_url:
                existing_keys.add(saved_image.external_url)
            if saved_image.image:
                existing_keys.add(saved_image.image.name)
                existing_keys.add(f"/media/{saved_image.image.name}")

        next_order = max_order + 1
        for item in image_items:
            image_name, external_url = _image_fields_from_src(item["src"])
            unique_key = external_url or image_name
            if not unique_key or unique_key in existing_keys:
                continue
            PortfolioProjectImage.objects.create(
                project=project,
                image=image_name,
                external_url=external_url,
                order=next_order,
                alt_text=(item["alt"] or project.title or "")[:255],
            )
            existing_keys.add(unique_key)
            next_order += 1


class Migration(migrations.Migration):

    dependencies = [
        ("portfolio", "0004_portfolioproject_project_url_fields"),
    ]

    operations = [
        migrations.AlterField(
            model_name="portfolioprojectimage",
            name="image",
            field=models.ImageField(
                blank=True,
                default="",
                upload_to=portfolio.models.upload_to_portfolio_project_image,
                verbose_name="프로젝트 이미지",
            ),
        ),
        migrations.AddField(
            model_name="portfolioprojectimage",
            name="external_url",
            field=models.URLField(blank=True, default="", max_length=800, verbose_name="외부 이미지 URL"),
        ),
        migrations.RunPython(migrate_project_content_assets, migrations.RunPython.noop),
    ]
