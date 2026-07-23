(function () {
    "use strict";

    function resolvePositiveInteger(value, fallback) {
        var numeric = Number(value);
        if (!Number.isFinite(numeric) || numeric <= 0) {
            return fallback;
        }
        return Math.max(1, Math.floor(numeric));
    }

    function sanitizeSheetName(name, fallback) {
        var candidate = String(name || fallback || "Sheet1").trim() || "Sheet1";
        candidate = candidate.replace(/[\\/?*[\]:]/g, " ").trim() || "Sheet1";
        return candidate.slice(0, 31);
    }

    function normalizeSheetData(data) {
        var rows = (Array.isArray(data) ? data : []).map(function (row) {
            return (Array.isArray(row) ? row : []).map(function (value) {
                return value === null || typeof value === "undefined" ? "" : value;
            });
        });
        if (!rows.length) {
            rows.push([""]);
        }
        var maxCols = rows.reduce(function (max, row) {
            return Math.max(max, row.length);
        }, 1);
        rows.forEach(function (row) {
            while (row.length < maxCols) {
                row.push("");
            }
        });
        return rows;
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
            if (alpha >= 255) {
                return "#" + hexValue.slice(2).toUpperCase();
            }
            if (alpha <= 0) {
                return "";
            }
            return "rgba(" + parseInt(hexValue.slice(2, 4), 16) + ", "
                + parseInt(hexValue.slice(4, 6), 16) + ", "
                + parseInt(hexValue.slice(6, 8), 16) + ", "
                + (alpha / 255).toFixed(3) + ")";
        }
        return /^[0-9a-fA-F]{6}$/.test(hexValue) ? "#" + hexValue.toUpperCase() : "";
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
        var specs = {
            hair: ["1px", "dotted"], thin: ["1px", "solid"], medium: ["2px", "solid"],
            thick: ["3px", "solid"], double: ["3px", "double"], dotted: ["1px", "dotted"],
            dashed: ["1px", "dashed"], mediumdashed: ["2px", "dashed"], dashdot: ["1px", "dashed"],
            mediumdashdot: ["2px", "dashed"], dashdotdot: ["1px", "dotted"],
            mediumdashdotdot: ["2px", "dotted"], slantdashdot: ["1px", "dashed"],
        };
        return specs[String(styleName || "").toLowerCase()] || null;
    }

    function applyExcelBorderStyle(style, border) {
        if (!style || !border) {
            return;
        }
        ["top", "right", "bottom", "left"].forEach(function (sideName) {
            var side = border[sideName];
            var spec = side && getCssBorderSpecFromExcelStyle(side.style);
            if (!spec) {
                return;
            }
            var prefix = "border" + sideName.charAt(0).toUpperCase() + sideName.slice(1);
            style[prefix + "Width"] = spec[0];
            style[prefix + "Style"] = spec[1];
            style[prefix + "Color"] = "var(--handrive-spreadsheet-cell-border-strong, #1f2937)";
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
        if (value instanceof Date || typeof value !== "object") {
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
        if (value.text) return value.text;
        if (value.error) return value.error;
        return String(value);
    }

    function getExcelCellFormula(cell) {
        if (!cell) {
            return "";
        }
        var value = cell.value;
        if (value && typeof value === "object") {
            if (value.formula) return "=" + String(value.formula);
            if (value.sharedFormula) return "=" + String(value.sharedFormula);
        }
        if (cell.formula) return "=" + String(cell.formula);
        return "";
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
        if (backgroundColor) style.backgroundColor = backgroundColor;
        applyExcelBorderStyle(style, border);
        if (font) {
            var fontColor = getCssColorFromExcelColor(font.color);
            if (fontColor) style.color = fontColor;
            if (font.bold) style.fontWeight = "700";
            if (font.italic) style.fontStyle = "italic";
            var decorations = [];
            if (font.underline) decorations.push("underline");
            if (font.strike) decorations.push("line-through");
            if (decorations.length) style.textDecoration = decorations.join(" ");
            if (font.size) style.fontSize = Math.max(9, Math.round(Number(font.size) * 1.333)) + "px";
            if (font.name) style.fontFamily = String(font.name) + ', Inter, "Noto Sans KR", sans-serif';
        }
        if (alignment) {
            var horizontal = mapHorizontalAlignment(alignment.horizontal);
            var vertical = mapVerticalAlignment(alignment.vertical);
            if (horizontal) style.textAlign = horizontal;
            if (vertical) style.verticalAlign = vertical;
            if (alignment.wrapText) {
                style.whiteSpace = "normal";
                style.lineHeight = "1.35";
            }
        }
        return Object.keys(style).length ? style : null;
    }

    function columnLabelToIndex(label) {
        var value = 0;
        String(label || "").split("").forEach(function (character) {
            value = value * 26 + character.charCodeAt(0) - 64;
        });
        return value - 1;
    }

    function decodeExcelCellReference(value) {
        var match = String(value || "").replace(/\$/g, "").trim().match(/^([A-Z]+)(\d+)$/i);
        if (!match) return null;
        return { c: columnLabelToIndex(match[1].toUpperCase()), r: Number(match[2]) - 1 };
    }

    function decodeExcelRange(value) {
        var text = String(value || "").replace(/\$/g, "").trim();
        if (text.indexOf("!") !== -1) text = text.split("!").pop();
        var parts = text.split(":");
        var start = decodeExcelCellReference(parts[0]);
        var end = decodeExcelCellReference(parts[1] || parts[0]);
        return start && end ? { s: start, e: end } : null;
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
            if (!decoded) return null;
            var rowspan = decoded.e.r - decoded.s.r + 1;
            var colspan = decoded.e.c - decoded.s.c + 1;
            return rowspan > 1 || colspan > 1 ? {
                row: decoded.s.r, col: decoded.s.c, rowspan: rowspan, colspan: colspan,
            } : null;
        }).filter(Boolean);
    }

    function buildMergeChildLookup(mergeCells) {
        var lookup = {};
        (Array.isArray(mergeCells) ? mergeCells : []).forEach(function (merge) {
            for (var row = merge.row; row < merge.row + merge.rowspan; row += 1) {
                for (var col = merge.col; col < merge.col + merge.colspan; col += 1) {
                    if (row !== merge.row || col !== merge.col) lookup[getCellKey(row, col)] = true;
                }
            }
        });
        return lookup;
    }

    function mergeContainsPrintableCell(merge, printableCellKeys) {
        for (var row = merge.row; row < merge.row + merge.rowspan; row += 1) {
            for (var col = merge.col; col < merge.col + merge.colspan; col += 1) {
                if (printableCellKeys.has(getCellKey(row, col))) return true;
            }
        }
        return false;
    }

    function getWorksheetBounds(worksheet, mergeCells) {
        var bounds = { maxRow: 0, maxCol: 0 };
        var printableCellKeys = new Set();
        var includeCell = function (cell, rowNumber, columnNumber) {
            if (!cell || !Number.isFinite(rowNumber) || !Number.isFinite(columnNumber)) return;
            if (!hasExcelCellValue(cell) && !hasExcelCellBorderStyle(cell)) return;
            bounds.maxRow = Math.max(bounds.maxRow, rowNumber);
            bounds.maxCol = Math.max(bounds.maxCol, columnNumber);
            printableCellKeys.add(getCellKey(rowNumber - 1, columnNumber - 1));
        };
        if (Array.isArray(worksheet && worksheet._rows)) {
            worksheet._rows.forEach(function (row, rowOffset) {
                if (!row) return;
                var rowNumber = Number(row.number || rowOffset + 1);
                if (Array.isArray(row._cells)) {
                    row._cells.forEach(function (cell, columnOffset) {
                        includeCell(cell, rowNumber, Number(cell && (cell.col || columnOffset + 1)));
                    });
                }
            });
        } else if (worksheet && typeof worksheet.eachRow === "function") {
            worksheet.eachRow({ includeEmpty: false }, function (row, rowNumber) {
                row.eachCell({ includeEmpty: false }, function (cell, columnNumber) {
                    includeCell(cell, rowNumber, columnNumber);
                });
            });
        }
        (Array.isArray(mergeCells) ? mergeCells : []).forEach(function (merge) {
            if (!mergeContainsPrintableCell(merge, printableCellKeys)) return;
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
            if (row && row.height) heights[index - 1] = Math.max(18, Math.round(Number(row.height) * 1.333));
        }
        return heights;
    }

    function parseExcelJsWorksheet(worksheet, index) {
        var mergeCells = extractWorksheetMergeCells(worksheet);
        var mergeChildLookup = buildMergeChildLookup(mergeCells);
        var bounds = getWorksheetBounds(worksheet, mergeCells);
        var data = [];
        var cellStyles = {};
        var formulas = {};
        for (var rowIndex = 1; rowIndex <= bounds.rows; rowIndex += 1) {
            var row = worksheet.getRow(rowIndex);
            var rowData = [];
            for (var columnIndex = 1; columnIndex <= bounds.cols; columnIndex += 1) {
                var cell = row.getCell(columnIndex);
                var zeroRow = rowIndex - 1;
                var zeroCol = columnIndex - 1;
                var key = getCellKey(zeroRow, zeroCol);
                rowData.push(mergeChildLookup[key] ? "" : getExcelCellDisplayValue(cell));
                var formula = getExcelCellFormula(cell);
                if (formula) formulas[key] = formula;
                var cellStyle = getExcelCellStyle(cell && cell.master ? cell.master : cell);
                if (cellStyle) cellStyles[key] = cellStyle;
            }
            data.push(rowData);
        }
        var normalizedData = normalizeSheetData(data);
        return {
            name: sanitizeSheetName(worksheet.name, "Sheet" + String(index + 1)),
            data: normalizedData,
            originalRowCount: normalizedData.length,
            originalColCount: normalizedData.reduce(function (max, row) { return Math.max(max, row.length); }, 0),
            cellStyles: cellStyles,
            formulas: formulas,
            mergeCells: mergeCells,
            colWidths: getWorksheetColumnWidths(worksheet, bounds.cols),
            rowHeights: getWorksheetRowHeights(worksheet, bounds.rows),
        };
    }

    function countCsvDelimiter(text, delimiter) {
        var lineCount = 0;
        var delimiterCount = 0;
        var quoted = false;
        var source = String(text || "").slice(0, 16000);
        for (var index = 0; index < source.length; index += 1) {
            var character = source.charAt(index);
            if (character === '"') {
                if (quoted && source.charAt(index + 1) === '"') {
                    index += 1;
                } else {
                    quoted = !quoted;
                }
            } else if (!quoted && character === delimiter) {
                delimiterCount += 1;
            } else if (!quoted && (character === "\n" || character === "\r")) {
                lineCount += 1;
            }
        }
        return { lineCount: Math.max(1, lineCount), delimiterCount: delimiterCount };
    }

    function detectCsvDelimiter(text) {
        var candidates = [",", ";", "\t", "|"];
        var bestDelimiter = ",";
        var bestScore = 0;
        candidates.forEach(function (delimiter) {
            var counts = countCsvDelimiter(text, delimiter);
            var average = counts.delimiterCount / counts.lineCount;
            var score = average > 0 ? average + Math.min(1, counts.delimiterCount / 1000) : 0;
            if (score > bestScore) {
                bestScore = score;
                bestDelimiter = delimiter;
            }
        });
        return bestDelimiter;
    }

    function decodeCsvBuffer(arrayBuffer) {
        var bytes = new Uint8Array(arrayBuffer || new ArrayBuffer(0));
        var encoding = "utf-8";
        var hasBom = false;
        if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
            hasBom = true;
        } else if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
            encoding = "utf-16le";
            hasBom = true;
        } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
            encoding = "utf-16be";
            hasBom = true;
        } else if (typeof TextDecoder === "function") {
            var candidates = ["utf-8", "euc-kr", "shift_jis", "windows-1252"];
            var bestText = "";
            var bestReplacementCount = Number.POSITIVE_INFINITY;
            candidates.forEach(function (candidate) {
                try {
                    var decoded = new TextDecoder(candidate).decode(bytes);
                    var replacementCount = (decoded.match(/\ufffd/g) || []).length;
                    if (replacementCount < bestReplacementCount) {
                        bestReplacementCount = replacementCount;
                        bestText = decoded;
                        encoding = candidate;
                    }
                } catch (error) {}
            });
            if (bestText) {
                return {
                    text: bestText.replace(/^\ufeff/, ""),
                    encoding: encoding,
                    hasBom: hasBom,
                    delimiter: detectCsvDelimiter(bestText),
                };
            }
        }
        var decoder = typeof TextDecoder === "function" ? new TextDecoder(encoding) : null;
        var text = decoder
            ? decoder.decode(bytes).replace(/^\ufeff/, "")
            : String.fromCharCode.apply(null, Array.from(bytes));
        return {
            text: text,
            encoding: encoding,
            hasBom: hasBom,
            delimiter: detectCsvDelimiter(text),
        };
    }

    function parsePreview(message) {
        if (!self.XLSX) {
            importScripts(message.sheetJsScriptUrl);
        }
        if (!self.XLSX) {
            throw new Error("SheetJS를 Worker에서 불러오지 못했습니다.");
        }

        var maxRows = resolvePositiveInteger(message.maxRows, 500);
        var maxCols = resolvePositiveInteger(message.maxCols, 100);
        var extension = String(message.extension || "").toLowerCase();
        var readOptions;
        var workbook;
        var csvMeta = null;
        if (extension === ".csv") {
            var decodedCsv = decodeCsvBuffer(message.arrayBuffer);
            csvMeta = {
                encoding: decodedCsv.encoding,
                delimiter: decodedCsv.delimiter,
                hasBom: decodedCsv.hasBom,
            };
            readOptions = { type: "string", raw: false, FS: decodedCsv.delimiter, sheetRows: maxRows };
            workbook = self.XLSX.read(decodedCsv.text, readOptions);
        } else {
            readOptions = {
                type: "array",
                cellDates: true,
                cellFormula: true,
                cellText: false,
                sheetRows: maxRows,
            };
            workbook = self.XLSX.read(message.arrayBuffer, readOptions);
        }

        var sheetNames = Array.isArray(workbook.SheetNames) ? workbook.SheetNames : [];
        var sheets = sheetNames.map(function (sheetName, index) {
            var worksheet = workbook.Sheets[sheetName];
            var range = worksheet && worksheet["!ref"] ? worksheet["!ref"] : null;
            var data = worksheet
                ? self.XLSX.utils.sheet_to_json(worksheet, {
                    header: 1,
                    defval: "",
                    raw: false,
                    blankrows: true,
                    range: range,
                })
                : [];
            data = data.slice(0, maxRows).map(function (row) {
                return Array.isArray(row) ? row.slice(0, maxCols) : [];
            });
            var normalizedData = normalizeSheetData(data);
            var fullRange = String((worksheet && (worksheet["!fullref"] || worksheet["!ref"])) || "");
            var decodedRange = null;
            try {
                decodedRange = fullRange ? self.XLSX.utils.decode_range(fullRange) : null;
            } catch (error) {}
            return {
                name: sanitizeSheetName(sheetName, "Sheet" + String(index + 1)),
                data: normalizedData,
                originalRowCount: normalizedData.length,
                originalColCount: normalizedData.reduce(function (max, row) {
                    return Math.max(max, row.length);
                }, 0),
                previewLimited: Boolean(
                    decodedRange &&
                    (decodedRange.e.r + 1 > maxRows || decodedRange.e.c + 1 > maxCols)
                ),
                previewRowLimit: maxRows,
                previewColumnLimit: maxCols,
            };
        });
        if (!sheets.length) {
            sheets.push({
                name: "Sheet1",
                data: [[""]],
                originalRowCount: 1,
                originalColCount: 1,
            });
        }
        return { sheets: sheets, csvMeta: csvMeta };
    }

    function parseFull(message) {
        if (!self.ExcelJS) {
            if (!message.excelJsScriptUrl) {
                throw new Error("ExcelJS Worker 스크립트 URL이 없습니다.");
            }
            importScripts(message.excelJsScriptUrl);
        }
        if (!self.ExcelJS || !self.ExcelJS.Workbook) {
            throw new Error("ExcelJS를 Worker에서 불러오지 못했습니다.");
        }
        var workbook = new self.ExcelJS.Workbook();
        return workbook.xlsx.load(message.arrayBuffer).then(function () {
            var worksheets = Array.isArray(workbook.worksheets) ? workbook.worksheets : [];
            var sheets = worksheets.map(function (worksheet, index) {
                return parseExcelJsWorksheet(worksheet, index);
            });
            if (!sheets.length) {
                sheets.push({
                    name: "Sheet1",
                    data: [[""]],
                    originalRowCount: 1,
                    originalColCount: 1,
                    cellStyles: {},
                    formulas: {},
                    mergeCells: [],
                    colWidths: [],
                    rowHeights: [],
                });
            }
            return { sheets: sheets, csvMeta: null };
        });
    }

    self.onmessage = function (event) {
        var message = event && event.data ? event.data : {};
        if (message.type !== "parse-preview" && message.type !== "parse-full") {
            return;
        }
        try {
            var result = message.type === "parse-full" ? parseFull(message) : parsePreview(message);
            Promise.resolve(result).then(function (parsed) {
                self.postMessage({ ok: true, sheets: parsed.sheets, csvMeta: parsed.csvMeta || null });
            }).catch(function (error) {
                self.postMessage({
                    ok: false,
                    error: error && error.message ? error.message : "스프레드시트를 처리하지 못했습니다.",
                });
            });
        } catch (error) {
            self.postMessage({
                ok: false,
                error: error && error.message ? error.message : "스프레드시트 미리보기를 처리하지 못했습니다.",
            });
        }
    };
})();
