// serviceWorker.js (Phase 2)
// Background orchestrator with routing + capture prep.

import { routeMessage } from './routing.js';

console.log('[Auris SW] Service worker (Phase 2) initialized.');

// Install / Activate hooks (can be extended later)
self.addEventListener('install', () => {
  console.log('[Auris SW] Installed');
});

self.addEventListener('activate', (event) => {
  console.log('[Auris SW] Activated');
  // Keep service worker alive briefly if needed for init tasks
  event.waitUntil(Promise.resolve());
});

// Runtime message listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      await routeMessage(message, sender, sendResponse);
    } catch (e) {
      console.error('[Auris SW] Routing error:', e);
      sendResponse && sendResponse({ error: true, message: e?.message });
    }
  })();
  return true; // async path
});
