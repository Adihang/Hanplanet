(function () {
    "use strict";

    const DEFAULT_MERMAID_RUNTIME_URL = "https://cdn.jsdelivr.net/npm/mermaid@10.9.3/dist/mermaid.min.js";
    const currentScript = document.currentScript;
    const mermaidRuntimeUrl = String(
        (currentScript && currentScript.dataset && currentScript.dataset.mermaidRuntimeUrl)
        || document.documentElement.dataset.mermaidRuntimeUrl
        || DEFAULT_MERMAID_RUNTIME_URL
    ).trim();

    let mermaidLoadPromise = null;
    let activeMermaidConfigKey = "";
    let renderSequence = 0;

    function getDiagramElements(container, options) {
        const settings = options || {};
        const root = container && container.querySelectorAll ? container : document;
        const diagrams = Array.prototype.slice.call(
            root.querySelectorAll(".handrive-mermaid[data-handrive-mermaid-diagram]")
        );
        if (
            root instanceof Element &&
            root.matches(".handrive-mermaid[data-handrive-mermaid-diagram]")
        ) {
            diagrams.unshift(root);
        }
        return diagrams.filter(function (diagram) {
            return (settings.force || diagram.dataset.handriveMermaidRendered !== "1")
                && diagram.dataset.handriveMermaidLoading !== "1";
        });
    }

    function loadMermaidRuntime() {
        if (window.mermaid) {
            return Promise.resolve(window.mermaid);
        }
        if (mermaidLoadPromise) {
            return mermaidLoadPromise;
        }
        if (!mermaidRuntimeUrl) {
            return Promise.reject(new Error("Mermaid runtime URL is missing."));
        }

        mermaidLoadPromise = new Promise(function (resolve, reject) {
            const existingScript = Array.prototype.slice.call(document.scripts || []).find(function (script) {
                return script && script.getAttribute("src") === mermaidRuntimeUrl;
            });
            if (existingScript && window.mermaid) {
                resolve(window.mermaid);
                return;
            }

            const script = existingScript || document.createElement("script");
            const cleanup = function () {
                script.removeEventListener("load", handleLoad);
                script.removeEventListener("error", handleError);
            };
            const handleLoad = function () {
                cleanup();
                if (window.mermaid) {
                    resolve(window.mermaid);
                    return;
                }
                mermaidLoadPromise = null;
                reject(new Error("Mermaid runtime did not initialize."));
            };
            const handleError = function () {
                cleanup();
                mermaidLoadPromise = null;
                reject(new Error("Mermaid runtime failed to load."));
            };

            script.addEventListener("load", handleLoad);
            script.addEventListener("error", handleError);
            if (!existingScript) {
                script.src = mermaidRuntimeUrl;
                script.async = true;
                document.head.appendChild(script);
            }
        });

        return mermaidLoadPromise;
    }

    function isDarkTheme() {
        return Boolean(
            document.body && document.body.classList.contains("theme-dark")
            || document.documentElement.classList.contains("preload-dark-bg")
        );
    }

    function resolveCssColor(value, fallback) {
        if (!document.body) {
            return fallback;
        }
        const probe = document.createElement("span");
        probe.style.color = fallback;
        probe.style.color = value;
        probe.style.display = "none";
        document.body.appendChild(probe);
        const resolved = window.getComputedStyle(probe).color || fallback;
        probe.remove();
        return resolved;
    }

    function resolveThemeColorChain(names, fallback) {
        const fallbackValue = String(fallback || "currentColor").trim() || "currentColor";
        const expression = names.reduceRight(function (accumulator, name) {
            return "var(" + name + ", " + accumulator + ")";
        }, fallbackValue);
        return resolveCssColor(expression, fallbackValue);
    }

    function buildMermaidConfig() {
        const dark = isDarkTheme();
        const pageBg = resolveThemeColorChain(["--handrive-bg", "--site-bg"], dark ? "#222222" : "#ffffff");
        const surface = resolveThemeColorChain(
            ["--handrive-surface", "--site-elevated-bg", "--shared-card-bg", "--site-bg"],
            dark ? "#2c2c2c" : "#ffffff"
        );
        const surfaceMuted = resolveThemeColorChain(
            ["--handrive-markdown-code-block-bg", "--color-hover-bg", "--handrive-surface-muted", "--site-surface-muted"],
            dark ? "rgba(255, 255, 255, 0.13)" : "rgba(0, 0, 0, 0.12)"
        );
        const surfaceSubtle = resolveThemeColorChain(
            ["--handrive-surface-subtle", "--site-surface-muted", "--shared-card-bg"],
            dark ? "#363636" : "#f5f5f5"
        );
        const border = resolveThemeColorChain(["--handrive-border", "--site-border", "--site-border-mid"], dark ? "#7a7a7a" : "#b6b6b6");
        const text = resolveThemeColorChain(["--handrive-text", "--site-text"], dark ? "#f2f2f2" : "#222222");
        const textStrong = resolveThemeColorChain(
            ["--handrive-text-stronger", "--site-text-stronger", "--site-text-strong"],
            dark ? "#fafafa" : "#111111"
        );
        const textMuted = resolveThemeColorChain(["--handrive-text-muted", "--site-text-muted"], dark ? "#d6d6d6" : "#535353");
        const accent = resolveThemeColorChain(
            ["--handrive-drop-target-border", "--theme-accent-strong", "--site-link"],
            dark ? "#60a5fa" : "#2563eb"
        );
        const line = dark ? textStrong : textMuted;

        return {
            startOnLoad: false,
            securityLevel: "strict",
            theme: "base",
            themeVariables: {
                background: pageBg,
                primaryColor: surfaceSubtle,
                primaryTextColor: text,
                primaryBorderColor: border,
                secondaryColor: surface,
                secondaryTextColor: text,
                secondaryBorderColor: border,
                tertiaryColor: surfaceMuted,
                tertiaryTextColor: text,
                tertiaryBorderColor: border,
                mainBkg: surfaceSubtle,
                secondBkg: surface,
                lineColor: line,
                textColor: text,
                titleColor: textStrong,
                edgeLabelBackground: surfaceMuted,
                clusterBkg: surfaceMuted,
                clusterBorder: border,
                nodeBorder: border,
                nodeTextColor: text,
                noteBkgColor: surfaceMuted,
                noteTextColor: text,
                noteBorderColor: border,
                actorBkg: surfaceSubtle,
                actorBorder: border,
                actorTextColor: text,
                activationBkgColor: surfaceMuted,
                activationBorderColor: border,
                signalColor: line,
                signalTextColor: text,
                labelBoxBkgColor: surfaceSubtle,
                labelBoxBorderColor: border,
                labelTextColor: text,
                loopTextColor: text,
                pie1: accent,
                pie2: surfaceSubtle,
                pie3: surfaceMuted,
                pieStrokeColor: border,
                pieTitleTextSize: "18px",
                pieOuterStrokeColor: border,
            },
        };
    }

    function configureMermaid(mermaid) {
        if (!mermaid || typeof mermaid.initialize !== "function") {
            return;
        }
        const config = buildMermaidConfig();
        const configKey = JSON.stringify(config);
        if (configKey === activeMermaidConfigKey) {
            return;
        }
        mermaid.initialize(config);
        activeMermaidConfigKey = configKey;
    }

    function setDiagramError(diagram, message) {
        diagram.classList.remove("is-loading");
        diagram.classList.add("is-error");
        diagram.dataset.handriveMermaidLoading = "0";

        let errorElement = diagram.querySelector(".handrive-mermaid-error");
        if (!errorElement) {
            errorElement = document.createElement("p");
            errorElement.className = "handrive-mermaid-error";
            diagram.appendChild(errorElement);
        }
        errorElement.textContent = message || "Mermaid diagram could not be rendered.";
    }

    function renderDiagram(mermaid, diagram) {
        const sourceElement = diagram.querySelector(".handrive-mermaid-source");
        const source = String(sourceElement ? sourceElement.textContent || "" : diagram._handriveMermaidSource || "")
            .replace(/\n$/, "");
        if (!source.trim()) {
            return Promise.resolve();
        }
        diagram._handriveMermaidSource = source;

        diagram.dataset.handriveMermaidLoading = "1";
        diagram.classList.add("is-loading");
        renderSequence += 1;
        const renderId = "handrive-mermaid-" + Date.now().toString(36) + "-" + String(renderSequence);

        return Promise.resolve(mermaid.render(renderId, source))
            .then(function (result) {
                const svg = result && typeof result.svg === "string" ? result.svg : "";
                if (!svg.trim()) {
                    throw new Error("Mermaid returned an empty diagram.");
                }

                const outputElement = document.createElement("div");
                outputElement.className = "handrive-mermaid-output";
                outputElement.innerHTML = svg;

                diagram.innerHTML = "";
                diagram.appendChild(outputElement);
                diagram.classList.remove("is-loading", "is-error");
                diagram.classList.add("is-rendered");
                diagram.dataset.handriveMermaidRendered = "1";
                diagram.dataset.handriveMermaidLoading = "0";

                if (result && typeof result.bindFunctions === "function") {
                    result.bindFunctions(outputElement);
                }
            })
            .catch(function (error) {
                setDiagramError(diagram, error && error.message ? error.message : "");
            });
    }

    function renderMermaidDiagrams(container, options) {
        const diagrams = getDiagramElements(container, options);
        if (!diagrams.length) {
            return Promise.resolve([]);
        }

        return loadMermaidRuntime()
            .then(function (mermaid) {
                configureMermaid(mermaid);
                return Promise.all(diagrams.map(function (diagram) {
                    return renderDiagram(mermaid, diagram);
                }));
            });
    }

    window.HanplanetMarkdownMermaid = {
        load: loadMermaidRuntime,
        render: renderMermaidDiagrams,
    };

    function rerenderDocumentDiagrams() {
        renderMermaidDiagrams(document, { force: true }).catch(function () {});
    }

    function renderDocumentDiagrams() {
        renderMermaidDiagrams(document).catch(function () {});
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", renderDocumentDiagrams, { once: true });
    } else {
        window.setTimeout(renderDocumentDiagrams, 0);
    }

    window.addEventListener("hanplanet:themechange", function () {
        window.setTimeout(rerenderDocumentDiagrams, 0);
    });
})();
