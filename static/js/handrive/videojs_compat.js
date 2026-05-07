(function () {
    'use strict';

    if (
        window.videojs
        && window.videojs.obj
        && typeof window.videojs.obj.merge === 'function'
    ) {
        window.videojs.mergeOptions = window.videojs.obj.merge;
    }
}());
