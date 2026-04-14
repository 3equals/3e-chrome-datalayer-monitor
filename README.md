# dataLayer Monitor

A Chrome DevTools extension that intercepts and displays Google Tag Manager `dataLayer` pushes in real time — with push history, live current state, search, and more.

**Author:** Nyco Agung (nyco.a@klyp.co)  
**Version:** 1.4.0  
**Compatibility:** Chrome 102+ · Windows 11 · macOS · Linux (Ubuntu / Fedora)

---

## Table of Contents

- [Installation](#installation)
  - [Option A — Load unpacked (development / sideloading)](#option-a--load-unpacked-development--sideloading)
  - [Option B — Install from zip](#option-b--install-from-zip)
- [Getting Started](#getting-started)
- [Features](#features)
  - [Push History](#push-history)
  - [Current State](#current-state)
  - [Search & Filter](#search--filter)
  - [Auto-Expand](#auto-expand)
  - [Auto-Scroll Lock](#auto-scroll-lock)
  - [Clear History](#clear-history)
  - [Navigation Separators](#navigation-separators)
- [How It Works](#how-it-works)
- [Building a New Release](#building-a-new-release)
- [Project Structure](#project-structure)

---

## Installation

### Option A — Load unpacked (development / sideloading)

This is the quickest way to get the extension running without going through the Chrome Web Store.

1. Download or clone this repository to your machine.
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** using the toggle in the top-right corner.
4. Click **Load unpacked**.
5. Select the root folder of the repository (the folder that contains `manifest.json`).
6. The **dataLayer Monitor** extension will appear in your extensions list with the Klyp icon.
7. Pin it to your toolbar by clicking the puzzle-piece icon (🧩) and pressing the pin next to **dataLayer Monitor**.

> **Note:** After loading unpacked, Chrome may show a warning banner saying "Developer mode extensions". This is normal for sideloaded extensions.

---

### Option B — Install from zip

Download the latest pre-built zip from the [GitHub Releases page](https://github.com/3equals/3e-chrome-datalayer-monitor/releases).

1. Download `datalayer-monitor-vX.Y.Z.zip` from the latest release.
2. Unzip it to a permanent folder (do **not** delete the folder after loading — Chrome reads from it at runtime).
3. Follow steps 2–7 from **Option A**, selecting the unzipped folder in step 5.

---

## Getting Started

1. Navigate to any website in Chrome (e.g. one with Google Tag Manager installed).
2. Open Chrome DevTools:
   - **Windows / Linux:** `F12` or `Ctrl + Shift + I`
   - **macOS:** `Cmd + Option + I`
3. Look for the **"dataLayer"** tab in the DevTools tab bar. If you don't see it, click the **`»`** overflow arrow at the right end of the tab bar.
4. Click the **dataLayer** tab — the panel opens immediately and begins monitoring.

> **No page reload required.** The extension injects monitoring into the active page the moment the DevTools panel is opened, so you see data straight away — even if the page was already loaded before DevTools was opened.

---

## Features

### Push History

Every call to `window.dataLayer.push()` is captured and displayed as a collapsible card in the **Push History** tab.

Each card shows:

| Element | Description |
|---|---|
| **Index** | Sequential push number (`#1`, `#2`, …) |
| **Badge** | `PUSH` (green) for new pushes · `INIT` (grey) for items already in `dataLayer` when monitoring started |
| **Event name** | The `event` property value, or a summary of the top-level keys |
| **Timestamp** | Time the push was received (`HH:MM:SS.mmm`) |
| **JSON body** | Full syntax-highlighted payload, revealed by clicking the card header |

**Clicking a card header** expands or collapses its JSON body individually.

History is preserved across page navigations and persists until either:
- The monitored **browser tab is closed**, or
- The **Clear** button is clicked.

---

### Current State

The **Current State** tab shows the complete, live `window.dataLayer` array as it exists on the page right now — not a reconstruction from captured pushes.

It reads directly from the page via the DevTools API, so it is always accurate even if some pushes were missed (e.g. pushes that happened before the extension was installed).

The view refreshes automatically after every new push and whenever you switch to the tab.

---

### Search & Filter

The **search bar** in the toolbar filters the Push History list in real time.

- Matches are **highlighted in yellow** within the event name label.
- The filter searches the **entire JSON payload** of each push (keys and values).
- **Navigation separators** always remain visible regardless of the filter.
- If no pushes match, a "No pushes match your filter" notice is shown.
- Clear the search field to restore the full list instantly.

---

### Auto-Expand

The **expand button** (↓ icon) in the toolbar controls whether cards are expanded or collapsed.

| State | Behaviour |
|---|---|
| **Enabled** (button highlighted) | All existing cards expand immediately · All new incoming cards open automatically |
| **Disabled** (button dim, default) | All existing cards collapse immediately · All new incoming cards arrive collapsed |

Toggling the button **applies instantly to every card** already in the list, in addition to setting the default for future cards.

Individual cards can still be opened or closed manually by clicking their header, regardless of the auto-expand setting.

---

### Auto-Scroll Lock

The **scroll lock button** (⤓ icon) controls whether the Push History panel automatically scrolls to the latest push.

| State | Behaviour |
|---|---|
| **Enabled** (button highlighted, default) | Panel scrolls to the bottom each time a new push arrives |
| **Disabled** | Panel stays at its current scroll position so you can inspect earlier entries |

Click the button to toggle between the two modes at any time.

---

### Clear History

The **trash icon** button in the toolbar wipes all recorded pushes for the current tab immediately.

- The panel resets to the empty state instantly (optimistic — no round-trip delay).
- Storage is also cleared so history does not return if the panel is closed and reopened.
- History from other open tabs is **not** affected.

---

### Navigation Separators

When the browser navigates to a new URL within the same tab, a **dashed separator** is inserted into the Push History list showing:

- A navigation arrow icon
- The destination **hostname + path**
- The **timestamp** of the navigation

This keeps pushes from different pages clearly separated within a single continuous history, without losing any data.

---

## How It Works

The extension uses four layers to capture `dataLayer` activity without interfering with GTM or any other page scripts:

```
PAGE CONTEXT                 ISOLATED WORLD            EXTENSION CONTEXT
────────────────             ──────────────────        ──────────────────

page-script.js               content-script.js         service-worker.js
(main world)                 (isolated world)
      │                             │                         │
      │  defineProperty setter      │                         │
      │  intercepts dataLayer.push  │                         │
      │                             │                         │
      │──── window.postMessage ────►│                         │
      │                             │──chrome.runtime.send──►│
      │                             │                         │──► panel.js
      │                             │                         │    (DevTools)
```

1. **`page-script.js`** — injected into the page's main JavaScript world at `document_start`, before any page script runs. Installs a `defineProperty` setter trap on `window.dataLayer.push` so that even when GTM replaces `.push` with its own version, the wrapper is re-applied synchronously. An idempotency guard (`window.__dlm_monitor_installed`) prevents double installation on re-injection. The current `dataLayer` snapshot is always re-broadcast on each injection so the panel gets immediate data.

2. **`content-script.js`** — runs in an isolated JS world (separate from the page). Bridges `postMessage` events from the page to the service worker via `chrome.runtime.sendMessage`. An idempotency guard (`window.__dlm_bridge_installed`) prevents duplicate message listeners if the script is re-injected by the service worker.

3. **`service-worker.js`** — stores per-tab push history in `chrome.storage.session` (persists through service worker sleep/wake cycles; auto-cleared when the browser closes). Maintains persistent long-lived port connections to open DevTools panels. When the DevTools panel opens, re-injects `content-script.js` via `chrome.scripting.executeScript` so monitoring is always live — even on pages that were loaded before DevTools was opened.

4. **`panel.js`** — the DevTools panel UI. Connects to the service worker via a long-lived `chrome.runtime.connect` port (automatically reconnects if the service worker restarts). Reads `window.dataLayer` directly from the page using `chrome.devtools.inspectedWindow.eval` for the accurate Current State view.

---

## Building a New Release

A `build.sh` script is included that reads the version from `manifest.json` and produces a versioned zip ready for distribution.

```bash
# 1. Bump "version" in manifest.json
# 2. Run:
bash build.sh
# Produces: datalayer-monitor-vX.Y.Z.zip
```

The zip contains only the files Chrome needs (`manifest.json`, `icons/`, `src/`).

---

## Project Structure

```
.
├── manifest.json                  # Extension manifest (Manifest V3)
├── build.sh                       # Packaging script — reads version from manifest.json
├── datalayer-monitor-v1.4.0.zip   # Latest distributable
├── icons/
│   ├── icon16.png                 # 16 × 16 toolbar icon
│   ├── icon48.png                 # 48 × 48 extensions page icon
│   └── icon128.png                # 128 × 128 Web Store icon
└── src/
    ├── injected/
    │   └── page-script.js         # Main-world script — intercepts window.dataLayer
    ├── content/
    │   └── content-script.js      # Isolated-world bridge: page → service worker
    ├── background/
    │   └── service-worker.js      # History storage, message routing, re-injection
    ├── devtools/
    │   ├── devtools.html          # DevTools extension entry point
    │   └── devtools.js            # Registers the "dataLayer" panel
    └── panel/
        ├── panel.html             # DevTools panel markup
        ├── panel.css              # Dark-theme styles (VS Code colour palette)
        └── panel.js               # Panel logic, port connection, UI rendering
```
