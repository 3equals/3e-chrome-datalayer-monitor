/**
 * devtools.js — loaded inside the DevTools context.
 * Registers the "dataLayer" panel in Chrome DevTools.
 */
chrome.devtools.panels.create(
  'dataLayer',
  '/icons/icon16.png',
  '/src/panel/panel.html',
  function () { /* panel registered */ }
);
