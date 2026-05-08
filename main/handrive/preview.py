from __future__ import annotations

"""HanDrive 파일 미리보기 렌더 helper.

이 모듈은 view 계층에서 분리 가능한 변환 로직만 담당한다.
- PDF iframe 렌더
- LibreOffice 기반 office -> PDF/HTML 변환
- OOXML(docx/xlsx/pptx) 텍스트 fallback 추출
- HTML live preview 문서 조합
"""

import base64
import csv
import io
import re
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

from django.utils.html import escape
from django.utils.safestring import mark_safe

LIBREOFFICE_CANDIDATE_BINS = (
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    "/opt/homebrew/bin/libreoffice",
    "/opt/homebrew/bin/soffice",
    "/usr/local/bin/libreoffice",
    "/usr/local/bin/soffice",
    "/usr/bin/libreoffice",
    "/usr/bin/soffice",
)


def _normalize_file_extension(extension: str | None, *, allow_empty: bool = False) -> str:
    """Normalize preview extension handling so converter helpers can accept '.ext' or 'ext' inputs."""
    value = str(extension or "").strip().lower()
    if not value:
        return "" if allow_empty else ".txt"
    return value if value.startswith(".") else f".{value}"


def render_handrive_pdf_safely(pdf_bytes: bytes, file_name: str = "preview.pdf", *, pdf_url: str = "") -> str:
    """PDF를 iframe으로 렌더한다. pdf_url이 있으면 직접 URL로, 없으면 base64 data URL로."""
    safe_title = escape(file_name)
    if pdf_url:
        src = escape(pdf_url)
    else:
        encoded_pdf = base64.b64encode(pdf_bytes).decode("ascii")
        src = f"data:application/pdf;base64,{encoded_pdf}#view=FitH"
    return mark_safe(
        '<div class="handrive-media-wrap handrive-media-pdf-wrap">'
        f'<iframe class="handrive-media-element handrive-media-pdf-element" src="{src}" title="{safe_title}"></iframe>'
        "</div>"
    )


def find_libreoffice_binary() -> str:
    """현재 서버에서 사용할 수 있는 LibreOffice 실행 파일 경로를 찾는다."""
    for candidate in LIBREOFFICE_CANDIDATE_BINS:
        if Path(candidate).exists():
            return candidate
    resolved = shutil.which("soffice") or shutil.which("libreoffice")
    return str(resolved or "")


def convert_office_bytes_to_pdf(file_extension: str, source_bytes: bytes, file_name: str = "document") -> bytes | None:
    """Office 파일 바이트를 headless LibreOffice 로 PDF 로 변환한다."""
    del file_name
    soffice_bin = find_libreoffice_binary()
    if not soffice_bin or not source_bytes:
        return None
    suffix = _normalize_file_extension(file_extension, allow_empty=False)
    pdf_filter = {
        ".doc": "writer_pdf_Export",
        ".docx": "writer_pdf_Export",
        ".xls": "calc_pdf_Export",
        ".xlsx": "calc_pdf_Export",
        ".ppt": "impress_pdf_Export",
        ".pptx": "impress_pdf_Export",
    }.get(suffix, "")
    with tempfile.TemporaryDirectory(prefix="handrive-office-preview-") as tmp_dir:
        work_dir = Path(tmp_dir)
        source_path = work_dir / f"source{suffix}"
        pdf_path = work_dir / "source.pdf"
        user_install_dir = work_dir / "user-install"
        user_install_dir.mkdir()
        try:
            source_path.write_bytes(source_bytes)
            result = subprocess.run(
                [
                    soffice_bin,
                    f"-env:UserInstallation=file://{user_install_dir}",
                    "--headless",
                    "--convert-to",
                    f"pdf:{pdf_filter}" if pdf_filter else "pdf",
                    "--outdir",
                    str(work_dir),
                    str(source_path),
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=60,
                check=False,
            )
        except (OSError, subprocess.SubprocessError):
            return None
        if result.returncode != 0 or not pdf_path.exists():
            return None
        try:
            return pdf_path.read_bytes()
        except OSError:
            return None


def convert_office_bytes_to_html(file_extension: str, source_bytes: bytes) -> str | None:
    """Excel 계열 파일을 HTML 로 변환해 표 구조를 더 잘 보이게 한다."""
    soffice_bin = find_libreoffice_binary()
    if not soffice_bin or not source_bytes:
        return None
    suffix = _normalize_file_extension(file_extension, allow_empty=False)
    if suffix not in {".xls", ".xlsx"}:
        return None
    with tempfile.TemporaryDirectory(prefix="handrive-office-html-preview-") as tmp_dir:
        work_dir = Path(tmp_dir)
        source_path = work_dir / f"source{suffix}"
        html_path = work_dir / "source.html"
        user_install_dir = work_dir / "user-install"
        user_install_dir.mkdir()
        try:
            source_path.write_bytes(source_bytes)
            result = subprocess.run(
                [
                    soffice_bin,
                    f"-env:UserInstallation=file://{user_install_dir}",
                    "--headless",
                    "--convert-to",
                    "html",
                    "--outdir",
                    str(work_dir),
                    str(source_path),
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=60,
                check=False,
            )
        except (OSError, subprocess.SubprocessError):
            return None
        if result.returncode != 0 or not html_path.exists():
            return None
        try:
            return html_path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            return None


def _inject_before_first_closing_tag(source: str, closing_tag: str, injection: str) -> str:
    """Insert generated CSS/JS before the first matching closing tag, appending when absent."""
    pattern = re.compile(re.escape(closing_tag), re.IGNORECASE)
    if pattern.search(source):
        return pattern.sub(lambda match: f"{injection}{match.group(0)}", source, count=1)
    return f"{source}{injection}"


def build_handrive_html_live_document(html_source: str, *, companion_css: str = "", companion_js: str = "") -> str:
    document = html_source or ""
    css_text = companion_css or ""
    js_text = companion_js or ""
    csp_meta = (
        "\n<meta http-equiv=\"Content-Security-Policy\" "
        "content=\"default-src 'none'; "
        "script-src 'unsafe-inline'; "
        "style-src 'unsafe-inline'; "
        "img-src data: blob: https://www.hanplanet.com; "
        "font-src data:; "
        "media-src data: blob:; "
        "connect-src 'none'; "
        "frame-src 'none'; "
        "object-src 'none'; "
        "form-action 'none'; "
        "base-uri 'none'\">"
    )

    if re.search(r"</head\s*>", document, flags=re.IGNORECASE):
        document = _inject_before_first_closing_tag(document, "</head>", csp_meta)
    else:
        document = f"{csp_meta}{document}"

    if css_text:
        safe_css_text = css_text.replace("</style", "<\\/style")
        css_block = f"\n<style data-handrive-linked-css>\n{safe_css_text}\n</style>\n"
        if re.search(r"</head\s*>", document, flags=re.IGNORECASE):
            document = _inject_before_first_closing_tag(document, "</head>", css_block)
        else:
            document = f"{css_block}{document}"

    if js_text:
        safe_js_text = js_text.replace("</script", "<\\/script")
        js_block = f"\n<script data-handrive-linked-js>\n{safe_js_text}\n</script>\n"
        if re.search(r"</body\s*>", document, flags=re.IGNORECASE):
            document = _inject_before_first_closing_tag(document, "</body>", js_block)
        else:
            document = f"{document}{js_block}"

    return document


def render_handrive_html_live_safely(html_source: str, *, companion_css: str = "", companion_js: str = "") -> str:
    live_document = build_handrive_html_live_document(
        html_source,
        companion_css=companion_css,
        companion_js=companion_js,
    )
    escaped_srcdoc = escape(live_document)
    return mark_safe(
        '<div class="handrive-html-live-wrap">'
        '<iframe class="handrive-html-live-frame" '
        'sandbox="allow-scripts" '
        'allow="picture-in-picture" '
        'referrerpolicy="no-referrer" '
        f'srcdoc="{escaped_srcdoc}"></iframe>'
        "</div>"
    )


def _read_zip_xml_text(archive: zipfile.ZipFile, member_name: str) -> str:
    try:
        return archive.read(member_name).decode("utf-8")
    except KeyError:
        return ""


def _extract_docx_preview_html(file_bytes: bytes) -> str:
    namespace = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    try:
        with zipfile.ZipFile(io.BytesIO(file_bytes)) as archive:
            document_xml = _read_zip_xml_text(archive, "word/document.xml")
    except (zipfile.BadZipFile, OSError):
        return "<p>미리보기를 지원하지 않는 Word 파일입니다.</p>"
    if not document_xml:
        return "<p>미리보기를 지원하지 않는 Word 파일입니다.</p>"

    try:
        root = ET.fromstring(document_xml)
    except ET.ParseError:
        return "<p>문서를 해석할 수 없습니다.</p>"

    body = root.find("w:body", namespace)
    if body is None:
        return "<p>문서를 해석할 수 없습니다.</p>"

    blocks: list[str] = []
    for child in body:
        tag_name = child.tag.rsplit("}", 1)[-1]
        if tag_name == "p":
            text = "".join(node.text or "" for node in child.findall(".//w:t", namespace)).strip()
            if text:
                blocks.append(f"<p>{escape(text)}</p>")
        elif tag_name == "tbl":
            rows = []
            for row in child.findall(".//w:tr", namespace):
                cells = []
                for cell in row.findall("./w:tc", namespace):
                    cell_text = "".join(node.text or "" for node in cell.findall(".//w:t", namespace)).strip()
                    cells.append(f"<td>{escape(cell_text)}</td>")
                if cells:
                    rows.append("<tr>" + "".join(cells) + "</tr>")
            if rows:
                blocks.append('<div class="handrive-office-table-wrap"><table class="handrive-office-table">' + "".join(rows) + "</table></div>")

    if not blocks:
        return "<p>문서에 표시할 텍스트가 없습니다.</p>"
    return "".join(blocks)


def _excel_column_index(reference: str) -> int:
    letters = "".join(character for character in str(reference or "") if character.isalpha()).upper()
    index = 0
    for character in letters:
        index = index * 26 + (ord(character) - 64)
    return max(0, index - 1)


def _extract_xlsx_preview_html(file_bytes: bytes) -> str:
    try:
        with zipfile.ZipFile(io.BytesIO(file_bytes)) as archive:
            shared_strings_xml = _read_zip_xml_text(archive, "xl/sharedStrings.xml")
            workbook_xml = _read_zip_xml_text(archive, "xl/workbook.xml")
            workbook_rels_xml = _read_zip_xml_text(archive, "xl/_rels/workbook.xml.rels")
            if not workbook_xml or not workbook_rels_xml:
                return "<p>미리보기를 지원하지 않는 Excel 파일입니다.</p>"

            shared_strings: list[str] = []
            if shared_strings_xml:
                shared_root = ET.fromstring(shared_strings_xml)
                for item in shared_root.findall(".//{*}si"):
                    shared_strings.append("".join(node.text or "" for node in item.findall(".//{*}t")))

            rel_map = {}
            rel_root = ET.fromstring(workbook_rels_xml)
            for rel in rel_root.findall(".//{*}Relationship"):
                rel_id = rel.attrib.get("Id", "")
                target = rel.attrib.get("Target", "")
                if rel_id and target:
                    rel_map[rel_id] = target.lstrip("/")

            workbook_root = ET.fromstring(workbook_xml)
            sheet_specs = []
            for sheet in workbook_root.findall(".//{*}sheet")[:3]:
                rel_id = sheet.attrib.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id", "")
                target = rel_map.get(rel_id, "")
                if not target:
                    continue
                sheet_specs.append((sheet.attrib.get("name", "Sheet"), f"xl/{target}" if not target.startswith("xl/") else target))

            sections: list[str] = []
            for sheet_name, sheet_path in sheet_specs:
                sheet_xml = _read_zip_xml_text(archive, sheet_path)
                if not sheet_xml:
                    continue
                sheet_root = ET.fromstring(sheet_xml)
                rows_html = []
                for row in sheet_root.findall(".//{*}sheetData/{*}row")[:30]:
                    values: dict[int, str] = {}
                    max_index = -1
                    for cell in row.findall("./{*}c"):
                        cell_ref = cell.attrib.get("r", "")
                        column_index = _excel_column_index(cell_ref)
                        max_index = max(max_index, column_index)
                        cell_type = cell.attrib.get("t", "")
                        value = ""
                        if cell_type == "inlineStr":
                            value = "".join(node.text or "" for node in cell.findall(".//{*}t"))
                        else:
                            raw_value = "".join(node.text or "" for node in cell.findall("./{*}v"))
                            if cell_type == "s":
                                try:
                                    value = shared_strings[int(raw_value)]
                                except (ValueError, IndexError):
                                    value = raw_value
                            else:
                                value = raw_value
                        values[column_index] = value
                    if max_index < 0:
                        continue
                    cells_html = []
                    for column_index in range(min(max_index + 1, 20)):
                        cells_html.append(f"<td>{escape(values.get(column_index, ''))}</td>")
                    rows_html.append("<tr>" + "".join(cells_html) + "</tr>")
                if rows_html:
                    sections.append(
                        f'<section class="handrive-office-sheet-section"><h3>{escape(sheet_name)}</h3><div class="handrive-office-table-wrap"><table class="handrive-office-table">{"".join(rows_html)}</table></div></section>'
                    )
            if not sections:
                return "<p>시트에 표시할 데이터가 없습니다.</p>"
            return "".join(sections)
    except (zipfile.BadZipFile, OSError, ET.ParseError):
        return "<p>미리보기를 지원하지 않는 Excel 파일입니다.</p>"


def render_handrive_csv_preview_safely(csv_source: str, *, file_name: str = "CSV") -> str:
    """CSV 텍스트를 HanDrive office sheet 스타일의 표로 렌더한다."""
    source = csv_source or ""
    try:
        dialect = csv.Sniffer().sniff(source[:4096]) if source.strip() else csv.excel
    except csv.Error:
        dialect = csv.excel

    try:
        rows = list(csv.reader(io.StringIO(source), dialect))
    except csv.Error:
        rows = list(csv.reader(io.StringIO(source), csv.excel))

    visible_rows = rows[:300]
    table_rows: list[str] = []
    for row_index, row in enumerate(visible_rows):
        visible_cells = row[:80]
        tag = "th" if row_index == 0 else "td"
        cells_html = "".join(f"<{tag}>{escape(cell)}</{tag}>" for cell in visible_cells)
        if cells_html:
            table_rows.append(f"<tr>{cells_html}</tr>")

    if not table_rows:
        return '<section class="handrive-office-sheet-section handrive-csv-sheet"><p>CSV에 표시할 데이터가 없습니다.</p></section>'

    omitted_parts: list[str] = []
    if len(rows) > len(visible_rows):
        omitted_parts.append(f"{len(rows) - len(visible_rows)} more rows")
    if any(len(row) > 80 for row in visible_rows):
        omitted_parts.append("additional columns")
    omitted_html = ""
    if omitted_parts:
        omitted_html = f'<p class="handrive-office-preview-note">{escape(", ".join(omitted_parts))} omitted from preview.</p>'

    return (
        f'<section class="handrive-office-sheet-section handrive-csv-sheet">'
        f"<h3>{escape(file_name)}</h3>"
        f'<div class="handrive-office-table-wrap"><table class="handrive-office-table handrive-csv-table">{"".join(table_rows)}</table></div>'
        f"{omitted_html}"
        "</section>"
    )


def _extract_pptx_preview_html(file_bytes: bytes) -> str:
    try:
        with zipfile.ZipFile(io.BytesIO(file_bytes)) as archive:
            slide_names = sorted(name for name in archive.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", name))[:20]
            if not slide_names:
                return "<p>미리보기를 지원하지 않는 PowerPoint 파일입니다.</p>"
            sections = []
            for index, slide_name in enumerate(slide_names, start=1):
                slide_xml = _read_zip_xml_text(archive, slide_name)
                if not slide_xml:
                    continue
                slide_root = ET.fromstring(slide_xml)
                texts = [(node.text or "").strip() for node in slide_root.findall(".//{*}t") if (node.text or "").strip()]
                if not texts:
                    sections.append(f'<section class="handrive-office-slide"><h3>Slide {index}</h3><p>표시할 텍스트가 없습니다.</p></section>')
                    continue
                slide_body = "".join(f"<p>{escape(text)}</p>" for text in texts[:30])
                sections.append(f'<section class="handrive-office-slide"><h3>Slide {index}</h3>{slide_body}</section>')
            return "".join(sections) or "<p>슬라이드에 표시할 내용이 없습니다.</p>"
    except (zipfile.BadZipFile, OSError, ET.ParseError):
        return "<p>미리보기를 지원하지 않는 PowerPoint 파일입니다.</p>"


def render_handrive_office_preview_safely(file_extension: str, source_bytes: bytes) -> str:
    extension = str(file_extension or "").lower()
    if extension in {".xls", ".xlsx"}:
        html_text = convert_office_bytes_to_html(extension, source_bytes)
        if html_text:
            office_override_css = """
html, body {
    margin: 0;
    padding: 0;
    background: #ffffff;
    color: #1f2328;
}
html body {
    padding: 14px;
    overflow-x: auto;
    overflow-y: auto;
    box-sizing: border-box;
    width: 100%;
    min-width: 100%;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Apple SD Gothic Neo", "Malgun Gothic", "Nanum Gothic", sans-serif;
    font-size: 14px;
    line-height: 1.45;
}
html body div,
html body table,
html body thead,
html body tbody,
html body tfoot,
html body tr,
html body th,
html body td,
html body p,
html body span,
html body font {
    font-family: inherit;
    font-size: inherit;
    line-height: inherit;
    color: inherit;
}
html body table {
    border-collapse: collapse;
    border-spacing: 0;
    width: max-content;
    min-width: 100%;
    max-width: none;
    table-layout: auto;
    background: #ffffff;
}
html body td,
html body th {
    border: 1px solid #d0d7de;
    padding: 6px 8px;
    vertical-align: middle;
    white-space: pre;
}
html body col {
    width: auto;
}
#handrive-office-zoom-viewport {
    position: relative;
    transform: translateZ(0);
}
#handrive-office-zoom-content {
    transform-origin: top left;
}
"""
            office_fit_js = """
(function () {
    var MIN_ZOOM = 0.35;
    var MAX_ZOOM = 3;
    var MAX_FIT_ZOOM = 1.25;
    var userZoom = 1;
    var scheduled = false;
    var root = document.documentElement;
    var parentAvailableWidth = 0;

    function clamp(value, minValue, maxValue) {
        value = Number(value);
        if (!Number.isFinite(value)) {
            value = 1;
        }
        return Math.max(minValue, Math.min(maxValue, value));
    }

    function getAvailableWidth() {
        return Math.max(1, Number(parentAvailableWidth || root.clientWidth || window.innerWidth || 0));
    }

    function ensureZoomCanvas() {
        var body = document.body;
        if (!body) {
            return null;
        }
        var viewport = document.getElementById("handrive-office-zoom-viewport");
        var content = document.getElementById("handrive-office-zoom-content");
        if (viewport && content) {
            return { viewport: viewport, content: content };
        }

        var currentScript = document.currentScript || null;
        viewport = document.createElement("div");
        viewport.id = "handrive-office-zoom-viewport";
        content = document.createElement("div");
        content.id = "handrive-office-zoom-content";

        Array.prototype.slice.call(body.childNodes).forEach(function (node) {
            if (node === currentScript || node === viewport) {
                return;
            }
            content.appendChild(node);
        });
        viewport.appendChild(content);
        if (currentScript && currentScript.parentNode === body) {
            body.insertBefore(viewport, currentScript);
        } else {
            body.appendChild(viewport);
        }
        return { viewport: viewport, content: content };
    }

    function normalizeTableSizing() {
        var availableWidth = getAvailableWidth();
        var tables = Array.prototype.slice.call(document.querySelectorAll("table"));
        tables.forEach(function (table) {
            table.style.setProperty("width", "max-content");
            table.style.setProperty("min-width", availableWidth + "px");
            table.style.setProperty("max-width", "none");
            table.style.setProperty("table-layout", "auto");
        });
    }

    function readUnscaledContentWidth() {
        var canvas = ensureZoomCanvas();
        if (!canvas) {
            return 1;
        }
        canvas.content.style.transform = "none";
        canvas.content.style.width = "auto";
        canvas.viewport.style.width = "auto";
        normalizeTableSizing();

        var width = Math.max(
            1,
            Number(canvas.content.scrollWidth || 0),
            Number(canvas.content.offsetWidth || 0)
        );
        var tables = Array.prototype.slice.call(document.querySelectorAll("table"));
        tables.forEach(function (table) {
            var rect = table.getBoundingClientRect();
            width = Math.max(
                width,
                Number(table.scrollWidth || 0),
                Number(rect && rect.width ? rect.width : 0)
            );
        });

        return Math.max(1, width);
    }

    function readUnscaledContentHeight(canvas) {
        if (!canvas) {
            return 1;
        }
        canvas.content.style.transform = "none";
        canvas.viewport.style.height = "auto";
        return Math.max(
            1,
            Number(canvas.content.scrollHeight || 0),
            Number(canvas.content.offsetHeight || 0)
        );
    }

    function applyZoom(nextUserZoom) {
        userZoom = clamp(nextUserZoom, MIN_ZOOM, MAX_ZOOM);
        var canvas = ensureZoomCanvas();
        var baseWidth = readUnscaledContentWidth();
        var baseHeight = readUnscaledContentHeight(canvas);
        var availableWidth = getAvailableWidth();
        var fitZoom = clamp(availableWidth / baseWidth, MIN_ZOOM, MAX_FIT_ZOOM);
        var appliedZoom = clamp(fitZoom * userZoom, MIN_ZOOM, MAX_ZOOM);
        var scaledWidth = Math.ceil(baseWidth * appliedZoom);
        var scaledHeight = Math.ceil(baseHeight * appliedZoom);

        root.style.setProperty("--handrive-office-fit-zoom", String(fitZoom.toFixed(3)));
        root.style.setProperty("--handrive-office-applied-zoom", String(appliedZoom.toFixed(3)));
        if (canvas) {
            canvas.content.style.width = baseWidth + "px";
            canvas.content.style.transform = "scale(" + String(appliedZoom.toFixed(3)) + ")";
            canvas.viewport.style.width = Math.max(availableWidth, scaledWidth) + "px";
            canvas.viewport.style.height = scaledHeight + "px";
        }
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: "handrive-office-preview-size",
                width: Math.max(availableWidth, scaledWidth),
                height: scaledHeight
            }, "*");
        }
        if (document.body) {
            document.body.classList.toggle(
                "is-handrive-office-overflowing",
                scaledWidth > availableWidth + 1
            );
        }
    }

    function scheduleFit() {
        if (scheduled) {
            return;
        }
        scheduled = true;
        window.requestAnimationFrame(function () {
            scheduled = false;
            applyZoom(userZoom);
        });
    }

    window.addEventListener("wheel", function (event) {
        if (!event.ctrlKey && !event.metaKey) {
            return;
        }
        event.preventDefault();
        applyZoom(userZoom * (event.deltaY < 0 ? 1.1 : 0.9));
    }, { passive: false });

    window.addEventListener("resize", scheduleFit, { passive: true });
    window.addEventListener("message", function (event) {
        var data = event && event.data && typeof event.data === "object" ? event.data : null;
        if (!data || data.type !== "handrive-office-preview-viewport") {
            return;
        }
        var nextParentAvailableWidth = Math.max(1, Number(data.width || 0));
        if (Math.abs(nextParentAvailableWidth - parentAvailableWidth) < 1) {
            return;
        }
        parentAvailableWidth = nextParentAvailableWidth;
        scheduleFit();
    });
    if (document.fonts && typeof document.fonts.ready === "object") {
        document.fonts.ready.then(scheduleFit).catch(function () {});
    }
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", scheduleFit, { once: true });
    } else {
        scheduleFit();
    }
    window.addEventListener("load", scheduleFit, { once: true });
})();
"""
            return render_handrive_html_live_safely(
                html_text,
                companion_css=office_override_css,
                companion_js=office_fit_js,
            )
        if extension == ".xlsx":
            return mark_safe(_extract_xlsx_preview_html(source_bytes))
    pdf_bytes = convert_office_bytes_to_pdf(extension, source_bytes, f"preview{extension or '.docx'}")
    if pdf_bytes:
        return render_handrive_pdf_safely(pdf_bytes, f"preview{extension or '.pdf'}")
    if extension == ".docx":
        return mark_safe(_extract_docx_preview_html(source_bytes))
    if extension == ".pptx":
        return mark_safe(_extract_pptx_preview_html(source_bytes))
    if extension in {".doc", ".xls", ".ppt"}:
        return mark_safe("<p>이 형식은 구형 Office 포맷이라 미리보기를 지원하지 않습니다. 최신 형식으로 저장하면 미리보기가 가능합니다.</p>")
    return mark_safe("<p>미리보기를 지원하지 않는 Office 파일입니다.</p>")
