(function () {
    "use strict";

    // map_flow_helpers.js — 지도 제작 플로우 (API 호출 + 에디터 이동)

    function openMapCreateModal(options) {
        var settings = options || {};
        var modal = settings.modal;
        var input = settings.input;
        var target = settings.target;
        var entry = settings.entry;
        var syncModalBodyState = settings.syncModalBodyState || function () {};

        if (!modal || !input) {
            return;
        }
        if (target) {
            target.textContent = entry ? entry.name : "";
        }
        input.value = entry ? entry.name.replace(/\.[^.]+$/, "") : "";
        modal.hidden = false;
        syncModalBodyState(modal, true);
        setTimeout(function () {
            input.focus();
            input.select();
        }, 50);
    }

    function closeMapCreateModal(options) {
        var settings = options || {};
        var modal = settings.modal;
        var syncModalBodyState = settings.syncModalBodyState || function () {};
        if (!modal) {
            return;
        }
        modal.hidden = true;
        syncModalBodyState(modal, false);
    }

    function submitMapCreate(options) {
        var settings = options || {};
        var entry = settings.entry;
        var input = settings.input;
        var mapCreateApiUrl = settings.mapCreateApiUrl;
        var mapEditorBaseUrl = settings.mapEditorBaseUrl;
        var requestJson = settings.requestJson;
        var buildPostOptions = settings.buildPostOptions;
        var onClose = settings.onClose || function () {};
        var onError = settings.onError || function () {};

        if (!entry || !input || !mapCreateApiUrl || !requestJson || !buildPostOptions) {
            return;
        }
        var mapName = (input.value || "").trim();
        if (!mapName) {
            input.focus();
            return;
        }

        onClose();
        requestJson(mapCreateApiUrl, buildPostOptions({ image_path: entry.path, map_name: mapName }))
            .then(function (data) {
                if (!data.ok) {
                    onError(data.error || "지도 생성에 실패했습니다.");
                    return;
                }
                var editorUrl = (mapEditorBaseUrl || "/handrive/map-editor/") + (data.map_path || "");
                window.location.href = editorUrl;
            })
            .catch(function (err) {
                onError(err && err.message ? err.message : "지도 생성 중 오류가 발생했습니다.");
            });
    }

    window.HandriveMapFlowHelpers = {
        openMapCreateModal: openMapCreateModal,
        closeMapCreateModal: closeMapCreateModal,
        submitMapCreate: submitMapCreate,
    };
})();
