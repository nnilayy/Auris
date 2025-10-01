import { routeMessage } from './routing.js';

const activeAudioTabs = new Map();
let _lastSnapshotJson = '';

async function writeAudibleSnapshot() {
  try {
    const tabsArr = Array.from(activeAudioTabs.entries())
      .map(([id, meta]) => ({ id, title: meta.title || `Tab ${id}`, icon: meta.icon || null }))
      .sort((a, b) => a.id - b.id);
    const payload = { tabs: tabsArr, updatedAt: Date.now() };
    const json = JSON.stringify(payload);
    if (json === _lastSnapshotJson) {
      return;
    }
    _lastSnapshotJson = json;
    await chrome.storage.session.set({ aurisAudibleTabs: payload });
  } catch (e) {
    console.warn('[Auris SW] Failed to write aurisAudibleTabs snapshot', e);
  }
}

function addAudibleTab(tab) {
  if (!tab || typeof tab.id !== 'number') return;
  const existing = activeAudioTabs.get(tab.id) || {};
  const title = tab.title || existing.title || `Tab ${tab.id}`;
  const icon = tab.favIconUrl || existing.icon || null;
  let changed = false;
  if (!activeAudioTabs.has(tab.id)) {
    changed = true;
  } else if (existing.title !== title || existing.icon !== icon) {
    changed = true;
  }
  if (changed) {
    activeAudioTabs.set(tab.id, { title, icon });
    writeAudibleSnapshot();
  }
}

function removeAudibleTab(tabId) {
  if (activeAudioTabs.delete(tabId)) {
    writeAudibleSnapshot();
  }
}

chrome.tabs?.query?.({ audible: true }, (tabs) => {
  try {
    (tabs || []).forEach((t) => addAudibleTab(t));
  } catch {}
  writeAudibleSnapshot();
});

chrome.tabs?.onUpdated?.addListener?.((tabId, changeInfo, tab) => {
  if ('audible' in changeInfo) {
    if (changeInfo.audible === true) {
      addAudibleTab(tab);
    } else if (changeInfo.audible === false) {
      removeAudibleTab(tabId);
    }
  } else if ('title' in changeInfo) {
    if (activeAudioTabs.has(tabId)) {
      addAudibleTab(tab);
    }
  }
});

chrome.tabs?.onRemoved?.addListener?.((tabId) => {
  removeAudibleTab(tabId);
});

// self.addEventListener('install', () => {
// });

self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.resolve());
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      await routeMessage(message, sender, sendResponse);
    } catch (e) {
      console.error('[Auris SW] Routing error:', e);
      sendResponse && sendResponse({ error: true, message: e?.message });
    }
  })();
  return true;
});
