import { initHandlers, dispatch } from '../engine/messaging/handlers.js';

initHandlers();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen') {
    return;
  }
  
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
  
  // Enable async response handling
  return true;
});
