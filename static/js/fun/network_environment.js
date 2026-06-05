(function () {
    "use strict";

    var root = document.querySelector("[data-network-environment]");
    if (!root) return;

    var environmentUrl = root.dataset.environmentUrl || "";
    var downloadUrl = root.dataset.downloadUrl || "";
    var uploadUrl = root.dataset.uploadUrl || "";
    var downloadSize = Number(root.dataset.downloadSize || 8388608);
    var uploadSize = Number(root.dataset.uploadSize || 5242880);
    var refreshButton = document.querySelector("[data-network-refresh]");
    var downloadButton = document.querySelector("[data-network-download-test]");
    var uploadButton = document.querySelector("[data-network-upload-test]");
    var gpsButton = document.querySelector("[data-network-gps]");
    var webrtcButton = document.querySelector("[data-network-webrtc]");
    var speedStatus = document.querySelector("[data-network-speed-status]");
    var webrtcStatus = document.querySelector("[data-network-webrtc-status]");

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

    function getCsrfToken() {
        var meta = document.querySelector('meta[name="csrf-token"]');
        return meta ? meta.getAttribute("content") || "" : "";
    }

    function formatBytes(bytes) {
        var value = Number(bytes || 0);
        if (!Number.isFinite(value) || value <= 0) return "0 B";
        var units = ["B", "KB", "MB", "GB"];
        var index = 0;
        while (value >= 1024 && index < units.length - 1) {
            value /= 1024;
            index += 1;
        }
        return value.toFixed(index === 0 ? 0 : 2) + " " + units[index];
    }

    function formatDuration(ms) {
        var value = Number(ms || 0);
        if (!Number.isFinite(value) || value < 0) return "-";
        if (value < 1000) return Math.round(value) + " ms";
        return (value / 1000).toFixed(2) + " s";
    }

    function formatMbps(bytes, ms) {
        var durationSeconds = Number(ms || 0) / 1000;
        if (!durationSeconds) return "-";
        var mbps = (Number(bytes || 0) * 8) / durationSeconds / 1000000;
        return mbps.toFixed(mbps >= 100 ? 1 : 2) + " Mbps";
    }

    function formatMegabytesPerSecond(bytes, ms) {
        var durationSeconds = Number(ms || 0) / 1000;
        if (!durationSeconds) return "-";
        var value = Number(bytes || 0) / durationSeconds / 1048576;
        return value.toFixed(value >= 100 ? 1 : 2) + " MB/s";
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
        var limits = payload.limits || {};
        var headers = request.headers || {};
        var requestRows = [
            { label: text("Observed external IP", "서버가 본 외부 IP"), value: payload.observed_ip || "-", code: true },
            { label: text("Observed IP kind", "외부 IP 분류"), value: payload.observed_ip_kind || "-" },
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
            { label: text("Download test size", "다운로드 측정 크기"), value: formatBytes(limits.download_default_bytes || downloadSize) },
            { label: text("Upload test size", "업로드 측정 크기"), value: formatBytes(limits.upload_default_bytes || uploadSize) },
            { label: text("Download max", "다운로드 최대 크기"), value: formatBytes(limits.download_max_bytes || 0) },
            { label: text("Upload max", "업로드 최대 크기"), value: formatBytes(limits.upload_max_bytes || 0) },
        ];

        if (localAddresses.length) {
            localAddresses.forEach(function (item, index) {
                serverRows.push({
                    label: text("Server local IP ", "서버 내부 IP ") + (index + 1),
                    value: item.address + " (" + item.kind + ", " + (item.sources || []).join(", ") + ")",
                    code: true,
                });
            });
        } else {
            serverRows.push({
                label: text("Server local IP", "서버 내부 IP"),
                value: server.local_addresses_visible ? "-" : text("Hidden outside DEBUG or superuser", "DEBUG 또는 superuser가 아니면 숨김"),
            });
        }

        setValue("summary-public-ip", payload.observed_ip || "-");
        setValue("summary-public-ip-kind", payload.observed_ip_kind || "-");
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

    async function measureDownload() {
        if (!downloadUrl || !downloadButton) return;
        downloadButton.disabled = true;
        setStatus(speedStatus, text("Measuring download...", "다운로드 측정 중..."), false);
        var bytes = 0;
        var start = performance.now();
        try {
            var separator = downloadUrl.indexOf("?") === -1 ? "?" : "&";
            var response = await fetch(downloadUrl + separator + "size=" + encodeURIComponent(downloadSize) + "&t=" + Date.now(), {
                credentials: "same-origin",
                headers: { Accept: "application/octet-stream" },
            });
            if (!response.ok) throw new Error(text("Download test failed.", "다운로드 측정에 실패했습니다."));
            if (response.body && response.body.getReader) {
                var reader = response.body.getReader();
                while (true) {
                    var result = await reader.read();
                    if (result.done) break;
                    bytes += result.value ? result.value.byteLength : 0;
                }
            } else {
                bytes = (await response.arrayBuffer()).byteLength;
            }
            var elapsed = performance.now() - start;
            var speed = formatMbps(bytes, elapsed);
            var meta = formatMegabytesPerSecond(bytes, elapsed) + " · " + formatBytes(bytes) + " · " + formatDuration(elapsed);
            setValue("download-speed", speed);
            setValue("download-meta", meta);
            setValue("summary-speed", speed);
            setValue("summary-speed-meta", text("Download", "다운로드"));
            setStatus(speedStatus, text("Download measurement complete.", "다운로드 측정 완료."), false);
        } catch (error) {
            setStatus(speedStatus, error && error.message ? error.message : text("Download test failed.", "다운로드 측정에 실패했습니다."), true);
        } finally {
            downloadButton.disabled = false;
        }
    }

    function buildUploadPayload(size) {
        var payload = new Uint8Array(size);
        for (var index = 0; index < payload.length; index += 1) {
            payload[index] = index % 251;
        }
        return payload;
    }

    async function measureUpload() {
        if (!uploadUrl || !uploadButton) return;
        uploadButton.disabled = true;
        setStatus(speedStatus, text("Preparing upload payload...", "업로드 데이터를 준비 중..."), false);
        var payload = buildUploadPayload(uploadSize);
        setStatus(speedStatus, text("Measuring upload...", "업로드 측정 중..."), false);
        var start = performance.now();
        try {
            var response = await fetch(uploadUrl, {
                method: "POST",
                credentials: "same-origin",
                headers: {
                    "Accept": "application/json",
                    "Content-Type": "application/octet-stream",
                    "X-CSRFToken": getCsrfToken(),
                },
                body: payload,
            });
            var data = await response.json().catch(function () {
                return null;
            });
            if (!response.ok || !data || data.ok === false) {
                throw new Error(text("Upload test failed.", "업로드 측정에 실패했습니다."));
            }
            var bytes = Number(data.bytes || payload.byteLength || 0);
            var elapsed = performance.now() - start;
            var speed = formatMbps(bytes, elapsed);
            var meta = formatMegabytesPerSecond(bytes, elapsed) + " · " + formatBytes(bytes) + " · " + formatDuration(elapsed);
            setValue("upload-speed", speed);
            setValue("upload-meta", meta);
            setValue("summary-speed", speed);
            setValue("summary-speed-meta", text("Upload", "업로드"));
            setStatus(speedStatus, text("Upload measurement complete.", "업로드 측정 완료."), false);
        } catch (error) {
            setStatus(speedStatus, error && error.message ? error.message : text("Upload test failed.", "업로드 측정에 실패했습니다."), true);
        } finally {
            uploadButton.disabled = false;
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
            setValue("summary-location-accuracy", typeof coords.accuracy === "number" ? "± " + Math.round(coords.accuracy) + " m" : "-");
        }
    }

    function readGeolocation() {
        if (!navigator.geolocation) {
            renderList("location", [{ label: text("Status", "상태"), value: text("Geolocation is unavailable.", "Geolocation을 사용할 수 없습니다.") }]);
            return;
        }
        if (gpsButton) gpsButton.disabled = true;
        renderList("location", [{ label: text("Status", "상태"), value: text("Waiting for permission...", "권한 응답을 기다리는 중...") }]);
        navigator.geolocation.getCurrentPosition(
            function (position) {
                renderLocationRows(position);
                if (gpsButton) gpsButton.disabled = false;
            },
            function (error) {
                var message = error && error.message ? error.message : text("Could not read GPS.", "GPS를 읽지 못했습니다.");
                renderList("location", [{ label: text("Status", "상태"), value: message }]);
                setValue("summary-location", "-");
                setValue("summary-location-accuracy", message);
                if (gpsButton) gpsButton.disabled = false;
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
            setValue("summary-local-ip", "-");
            setValue("summary-local-ip-kind", text("Not exposed", "노출 안 됨"));
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
        setValue("summary-local-ip", preferred.address);
        setValue("summary-local-ip-kind", preferred.kind);
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
    refreshEnvironment();

    if (refreshButton) refreshButton.addEventListener("click", refreshEnvironment);
    if (downloadButton) downloadButton.addEventListener("click", measureDownload);
    if (uploadButton) uploadButton.addEventListener("click", measureUpload);
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
