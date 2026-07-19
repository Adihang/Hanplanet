(function () {
    "use strict";

    const FIXED_INDENT_SIZE_BY_RENDER_CLASS = Object.freeze({
        "handrive-py": 4,
        "handrive-sql": 4,
    });

    function getIndentColumns(line, tabSize) {
        let columns = 0;
        const sourceLine = String(line || "");
        for (let index = 0; index < sourceLine.length; index += 1) {
            if (sourceLine[index] === " ") {
                columns += 1;
                continue;
            }
            if (sourceLine[index] === "\t") {
                columns += tabSize - (columns % tabSize);
                continue;
            }
            break;
        }
        return columns;
    }

    function detectIndentSize(lines, renderClass) {
        const fixedIndentSize = FIXED_INDENT_SIZE_BY_RENDER_CLASS[String(renderClass || "")];
        if (fixedIndentSize) {
            return fixedIndentSize;
        }
        if (lines.some(function (line) { return /^\t+/.test(line); })) {
            return 4;
        }
        const candidateCounts = new Map();
        let previousIndent = 0;
        lines.forEach(function (line) {
            if (!String(line || "").trim()) {
                return;
            }
            const indent = getIndentColumns(line, 4);
            const difference = indent - previousIndent;
            if (difference >= 2 && difference <= 8) {
                candidateCounts.set(difference, (candidateCounts.get(difference) || 0) + 1);
            }
            previousIndent = indent;
        });
        if (!candidateCounts.size) {
            const smallestIndent = lines.reduce(function (smallest, line) {
                const indent = getIndentColumns(line, 4);
                return indent > 1 && indent < smallest ? indent : smallest;
            }, Infinity);
            return Number.isFinite(smallestIndent) && smallestIndent <= 8 ? smallestIndent : 4;
        }
        return Array.from(candidateCounts.entries()).sort(function (left, right) {
            return right[1] - left[1] || left[0] - right[0];
        })[0][0];
    }

    function collectIndentFoldRanges(lines, indentSize) {
        const ranges = [];
        for (let lineIndex = 0; lineIndex < lines.length - 1; lineIndex += 1) {
            if (!String(lines[lineIndex] || "").trim()) {
                continue;
            }
            const currentIndent = getIndentColumns(lines[lineIndex], indentSize);
            let childIndex = lineIndex + 1;
            while (childIndex < lines.length && !String(lines[childIndex] || "").trim()) {
                childIndex += 1;
            }
            if (
                childIndex >= lines.length
                || getIndentColumns(lines[childIndex], indentSize) <= currentIndent
            ) {
                continue;
            }
            let endIndex = childIndex;
            for (let scanIndex = childIndex + 1; scanIndex < lines.length; scanIndex += 1) {
                if (!String(lines[scanIndex] || "").trim()) {
                    endIndex = scanIndex;
                    continue;
                }
                if (getIndentColumns(lines[scanIndex], indentSize) <= currentIndent) {
                    break;
                }
                endIndex = scanIndex;
            }
            if (endIndex > lineIndex) {
                ranges.push({ start: lineIndex, end: endIndex, guideEnd: endIndex });
            }
        }
        return ranges;
    }

    function collectBracketFoldRanges(lines, renderClass) {
        const ranges = [];
        const stack = [];
        const matchingOpeners = { "}": "{", "]": "[" };
        let quote = "";
        let escaped = false;
        let inBlockComment = false;
        let inHtmlComment = false;

        lines.forEach(function (line, lineIndex) {
            const sourceLine = String(line || "");
            for (let characterIndex = 0; characterIndex < sourceLine.length; characterIndex += 1) {
                const character = sourceLine[characterIndex];
                const nextCharacter = sourceLine[characterIndex + 1] || "";
                const remainingLine = sourceLine.slice(characterIndex);
                if (inHtmlComment) {
                    if (remainingLine.startsWith("-->")) {
                        inHtmlComment = false;
                        characterIndex += 2;
                    }
                    continue;
                }
                if (inBlockComment) {
                    if (character === "*" && nextCharacter === "/") {
                        inBlockComment = false;
                        characterIndex += 1;
                    }
                    continue;
                }
                if (quote) {
                    if (escaped) {
                        escaped = false;
                    } else if (character === "\\") {
                        escaped = true;
                    } else if (character === quote) {
                        quote = "";
                    }
                    continue;
                }
                if (character === "/" && nextCharacter === "/") {
                    break;
                }
                if (renderClass === "handrive-py" && character === "#") {
                    break;
                }
                if (renderClass === "handrive-sql" && character === "-" && nextCharacter === "-") {
                    break;
                }
                if (renderClass === "handrive-html" && remainingLine.startsWith("<!--")) {
                    inHtmlComment = true;
                    characterIndex += 3;
                    continue;
                }
                if (character === "/" && nextCharacter === "*") {
                    inBlockComment = true;
                    characterIndex += 1;
                    continue;
                }
                if (character === "\"" || character === "'" || character === "`") {
                    quote = character;
                    continue;
                }
                if (character === "{" || character === "[") {
                    stack.push({ character: character, line: lineIndex });
                    continue;
                }
                if (!matchingOpeners[character]) {
                    continue;
                }
                for (let stackIndex = stack.length - 1; stackIndex >= 0; stackIndex -= 1) {
                    if (stack[stackIndex].character !== matchingOpeners[character]) {
                        continue;
                    }
                    const opener = stack.splice(stackIndex, 1)[0];
                    const endIndex = lineIndex - 1;
                    if (endIndex > opener.line) {
                        ranges.push({
                            start: opener.line,
                            end: endIndex,
                            guideEnd: lineIndex,
                        });
                    }
                    break;
                }
            }
            if (quote !== "`") {
                quote = "";
                escaped = false;
            }
        });
        return ranges;
    }

    function filterFoldRangesByParentDepth(rangesByStart, maximumParentDepth) {
        const ranges = Array.from(rangesByStart.values()).sort(function (left, right) {
            return left.start - right.start || right.end - left.end;
        });
        const maxDepth = Math.max(0, Number(maximumParentDepth) || 0);
        const visibleRanges = new Map();
        const parents = [];
        ranges.forEach(function (range) {
            while (parents.length && range.start > parents[parents.length - 1].end) {
                parents.pop();
            }
            while (
                parents.length
                && range.end > parents[parents.length - 1].end
            ) {
                parents.pop();
            }
            if (parents.length <= maxDepth) {
                visibleRanges.set(range.start, range);
            }
            parents.push(range);
        });
        return visibleRanges;
    }

    function filterOutermostFoldRanges(rangesByStart) {
        return filterFoldRangesByParentDepth(rangesByStart, 0);
    }

    function buildFoldRanges(lines, indentSize, renderClass) {
        const rangesByStart = new Map();
        collectIndentFoldRanges(lines, indentSize)
            .concat(collectBracketFoldRanges(lines, renderClass))
            .forEach(function (range) {
                const current = rangesByStart.get(range.start);
                if (
                    !current
                    || current.end < range.end
                    || (
                        current.end === range.end
                        && (current.guideEnd || current.end) < (range.guideEnd || range.end)
                    )
                ) {
                    rangesByStart.set(range.start, range);
                }
            });
        return rangesByStart;
    }

    function getGuideColumns(lines, indentSize, foldRanges) {
        const columnsByLine = lines.map(function () { return []; });
        (foldRanges || new Map()).forEach(function (range) {
            const guideEnd = Number.isInteger(range.guideEnd) ? range.guideEnd : range.end;
            const parentIndent = getIndentColumns(lines[range.start], indentSize);
            const guideColumn = Math.floor(parentIndent / indentSize);
            const guideIndent = guideColumn * indentSize;
            const guideLineIndexes = [];
            let hasGuideContent = false;
            for (let lineIndex = range.start + 1; lineIndex <= guideEnd; lineIndex += 1) {
                const line = String(lines[lineIndex] || "");
                if (line.trim()) {
                    const lineIndent = getIndentColumns(line, indentSize);
                    if (
                        lineIndent <= parentIndent
                        || lineIndent - guideIndent < indentSize
                    ) {
                        continue;
                    }
                    hasGuideContent = true;
                }
                guideLineIndexes.push(lineIndex);
            }
            if (!hasGuideContent) {
                return;
            }
            guideLineIndexes.forEach(function (lineIndex) {
                columnsByLine[lineIndex].push(guideColumn);
            });
        });
        return columnsByLine.map(function (columns) {
            return Array.from(new Set(columns)).sort(function (left, right) {
                return left - right;
            });
        });
    }

    function getGuideDepths(lines, indentSize) {
        const depths = lines.map(function (line) {
            if (!String(line || "").trim()) {
                return null;
            }
            return Math.floor(getIndentColumns(line, indentSize) / indentSize);
        });
        const previousDepths = [];
        const nextDepths = [];
        let nearestDepth = 0;
        depths.forEach(function (depth, lineIndex) {
            if (depth !== null) {
                nearestDepth = depth;
            }
            previousDepths[lineIndex] = nearestDepth;
        });
        nearestDepth = 0;
        for (let lineIndex = depths.length - 1; lineIndex >= 0; lineIndex -= 1) {
            if (depths[lineIndex] !== null) {
                nearestDepth = depths[lineIndex];
            }
            nextDepths[lineIndex] = nearestDepth;
        }
        return depths.map(function (depth, lineIndex) {
            return depth === null ? Math.min(previousDepths[lineIndex], nextDepths[lineIndex]) : depth;
        });
    }

    window.HandriveCodeStructure = Object.freeze({
        buildFoldRanges: buildFoldRanges,
        collectBracketFoldRanges: collectBracketFoldRanges,
        collectIndentFoldRanges: collectIndentFoldRanges,
        detectIndentSize: detectIndentSize,
        filterFoldRangesByParentDepth: filterFoldRangesByParentDepth,
        filterOutermostFoldRanges: filterOutermostFoldRanges,
        getGuideColumns: getGuideColumns,
        getGuideDepths: getGuideDepths,
        getIndentColumns: getIndentColumns,
    });
}());
