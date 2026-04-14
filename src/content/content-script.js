/**
 * content-script.js — runs in the ISOLATED world.
 *
 * Injected at document_start by the manifest, AND re-injected on demand by
 * the service worker via chrome.scripting when the DevTools panel opens on an
 * already-loaded page (extension installed while tab was open, etc.).
 *
 * Idempotency: window.__dlm_bridge_installed guards against double listeners.
 * page-script.js injection is skipped if window.__dlm_monitor_installed is
 * already set (monitoring already active in the main world).
 */
(function () {
  'use strict';

  // Guard: prevent adding a second postMessage listener if this script is
  // injected more than once into the same page (e.g. via chrome.scripting).
  if (window.__dlm_bridge_installed) return;
  window.__dlm_bridge_installed = true;

  // Inject page-script.js into the page's main world only if monitoring is
  // not already active. At document_start this is always the case. When
  // re-injected on an already-loaded page, page-script.js will snapshot the
  // current dataLayer and set window.__dlm_monitor_installed itself.
  if (!window.__dlm_monitor_installed) {
    var script = document.createElement('script');
    script.src = chrome.runtime.getURL('src/injected/page-script.js');
    script.async = false;
    script.addEventListener('load', function () { script.remove(); });
    (document.head || document.documentElement).appendChild(script);
  } else {
    // Monitoring is already active but the panel just opened — ask page-script
    // to re-broadcast its DATALAYER_INIT snapshot so the panel gets current data.
    window.postMessage(
      { source: 'datalayer-monitor-ping' },
      '*'
    );
  }

  // Bridge: page world → isolated world → service worker.
  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    if (!event.data) return;

    // Handle ping response: re-inject page-script to force a fresh DATALAYER_INIT.
    // (page-script always re-sends INIT on every injection regardless of the guard)
    if (event.data.source === 'datalayer-monitor-ping') return;

    if (event.data.source !== 'datalayer-monitor') return;
    var type = event.data.type;
    if (type !== 'DATALAYER_PUSH' && type !== 'DATALAYER_INIT') return;

    chrome.runtime.sendMessage({
      type: type,
      payload: event.data.payload,
      timestamp: event.data.timestamp,
    }, function () {
      if (chrome.runtime.lastError) { /* extension context invalidated — ignore */ }
    });
  });
})();
