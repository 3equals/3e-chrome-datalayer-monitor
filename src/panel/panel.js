'use strict';

// ─── Port connection to service worker ───────────────────────────────────────
var tabId = chrome.devtools.inspectedWindow.tabId;
var port  = chrome.runtime.connect({ name: 'devtools-panel' });

port.postMessage({ type: 'PANEL_INIT', tabId: tabId });

// ─── State ───────────────────────────────────────────────────────────────────
var allEntries  = [];
var autoScroll  = true;
var autoExpand  = false; // when true: all cards expanded; when false: all collapsed
var filterText  = '';

// ─── DOM refs ────────────────────────────────────────────────────────────────
var historyList   = document.getElementById('history-list');
var historyEmpty  = document.getElementById('history-empty');
var noResults     = document.getElementById('no-results');
var stateJson     = document.getElementById('state-json');
var stateEmpty    = document.getElementById('state-empty');
var pushCountEl   = document.getElementById('push-count');
var btnClear      = document.getElementById('btn-clear');
var btnScrollLock = document.getElementById('btn-scroll-lock');
var btnExpandAll  = document.getElementById('btn-expand-all');
var searchInput   = document.getElementById('search-input');
var panelHistory  = document.getElementById('panel-history');

// ─── Utilities ───────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function syntaxHighlight(value) {
  var str = (typeof value === 'string') ? value : JSON.stringify(value, null, 2);
  str = escapeHtml(str);
  return str.replace(
    /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?|[{}\[\],:])/g,
    function (match) {
      var cls;
      if (/^"/.test(match))               cls = /:$/.test(match) ? 'json-key' : 'json-string';
      else if (/true|false/.test(match))  cls = 'json-boolean';
      else if (match === 'null')          cls = 'json-null';
      else if (/[{}\[\],:]/.test(match))  cls = 'json-punct';
      else                                cls = 'json-number';
      return '<span class="' + cls + '">' + match + '</span>';
    }
  );
}

function formatTime(ts) {
  var d  = new Date(ts);
  var h  = String(d.getHours()).padStart(2, '0');
  var m  = String(d.getMinutes()).padStart(2, '0');
  var s  = String(d.getSeconds()).padStart(2, '0');
  var ms = String(d.getMilliseconds()).padStart(3, '0');
  return h + ':' + m + ':' + s + '.' + ms;
}

function summarisePayload(payload) {
  if (!payload || typeof payload !== 'object') return String(payload);
  if (payload.event) return payload.event;
  var keys = Object.keys(payload);
  if (keys.length === 0) return '{ }';
  if (keys.length === 1) return keys[0] + ': …';
  return keys.slice(0, 2).join(', ') + (keys.length > 2 ? ', …' : '');
}

function highlightMatch(text, term) {
  if (!term) return escapeHtml(text);
  var escaped     = escapeHtml(text);
  var escapedTerm = escapeHtml(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escaped.replace(new RegExp('(' + escapedTerm + ')', 'gi'), '<mark>$1</mark>');
}

function matchesFilter(entry) {
  // Navigation separators always show — they're structural, not data
  if (entry.type === 'PAGE_NAVIGATED') return true;
  if (!filterText) return true;
  return JSON.stringify(entry.payload).toLowerCase().indexOf(filterText.toLowerCase()) !== -1;
}

// ─── Current State — read directly from the live page ────────────────────────
function refreshCurrentState() {
  chrome.devtools.inspectedWindow.eval(
    '(function(){try{return JSON.stringify(window.dataLayer||[]);}catch(e){return null;}})()',
    function (result, isException) {
      if (isException || result === null || result === undefined) {
        // Fallback: reconstruct from captured history
        var pushEntries = allEntries.filter(function (e) { return e.type !== 'PAGE_NAVIGATED'; });
        if (pushEntries.length > 0) {
          stateJson.innerHTML = syntaxHighlight(pushEntries.map(function (e) { return e.payload; }));
          stateEmpty.style.display = 'none';
        } else {
          stateJson.innerHTML = '';
          stateEmpty.style.display = 'flex';
        }
        return;
      }
      try {
        var parsed = JSON.parse(result);
        if (Array.isArray(parsed) && parsed.length > 0) {
          stateJson.innerHTML = syntaxHighlight(parsed);
          stateEmpty.style.display = 'none';
        } else {
          stateJson.innerHTML = '';
          stateEmpty.style.display = 'flex';
        }
      } catch (e) {
        stateJson.innerHTML = '';
        stateEmpty.style.display = 'flex';
      }
    }
  );
}

// ─── Build a navigation separator ────────────────────────────────────────────
function buildNavSeparator(entry) {
  var sep = document.createElement('div');
  sep.className = 'nav-separator';
  sep.dataset.index = entry.index;

  var line = document.createElement('div');
  line.className = 'nav-separator-line';

  var label = document.createElement('span');
  label.className = 'nav-separator-label';

  // Show just the path+query portion of the URL to keep it compact
  var display = entry.payload && entry.payload.url ? entry.payload.url : 'Page navigation';
  try {
    var u = new URL(entry.payload.url);
    display = u.hostname + (u.pathname !== '/' ? u.pathname : '') + u.search;
  } catch (e) { /* keep raw url */ }

  label.title = entry.payload && entry.payload.url ? entry.payload.url : '';
  label.innerHTML =
    '<svg viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M1 6h10M7 2l4 4-4 4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>' +
    '<span>' + escapeHtml(display) + '</span>' +
    '<time>' + formatTime(entry.timestamp) + '</time>';

  line.appendChild(label);
  sep.appendChild(line);
  return sep;
}

// ─── Build a history card ─────────────────────────────────────────────────────
function buildCard(entry, isNew) {
  if (entry.type === 'PAGE_NAVIGATED') return buildNavSeparator(entry);

  var isInit  = entry.type === 'DATALAYER_INIT';
  var summary = summarisePayload(entry.payload);
  var matches = matchesFilter(entry);

  var card = document.createElement('div');
  card.className = 'history-card ' + (isInit ? 'is-init' : 'is-push') +
                   (isNew ? ' is-new' : '') + (matches ? '' : ' filtered-out');
  card.dataset.index = entry.index;

  // Header
  var header = document.createElement('div');
  header.className = 'card-header';

  var left = document.createElement('div');
  left.className = 'card-left';

  var indexEl = document.createElement('span');
  indexEl.className = 'card-index';
  indexEl.textContent = '#' + (entry.index + 1);

  var badge = document.createElement('span');
  badge.className = 'card-badge ' + (isInit ? 'badge-init' : 'badge-push');
  badge.textContent = isInit ? 'init' : 'push';

  var eventEl = document.createElement('span');
  eventEl.className = 'card-event';
  eventEl.innerHTML = highlightMatch(summary, filterText);

  left.appendChild(indexEl);
  left.appendChild(badge);
  left.appendChild(eventEl);

  var right = document.createElement('div');
  right.className = 'card-right';

  var timeEl = document.createElement('span');
  timeEl.className = 'card-time';
  timeEl.textContent = formatTime(entry.timestamp);

  var chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  chevron.setAttribute('viewBox', '0 0 12 12');
  chevron.setAttribute('fill', 'none');
  chevron.setAttribute('class', 'card-chevron');
  chevron.innerHTML = '<path d="M4 2l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>';

  right.appendChild(timeEl);
  right.appendChild(chevron);
  header.appendChild(left);
  header.appendChild(right);

  // Body — respects current autoExpand state
  var body = document.createElement('div');
  body.className = 'card-body' + (autoExpand ? ' expanded' : '');
  if (autoExpand) chevron.classList.add('expanded');

  var pre = document.createElement('pre');
  pre.innerHTML = syntaxHighlight(entry.payload);
  body.appendChild(pre);

  header.addEventListener('click', function () {
    var expanded = body.classList.toggle('expanded');
    chevron.classList.toggle('expanded', expanded);
  });

  card.appendChild(header);
  card.appendChild(body);
  return card;
}

// ─── Render helpers ───────────────────────────────────────────────────────────

function updatePushCount() {
  // Count only actual pushes, not nav separators
  var count = allEntries.filter(function (e) { return e.type !== 'PAGE_NAVIGATED'; }).length;
  pushCountEl.textContent = count;
}

function updateHistoryEmptyState() {
  var hasEntries = allEntries.length > 0;
  historyEmpty.style.display = hasEntries ? 'none' : 'flex';

  if (hasEntries && filterText) {
    var anyVisible = allEntries.some(function (e) {
      return e.type !== 'PAGE_NAVIGATED' && matchesFilter(e);
    });
    noResults.style.display = anyVisible ? 'none' : 'flex';
  } else {
    noResults.style.display = 'none';
  }
}

function renderAllHistory() {
  historyList.innerHTML = '';
  for (var i = 0; i < allEntries.length; i++) {
    historyList.appendChild(buildCard(allEntries[i], false));
  }
  updatePushCount();
  updateHistoryEmptyState();
  refreshCurrentState();
}

function appendNewEntries(entries) {
  for (var i = 0; i < entries.length; i++) {
    allEntries.push(entries[i]);
    historyList.appendChild(buildCard(entries[i], true));
  }
  updatePushCount();
  updateHistoryEmptyState();
  refreshCurrentState();
  if (autoScroll) panelHistory.scrollTop = panelHistory.scrollHeight;
}

function applyFilter() {
  var cards = historyList.querySelectorAll('.history-card');
  for (var i = 0; i < cards.length; i++) {
    var idx   = parseInt(cards[i].dataset.index, 10);
    var entry = allEntries[idx];
    var ok    = entry && matchesFilter(entry);
    cards[i].classList.toggle('filtered-out', !ok);
    if (entry && entry.type !== 'PAGE_NAVIGATED') {
      var eventEl = cards[i].querySelector('.card-event');
      if (eventEl) eventEl.innerHTML = highlightMatch(summarisePayload(entry.payload), filterText);
    }
  }
  updateHistoryEmptyState();
}

function resetUI() {
  allEntries = [];
  historyList.innerHTML = '';
  stateJson.innerHTML   = '';
  stateEmpty.style.display = 'flex';
  updatePushCount();
  updateHistoryEmptyState();
}

// ─── Tab switching ────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(function (btn) {
  btn.addEventListener('click', function () {
    var target = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(function (b) {
      b.classList.toggle('active', b.dataset.tab === target);
      b.setAttribute('aria-selected', String(b.dataset.tab === target));
    });
    document.querySelectorAll('.panel').forEach(function (p) {
      p.classList.toggle('active', p.id === 'panel-' + target);
    });
    if (target === 'state') refreshCurrentState();
  });
});

// ─── Toolbar controls ─────────────────────────────────────────────────────────

btnClear.addEventListener('click', function () {
  resetUI();
  port.postMessage({ type: 'CLEAR_HISTORY', tabId: tabId });
});

btnScrollLock.addEventListener('click', function () {
  autoScroll = !autoScroll;
  btnScrollLock.classList.toggle('active', autoScroll);
  btnScrollLock.title = autoScroll
    ? 'Auto-scroll on (click to disable)'
    : 'Auto-scroll off (click to enable)';
});

// Expand button: toggles ALL existing cards and sets the state for new ones
btnExpandAll.addEventListener('click', function () {
  autoExpand = !autoExpand;
  btnExpandAll.classList.toggle('active', autoExpand);
  btnExpandAll.title = autoExpand
    ? 'Collapse all'
    : 'Expand all';

  // Apply immediately to every existing card in the list
  historyList.querySelectorAll('.card-body').forEach(function (b) {
    b.classList.toggle('expanded', autoExpand);
  });
  historyList.querySelectorAll('.card-chevron').forEach(function (c) {
    c.classList.toggle('expanded', autoExpand);
  });
});

searchInput.addEventListener('input', function () {
  filterText = searchInput.value.trim();
  applyFilter();
});

// ─── Messages from service worker ────────────────────────────────────────────
function handlePortMessage(message) {
  if (message.type === 'HISTORY') {
    allEntries = message.history || [];
    renderAllHistory();
    if (autoScroll) panelHistory.scrollTop = panelHistory.scrollHeight;
  }

  if (message.type === 'HISTORY_UPDATE') {
    appendNewEntries(message.entries || []);
  }

  if (message.type === 'CLEARED') {
    resetUI();
  }
}

port.onMessage.addListener(handlePortMessage);

// ─── Reconnect on port disconnect (service worker restart) ───────────────────
port.onDisconnect.addListener(function reconnect() {
  port = chrome.runtime.connect({ name: 'devtools-panel' });
  port.postMessage({ type: 'PANEL_INIT', tabId: tabId });
  port.onMessage.addListener(handlePortMessage);
  port.onDisconnect.addListener(reconnect);
});
