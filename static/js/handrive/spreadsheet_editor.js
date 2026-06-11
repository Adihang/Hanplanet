(function () {
    "use strict";

    var SUPPORTED_EXTENSIONS = new Set([".csv", ".xls", ".xlsx"]);
    var MIN_ROWS = 30;
    var MIN_COLS = 12;
    var ROW_HEADER_WIDTH = 38;
    var PREVIEW_HOT_MIN_HEIGHT = 320;
    var PREVIEW_HOT_MAX_HEIGHT = 620;
    var activeState = null;
    var previewStates = [];
    var previewSaveShortcutInstalled = false;
    var previewLayoutListenersInstalled = false;

    function getPathFileExtension(pathValue) {
        var fileName = String(pathValue || "").replace(/\\/g, "/").split("/").pop() || "";
        var dotIndex = fileName.lastIndexOf(".");
        return dotIndex > 0 ? fileName.slice(dotIndex).toLowerCase() : "";
    }

    function getLicenseKey(explicitValue) {
        var candidate = String(explicitValue || "").trim();
        if (candidate) {
            return candidate;
        }
        var root = document.querySelector("[data-handsontable-license-key]");
        candidate = root ? String(root.getAttribute("data-handsontable-license-key") || "").trim() : "";
        return candidate || "non-commercial-and-evaluation";
    }

    function ensureLibraries() {
        if (!window.Handsontable) {
            throw new Error("Handsontable을 불러오지 못했습니다.");
        }
        if (!window.XLSX) {
            throw new Error("SheetJS를 불러오지 못했습니다.");
        }
    }

    function ensureExcelJs() {
        if (!window.ExcelJS || !window.ExcelJS.Workbook) {
            throw new Error("ExcelJS를 불러오지 못했습니다.");
        }
    }

    function arrayBufferToBase64(buffer) {
        var bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
        var binary = "";
        var chunkSize = 0x8000;
        for (var index = 0; index < bytes.length; index += chunkSize) {
            binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(index, index + chunkSize)));
        }
        return window.btoa(binary);
    }

    function cloneData(data) {
        return Array.isArray(data)
            ? data.map(function (row) {
                return Array.isArray(row) ? row.slice() : [];
            })
            : [];
    }

    function normalizeCellValue(value) {
        if (value === null || typeof value === "undefined") {
            return "";
        }
        if (value instanceof Date) {
            return value;
        }
        return value;
    }

    function normalizeSheetData(data) {
        var rows = cloneData(data).map(function (row) {
            return row.map(normalizeCellValue);
        });
        var maxCols = rows.reduce(function (max, row) {
            return Math.max(max, row.length);
        }, 0);
        if (!rows.length) {
            rows.push([]);
        }
        maxCols = Math.max(maxCols, 1);
        rows.forEach(function (row) {
            while (row.length < maxCols) {
                row.push("");
            }
        });
        return rows;
    }

    function trimSheetData(data) {
        var rows = cloneData(data);
        while (rows.length) {
            var lastRow = rows[rows.length - 1] || [];
            var hasValue = lastRow.some(function (value) {
                return String(value === null || typeof value === "undefined" ? "" : value).trim() !== "";
            });
            if (hasValue) {
                break;
            }
            rows.pop();
        }
        var maxCols = rows.reduce(function (max, row) {
            for (var index = row.length - 1; index >= 0; index -= 1) {
                if (String(row[index] === null || typeof row[index] === "undefined" ? "" : row[index]).trim() !== "") {
                    return Math.max(max, index + 1);
                }
            }
            return max;
        }, 0);
        if (!rows.length || maxCols <= 0) {
            return [[""]];
        }
        return rows.map(function (row) {
            return row.slice(0, maxCols);
        });
    }

    function sanitizeSheetName(name, fallback) {
        var candidate = String(name || fallback || "Sheet1").trim() || "Sheet1";
        candidate = candidate.replace(/[\\/?*[\]:]/g, " ").trim() || "Sheet1";
        return candidate.slice(0, 31);
    }

    function getSheetMaxColumnCount(data) {
        return (Array.isArray(data) ? data : []).reduce(function (max, row) {
            return Math.max(max, Array.isArray(row) ? row.length : 0);
        }, 0);
    }

    function getCellKey(rowIndex, columnIndex) {
        return String(rowIndex) + ":" + String(columnIndex);
    }

    function getCssColorFromExcelColor(color) {
        if (!color) {
            return "";
        }
        var hexValue = String(color.argb || color.rgb || "").replace(/^#/, "").trim();
        if (!hexValue) {
            return "";
        }
        if (/^[0-9a-fA-F]{8}$/.test(hexValue)) {
            var alpha = parseInt(hexValue.slice(0, 2), 16);
            var red = parseInt(hexValue.slice(2, 4), 16);
            var green = parseInt(hexValue.slice(4, 6), 16);
            var blue = parseInt(hexValue.slice(6, 8), 16);
            if (alpha >= 255) {
                return "#" + hexValue.slice(2).toUpperCase();
            }
            if (alpha <= 0) {
                return "";
            }
            return "rgba(" + red + ", " + green + ", " + blue + ", " + (alpha / 255).toFixed(3) + ")";
        }
        if (/^[0-9a-fA-F]{6}$/.test(hexValue)) {
            return "#" + hexValue.toUpperCase();
        }
        return "";
    }

    function getCssColorFromExcelFill(fill) {
        if (!fill) {
            return "";
        }
        if (fill.type === "pattern" && fill.pattern && fill.pattern !== "none") {
            return getCssColorFromExcelColor(fill.fgColor) || getCssColorFromExcelColor(fill.bgColor);
        }
        return getCssColorFromExcelColor(fill.fgColor) || getCssColorFromExcelColor(fill.bgColor);
    }

    function getCssBorderSpecFromExcelStyle(styleName) {
        var normalized = String(styleName || "").toLowerCase();
        var specs = {
            hair: { width: "1px", style: "dotted" },
            thin: { width: "1px", style: "solid" },
            medium: { width: "2px", style: "solid" },
            thick: { width: "3px", style: "solid" },
            double: { width: "3px", style: "double" },
            dotted: { width: "1px", style: "dotted" },
            dashed: { width: "1px", style: "dashed" },
            mediumdashed: { width: "2px", style: "dashed" },
            dashdot: { width: "1px", style: "dashed" },
            mediumdashdot: { width: "2px", style: "dashed" },
            dashdotdot: { width: "1px", style: "dotted" },
            mediumdashdotdot: { width: "2px", style: "dotted" },
            slantdashdot: { width: "1px", style: "dashed" },
        };
        return specs[normalized] || null;
    }

    function applyExcelBorderSideStyle(style, sideName, borderSide) {
        if (!style || !borderSide || !borderSide.style) {
            return;
        }
        var borderSpec = getCssBorderSpecFromExcelStyle(borderSide.style);
        if (!borderSpec) {
            return;
        }
        var cssPrefix = "border" + sideName.charAt(0).toUpperCase() + sideName.slice(1);
        style[cssPrefix + "Width"] = borderSpec.width;
        style[cssPrefix + "Style"] = borderSpec.style;
        style[cssPrefix + "Color"] = "var(--handrive-spreadsheet-cell-border-strong, #1f2937)";
    }

    function applyExcelBorderStyle(style, border) {
        if (!style || !border) {
            return;
        }
        ["top", "right", "bottom", "left"].forEach(function (sideName) {
            applyExcelBorderSideStyle(style, sideName, border[sideName]);
        });
    }

    function mapHorizontalAlignment(value) {
        var normalized = String(value || "").toLowerCase();
        if (normalized === "center" || normalized === "centercontinuous") return "center";
        if (normalized === "right") return "right";
        if (normalized === "left") return "left";
        if (normalized === "justify" || normalized === "distributed") return "justify";
        return "";
    }

    function mapVerticalAlignment(value) {
        var normalized = String(value || "").toLowerCase();
        if (normalized === "middle" || normalized === "center") return "middle";
        if (normalized === "top") return "top";
        if (normalized === "bottom") return "bottom";
        return "";
    }

    function getExcelCellDisplayValue(cell) {
        if (!cell) {
            return "";
        }
        if (typeof cell.text === "string" && cell.text !== "") {
            return cell.text;
        }
        var value = cell.value;
        if (value === null || typeof value === "undefined") {
            return "";
        }
        if (value instanceof Date) {
            return value;
        }
        if (typeof value !== "object") {
            return value;
        }
        if (Array.isArray(value.richText)) {
            return value.richText.map(function (part) {
                return String(part && part.text ? part.text : "");
            }).join("");
        }
        if (value.formula || value.sharedFormula) {
            if (value.result !== null && typeof value.result !== "undefined") {
                return value.result;
            }
            return value.formula ? "=" + value.formula : "";
        }
        if (value.text) {
            return value.text;
        }
        if (value.error) {
            return value.error;
        }
        return String(value);
    }

    function hasExcelCellValue(cell) {
        if (!cell || cell.value === null || typeof cell.value === "undefined") {
            return false;
        }
        return String(getExcelCellDisplayValue(cell)).trim() !== "";
    }

    function hasExcelBorderStyle(border) {
        return ["top", "right", "bottom", "left"].some(function (sideName) {
            return Boolean(border && border[sideName] && border[sideName].style);
        });
    }

    function hasExcelCellBorderStyle(cell) {
        if (!cell) {
            return false;
        }
        var resolvedCell = cell.master ? cell.master : cell;
        var border = resolvedCell.border || (resolvedCell.style && resolvedCell.style.border);
        return hasExcelBorderStyle(border);
    }

    function getExcelCellStyle(cell) {
        if (!cell) {
            return null;
        }
        var style = {};
        var fill = cell.fill || (cell.style && cell.style.fill);
        var font = cell.font || (cell.style && cell.style.font);
        var alignment = cell.alignment || (cell.style && cell.style.alignment);
        var border = cell.border || (cell.style && cell.style.border);
        var backgroundColor = getCssColorFromExcelFill(fill);
        if (backgroundColor) {
            style.backgroundColor = backgroundColor;
        }
        applyExcelBorderStyle(style, border);
        if (font) {
            var fontColor = getCssColorFromExcelColor(font.color);
            if (fontColor) {
                style.color = fontColor;
            }
            if (font.bold) {
                style.fontWeight = "700";
            }
            if (font.italic) {
                style.fontStyle = "italic";
            }
            var decorations = [];
            if (font.underline) {
                decorations.push("underline");
            }
            if (font.strike) {
                decorations.push("line-through");
            }
            if (decorations.length) {
                style.textDecoration = decorations.join(" ");
            }
            if (font.size) {
                style.fontSize = Math.max(9, Math.round(Number(font.size) * 1.333)) + "px";
            }
            if (font.name) {
                style.fontFamily = String(font.name) + ", Inter, \"Noto Sans KR\", sans-serif";
            }
        }
        if (alignment) {
            var horizontal = mapHorizontalAlignment(alignment.horizontal);
            var vertical = mapVerticalAlignment(alignment.vertical);
            if (horizontal) {
                style.textAlign = horizontal;
            }
            if (vertical) {
                style.verticalAlign = vertical;
            }
            if (alignment.wrapText) {
                style.whiteSpace = "normal";
                style.lineHeight = "1.35";
            }
        }
        return Object.keys(style).length ? style : null;
    }

    function decodeExcelRange(rangeValue) {
        var rangeText = String(rangeValue || "").replace(/\$/g, "").trim();
        if (!rangeText) {
            return null;
        }
        if (rangeText.indexOf("!") !== -1) {
            rangeText = rangeText.split("!").pop();
        }
        try {
            return window.XLSX.utils.decode_range(rangeText);
        } catch (error) {
            return null;
        }
    }

    function extractWorksheetMergeCells(worksheet) {
        var ranges = [];
        if (worksheet && worksheet.model && Array.isArray(worksheet.model.merges)) {
            ranges = worksheet.model.merges.slice();
        } else if (worksheet && worksheet._merges) {
            ranges = Object.keys(worksheet._merges).map(function (key) {
                var merge = worksheet._merges[key];
                return merge && (merge.range || merge.ref || merge.model || key);
            });
        }
        return ranges.map(function (rangeValue) {
            var decoded = decodeExcelRange(rangeValue);
            if (!decoded) {
                return null;
            }
            var rowspan = decoded.e.r - decoded.s.r + 1;
            var colspan = decoded.e.c - decoded.s.c + 1;
            if (rowspan <= 1 && colspan <= 1) {
                return null;
            }
            return {
                row: decoded.s.r,
                col: decoded.s.c,
                rowspan: rowspan,
                colspan: colspan,
            };
        }).filter(Boolean);
    }

    function buildMergeChildLookup(mergeCells) {
        var lookup = {};
        (Array.isArray(mergeCells) ? mergeCells : []).forEach(function (merge) {
            for (var rowIndex = merge.row; rowIndex < merge.row + merge.rowspan; rowIndex += 1) {
                for (var columnIndex = merge.col; columnIndex < merge.col + merge.colspan; columnIndex += 1) {
                    if (rowIndex !== merge.row || columnIndex !== merge.col) {
                        lookup[getCellKey(rowIndex, columnIndex)] = true;
                    }
                }
            }
        });
        return lookup;
    }

    function includeWorksheetCellBounds(bounds, rowIndex, columnIndex) {
        if (!bounds || !Number.isFinite(rowIndex) || !Number.isFinite(columnIndex) || rowIndex < 1 || columnIndex < 1) {
            return;
        }
        bounds.maxRow = Math.max(bounds.maxRow, rowIndex);
        bounds.maxCol = Math.max(bounds.maxCol, columnIndex);
    }

    function getWorksheetBounds(worksheet, mergeCells) {
        var bounds = { maxRow: 0, maxCol: 0 };
        var printableCellKeys = new Set();

        function includeCell(rowIndex, columnIndex) {
            includeWorksheetCellBounds(bounds, rowIndex, columnIndex);
            printableCellKeys.add(getCellKey(rowIndex - 1, columnIndex - 1));
        }

        function includeCellIfNeeded(cell, rowIndex, columnIndex) {
            if (!cell) {
                return;
            }
            if (hasExcelCellValue(cell) || hasExcelCellBorderStyle(cell)) {
                includeCell(rowIndex, columnIndex);
            }
        }

        if (Array.isArray(worksheet && worksheet._rows)) {
            worksheet._rows.forEach(function (row, rowOffset) {
                if (!row) {
                    return;
                }
                var rowNumber = Number(row.number || rowOffset + 1);
                if (Array.isArray(row._cells)) {
                    row._cells.forEach(function (cell, columnOffset) {
                        if (cell) {
                            includeCellIfNeeded(cell, rowNumber, Number(cell.col || columnOffset + 1));
                        }
                    });
                } else if (typeof row.eachCell === "function") {
                    row.eachCell({ includeEmpty: false }, function (cell, columnNumber) {
                        includeCellIfNeeded(cell, rowNumber, columnNumber);
                    });
                }
            });
        } else if (worksheet && typeof worksheet.eachRow === "function") {
            worksheet.eachRow({ includeEmpty: false }, function (row, rowNumber) {
                row.eachCell({ includeEmpty: false }, function (cell, columnNumber) {
                    includeCellIfNeeded(cell, rowNumber, columnNumber);
                });
            });
        }

        (Array.isArray(mergeCells) ? mergeCells : []).forEach(function (merge) {
            if (!mergeContainsPrintableCell(merge, printableCellKeys)) {
                return;
            }
            bounds.maxRow = Math.max(bounds.maxRow, merge.row + merge.rowspan);
            bounds.maxCol = Math.max(bounds.maxCol, merge.col + merge.colspan);
        });
        return { rows: Math.max(bounds.maxRow, 1), cols: Math.max(bounds.maxCol, 1) };
    }

    function getWorksheetColumnWidths(worksheet, columnCount) {
        var widths = [];
        for (var index = 1; index <= columnCount; index += 1) {
            var column = worksheet.getColumn(index);
            if (column && column.width && column.isCustomWidth) {
                widths[index - 1] = Math.max(28, Math.round(Number(column.width) * 7 + 5));
            }
        }
        return widths;
    }

    function getWorksheetRowHeights(worksheet, rowCount) {
        var heights = [];
        for (var index = 1; index <= rowCount; index += 1) {
            var row = worksheet.getRow(index);
            if (row && row.height) {
                heights[index - 1] = Math.max(18, Math.round(Number(row.height) * 1.333));
            }
        }
        return heights;
    }

    function parseExcelJsWorksheet(worksheet, index) {
        var mergeCells = extractWorksheetMergeCells(worksheet);
        var mergeChildLookup = buildMergeChildLookup(mergeCells);
        var bounds = getWorksheetBounds(worksheet, mergeCells);
        var data = [];
        var cellStyles = {};
        for (var rowIndex = 1; rowIndex <= bounds.rows; rowIndex += 1) {
            var row = worksheet.getRow(rowIndex);
            var rowData = [];
            for (var columnIndex = 1; columnIndex <= bounds.cols; columnIndex += 1) {
                var cell = row.getCell(columnIndex);
                var zeroRow = rowIndex - 1;
                var zeroCol = columnIndex - 1;
                var key = getCellKey(zeroRow, zeroCol);
                var displayValue = mergeChildLookup[key] ? "" : getExcelCellDisplayValue(cell);
                rowData.push(normalizeCellValue(displayValue));
                var cellStyle = getExcelCellStyle(cell && cell.master ? cell.master : cell);
                if (cellStyle) {
                    cellStyles[key] = cellStyle;
                }
            }
            data.push(rowData);
        }
        var normalizedData = normalizeSheetData(data);
        return {
            name: sanitizeSheetName(worksheet.name, "Sheet" + String(index + 1)),
            data: normalizedData,
            originalRowCount: normalizedData.length,
            originalColCount: getSheetMaxColumnCount(normalizedData),
            cellStyles: cellStyles,
            mergeCells: mergeCells,
            colWidths: getWorksheetColumnWidths(worksheet, bounds.cols),
            rowHeights: getWorksheetRowHeights(worksheet, bounds.rows),
        };
    }

    function parseWorkbookWithExcelJs(arrayBuffer) {
        ensureExcelJs();
        var workbook = new window.ExcelJS.Workbook();
        return workbook.xlsx.load(arrayBuffer).then(function () {
            var worksheets = Array.isArray(workbook.worksheets) ? workbook.worksheets : [];
            var sheets = worksheets.map(function (worksheet, index) {
                return parseExcelJsWorksheet(worksheet, index);
            });
            if (!sheets.length) {
                var emptyData = normalizeSheetData([[""]]);
                sheets.push({
                    name: "Sheet1",
                    data: emptyData,
                    originalRowCount: emptyData.length,
                    originalColCount: getSheetMaxColumnCount(emptyData),
                });
            }
            return { sheets: sheets, sourceWorkbook: null, sourceArrayBuffer: arrayBuffer };
        });
    }

    function parseWorkbookWithSheetJs(arrayBuffer, extension) {
        var workbook;
        if (extension === ".csv") {
            var decoder = window.TextDecoder ? new TextDecoder("utf-8") : null;
            var csvText = decoder
                ? decoder.decode(new Uint8Array(arrayBuffer))
                : String.fromCharCode.apply(null, Array.from(new Uint8Array(arrayBuffer)));
            workbook = window.XLSX.read(csvText, { type: "string", raw: false });
        } else {
            workbook = window.XLSX.read(arrayBuffer, {
                type: "array",
                cellDates: true,
                cellFormula: true,
                cellText: false,
            });
        }

        var sheetNames = Array.isArray(workbook.SheetNames) ? workbook.SheetNames : [];
        var sheets = sheetNames.map(function (sheetName, index) {
            var worksheet = workbook.Sheets[sheetName];
            var data = worksheet
                ? window.XLSX.utils.sheet_to_json(worksheet, {
                    header: 1,
                    defval: "",
                    raw: false,
                    blankrows: true,
                })
                : [];
            var normalizedData = normalizeSheetData(data);
            return {
                name: sanitizeSheetName(sheetName, "Sheet" + String(index + 1)),
                data: normalizedData,
                originalRowCount: normalizedData.length,
                originalColCount: getSheetMaxColumnCount(normalizedData),
            };
        });
        if (!sheets.length) {
            var emptyData = normalizeSheetData([[""]]);
            sheets.push({
                name: "Sheet1",
                data: emptyData,
                originalRowCount: emptyData.length,
                originalColCount: getSheetMaxColumnCount(emptyData),
            });
        }
        return { sheets: sheets, sourceWorkbook: null, sourceArrayBuffer: null };
    }

    function parseWorkbook(arrayBuffer, extension) {
        if (extension === ".xlsx" && window.ExcelJS && window.ExcelJS.Workbook) {
            return parseWorkbookWithExcelJs(arrayBuffer).catch(function () {
                return parseWorkbookWithSheetJs(arrayBuffer, extension);
            });
        }
        return Promise.resolve(parseWorkbookWithSheetJs(arrayBuffer, extension));
    }

    function encodeUtf8Base64(text) {
        if (window.TextEncoder) {
            var bytes = new TextEncoder().encode(String(text || ""));
            var binary = "";
            var chunkSize = 0x8000;
            for (var index = 0; index < bytes.length; index += chunkSize) {
                var chunk = bytes.subarray(index, index + chunkSize);
                binary += String.fromCharCode.apply(null, Array.from(chunk));
            }
            return window.btoa(binary);
        }
        return window.btoa(unescape(encodeURIComponent(String(text || ""))));
    }

    function base64ToBlob(base64Value, mimeType) {
        var binary = window.atob(base64Value);
        var bytes = new Uint8Array(binary.length);
        for (var index = 0; index < binary.length; index += 1) {
            bytes[index] = binary.charCodeAt(index);
        }
        return new Blob([bytes], { type: mimeType || "application/octet-stream" });
    }

    function buildWorkbookBase64(sheets, extension) {
        var normalizedExtension = SUPPORTED_EXTENSIONS.has(extension) ? extension : ".xlsx";
        if (normalizedExtension === ".csv") {
            var csvSheet = (sheets && sheets[0]) || { data: [[""]] };
            var csvWorksheet = window.XLSX.utils.aoa_to_sheet(trimSheetData(csvSheet.data));
            return encodeUtf8Base64(window.XLSX.utils.sheet_to_csv(csvWorksheet));
        }

        var workbook = window.XLSX.utils.book_new();
        (Array.isArray(sheets) && sheets.length ? sheets : [{ name: "Sheet1", data: [[""]] }]).forEach(function (sheet, index) {
            var worksheet = window.XLSX.utils.aoa_to_sheet(trimSheetData(sheet.data));
            window.XLSX.utils.book_append_sheet(
                workbook,
                worksheet,
                sanitizeSheetName(sheet.name, "Sheet" + String(index + 1))
            );
        });
        return window.XLSX.write(workbook, {
            bookType: normalizedExtension === ".xls" ? "xls" : "xlsx",
            type: "base64",
            bookSST: true,
        });
    }

    function parseCssColor(value) {
        var colorText = String(value || "").trim();
        var match;
        if (!colorText || colorText === "transparent") {
            return null;
        }
        if (/^#[0-9a-fA-F]{3}$/.test(colorText)) {
            return {
                r: parseInt(colorText.charAt(1) + colorText.charAt(1), 16),
                g: parseInt(colorText.charAt(2) + colorText.charAt(2), 16),
                b: parseInt(colorText.charAt(3) + colorText.charAt(3), 16),
                a: 1,
            };
        }
        if (/^#[0-9a-fA-F]{6}$/.test(colorText)) {
            return {
                r: parseInt(colorText.slice(1, 3), 16),
                g: parseInt(colorText.slice(3, 5), 16),
                b: parseInt(colorText.slice(5, 7), 16),
                a: 1,
            };
        }
        match = colorText.match(/^rgba?\(([^)]+)\)$/i);
        if (match) {
            var parts = match[1].split(",").map(function (part) {
                return part.trim();
            });
            if (parts.length >= 3) {
                return {
                    r: Math.max(0, Math.min(255, Number(parts[0]))),
                    g: Math.max(0, Math.min(255, Number(parts[1]))),
                    b: Math.max(0, Math.min(255, Number(parts[2]))),
                    a: parts.length >= 4 ? Math.max(0, Math.min(1, Number(parts[3]))) : 1,
                };
            }
        }
        return null;
    }

    function blendColor(foreground, background) {
        var fg = foreground || { r: 0, g: 0, b: 0, a: 0 };
        var bg = background || { r: 255, g: 255, b: 255, a: 1 };
        var alpha = typeof fg.a === "number" ? fg.a : 1;
        if (alpha >= 1) {
            return { r: fg.r, g: fg.g, b: fg.b, a: 1 };
        }
        return {
            r: Math.round(fg.r * alpha + bg.r * (1 - alpha)),
            g: Math.round(fg.g * alpha + bg.g * (1 - alpha)),
            b: Math.round(fg.b * alpha + bg.b * (1 - alpha)),
            a: 1,
        };
    }

    function getRelativeLuminance(color) {
        function channel(value) {
            var normalized = value / 255;
            return normalized <= 0.03928
                ? normalized / 12.92
                : Math.pow((normalized + 0.055) / 1.055, 2.4);
        }
        if (!color) {
            return 1;
        }
        return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
    }

    function getContrastRatio(firstColor, secondColor) {
        var first = getRelativeLuminance(firstColor);
        var second = getRelativeLuminance(secondColor);
        var light = Math.max(first, second);
        var dark = Math.min(first, second);
        return (light + 0.05) / (dark + 0.05);
    }

    function colorToRgbText(color) {
        return "rgb(" + Math.round(color.r) + ", " + Math.round(color.g) + ", " + Math.round(color.b) + ")";
    }

    function escapeHtml(value) {
        return String(value === null || typeof value === "undefined" ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function camelToKebab(value) {
        return String(value || "").replace(/[A-Z]/g, function (match) {
            return "-" + match.toLowerCase();
        });
    }

    function styleObjectToInlineText(style) {
        var cellStyle = style || {};
        return Object.keys(cellStyle).map(function (propertyName) {
            return camelToKebab(propertyName) + ":" + String(cellStyle[propertyName] || "");
        }).join(";");
    }

    function getEffectiveBackgroundColor(element) {
        var current = element;
        while (current && current.nodeType === 1) {
            var color = parseCssColor(window.getComputedStyle(current).backgroundColor);
            if (color && color.a > 0) {
                return blendColor(color, getEffectiveBackgroundColor(current.parentElement));
            }
            current = current.parentElement;
        }
        return parseCssColor(window.getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
    }

    function isDarkTheme() {
        return Boolean(document.body && document.body.classList.contains("theme-dark"));
    }

    function chooseReadableTextColor(backgroundColor) {
        var black = { r: 20, g: 20, b: 20, a: 1 };
        var white = { r: 245, g: 245, b: 245, a: 1 };
        return getContrastRatio(black, backgroundColor) >= getContrastRatio(white, backgroundColor) ? black : white;
    }

    function getAutoAdjustedTextColor(textColor, backgroundColor, hadExplicitTextColor) {
        var ratio = textColor && backgroundColor ? getContrastRatio(textColor, backgroundColor) : 21;
        var minimumRatio = hadExplicitTextColor ? 3.8 : 4.5;
        if (ratio >= minimumRatio) {
            return null;
        }
        if (!hadExplicitTextColor && !isDarkTheme()) {
            return null;
        }
        return chooseReadableTextColor(backgroundColor);
    }

    function getPrintAdjustedCellStyle(style) {
        var cellStyle = Object.assign({}, style || {});
        var explicitBackground = parseCssColor(cellStyle.backgroundColor);
        if (!explicitBackground) {
            return cellStyle;
        }
        var baseBackground = { r: 255, g: 255, b: 255, a: 1 };
        var renderedBackground = blendColor(explicitBackground, baseBackground);
        var explicitText = parseCssColor(cellStyle.color);
        var renderedText = explicitText || { r: 20, g: 20, b: 20, a: 1 };
        var adjustedText = getAutoAdjustedTextColor(renderedText, renderedBackground, Boolean(explicitText));
        if (adjustedText) {
            cellStyle.color = colorToRgbText(adjustedText);
        }
        return cellStyle;
    }

    function resetStyledCell(td) {
        td.classList.remove("htDimmed");
        [
            "backgroundColor",
            "color",
            "fontWeight",
            "fontStyle",
            "textDecoration",
            "fontSize",
            "fontFamily",
            "textAlign",
            "verticalAlign",
            "whiteSpace",
            "lineHeight",
            "borderTopWidth",
            "borderTopStyle",
            "borderTopColor",
            "borderRightWidth",
            "borderRightStyle",
            "borderRightColor",
            "borderBottomWidth",
            "borderBottomStyle",
            "borderBottomColor",
            "borderLeftWidth",
            "borderLeftStyle",
            "borderLeftColor",
        ].forEach(function (propertyName) {
            td.style[propertyName] = "";
        });
    }

    function applyCellStyle(td, style) {
        var cellStyle = style || {};
        Object.keys(cellStyle).forEach(function (propertyName) {
            td.style[propertyName] = cellStyle[propertyName];
        });
        var explicitBackground = parseCssColor(cellStyle.backgroundColor);
        var baseBackground = getEffectiveBackgroundColor(td);
        var renderedBackground = explicitBackground ? blendColor(explicitBackground, baseBackground) : baseBackground;
        var explicitText = parseCssColor(cellStyle.color);
        var renderedText = explicitText || parseCssColor(window.getComputedStyle(td).color);
        var adjustedText = getAutoAdjustedTextColor(renderedText, renderedBackground, Boolean(explicitText));
        if (adjustedText) {
            td.style.color = colorToRgbText(adjustedText);
        }
    }

    function createSheetRenderer(sheet) {
        return function (instance, td, row, col, prop, value, cellProperties) {
            window.Handsontable.renderers.TextRenderer.apply(this, arguments);
            resetStyledCell(td);
            var style = sheet && sheet.cellStyles ? sheet.cellStyles[getCellKey(row, col)] : null;
            applyCellStyle(td, style);
        };
    }

    function getSheetHotSettings(sheet) {
        var renderer = createSheetRenderer(sheet || {});
        var settings = {
            mergeCells: Array.isArray(sheet && sheet.mergeCells) ? sheet.mergeCells : [],
            rowHeaderWidth: ROW_HEADER_WIDTH,
            minRows: MIN_ROWS,
            minCols: MIN_COLS,
            readOnlyCellClassName: "",
            cells: function () {
                return { renderer: renderer };
            },
            afterRenderer: function (td) {
                if (td) {
                    td.classList.remove("htDimmed");
                }
            },
        };
        if (Array.isArray(sheet && sheet.colWidths) && sheet.colWidths.length) {
            settings.colWidths = sheet.colWidths;
        }
        if (Array.isArray(sheet && sheet.rowHeights) && sheet.rowHeights.length) {
            settings.rowHeights = sheet.rowHeights;
        }
        return settings;
    }

    function getExcelJsSaveValue(value) {
        if (value === null || typeof value === "undefined" || value === "") {
            return null;
        }
        if (value instanceof Date) {
            return value;
        }
        if (typeof value === "string" && value.charAt(0) === "=" && value.length > 1) {
            return { formula: value.slice(1) };
        }
        return value;
    }

    function valuesMatchForSave(currentValue, originalValue) {
        var left = currentValue instanceof Date ? currentValue.toISOString() : String(currentValue === null || typeof currentValue === "undefined" ? "" : currentValue);
        var right = originalValue instanceof Date ? originalValue.toISOString() : String(originalValue === null || typeof originalValue === "undefined" ? "" : originalValue);
        return left === right;
    }

    function updateExcelJsWorkbookFromSheets(workbook, sheets) {
        if (!workbook || !Array.isArray(workbook.worksheets)) {
            return null;
        }
        (Array.isArray(sheets) && sheets.length ? sheets : [{ name: "Sheet1", data: [[""]] }]).forEach(function (sheet, sheetIndex) {
            var worksheet = workbook.worksheets[sheetIndex] || workbook.addWorksheet(sanitizeSheetName(sheet.name, "Sheet" + String(sheetIndex + 1)));
            var currentData = normalizeSheetData(sheet.data);
            var rowCount = Math.max(currentData.length, Number(sheet.originalRowCount) || 0);
            var columnCount = Math.max(getSheetMaxColumnCount(currentData), Number(sheet.originalColCount) || 0);
            var mergeChildLookup = buildMergeChildLookup(sheet.mergeCells);
            for (var rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
                var worksheetRow = worksheet.getRow(rowIndex + 1);
                for (var columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
                    var key = getCellKey(rowIndex, columnIndex);
                    if (mergeChildLookup[key]) {
                        continue;
                    }
                    var currentRow = currentData[rowIndex] || [];
                    var currentValue = currentRow[columnIndex] === null || typeof currentRow[columnIndex] === "undefined" ? "" : currentRow[columnIndex];
                    var originalValue = getExcelCellDisplayValue(worksheetRow.getCell(columnIndex + 1));
                    if (valuesMatchForSave(currentValue, originalValue)) {
                        continue;
                    }
                    worksheetRow.getCell(columnIndex + 1).value = getExcelJsSaveValue(currentValue);
                }
            }
        });
        return workbook;
    }

    function buildWorkbookPayloadAsync(sheets, extension, sourceWorkbook, sourceArrayBuffer) {
        if (extension === ".xlsx" && sourceWorkbook && sourceWorkbook.xlsx && typeof sourceWorkbook.xlsx.writeBuffer === "function") {
            updateExcelJsWorkbookFromSheets(sourceWorkbook, sheets);
            return sourceWorkbook.xlsx.writeBuffer().then(function (arrayBuffer) {
                return {
                    dataBase64: arrayBufferToBase64(arrayBuffer),
                    sourceWorkbook: sourceWorkbook,
                    sourceArrayBuffer: arrayBuffer,
                };
            });
        }
        if (extension === ".xlsx" && sourceArrayBuffer && window.ExcelJS && window.ExcelJS.Workbook) {
            var workbook = new window.ExcelJS.Workbook();
            var workbookBuffer = sourceArrayBuffer.slice ? sourceArrayBuffer.slice(0) : sourceArrayBuffer;
            return workbook.xlsx.load(workbookBuffer)
                .then(function () {
                    updateExcelJsWorkbookFromSheets(workbook, sheets);
                    return workbook.xlsx.writeBuffer();
                })
                .then(function (arrayBuffer) {
                    return {
                        dataBase64: arrayBufferToBase64(arrayBuffer),
                        sourceWorkbook: null,
                        sourceArrayBuffer: arrayBuffer,
                    };
                });
        }
        return Promise.resolve({
            dataBase64: buildWorkbookBase64(sheets, extension),
            sourceWorkbook: null,
            sourceArrayBuffer: null,
        });
    }

    function refreshOriginalSheetBounds(sheets) {
        (Array.isArray(sheets) ? sheets : []).forEach(function (sheet) {
            var data = normalizeSheetData(sheet.data);
            sheet.originalRowCount = data.length;
            sheet.originalColCount = getSheetMaxColumnCount(data);
        });
    }

    function getActiveHotData() {
        if (!activeState || !activeState.hot) {
            return [];
        }
        return normalizeSheetData(activeState.hot.getData());
    }

    function commitActiveSheet() {
        if (!activeState || !activeState.sheets || !activeState.sheets.length) {
            return;
        }
        activeState.sheets[activeState.currentIndex].data = getActiveHotData();
    }

    function setStatus(text, isError) {
        if (!activeState || !activeState.statusEl) {
            return;
        }
        activeState.statusEl.textContent = String(text || "");
        activeState.statusEl.classList.toggle("is-error", Boolean(isError));
    }

    function markDirty(isDirty) {
        if (!activeState) {
            return;
        }
        activeState.dirty = Boolean(isDirty);
        if (typeof activeState.onDirtyChange === "function") {
            activeState.onDirtyChange(activeState.dirty);
        }
    }

    function populateSheetSelect() {
        if (!activeState || !activeState.sheetSelect) {
            return;
        }
        activeState.sheetSelect.innerHTML = "";
        activeState.sheets.forEach(function (sheet, index) {
            var option = document.createElement("option");
            option.value = String(index);
            option.textContent = sheet.name;
            activeState.sheetSelect.appendChild(option);
        });
        activeState.sheetSelect.value = String(activeState.currentIndex);
        activeState.sheetSelect.hidden = activeState.sheets.length <= 1;
    }

    function createHot() {
        if (!activeState || !activeState.hotContainer) {
            return;
        }
        if (activeState.hot) {
            activeState.hot.destroy();
            activeState.hot = null;
        }
        var sheet = activeState.sheets[activeState.currentIndex] || { data: normalizeSheetData([[""]]) };
        activeState.hotContainer.innerHTML = "";
        var hotSettings = Object.assign({
            data: normalizeSheetData(sheet.data),
            rowHeaders: true,
            colHeaders: true,
            width: "100%",
            height: "100%",
            stretchH: "none",
            manualColumnResize: true,
            manualRowResize: true,
            contextMenu: !activeState.readOnly,
            filters: true,
            dropdownMenu: true,
            copyPaste: true,
            undo: true,
            readOnly: activeState.readOnly || activeState.disabled,
            licenseKey: activeState.licenseKey,
            exportFile: true,
            afterChange: function (_changes, source) {
                if (!activeState || source === "loadData") {
                    return;
                }
                commitActiveSheet();
                markDirty(true);
            },
            afterCreateRow: function () {
                commitActiveSheet();
                markDirty(true);
            },
            afterCreateCol: function () {
                commitActiveSheet();
                markDirty(true);
            },
            afterRemoveRow: function () {
                commitActiveSheet();
                markDirty(true);
            },
            afterRemoveCol: function () {
                commitActiveSheet();
                markDirty(true);
            },
        }, getSheetHotSettings(sheet));
        activeState.hot = new window.Handsontable(activeState.hotContainer, hotSettings);
        window.requestAnimationFrame(function () {
            if (activeState && activeState.hot) {
                activeState.hot.render();
            }
        });
    }

    function switchSheet(index) {
        if (!activeState || !activeState.sheets[index]) {
            return;
        }
        commitActiveSheet();
        activeState.currentIndex = index;
        populateSheetSelect();
        createHot();
    }

    function appendRow() {
        if (!activeState || !activeState.hot || activeState.readOnly || activeState.disabled) {
            return;
        }
        var data = getActiveHotData();
        var colCount = Math.max(activeState.hot.countCols(), MIN_COLS);
        data.push(Array(colCount).fill(""));
        activeState.sheets[activeState.currentIndex].data = data;
        activeState.hot.loadData(data);
        markDirty(true);
    }

    function appendColumn() {
        if (!activeState || !activeState.hot || activeState.readOnly || activeState.disabled) {
            return;
        }
        var data = getActiveHotData();
        if (!data.length) {
            data = normalizeSheetData([[""]]);
        }
        data.forEach(function (row) {
            row.push("");
        });
        activeState.sheets[activeState.currentIndex].data = data;
        activeState.hot.loadData(data);
        markDirty(true);
    }

    function getExportFilename(extension) {
        var entryName = activeState && activeState.entry ? String(activeState.entry.name || "") : "spreadsheet";
        var cleanName = entryName.replace(/\.[A-Za-z0-9]+$/, "") || "spreadsheet";
        return cleanName + (extension || ".xlsx");
    }

    function downloadBlob(blob, filename) {
        var url = URL.createObjectURL(blob);
        var anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(function () {
            URL.revokeObjectURL(url);
        }, 1000);
    }

    function exportWorkbook() {
        if (!activeState || !activeState.hot) {
            return;
        }
        commitActiveSheet();
        var exportExtension = activeState.extension === ".csv" ? ".csv" : ".xlsx";
        var exportType = exportExtension === ".csv" ? "csv" : "xlsx";
        var filename = getExportFilename(exportExtension).replace(/\.[A-Za-z0-9]+$/, "");
        try {
            var exportPlugin = activeState.hot.getPlugin && activeState.hot.getPlugin("exportFile");
            if (exportPlugin && typeof exportPlugin.downloadFile === "function") {
                exportPlugin.downloadFile(exportType, {
                    filename: filename,
                    sheetName: activeState.sheets[activeState.currentIndex].name,
                    columnHeaders: true,
                    rowHeaders: false,
                });
                return;
            }
        } catch (error) {}

        var base64Value = buildWorkbookBase64(activeState.sheets, exportExtension);
        var mimeType = exportExtension === ".csv"
            ? "text/csv;charset=utf-8"
            : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        downloadBlob(base64ToBlob(base64Value, mimeType), getExportFilename(exportExtension));
    }

    function bindControls() {
        if (!activeState) {
            return;
        }
        if (activeState.sheetSelect) {
            activeState.sheetSelect.onchange = function () {
                switchSheet(Number(activeState.sheetSelect.value) || 0);
            };
        }
        if (activeState.addRowButton) {
            activeState.addRowButton.onclick = appendRow;
        }
        if (activeState.addColumnButton) {
            activeState.addColumnButton.onclick = appendColumn;
        }
        if (activeState.exportButton) {
            activeState.exportButton.onclick = exportWorkbook;
        }
    }

    function clearControlHandlers(state) {
        if (!state) {
            return;
        }
        if (state.sheetSelect) state.sheetSelect.onchange = null;
        if (state.addRowButton) state.addRowButton.onclick = null;
        if (state.addColumnButton) state.addColumnButton.onclick = null;
        if (state.exportButton) state.exportButton.onclick = null;
    }

    function init(options) {
        var settings = options || {};
        var surface = settings.surface || null;
        var entry = settings.entry || null;
        var extension = getPathFileExtension(entry && (entry.path || entry.name));
        if (!surface || !entry || !SUPPORTED_EXTENSIONS.has(extension)) {
            return Promise.reject(new Error("지원하지 않는 스프레드시트 파일입니다."));
        }
        if (!settings.downloadUrl) {
            return Promise.reject(new Error("다운로드 URL이 없습니다."));
        }

        destroy();
        ensureLibraries();

        activeState = {
            surface: surface,
            entry: entry,
            extension: extension,
            licenseKey: getLicenseKey(settings.licenseKey),
            onDirtyChange: settings.onDirtyChange,
            readOnly: Boolean(settings.readOnly),
            disabled: false,
            currentIndex: 0,
            sheets: [],
            sourceWorkbook: null,
            sourceArrayBuffer: null,
            hot: null,
            hotContainer: surface.querySelector("[data-handrive-spreadsheet-hot]"),
            sheetSelect: surface.querySelector("[data-handrive-spreadsheet-sheet]"),
            addRowButton: surface.querySelector("[data-handrive-spreadsheet-add-row]"),
            addColumnButton: surface.querySelector("[data-handrive-spreadsheet-add-col]"),
            exportButton: surface.querySelector("[data-handrive-spreadsheet-export]"),
            statusEl: surface.querySelector("[data-handrive-spreadsheet-status]"),
            dirty: false,
        };
        surface.hidden = false;
        setStatus("", false);
        bindControls();

        return fetch(settings.downloadUrl, { credentials: "same-origin" })
            .then(function (response) {
                if (!response.ok) {
                    throw new Error("스프레드시트 파일을 불러오지 못했습니다.");
                }
                return response.arrayBuffer();
            })
            .then(function (arrayBuffer) {
                if (!activeState || activeState.surface !== surface) {
                    return null;
                }
                return parseWorkbook(arrayBuffer, extension).then(function (parsedWorkbook) {
                    if (!activeState || activeState.surface !== surface) {
                        return null;
                    }
                    activeState.sheets = parsedWorkbook.sheets;
                    activeState.sourceWorkbook = activeState.readOnly ? null : parsedWorkbook.sourceWorkbook;
                    activeState.sourceArrayBuffer = activeState.readOnly ? null : parsedWorkbook.sourceArrayBuffer || null;
                    activeState.currentIndex = 0;
                    populateSheetSelect();
                    createHot();
                    markDirty(false);
                    setStatus("", false);
                    return activeState;
                });
            })
            .catch(function (error) {
                setStatus(error && error.message ? error.message : "스프레드시트 파일을 불러오지 못했습니다.", true);
                throw error;
            });
    }

    function saveToServer(options) {
        var settings = options || {};
        if (!activeState) {
            return Promise.reject(new Error("열린 스프레드시트가 없습니다."));
        }
        if (!settings.saveUrl) {
            return Promise.reject(new Error("저장 API URL이 없습니다."));
        }
        commitActiveSheet();
        var extension = settings.extension && SUPPORTED_EXTENSIONS.has(settings.extension)
            ? settings.extension
            : activeState.extension;

        setStatus("저장 중...", false);
        return buildWorkbookPayloadAsync(activeState.sheets, extension, activeState.sourceWorkbook, activeState.sourceArrayBuffer)
            .then(function (workbookPayload) {
                var payload = {
                    original_path: settings.originalPath || (activeState.entry && activeState.entry.path) || "",
                    target_dir: settings.targetDir || "",
                    filename: settings.filename || (activeState.entry && activeState.entry.name) || "spreadsheet",
                    extension: extension,
                    data_base64: workbookPayload.dataBase64,
                };
                if (settings.commitMessage) {
                    payload.commit_message = settings.commitMessage;
                }
                return fetch(settings.saveUrl, {
                    method: "POST",
                    credentials: "same-origin",
                    headers: {
                        "Content-Type": "application/json",
                        "X-CSRFToken": settings.csrfToken || "",
                    },
                    body: JSON.stringify(payload),
                }).then(function (response) {
                    return { response: response, workbookPayload: workbookPayload };
                });
            })
            .then(function (result) {
                return result.response.json().catch(function () {
                    return {};
                }).then(function (data) {
                    if (!result.response.ok || !data.ok) {
                        throw new Error(data.error || data.message || "스프레드시트 저장 실패");
                    }
                    return { data: data, workbookPayload: result.workbookPayload };
                });
            })
            .then(function (result) {
                activeState.sourceWorkbook = result.workbookPayload.sourceWorkbook || null;
                activeState.sourceArrayBuffer = result.workbookPayload.sourceArrayBuffer || null;
                refreshOriginalSheetBounds(activeState.sheets);
                markDirty(false);
                setStatus("", false);
                return result.data;
            })
            .catch(function (error) {
                setStatus(error && error.message ? error.message : "스프레드시트 저장 실패", true);
                throw error;
            });
    }

    function setDisabled(isDisabled) {
        if (!activeState) {
            return;
        }
        activeState.disabled = Boolean(isDisabled);
        [activeState.sheetSelect, activeState.addRowButton, activeState.addColumnButton, activeState.exportButton].forEach(function (control) {
            if (control) {
                control.disabled = activeState.disabled;
            }
        });
        if (activeState.hot) {
            activeState.hot.updateSettings({ readOnly: activeState.readOnly || activeState.disabled });
        }
    }

    function getIsDirty() {
        return Boolean(activeState && activeState.dirty);
    }

    function destroy() {
        var previousState = activeState;
        activeState = null;
        if (!previousState) {
            return;
        }
        clearControlHandlers(previousState);
        if (previousState.hot) {
            previousState.hot.destroy();
        }
        if (previousState.hotContainer) {
            previousState.hotContainer.innerHTML = "";
        }
        if (previousState.statusEl) {
            previousState.statusEl.textContent = "";
            previousState.statusEl.classList.remove("is-error");
        }
    }

    function tableToData(table) {
        return Array.from(table.querySelectorAll("tr")).map(function (row) {
            return Array.from(row.children).map(function (cell) {
                return String(cell.textContent || "").trim();
            });
        });
    }

    function getPageRoot() {
        return document.querySelector("[data-handrive-page]");
    }

    function getCsrfToken() {
        var meta = document.querySelector('meta[name="csrf-token"]');
        return meta ? String(meta.getAttribute("content") || "").trim() : "";
    }

    function getPathFileName(pathValue) {
        return String(pathValue || "").replace(/\\/g, "/").split("/").pop() || "";
    }

    function getParentPath(pathValue) {
        var parts = String(pathValue || "").replace(/\\/g, "/").split("/");
        parts.pop();
        return parts.join("/");
    }

    function getPreviewSaveUrl() {
        var pageRoot = getPageRoot();
        return pageRoot ? String(pageRoot.dataset.spreadsheetSaveApiUrl || "").trim() : "";
    }

    function getPreviewSaveButton(shell) {
        if (!shell) {
            return null;
        }
        var internalButton = shell.querySelector("[data-handrive-spreadsheet-preview-save]");
        if (internalButton) {
            return internalButton;
        }
        var previewPanel = shell.closest(".handrive-list-preview");
        if (previewPanel) {
            return previewPanel.querySelector("[data-handrive-spreadsheet-preview-save]");
        }
        return document.querySelector(".handrive-toolbar-actions [data-handrive-spreadsheet-preview-save]");
    }

    function appendPreviewSharedQuery(url, pageRoot) {
        var baseUrl = String(url || "").trim();
        if (!baseUrl || !pageRoot) {
            return baseUrl;
        }
        var owner = String(pageRoot.dataset.handriveSharedOwnerUsername || "").trim();
        var slug = String(pageRoot.dataset.handriveSharedSlug || "").trim();
        if (!owner || !slug) {
            return baseUrl;
        }
        var separator = baseUrl.indexOf("?") === -1 ? "?" : "&";
        return baseUrl
            + separator
            + "share_owner=" + encodeURIComponent(owner)
            + "&share_slug=" + encodeURIComponent(slug);
    }

    function buildPreviewDownloadUrl(pathValue) {
        var pageRoot = getPageRoot();
        var downloadApiUrl = pageRoot ? String(pageRoot.dataset.downloadApiUrl || "").trim() : "";
        if (!downloadApiUrl) {
            return "";
        }
        var query = new URLSearchParams({ path: pathValue || "" }).toString();
        return appendPreviewSharedQuery(query ? downloadApiUrl + "?" + query : downloadApiUrl, pageRoot);
    }

    function setPreviewStatus(shell, message, isError, isLoading) {
        if (shell) {
            shell.classList.toggle("is-loading", Boolean(isLoading));
        }
        var status = shell ? shell.querySelector("[data-handrive-spreadsheet-preview-status]") : null;
        if (!status) {
            return;
        }
        status.textContent = String(message || "");
        status.classList.toggle("is-error", Boolean(isError));
    }

    function getPreviewFallbackHotHeight() {
        var viewportHeight = window.visualViewport && window.visualViewport.height
            ? Number(window.visualViewport.height)
            : Number(window.innerHeight || 0);
        if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) {
            return PREVIEW_HOT_MIN_HEIGHT;
        }
        return Math.max(
            PREVIEW_HOT_MIN_HEIGHT,
            Math.min(PREVIEW_HOT_MAX_HEIGHT, Math.floor(viewportHeight - 190))
        );
    }

    function getPreviewHotHeight(state) {
        if (!state || !state.hotContainer) {
            return getPreviewFallbackHotHeight();
        }
        var containerRect = state.hotContainer.getBoundingClientRect();
        var measuredHeight = Math.floor(containerRect.height);
        if (measuredHeight >= 80) {
            return measuredHeight;
        }

        var shellRect = state.shell ? state.shell.getBoundingClientRect() : { height: 0 };
        var toolbar = state.shell ? state.shell.querySelector(".handrive-spreadsheet-preview-toolbar") : null;
        var toolbarHeight = toolbar ? Math.ceil(toolbar.getBoundingClientRect().height) : 0;
        var shellAvailableHeight = Math.floor(Number(shellRect.height || 0) - toolbarHeight - 2);
        if (shellAvailableHeight >= 80) {
            return shellAvailableHeight;
        }

        var previewContent = state.hotContainer.closest(".handrive-list-preview-content");
        var contentHeight = previewContent ? Math.floor(previewContent.getBoundingClientRect().height) : 0;
        var contentAvailableHeight = contentHeight - toolbarHeight - 2;
        if (contentAvailableHeight >= 80) {
            return contentAvailableHeight;
        }
        return getPreviewFallbackHotHeight();
    }

    function refreshPreviewHotLayout(state) {
        if (!state || !state.hot || !state.hotContainer || !state.hotContainer.isConnected) {
            return;
        }
        var height = getPreviewHotHeight(state);
        if (state.lastHotHeight !== height) {
            state.lastHotHeight = height;
            state.hot.updateSettings({ height: height });
        }
        state.hot.render();
    }

    function schedulePreviewHotLayout(state) {
        if (!state || state.layoutRafId !== null) {
            return;
        }
        state.layoutRafId = window.requestAnimationFrame(function () {
            state.layoutRafId = null;
            refreshPreviewHotLayout(state);
            window.requestAnimationFrame(function () {
                refreshPreviewHotLayout(state);
            });
        });
    }

    function disposePreviewState(state) {
        if (!state) {
            return;
        }
        if (state.layoutRafId !== null) {
            window.cancelAnimationFrame(state.layoutRafId);
            state.layoutRafId = null;
        }
        if (state.resizeObserver) {
            state.resizeObserver.disconnect();
            state.resizeObserver = null;
        }
    }

    function cleanupPreviewStates() {
        previewStates = previewStates.filter(function (state) {
            var keep = Boolean(state && state.shell && state.shell.isConnected);
            if (!keep) {
                disposePreviewState(state);
            }
            return keep;
        });
    }

    function scheduleAllPreviewHotLayouts() {
        cleanupPreviewStates();
        previewStates.forEach(function (state) {
            if (state && (!state.shell || isElementVisible(state.shell))) {
                schedulePreviewHotLayout(state);
            }
        });
    }

    function installPreviewLayoutListeners() {
        if (previewLayoutListenersInstalled) {
            return;
        }
        previewLayoutListenersInstalled = true;
        window.addEventListener("resize", scheduleAllPreviewHotLayouts, { passive: true });
        window.addEventListener("orientationchange", scheduleAllPreviewHotLayouts, { passive: true });
        if (window.visualViewport) {
            window.visualViewport.addEventListener("resize", scheduleAllPreviewHotLayouts, { passive: true });
        }
    }

    function installPreviewLayoutObserver(state) {
        if (!state || state.resizeObserver || !window.ResizeObserver) {
            return;
        }
        state.resizeObserver = new window.ResizeObserver(function () {
            schedulePreviewHotLayout(state);
        });
        [
            state.shell,
            state.hotContainer,
            state.hotContainer ? state.hotContainer.closest(".handrive-list-preview-body") : null,
            state.hotContainer ? state.hotContainer.closest(".handrive-list-preview-content") : null,
        ].forEach(function (element) {
            if (element) {
                state.resizeObserver.observe(element);
            }
        });
    }

    function getPreviewHotData(state) {
        if (!state || !state.hot) {
            return [];
        }
        return normalizeSheetData(state.hot.getData());
    }

    function commitPreviewSheet(state) {
        if (!state || !state.hot || !state.sheets || !state.sheets[state.currentIndex]) {
            return;
        }
        state.sheets[state.currentIndex].data = getPreviewHotData(state);
    }

    function updatePreviewSaveButton(state) {
        if (!state || !state.saveButton) {
            return;
        }
        state.saveButton.disabled = !state.editable || state.disabled || !state.dirty;
    }

    function markPreviewDirty(state, isDirty) {
        if (!state || !state.editable) {
            return;
        }
        state.dirty = Boolean(isDirty);
        updatePreviewSaveButton(state);
    }

    function setPreviewDisabled(state, isDisabled) {
        if (!state) {
            return;
        }
        state.disabled = Boolean(isDisabled);
        if (state.sheetSelect) {
            state.sheetSelect.disabled = state.disabled;
        }
        updatePreviewSaveButton(state);
        if (state.hot) {
            state.hot.updateSettings({
                readOnly: !state.editable || state.disabled,
                contextMenu: state.editable && !state.disabled,
            });
        }
    }

    function savePreviewState(state) {
        if (!state || !state.editable || state.disabled) {
            return Promise.resolve(null);
        }
        if (!state.dirty) {
            updatePreviewSaveButton(state);
            return Promise.resolve(null);
        }
        if (!state.saveUrl) {
            setPreviewStatus(state.shell, "저장 API URL이 없습니다.", true, false);
            return Promise.reject(new Error("저장 API URL이 없습니다."));
        }
        commitPreviewSheet(state);
        setPreviewDisabled(state, true);
        setPreviewStatus(state.shell, "저장 중...", false, false);
        return buildWorkbookPayloadAsync(state.sheets, state.extension, state.sourceWorkbook, state.sourceArrayBuffer)
            .then(function (workbookPayload) {
                return fetch(state.saveUrl, {
                    method: "POST",
                    credentials: "same-origin",
                    headers: {
                        "Content-Type": "application/json",
                        "X-CSRFToken": getCsrfToken(),
                    },
                    body: JSON.stringify({
                        original_path: state.pathValue,
                        target_dir: getParentPath(state.pathValue),
                        filename: state.fileName || getPathFileName(state.pathValue) || "spreadsheet",
                        extension: state.extension,
                        data_base64: workbookPayload.dataBase64,
                    }),
                }).then(function (response) {
                    return { response: response, workbookPayload: workbookPayload };
                });
            })
            .then(function (result) {
                return result.response.json().catch(function () {
                    return {};
                }).then(function (data) {
                    if (!result.response.ok || !data.ok) {
                        throw new Error(data.error || data.message || "스프레드시트 저장 실패");
                    }
                    return { data: data, workbookPayload: result.workbookPayload };
                });
            })
            .then(function (result) {
                state.sourceWorkbook = result.workbookPayload.sourceWorkbook || null;
                state.sourceArrayBuffer = result.workbookPayload.sourceArrayBuffer || null;
                refreshOriginalSheetBounds(state.sheets);
                markPreviewDirty(state, false);
                setPreviewStatus(state.shell, "", false, false);
                return result.data;
            })
            .catch(function (error) {
                setPreviewStatus(state.shell, error && error.message ? error.message : "스프레드시트 저장 실패", true, false);
                throw error;
            })
            .finally(function () {
                setPreviewDisabled(state, false);
            });
    }

    function isElementVisible(element) {
        if (!element || !element.isConnected || element.closest("[hidden]")) {
            return false;
        }
        var current = element;
        while (current && current.nodeType === 1) {
            var style = window.getComputedStyle(current);
            if (style.display === "none" || style.visibility === "hidden") {
                return false;
            }
            current = current.parentElement;
        }
        return Boolean(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
    }

    function registerPreviewState(state) {
        previewStates = previewStates.filter(function (candidate) {
            var keep = Boolean(candidate && candidate.shell && candidate.shell.isConnected && candidate.shell !== state.shell);
            if (!keep) {
                disposePreviewState(candidate);
            }
            return keep;
        });
        previewStates.push(state);
    }

    function getActivePreviewShortcutState() {
        cleanupPreviewStates();
        for (var index = previewStates.length - 1; index >= 0; index -= 1) {
            var state = previewStates[index];
            if (state && state.editable && isElementVisible(state.shell)) {
                return state;
            }
        }
        return null;
    }

    function getPreviewStateForElement(element) {
        var target = element || document;
        cleanupPreviewStates();
        for (var index = previewStates.length - 1; index >= 0; index -= 1) {
            var state = previewStates[index];
            if (!state || !state.shell) {
                continue;
            }
            if (
                state.shell === target ||
                (target.contains && target.contains(state.shell)) ||
                (state.shell.contains && state.shell.contains(target))
            ) {
                return state;
            }
        }
        return null;
    }

    function hasPrintableCellValue(value) {
        return String(value === null || typeof value === "undefined" ? "" : value).trim() !== "";
    }

    function hasPrintableBorderStyle(style) {
        var cellStyle = style || {};
        return ["Top", "Right", "Bottom", "Left"].some(function (sideName) {
            var borderStyle = String(cellStyle["border" + sideName + "Style"] || "").trim().toLowerCase();
            var borderWidth = String(cellStyle["border" + sideName + "Width"] || "").trim().toLowerCase();
            return borderStyle && borderStyle !== "none" && borderWidth !== "0" && borderWidth !== "0px";
        });
    }

    function mergeContainsPrintableCell(merge, printableCellKeys) {
        if (!merge || !printableCellKeys) {
            return false;
        }
        var startRow = Number(merge.row || 0);
        var startCol = Number(merge.col || 0);
        var rowCount = Math.max(1, Number(merge.rowspan || 1));
        var colCount = Math.max(1, Number(merge.colspan || 1));
        for (var rowIndex = startRow; rowIndex < startRow + rowCount; rowIndex += 1) {
            for (var columnIndex = startCol; columnIndex < startCol + colCount; columnIndex += 1) {
                if (printableCellKeys.has(getCellKey(rowIndex, columnIndex))) {
                    return true;
                }
            }
        }
        return false;
    }

    function getPrintableBounds(sheet) {
        var data = Array.isArray(sheet && sheet.data) ? sheet.data : [];
        var cellStyles = (sheet && sheet.cellStyles) || {};
        var printableCellKeys = new Set();
        var maxRow = 0;
        var maxCol = 0;
        function includeCell(rowIndex, columnIndex) {
            if (!Number.isFinite(rowIndex) || !Number.isFinite(columnIndex)) {
                return;
            }
            printableCellKeys.add(getCellKey(rowIndex, columnIndex));
            maxRow = Math.max(maxRow, rowIndex + 1);
            maxCol = Math.max(maxCol, columnIndex + 1);
        }
        data.forEach(function (row, rowIndex) {
            (row || []).forEach(function (value, columnIndex) {
                if (hasPrintableCellValue(value)) {
                    includeCell(rowIndex, columnIndex);
                }
            });
        });
        Object.keys(cellStyles).forEach(function (key) {
            if (!hasPrintableBorderStyle(cellStyles[key])) {
                return;
            }
            var parts = key.split(":");
            var rowIndex = Number(parts[0]);
            var columnIndex = Number(parts[1]);
            includeCell(rowIndex, columnIndex);
        });
        (Array.isArray(sheet && sheet.mergeCells) ? sheet.mergeCells : []).forEach(function (merge) {
            if (!mergeContainsPrintableCell(merge, printableCellKeys)) {
                return;
            }
            maxRow = Math.max(maxRow, Number(merge.row || 0) + Number(merge.rowspan || 1));
            maxCol = Math.max(maxCol, Number(merge.col || 0) + Number(merge.colspan || 1));
        });
        return {
            rows: Math.max(1, maxRow),
            cols: Math.max(1, maxCol),
        };
    }

    function buildMergeStartLookup(mergeCells) {
        var lookup = {};
        (Array.isArray(mergeCells) ? mergeCells : []).forEach(function (merge) {
            lookup[getCellKey(merge.row, merge.col)] = merge;
        });
        return lookup;
    }

    function buildPrintableTableHtml(sheet) {
        var printableSheet = sheet || { name: "Sheet1", data: normalizeSheetData([[""]]) };
        var data = normalizeSheetData(printableSheet.data);
        var bounds = getPrintableBounds(printableSheet);
        var mergeStartLookup = buildMergeStartLookup(printableSheet.mergeCells);
        var mergeChildLookup = buildMergeChildLookup(printableSheet.mergeCells);
        var html = '<table class="handrive-print-spreadsheet-table">';
        if (Array.isArray(printableSheet.colWidths) && printableSheet.colWidths.length) {
            html += "<colgroup>";
            for (var colIndex = 0; colIndex < bounds.cols; colIndex += 1) {
                var width = Math.max(28, Math.round(Number(printableSheet.colWidths[colIndex] || 0)));
                html += width
                    ? '<col style="width:' + String(width) + 'px">'
                    : "<col>";
            }
            html += "</colgroup>";
        }
        html += "<tbody>";
        for (var rowIndex = 0; rowIndex < bounds.rows; rowIndex += 1) {
            var rowHeight = Array.isArray(printableSheet.rowHeights) ? Number(printableSheet.rowHeights[rowIndex] || 0) : 0;
            html += rowHeight
                ? '<tr style="height:' + String(Math.max(18, Math.round(rowHeight))) + 'px">'
                : "<tr>";
            for (var columnIndex = 0; columnIndex < bounds.cols; columnIndex += 1) {
                var key = getCellKey(rowIndex, columnIndex);
                if (mergeChildLookup[key]) {
                    continue;
                }
                var merge = mergeStartLookup[key] || null;
                var style = getPrintAdjustedCellStyle(printableSheet.cellStyles ? printableSheet.cellStyles[key] : null);
                var value = ((data[rowIndex] || [])[columnIndex]);
                html += "<td"
                    + (merge && merge.rowspan > 1 ? ' rowspan="' + String(merge.rowspan) + '"' : "")
                    + (merge && merge.colspan > 1 ? ' colspan="' + String(merge.colspan) + '"' : "")
                    + (Object.keys(style).length ? ' style="' + escapeHtml(styleObjectToInlineText(style)) + '"' : "")
                    + ">"
                    + escapeHtml(value)
                    + "</td>";
            }
            html += "</tr>";
        }
        html += "</tbody></table>";
        return html;
    }

    function buildPreviewPrint(element, options) {
        var state = getPreviewStateForElement(element);
        if (!state || !state.sheets || !state.sheets.length) {
            return null;
        }
        if (state.hot) {
            commitPreviewSheet(state);
        }
        var sheet = state.sheets[state.currentIndex] || state.sheets[0];
        var title = String((options && options.title) || state.fileName || getPathFileName(state.pathValue) || "spreadsheet").trim() || "spreadsheet";
        var sheetName = String(sheet && sheet.name ? sheet.name : "Sheet1");
        return {
            title: title,
            bodyHtml:
                '<section class="handrive-print-spreadsheet-live">'
                + '<h1 class="handrive-print-spreadsheet-title">' + escapeHtml(title) + "</h1>"
                + '<div class="handrive-print-spreadsheet-sheet-name">' + escapeHtml(sheetName) + "</div>"
                + buildPrintableTableHtml(sheet)
                + "</section>",
            extraStyle:
                "@page{size:landscape;margin:10mm;}@media print{@page{size:landscape;margin:10mm;}}"
                + "body.handrive-print-spreadsheet-body{overflow:visible;padding:0;background:#fff;color:#111;--handrive-spreadsheet-grid-border:#d0d7de;--handrive-spreadsheet-cell-border-strong:#111827;}"
                + ".handrive-print-spreadsheet-live{display:block;width:100%;max-width:none;overflow:visible;margin:0;padding:0;background:#fff;color:#111;font-family:Inter,\"Noto Sans KR\",Arial,sans-serif;font-size:11px;line-height:1.35;}"
                + ".handrive-print-spreadsheet-title{margin:0 0 4px;color:#111;font-size:16px;font-weight:700;}"
                + ".handrive-print-spreadsheet-sheet-name{margin:0 0 10px;color:#555;font-size:12px;font-weight:600;}"
                + ".handrive-print-spreadsheet-table{width:auto;max-width:none;border-collapse:collapse;border-spacing:0;table-layout:auto;background:#fff;color:#111;}"
                + ".handrive-print-spreadsheet-table tr{break-inside:avoid;page-break-inside:avoid;}"
                + ".handrive-print-spreadsheet-table td{min-width:48px;border:1px solid var(--handrive-spreadsheet-grid-border,#d0d7de);padding:4px 6px;box-sizing:border-box;vertical-align:top;text-align:left;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;background:#fff;color:#111;}",
        };
    }

    function isSaveShortcut(event) {
        return Boolean(
            event &&
            (event.metaKey || event.ctrlKey) &&
            !event.altKey &&
            String(event.key || "").toLowerCase() === "s"
        );
    }

    function installPreviewSaveShortcut() {
        if (previewSaveShortcutInstalled) {
            return;
        }
        previewSaveShortcutInstalled = true;
        document.addEventListener("keydown", function (event) {
            if (!isSaveShortcut(event)) {
                return;
            }
            var state = getActivePreviewShortcutState();
            if (!state) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            if (state.disabled || !state.dirty) {
                updatePreviewSaveButton(state);
                return;
            }
            savePreviewState(state).catch(function () {});
        }, true);
    }

    function createPreviewHot(shell, parsedWorkbook, licenseKey) {
        var hotContainer = shell.querySelector("[data-handrive-spreadsheet-preview-hot]");
        var sheetSelect = shell.querySelector("[data-handrive-spreadsheet-preview-sheet]");
        var saveButton = getPreviewSaveButton(shell);
        if (!hotContainer) {
            return;
        }
        var sheets = parsedWorkbook && Array.isArray(parsedWorkbook.sheets) ? parsedWorkbook.sheets : [];
        var saveUrl = getPreviewSaveUrl();
        var editable = shell.getAttribute("data-editable") === "1" && Boolean(saveUrl);
        var state = {
            shell: shell,
            hotContainer: hotContainer,
            sheetSelect: sheetSelect,
            saveButton: saveButton,
            saveUrl: saveUrl,
            pathValue: String(shell.getAttribute("data-path") || "").trim(),
            fileName: String(shell.getAttribute("data-filename") || "").trim(),
            extension: getPathFileExtension(shell.getAttribute("data-path")) || String(shell.getAttribute("data-extension") || "").trim().toLowerCase() || ".xlsx",
            licenseKey: licenseKey,
            editable: editable,
            disabled: false,
            dirty: false,
            rendering: false,
            currentIndex: 0,
            sheets: sheets.length ? sheets : [{ name: "Sheet1", data: normalizeSheetData([[""]]) }],
            sourceWorkbook: parsedWorkbook && editable ? parsedWorkbook.sourceWorkbook : null,
            sourceArrayBuffer: parsedWorkbook && editable ? parsedWorkbook.sourceArrayBuffer || null : null,
            hot: null,
            layoutRafId: null,
            lastHotHeight: 0,
            resizeObserver: null,
        };
        if (saveButton) {
            saveButton.hidden = !state.editable;
            saveButton.onclick = function () {
                savePreviewState(state).catch(function () {});
            };
        }
        registerPreviewState(state);

        function renderSheet(index) {
            var resolvedIndex = state.sheets[index] ? index : 0;
            var sheet = state.sheets[resolvedIndex] || { data: normalizeSheetData([[""]]) };
            if (state.hot) {
                commitPreviewSheet(state);
            }
            state.currentIndex = resolvedIndex;
            if (sheetSelect) {
                sheetSelect.value = String(state.currentIndex);
            }
            if (state.hot) {
                state.hot.destroy();
                state.hot = null;
            }
            hotContainer.innerHTML = "";
            var data = normalizeSheetData(sheet.data);
            state.rendering = true;
            state.hot = new window.Handsontable(hotContainer, Object.assign({
                data: data,
                rowHeaders: true,
                rowHeaderWidth: ROW_HEADER_WIDTH,
                minRows: MIN_ROWS,
                minCols: MIN_COLS,
                colHeaders: true,
                width: "100%",
                height: getPreviewHotHeight(state),
                stretchH: "none",
                manualColumnResize: true,
                manualRowResize: true,
                contextMenu: state.editable,
                filters: true,
                dropdownMenu: true,
                copyPaste: true,
                undo: true,
                readOnly: !state.editable || state.disabled,
                licenseKey: licenseKey,
                exportFile: true,
                afterChange: function (_changes, source) {
                    if (!state.editable || state.rendering || source === "loadData") {
                        return;
                    }
                    commitPreviewSheet(state);
                    markPreviewDirty(state, true);
                },
                afterCreateRow: function () {
                    commitPreviewSheet(state);
                    markPreviewDirty(state, true);
                },
                afterCreateCol: function () {
                    commitPreviewSheet(state);
                    markPreviewDirty(state, true);
                },
                afterRemoveRow: function () {
                    commitPreviewSheet(state);
                    markPreviewDirty(state, true);
                },
                afterRemoveCol: function () {
                    commitPreviewSheet(state);
                    markPreviewDirty(state, true);
                },
            }, getSheetHotSettings(sheet)));
            window.requestAnimationFrame(function () {
                state.rendering = false;
                updatePreviewSaveButton(state);
                refreshPreviewHotLayout(state);
                schedulePreviewHotLayout(state);
            });
        }

        if (sheetSelect) {
            sheetSelect.innerHTML = "";
            state.sheets.forEach(function (sheet, index) {
                var option = document.createElement("option");
                option.value = String(index);
                option.textContent = sheet.name || ("Sheet" + String(index + 1));
                sheetSelect.appendChild(option);
            });
            sheetSelect.hidden = state.sheets.length <= 1;
            sheetSelect.onchange = function () {
                renderSheet(Number(sheetSelect.value) || 0);
            };
        }
        updatePreviewSaveButton(state);
        installPreviewLayoutListeners();
        installPreviewLayoutObserver(state);
        renderSheet(0);
    }

    function hydrateDirectPreviewShells(root) {
        if (!window.Handsontable || !window.XLSX) {
            return;
        }
        var scope = root || document;
        var shells = Array.from(scope.querySelectorAll ? scope.querySelectorAll("[data-handrive-spreadsheet-preview]") : []);
        shells.forEach(function (shell) {
            if (shell.getAttribute("data-handrive-spreadsheet-preview-bound") === "1") {
                return;
            }
            shell.setAttribute("data-handrive-spreadsheet-preview-bound", "1");
            var pathValue = String(shell.getAttribute("data-path") || "").trim();
            var extension = getPathFileExtension(pathValue) || String(shell.getAttribute("data-extension") || "").trim().toLowerCase();
            var downloadUrl = buildPreviewDownloadUrl(pathValue);
            if (!downloadUrl) {
                setPreviewStatus(shell, "다운로드 URL이 없습니다.", true, false);
                return;
            }
            setPreviewStatus(shell, "", false, true);
            fetch(downloadUrl, { credentials: "same-origin" })
                .then(function (response) {
                    if (!response.ok) {
                        throw new Error("스프레드시트를 불러오지 못했습니다.");
                    }
                    return response.arrayBuffer();
                })
                .then(function (arrayBuffer) {
                    return parseWorkbook(arrayBuffer, extension).then(function (parsedWorkbook) {
                        createPreviewHot(shell, parsedWorkbook, getLicenseKey(""));
                        setPreviewStatus(shell, "", false, false);
                    });
                })
                .catch(function (error) {
                    setPreviewStatus(shell, error && error.message ? error.message : "스프레드시트를 불러오지 못했습니다.", true, false);
                });
        });
    }

    function hydrateTablePreviews(root) {
        if (!window.Handsontable) {
            return;
        }
        var scope = root || document;
        var tables = Array.from(scope.querySelectorAll ? scope.querySelectorAll(".handrive-office-table") : []);
        tables.forEach(function (table) {
            if (table.getAttribute("data-handrive-spreadsheet-preview-bound") === "1") {
                return;
            }
            var wrap = table.closest(".handrive-office-table-wrap");
            if (!wrap) {
                return;
            }
            table.setAttribute("data-handrive-spreadsheet-preview-bound", "1");
            wrap.classList.add("is-handsontable-hydrated");
            var hotContainer = document.createElement("div");
            hotContainer.className = "handrive-spreadsheet-preview-hot";
            wrap.appendChild(hotContainer);
            var data = normalizeSheetData(tableToData(table));
            var height = Math.min(520, Math.max(180, data.length * 28 + 34));
            new window.Handsontable(hotContainer, {
                data: data,
                rowHeaders: true,
                rowHeaderWidth: ROW_HEADER_WIDTH,
                minRows: MIN_ROWS,
                minCols: MIN_COLS,
                colHeaders: true,
                width: "100%",
                height: height,
                stretchH: "none",
                readOnly: true,
                licenseKey: getLicenseKey(""),
            });
        });
    }

    function installPreviewHydration() {
        installPreviewSaveShortcut();
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", function () {
                hydrateDirectPreviewShells(document);
                hydrateTablePreviews(document);
            }, { once: true });
        } else {
            hydrateDirectPreviewShells(document);
            hydrateTablePreviews(document);
        }
        if (!window.MutationObserver) {
            return;
        }
        var observer = new MutationObserver(function (mutations) {
            mutations.forEach(function (mutation) {
                Array.from(mutation.addedNodes || []).forEach(function (node) {
                    if (node && node.nodeType === 1) {
                        hydrateDirectPreviewShells(node);
                        hydrateTablePreviews(node);
                    }
                });
            });
        });
        if (document.body) {
            observer.observe(document.body, { childList: true, subtree: true });
        } else {
            document.addEventListener("DOMContentLoaded", function () {
                observer.observe(document.body, { childList: true, subtree: true });
            }, { once: true });
        }
    }

    window.HandriveSpreadsheetEditor = {
        init: init,
        saveToServer: saveToServer,
        setDisabled: setDisabled,
        getIsDirty: getIsDirty,
        destroy: destroy,
        buildPreviewPrint: buildPreviewPrint,
        hydratePreviews: function (root) {
            hydrateDirectPreviewShells(root);
            hydrateTablePreviews(root);
        },
    };

    installPreviewHydration();
})();
