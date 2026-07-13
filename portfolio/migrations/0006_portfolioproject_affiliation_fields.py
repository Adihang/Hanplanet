import html
import re

from django.db import migrations, models


LEADING_AFFILIATION_BLOCK_RE = re.compile(
    r"\A\s*\*\*(?:소속|Organization|Affiliation)\*\*\s*:\s*"
    r"(?P<value>.*?)"
    r"(?:\r?\n)+\*\*\*\s*",
    re.IGNORECASE | re.DOTALL,
)
A_TAG_RE = re.compile(
    r"<a\b[^>]*\bhref\s*=\s*(['\"])(?P<url>.*?)\1[^>]*>(?P<label>.*?)</a>",
    re.IGNORECASE | re.DOTALL,
)
TAG_RE = re.compile(r"<[^>]+>")
NON_POSITION_TRAILING_TEXTS = {"개발팀"}


def _clean_markdown_spacing(value):
    value = re.sub(r"[ \t]+\n", "\n", value or "")
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()


def _clean_text(value):
    unescaped = html.unescape(str(value or "")).strip()
    without_tags = TAG_RE.sub("", unescaped)
    return re.sub(r"\s+", " ", without_tags).strip()


def _clean_url(value):
    return html.unescape(str(value or "")).strip()


def _clean_position(value):
    cleaned = _clean_text(value)
    return "" if cleaned in NON_POSITION_TRAILING_TEXTS else cleaned


def _extract_leading_affiliation_block(content):
    match = LEADING_AFFILIATION_BLOCK_RE.match(content or "")
    if not match:
        return "", "", "", content or ""

    raw_value = match.group("value") or ""
    organization = ""
    organization_url = ""
    position = ""
    link_match = A_TAG_RE.search(raw_value)
    if link_match:
        organization = _clean_text(link_match.group("label"))
        organization_url = _clean_url(link_match.group("url"))
        trailing_text = f"{raw_value[:link_match.start()]} {raw_value[link_match.end():]}"
        position = _clean_position(trailing_text)
    else:
        organization = _clean_text(raw_value)

    updated_content = _clean_markdown_spacing((content or "")[match.end() :])
    return organization, organization_url, position, updated_content


def migrate_project_affiliations(apps, schema_editor):
    PortfolioProject = apps.get_model("portfolio", "PortfolioProject")

    for project in PortfolioProject.objects.all().order_by("id"):
        content = project.content or ""
        content_en = project.content_en or ""
        candidates = []

        for field_name, source in (("content", content), ("content_en", content_en)):
            organization, organization_url, position, updated = _extract_leading_affiliation_block(source)
            if organization or organization_url or position:
                candidates.append((organization, organization_url, position))
            if field_name == "content":
                content = updated
            else:
                content_en = updated

        changed_fields = []
        if content != (project.content or ""):
            project.content = content
            changed_fields.append("content")
        if content_en != (project.content_en or ""):
            project.content_en = content_en
            changed_fields.append("content_en")

        for organization, organization_url, position in candidates:
            if organization and not project.organization:
                project.organization = organization[:160]
                changed_fields.append("organization")
            if organization_url and not project.organization_url:
                project.organization_url = organization_url[:500]
                changed_fields.append("organization_url")
            if position and not project.position:
                project.position = position[:160]
                changed_fields.append("position")

        if changed_fields:
            project.save(update_fields=sorted(set(changed_fields)))


class Migration(migrations.Migration):

    dependencies = [
        ("portfolio", "0005_project_image_external_url_and_migrate_content_assets"),
    ]

    operations = [
        migrations.AddField(
            model_name="portfolioproject",
            name="organization",
            field=models.CharField(blank=True, default="", max_length=160, verbose_name="소속"),
        ),
        migrations.AddField(
            model_name="portfolioproject",
            name="organization_url",
            field=models.URLField(blank=True, default="", max_length=500, verbose_name="소속 URL"),
        ),
        migrations.AddField(
            model_name="portfolioproject",
            name="position",
            field=models.CharField(blank=True, default="", max_length=160, verbose_name="직책"),
        ),
        migrations.RunPython(migrate_project_affiliations, migrations.RunPython.noop),
    ]
