/*! @name videojs-mobile-ui @version 1.1.1 @license MIT */
(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory(require('video.js')) :
  typeof define === 'function' && define.amd ? define(['video.js'], factory) :
  (global = typeof globalThis !== 'undefined' ? globalThis : global || self, global.videojsMobileUi = factory(global.videojs));
})(this, (function (videojs) { 'use strict';

  function _interopDefaultLegacy (e) { return e && typeof e === 'object' && 'default' in e ? e : { 'default': e }; }

  var videojs__default = /*#__PURE__*/_interopDefaultLegacy(videojs);

  var version = "1.1.1";

  /**
   * @file touchOverlay.js
   * Touch UI component
   */
  const Component = videojs__default["default"].getComponent('Component');
  const dom = videojs__default["default"].dom || videojs__default["default"];

  /**
   * The `TouchOverlay` is an overlay to capture tap events.
   *
   * @extends Component
   */
  class TouchOverlay extends Component {
    /**
    * Creates an instance of the this class.
    *
    * @param  {Player} player
    *         The `Player` that this class should be attached to.
    *
    * @param  {Object} [options]
    *         The key/value store of player options.
    */
    constructor(player, options) {
      super(player, options);
      this.seekSeconds = options.seekSeconds;
      this.tapTimeout = options.tapTimeout;
      this.taps = 0;

      // Add play toggle overlay
      this.addChild('playToggle', {});

      // Clear overlay when playback starts or with control fade
      player.on(['playing', 'userinactive'], e => {
        this.removeClass('show-play-toggle');
      });

      // A 0 inactivity timeout won't work here
      if (this.player_.options_.inactivityTimeout === 0) {
        this.player_.options_.inactivityTimeout = 5000;
      }

      /**
       * Debounced tap handler.
       * Seeks number of (taps - 1) * configured seconds to skip.
       * One tap is a non-op
       *
       * @param {Event} event
       */
      this.handleTaps_ = videojs__default["default"].fn.debounce(event => {
        const increment = (this.taps - 1) * this.seekSeconds;
        this.taps = 0;
        if (increment < 1) {
          return;
        }
        const rect = this.el_.getBoundingClientRect();
        const x = event.changedTouches[0].clientX - rect.left;

        // Check if double tap is in left or right area
        if (x < rect.width * 0.4) {
          this.player_.currentTime(Math.max(0, this.player_.currentTime() - increment));
          this.addClass('reverse');
        } else if (x > rect.width - rect.width * 0.4) {
          this.player_.currentTime(Math.min(this.player_.duration(), this.player_.currentTime() + increment));
          this.removeClass('reverse');
        } else {
          return;
        }

        // Remove play toggle if showing
        this.removeClass('show-play-toggle');

        // Remove and readd class to trigger animation
        this.setAttribute('data-skip-text', `${increment} ${this.localize('seconds')}`);
        this.removeClass('skip');
        window.requestAnimationFrame(() => {
          this.addClass('skip');
        });
      }, this.tapTimeout);
      this.enable();
    }

    /**
     * Builds the DOM element.
     *
     * @return {Element}
     *         The DOM element.
     */
    createEl() {
      const el = dom.createEl('div', {
        className: 'vjs-touch-overlay',
        // Touch overlay is not tabbable.
        tabIndex: -1
      });
      return el;
    }

    /**
    * Debounces to either handle a delayed single tap, or a double tap
     *
     * @param {Event} event
     *        The touch event
     *
     */
    handleTap(event) {
      // Don't handle taps on the play button
      if (event.target !== this.el_) {
        return;
      }
      event.preventDefault();
      this.taps += 1;
      if (this.taps === 1) {
        this.removeClass('skip');
        this.toggleClass('show-play-toggle');
      }
      this.handleTaps_(event);
    }

    /**
     * Enables touch handler
     */
    enable() {
      this.firstTapCaptured = false;
      this.on('touchend', this.handleTap);
    }

    /**
     * Disables touch handler
     */
    disable() {
      this.off('touchend', this.handleTap);
    }
  }
  Component.registerComponent('TouchOverlay', TouchOverlay);

  // Default options for the plugin.
  const defaults = {
    fullscreen: {
      enterOnRotate: true,
      exitOnRotate: true,
      lockOnRotate: true,
      lockToLandscapeOnEnter: false,
      disabled: false
    },
    touchControls: {
      seekSeconds: 10,
      tapTimeout: 300,
      disableOnEnd: false,
      disabled: false
    }
  };
  const screen = window.screen;

  /**
   * Gets 'portrait' or 'lanscape' from the two orientation APIs
   *
   * @return {string} orientation
   */
  const getOrientation = () => {
    if (screen) {
      // Prefer the string over angle, as 0° can be landscape on some tablets
      const orientationString = ((screen.orientation || {}).type || screen.mozOrientation || screen.msOrientation || '').split('-')[0];
      if (orientationString === 'landscape' || orientationString === 'portrait') {
        return orientationString;
      }
    }

    // iOS only supports window.orientation
    if (typeof window.orientation === 'number') {
      if (window.orientation === 0 || window.orientation === 180) {
        return 'portrait';
      }
      return 'landscape';
    }
    return 'portrait';
  };

  /**
   * Add UI and event listeners
   *
   * @function onPlayerReady
   * @param    {Player} player
   *           A Video.js player object.
   *
   * @param    {Object} [options={}]
   *           A plain object containing options for the plugin.
   */
  const onPlayerReady = (player, options) => {
    player.addClass('vjs-mobile-ui');
    if (!options.touchControls.disabled) {
      if (options.touchControls.disableOnEnd || typeof player.endscreen === 'function') {
        player.addClass('vjs-mobile-ui-disable-end');
      }

      // Insert before the control bar
      const controlBarIdx = player.children_.indexOf(player.getChild('ControlBar'));
      player.touchOverlay = player.addChild('TouchOverlay', options.touchControls, controlBarIdx);
    }
    if (options.fullscreen.disabled) {
      return;
    }
    let locked = false;
    const rotationHandler = () => {
      const currentOrientation = getOrientation();
      if (currentOrientation === 'landscape' && options.fullscreen.enterOnRotate) {
        if (player.paused() === false) {
          player.requestFullscreen();
          if ((options.fullscreen.lockOnRotate || options.fullscreen.lockToLandscapeOnEnter) && screen.orientation && screen.orientation.lock) {
            screen.orientation.lock('landscape').then(() => {
              locked = true;
            }).catch(e => {
              videojs__default["default"].log('Browser refused orientation lock:', e);
            });
          }
        }
      } else if (currentOrientation === 'portrait' && options.fullscreen.exitOnRotate && !locked) {
        if (player.isFullscreen()) {
          player.exitFullscreen();
        }
      }
    };
    if (options.fullscreen.enterOnRotate || options.fullscreen.exitOnRotate) {
      if (videojs__default["default"].browser.IS_IOS) {
        window.addEventListener('orientationchange', rotationHandler);
        player.on('dispose', () => {
          window.removeEventListener('orientationchange', rotationHandler);
        });
      } else if (screen.orientation) {
        // addEventListener('orientationchange') is not a user interaction on Android
        screen.orientation.onchange = rotationHandler;
        player.on('dispose', () => {
          screen.orientation.onchange = null;
        });
      }
    }
    player.on('fullscreenchange', _ => {
      if (player.isFullscreen() && options.fullscreen.lockToLandscapeOnEnter && getOrientation() === 'portrait') {
        screen.orientation.lock('landscape').then(() => {
          locked = true;
        }).catch(e => {
          videojs__default["default"].log('Browser refused orientation lock:', e);
        });
      } else if (!player.isFullscreen() && locked) {
        screen.orientation.unlock();
        locked = false;
      }
    });
    player.on('ended', _ => {
      if (locked === true) {
        screen.orientation.unlock();
        locked = false;
      }
    });
  };

  /**
   * A video.js plugin.
   *
   * Adds a monile UI for player control, and fullscreen orientation control
   *
   * @function mobileUi
   * @param    {Object} [options={}]
   *           Plugin options.
   * @param    {boolean} [options.forceForTesting=false]
   *           Enables the display regardless of user agent, for testing purposes
   * @param    {Object} [options.fullscreen={}]
   *           Fullscreen options.
   * @param    {boolean} [options.fullscreen.disabled=false]
   *           If true no fullscreen handling except the *deprecated* iOS fullwindow hack
   * @param    {boolean} [options.fullscreen.enterOnRotate=true]
   *           Whether to go fullscreen when rotating to landscape
   * @param    {boolean} [options.fullscreen.exitOnRotate=true]
   *           Whether to leave fullscreen when rotating to portrait (if not locked)
   * @param    {boolean} [options.fullscreen.lockOnRotate=true]
   *           Whether to lock orientation when rotating to landscape
   *           Unlocked when exiting fullscreen or on 'ended
   * @param    {boolean} [options.fullscreen.lockToLandscapeOnEnter=false]
   *           Whether to always lock orientation to landscape on fullscreen mode
   *           Unlocked when exiting fullscreen or on 'ended'
   * @param    {Object} [options.touchControls={}]
   *           Touch UI options.
   * @param    {boolean} [options.touchControls.disabled=false]
   *           If true no touch controls are added.
   * @param    {int} [options.touchControls.seekSeconds=10]
   *           Number of seconds to seek on double-tap
   * @param    {int} [options.touchControls.tapTimeout=300]
   *           Interval in ms to be considered a doubletap
   * @param    {boolean} [options.touchControls.disableOnEnd=false]
   *           Whether to disable when the video ends (e.g., if there is an endscreen)
   *           Never shows if the endscreen plugin is present
   */
  const mobileUi = function (options = {}) {
    if (options.forceForTesting || videojs__default["default"].browser.IS_ANDROID || videojs__default["default"].browser.IS_IOS) {
      this.ready(() => {
        onPlayerReady(this, videojs__default["default"].obj.merge(defaults, options));
      });
    }
  };

  // Register the plugin with video.js.
  videojs__default["default"].registerPlugin('mobileUi', mobileUi);

  // Include the version number.
  mobileUi.VERSION = version;

  return mobileUi;

}));
