// Auris Offscreen Script (Phase 2)
// Initializes gain-only capture engine handlers; future phases add DSP complexity.

import { initHandlers, dispatch } from '../engine/messaging/handlers.js';

console.log('[Auris Offscreen] Loaded (Phase 2 gain-only).');

initHandlers();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen') {
    return;
  } // Ignore unrelated
  const { event, data } = msg;
  (async () => {
    try {
      const result = await dispatch(event, data);
      sendResponse && sendResponse({ ok: true, result });
    } catch (e) {
      console.error('[Auris Offscreen] Dispatch error:', e);
      sendResponse && sendResponse({ ok: false, error: e?.message });
    }
  })();
  return true; // async response
});
