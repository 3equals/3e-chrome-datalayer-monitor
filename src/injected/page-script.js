/**
 * page-script.js — runs in the PAGE's JavaScript context.
 *
 * Responsibilities:
 * 1. Ensure window.dataLayer exists before any page script runs.
 * 2. Snapshot any items already in dataLayer and broadcast them as DATALAYER_INIT.
 * 3. Install a defineProperty setter trap on dataLayer.push so that when GTM
 *    replaces .push with its own version, we immediately re-wrap it.
 * 4. Send all intercepted pushes to the content script via window.postMessage.
 *
 * Idempotency: guarded by window.__dlm_monitor_installed so re-injection by
 * chrome.scripting (when DevTools opens on an already-loaded page) is safe.
 * The DATALAYER_INIT snapshot is always re-sent on re-injection so the panel
 * can populate even if it missed the original document_start run.
 */
(function () {
  'use strict';

  var SOURCE_TAG = 'datalayer-monitor';

  function post(type, payload) {
    var safe;
    try { safe = JSON.parse(JSON.stringify(payload)); }
    catch (e) { safe = { __unserializable: true }; }
    window.postMessage(
      { source: SOURCE_TAG, type: type, payload: safe, timestamp: Date.now() },
      '*'
    );
  }

  // Ensure dataLayer exists — GTM will reuse this array.
  window.dataLayer = window.dataLayer || [];

  // Always snapshot current items so the panel gets the full state even when
  // this script is re-injected after the page has already loaded.
  // Serialize each item through JSON to strip non-cloneable values (e.g.
  // Arguments objects that GTM or page scripts may have pushed into dataLayer).
  var existing = window.dataLayer.slice();
  if (existing.length > 0) {
    var safeExisting = existing.map(function (item) {
      try { return JSON.parse(JSON.stringify(item)); }
      catch (e) { return { __unserializable: true, keys: Object.keys(item || {}) }; }
    });
    post('DATALAYER_INIT', safeExisting);
  }

  // Guard: only install the push interceptor once per page.
  if (window.__dlm_monitor_installed) return;
  window.__dlm_monitor_installed = true;

  // Build a wrapped push function that calls the real push and posts a message.
  function buildWrappedPush(inner) {
    return function dataLayerPushMonitor() {
      var args = Array.prototype.slice.call(arguments);
      var result = inner.apply(this, args);
      for (var i = 0; i < args.length; i++) {
        try {
          var serialised = JSON.parse(JSON.stringify(args[i]));
          post('DATALAYER_PUSH', serialised);
        } catch (e) {
          post('DATALAYER_PUSH', { __unserializable: true, keys: Object.keys(args[i] || {}) });
        }
      }
      return result;
    };
  }

  var _activePush = buildWrappedPush(Array.prototype.push.bind(window.dataLayer));

  // Setter trap: when GTM replaces dataLayer.push, we re-wrap it immediately.
  try {
    Object.defineProperty(window.dataLayer, 'push', {
      get: function () { return _activePush; },
      set: function (newPush) { _activePush = buildWrappedPush(newPush); },
      configurable: true,
    });
  } catch (e) {
    // defineProperty failed (frozen object). Fall back to direct assignment.
    window.dataLayer.push = _activePush;
  }
})();
