/**
 * service-worker.js — MV3 background service worker.
 *
 * Responsibilities:
 * 1. Store per-tab dataLayer push history in chrome.storage.session.
 * 2. Route DATALAYER_PUSH / DATALAYER_INIT messages from content scripts.
 * 3. Forward live updates to connected DevTools panel ports.
 * 4. Handle CLEAR_HISTORY requests from the panel.
 * 5. Clear stale history on tab close or navigation.
 * 6. Re-inject monitoring scripts when the DevTools panel opens on an
 *    already-loaded page (via chrome.scripting), so history and current
 *    state are always live without a page reload.
 */

'use strict';

// ─── In-memory store (write-through to storage.session) ─────────────────────
var historyStore = {};

// Promise that resolves once the store is restored from storage.session.
// All message handlers wait on this so a freshly-woken service worker never
// responds with stale/empty data.
var storeReady = new Promise(function (resolve) {
  chrome.storage.session.get(null, function (all) {
    if (!chrome.runtime.lastError) {
      for (var key in all) {
        if (Object.prototype.hasOwnProperty.call(all, key) && key.indexOf('tab_') === 0) {
          var tabId = parseInt(key.slice(4), 10);
          historyStore[tabId] = all[key];
        }
      }
    }
    resolve();
  });
});

// ─── Active DevTools panel ports, keyed by inspected tabId ──────────────────
var panelPorts = {};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function tabKey(tabId) { return 'tab_' + tabId; }

function persistTab(tabId) {
  var obj = {};
  obj[tabKey(tabId)] = historyStore[tabId] || [];
  chrome.storage.session.set(obj);
}

function clearHistory(tabId) {
  delete historyStore[tabId];
  var obj = {};
  obj[tabKey(tabId)] = [];
  chrome.storage.session.set(obj);
}

function appendEntry(tabId, entry) {
  if (!historyStore[tabId]) historyStore[tabId] = [];
  var list = historyStore[tabId];

  if (entry.type === 'DATALAYER_INIT') {
    var payloads = Array.isArray(entry.payload) ? entry.payload : [entry.payload];
    for (var i = 0; i < payloads.length; i++) {
      list.push({ type: 'DATALAYER_INIT', payload: payloads[i], timestamp: entry.timestamp, index: list.length });
    }
  } else {
    // PAGE_NAVIGATED and DATALAYER_PUSH share the same shape
    list.push({ type: entry.type, payload: entry.payload, timestamp: entry.timestamp, index: list.length });
  }

  persistTab(tabId);
}

function notifyPanel(tabId, entries) {
  var port = panelPorts[tabId];
  if (!port) return;
  try { port.postMessage({ type: 'HISTORY_UPDATE', entries: entries }); }
  catch (e) { /* panel closed */ }
}

// ─── Re-inject monitoring into an already-loaded tab ─────────────────────────
// Called when the DevTools panel opens. The content script's idempotency guard
// (window.__dlm_bridge_installed) prevents double listeners; page-script.js's
// guard (window.__dlm_monitor_installed) prevents double push interception but
// always re-broadcasts the DATALAYER_INIT snapshot.
function reinjectMonitoring(tabId) {
  chrome.scripting.executeScript({
    target: { tabId: tabId, allFrames: false },
    files: ['src/content/content-script.js'],
    world: 'ISOLATED',
  }).catch(function () {
    // Restricted URLs (chrome://, file:// without permission, etc.) — ignore.
  });
}

// ─── DevTools panel port connections ─────────────────────────────────────────
chrome.runtime.onConnect.addListener(function (port) {
  if (port.name !== 'devtools-panel') return;

  var connectedTabId = null;

  port.onMessage.addListener(function (message) {
    if (message.type === 'PANEL_INIT') {
      connectedTabId = message.tabId;
      panelPorts[connectedTabId] = port;

      // Wait for store restore, then send history and kick off re-injection.
      storeReady.then(function () {
        try {
          port.postMessage({ type: 'HISTORY', history: historyStore[connectedTabId] || [] });
        } catch (e) { return; /* port closed */ }

        // Re-inject regardless of whether we have history — ensures monitoring
        // is live on the page right now (handles extension-installed-while-open
        // and DevTools-opened-after-page-load cases).
        reinjectMonitoring(connectedTabId);
      });
    }

    if (message.type === 'CLEAR_HISTORY' && connectedTabId !== null) {
      clearHistory(connectedTabId);
      try { port.postMessage({ type: 'CLEARED' }); }
      catch (e) { /* noop */ }
    }
  });

  port.onDisconnect.addListener(function () {
    if (connectedTabId !== null) delete panelPorts[connectedTabId];
  });
});

// ─── Messages from content scripts ───────────────────────────────────────────
chrome.runtime.onMessage.addListener(function (message, sender) {
  if (!sender.tab) return false;
  if (message.type !== 'DATALAYER_PUSH' && message.type !== 'DATALAYER_INIT') return false;

  var tabId = sender.tab.id;
  var beforeLen = historyStore[tabId] ? historyStore[tabId].length : 0;

  appendEntry(tabId, message);

  var newEntries = (historyStore[tabId] || []).slice(beforeLen);
  notifyPanel(tabId, newEntries);

  return false;
});

// ─── Tab lifecycle ────────────────────────────────────────────────────────────
// History is kept until the tab is closed or the clear button is clicked.
chrome.tabs.onRemoved.addListener(function (tabId) {
  clearHistory(tabId);
});

chrome.tabs.onUpdated.addListener(function (tabId, changeInfo) {
  // On genuine navigation insert a visual separator so the user can see
  // where one page ends and the next begins — but do NOT wipe history.
  if (changeInfo.status === 'loading' && changeInfo.url) {
    var entry = { type: 'PAGE_NAVIGATED', payload: { url: changeInfo.url }, timestamp: Date.now() };
    var beforeLen = historyStore[tabId] ? historyStore[tabId].length : 0;
    appendEntry(tabId, entry);
    var newEntries = (historyStore[tabId] || []).slice(beforeLen);
    notifyPanel(tabId, newEntries);
  }
});
