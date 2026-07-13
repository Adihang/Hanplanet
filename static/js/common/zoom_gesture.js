(function () {
    "use strict";

    if (window.HanplanetZoomGesture) {
        return;
    }

    const DEFAULT_MIN_VALUE = 0.1;
    const DEFAULT_MAX_VALUE = 10;
    const DEFAULT_WHEEL_STEP = 1;

    function resolveOption(option, fallback, context) {
        if (typeof option === "function") {
            const resolved = option(context || {});
            return resolved === undefined || resolved === null ? fallback : resolved;
        }
        return option === undefined || option === null ? fallback : option;
    }

    function clampValue(value, settings, context) {
        const minValue = Number(resolveOption(settings.min, DEFAULT_MIN_VALUE, context));
        const maxValue = Number(resolveOption(settings.max, DEFAULT_MAX_VALUE, context));
        const fallbackValue = Number(resolveOption(settings.defaultValue, 1, context));
        const normalizedValue = Number(value);
        const safeValue = Number.isFinite(normalizedValue) ? normalizedValue : fallbackValue;
        return Math.max(minValue, Math.min(maxValue, safeValue));
    }

    function readCurrentValue(settings, context) {
        if (typeof settings.getValue !== "function") {
            return clampValue(resolveOption(settings.defaultValue, 1, context), settings, context);
        }
        return clampValue(settings.getValue(context || {}), settings, context);
    }

    function writeCurrentValue(value, settings, context) {
        if (typeof settings.setValue !== "function") {
            return;
        }
        settings.setValue(clampValue(value, settings, context), context || {});
    }

    function getWheelDelta(event) {
        const deltaY = Number(event && event.deltaY) || 0;
        if (Math.abs(deltaY) > 0.01) {
            return deltaY;
        }
        return Number(event && event.deltaX) || 0;
    }

    function normalizeWheelDelta(event) {
        let delta = getWheelDelta(event);
        if (event && event.deltaMode === 1) {
            delta *= 16;
        } else if (event && event.deltaMode === 2) {
            delta *= window.innerHeight || 800;
        }
        return delta;
    }

    function getTouchPoint(touch) {
        return {
            x: Number(touch.clientX) || 0,
            y: Number(touch.clientY) || 0,
        };
    }

    function getTouchDistance(touches) {
        if (!touches || touches.length < 2) {
            return 0;
        }
        const first = getTouchPoint(touches[0]);
        const second = getTouchPoint(touches[1]);
        const dx = first.x - second.x;
        const dy = first.y - second.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    function getTouchCenter(touches) {
        if (!touches || !touches.length) {
            return { x: 0, y: 0 };
        }
        let sumX = 0;
        let sumY = 0;
        for (let index = 0; index < touches.length; index += 1) {
            const point = getTouchPoint(touches[index]);
            sumX += point.x;
            sumY += point.y;
        }
        return {
            x: sumX / touches.length,
            y: sumY / touches.length,
        };
    }

    function shouldHandleWheel(event, settings) {
        if (!event || event.defaultPrevented) {
            return false;
        }
        if (!(event.ctrlKey || event.metaKey)) {
            return false;
        }
        if (settings.ignoreAlt && event.altKey) {
            return false;
        }
        return Math.abs(getWheelDelta(event)) > 0.01;
    }

    function bind(surface, options) {
        if (!surface || typeof surface.addEventListener !== "function") {
            return null;
        }

        if (surface._hanplanetZoomGestureDestroy) {
            surface._hanplanetZoomGestureDestroy();
        }

        const settings = Object.assign({
            min: DEFAULT_MIN_VALUE,
            max: DEFAULT_MAX_VALUE,
            wheelStep: DEFAULT_WHEEL_STEP,
            pinchPower: 1,
            ignoreAlt: false,
            stopPropagation: true,
        }, options || {});
        let pinchActive = false;
        let pinchStartDistance = 0;
        let pinchStartValue = 1;
        let gestureStartValue = 1;

        surface.classList.add("hp-zoom-surface");
        surface.setAttribute("data-hp-pinch-zoom", "true");

        function stopEvent(event) {
            event.preventDefault();
            if (settings.stopPropagation) {
                event.stopPropagation();
            }
        }

        function applyWheelZoom(event) {
            if (!shouldHandleWheel(event, settings)) {
                return;
            }
            stopEvent(event);
            const delta = getWheelDelta(event);
            const direction = delta < 0 ? 1 : -1;
            const context = {
                inputType: "wheel",
                originalEvent: event,
                delta: delta,
                normalizedDelta: normalizeWheelDelta(event),
                direction: direction,
                clientX: Number(event.clientX) || 0,
                clientY: Number(event.clientY) || 0,
            };
            const currentValue = readCurrentValue(settings, context);
            const step = Number(resolveOption(settings.wheelStep, DEFAULT_WHEEL_STEP, context)) || DEFAULT_WHEEL_STEP;
            context.currentValue = currentValue;
            context.step = step;
            const nextValue = typeof settings.getWheelValue === "function"
                ? settings.getWheelValue(context)
                : currentValue + (direction * step);
            writeCurrentValue(nextValue, settings, context);
        }

        function startPinch(event) {
            if (!event || !event.touches || event.touches.length < 2) {
                return;
            }
            const distance = getTouchDistance(event.touches);
            if (!distance) {
                return;
            }
            const center = getTouchCenter(event.touches);
            const context = {
                inputType: "pinch-start",
                originalEvent: event,
                clientX: center.x,
                clientY: center.y,
            };
            pinchActive = true;
            pinchStartDistance = distance;
            pinchStartValue = readCurrentValue(settings, context);
            stopEvent(event);
        }

        function movePinch(event) {
            if (!pinchActive || !event || !event.touches || event.touches.length < 2) {
                return;
            }
            const distance = getTouchDistance(event.touches);
            if (!distance || !pinchStartDistance) {
                return;
            }
            const center = getTouchCenter(event.touches);
            const ratio = distance / pinchStartDistance;
            const power = Number(resolveOption(settings.pinchPower, 1, {
                inputType: "pinch",
                originalEvent: event,
                ratio: ratio,
                clientX: center.x,
                clientY: center.y,
            })) || 1;
            const context = {
                inputType: "pinch",
                originalEvent: event,
                ratio: ratio,
                clientX: center.x,
                clientY: center.y,
            };
            stopEvent(event);
            writeCurrentValue(pinchStartValue * Math.pow(ratio, power), settings, context);
        }

        function endPinch(event) {
            if (!pinchActive) {
                return;
            }
            if (event && event.touches && event.touches.length >= 2) {
                startPinch(event);
                return;
            }
            pinchActive = false;
            pinchStartDistance = 0;
        }

        function startGesture(event) {
            const context = {
                inputType: "gesture-start",
                originalEvent: event,
                clientX: Number(event && event.clientX) || 0,
                clientY: Number(event && event.clientY) || 0,
            };
            gestureStartValue = readCurrentValue(settings, context);
            stopEvent(event);
        }

        function changeGesture(event) {
            const scale = Number(event && event.scale) || 1;
            const context = {
                inputType: "gesture",
                originalEvent: event,
                ratio: scale,
                clientX: Number(event && event.clientX) || 0,
                clientY: Number(event && event.clientY) || 0,
            };
            stopEvent(event);
            writeCurrentValue(gestureStartValue * scale, settings, context);
        }

        surface.addEventListener("wheel", applyWheelZoom, { passive: false });
        surface.addEventListener("touchstart", startPinch, { passive: false, capture: true });
        surface.addEventListener("touchmove", movePinch, { passive: false, capture: true });
        surface.addEventListener("touchend", endPinch, { passive: false, capture: true });
        surface.addEventListener("touchcancel", endPinch, { passive: false, capture: true });
        surface.addEventListener("gesturestart", startGesture, { passive: false, capture: true });
        surface.addEventListener("gesturechange", changeGesture, { passive: false, capture: true });

        const destroy = function () {
            surface.removeEventListener("wheel", applyWheelZoom, { passive: false });
            surface.removeEventListener("touchstart", startPinch, { capture: true });
            surface.removeEventListener("touchmove", movePinch, { capture: true });
            surface.removeEventListener("touchend", endPinch, { capture: true });
            surface.removeEventListener("touchcancel", endPinch, { capture: true });
            surface.removeEventListener("gesturestart", startGesture, { capture: true });
            surface.removeEventListener("gesturechange", changeGesture, { capture: true });
            if (surface._hanplanetZoomGestureDestroy === destroy) {
                delete surface._hanplanetZoomGestureDestroy;
            }
        };

        surface._hanplanetZoomGestureDestroy = destroy;
        return { destroy: destroy };
    }

    function getUiPreviewModalContent(modal) {
        return modal ? modal.querySelector("#ui-preview-content") : null;
    }

    function getUiPreviewModalBody(modal) {
        return modal
            ? modal.querySelector(".handrive-help-modal-body, .site-modal-body, .modal-body")
            : null;
    }

    function getUiPreviewModalImageElement(content) {
        return content ? content.querySelector(".handrive-media-image-element") : null;
    }

    function getUiPreviewModalImageMinZoom(content) {
        var imageElement = getUiPreviewModalImageElement(content);
        if (!content || !imageElement) {
            return 0.5;
        }
        var naturalWidth = Number(imageElement.naturalWidth || imageElement.width || 0);
        var availableWidth = Math.max(1, Number(content.clientWidth) || 0);
        if (!naturalWidth) {
            return 0.5;
        }
        return Math.max(0.05, Math.min(0.1, availableWidth / naturalWidth));
    }

    function getUiPreviewModalZoomKind(content) {
        if (!content) {
            return "text";
        }
        if (content.querySelector(".handrive-media-image-wrap")) {
            return "image";
        }
        if (
            content.classList.contains("portfolio-write-preview-host") ||
            content.classList.contains("handrive-html") ||
            content.querySelector("iframe")
        ) {
            return "frame";
        }
        return "text";
    }

    function clearUiPreviewModalImageZoom(content) {
        if (!content) {
            return;
        }
        var imageWrap = content.querySelector(".handrive-media-image-wrap");
        if (imageWrap) {
            imageWrap.style.removeProperty("transform");
        }
    }

    function getUiPreviewModalFrames(content) {
        return content ? Array.from(content.querySelectorAll("iframe")) : [];
    }

    var uiPreviewModalZoomControllers = [];
    var uiPreviewModalFrameMessageBound = false;

    function bindUiPreviewModalFrameSurface(frame, controller) {
        if (!frame || !controller) {
            return;
        }
        var frameDocument = null;
        try {
            frameDocument = frame.contentDocument || (frame.contentWindow ? frame.contentWindow.document : null);
        } catch (error) {
            frameDocument = null;
        }
        var surface = frameDocument ? (frameDocument.documentElement || frameDocument.body) : null;
        if (!surface || surface._uiPreviewModalZoomGestureBound) {
            return;
        }
        surface._uiPreviewModalZoomGestureBound = true;
        bind(surface, {
            min: controller.getMin,
            max: controller.getMax,
            wheelStep: controller.getWheelStep,
            getValue: controller.getValue,
            setValue: controller.setValue,
        });
    }

    function applyUiPreviewModalFrameZoom(frame, zoomValue) {
        if (!frame) {
            return;
        }
        var scale = Math.max(0.25, Math.min(4, Number(zoomValue) || 1));
        frame.style.setProperty("--ui-preview-modal-frame-zoom", String(scale));
        try {
            if (frame.contentWindow && typeof frame.contentWindow.postMessage === "function") {
                frame.contentWindow.postMessage({
                    type: "handrive-preview-frame-zoom-apply",
                    zoom: scale,
                }, "*");
            }
        } catch (error) {}
        var appliedInsideFrame = false;
        try {
            var frameDocument = frame.contentDocument || (frame.contentWindow ? frame.contentWindow.document : null);
            if (frameDocument && frameDocument.documentElement) {
                frameDocument.documentElement.style.zoom = String(scale);
                frameDocument.documentElement.style.setProperty("--ui-preview-modal-frame-zoom", String(scale));
                if (frameDocument.body) {
                    frameDocument.body.style.setProperty("--ui-preview-modal-frame-zoom", String(scale));
                }
                appliedInsideFrame = true;
            }
        } catch (error) {
            appliedInsideFrame = false;
        }
        if (appliedInsideFrame) {
            frame.style.removeProperty("transform");
            frame.style.removeProperty("transform-origin");
            return;
        }
        frame.style.removeProperty("transform");
        frame.style.removeProperty("transform-origin");
    }

    function bindUiPreviewModalFrameLoadHandlers(content, controller) {
        getUiPreviewModalFrames(content).forEach(function (frame) {
            if (frame._uiPreviewModalZoomLoadBound) {
                bindUiPreviewModalFrameSurface(frame, controller);
                return;
            }
            frame._uiPreviewModalZoomLoadBound = true;
            frame.addEventListener("load", function () {
                controller.apply();
                bindUiPreviewModalFrameSurface(frame, controller);
            });
            bindUiPreviewModalFrameSurface(frame, controller);
        });
    }

    function bindUiPreviewModalZoom(modal) {
        if (!modal || modal._uiPreviewModalZoomController) {
            return modal ? modal._uiPreviewModalZoomController || null : null;
        }
        var body = getUiPreviewModalBody(modal);
        if (!body) {
            return null;
        }
        var state = {
            textFontSize: 16,
            imageZoom: 1,
            frameZoom: 1,
            frameGestureStartZoom: 1,
        };

        var controller = {
            getContent: function () {
                return getUiPreviewModalContent(modal);
            },
            getKind: function () {
                return getUiPreviewModalZoomKind(controller.getContent());
            },
            getMin: function () {
                var content = controller.getContent();
                var kind = getUiPreviewModalZoomKind(content);
                if (kind === "text") {
                    return 8;
                }
                if (kind === "image") {
                    return getUiPreviewModalImageMinZoom(content);
                }
                return 0.25;
            },
            getMax: function () {
                return controller.getKind() === "text" ? 40 : 4;
            },
            getWheelStep: function () {
                return controller.getKind() === "text" ? 2 : 0.15;
            },
            getValue: function () {
                var kind = controller.getKind();
                if (kind === "text") {
                    return state.textFontSize;
                }
                if (kind === "image") {
                    return state.imageZoom;
                }
                return state.frameZoom;
            },
            setValue: function (value) {
                var kind = controller.getKind();
                if (kind === "text") {
                    state.textFontSize = Math.max(8, Math.min(40, Number(value) || 16));
                } else if (kind === "image") {
                    state.imageZoom = Math.max(controller.getMin(), Math.min(4, Number(value) || 1));
                } else {
                    state.frameZoom = Math.max(0.25, Math.min(4, Number(value) || 1));
                }
                controller.apply();
            },
            reset: function () {
                state.textFontSize = 16;
                state.imageZoom = 1;
                state.frameZoom = 1;
                state.frameGestureStartZoom = 1;
                controller.apply();
            },
            matchesFrameSource: function (source) {
                return getUiPreviewModalFrames(controller.getContent()).some(function (frame) {
                    return frame && frame.contentWindow === source;
                });
            },
            handleFrameGesture: function (data) {
                if (controller.getKind() !== "frame") {
                    return;
                }
                var inputType = String(data && data.inputType || "");
                if (inputType === "pinch-start" || inputType === "gesture-start") {
                    state.frameGestureStartZoom = state.frameZoom;
                    return;
                }
                if (inputType === "pinch" || inputType === "gesture") {
                    controller.setValue(state.frameGestureStartZoom * (Number(data && data.ratio) || 1));
                    return;
                }
                var delta = Number(data && data.deltaY) || Number(data && data.deltaX) || 0;
                if (data && Number(data.deltaMode) === 1) {
                    delta *= 16;
                } else if (data && Number(data.deltaMode) === 2) {
                    delta *= window.innerHeight || 800;
                }
                if (Math.abs(delta) < 0.01) {
                    return;
                }
                controller.setValue(state.frameZoom + ((delta < 0 ? 1 : -1) * 0.15));
            },
            apply: function () {
                var content = controller.getContent();
                if (!content) {
                    return;
                }
                var kind = getUiPreviewModalZoomKind(content);
                content.style.setProperty("--ui-preview-modal-frame-zoom", String(state.frameZoom));
                if (kind === "text") {
                    content.style.setProperty("--handrive-text-font-size", state.textFontSize + "px");
                    clearUiPreviewModalImageZoom(content);
                } else if (kind === "image") {
                    content.style.removeProperty("--handrive-text-font-size");
                    var imageWrap = content.querySelector(".handrive-media-image-wrap");
                    if (imageWrap) {
                        imageWrap.style.transform = "scale(" + String(state.imageZoom) + ")";
                    }
                    content.scrollLeft = 0;
                    content.scrollTop = 0;
                } else {
                    content.style.removeProperty("--handrive-text-font-size");
                    clearUiPreviewModalImageZoom(content);
                    getUiPreviewModalFrames(content).forEach(function (frame) {
                        applyUiPreviewModalFrameZoom(frame, state.frameZoom);
                    });
                }
                bindUiPreviewModalFrameLoadHandlers(content, controller);
            },
        };

        bind(body, {
            min: controller.getMin,
            max: controller.getMax,
            wheelStep: controller.getWheelStep,
            getValue: controller.getValue,
            setValue: controller.setValue,
        });

        var content = controller.getContent();
        if (content && typeof MutationObserver === "function") {
            var contentObserver = new MutationObserver(function (mutations) {
                var shouldReset = mutations.some(function (mutation) {
                    return mutation.type === "attributes" && mutation.attributeName === "class";
                });
                if (shouldReset) {
                    controller.reset();
                    return;
                }
                controller.apply();
            });
            contentObserver.observe(content, {
                attributes: true,
                attributeFilter: ["class"],
                childList: true,
                subtree: true,
            });
        }

        if (typeof MutationObserver === "function") {
            var modalObserver = new MutationObserver(function (mutations) {
                var opened = mutations.some(function (mutation) {
                    return mutation.type === "attributes" && mutation.attributeName === "hidden" && !modal.hidden;
                });
                if (opened) {
                    controller.reset();
                }
            });
            modalObserver.observe(modal, { attributes: true, attributeFilter: ["hidden"] });
        }

        controller.apply();
        modal._uiPreviewModalZoomController = controller;
        if (uiPreviewModalZoomControllers.indexOf(controller) === -1) {
            uiPreviewModalZoomControllers.push(controller);
        }
        if (!uiPreviewModalFrameMessageBound) {
            uiPreviewModalFrameMessageBound = true;
            window.addEventListener("message", function (event) {
                var data = event && event.data && typeof event.data === "object" ? event.data : null;
                if (!data || data.type !== "handrive-preview-frame-zoom-gesture") {
                    return;
                }
                var controllerForFrame = uiPreviewModalZoomControllers.find(function (candidate) {
                    return candidate && candidate.matchesFrameSource(event.source);
                });
                if (controllerForFrame) {
                    controllerForFrame.handleFrameGesture(data);
                }
            });
        }
        return controller;
    }

    function initializeUiPreviewModalZoom() {
        var modal = document.getElementById("ui-preview-modal");
        if (modal) {
            bindUiPreviewModalZoom(modal);
        }
    }

    window.HanplanetZoomGesture = {
        bind: bind,
    };
    window.HanplanetPreviewModalZoom = {
        bind: bindUiPreviewModalZoom,
        initialize: initializeUiPreviewModalZoom,
    };
}());
