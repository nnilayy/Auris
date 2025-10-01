const STORAGE_KEY = 'aurisStreamIdByTab';
const streamIdCache = new Map();
let lastCloseAllTs = 0;
const inflightByTab = new Map();

let _hydrated = false;
let _hydratePromise = null;
function ensureHydrated() {
  if (_hydrated) {
    return Promise.resolve();
  }
  if (_hydratePromise) {
    return _hydratePromise;
  }
  _hydratePromise = (async () => {
    try {
      const data = await (chrome.storage?.session?.get?.(STORAGE_KEY) || Promise.resolve({}));
      const persisted = (data && data[STORAGE_KEY]) || {};
      Object.keys(persisted).forEach((k) => {
        const idNum = isNaN(Number(k)) ? k : Number(k);
        streamIdCache.set(idNum, persisted[k]);
      });
    } catch {
    }
    _hydrated = true;
  })();
  return _hydratePromise;
}

async function persistCache() {
  try {
    const obj = {};
    for (const [k, v] of streamIdCache.entries()) {
      obj[k] = v;
    }
    await chrome.storage.session.set({ [STORAGE_KEY]: obj });
  } catch {
  }
}

export async function getStreamIdForTab(tabId) {
  await ensureHydrated();
  if (streamIdCache.has(tabId)) {
    return streamIdCache.get(tabId);
  }
  const existing = inflightByTab.get(tabId);
  if (existing) {
    return existing;
  }
  const p = (async () => {
    try {
      // If we just globally closed contexts, give Chrome a brief grace period
      const since = Date.now() - lastCloseAllTs;
      if (since >= 0 && since < 150) {
        await new Promise((r) => setTimeout(r, 160 - since));
      }
      let attempts = 0;
      let lastErr = null;
      while (attempts < 2) {
        try {
          const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
          streamIdCache.set(tabId, streamId);
          await persistCache();
          return streamId;
        } catch (eInner) {
          const msgInner = String((eInner && eInner.message) || eInner || '');
          lastErr = eInner;
          if (/active\s*stream/i.test(msgInner) || /Cannot capture a tab/i.test(msgInner)) {
            await new Promise((r) => setTimeout(r, 140));
            attempts++;
            continue;
          }
          throw eInner;
        }
      }
      throw lastErr || new Error('Unable to acquire stream id');
    } catch (e) {
      const msg = String((e && e.message) || e || '');
      if (/active\s*stream/i.test(msg) || /Cannot capture a tab/i.test(msg)) {
        try {
          const data = await chrome.storage.session.get(STORAGE_KEY);
          const persisted = (data && data[STORAGE_KEY]) || {};
          const key = String(tabId);
          if (persisted[key]) {
            streamIdCache.set(tabId, persisted[key]);
            return persisted[key];
          }
        } catch {
          /* ignore */
        }
      }
      throw e;
    } finally {
      inflightByTab.delete(tabId);
    }
  })();
  inflightByTab.set(tabId, p);
  return p;
}

export function noteGlobalClose() {
  lastCloseAllTs = Date.now();
}

export function clearStreamId(tabId) {
  streamIdCache.delete(tabId);
  return persistCache();
}

export function setStreamIdForTab(tabId, streamId) {
  streamIdCache.set(tabId, streamId);
  return persistCache();
}

export async function getPersistedStreamIdForTab(tabId) {
  await ensureHydrated();
  if (streamIdCache.has(tabId)) {
    return streamIdCache.get(tabId);
  }
  try {
    const data = await chrome.storage.session.get(STORAGE_KEY);
    const persisted = (data && data[STORAGE_KEY]) || {};
    const key = String(tabId);
    return persisted[key];
  } catch {
    return undefined;
  }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  clearStreamId(tabId);
  const key = 'aurisGainByTab';
  chrome.storage.session
    .get(key)
    .then((data) => {
      const map = data[key] || {};
      if (map[tabId] !== undefined) {
        delete map[tabId];
        chrome.storage.session.set({ [key]: map });
      }
    })
    .catch(() => {});
});
