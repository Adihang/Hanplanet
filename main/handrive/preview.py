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
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
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

HANDRIVE_HTML_LIVE_ZOOM_BRIDGE_SCRIPT = r"""
(function () {
    var pinchStartDistance = 0;
    function emit(detail) {
        try {
            parent.postMessage(Object.assign({
                type: "handrive-preview-frame-zoom-gesture"
            }, detail || {}), "*");
        } catch (error) {}
    }
    function stop(event) {
        if (!event) return;
        if (event.cancelable !== false) event.preventDefault();
        event.stopPropagation();
    }
    function wheelDelta(event) {
        var deltaY = Number(event && event.deltaY) || 0;
        if (Math.abs(deltaY) > 0.01) return deltaY;
        return Number(event && event.deltaX) || 0;
    }
    function touchDistance(touches) {
        if (!touches || touches.length < 2) return 0;
        var first = touches[0];
        var second = touches[1];
        var dx = (Number(first.clientX) || 0) - (Number(second.clientX) || 0);
        var dy = (Number(first.clientY) || 0) - (Number(second.clientY) || 0);
        return Math.sqrt(dx * dx + dy * dy);
    }
    function applyZoom(value) {
        var zoom = Math.max(0.25, Math.min(4, Number(value) || 1));
        if (
            window.HandriveHtmlPreviewFit &&
            typeof window.HandriveHtmlPreviewFit.setUserZoom === "function"
        ) {
            window.HandriveHtmlPreviewFit.setUserZoom(zoom);
            return;
        }
        document.documentElement.style.zoom = String(zoom);
        document.documentElement.style.setProperty("--handrive-preview-frame-zoom", String(zoom));
        if (document.body) {
            document.body.style.setProperty("--handrive-preview-frame-zoom", String(zoom));
        }
    }
    window.addEventListener("message", function (event) {
        var data = event && event.data && typeof event.data === "object" ? event.data : null;
        if (!data || data.type !== "handrive-preview-frame-zoom-apply") return;
        applyZoom(data.zoom);
    });
    window.addEventListener("wheel", function (event) {
        var delta = wheelDelta(event);
        if (!(event.ctrlKey || event.metaKey) || event.altKey || Math.abs(delta) < 0.01) return;
        stop(event);
        emit({
            inputType: "wheel",
            deltaY: Number(event.deltaY) || 0,
            deltaX: Number(event.deltaX) || 0,
            deltaMode: Number(event.deltaMode) || 0
        });
    }, { passive: false, capture: true });
    window.addEventListener("touchstart", function (event) {
        if (!event.touches || event.touches.length < 2) return;
        pinchStartDistance = touchDistance(event.touches);
        if (!pinchStartDistance) return;
        stop(event);
        emit({ inputType: "pinch-start" });
    }, { passive: false, capture: true });
    window.addEventListener("touchmove", function (event) {
        if (!pinchStartDistance || !event.touches || event.touches.length < 2) return;
        var distance = touchDistance(event.touches);
        if (!distance) return;
        stop(event);
        emit({ inputType: "pinch", ratio: distance / pinchStartDistance });
    }, { passive: false, capture: true });
    window.addEventListener("touchend", function (event) {
        if (event.touches && event.touches.length >= 2) {
            pinchStartDistance = touchDistance(event.touches);
            emit({ inputType: "pinch-start" });
            return;
        }
        pinchStartDistance = 0;
    }, { passive: false, capture: true });
    window.addEventListener("touchcancel", function () {
        pinchStartDistance = 0;
    }, { passive: false, capture: true });
    window.addEventListener("gesturestart", function (event) {
        stop(event);
        emit({ inputType: "gesture-start" });
    }, { passive: false, capture: true });
    window.addEventListener("gesturechange", function (event) {
        stop(event);
        emit({ inputType: "gesture", ratio: Number(event.scale) || 1 });
    }, { passive: false, capture: true });
}());
"""

HANDRIVE_HTML_LIVE_FIT_BRIDGE_SCRIPT = r"""
(function () {
    var viewportWidth = 0;
    var userZoom = 1;
    var fitZoom = 1;
    var scheduled = false;
    var emittingResize = false;
    var MIN_ZOOM = 0.25;
    var MAX_ZOOM = 4;
    function readPositiveNumber(value) {
        var numeric = Number(value);
        return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
    }
    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, Number(value) || 1));
    }
    function dispatchResize(width) {
        emittingResize = true;
        try {
            window.dispatchEvent(new Event("resize"));
        } catch (error) {}
        emittingResize = false;
        try {
            window.dispatchEvent(new CustomEvent("handrive-html-preview-resize", {
                detail: { width: width }
            }));
        } catch (error) {}
    }
    function setZoomProperties(appliedZoom) {
        document.documentElement.style.zoom = String(appliedZoom);
        document.documentElement.style.setProperty("--handrive-preview-frame-zoom", String(userZoom));
        document.documentElement.style.setProperty("--handrive-html-preview-fit-zoom", String(fitZoom));
        document.documentElement.style.setProperty("--handrive-html-preview-applied-zoom", String(appliedZoom));
        if (document.body) {
            document.body.style.setProperty("--handrive-preview-frame-zoom", String(userZoom));
            document.body.style.setProperty("--handrive-html-preview-fit-zoom", String(fitZoom));
            document.body.style.setProperty("--handrive-html-preview-applied-zoom", String(appliedZoom));
        }
    }
    function readNaturalContentWidth() {
        var html = document.documentElement;
        var body = document.body;
        var previousZoom = html.style.zoom;
        html.style.zoom = "1";
        var width = Math.max(
            viewportWidth || 0,
            html ? (html.scrollWidth || html.offsetWidth || html.clientWidth || 0) : 0,
            body ? (body.scrollWidth || body.offsetWidth || body.clientWidth || 0) : 0
        );
        html.style.zoom = previousZoom;
        return Math.max(1, width);
    }
    function applyFit() {
        var width = Math.max(1, Math.round(viewportWidth || window.innerWidth || document.documentElement.clientWidth || 0));
        var contentWidth = readNaturalContentWidth();
        fitZoom = contentWidth > width + 1 ? clamp(width / contentWidth, MIN_ZOOM, 1) : 1;
        var appliedZoom = clamp(fitZoom * userZoom, MIN_ZOOM, MAX_ZOOM);
        document.documentElement.style.setProperty("--handrive-html-preview-viewport-width", width + "px");
        if (document.body) {
            document.body.style.setProperty("--handrive-html-preview-viewport-width", width + "px");
        }
        setZoomProperties(appliedZoom);
        dispatchResize(width);
    }
    function scheduleFit() {
        if (scheduled) {
            return;
        }
        scheduled = true;
        window.requestAnimationFrame(function () {
            scheduled = false;
            applyFit();
        });
    }
    function applyViewport(data) {
        var width = Math.max(1, Math.round(readPositiveNumber(data && data.width)));
        if (!width) {
            return;
        }
        viewportWidth = width;
        scheduleFit();
    }
    function setUserZoom(value) {
        userZoom = clamp(value, MIN_ZOOM, MAX_ZOOM);
        scheduleFit();
    }
    function emitReady() {
        try {
            if (window.parent && window.parent !== window) {
                window.parent.postMessage({ type: "handrive-html-preview-ready" }, "*");
            }
        } catch (error) {}
    }
    window.addEventListener("message", function (event) {
        var data = event && event.data && typeof event.data === "object" ? event.data : null;
        if (!data || data.type !== "handrive-html-preview-viewport") {
            return;
        }
        applyViewport(data);
    });
    window.addEventListener("resize", function () {
        if (!emittingResize) {
            scheduleFit();
        }
    }, { passive: true });
    window.HandriveHtmlPreviewFit = {
        setUserZoom: setUserZoom,
        sync: scheduleFit
    };
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function () {
            scheduleFit();
            emitReady();
        }, { once: true });
    } else {
        scheduleFit();
        emitReady();
    }
    window.addEventListener("load", function () {
        scheduleFit();
        emitReady();
    }, { once: true });
}());
"""


def _normalize_file_extension(extension: str | None, *, allow_empty: bool = False) -> str:
    """Normalize preview extension handling so converter helpers can accept '.ext' or 'ext' inputs."""
    value = str(extension or "").strip().lower()
    if not value:
        return "" if allow_empty else ".txt"
    return value if value.startswith(".") else f".{value}"


def build_handrive_pdf_viewer_url(pdf_url: str, *, theme: str = "") -> str:
    parts = urlsplit(str(pdf_url or ""))
    query_items = [
        (key, value)
        for key, value in parse_qsl(parts.query, keep_blank_values=True)
        if key not in {"viewer", "theme"}
    ]
    query_items.append(("viewer", "1"))
    if theme in {"light", "dark"}:
        query_items.append(("theme", theme))
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query_items), parts.fragment))


def render_handrive_pdf_safely(
    pdf_bytes: bytes,
    file_name: str = "preview.pdf",
    *,
    pdf_url: str = "",
    viewer_theme: str = "",
) -> str:
    """PDF를 iframe으로 렌더한다. pdf_url이 있으면 직접 URL로, 없으면 base64 data URL로."""
    safe_title = escape(file_name)
    if pdf_url:
        raw_src = str(pdf_url)
        src = build_handrive_pdf_viewer_url(raw_src, theme=viewer_theme)
        extra_attrs = (
            ' data-handrive-pdf-viewer="1"'
            f' data-handrive-pdf-source="{escape(raw_src)}"'
        )
    else:
        encoded_pdf = base64.b64encode(pdf_bytes).decode("ascii")
        src = f"data:application/pdf;base64,{encoded_pdf}#view=FitH"
        extra_attrs = ""
    return mark_safe(
        '<div class="handrive-media-wrap handrive-media-pdf-wrap">'
        f'<iframe class="handrive-media-element handrive-media-pdf-element" src="{escape(src)}" title="{safe_title}"{extra_attrs}></iframe>'
        "</div>"
    )


def render_handrive_external_frame_safely(
    frame_url: str,
    file_name: str = "preview",
    *,
    wrapper_class: str = "",
    frame_class: str = "",
) -> str:
    """외부 미리보기 URL을 HanDrive iframe 레이아웃으로 렌더한다."""
    safe_title = escape(file_name)
    safe_src = escape(frame_url)
    wrapper_classes = " ".join(
        ["handrive-media-wrap", "handrive-media-pdf-wrap"]
        + [class_name for class_name in str(wrapper_class or "").split() if class_name]
    )
    frame_classes = " ".join(
        ["handrive-media-element", "handrive-media-pdf-element"]
        + [class_name for class_name in str(frame_class or "").split() if class_name]
    )
    return mark_safe(
        f'<div class="{escape(wrapper_classes)}">'
        f'<iframe class="{escape(frame_classes)}" src="{safe_src}" title="{safe_title}" loading="lazy" '
        'referrerpolicy="no-referrer-when-downgrade"></iframe>'
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

    safe_fit_bridge_script = HANDRIVE_HTML_LIVE_FIT_BRIDGE_SCRIPT.replace("</script", "<\\/script")
    safe_zoom_bridge_script = HANDRIVE_HTML_LIVE_ZOOM_BRIDGE_SCRIPT.replace("</script", "<\\/script")
    preview_bridge_block = (
        "\n<script data-handrive-preview-fit-bridge>\n"
        f"{safe_fit_bridge_script}"
        "\n</script>\n"
        "\n<script data-handrive-preview-zoom-bridge>\n"
        f"{safe_zoom_bridge_script}"
        "\n</script>\n"
    )
    if re.search(r"</body\s*>", document, flags=re.IGNORECASE):
        document = _inject_before_first_closing_tag(document, "</body>", preview_bridge_block)
    else:
        document = f"{document}{preview_bridge_block}"

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
            for sheet in workbook_root.findall(".//{*}sheet"):
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
                for row in sheet_root.findall(".//{*}sheetData/{*}row"):
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
                    for column_index in range(max_index + 1):
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
    overflow: visible;
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
    overflow: visible;
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
    var FRAME_HEIGHT_BUFFER = 24;
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

    function readCssPixelValue(style, propertyName) {
        var value = style ? Number.parseFloat(style.getPropertyValue(propertyName)) : 0;
        return Number.isFinite(value) ? value : 0;
    }

    function readBodyBottomSpacing() {
        if (!document.body || !window.getComputedStyle) {
            return 0;
        }
        var style = window.getComputedStyle(document.body);
        return readCssPixelValue(style, "padding-bottom")
            + readCssPixelValue(style, "border-bottom-width");
    }

    function readUnscaledContentHeight(canvas) {
        if (!canvas) {
            return 1;
        }
        canvas.content.style.transform = "none";
        canvas.viewport.style.height = "auto";
        canvas.viewport.style.overflow = "visible";
        var contentRect = canvas.content.getBoundingClientRect();
        var contentTop = Number(contentRect && contentRect.top ? contentRect.top : 0);
        var descendantTop = 0;
        var descendantBottom = 0;
        Array.prototype.slice.call(canvas.content.querySelectorAll("*")).forEach(function (node) {
            var rect = node.getBoundingClientRect();
            if (!rect) {
                return;
            }
            descendantTop = Math.min(descendantTop, Number(rect.top || 0) - contentTop);
            descendantBottom = Math.max(descendantBottom, Number(rect.bottom || 0) - contentTop);
        });
        return Math.max(
            1,
            Number(canvas.viewport.scrollHeight || 0),
            Number(canvas.content.scrollHeight || 0),
            Number(canvas.content.offsetHeight || 0),
            Number(contentRect && contentRect.height ? contentRect.height : 0),
            descendantBottom - Math.min(0, descendantTop)
        );
    }

    function readScaledFrameHeight(canvas, scaledContentHeight) {
        if (!canvas) {
            return Math.max(1, scaledContentHeight + FRAME_HEIGHT_BUFFER);
        }
        var viewportOffsetTop = Number(canvas.viewport.offsetTop || 0);
        var bodyScrollHeight = document.body ? Number(document.body.scrollHeight || 0) : 0;
        return Math.max(
            1,
            Math.ceil(viewportOffsetTop + scaledContentHeight + readBodyBottomSpacing() + FRAME_HEIGHT_BUFFER),
            Math.ceil(bodyScrollHeight + FRAME_HEIGHT_BUFFER)
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
        var scaledContentHeight = Math.ceil(baseHeight * appliedZoom);
        var frameHeight = readScaledFrameHeight(canvas, scaledContentHeight);

        root.style.setProperty("--handrive-office-fit-zoom", String(fitZoom.toFixed(3)));
        root.style.setProperty("--handrive-office-applied-zoom", String(appliedZoom.toFixed(3)));
        if (canvas) {
            canvas.content.style.width = baseWidth + "px";
            canvas.content.style.transformOrigin = "top left";
            canvas.content.style.transform = "scale(" + String(appliedZoom.toFixed(3)) + ")";
            canvas.viewport.style.width = Math.max(availableWidth, scaledWidth) + "px";
            canvas.viewport.style.height = scaledContentHeight + "px";
            canvas.viewport.style.overflow = "visible";
            frameHeight = readScaledFrameHeight(canvas, scaledContentHeight);
        }
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: "handrive-office-preview-size",
                width: Math.max(availableWidth, scaledWidth),
                height: frameHeight
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

    function scheduleFollowUpFits() {
        [80, 250, 700, 1400].forEach(function (delay) {
            window.setTimeout(scheduleFit, delay);
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
        document.addEventListener("DOMContentLoaded", function () {
            scheduleFit();
            scheduleFollowUpFits();
        }, { once: true });
    } else {
        scheduleFit();
        scheduleFollowUpFits();
    }
    window.addEventListener("load", function () {
        scheduleFit();
        scheduleFollowUpFits();
    }, { once: true });
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


def render_handrive_spreadsheet_preview_shell(
    *,
    file_name: str = "spreadsheet",
    relative_path: str = "",
    file_extension: str = "",
    can_edit: bool = False,
) -> str:
    """Handsontable이 브라우저에서 원본 파일을 직접 읽어 렌더링할 shell."""
    del can_edit
    editable_flag = "0"
    return mark_safe(
        '<section class="handrive-spreadsheet-preview is-loading" data-handrive-spreadsheet-preview="1"'
        f' data-path="{escape(relative_path)}"'
        f' data-filename="{escape(file_name)}"'
        f' data-extension="{escape(str(file_extension or "").lower())}"'
        f' data-editable="{editable_flag}">'
        '<div class="handrive-spreadsheet-preview-toolbar">'
        '<select class="handrive-spreadsheet-sheet-select" data-handrive-spreadsheet-preview-sheet aria-label="시트"></select>'
        '<span class="handrive-spreadsheet-status" data-handrive-spreadsheet-preview-status aria-live="polite"></span>'
        "</div>"
        '<div class="handrive-spreadsheet-preview-hot" data-handrive-spreadsheet-preview-hot></div>'
        "</section>"
    )
