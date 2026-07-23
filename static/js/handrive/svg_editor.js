(function () {
    "use strict";

    var SVG_NS = "http://www.w3.org/2000/svg";
    var XLINK_NS = "http://www.w3.org/1999/xlink";
    var XML_NS = "http://www.w3.org/XML/1998/namespace";
    var XMLNS_NS = "http://www.w3.org/2000/xmlns/";
    var MAX_SOURCE_BYTES = 5 * 1024 * 1024;
    var MAX_ELEMENTS = 10000;
    var MAX_ATTRIBUTE_LENGTH = 2000000;
    var MAX_PATH_DATA_CHARS = 2000000;
    var MAX_DEPTH = 64;
    var MAX_ATTRIBUTES = 100000;
    var MAX_DIMENSION = 10000000;
    var MAX_COORDINATE = 1000000000;
    var HISTORY_LIMIT = 100;
    var HISTORY_BYTE_LIMIT = 32 * 1024 * 1024;
    var MIN_ZOOM = 0.00001;
    var MAX_ZOOM = 1000;
    var instanceSequence = 0;

    var ALLOWED_ELEMENTS = new Set([
        "circle", "clippath", "defs", "desc", "ellipse", "feblend",
        "fecolormatrix", "fecomponenttransfer", "fecomposite", "feconvolvematrix",
        "fediffuselighting", "fedisplacementmap", "fedistantlight", "fedropshadow",
        "feflood", "fefunca", "fefuncb", "fefuncg", "fefuncr", "fegaussianblur",
        "feimage", "femerge", "femergenode", "femorphology", "feoffset",
        "fepointlight", "fespecularlighting", "fespotlight", "fetile", "feturbulence",
        "filter", "g", "image", "line", "lineargradient", "marker", "mask",
        "metadata", "path", "pattern", "polygon", "polyline", "radialgradient",
        "rect", "stop", "svg", "switch", "symbol", "text", "textpath", "title",
        "tspan", "use", "view"
    ]);
    var FORBIDDEN_ELEMENTS = new Set([
        "script", "foreignobject", "iframe", "object", "embed", "style", "link",
        "meta", "audio", "video", "canvas", "base", "form", "input", "button",
        "textarea", "select", "source", "track", "animate", "animatemotion",
        "animatetransform", "set", "mpath"
    ]);
    var GRAPHICS_ELEMENTS = new Set([
        "circle", "ellipse", "g", "image", "line", "path", "polygon",
        "polyline", "rect", "switch", "symbol", "text", "use"
    ]);
    var NON_SELECTABLE_ANCESTORS = new Set([
        "defs", "clippath", "mask", "marker", "pattern", "symbol"
    ]);
    var LAYER_SKIP_ELEMENTS = new Set([
        "defs", "desc", "metadata", "title", "lineargradient", "radialgradient",
        "pattern", "clippath", "mask", "marker", "filter", "symbol", "view"
    ]);
    var URL_ATTRIBUTES = new Set([
        "href", "src", "poster", "background", "action", "formaction", "cursor"
    ]);
    var URL_VALUE_ATTRIBUTES = new Set([
        "fill", "stroke", "filter", "clip-path", "mask", "marker", "marker-start",
        "marker-mid", "marker-end", "cursor"
    ]);
    var SAFE_STYLE_PROPERTIES = new Set([
        "alignment-baseline", "baseline-shift", "clip-rule", "color", "color-interpolation",
        "color-interpolation-filters", "direction", "display", "dominant-baseline",
        "fill", "fill-opacity", "fill-rule", "filter", "flood-color", "flood-opacity",
        "font-family", "font-size", "font-stretch", "font-style", "font-variant",
        "font-weight", "glyph-orientation-horizontal", "glyph-orientation-vertical",
        "letter-spacing", "lighting-color", "marker-end", "marker-mid", "marker-start",
        "mask", "opacity", "overflow", "paint-order", "pointer-events", "shape-rendering",
        "stop-color", "stop-opacity", "stroke", "stroke-dasharray", "stroke-dashoffset",
        "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-opacity",
        "stroke-width", "text-anchor", "text-decoration", "text-rendering", "unicode-bidi",
        "vector-effect", "visibility", "white-space", "word-spacing", "writing-mode"
    ]);
    var PATH_PARAMETER_COUNTS = {
        M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0
    };

    var state = createInitialState();

    function createInitialState() {
        return {
            generation: 0,
            root: null,
            refs: {},
            svg: null,
            idPrefix: "",
            classPrefix: "",
            listeners: [],
            loadController: null,
            callbacks: {},
            selected: new Set(),
            locked: new WeakSet(),
            visibilityOriginals: new WeakMap(),
            tool: "select",
            drag: null,
            keyboardNudge: null,
            pen: null,
            pathNodes: null,
            layerRows: new Map(),
            zoom: 1,
            panX: 0,
            panY: 0,
            autoFit: true,
            gridVisible: true,
            // Start with precise, predictable one-unit alignment enabled.
            snapEnabled: true,
            gridSize: 1,
            history: [],
            historyIndex: -1,
            savedContent: "",
            lastContent: "",
            dirty: false,
            disabled: false,
            spacePressed: false,
            initialized: false,
            resizeObserver: null,
            resizeRaf: 0
        };
    }

    function sourceByteLength(value) {
        var text = String(value || "");
        if (window.TextEncoder) {
            return new TextEncoder().encode(text).length;
        }
        return unescape(encodeURIComponent(text)).length;
    }

    function finiteNumber(value) {
        var number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    function clamp(value, minimum, maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }

    function formatNumber(value) {
        var number = Number(value);
        if (!Number.isFinite(number)) return "0";
        if (Math.abs(number) < 0.000000001) number = 0;
        return String(Number(number.toFixed(6)));
    }

    function localName(element) {
        return String(element && (element.localName || element.nodeName) || "").toLowerCase();
    }

    function isSafeFragment(value) {
        var fragment = String(value || "").trim();
        return fragment.length > 1 && fragment.length <= 513 && /^#[^\s\u0000-\u001f"'()<>]+$/.test(fragment);
    }

    function normalizedUrlValue(value) {
        return String(value || "").replace(/[\u0000-\u0020\u007f]+/g, "").toLowerCase();
    }

    function isSafeDataImage(value) {
        return /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i.test(String(value || "").trim());
    }

    function hasUnsafeCss(value) {
        var css = String(value || "");
        var compact = normalizedUrlValue(css);
        if (/@import|expression\s*\(|behavior\s*:|-moz-binding|javascript:|vbscript:/i.test(compact)) {
            return true;
        }
        var urlPattern = /url\s*\(\s*(["']?)(.*?)\1\s*\)/gi;
        var match;
        var urlCount = 0;
        while ((match = urlPattern.exec(css))) {
            urlCount += 1;
            if (!isSafeFragment(match[2])) return true;
        }
        if (/url\s*\(/i.test(css) && !urlCount) return true;
        return false;
    }

    function sanitizeStyleDeclarations(value) {
        if (hasUnsafeCss(value)) return [];
        var safeDeclarations = [];
        String(value || "").split(";").forEach(function (declaration) {
            var separator = declaration.indexOf(":");
            if (separator < 1) return;
            var property = declaration.slice(0, separator).trim().toLowerCase();
            var propertyValue = declaration.slice(separator + 1).trim();
            if (!SAFE_STYLE_PROPERTIES.has(property) || !propertyValue || hasUnsafeCss(propertyValue)) return;
            safeDeclarations.push([property, propertyValue]);
        });
        return safeDeclarations;
    }

    function parseAbsoluteLength(value) {
        var match = String(value || "").trim().match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(px|pt|pc|in|cm|mm|q)?$/i);
        if (!match) return null;
        var number = finiteNumber(match[1]);
        if (number === null) return null;
        var unit = String(match[2] || "px").toLowerCase();
        var multipliers = { px: 1, pt: 96 / 72, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 101.6 };
        return number * multipliers[unit];
    }

    function parseRelativeLength(value) {
        var match = String(value || "").trim().match(/^([+]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(%|em|rem|ex|ch|vw|vh|vmin|vmax)$/i);
        if (!match) return null;
        var number = finiteNumber(match[1]);
        return number !== null && number > 0 && number <= MAX_DIMENSION ? number : null;
    }

    function parseViewBox(value) {
        var parts = String(value || "").trim().split(/[\s,]+/).filter(Boolean);
        if (parts.length !== 4) return null;
        var numbers = parts.map(finiteNumber);
        if (numbers.some(function (item) { return item === null; })) return null;
        if (Math.abs(numbers[0]) > MAX_COORDINATE || Math.abs(numbers[1]) > MAX_COORDINATE) return null;
        if (numbers[2] <= 0 || numbers[3] <= 0 || numbers[2] > MAX_DIMENSION || numbers[3] > MAX_DIMENSION) return null;
        return { x: numbers[0], y: numbers[1], width: numbers[2], height: numbers[3] };
    }

    function validateAndNormalizeGeometry(root) {
        var rawViewBox = root.getAttribute("viewBox");
        var viewBox = rawViewBox ? parseViewBox(rawViewBox) : null;
        if (rawViewBox && !viewBox) throw new Error("Invalid SVG viewBox");

        var rawWidth = root.getAttribute("width");
        var rawHeight = root.getAttribute("height");
        var width = rawWidth ? parseAbsoluteLength(rawWidth) : null;
        var height = rawHeight ? parseAbsoluteLength(rawHeight) : null;
        var relativeWidth = rawWidth ? parseRelativeLength(rawWidth) : null;
        var relativeHeight = rawHeight ? parseRelativeLength(rawHeight) : null;

        if (rawWidth && width === null && !(relativeWidth !== null && viewBox)) throw new Error("Invalid SVG width");
        if (rawHeight && height === null && !(relativeHeight !== null && viewBox)) throw new Error("Invalid SVG height");
        if (width !== null && (width <= 0 || width > MAX_DIMENSION)) throw new Error("Invalid SVG width");
        if (height !== null && (height <= 0 || height > MAX_DIMENSION)) throw new Error("Invalid SVG height");

        if (!viewBox) {
            width = width === null ? 800 : width;
            height = height === null ? 600 : height;
            if (width <= 0 || height <= 0 || width > MAX_DIMENSION || height > MAX_DIMENSION) {
                throw new Error("Invalid SVG dimensions");
            }
            viewBox = { x: 0, y: 0, width: width, height: height };
            root.setAttribute("viewBox", [0, 0, formatNumber(width), formatNumber(height)].join(" "));
        } else {
            root.setAttribute("viewBox", [viewBox.x, viewBox.y, viewBox.width, viewBox.height].map(formatNumber).join(" "));
        }
        if (!rawWidth) root.setAttribute("width", formatNumber(viewBox.width));
        if (!rawHeight) root.setAttribute("height", formatNumber(viewBox.height));
        return viewBox;
    }

    function sanitizeAttribute(element, attribute) {
        var name = String(attribute.name || "");
        var lowerName = name.toLowerCase();
        var attributeLocalName = String(attribute.localName || name).toLowerCase();
        var namespace = attribute.namespaceURI || "";
        var value = String(attribute.value || "");
        var elementName = localName(element);
        if (value.length > MAX_ATTRIBUTE_LENGTH) return null;
        if (attributeLocalName.indexOf("on") === 0 || attributeLocalName.indexOf("data-") === 0) return null;
        if (namespace && namespace !== XML_NS && namespace !== XMLNS_NS && !(namespace === XLINK_NS && attributeLocalName === "href")) return null;
        if (lowerName === "style") return null;
        if ((namespace === XML_NS && attributeLocalName === "base") || lowerName === "base" || lowerName === "target") return null;
        if (["autofocus", "tabindex", "focusable", "name"].includes(attributeLocalName)) return null;
        if (lowerName === "xmlns") return value === SVG_NS ? value : null;
        if (lowerName.indexOf("xmlns:") === 0) return lowerName === "xmlns:xlink" && value === XLINK_NS ? value : null;
        if (URL_ATTRIBUTES.has(attributeLocalName) || (namespace === XLINK_NS && attributeLocalName === "href")) {
            if (isSafeFragment(value)) return value.trim();
            if ((elementName === "image" || elementName === "feimage") && isSafeDataImage(value)) return value.trim();
            return null;
        }
        if ((URL_VALUE_ATTRIBUTES.has(lowerName) || /url\s*\(/i.test(value)) && hasUnsafeCss(value)) return null;
        if (value.indexOf("\\") >= 0 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) return null;
        if (/javascript\s*:|vbscript\s*:/i.test(normalizedUrlValue(value))) return null;
        return value;
    }

    function sanitizeParsedDocument(parsed) {
        var root = parsed && parsed.documentElement;
        if (!root || localName(root) !== "svg") throw new Error("SVG root required");
        if (root.namespaceURI && root.namespaceURI !== SVG_NS) throw new Error("Invalid SVG namespace");
        if (parsed.querySelector("parsererror")) throw new Error("Invalid SVG source");
        var elements = Array.from(root.querySelectorAll("*"));
        if (elements.length + 1 > MAX_ELEMENTS) throw new Error("SVG element limit exceeded");

        elements.slice().reverse().forEach(function (element) {
            var name = localName(element);
            var namespace = element.namespaceURI;
            if (FORBIDDEN_ELEMENTS.has(name) || !ALLOWED_ELEMENTS.has(name) || (namespace && namespace !== SVG_NS)) {
                element.remove();
            }
        });
        if (!ALLOWED_ELEMENTS.has(localName(root))) throw new Error("SVG root required");

        var ids = new Set();
        var attributeCount = 0;
        var pathDataChars = 0;
        var allElements = Array.from(root.querySelectorAll("*")).concat([root]);
        allElements.forEach(function (element) {
            var depth = 1;
            var ancestor = element.parentElement;
            while (ancestor) {
                depth += 1;
                if (ancestor === root) break;
                ancestor = ancestor.parentElement;
            }
            if (depth > MAX_DEPTH) throw new Error("SVG nesting limit exceeded");
            attributeCount += element.attributes ? element.attributes.length : 0;
            if (attributeCount > MAX_ATTRIBUTES) throw new Error("SVG attribute limit exceeded");
            if (localName(element) === "path") {
                pathDataChars += String(element.getAttribute("d") || "").length;
                if (pathDataChars > MAX_PATH_DATA_CHARS) throw new Error("SVG path data limit exceeded");
            }
            var styleAttribute = element.getAttribute("style");
            if (styleAttribute) {
                sanitizeStyleDeclarations(styleAttribute).forEach(function (declaration) {
                    if (!element.hasAttribute(declaration[0])) element.setAttribute(declaration[0], declaration[1]);
                });
                element.removeAttribute("style");
            }
            Array.from(element.attributes || []).forEach(function (attribute) {
                var safeValue = sanitizeAttribute(element, attribute);
                if (safeValue === null) {
                    element.removeAttributeNS(attribute.namespaceURI, attribute.localName);
                    return;
                }
                if (safeValue !== attribute.value) attribute.value = safeValue;
            });
            var id = element.getAttribute("id");
            if (id) {
                if (id.length > 512 || /[\s\u0000-\u001f]/.test(id) || ids.has(id)) {
                    throw new Error("Invalid or duplicate SVG id");
                }
                ids.add(id);
            }
        });
        root.setAttribute("xmlns", SVG_NS);
        var finalAttributeCount = 0;
        Array.from(root.querySelectorAll("*")).concat([root]).forEach(function (element) {
            finalAttributeCount += element.attributes ? element.attributes.length : 0;
        });
        if (finalAttributeCount > MAX_ATTRIBUTES) throw new Error("SVG attribute limit exceeded");
        validateAndNormalizeGeometry(root);
        return root;
    }

    function parseAndSanitizeSvg(source) {
        var text = String(source || "");
        if (sourceByteLength(text) > MAX_SOURCE_BYTES) throw new Error("SVG source exceeds 5 MB");
        if (text.indexOf("\u0000") >= 0) throw new Error("Invalid SVG source");
        if (/<!\s*(?:doctype|entity)\b/i.test(text) || /<\?xml-stylesheet\b/i.test(text)) {
            throw new Error("DOCTYPE, ENTITY, and external stylesheets are not allowed");
        }
        var parser = new DOMParser();
        var parsed = parser.parseFromString(text, "image/svg+xml");
        var sanitizedRoot = sanitizeParsedDocument(parsed);
        var serialized = new XMLSerializer().serializeToString(sanitizedRoot);
        var normalizedDocument = parser.parseFromString(serialized, "image/svg+xml");
        var normalizedRoot = sanitizeParsedDocument(normalizedDocument);
        if (normalizedRoot.namespaceURI !== SVG_NS) throw new Error("Invalid SVG namespace");
        return normalizedRoot;
    }

    function defaultSvgSource() {
        return '<svg xmlns="' + SVG_NS + '" width="800" height="600" viewBox="0 0 800 600"></svg>';
    }

    function getViewBox() {
        if (!state.svg) return { x: 0, y: 0, width: 800, height: 600 };
        return parseViewBox(state.svg.getAttribute("viewBox")) || { x: 0, y: 0, width: 800, height: 600 };
    }

    function walkAttributes(root, callback) {
        Array.from(root.querySelectorAll("*")).concat([root]).forEach(function (element) {
            Array.from(element.attributes || []).forEach(function (attribute) {
                callback(element, attribute);
            });
        });
    }

    function rewriteReferenceAttribute(attribute, replacements) {
        var lowerName = String(attribute.localName || attribute.name || "").toLowerCase();
        var value = String(attribute.value || "");
        var trimmed = value.trim();
        if ((lowerName === "href" || lowerName === "src") && trimmed.charAt(0) === "#") {
            var exactId = trimmed.slice(1);
            if (replacements.has(exactId)) value = "#" + replacements.get(exactId);
        }
        value = value.replace(/url\(\s*(["']?)#([^\s"'()]+)\1\s*\)/gi, function (full, quote, id) {
            return replacements.has(id) ? "url(" + quote + "#" + replacements.get(id) + quote + ")" : full;
        });
        if (value !== attribute.value) attribute.value = value;
    }

    function prefixLiveIds(root) {
        var idMap = new Map();
        Array.from(root.querySelectorAll("[id]")).concat(root.hasAttribute("id") ? [root] : []).forEach(function (element) {
            var id = element.getAttribute("id");
            if (!id) return;
            var prefixed = state.idPrefix + id;
            idMap.set(id, prefixed);
            element.setAttribute("id", prefixed);
        });
        if (!idMap.size) return;
        walkAttributes(root, function (_element, attribute) {
            if (attribute.name.toLowerCase() === "id") return;
            rewriteReferenceAttribute(attribute, idMap);
        });
    }

    function prefixLiveClasses(root) {
        Array.from(root.querySelectorAll("[class]")).concat(root.hasAttribute("class") ? [root] : []).forEach(function (element) {
            var tokens = String(element.getAttribute("class") || "").trim().split(/\s+/).filter(Boolean);
            if (tokens.length) element.setAttribute("class", tokens.map(function (token) { return state.classPrefix + token; }).join(" "));
            else element.removeAttribute("class");
        });
    }

    function restoreSourceIds(clone) {
        if (!state.idPrefix) return;
        var replacements = new Map();
        Array.from(clone.querySelectorAll("[id]")).concat(clone.hasAttribute("id") ? [clone] : []).forEach(function (element) {
            var id = String(element.getAttribute("id") || "");
            if (id.indexOf(state.idPrefix) === 0) replacements.set(id, id.slice(state.idPrefix.length));
        });
        walkAttributes(clone, function (_element, attribute) {
            var value = attribute.value;
            if (attribute.name.toLowerCase() === "id" && value.indexOf(state.idPrefix) === 0) {
                attribute.value = value.slice(state.idPrefix.length);
                return;
            }
            rewriteReferenceAttribute(attribute, replacements);
        });
    }

    function restoreSourceClasses(clone) {
        if (!state.classPrefix) return;
        Array.from(clone.querySelectorAll("[class]")).concat(clone.hasAttribute("class") ? [clone] : []).forEach(function (element) {
            var tokens = String(element.getAttribute("class") || "").trim().split(/\s+/).filter(Boolean).map(function (token) {
                return token.indexOf(state.classPrefix) === 0 ? token.slice(state.classPrefix.length) : token;
            }).filter(Boolean);
            if (tokens.length) element.setAttribute("class", tokens.join(" "));
            else element.removeAttribute("class");
        });
    }

    function serializeSvg() {
        if (!state.svg) return state.lastContent || "";
        var clone = state.svg.cloneNode(true);
        stripEditorDataFromClone(clone);
        restoreSourceIds(clone);
        restoreSourceClasses(clone);
        clone.setAttribute("xmlns", SVG_NS);
        var serialized = new XMLSerializer().serializeToString(clone);
        state.lastContent = serialized;
        return serialized;
    }

    function bind(target, type, handler, options) {
        if (!target) return;
        target.addEventListener(type, handler, options);
        state.listeners.push([target, type, handler, options]);
    }

    function queryRefs(root) {
        var refs = {
            viewport: root.querySelector("[data-svg-viewport]"),
            scene: root.querySelector("[data-svg-scene]"),
            artboard: root.querySelector("[data-svg-artboard]"),
            grid: root.querySelector("[data-svg-grid]"),
            selectionBox: root.querySelector("[data-svg-selection-box]"),
            layerList: root.querySelector("[data-svg-layer-list]"),
            layerCount: root.querySelector("[data-svg-layer-count]"),
            emptySelection: root.querySelector("[data-svg-empty-selection]"),
            propertyFields: root.querySelector("[data-svg-property-fields]"),
            textField: root.querySelector("[data-svg-text-field]"),
            source: root.querySelector("[data-svg-source]"),
            status: root.querySelector("[data-svg-status]"),
            coordinates: root.querySelector("[data-svg-coordinates]"),
            documentSize: root.querySelector("[data-svg-document-size]"),
            zoomValue: root.querySelector('[data-svg-action="zoom-fit"]'),
            gridSize: root.querySelector("[data-svg-grid-size]"),
            snap: root.querySelector("[data-svg-snap]"),
            tools: Array.from(root.querySelectorAll("[data-svg-tool]")),
            actions: Array.from(root.querySelectorAll("[data-svg-action]")),
            properties: Array.from(root.querySelectorAll("[data-svg-property]")),
            viewBoxInputs: Array.from(root.querySelectorAll("[data-svg-viewbox]")),
            resizeHandles: Array.from(root.querySelectorAll("[data-svg-resize]"))
        };
        return refs;
    }

    function label(name, fallback) {
        return state.root && state.root.dataset[name] ? state.root.dataset[name] : fallback;
    }

    function setStatus(text) {
        if (state.refs.status) state.refs.status.textContent = String(text || "");
    }

    function notifyError(error, fallback) {
        var message = error && error.message ? error.message : String(error || fallback || "Error");
        setStatus(fallback || label("labelLoadError", "Unable to load SVG"));
        if (typeof state.callbacks.onError === "function") {
            try { state.callbacks.onError(error instanceof Error ? error : new Error(message)); } catch (_callbackError) { /* no-op */ }
        }
    }

    function setDirty(value) {
        var dirty = Boolean(value);
        if (dirty === state.dirty) return;
        state.dirty = dirty;
        if (typeof state.callbacks.onDirtyChange === "function") {
            try { state.callbacks.onDirtyChange(dirty); } catch (_error) { /* no-op */ }
        }
    }

    function syncDirtyFromContent(content) {
        setDirty(String(content === undefined ? serializeSvg() : content) !== state.savedContent);
    }

    function updateHistoryButtons() {
        var undo = state.root && state.root.querySelector('[data-svg-action="undo"]');
        var redo = state.root && state.root.querySelector('[data-svg-action="redo"]');
        if (undo) undo.disabled = state.disabled || state.historyIndex <= 0;
        if (redo) redo.disabled = state.disabled || state.historyIndex < 0 || state.historyIndex >= state.history.length - 1;
    }

    function commitHistory() {
        var content = serializeSvg();
        var current = state.history[state.historyIndex];
        try {
            parseAndSanitizeSvg(content);
        } catch (error) {
            if (typeof current === "string") applySerializedSnapshot(current);
            setStatus(label("labelInvalidSource", "Invalid SVG source"));
            return false;
        }
        if (content !== current) {
            state.history = state.history.slice(0, state.historyIndex + 1);
            state.history.push(content);
            if (state.history.length > HISTORY_LIMIT) state.history.shift();
            state.historyIndex = state.history.length - 1;
            var historyBytes = state.history.reduce(function (total, snapshot) {
                return total + sourceByteLength(snapshot);
            }, 0);
            while (state.history.length > 1 && historyBytes > HISTORY_BYTE_LIMIT) {
                historyBytes -= sourceByteLength(state.history[0]);
                state.history.shift();
                state.historyIndex -= 1;
            }
            state.historyIndex = Math.max(0, state.historyIndex);
        }
        syncDirtyFromContent(content);
        syncSourceField(content);
        updateHistoryButtons();
        return true;
    }

    function syncSourceField(content) {
        if (state.refs.source && document.activeElement !== state.refs.source) {
            state.refs.source.value = content === undefined ? serializeSvg() : content;
        }
    }

    function replaceLiveSvg(sanitizedRoot) {
        clearNodeOverlay();
        var imported = document.importNode(sanitizedRoot, true);
        state.idPrefix = "hse" + (++instanceSequence) + "_" + Date.now().toString(36) + "_";
        state.classPrefix = state.idPrefix + "class_";
        prefixLiveIds(imported);
        prefixLiveClasses(imported);
        state.refs.artboard.replaceChildren(imported);
        state.svg = imported;
        state.selected.clear();
        state.locked = new WeakSet();
        state.visibilityOriginals = new WeakMap();
        state.keyboardNudge = null;
        renderDocumentState();
    }

    function applySerializedSnapshot(content) {
        var root = parseAndSanitizeSvg(content);
        replaceLiveSvg(root);
        syncDirtyFromContent(content);
        syncSourceField(content);
        updateHistoryButtons();
    }

    function undo() {
        if (state.disabled || state.historyIndex <= 0) return;
        finishPen(false);
        state.historyIndex -= 1;
        applySerializedSnapshot(state.history[state.historyIndex]);
    }

    function redo() {
        if (state.disabled || state.historyIndex >= state.history.length - 1) return;
        finishPen(false);
        state.historyIndex += 1;
        applySerializedSnapshot(state.history[state.historyIndex]);
    }

    async function loadSource(options, generation) {
        if (typeof options.content === "string") return options.content || defaultSvgSource();
        if (!options.sourceUrl) return defaultSvgSource();
        var controller = window.AbortController ? new AbortController() : null;
        state.loadController = controller;
        var response = await fetch(String(options.sourceUrl), {
            credentials: "same-origin",
            signal: controller ? controller.signal : undefined,
            headers: { "Accept": "image/svg+xml,text/plain;q=0.9,*/*;q=0.1" }
        });
        if (generation !== state.generation) throw new Error("SVG load cancelled");
        if (!response.ok) throw new Error("SVG request failed (" + response.status + ")");
        var declaredLength = finiteNumber(response.headers.get("Content-Length"));
        if (declaredLength !== null && declaredLength > MAX_SOURCE_BYTES) throw new Error("SVG source exceeds 5 MB");
        var text = await response.text();
        if (sourceByteLength(text) > MAX_SOURCE_BYTES) throw new Error("SVG source exceeds 5 MB");
        return text || defaultSvgSource();
    }

    async function init(options) {
        options = options || {};
        destroy();
        var generation = state.generation;
        var root = document.getElementById("handrive-svg-editor-surface");
        if (!root) throw new Error("SVG editor surface not found");
        state.root = root;
        state.refs = queryRefs(root);
        state.callbacks = {
            onDirtyChange: options.onDirtyChange,
            onReady: options.onReady,
            onError: options.onError
        };
        root.hidden = false;
        if (!state.refs.artboard || !state.refs.viewport || !state.refs.scene) {
            var surfaceError = new Error("SVG editor surface is incomplete");
            notifyError(surfaceError, label("labelLoadError", "Unable to load SVG"));
            throw surfaceError;
        }
        setStatus(root.dataset.labelLoading || (state.refs.status ? state.refs.status.textContent : "") || "Loading SVG…");
        installEventHandlers();
        try {
            var source = await loadSource(options, generation);
            if (generation !== state.generation) return api;
            var sanitized = parseAndSanitizeSvg(source);
            replaceLiveSvg(sanitized);
            var cleanContent = serializeSvg();
            state.savedContent = cleanContent;
            state.lastContent = cleanContent;
            state.history = [cleanContent];
            state.historyIndex = 0;
            state.dirty = false;
            state.initialized = true;
            syncSourceField(cleanContent);
            fitToViewport();
            updateAllUi();
            setStatus(label("labelReady", "Ready"));
            if (typeof state.callbacks.onDirtyChange === "function") {
                try { state.callbacks.onDirtyChange(false); } catch (_dirtyCallbackError) { /* no-op */ }
            }
            if (typeof state.callbacks.onReady === "function") {
                try { state.callbacks.onReady(api); } catch (_readyCallbackError) { /* no-op */ }
            }
            return api;
        } catch (error) {
            if (generation === state.generation) notifyError(error, label("labelLoadError", "Unable to load SVG"));
            throw error;
        }
    }

    function destroy() {
        if (state.loadController) state.loadController.abort();
        if (state.pen) {
            if (state.pen.points.length >= 2) updatePenPath();
            else state.pen.element.remove();
            state.pen = null;
        }
        state.listeners.forEach(function (item) {
            item[0].removeEventListener(item[1], item[2], item[3]);
        });
        if (state.resizeObserver) state.resizeObserver.disconnect();
        if (state.resizeRaf) cancelAnimationFrame(state.resizeRaf);
        var previousRoot = state.root;
        var previousArtboard = state.refs && state.refs.artboard;
        var previousContent = state.svg ? serializeSvg() : state.lastContent;
        var nextGeneration = state.generation + 1;
        if (previousArtboard) previousArtboard.replaceChildren();
        if (previousRoot) previousRoot.hidden = true;
        state = createInitialState();
        state.generation = nextGeneration;
        state.lastContent = previousContent || "";
    }

    function markClean() {
        if (!state.svg) return;
        state.savedContent = getContent();
        setDirty(false);
    }

    function getContent() {
        if (state.pen) finishPen(true);
        finalizeKeyboardNudge();
        return serializeSvg();
    }

    function getIsDirty() {
        return Boolean(state.dirty);
    }

    function setDisabled(disabled) {
        if (disabled && state.keyboardNudge) finalizeKeyboardNudge();
        state.disabled = Boolean(disabled);
        if (!state.root) return;
        state.root.classList.toggle("is-disabled", state.disabled);
        Array.from(state.root.querySelectorAll("button, input, textarea, select")).forEach(function (control) {
            control.disabled = state.disabled;
        });
        if (state.refs.viewport) state.refs.viewport.tabIndex = state.disabled ? -1 : 0;
        if (!state.disabled) updateAllUi();
    }

    function resize() {
        if (!state.svg || !state.refs.viewport) return;
        if (state.autoFit) fitToViewport();
        else renderCanvasTransform();
    }

    var api = {
        init: init,
        destroy: destroy,
        getContent: getContent,
        getIsDirty: getIsDirty,
        markClean: markClean,
        setDisabled: setDisabled,
        resize: resize
    };

    window.HandriveSvgEditor = api;

    function safeInverse(matrix) {
        if (!matrix) return null;
        try {
            var inverse;
            if (typeof matrix.inverse === "function") {
                inverse = matrix.inverse();
            } else {
                var determinant = matrix.a * matrix.d - matrix.b * matrix.c;
                if (!Number.isFinite(determinant) || Math.abs(determinant) < 0.000000000001) return null;
                inverse = {
                    a: matrix.d / determinant,
                    b: -matrix.b / determinant,
                    c: -matrix.c / determinant,
                    d: matrix.a / determinant,
                    e: (matrix.c * matrix.f - matrix.d * matrix.e) / determinant,
                    f: (matrix.b * matrix.e - matrix.a * matrix.f) / determinant
                };
            }
            return [inverse.a, inverse.b, inverse.c, inverse.d, inverse.e, inverse.f].every(Number.isFinite) ? inverse : null;
        } catch (_error) {
            return null;
        }
    }

    function transformPoint(x, y, matrix) {
        if (!matrix) return { x: x, y: y };
        if (window.DOMPoint) {
            var point = new DOMPoint(x, y).matrixTransform(matrix);
            return { x: point.x, y: point.y };
        }
        return {
            x: matrix.a * x + matrix.c * y + matrix.e,
            y: matrix.b * x + matrix.d * y + matrix.f
        };
    }

    function multiplyAffine(left, right) {
        return {
            a: left.a * right.a + left.c * right.b,
            b: left.b * right.a + left.d * right.b,
            c: left.a * right.c + left.c * right.d,
            d: left.b * right.c + left.d * right.d,
            e: left.a * right.e + left.c * right.f + left.e,
            f: left.b * right.e + left.d * right.f + left.f
        };
    }

    function elementToRootMatrix(element) {
        if (!state.svg || !element || typeof element.getScreenCTM !== "function" || typeof state.svg.getScreenCTM !== "function") return null;
        if (element === state.svg) return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
        var rootInverse = safeInverse(state.svg.getScreenCTM());
        var elementScreen = element.getScreenCTM();
        if (!rootInverse || !elementScreen) return null;
        return multiplyAffine(rootInverse, elementScreen);
    }

    function clientToSvgPoint(clientX, clientY, element) {
        var target = element || state.svg;
        if (!target || typeof target.getScreenCTM !== "function") return null;
        var inverse = safeInverse(target.getScreenCTM());
        if (!inverse) return null;
        var point = transformPoint(clientX, clientY, inverse);
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
        return point;
    }

    function snapValue(value) {
        if (!state.snapEnabled || !Number.isFinite(state.gridSize) || state.gridSize <= 0) return value;
        return Math.round(value / state.gridSize) * state.gridSize;
    }

    function snapPoint(point) {
        if (!point) return null;
        return { x: snapValue(point.x), y: snapValue(point.y) };
    }

    function getRenderableMaxZoom() {
        var viewBox = getViewBox();
        var longest = Math.max(viewBox.width, viewBox.height, 1);
        return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, 1000000 / longest));
    }

    function setZoom(nextZoom, anchorClientX, anchorClientY) {
        if (!state.svg || !state.refs.viewport) return;
        var oldZoom = state.zoom;
        var viewBox = getViewBox();
        var viewportRect = state.refs.viewport.getBoundingClientRect();
        var maximum = getRenderableMaxZoom();
        var zoom = clamp(Number(nextZoom) || oldZoom, MIN_ZOOM, maximum);
        if (Math.abs(zoom - oldZoom) < 0.000000001) return;

        if (Number.isFinite(anchorClientX) && Number.isFinite(anchorClientY)) {
            var anchorX = anchorClientX - viewportRect.left;
            var anchorY = anchorClientY - viewportRect.top;
            var oldWidth = viewBox.width * oldZoom;
            var oldHeight = viewBox.height * oldZoom;
            var oldLeft = viewportRect.width / 2 - oldWidth / 2 + state.panX;
            var oldTop = viewportRect.height / 2 - oldHeight / 2 + state.panY;
            var ratioX = oldWidth ? (anchorX - oldLeft) / oldWidth : 0.5;
            var ratioY = oldHeight ? (anchorY - oldTop) / oldHeight : 0.5;
            var newWidth = viewBox.width * zoom;
            var newHeight = viewBox.height * zoom;
            state.panX = anchorX - ratioX * newWidth - (viewportRect.width / 2 - newWidth / 2);
            state.panY = anchorY - ratioY * newHeight - (viewportRect.height / 2 - newHeight / 2);
        }
        state.zoom = zoom;
        state.autoFit = false;
        renderCanvasTransform();
    }

    function fitToViewport() {
        if (!state.svg || !state.refs.viewport) return;
        var viewBox = getViewBox();
        var rect = state.refs.viewport.getBoundingClientRect();
        if (rect.width <= 1 || rect.height <= 1) return;
        var padding = Math.min(48, Math.max(12, Math.min(rect.width, rect.height) * 0.05));
        var availableWidth = Math.max(1, rect.width - padding * 2);
        var availableHeight = Math.max(1, rect.height - padding * 2);
        state.zoom = clamp(Math.min(availableWidth / viewBox.width, availableHeight / viewBox.height), MIN_ZOOM, getRenderableMaxZoom());
        state.panX = 0;
        state.panY = 0;
        state.autoFit = true;
        renderCanvasTransform();
    }

    function scheduleResize() {
        if (state.resizeRaf) cancelAnimationFrame(state.resizeRaf);
        state.resizeRaf = requestAnimationFrame(function () {
            state.resizeRaf = 0;
            if (state.autoFit) fitToViewport();
            else renderCanvasTransform();
        });
    }

    function renderCanvasTransform() {
        if (!state.svg || !state.refs.viewport || !state.refs.artboard) return;
        var viewBox = getViewBox();
        var viewportRect = state.refs.viewport.getBoundingClientRect();
        var width = Math.max(1, viewBox.width * state.zoom);
        var height = Math.max(1, viewBox.height * state.zoom);
        state.refs.artboard.style.width = width + "px";
        state.refs.artboard.style.height = height + "px";
        state.refs.artboard.style.left = state.panX + "px";
        state.refs.artboard.style.top = state.panY + "px";
        state.svg.setAttribute("data-hse-live-style", "1");
        state.svg.style.width = "100%";
        state.svg.style.height = "100%";
        state.svg.style.display = "block";
        if (state.refs.zoomValue) {
            var percent = state.zoom * 100;
            state.refs.zoomValue.textContent = (percent >= 10 ? Math.round(percent) : Number(percent.toFixed(2))) + "%";
        }
        if (state.refs.grid) {
            var rawStep = state.gridSize * state.zoom;
            var step = rawStep;
            if (rawStep < 4) step = rawStep * Math.max(1, Math.ceil(4 / rawStep));
            else if (rawStep > 400) step = rawStep / Math.max(1, Math.ceil(rawStep / 400));
            var gridOriginX = viewportRect.width / 2 + state.panX - width / 2 - viewBox.x * state.zoom;
            var gridOriginY = viewportRect.height / 2 + state.panY - height / 2 - viewBox.y * state.zoom;
            state.refs.grid.style.setProperty("--hse-grid-step", step + "px");
            state.refs.grid.style.backgroundSize = step + "px " + step + "px";
            state.refs.grid.style.backgroundPosition = gridOriginX + "px " + gridOriginY + "px";
            state.refs.grid.hidden = !state.gridVisible;
        }
        updateSelectionBox();
    }

    function stripEditorDataFromClone(clone) {
        Array.from(clone.querySelectorAll("[data-hse-overlay]")).forEach(function (element) { element.remove(); });
        Array.from(clone.querySelectorAll("[data-hse-live-style]")).concat(clone.hasAttribute("data-hse-live-style") ? [clone] : []).forEach(function (element) {
            element.removeAttribute("style");
        });
        Array.from(clone.querySelectorAll("*")).concat([clone]).forEach(function (element) {
            Array.from(element.attributes || []).forEach(function (attribute) {
                if (attribute.name.toLowerCase().indexOf("data-hse-") === 0) {
                    element.removeAttribute(attribute.name);
                }
            });
        });
    }

    function safeElementBBox(element) {
        if (!element || typeof element.getBBox !== "function" || typeof element.getScreenCTM !== "function") return null;
        try {
            var bbox = element.getBBox();
            var matrix = elementToRootMatrix(element);
            if (!matrix || ![bbox.x, bbox.y, bbox.width, bbox.height].every(Number.isFinite)) return null;
            var corners = [
                transformPoint(bbox.x, bbox.y, matrix),
                transformPoint(bbox.x + bbox.width, bbox.y, matrix),
                transformPoint(bbox.x + bbox.width, bbox.y + bbox.height, matrix),
                transformPoint(bbox.x, bbox.y + bbox.height, matrix)
            ];
            var xs = corners.map(function (point) { return point.x; });
            var ys = corners.map(function (point) { return point.y; });
            return {
                x: Math.min.apply(Math, xs),
                y: Math.min.apply(Math, ys),
                width: Math.max.apply(Math, xs) - Math.min.apply(Math, xs),
                height: Math.max.apply(Math, ys) - Math.min.apply(Math, ys)
            };
        } catch (_error) {
            return null;
        }
    }

    function unionRootBounds(elements) {
        var boxes = elements.map(safeElementBBox).filter(Boolean);
        if (!boxes.length) return null;
        var minX = Math.min.apply(Math, boxes.map(function (box) { return box.x; }));
        var minY = Math.min.apply(Math, boxes.map(function (box) { return box.y; }));
        var maxX = Math.max.apply(Math, boxes.map(function (box) { return box.x + box.width; }));
        var maxY = Math.max.apply(Math, boxes.map(function (box) { return box.y + box.height; }));
        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }

    function updateSelectionBox() {
        var box = state.refs.selectionBox;
        if (!box || !state.refs.viewport || !state.selected.size) {
            if (box) box.hidden = true;
            return;
        }
        var rects = Array.from(state.selected).filter(function (element) {
            return element.isConnected && element.getClientRects().length;
        }).map(function (element) {
            try { return element.getBoundingClientRect(); } catch (_error) { return null; }
        }).filter(function (rect) { return rect && Number.isFinite(rect.left) && Number.isFinite(rect.top); });
        if (!rects.length) {
            box.hidden = true;
            return;
        }
        var viewportRect = state.refs.viewport.getBoundingClientRect();
        var left = Math.min.apply(Math, rects.map(function (rect) { return rect.left; })) - viewportRect.left;
        var top = Math.min.apply(Math, rects.map(function (rect) { return rect.top; })) - viewportRect.top;
        var right = Math.max.apply(Math, rects.map(function (rect) { return rect.right; })) - viewportRect.left;
        var bottom = Math.max.apply(Math, rects.map(function (rect) { return rect.bottom; })) - viewportRect.top;
        box.style.left = left + "px";
        box.style.top = top + "px";
        box.style.width = Math.max(0, right - left) + "px";
        box.style.height = Math.max(0, bottom - top) + "px";
        box.hidden = false;
    }

    function isOverlayElement(element) {
        return Boolean(element && element.closest && element.closest("[data-hse-overlay]"));
    }

    function isSelectable(element) {
        if (!element || element === state.svg || isOverlayElement(element)) return false;
        if (!GRAPHICS_ELEMENTS.has(localName(element))) return false;
        var ancestor = element;
        while (ancestor && ancestor !== state.svg) {
            if (NON_SELECTABLE_ANCESTORS.has(localName(ancestor))) return false;
            ancestor = ancestor.parentElement;
        }
        return state.svg && state.svg.contains(element);
    }

    function isElementLocked(element) {
        var node = element;
        while (node && node !== state.svg) {
            if (state.locked.has(node)) return true;
            node = node.parentElement;
        }
        return false;
    }

    function findSelectable(target) {
        var element = target && target.nodeType === 1 ? target : target && target.parentElement;
        while (element && element !== state.svg) {
            if (isSelectable(element)) {
                if ((localName(element) === "tspan" || localName(element) === "textpath") && element.closest("text")) {
                    return element.closest("text");
                }
                return element;
            }
            element = element.parentElement;
        }
        return null;
    }

    function selectElements(elements, additive) {
        if (state.pen) finishPen(true);
        var next = additive ? new Set(state.selected) : new Set();
        (elements || []).forEach(function (element) {
            if (!isSelectable(element)) return;
            if (additive && next.has(element)) next.delete(element);
            else next.add(element);
        });
        state.selected = next;
        renderSelectionState();
    }

    function clearSelection() {
        if (!state.selected.size) return;
        state.selected.clear();
        clearNodeOverlay();
        renderSelectionState();
    }

    function renderDocumentState() {
        updateViewBoxFields();
        renderCanvasTransform();
        renderLayers();
        renderSelectionState();
        var viewBox = getViewBox();
        if (state.refs.documentSize) {
            state.refs.documentSize.textContent = formatNumber(viewBox.width) + " × " + formatNumber(viewBox.height);
        }
    }

    function renderSelectionState() {
        Array.from(state.selected).forEach(function (element) {
            if (!element.isConnected) state.selected.delete(element);
        });
        updateLiveEditorMarkers();
        updateSelectionBox();
        updatePropertyFields();
        updateActionButtons();
        renderLayerSelection();
        if (state.tool === "nodes") renderNodeOverlay();
        else clearNodeOverlay();
        if (state.selected.size) {
            setStatus(label("labelSelected", "Selected") + ": " + state.selected.size);
        } else {
            setStatus(label("labelReady", "Ready"));
        }
    }

    function updateAllUi() {
        updateToolUi();
        updateHistoryButtons();
        updateActionButtons();
        updateViewBoxFields();
        updatePropertyFields();
        renderLayers();
        renderCanvasTransform();
        if (state.refs.gridSize) state.refs.gridSize.value = formatNumber(state.gridSize);
        if (state.refs.snap) state.refs.snap.checked = state.snapEnabled;
    }

    function updateToolUi() {
        state.refs.tools.forEach(function (button) {
            var active = button.dataset.svgTool === state.tool;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-pressed", active ? "true" : "false");
        });
        if (state.refs.viewport) {
            state.refs.viewport.dataset.svgActiveTool = state.tool;
            state.refs.viewport.dataset.svgTool = state.tool;
        }
    }

    function setTool(tool) {
        if (state.disabled || !["select", "nodes", "pen", "rect", "ellipse", "line", "text"].includes(tool)) return;
        if (state.tool === "pen" && tool !== "pen") finishPen(true);
        state.tool = tool;
        if (tool !== "nodes") clearNodeOverlay();
        updateToolUi();
        if (tool === "nodes") renderNodeOverlay();
        if (state.refs.viewport) state.refs.viewport.focus({ preventScroll: true });
    }

    function updateActionButtons() {
        if (!state.root) return;
        var selected = Array.from(state.selected);
        var topLevel = getTopLevelSelection();
        var group = state.root.querySelector('[data-svg-action="group"]');
        var ungroup = state.root.querySelector('[data-svg-action="ungroup"]');
        var duplicate = state.root.querySelector('[data-svg-action="duplicate"]');
        var remove = state.root.querySelector('[data-svg-action="delete"]');
        var lower = state.root.querySelector('[data-svg-action="lower"]');
        var raise = state.root.querySelector('[data-svg-action="raise"]');
        var sameParent = topLevel.length > 1 && topLevel.every(function (element) { return element.parentNode === topLevel[0].parentNode; });
        var selectedGroups = selected.filter(function (element) { return localName(element) === "g"; });
        if (group) group.disabled = state.disabled || !sameParent;
        if (ungroup) ungroup.disabled = state.disabled || !selectedGroups.length || !selectedGroups.every(canUngroup);
        if (duplicate) duplicate.disabled = state.disabled || !topLevel.length;
        if (remove) remove.disabled = state.disabled || !topLevel.length;
        if (lower) lower.disabled = state.disabled || !topLevel.length;
        if (raise) raise.disabled = state.disabled || !topLevel.length;
        var grid = state.root.querySelector('[data-svg-action="grid"]');
        if (grid) {
            grid.disabled = state.disabled;
            grid.setAttribute("aria-pressed", state.gridVisible ? "true" : "false");
        }
        updateHistoryButtons();
    }

    function getTopLevelSelection() {
        return Array.from(state.selected).filter(function (element) {
            var parent = element.parentElement;
            while (parent && parent !== state.svg) {
                if (state.selected.has(parent)) return false;
                parent = parent.parentElement;
            }
            return element.isConnected && !isElementLocked(element);
        });
    }

    function updateViewBoxFields() {
        var viewBox = getViewBox();
        state.refs.viewBoxInputs.forEach(function (input) {
            var key = input.dataset.svgViewbox;
            if (Object.prototype.hasOwnProperty.call(viewBox, key) && document.activeElement !== input) {
                input.value = formatNumber(viewBox[key]);
            }
        });
    }

    function getSourceId(element) {
        var id = String(element && element.getAttribute("id") || "");
        return id.indexOf(state.idPrefix) === 0 ? id.slice(state.idPrefix.length) : id;
    }

    function inheritedAttribute(element, name, fallback) {
        var node = element;
        while (node && node !== state.svg.parentElement) {
            if (node.hasAttribute && node.hasAttribute(name)) return node.getAttribute(name);
            node = node.parentElement;
        }
        return fallback;
    }

    function colorToHex(value, fallback) {
        var color = String(value || "").trim();
        var short = color.match(/^#([0-9a-f]{3})$/i);
        if (short) return "#" + short[1].split("").map(function (part) { return part + part; }).join("").toLowerCase();
        var full = color.match(/^#([0-9a-f]{6})$/i);
        if (full) return "#" + full[1].toLowerCase();
        var rgb = color.match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/i);
        if (rgb) {
            return "#" + [rgb[1], rgb[2], rgb[3]].map(function (part) {
                return Math.round(clamp(Number(part), 0, 255)).toString(16).padStart(2, "0");
            }).join("");
        }
        return fallback || "#000000";
    }

    function propertyControl(name) {
        return state.root ? state.root.querySelector('[data-svg-property="' + name + '"]') : null;
    }

    function updatePropertyFields() {
        if (!state.refs.propertyFields || !state.refs.emptySelection) return;
        var selected = Array.from(state.selected);
        var element = selected.length === 1 ? selected[0] : null;
        state.refs.emptySelection.hidden = selected.length > 0;
        state.refs.propertyFields.hidden = selected.length === 0;
        if (!selected.length) return;

        var idInput = propertyControl("id");
        if (idInput) {
            idInput.disabled = state.disabled || !element;
            if (document.activeElement !== idInput) idInput.value = element ? getSourceId(element) : "";
        }
        var fillEnabled = propertyControl("fill-enabled");
        var fill = propertyControl("fill");
        var strokeEnabled = propertyControl("stroke-enabled");
        var stroke = propertyControl("stroke");
        var strokeWidth = propertyControl("stroke-width");
        var opacity = propertyControl("opacity");
        var first = selected[0];
        var fillValue = inheritedAttribute(first, "fill", localName(first) === "line" ? "none" : "#000000");
        var strokeValue = inheritedAttribute(first, "stroke", "none");
        if (fillEnabled) fillEnabled.checked = fillValue !== "none";
        if (fill) {
            fill.value = colorToHex(fillValue, fill.value || "#2563eb");
            fill.disabled = state.disabled || fillValue === "none";
        }
        if (strokeEnabled) strokeEnabled.checked = strokeValue !== "none";
        if (stroke) {
            stroke.value = colorToHex(strokeValue, stroke.value || "#111827");
            stroke.disabled = state.disabled || strokeValue === "none";
        }
        if (strokeWidth && document.activeElement !== strokeWidth) {
            strokeWidth.value = formatNumber(clamp(Number(inheritedAttribute(first, "stroke-width", 1)) || 0, 0, 10000));
        }
        if (opacity && document.activeElement !== opacity) {
            opacity.value = formatNumber(clamp((Number(inheritedAttribute(first, "opacity", 1)) || 0) * 100, 0, 100));
        }
        var isText = Boolean(element && (localName(element) === "text" || localName(element) === "tspan"));
        if (state.refs.textField) state.refs.textField.hidden = !isText;
        var text = propertyControl("text");
        if (text) {
            text.disabled = state.disabled || !isText;
            if (isText && document.activeElement !== text) text.value = element.textContent || "";
        }
    }

    function updateLiveEditorMarkers() {
        if (!state.svg) return;
        Array.from(state.svg.querySelectorAll("[data-hse-selectable], [data-hse-selected], [data-hse-locked]")).forEach(function (element) {
            element.removeAttribute("data-hse-selectable");
            element.removeAttribute("data-hse-selected");
            element.removeAttribute("data-hse-locked");
        });
        Array.from(state.svg.querySelectorAll("*")).forEach(function (element) {
            if (isSelectable(element)) element.setAttribute("data-hse-selectable", "true");
            if (state.selected.has(element)) element.setAttribute("data-hse-selected", "true");
            if (isElementLocked(element)) element.setAttribute("data-hse-locked", "true");
        });
    }

    function layerElements(parent) {
        return Array.from(parent.children || []).filter(function (element) {
            var name = localName(element);
            return !isOverlayElement(element) && !LAYER_SKIP_ELEMENTS.has(name) && (GRAPHICS_ELEMENTS.has(name) || name === "g");
        });
    }

    function layerLabel(element) {
        var tag = localName(element) || "object";
        var id = getSourceId(element);
        if (id) return tag + "#" + id;
        if (tag === "text") {
            var text = String(element.textContent || "").replace(/\s+/g, " ").trim();
            if (text) return text.slice(0, 32);
        }
        return tag;
    }

    function isElementHidden(element) {
        return element.getAttribute("display") === "none" || element.getAttribute("visibility") === "hidden";
    }

    function renderLayers() {
        var list = state.refs.layerList;
        if (!list || !state.svg) return;
        list.replaceChildren();
        state.layerRows = new Map();
        var count = 0;
        var fragment = document.createDocumentFragment();

        function appendLevel(parent, depth) {
            layerElements(parent).slice().reverse().forEach(function (element) {
                count += 1;
                var row = document.createElement("div");
                row.className = "hse-layer-row";
                row.setAttribute("role", "treeitem");
                row.setAttribute("aria-level", String(depth + 1));
                row.setAttribute("aria-selected", state.selected.has(element) ? "true" : "false");
                row.dataset.svgLayerDepth = String(depth);
                row.style.setProperty("--hse-layer-depth", String(depth));

                var type = document.createElement("span");
                type.className = "hse-layer-type";
                type.textContent = localName(element);

                var name = document.createElement("span");
                name.className = "hse-layer-name";
                name.textContent = layerLabel(element);

                var visibility = document.createElement("button");
                visibility.type = "button";
                visibility.className = "hse-layer-icon-button hse-layer-visibility";
                visibility.dataset.svgLayerVisibility = "1";
                visibility.title = label("labelVisibility", "Visibility");
                visibility.setAttribute("aria-pressed", isElementHidden(element) ? "false" : "true");
                visibility.textContent = isElementHidden(element) ? "○" : "●";

                var lock = document.createElement("button");
                lock.type = "button";
                lock.className = "hse-layer-icon-button hse-layer-lock";
                lock.dataset.svgLayerLock = "1";
                lock.title = label("labelLock", "Lock");
                lock.setAttribute("aria-pressed", state.locked.has(element) ? "true" : "false");
                lock.textContent = state.locked.has(element) ? "◆" : "◇";

                if (state.selected.has(element)) row.classList.add("is-selected");
                if (isElementHidden(element)) row.classList.add("is-hidden");
                if (isElementLocked(element)) row.classList.add("is-locked");
                if (state.disabled) {
                    visibility.disabled = true;
                    lock.disabled = true;
                }
                visibility.addEventListener("click", function (event) {
                    event.stopPropagation();
                    toggleLayerVisibility(element);
                });
                function selectLayer(event) {
                    if (isElementLocked(element)) return;
                    selectElements([element], event.shiftKey || event.metaKey || event.ctrlKey);
                    if (state.refs.viewport) state.refs.viewport.focus({ preventScroll: true });
                }
                row.tabIndex = state.disabled ? -1 : 0;
                row.addEventListener("click", function (event) {
                    if (event.target === visibility || event.target === lock) return;
                    selectLayer(event);
                });
                row.addEventListener("keydown", function (event) {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    selectLayer(event);
                });
                lock.addEventListener("click", function (event) {
                    event.stopPropagation();
                    toggleLayerLock(element);
                });
                row.append(type, name, visibility, lock);
                state.layerRows.set(element, row);
                fragment.appendChild(row);
                if (localName(element) === "g" || localName(element) === "switch") appendLevel(element, depth + 1);
            });
        }

        appendLevel(state.svg, 0);
        list.appendChild(fragment);
        if (!count) {
            var empty = document.createElement("p");
            empty.className = "hse-layer-empty";
            empty.textContent = label("labelEmptyLayers", "No objects");
            list.appendChild(empty);
        }
        if (state.refs.layerCount) state.refs.layerCount.textContent = String(count);
    }

    function renderLayerSelection() {
        if (!state.refs.layerList || !state.layerRows) return;
        state.layerRows.forEach(function (row, element) {
            var selected = state.selected.has(element);
            row.classList.toggle("is-selected", selected);
            row.setAttribute("aria-selected", selected ? "true" : "false");
        });
    }

    function toggleLayerVisibility(element) {
        if (state.disabled) return;
        if (isElementHidden(element)) {
            var original = state.visibilityOriginals.get(element);
            if (original) {
                if (original.hadDisplay) element.setAttribute("display", original.display);
                else element.removeAttribute("display");
                if (original.hadVisibility) element.setAttribute("visibility", original.visibility);
                else element.removeAttribute("visibility");
                state.visibilityOriginals.delete(element);
            } else {
                if (element.getAttribute("display") === "none") element.removeAttribute("display");
                if (element.getAttribute("visibility") === "hidden") element.removeAttribute("visibility");
            }
        } else {
            state.visibilityOriginals.set(element, {
                hadDisplay: element.hasAttribute("display"),
                display: element.getAttribute("display") || "",
                hadVisibility: element.hasAttribute("visibility"),
                visibility: element.getAttribute("visibility") || ""
            });
            element.setAttribute("display", "none");
        }
        commitHistory();
        renderDocumentState();
    }

    function toggleLayerLock(element) {
        if (state.disabled) return;
        if (state.locked.has(element)) state.locked.delete(element);
        else {
            state.locked.add(element);
            Array.from(state.selected).forEach(function (selected) {
                if (selected === element || element.contains(selected)) state.selected.delete(selected);
            });
        }
        updateLiveEditorMarkers();
        renderLayers();
        renderSelectionState();
    }

    function installEventHandlers() {
        state.refs.tools.forEach(function (button) {
            bind(button, "click", function () { setTool(button.dataset.svgTool); });
        });
        state.refs.actions.forEach(function (button) {
            bind(button, "click", function () { handleAction(button.dataset.svgAction); });
        });
        state.refs.properties.forEach(function (control) {
            bind(control, "input", function () {
                if (control.type === "checkbox" || control.dataset.svgProperty === "id") return;
                applyPropertyControl(control);
            });
            bind(control, "change", function () {
                if (!applyPropertyControl(control)) return;
                commitHistory();
                renderDocumentState();
            });
        });
        state.refs.viewBoxInputs.forEach(function (input) {
            bind(input, "change", applyViewBoxControls);
        });
        if (state.refs.gridSize) {
            bind(state.refs.gridSize, "change", function () {
                var value = finiteNumber(state.refs.gridSize.value);
                state.gridSize = value === null ? 1 : clamp(value, 1, 10000);
                state.refs.gridSize.value = formatNumber(state.gridSize);
                renderCanvasTransform();
            });
        }
        if (state.refs.snap) {
            bind(state.refs.snap, "change", function () { state.snapEnabled = state.refs.snap.checked; });
        }
        bind(state.refs.viewport, "pointerdown", onViewportPointerDown);
        bind(state.refs.viewport, "pointermove", onViewportPointerMove);
        bind(state.refs.viewport, "pointerup", onViewportPointerUp);
        bind(state.refs.viewport, "pointercancel", onViewportPointerCancel);
        bind(state.refs.viewport, "lostpointercapture", onViewportLostCapture);
        bind(state.refs.viewport, "dblclick", onViewportDoubleClick);
        bind(state.refs.viewport, "wheel", onViewportWheel, { passive: false });
        state.refs.resizeHandles.forEach(function (handle) {
            handle.setAttribute("data-hse-overlay", "resize");
            bind(handle, "pointerdown", beginResize);
        });
        if (state.refs.selectionBox) state.refs.selectionBox.setAttribute("data-hse-overlay", "selection");
        bind(document, "keydown", onKeyDown);
        bind(document, "keyup", onKeyUp);
        bind(window, "blur", function () {
            state.spacePressed = false;
            finalizeKeyboardNudge();
            if (state.drag) cancelCurrentDrag(true);
        });
        if (window.ResizeObserver) {
            state.resizeObserver = new ResizeObserver(scheduleResize);
            state.resizeObserver.observe(state.refs.viewport);
        } else {
            bind(window, "resize", scheduleResize);
        }
    }

    function handleAction(action) {
        if (state.disabled) return;
        var sourceCandidate = action === "apply-source" && state.refs.source ? state.refs.source.value : undefined;
        finalizeKeyboardNudge();
        if (state.pen && !["grid", "zoom-in", "zoom-out", "zoom-fit"].includes(action)) finishPen(true);
        if (action === "undo") undo();
        else if (action === "redo") redo();
        else if (action === "group") groupSelection();
        else if (action === "ungroup") ungroupSelection();
        else if (action === "duplicate") duplicateSelection();
        else if (action === "delete") deleteSelection();
        else if (action === "lower") reorderSelection(-1);
        else if (action === "raise") reorderSelection(1);
        else if (action === "grid") {
            state.gridVisible = !state.gridVisible;
            renderCanvasTransform();
            updateActionButtons();
        } else if (action === "zoom-in") {
            var rectIn = state.refs.viewport.getBoundingClientRect();
            setZoom(state.zoom * 1.2, rectIn.left + rectIn.width / 2, rectIn.top + rectIn.height / 2);
        } else if (action === "zoom-out") {
            var rectOut = state.refs.viewport.getBoundingClientRect();
            setZoom(state.zoom / 1.2, rectOut.left + rectOut.width / 2, rectOut.top + rectOut.height / 2);
        } else if (action === "zoom-fit") fitToViewport();
        else if (action === "apply-source") applySourceFromField(sourceCandidate);
    }

    function validSourceId(value) {
        var id = String(value || "").trim();
        return !id || isSafeFragment("#" + id);
    }

    function existingSourceIds(exclude) {
        var ids = new Set();
        if (!state.svg) return ids;
        Array.from(state.svg.querySelectorAll("[id]")).concat(state.svg.hasAttribute("id") ? [state.svg] : []).forEach(function (element) {
            if (element !== exclude) ids.add(getSourceId(element));
        });
        return ids;
    }

    function rewriteLiveReference(oldInternalId, newInternalId) {
        if (!state.svg || oldInternalId === newInternalId) return;
        var replacements = new Map([[oldInternalId, newInternalId]]);
        walkAttributes(state.svg, function (_element, attribute) {
            if (attribute.name.toLowerCase() === "id") return;
            rewriteReferenceAttribute(attribute, replacements);
        });
    }

    function setElementSourceId(element, sourceId) {
        var id = String(sourceId || "").trim();
        if (!validSourceId(id) || (id && existingSourceIds(element).has(id))) {
            setStatus(label("labelInvalidSource", "Invalid SVG source"));
            return false;
        }
        var oldInternal = element.getAttribute("id") || "";
        if (!id) {
            element.removeAttribute("id");
            if (oldInternal) {
                walkAttributes(state.svg, function (owner, attribute) {
                    if (attribute.name.toLowerCase() === "id") return;
                    var lowerName = String(attribute.localName || attribute.name || "").toLowerCase();
                    var trimmed = String(attribute.value || "").trim();
                    var exact = (lowerName === "href" || lowerName === "src") && trimmed === "#" + oldInternal;
                    var urlPattern = new RegExp("url\\(\\s*([\\\"']?)#" + oldInternal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\1\\s*\\)", "i");
                    if (exact || urlPattern.test(attribute.value)) owner.removeAttributeNS(attribute.namespaceURI, attribute.localName);
                });
            }
            return true;
        }
        var nextInternal = state.idPrefix + id;
        element.setAttribute("id", nextInternal);
        if (oldInternal) rewriteLiveReference(oldInternal, nextInternal);
        return true;
    }

    function applyPropertyControl(control) {
        if (state.disabled) return false;
        if (state.pen) finishPen(true);
        if (!state.selected.size) return false;
        var name = control.dataset.svgProperty;
        var selected = Array.from(state.selected);
        if (name === "id") {
            if (selected.length !== 1 || !setElementSourceId(selected[0], control.value)) {
                updatePropertyFields();
                return false;
            }
        } else if (name === "fill-enabled") {
            selected.forEach(function (element) {
                element.setAttribute("fill", control.checked ? (propertyControl("fill").value || "#2563eb") : "none");
            });
        } else if (name === "stroke-enabled") {
            selected.forEach(function (element) {
                element.setAttribute("stroke", control.checked ? (propertyControl("stroke").value || "#111827") : "none");
            });
        } else if (name === "fill" || name === "stroke") {
            selected.forEach(function (element) { element.setAttribute(name, control.value); });
        } else if (name === "stroke-width") {
            var width = finiteNumber(control.value);
            if (width === null) return false;
            width = clamp(width, 0, 10000);
            selected.forEach(function (element) { element.setAttribute("stroke-width", formatNumber(width)); });
        } else if (name === "opacity") {
            var opacity = finiteNumber(control.value);
            if (opacity === null) return false;
            opacity = clamp(opacity, 0, 100);
            selected.forEach(function (element) { element.setAttribute("opacity", formatNumber(opacity / 100)); });
        } else if (name === "text") {
            if (selected.length !== 1 || !["text", "tspan"].includes(localName(selected[0]))) return false;
            selected[0].textContent = control.value;
        } else {
            return false;
        }
        setDirty(true);
        updateSelectionBox();
        if (name === "id" || name === "text") renderLayers();
        return true;
    }

    function applyViewBoxControls() {
        if (state.disabled || !state.svg) return;
        if (state.pen) finishPen(true);
        var current = getViewBox();
        var next = {};
        state.refs.viewBoxInputs.forEach(function (input) {
            next[input.dataset.svgViewbox] = finiteNumber(input.value);
        });
        if ([next.x, next.y, next.width, next.height].some(function (value) { return value === null; }) ||
            next.width <= 0 || next.height <= 0 || next.width > MAX_DIMENSION || next.height > MAX_DIMENSION ||
            Math.abs(next.x) > MAX_COORDINATE || Math.abs(next.y) > MAX_COORDINATE) {
            state.refs.viewBoxInputs.forEach(function (input) {
                input.setAttribute("aria-invalid", "true");
                input.value = formatNumber(current[input.dataset.svgViewbox]);
            });
            setStatus(label("labelInvalidSource", "Invalid SVG source"));
            return;
        }
        state.refs.viewBoxInputs.forEach(function (input) { input.removeAttribute("aria-invalid"); });
        state.svg.setAttribute("viewBox", [next.x, next.y, next.width, next.height].map(formatNumber).join(" "));
        commitHistory();
        if (state.autoFit) fitToViewport();
        else renderDocumentState();
    }

    function applySourceFromField(sourceCandidate) {
        if (state.disabled || !state.refs.source) return;
        try {
            var candidate = parseAndSanitizeSvg(sourceCandidate === undefined ? state.refs.source.value : sourceCandidate);
            replaceLiveSvg(candidate);
            state.refs.source.removeAttribute("aria-invalid");
            commitHistory();
            state.refs.source.value = serializeSvg();
            fitToViewport();
            setStatus(label("labelReady", "Ready"));
        } catch (error) {
            state.refs.source.setAttribute("aria-invalid", "true");
            setStatus(label("labelInvalidSource", "Invalid SVG source"));
        }
    }

    function prependTransform(element, prefix, original) {
        var existing = original === undefined ? String(element.getAttribute("transform") || "").trim() : String(original || "").trim();
        var value = String(prefix || "").trim();
        element.setAttribute("transform", value + (existing ? " " + existing : ""));
    }

    function makeUniqueSourceId(base, used) {
        var clean = String(base || "object").replace(/\s+/g, "-").slice(0, 480) || "object";
        var index = 2;
        var candidate = clean + "-copy";
        while (used.has(candidate)) candidate = clean + "-copy-" + index++;
        used.add(candidate);
        return candidate;
    }

    function uniquifyCloneIds(clone) {
        var used = existingSourceIds();
        var mapping = new Map();
        Array.from(clone.querySelectorAll("[id]")).concat(clone.hasAttribute("id") ? [clone] : []).forEach(function (element) {
            var internal = element.getAttribute("id") || "";
            var original = internal.indexOf(state.idPrefix) === 0 ? internal.slice(state.idPrefix.length) : internal;
            var unique = makeUniqueSourceId(original, used);
            var replacement = state.idPrefix + unique;
            mapping.set(internal, replacement);
            element.setAttribute("id", replacement);
        });
        walkAttributes(clone, function (_element, attribute) {
            if (attribute.name.toLowerCase() === "id") return;
            rewriteReferenceAttribute(attribute, mapping);
        });
    }

    function groupSelection() {
        var elements = getTopLevelSelection();
        if (elements.length < 2 || !elements.every(function (element) { return element.parentNode === elements[0].parentNode; })) return;
        var parent = elements[0].parentNode;
        var ordered = Array.from(parent.children).filter(function (element) { return elements.includes(element); });
        var group = document.createElementNS(SVG_NS, "g");
        parent.insertBefore(group, ordered[0]);
        ordered.forEach(function (element) { group.appendChild(element); });
        state.selected = new Set([group]);
        commitHistory();
        renderDocumentState();
    }

    function canUngroup(group) {
        if (!group || localName(group) !== "g" || group.hasAttribute("id")) return false;
        var safeAttributes = new Set([
            "transform", "fill", "fill-opacity", "fill-rule", "stroke", "stroke-opacity",
            "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit",
            "stroke-dasharray", "stroke-dashoffset", "color", "font-family", "font-size",
            "font-style", "font-weight", "text-anchor", "visibility", "display", "pointer-events",
            "shape-rendering"
        ]);
        return Array.from(group.attributes || []).every(function (attribute) {
            var name = String(attribute.localName || attribute.name || "").toLowerCase();
            return name.indexOf("data-hse-") === 0 || safeAttributes.has(name);
        });
    }

    function ungroupSelection() {
        var groups = getTopLevelSelection().filter(function (element) { return localName(element) === "g" && canUngroup(element); });
        if (!groups.length) return;
        var newSelection = [];
        var inheritedNames = ["fill", "fill-opacity", "fill-rule", "stroke", "stroke-opacity", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "color", "font-family", "font-size", "font-style", "font-weight", "text-anchor", "visibility", "display", "pointer-events", "shape-rendering"];
        groups.forEach(function (group) {
            var parent = group.parentNode;
            var groupTransform = String(group.getAttribute("transform") || "").trim();
            Array.from(group.children).filter(function (child) { return !isOverlayElement(child); }).forEach(function (child) {
                if (groupTransform) prependTransform(child, groupTransform);
                inheritedNames.forEach(function (name) {
                    if (!child.hasAttribute(name) && group.hasAttribute(name)) child.setAttribute(name, group.getAttribute(name));
                });
                parent.insertBefore(child, group);
                if (isSelectable(child)) newSelection.push(child);
            });
            group.remove();
        });
        state.selected = new Set(newSelection);
        commitHistory();
        renderDocumentState();
    }

    function duplicateSelection() {
        var elements = getTopLevelSelection();
        if (!elements.length) return;
        var offset = state.snapEnabled ? state.gridSize : Math.max(1, getViewBox().width / 100);
        var clones = [];
        elements.forEach(function (element) {
            var clone = element.cloneNode(true);
            stripEditorDataFromClone(clone);
            uniquifyCloneIds(clone);
            prependTransform(clone, "translate(" + formatNumber(offset) + " " + formatNumber(offset) + ")");
            element.parentNode.insertBefore(clone, element.nextSibling);
            clones.push(clone);
        });
        state.selected = new Set(clones);
        commitHistory();
        renderDocumentState();
    }

    function deleteSelection() {
        var elements = getTopLevelSelection();
        if (!elements.length) return;
        clearNodeOverlay();
        elements.forEach(function (element) { element.remove(); });
        state.selected.clear();
        commitHistory();
        renderDocumentState();
    }

    function reorderSelection(direction) {
        var elements = getTopLevelSelection();
        if (!elements.length) return;
        var changed = false;
        var ordered = direction > 0 ? elements.slice().reverse() : elements.slice();
        ordered.forEach(function (element) {
            var sibling = direction > 0 ? element.nextElementSibling : element.previousElementSibling;
            while (sibling && isOverlayElement(sibling)) sibling = direction > 0 ? sibling.nextElementSibling : sibling.previousElementSibling;
            if (!sibling) return;
            if (direction > 0) element.parentNode.insertBefore(sibling, element);
            else element.parentNode.insertBefore(element, sibling);
            changed = true;
        });
        if (changed) {
            commitHistory();
            renderDocumentState();
        }
    }

    function startPointerDrag(event, drag) {
        state.drag = drag;
        drag.pointerId = event.pointerId;
        try { state.refs.viewport.setPointerCapture(event.pointerId); } catch (_error) { /* no-op */ }
        event.preventDefault();
    }

    function beginPan(event) {
        startPointerDrag(event, {
            type: "pan",
            startClientX: event.clientX,
            startClientY: event.clientY,
            startPanX: state.panX,
            startPanY: state.panY,
            moved: false
        });
        state.autoFit = false;
        state.refs.viewport.classList.add("is-panning");
    }

    function rootDeltaToParent(element, dx, dy) {
        var parent = element.parentElement;
        if (!parent || parent === state.svg) return { x: dx, y: dy };
        var inverse = safeInverse(elementToRootMatrix(parent));
        if (!inverse) return { x: dx, y: dy };
        return {
            x: inverse.a * dx + inverse.c * dy,
            y: inverse.b * dx + inverse.d * dy
        };
    }

    function beginMove(event) {
        var point = clientToSvgPoint(event.clientX, event.clientY);
        var elements = getTopLevelSelection();
        if (!point || !elements.length) return;
        startPointerDrag(event, {
            type: "move",
            start: point,
            elements: elements,
            originals: elements.map(function (element) { return element.getAttribute("transform") || ""; }),
            bounds: unionRootBounds(elements),
            moved: false
        });
    }

    function createSvgElement(name, attributes) {
        var element = document.createElementNS(SVG_NS, name);
        Object.keys(attributes || {}).forEach(function (key) { element.setAttribute(key, attributes[key]); });
        return element;
    }

    function beginShape(event, shape) {
        var point = snapPoint(clientToSvgPoint(event.clientX, event.clientY));
        if (!point) return;
        var attributes = shape === "line"
            ? { x1: formatNumber(point.x), y1: formatNumber(point.y), x2: formatNumber(point.x), y2: formatNumber(point.y), fill: "none", stroke: "#111827", "stroke-width": "2" }
            : { fill: "#2563eb", stroke: "none" };
        var element = createSvgElement(shape, attributes);
        state.svg.appendChild(element);
        state.selected = new Set([element]);
        startPointerDrag(event, { type: "draw", shape: shape, element: element, start: point, moved: false });
        renderSelectionState();
        setDirty(true);
    }

    function insertText(event) {
        var point = snapPoint(clientToSvgPoint(event.clientX, event.clientY));
        if (!point) return;
        var viewBox = getViewBox();
        var text = createSvgElement("text", {
            x: formatNumber(point.x),
            y: formatNumber(point.y),
            fill: "#111827",
            "font-size": formatNumber(clamp(Math.min(viewBox.width, viewBox.height) / 24, 12, 72))
        });
        text.textContent = "Text";
        state.svg.appendChild(text);
        state.selected = new Set([text]);
        commitHistory();
        renderDocumentState();
        setTool("select");
    }

    function onViewportPointerDown(event) {
        if (state.disabled || !state.svg || event.isPrimary === false) return;
        finalizeKeyboardNudge();
        if (event.button === 1 || state.spacePressed) {
            beginPan(event);
            return;
        }
        if (event.button !== 0) return;
        var nodeHandle = event.target && event.target.closest ? event.target.closest("[data-hse-node-index]") : null;
        if (nodeHandle) {
            beginNodeDrag(event, nodeHandle);
            return;
        }
        var target = findSelectable(event.target);
        if (state.tool === "pen") {
            addPenPoint(event);
            return;
        }
        if (["rect", "ellipse", "line"].includes(state.tool)) {
            beginShape(event, state.tool);
            return;
        }
        if (state.tool === "text") {
            insertText(event);
            return;
        }
        if (!target) {
            clearSelection();
            if (state.tool === "select") state.refs.viewport.focus({ preventScroll: true });
            return;
        }
        if (isElementLocked(target)) return;
        var additive = event.shiftKey || event.metaKey || event.ctrlKey;
        if (!state.selected.has(target) || additive) selectElements([target], additive);
        if (state.tool === "select" && state.selected.has(target)) beginMove(event);
        else if (state.tool === "nodes") renderNodeOverlay();
    }

    function updateMoveDrag(event, drag) {
        var point = clientToSvgPoint(event.clientX, event.clientY);
        if (!point) return;
        var dx = point.x - drag.start.x;
        var dy = point.y - drag.start.y;
        if (drag.bounds && state.snapEnabled) {
            dx = snapValue(drag.bounds.x + dx) - drag.bounds.x;
            dy = snapValue(drag.bounds.y + dy) - drag.bounds.y;
        }
        drag.elements.forEach(function (element, index) {
            var delta = rootDeltaToParent(element, dx, dy);
            if (Math.abs(delta.x) <= 0.000001 && Math.abs(delta.y) <= 0.000001) {
                if (drag.originals[index]) element.setAttribute("transform", drag.originals[index]);
                else element.removeAttribute("transform");
            } else {
                prependTransform(element, "translate(" + formatNumber(delta.x) + " " + formatNumber(delta.y) + ")", drag.originals[index]);
            }
        });
        drag.moved = drag.moved || Math.abs(dx) > 0.000001 || Math.abs(dy) > 0.000001;
        if (drag.moved) setDirty(true);
        updateSelectionBox();
        if (state.tool === "nodes") renderNodeOverlay();
    }

    function updateDrawDrag(event, drag) {
        var point = snapPoint(clientToSvgPoint(event.clientX, event.clientY));
        if (!point) return;
        var x = Math.min(drag.start.x, point.x);
        var y = Math.min(drag.start.y, point.y);
        var width = Math.abs(point.x - drag.start.x);
        var height = Math.abs(point.y - drag.start.y);
        if (drag.shape === "rect") {
            drag.element.setAttribute("x", formatNumber(x));
            drag.element.setAttribute("y", formatNumber(y));
            drag.element.setAttribute("width", formatNumber(width));
            drag.element.setAttribute("height", formatNumber(height));
        } else if (drag.shape === "ellipse") {
            drag.element.setAttribute("cx", formatNumber(x + width / 2));
            drag.element.setAttribute("cy", formatNumber(y + height / 2));
            drag.element.setAttribute("rx", formatNumber(width / 2));
            drag.element.setAttribute("ry", formatNumber(height / 2));
        } else {
            drag.element.setAttribute("x2", formatNumber(point.x));
            drag.element.setAttribute("y2", formatNumber(point.y));
        }
        drag.moved = drag.shape === "line"
            ? Math.hypot(point.x - drag.start.x, point.y - drag.start.y) > 0.000001
            : width > 0.000001 && height > 0.000001;
        updateSelectionBox();
    }

    function onViewportPointerMove(event) {
        if (!state.svg) return;
        var point = clientToSvgPoint(event.clientX, event.clientY);
        if (point && state.refs.coordinates) {
            state.refs.coordinates.textContent = "X: " + formatNumber(point.x) + ", Y: " + formatNumber(point.y);
        }
        var drag = state.drag;
        if (!drag || drag.pointerId !== event.pointerId) return;
        if (drag.type === "pan") {
            state.panX = drag.startPanX + event.clientX - drag.startClientX;
            state.panY = drag.startPanY + event.clientY - drag.startClientY;
            drag.moved = true;
            renderCanvasTransform();
        } else if (drag.type === "move") updateMoveDrag(event, drag);
        else if (drag.type === "draw") updateDrawDrag(event, drag);
        else if (drag.type === "resize") updateResizeDrag(event, drag);
        else if (drag.type === "node") updateNodeDrag(event, drag);
        event.preventDefault();
    }

    function completeCurrentDrag() {
        var drag = state.drag;
        if (!drag) return;
        state.drag = null;
        if (state.refs.viewport) state.refs.viewport.classList.remove("is-panning");
        if (drag.type === "draw") {
            if (!drag.moved) {
                drag.element.remove();
                state.selected.clear();
                syncDirtyFromContent();
                renderDocumentState();
            } else {
                commitHistory();
                renderDocumentState();
                setTool("select");
            }
        } else if (["move", "resize", "node"].includes(drag.type) && drag.moved) {
            commitHistory();
            renderDocumentState();
        }
    }

    function restoreDragOriginals(drag) {
        if (!drag) return;
        if ((drag.type === "move" || drag.type === "resize") && drag.elements) {
            drag.elements.forEach(function (element, index) {
                var original = drag.originals[index];
                if (original) element.setAttribute("transform", original);
                else element.removeAttribute("transform");
            });
        } else if (drag.type === "draw" && drag.element) {
            drag.element.remove();
            state.selected.delete(drag.element);
        } else if (drag.type === "node" && drag.beforeValues) {
            restoreNodeState(drag.element, drag.beforeValues);
        }
    }

    function cancelCurrentDrag(revert) {
        var drag = state.drag;
        if (!drag) return;
        state.drag = null;
        if (state.refs.viewport) state.refs.viewport.classList.remove("is-panning");
        if (revert) restoreDragOriginals(drag);
        renderDocumentState();
        syncDirtyFromContent();
    }

    function onViewportPointerUp(event) {
        if (!state.drag || state.drag.pointerId !== event.pointerId) return;
        try { state.refs.viewport.releasePointerCapture(event.pointerId); } catch (_error) { /* no-op */ }
        completeCurrentDrag();
    }

    function onViewportPointerCancel(event) {
        if (state.drag && state.drag.pointerId === event.pointerId) cancelCurrentDrag(true);
    }

    function onViewportLostCapture(event) {
        if (state.drag && state.drag.pointerId === event.pointerId) completeCurrentDrag();
    }

    function onViewportDoubleClick(event) {
        if (state.tool === "pen") {
            event.preventDefault();
            finishPen(true, true);
        }
    }

    function onViewportWheel(event) {
        if (state.disabled || !state.svg) return;
        event.preventDefault();
        state.autoFit = false;
        if (event.ctrlKey || event.metaKey || event.altKey) {
            setZoom(state.zoom * Math.exp(-event.deltaY * 0.002), event.clientX, event.clientY);
        } else {
            state.panX -= event.shiftKey ? event.deltaY : event.deltaX;
            state.panY -= event.shiftKey ? 0 : event.deltaY;
            renderCanvasTransform();
        }
    }

    function beginResize(event) {
        if (state.disabled || !state.selected.size || event.button !== 0) return;
        var bounds = unionRootBounds(getTopLevelSelection());
        if (!bounds || bounds.width <= 0.000001 || bounds.height <= 0.000001) return;
        var direction = event.currentTarget.dataset.svgResize;
        var corner = {
            x: direction.indexOf("w") >= 0 ? bounds.x : bounds.x + bounds.width,
            y: direction.indexOf("n") >= 0 ? bounds.y : bounds.y + bounds.height
        };
        var anchor = {
            x: direction.indexOf("w") >= 0 ? bounds.x + bounds.width : bounds.x,
            y: direction.indexOf("n") >= 0 ? bounds.y + bounds.height : bounds.y
        };
        var elements = getTopLevelSelection();
        startPointerDrag(event, {
            type: "resize",
            direction: direction,
            bounds: bounds,
            corner: corner,
            anchor: anchor,
            elements: elements,
            originals: elements.map(function (element) { return element.getAttribute("transform") || ""; }),
            moved: false
        });
        event.stopPropagation();
    }

    function updateResizeDrag(event, drag) {
        var point = clientToSvgPoint(event.clientX, event.clientY);
        if (!point) return;
        point = snapPoint(point);
        var denominatorX = drag.corner.x - drag.anchor.x;
        var denominatorY = drag.corner.y - drag.anchor.y;
        var scaleX = denominatorX ? (point.x - drag.anchor.x) / denominatorX : 1;
        var scaleY = denominatorY ? (point.y - drag.anchor.y) / denominatorY : 1;
        scaleX = Math.max(0.001, scaleX);
        scaleY = Math.max(0.001, scaleY);
        if (event.shiftKey) {
            var uniform = Math.max(0.001, Math.min(scaleX, scaleY));
            scaleX = uniform;
            scaleY = uniform;
        }
        var rootScale = {
            a: scaleX,
            b: 0,
            c: 0,
            d: scaleY,
            e: drag.anchor.x * (1 - scaleX),
            f: drag.anchor.y * (1 - scaleY)
        };
        drag.elements.forEach(function (element, index) {
            var parent = element.parentElement;
            var parentToRoot = parent && parent !== state.svg
                ? elementToRootMatrix(parent)
                : { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
            var rootToParent = safeInverse(parentToRoot);
            if (!rootToParent) return;
            var localScale = multiplyAffine(multiplyAffine(rootToParent, rootScale), parentToRoot);
            var transform = "matrix(" + [localScale.a, localScale.b, localScale.c, localScale.d, localScale.e, localScale.f].map(formatNumber).join(" ") + ")";
            prependTransform(element, transform, drag.originals[index]);
        });
        drag.moved = true;
        setDirty(true);
        updateSelectionBox();
        if (state.tool === "nodes") renderNodeOverlay();
    }

    function updatePenPath() {
        if (!state.pen || !state.pen.element) return;
        var parts = state.pen.points.map(function (point, index) {
            return (index ? "L " : "M ") + formatNumber(point.x) + " " + formatNumber(point.y);
        });
        state.pen.element.setAttribute("d", parts.join(" "));
        updateSelectionBox();
    }

    function addPenPoint(event) {
        var point = snapPoint(clientToSvgPoint(event.clientX, event.clientY));
        if (!point) return;
        if (!state.pen) {
            var path = createSvgElement("path", {
                d: "",
                fill: "none",
                stroke: "#111827",
                "stroke-width": "2",
                "stroke-linecap": "round",
                "stroke-linejoin": "round"
            });
            state.svg.appendChild(path);
            state.pen = { element: path, points: [] };
            state.selected = new Set([path]);
        }
        state.pen.points.push(point);
        updatePenPath();
        setDirty(true);
        renderSelectionState();
        event.preventDefault();
    }

    function finishPen(commit, removeDoublePoint) {
        if (!state.pen) return;
        var pen = state.pen;
        state.pen = null;
        if (removeDoublePoint && pen.points.length > 2) {
            var last = pen.points[pen.points.length - 1];
            var previous = pen.points[pen.points.length - 2];
            if (Math.hypot(last.x - previous.x, last.y - previous.y) < Math.max(0.000001, 3 / Math.max(state.zoom, MIN_ZOOM))) {
                pen.points.pop();
            }
        }
        if (!commit || pen.points.length < 2) {
            pen.element.remove();
            state.selected.delete(pen.element);
            syncDirtyFromContent();
            renderDocumentState();
            return;
        }
        state.pen = pen;
        updatePenPath();
        state.pen = null;
        commitHistory();
        renderDocumentState();
        if (state.tool === "pen") {
            state.tool = "select";
            updateToolUi();
        }
    }

    function tokenizePathData(value) {
        var source = String(value || "");
        var tokens = [];
        var pattern = /([AaCcHhLlMmQqSsTtVvZz])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;
        var lastIndex = 0;
        var match;
        while ((match = pattern.exec(source))) {
            var gap = source.slice(lastIndex, match.index);
            if (gap && !/^[\s,]*$/.test(gap)) return null;
            tokens.push(match[1] || Number(match[2]));
            lastIndex = pattern.lastIndex;
        }
        if (!/^[\s,]*$/.test(source.slice(lastIndex))) return null;
        return tokens;
    }

    function parsePathCommands(value) {
        var tokens = tokenizePathData(value);
        if (!tokens || !tokens.length) return null;
        var commands = [];
        var index = 0;
        var active = null;
        while (index < tokens.length) {
            if (typeof tokens[index] === "string") active = tokens[index++];
            if (!active) return null;
            var upper = active.toUpperCase();
            var count = PATH_PARAMETER_COUNTS[upper];
            if (count === undefined) return null;
            if (count === 0) {
                commands.push({ command: active, values: [] });
                active = null;
                continue;
            }
            if (index + count > tokens.length) return null;
            if (typeof tokens[index] === "string") return null;
            var values = tokens.slice(index, index + count);
            if (values.some(function (item) { return typeof item !== "number" || !Number.isFinite(item); })) return null;
            commands.push({ command: active, values: values });
            index += count;
            if (upper === "M") active = active === "M" ? "L" : "l";
            if (index < tokens.length && typeof tokens[index] !== "string" && PATH_PARAMETER_COUNTS[active.toUpperCase()] === 0) return null;
        }
        return commands;
    }

    function serializePathCommands(commands) {
        return commands.map(function (command) {
            return command.command + (command.values.length ? " " + command.values.map(formatNumber).join(" ") : "");
        }).join(" ");
    }

    function absolutizePathCommands(commands) {
        var currentX = 0;
        var currentY = 0;
        var subpathX = 0;
        var subpathY = 0;
        return commands.map(function (sourceCommand) {
            var upper = sourceCommand.command.toUpperCase();
            var relative = sourceCommand.command !== upper;
            var values = sourceCommand.values.slice();
            var baseX = currentX;
            var baseY = currentY;
            function absolutePair(xIndex, yIndex) {
                if (!relative) return;
                values[xIndex] += baseX;
                values[yIndex] += baseY;
            }
            if (upper === "M" || upper === "L" || upper === "T") {
                absolutePair(0, 1);
                currentX = values[0];
                currentY = values[1];
                if (upper === "M") { subpathX = currentX; subpathY = currentY; }
            } else if (upper === "H") {
                if (relative) values[0] += baseX;
                currentX = values[0];
            } else if (upper === "V") {
                if (relative) values[0] += baseY;
                currentY = values[0];
            } else if (upper === "C") {
                absolutePair(0, 1);
                absolutePair(2, 3);
                absolutePair(4, 5);
                currentX = values[4];
                currentY = values[5];
            } else if (upper === "S" || upper === "Q") {
                absolutePair(0, 1);
                absolutePair(2, 3);
                currentX = values[2];
                currentY = values[3];
            } else if (upper === "A") {
                absolutePair(5, 6);
                currentX = values[5];
                currentY = values[6];
            } else if (upper === "Z") {
                currentX = subpathX;
                currentY = subpathY;
            }
            return { command: upper, values: values };
        });
    }

    function buildPathNodeDescriptors(element) {
        var commands = parsePathCommands(element.getAttribute("d"));
        if (!commands) return [];
        commands = absolutizePathCommands(commands);
        var nodes = [];
        var currentX = 0;
        var currentY = 0;
        var subpathX = 0;
        var subpathY = 0;

        function addNode(command, xIndex, yIndex, baseX, baseY, relative, kind, axis, guide) {
            var x = axis === "y" ? currentX : (relative ? baseX + command.values[xIndex] : command.values[xIndex]);
            var y = axis === "x" ? currentY : (relative ? baseY + command.values[yIndex] : command.values[yIndex]);
            nodes.push({
                x: x,
                y: y,
                kind: kind,
                guide: guide || null,
                apply: function (point) {
                    if (axis !== "y") command.values[xIndex] = relative ? point.x - baseX : point.x;
                    if (axis !== "x") command.values[yIndex] = relative ? point.y - baseY : point.y;
                    element.setAttribute("d", serializePathCommands(commands));
                }
            });
        }

        commands.forEach(function (command) {
            var upper = command.command.toUpperCase();
            var relative = command.command !== upper;
            var baseX = currentX;
            var baseY = currentY;
            if (upper === "M" || upper === "L" || upper === "T") {
                addNode(command, 0, 1, baseX, baseY, relative, "anchor");
                currentX = relative ? baseX + command.values[0] : command.values[0];
                currentY = relative ? baseY + command.values[1] : command.values[1];
                if (upper === "M") { subpathX = currentX; subpathY = currentY; }
            } else if (upper === "H") {
                addNode(command, 0, 0, baseX, baseY, relative, "anchor", "x");
                currentX = relative ? baseX + command.values[0] : command.values[0];
            } else if (upper === "V") {
                addNode(command, 0, 0, baseX, baseY, relative, "anchor", "y");
                currentY = relative ? baseY + command.values[0] : command.values[0];
            } else if (upper === "C") {
                var cubicEnd = { x: relative ? baseX + command.values[4] : command.values[4], y: relative ? baseY + command.values[5] : command.values[5] };
                addNode(command, 0, 1, baseX, baseY, relative, "control", null, { x: baseX, y: baseY });
                addNode(command, 2, 3, baseX, baseY, relative, "control", null, cubicEnd);
                addNode(command, 4, 5, baseX, baseY, relative, "anchor");
                currentX = relative ? baseX + command.values[4] : command.values[4];
                currentY = relative ? baseY + command.values[5] : command.values[5];
            } else if (upper === "S" || upper === "Q") {
                var curveEnd = { x: relative ? baseX + command.values[2] : command.values[2], y: relative ? baseY + command.values[3] : command.values[3] };
                addNode(command, 0, 1, baseX, baseY, relative, "control", null, upper === "S" ? curveEnd : { x: baseX, y: baseY });
                addNode(command, 2, 3, baseX, baseY, relative, "anchor");
                currentX = relative ? baseX + command.values[2] : command.values[2];
                currentY = relative ? baseY + command.values[3] : command.values[3];
            } else if (upper === "A") {
                addNode(command, 5, 6, baseX, baseY, relative, "anchor");
                currentX = relative ? baseX + command.values[5] : command.values[5];
                currentY = relative ? baseY + command.values[6] : command.values[6];
            } else if (upper === "Z") {
                currentX = subpathX;
                currentY = subpathY;
            }
        });
        return nodes;
    }

    function parsePointPairs(value) {
        var tokens = String(value || "").trim().split(/[\s,]+/).filter(Boolean).map(finiteNumber);
        if (!tokens.length || tokens.some(function (item) { return item === null; }) || tokens.length % 2) return null;
        var points = [];
        for (var index = 0; index < tokens.length; index += 2) points.push({ x: tokens[index], y: tokens[index + 1] });
        return points;
    }

    function buildSimpleNodeDescriptors(element) {
        var name = localName(element);
        if (name === "line") {
            return [["x1", "y1"], ["x2", "y2"]].map(function (attributes) {
                return {
                    x: Number(element.getAttribute(attributes[0])) || 0,
                    y: Number(element.getAttribute(attributes[1])) || 0,
                    kind: "anchor",
                    apply: function (point) {
                        element.setAttribute(attributes[0], formatNumber(point.x));
                        element.setAttribute(attributes[1], formatNumber(point.y));
                    }
                };
            });
        }
        if (name === "polyline" || name === "polygon") {
            var points = parsePointPairs(element.getAttribute("points"));
            if (!points) return [];
            return points.map(function (point, pointIndex) {
                return {
                    x: point.x,
                    y: point.y,
                    kind: "anchor",
                    apply: function (next) {
                        points[pointIndex] = { x: next.x, y: next.y };
                        element.setAttribute("points", points.map(function (item) { return formatNumber(item.x) + "," + formatNumber(item.y); }).join(" "));
                    }
                };
            });
        }
        return [];
    }

    function clearNodeOverlay() {
        if (state.svg) {
            Array.from(state.svg.querySelectorAll('[data-hse-overlay="nodes"]')).forEach(function (element) { element.remove(); });
        }
        state.pathNodes = null;
    }

    function renderNodeOverlay() {
        clearNodeOverlay();
        if (state.tool !== "nodes" || state.selected.size !== 1 || !state.svg) return;
        var element = Array.from(state.selected)[0];
        var name = localName(element);
        var descriptors = name === "path" ? buildPathNodeDescriptors(element) : buildSimpleNodeDescriptors(element);
        if (!descriptors.length || typeof element.getScreenCTM !== "function") return;
        var matrix = elementToRootMatrix(element);
        if (!matrix) return;
        var overlay = createSvgElement("g", {
            "data-hse-overlay": "nodes",
            "class": "hse-node-overlay",
            "pointer-events": "all"
        });
        var radius = clamp(5 / Math.max(state.zoom, MIN_ZOOM), 0.5, Math.max(getViewBox().width, getViewBox().height) / 20);
        descriptors.forEach(function (descriptor, index) {
            var point = transformPoint(descriptor.x, descriptor.y, matrix);
            if (descriptor.kind === "control" && descriptor.guide) {
                var guidePoint = transformPoint(descriptor.guide.x, descriptor.guide.y, matrix);
                overlay.appendChild(createSvgElement("line", {
                    x1: formatNumber(guidePoint.x),
                    y1: formatNumber(guidePoint.y),
                    x2: formatNumber(point.x),
                    y2: formatNumber(point.y),
                    "class": "hse-node-guide",
                    "data-hse-overlay": "nodes"
                }));
            }
            var handle = createSvgElement("circle", {
                cx: formatNumber(point.x),
                cy: formatNumber(point.y),
                r: formatNumber(radius),
                fill: descriptor.kind === "control" ? "#ffffff" : "#2563eb",
                stroke: "#1d4ed8",
                "stroke-width": formatNumber(Math.max(radius * 0.35, 0.25)),
                "vector-effect": "non-scaling-stroke",
                "data-hse-overlay": "nodes",
                "data-hse-node-index": String(index),
                "class": descriptor.kind === "control" ? "hse-control-handle" : "hse-node-handle"
            });
            overlay.appendChild(handle);
        });
        state.svg.appendChild(overlay);
        state.pathNodes = { element: element, descriptors: descriptors, overlay: overlay };
    }

    function captureNodeState(element) {
        var name = localName(element);
        if (name === "path") return { d: element.getAttribute("d") || "" };
        if (name === "line") {
            return { x1: element.getAttribute("x1") || "", y1: element.getAttribute("y1") || "", x2: element.getAttribute("x2") || "", y2: element.getAttribute("y2") || "" };
        }
        return { points: element.getAttribute("points") || "" };
    }

    function restoreNodeState(element, values) {
        Object.keys(values || {}).forEach(function (name) { element.setAttribute(name, values[name]); });
    }

    function beginNodeDrag(event, handle) {
        if (!state.pathNodes || state.disabled || event.button !== 0) return;
        var index = Number(handle.dataset.hseNodeIndex);
        var descriptor = state.pathNodes.descriptors[index];
        if (!descriptor) return;
        startPointerDrag(event, {
            type: "node",
            element: state.pathNodes.element,
            descriptor: descriptor,
            beforeValues: captureNodeState(state.pathNodes.element),
            moved: false
        });
        event.stopPropagation();
    }

    function updateNodeDrag(event, drag) {
        var rootPoint = snapPoint(clientToSvgPoint(event.clientX, event.clientY));
        var inverse = safeInverse(elementToRootMatrix(drag.element));
        if (!rootPoint || !inverse) return;
        var localPoint = transformPoint(rootPoint.x, rootPoint.y, inverse);
        drag.descriptor.apply(localPoint);
        drag.moved = true;
        setDirty(true);
        updateSelectionBox();
        renderNodeOverlay();
    }

    function isEditableTarget(target) {
        if (!target || target.nodeType !== 1) return false;
        var tag = String(target.tagName || "").toLowerCase();
        return target.isContentEditable || tag === "input" || tag === "textarea" || tag === "select";
    }

    function moveSelectionByKeyboard(dx, dy) {
        if (!state.keyboardNudge) {
            var elements = getTopLevelSelection();
            if (!elements.length) return;
            state.keyboardNudge = {
                elements: elements,
                originals: elements.map(function (element) { return element.getAttribute("transform") || ""; }),
                dx: 0,
                dy: 0
            };
        }
        var nudge = state.keyboardNudge;
        nudge.dx += dx;
        nudge.dy += dy;
        nudge.elements.forEach(function (element, index) {
            var delta = rootDeltaToParent(element, nudge.dx, nudge.dy);
            if (Math.abs(delta.x) <= 0.000001 && Math.abs(delta.y) <= 0.000001) {
                if (nudge.originals[index]) element.setAttribute("transform", nudge.originals[index]);
                else element.removeAttribute("transform");
            } else {
                prependTransform(
                    element,
                    "translate(" + formatNumber(delta.x) + " " + formatNumber(delta.y) + ")",
                    nudge.originals[index]
                );
            }
        });
        setDirty(true);
        updateSelectionBox();
        if (state.tool === "nodes") renderNodeOverlay();
    }

    function finalizeKeyboardNudge() {
        if (!state.keyboardNudge) return;
        var nudge = state.keyboardNudge;
        state.keyboardNudge = null;
        if (Math.abs(nudge.dx) <= 0.000001 && Math.abs(nudge.dy) <= 0.000001) {
            syncDirtyFromContent();
        } else {
            commitHistory();
        }
        renderDocumentState();
    }

    function onKeyDown(event) {
        if (!state.root || state.root.hidden || state.disabled || event.isComposing) return;
        var editable = isEditableTarget(event.target);
        var modifier = event.metaKey || event.ctrlKey;
        var key = String(event.key || "").toLowerCase();
        var arrowKey = ["arrowleft", "arrowright", "arrowup", "arrowdown"].includes(key);
        if (editable) return;
        if (state.keyboardNudge && !arrowKey) finalizeKeyboardNudge();
        if (modifier && key === "z") {
            event.preventDefault();
            if (event.shiftKey) redo();
            else undo();
            return;
        }
        if (modifier && key === "y") {
            event.preventDefault();
            redo();
            return;
        }
        if (modifier && key === "d") {
            event.preventDefault();
            if (state.pen) finishPen(true);
            duplicateSelection();
            return;
        }
        if (key === " ") {
            state.spacePressed = true;
            event.preventDefault();
            return;
        }
        if (key === "escape") {
            event.preventDefault();
            if (state.pen) finishPen(false);
            else if (state.drag) cancelCurrentDrag(true);
            else clearSelection();
            return;
        }
        if (key === "enter" && state.pen) {
            event.preventDefault();
            finishPen(true);
            return;
        }
        if (key === "delete" || key === "backspace") {
            if (state.selected.size) {
                event.preventDefault();
                if (state.pen) finishPen(true);
                deleteSelection();
            }
            return;
        }
        var step = state.snapEnabled ? state.gridSize : 1;
        if (event.shiftKey) step *= 10;
        if (arrowKey && state.selected.size) {
            event.preventDefault();
            if (state.pen) finishPen(true);
            moveSelectionByKeyboard(key === "arrowleft" ? -step : key === "arrowright" ? step : 0, key === "arrowup" ? -step : key === "arrowdown" ? step : 0);
            return;
        }
        if (modifier || event.altKey) return;
        var tools = { v: "select", a: "nodes", n: "nodes", p: "pen", r: "rect", o: "ellipse", e: "ellipse", l: "line", t: "text" };
        if (tools[key]) {
            event.preventDefault();
            setTool(tools[key]);
        }
    }

    function onKeyUp(event) {
        if (event.key === " ") state.spacePressed = false;
        if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) finalizeKeyboardNudge();
    }

})();
