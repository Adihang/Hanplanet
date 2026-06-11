(function () {
    "use strict";

    var root = document.querySelector("[data-network-environment]");
    if (!root) return;

    var environmentUrl = root.dataset.environmentUrl || "";
    var reverseGeocodeUrl = root.dataset.reverseGeocodeUrl || "";
    var mlabDownloadWorkerUrl = root.dataset.mlabDownloadWorkerUrl || "";
    var mlabUploadWorkerUrl = root.dataset.mlabUploadWorkerUrl || "";
    var refreshButton = document.querySelector("[data-network-refresh]");
    var mlabButton = document.querySelector("[data-network-mlab-test]");
    var summaryGpsButton = document.querySelector("[data-network-summary-gps]");
    var summarySpeedButton = document.querySelector("[data-network-summary-speed]");
    var gpsButton = document.querySelector("[data-network-gps]");
    var webrtcButton = document.querySelector("[data-network-webrtc]");
    var speedStatus = document.querySelector("[data-network-speed-status]");
    var webrtcStatus = document.querySelector("[data-network-webrtc-status]");
    var environmentLocalIp = "";
    var environmentLocalIpKind = "";

    function isEnglishUi() {
        return String(document.documentElement.lang || "").toLowerCase().indexOf("en") === 0;
    }

    function text(en, ko) {
        return isEnglishUi() ? en : ko;
    }

    function dash(value) {
        if (value === null || value === undefined || value === "") return "-";
        if (Array.isArray(value)) return value.length ? value.join(", ") : "-";
        if (typeof value === "boolean") return value ? text("Yes", "예") : text("No", "아니오");
        return String(value);
    }

    function setValue(key, value) {
        var target = document.querySelector('[data-network-value="' + key + '"]');
        if (target) target.textContent = dash(value);
    }

    function setStatus(element, message, isError) {
        if (!element) return;
        element.textContent = message || "";
        element.classList.toggle("is-error", Boolean(isError));
    }

    function isMlabClientReady() {
        return Boolean(window.ndt7 && typeof window.ndt7.test === "function");
    }

    function updateMlabClientAvailability() {
        var ready = isMlabClientReady();
        root.dataset.mlabClientReady = ready ? "true" : "false";
        if (mlabButton) {
            mlabButton.disabled = !ready;
            mlabButton.title = ready ? "" : text("M-Lab NDT7 client unavailable", "M-Lab NDT7 클라이언트를 사용할 수 없습니다.");
        }
        if (summarySpeedButton) {
            summarySpeedButton.disabled = !ready;
            summarySpeedButton.title = ready ? text("Measure network speed", "네트워크 속도 측정") : text("M-Lab NDT7 client unavailable", "M-Lab NDT7 클라이언트를 사용할 수 없습니다.");
        }
    }

    function formatDuration(ms) {
        var value = Number(ms || 0);
        if (!Number.isFinite(value) || value < 0) return "-";
        if (value < 1000) return Math.round(value) + " ms";
        return (value / 1000).toFixed(2) + " s";
    }

    function formatMbpsNumber(value) {
        var mbps = Number(value);
        if (!Number.isFinite(mbps) || mbps < 0) return "-";
        return mbps.toFixed(mbps >= 100 ? 1 : 2) + " Mbps";
    }

    function appendInfoRow(list, label, value, options) {
        var dt = document.createElement("dt");
        var dd = document.createElement("dd");
        dt.textContent = label;
        if (options && options.href && value) {
            var link = document.createElement("a");
            link.className = "network-location-map";
            link.href = options.href;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.textContent = dash(value);
            dd.appendChild(link);
        } else if (options && options.code) {
            var code = document.createElement("code");
            code.textContent = dash(value);
            dd.appendChild(code);
        } else {
            dd.textContent = dash(value);
        }
        list.appendChild(dt);
        list.appendChild(dd);
    }

    function renderList(name, rows) {
        var list = document.querySelector('[data-network-list="' + name + '"]');
        if (!list) return;
        list.innerHTML = "";
        if (!rows || !rows.length) {
            appendInfoRow(list, text("Status", "상태"), "-", null);
            return;
        }
        rows.forEach(function (row) {
            appendInfoRow(list, row.label, row.value, row);
        });
    }

    function classifyAddress(address) {
        var value = String(address || "").trim().replace(/^\[/, "").replace(/\]$/, "");
        if (!value) return "";
        if (/\.local$/i.test(value)) return "mDNS";
        if (/^127\./.test(value) || value === "::1") return "loopback";
        if (/^10\./.test(value)) return "private";
        if (/^192\.168\./.test(value)) return "private";
        if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(value)) return "private";
        if (/^169\.254\./.test(value)) return "link-local";
        if (/^fe80:/i.test(value)) return "link-local";
        if (/^f[cd][0-9a-f]*:/i.test(value)) return "private";
        if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value) || /^[0-9a-f:]+$/i.test(value)) return "public/reserved";
        return "hostname";
    }

    function collectBrowserRows() {
        var connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
        var rows = [
            { label: text("Online", "온라인"), value: navigator.onLine },
            { label: text("Secure context", "보안 컨텍스트"), value: window.isSecureContext },
            { label: text("Current origin", "현재 Origin"), value: window.location.origin, code: true },
            { label: text("Protocol", "프로토콜"), value: window.location.protocol },
            { label: text("Host", "호스트"), value: window.location.host, code: true },
        ];
        if (connection) {
            rows.push(
                { label: text("Effective type", "체감 연결 타입"), value: connection.effectiveType || "-" },
                { label: text("Reported downlink", "브라우저 추정 downlink"), value: connection.downlink ? connection.downlink + " Mbps" : "-" },
                { label: text("Reported RTT", "브라우저 추정 RTT"), value: connection.rtt ? connection.rtt + " ms" : "-" },
                { label: text("Save data", "데이터 절약 모드"), value: Boolean(connection.saveData) },
                { label: text("Connection type", "연결 종류"), value: connection.type || "-" }
            );
        } else {
            rows.push({ label: text("Network Information API", "Network Information API"), value: text("Unavailable", "사용 불가") });
        }
        rows.push(
            { label: text("Service worker controller", "서비스 워커 제어"), value: Boolean(navigator.serviceWorker && navigator.serviceWorker.controller) },
            { label: text("Cookies enabled", "쿠키 사용 가능"), value: navigator.cookieEnabled },
            { label: text("Do Not Track", "추적 거부"), value: navigator.doNotTrack || window.doNotTrack || "-" }
        );
        return rows;
    }

    function collectDeviceRows() {
        var timezone = "-";
        try {
            timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "-";
        } catch (error) {
            timezone = "-";
        }
        return [
            { label: text("User agent", "User agent"), value: navigator.userAgent || "-", code: true },
            { label: text("Platform", "플랫폼"), value: navigator.platform || "-" },
            { label: text("Vendor", "브라우저 벤더"), value: navigator.vendor || "-" },
            { label: text("Language", "언어"), value: navigator.language || "-" },
            { label: text("Languages", "언어 목록"), value: navigator.languages ? Array.prototype.slice.call(navigator.languages) : "-" },
            { label: text("Timezone", "시간대"), value: timezone },
            { label: text("Timezone offset", "UTC 오프셋"), value: new Date().getTimezoneOffset() + " min" },
            { label: text("Viewport", "뷰포트"), value: window.innerWidth + " x " + window.innerHeight },
            { label: text("Screen", "화면"), value: screen.width + " x " + screen.height + " @ " + window.devicePixelRatio + "x" },
            { label: text("Color scheme", "색상 모드"), value: window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light" },
            { label: text("CPU threads", "CPU 스레드"), value: navigator.hardwareConcurrency || "-" },
            { label: text("Device memory", "기기 메모리"), value: navigator.deviceMemory ? navigator.deviceMemory + " GB" : "-" },
        ];
    }

    function refreshBrowserLists() {
        renderList("browser", collectBrowserRows());
        renderList("device", collectDeviceRows());
    }

    function renderEnvironment(payload, latencyMs) {
        var request = payload.request || {};
        var ipCandidates = payload.ip_candidates || {};
        var cloudflare = payload.cloudflare || {};
        var server = payload.server || {};
        var headers = request.headers || {};
        environmentLocalIp = payload.local_ip || "";
        environmentLocalIpKind = payload.local_ip_kind || "";
        var localIpSources = payload.local_ip_sources || [];
        var localIpInterfaces = payload.local_ip_interfaces || [];
        var localIpGateway = payload.local_ip_gateway || "";
        var localIpMetaParts = [environmentLocalIpKind]
            .concat(localIpSources)
            .concat(localIpInterfaces)
            .filter(Boolean);
        if (localIpGateway) localIpMetaParts.push("gw " + localIpGateway);
        var requestRows = [
            { label: text("Observed external IP", "서버가 본 외부 IP"), value: payload.observed_ip || "-", code: true },
            { label: text("Observed IP kind", "외부 IP 분류"), value: payload.observed_ip_kind || "-" },
            { label: text("Local IP", "로컬 IP"), value: environmentLocalIp || "-", code: true },
            { label: text("Local IP source", "로컬 IP 출처"), value: localIpMetaParts.join(" · ") || "-" },
            { label: text("Forwarded chain", "Forwarded 체인"), value: ipCandidates.x_forwarded_for || "-" },
            { label: "CF-Connecting-IP", value: ipCandidates.cf_connecting_ip || "-", code: true },
            { label: "X-Real-IP", value: ipCandidates.x_real_ip || "-", code: true },
            { label: "REMOTE_ADDR", value: ipCandidates.remote_addr || request.remote_addr || "-", code: true },
            { label: text("Scheme", "스킴"), value: request.scheme || "-" },
            { label: text("HTTPS", "HTTPS"), value: Boolean(request.is_secure) },
            { label: text("Host", "호스트"), value: request.host || "-", code: true },
            { label: text("Path", "경로"), value: request.path || "-", code: true },
            { label: text("Server port", "서버 포트"), value: request.server_port || "-" },
            { label: "Cloudflare country", value: cloudflare.country || "-" },
            { label: "Cloudflare Ray", value: cloudflare.colo_ray || "-" },
        ];

        Object.keys(headers).sort().forEach(function (key) {
            requestRows.push({ label: key, value: headers[key], code: true });
        });

        var localAddresses = Array.isArray(server.local_addresses) ? server.local_addresses : [];
        var serverRows = [
            { label: text("Server time", "서버 시간"), value: server.time || "-" },
            { label: text("Server timezone", "서버 시간대"), value: server.timezone || "-" },
            { label: text("Server hostname", "서버 호스트명"), value: server.hostname || text("Hidden", "숨김"), code: true },
            { label: text("Server local addresses visible", "서버 내부 주소 표시"), value: Boolean(server.local_addresses_visible) },
        ];

        if (localAddresses.length) {
            localAddresses.forEach(function (item, index) {
                var itemMetaParts = [item.kind]
                    .concat(item.sources || [])
                    .concat(item.interfaces || [])
                    .filter(Boolean);
                if (item.gateway) itemMetaParts.push("gw " + item.gateway);
                serverRows.push({
                    label: text("Server local IP ", "서버 로컬 IP ") + (index + 1),
                    value: item.address + " (" + itemMetaParts.join(", ") + ")",
                    code: true,
                });
            });
        } else {
            serverRows.push({
                label: text("Server local IP", "서버 로컬 IP"),
                value: server.local_addresses_visible ? "-" : text("Hidden outside DEBUG or superuser", "DEBUG 또는 superuser가 아니면 숨김"),
            });
        }

        setValue("summary-public-ip", payload.observed_ip || "-");
        setValue("summary-public-ip-kind", payload.observed_ip_kind || "-");
        setValue("summary-local-ip", environmentLocalIp || "-");
        setValue(
            "summary-local-ip-kind",
            environmentLocalIp ? localIpMetaParts.join(" · ") : text("Not found", "찾을 수 없음")
        );
        setValue("api-latency", Math.round(latencyMs) + " ms");
        setValue("api-latency-meta", text("Environment API", "환경 API"));
        renderList("request", requestRows);
        renderList("server", serverRows);
    }

    async function refreshEnvironment() {
        if (!environmentUrl) return;
        if (refreshButton) refreshButton.disabled = true;
        var start = performance.now();
        try {
            var separator = environmentUrl.indexOf("?") === -1 ? "?" : "&";
            var response = await fetch(environmentUrl + separator + "t=" + Date.now(), {
                credentials: "same-origin",
                headers: { Accept: "application/json" },
            });
            var payload = await response.json();
            if (!response.ok || !payload || payload.ok === false) {
                throw new Error(text("Could not read request info.", "요청 정보를 읽지 못했습니다."));
            }
            renderEnvironment(payload, performance.now() - start);
        } catch (error) {
            setValue("api-latency", "-");
            setValue("api-latency-meta", error && error.message ? error.message : text("Failed", "실패"));
        } finally {
            if (refreshButton) refreshButton.disabled = false;
        }
    }

    function setSpeedControlsDisabled(disabled) {
        if (mlabButton) mlabButton.disabled = disabled;
        if (summarySpeedButton) summarySpeedButton.disabled = disabled;
    }

    function formatMlabServerLocation(server) {
        if (!server) return "-";
        var location = server.location || {};
        var locationParts = [location.city, location.country].filter(Boolean);
        return locationParts.join(", ") || "-";
    }

    function formatMlabMegabytesPerSecond(mbps) {
        var value = Number(mbps) / 8;
        if (!Number.isFinite(value) || value < 0) return "-";
        return value.toFixed(value >= 100 ? 1 : 2) + " MB/s";
    }

    function formatMlabSpeedMeta(mbps, location) {
        var speed = formatMlabMegabytesPerSecond(mbps);
        var place = location && location !== "-" ? location : "M-Lab NDT7";
        return speed + " · " + place;
    }

    function extractMeanClientMbps(measurement) {
        var value = Number((measurement || {}).MeanClientMbps);
        return Number.isFinite(value) && value >= 0 ? value : null;
    }

    function extractServerUploadMbps(measurement) {
        var tcpInfo = (measurement || {}).TCPInfo || {};
        var bytesReceived = Number(tcpInfo.BytesReceived);
        var elapsedTime = Number(tcpInfo.ElapsedTime);
        if (!Number.isFinite(bytesReceived) || !Number.isFinite(elapsedTime) || elapsedTime <= 0) return null;
        return (bytesReceived * 8) / elapsedTime;
    }

    function updateMlabDownload(mbps, location) {
        var speed = formatMbpsNumber(mbps);
        setValue("mlab-download-speed", speed);
        setValue("mlab-download-meta", formatMlabSpeedMeta(mbps, location));
        setValue("summary-download-speed", speed);
        setValue("summary-speed-meta", "M-Lab NDT7");
    }

    function updateMlabUpload(mbps, location) {
        var speed = formatMbpsNumber(mbps);
        setValue("mlab-upload-speed", speed);
        setValue("mlab-upload-meta", formatMlabSpeedMeta(mbps, location));
        setValue("summary-upload-speed", speed);
        setValue("summary-speed-meta", "M-Lab NDT7");
    }

    function formatLocationAccuracy(coords) {
        return typeof coords.accuracy === "number" ? "± " + Math.round(coords.accuracy) + " m" : "-";
    }

    async function readLocationPlace(latitude, longitude) {
        if (!reverseGeocodeUrl) {
            setValue("summary-location-place", "-");
            return;
        }
        setValue("summary-location-place", text("Resolving place", "위치 확인 중"));
        try {
            var separator = reverseGeocodeUrl.indexOf("?") === -1 ? "?" : "&";
            var response = await fetch(
                reverseGeocodeUrl
                    + separator
                    + "lat=" + encodeURIComponent(latitude.toFixed(7))
                    + "&lon=" + encodeURIComponent(longitude.toFixed(7))
                    + "&t=" + Date.now(),
                {
                    credentials: "same-origin",
                    headers: { Accept: "application/json" },
                }
            );
            var payload = await response.json().catch(function () {
                return null;
            });
            if (!response.ok || !payload || payload.ok === false || !payload.place) {
                throw new Error(text("Could not resolve place.", "위치를 확인하지 못했습니다."));
            }
            setValue("summary-location-place", payload.place);
        } catch (error) {
            setValue("summary-location-place", "-");
        }
    }

    async function measureMlabNdt7() {
        if (!mlabButton) return;
        if (!isMlabClientReady()) {
            updateMlabClientAvailability();
            setStatus(speedStatus, text("M-Lab NDT7 client is unavailable.", "M-Lab NDT7 클라이언트를 불러오지 못했습니다."), true);
            return;
        }
        if (!mlabDownloadWorkerUrl || !mlabUploadWorkerUrl) {
            setStatus(speedStatus, text("M-Lab worker URL is missing.", "M-Lab worker URL이 없습니다."), true);
            return;
        }

        var mlabErrorMessage = "";
        var mlabServerLocation = "-";
        var startedAt = performance.now();
        setSpeedControlsDisabled(true);
        setValue("mlab-download-speed", text("Running", "측정 중"));
        setValue("mlab-download-meta", "M-Lab NDT7");
        setValue("mlab-upload-speed", text("Waiting", "대기 중"));
        setValue("mlab-upload-meta", "M-Lab NDT7");
        setValue("summary-download-speed", text("Running", "측정 중"));
        setValue("summary-upload-speed", text("Waiting", "대기 중"));
        setValue("summary-speed-meta", "M-Lab NDT7");
        setStatus(speedStatus, text("Finding an M-Lab NDT7 server...", "M-Lab NDT7 서버를 찾는 중..."), false);

        try {
            var exitCode = await window.ndt7.test(
                {
                    userAcceptedDataPolicy: true,
                    downloadworkerfile: mlabDownloadWorkerUrl,
                    uploadworkerfile: mlabUploadWorkerUrl,
                    metadata: {
                        client_name: "hanplanet-network-info",
                        client_version: "1.0.0",
                    },
                },
                {
                    serverDiscovery: function () {
                        setStatus(speedStatus, text("Finding an M-Lab NDT7 server...", "M-Lab NDT7 서버를 찾는 중..."), false);
                    },
                    serverChosen: function (server) {
                        mlabServerLocation = formatMlabServerLocation(server);
                        setValue("mlab-download-meta", mlabServerLocation);
                        setValue("mlab-upload-meta", mlabServerLocation);
                        setStatus(speedStatus, text("M-Lab server selected. Measuring download...", "M-Lab 서버 선택 완료. 다운로드 측정 중..."), false);
                    },
                    downloadStart: function () {
                        setStatus(speedStatus, text("Measuring M-Lab download...", "M-Lab 다운로드 측정 중..."), false);
                    },
                    downloadMeasurement: function (data) {
                        if (!data || data.Source !== "client") return;
                        var mbps = extractMeanClientMbps(data.Data);
                        if (mbps !== null) updateMlabDownload(mbps, mlabServerLocation);
                    },
                    downloadComplete: function (data) {
                        var mbps = extractMeanClientMbps((data || {}).LastClientMeasurement);
                        if (mbps !== null) updateMlabDownload(mbps, mlabServerLocation);
                        setValue("mlab-upload-speed", text("Running", "측정 중"));
                        setValue("summary-upload-speed", text("Running", "측정 중"));
                        setStatus(speedStatus, text("Download complete. Measuring M-Lab upload...", "다운로드 완료. M-Lab 업로드 측정 중..."), false);
                    },
                    uploadStart: function () {
                        setStatus(speedStatus, text("Measuring M-Lab upload...", "M-Lab 업로드 측정 중..."), false);
                    },
                    uploadMeasurement: function (data) {
                        if (!data || !data.Data) return;
                        var mbps = data.Source === "server" ? extractServerUploadMbps(data.Data) : extractMeanClientMbps(data.Data);
                        if (mbps !== null) updateMlabUpload(mbps, mlabServerLocation);
                    },
                    uploadComplete: function (data) {
                        var serverMbps = extractServerUploadMbps((data || {}).LastServerMeasurement);
                        var clientMbps = extractMeanClientMbps((data || {}).LastClientMeasurement);
                        var mbps = serverMbps !== null ? serverMbps : clientMbps;
                        if (mbps !== null) updateMlabUpload(mbps, mlabServerLocation);
                    },
                    error: function (error) {
                        mlabErrorMessage = error && error.message ? error.message : String(error || "");
                        setStatus(speedStatus, mlabErrorMessage || text("M-Lab NDT7 failed.", "M-Lab NDT7 측정에 실패했습니다."), true);
                    },
                }
            );
            if (exitCode) {
                throw new Error(mlabErrorMessage || text("M-Lab NDT7 failed.", "M-Lab NDT7 측정에 실패했습니다."));
            }
            setStatus(
                speedStatus,
                text("M-Lab NDT7 measurement complete.", "M-Lab NDT7 측정 완료.") + " · " + formatDuration(performance.now() - startedAt),
                false
            );
        } catch (error) {
            setStatus(speedStatus, error && error.message ? error.message : text("M-Lab NDT7 failed.", "M-Lab NDT7 측정에 실패했습니다."), true);
        } finally {
            setSpeedControlsDisabled(false);
        }
    }

    function renderLocationRows(position) {
        var coords = position.coords || {};
        var latitude = typeof coords.latitude === "number" ? coords.latitude : null;
        var longitude = typeof coords.longitude === "number" ? coords.longitude : null;
        var mapHref = latitude !== null && longitude !== null
            ? "https://www.google.com/maps?q=" + encodeURIComponent(latitude + "," + longitude)
            : "";
        var rows = [
            { label: text("Latitude", "위도"), value: latitude !== null ? latitude.toFixed(7) : "-" },
            { label: text("Longitude", "경도"), value: longitude !== null ? longitude.toFixed(7) : "-" },
            { label: text("Accuracy", "정확도"), value: typeof coords.accuracy === "number" ? Math.round(coords.accuracy) + " m" : "-" },
            { label: text("Altitude", "고도"), value: typeof coords.altitude === "number" ? coords.altitude.toFixed(1) + " m" : "-" },
            { label: text("Altitude accuracy", "고도 정확도"), value: typeof coords.altitudeAccuracy === "number" ? Math.round(coords.altitudeAccuracy) + " m" : "-" },
            { label: text("Speed", "이동 속도"), value: typeof coords.speed === "number" ? coords.speed.toFixed(2) + " m/s" : "-" },
            { label: text("Heading", "방향"), value: typeof coords.heading === "number" ? coords.heading.toFixed(1) + "°" : "-" },
            { label: text("Timestamp", "측정 시각"), value: position.timestamp ? new Date(position.timestamp).toLocaleString() : "-" },
            { label: text("Map", "지도"), value: mapHref ? text("Open map", "지도 열기") : "-", href: mapHref },
        ];
        renderList("location", rows);
        if (latitude !== null && longitude !== null) {
            setValue("summary-location", latitude.toFixed(5) + ", " + longitude.toFixed(5));
            setValue("summary-location-accuracy", formatLocationAccuracy(coords));
            readLocationPlace(latitude, longitude);
        }
    }

    function readGeolocation() {
        if (!navigator.geolocation) {
            renderList("location", [{ label: text("Status", "상태"), value: text("Geolocation is unavailable.", "Geolocation을 사용할 수 없습니다.") }]);
            setValue("summary-location-place", "-");
            setValue("summary-location-accuracy", text("Unavailable", "사용 불가"));
            return;
        }
        if (gpsButton) gpsButton.disabled = true;
        if (summaryGpsButton) summaryGpsButton.disabled = true;
        setValue("summary-location-place", "-");
        setValue("summary-location-accuracy", text("Waiting for permission", "권한 대기"));
        renderList("location", [{ label: text("Status", "상태"), value: text("Waiting for permission...", "권한 응답을 기다리는 중...") }]);
        navigator.geolocation.getCurrentPosition(
            function (position) {
                renderLocationRows(position);
                if (gpsButton) gpsButton.disabled = false;
                if (summaryGpsButton) summaryGpsButton.disabled = false;
            },
            function (error) {
                var message = error && error.message ? error.message : text("Could not read GPS.", "GPS를 읽지 못했습니다.");
                renderList("location", [{ label: text("Status", "상태"), value: message }]);
                setValue("summary-location", "-");
                setValue("summary-location-place", "-");
                setValue("summary-location-accuracy", message);
                if (gpsButton) gpsButton.disabled = false;
                if (summaryGpsButton) summaryGpsButton.disabled = false;
            },
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
        );
    }

    function parseIceCandidate(rawCandidate) {
        var line = String(rawCandidate || "").trim().replace(/^a=/, "");
        if (!line) return null;
        var parts = line.split(/\s+/);
        if (!/^candidate:/i.test(parts[0] || "")) return null;
        var typIndex = parts.indexOf("typ");
        var address = parts[4] || "";
        var port = parts[5] || "";
        var protocol = (parts[2] || "").toUpperCase();
        var candidateType = typIndex >= 0 ? parts[typIndex + 1] || "" : "";
        if (!address) return null;
        return {
            address: address,
            port: port,
            protocol: protocol,
            candidateType: candidateType,
            kind: classifyAddress(address),
            raw: line,
        };
    }

    function renderWebrtcCandidates(candidates) {
        var tbody = document.querySelector('[data-network-table="webrtc"]');
        if (!tbody) return;
        tbody.innerHTML = "";
        if (!candidates.length) {
            var emptyRow = document.createElement("tr");
            var emptyCell = document.createElement("td");
            emptyCell.colSpan = 4;
            emptyCell.setAttribute("data-network-empty-cell", "");
            emptyCell.textContent = text("No candidate was exposed. Browser mDNS/privacy protection may be hiding local IPs.", "노출된 후보가 없습니다. 브라우저 mDNS/개인정보 보호가 내부 IP를 숨길 수 있습니다.");
            emptyRow.appendChild(emptyCell);
            tbody.appendChild(emptyRow);
            if (!environmentLocalIp) {
                setValue("summary-local-ip", "-");
                setValue("summary-local-ip-kind", text("Not exposed", "노출 안 됨"));
            }
            return;
        }
        candidates.forEach(function (candidate) {
            var row = document.createElement("tr");
            [candidate.address + (candidate.port ? ":" + candidate.port : ""), candidate.kind, candidate.protocol, candidate.candidateType || "-"].forEach(function (value, index) {
                var cell = document.createElement("td");
                if (index === 0) {
                    var code = document.createElement("code");
                    code.textContent = value;
                    cell.appendChild(code);
                } else if (index === 1) {
                    var badge = document.createElement("span");
                    badge.className = "network-badge";
                    badge.textContent = value || "-";
                    cell.appendChild(badge);
                } else {
                    cell.textContent = value || "-";
                }
                row.appendChild(cell);
            });
            tbody.appendChild(row);
        });
        var preferred = candidates.find(function (candidate) {
            return candidate.kind === "private";
        }) || candidates.find(function (candidate) {
            return candidate.kind === "mDNS";
        }) || candidates[0];
        if (!environmentLocalIp) {
            setValue("summary-local-ip", preferred.address);
            setValue("summary-local-ip-kind", preferred.kind);
        }
    }

    async function collectWebrtcCandidates() {
        var RTCPeerConnectionCtor = window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection;
        if (!RTCPeerConnectionCtor) {
            renderWebrtcCandidates([]);
            setStatus(webrtcStatus, text("RTCPeerConnection is unavailable.", "RTCPeerConnection을 사용할 수 없습니다."), true);
            return;
        }
        if (webrtcButton) webrtcButton.disabled = true;
        setStatus(webrtcStatus, text("Collecting candidates...", "후보를 수집 중..."), false);
        var candidatesByKey = {};
        var pc = null;

        function addCandidate(raw) {
            var parsed = parseIceCandidate(raw);
            if (!parsed) return;
            var key = [parsed.address, parsed.port, parsed.protocol, parsed.candidateType].join("|");
            candidatesByKey[key] = parsed;
        }

        try {
            pc = new RTCPeerConnectionCtor({ iceServers: [] });
            pc.createDataChannel("network-diagnostic");
            pc.onicecandidate = function (event) {
                if (event && event.candidate) addCandidate(event.candidate.candidate);
            };
            var offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            await new Promise(function (resolve) {
                var done = false;
                var timer = window.setTimeout(function () {
                    if (!done) {
                        done = true;
                        resolve();
                    }
                }, 2600);
                pc.onicegatheringstatechange = function () {
                    if (pc.iceGatheringState === "complete" && !done) {
                        done = true;
                        window.clearTimeout(timer);
                        resolve();
                    }
                };
            });
            var descriptions = [pc.localDescription, pc.currentLocalDescription].filter(Boolean);
            descriptions.forEach(function (description) {
                String(description.sdp || "").split(/\r?\n/).forEach(function (line) {
                    if (/^a=candidate:/i.test(line)) addCandidate(line);
                });
            });
            var candidates = Object.keys(candidatesByKey).map(function (key) {
                return candidatesByKey[key];
            });
            renderWebrtcCandidates(candidates);
            setStatus(webrtcStatus, candidates.length ? text("Candidate collection complete.", "후보 수집 완료.") : text("No local candidate exposed.", "노출된 로컬 후보가 없습니다."), false);
        } catch (error) {
            renderWebrtcCandidates([]);
            setStatus(webrtcStatus, error && error.message ? error.message : text("Candidate collection failed.", "후보 수집에 실패했습니다."), true);
        } finally {
            if (pc) pc.close();
            if (webrtcButton) webrtcButton.disabled = false;
        }
    }

    refreshBrowserLists();
    renderList("location", [{ label: text("Status", "상태"), value: text("Not requested", "요청 전") }]);
    updateMlabClientAvailability();
    refreshEnvironment();

    if (refreshButton) refreshButton.addEventListener("click", refreshEnvironment);
    if (mlabButton) mlabButton.addEventListener("click", measureMlabNdt7);
    if (summaryGpsButton) summaryGpsButton.addEventListener("click", readGeolocation);
    if (summarySpeedButton) summarySpeedButton.addEventListener("click", measureMlabNdt7);
    if (gpsButton) gpsButton.addEventListener("click", readGeolocation);
    if (webrtcButton) webrtcButton.addEventListener("click", collectWebrtcCandidates);
    window.addEventListener("resize", refreshBrowserLists);
    window.addEventListener("online", refreshBrowserLists);
    window.addEventListener("offline", refreshBrowserLists);

    var connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
    if (connection && typeof connection.addEventListener === "function") {
        connection.addEventListener("change", refreshBrowserLists);
    }
})();
