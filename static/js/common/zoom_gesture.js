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

    window.HanplanetZoomGesture = {
        bind: bind,
    };
}());
