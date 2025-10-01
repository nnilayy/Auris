import {
  getStreamIdForTab,
  setStreamIdForTab,
  getPersistedStreamIdForTab,
  noteGlobalClose,
} from './captureOrchestrator.js';

const _streamIdMemoByTab = new Map();
const _pipelineReadyByStream = new Set();
const _initLocks = new Map();
const _fallbackLocksByTab = new Map();
let _lastGlobalCloseTs = 0;

chrome.tabs?.onRemoved?.addListener?.((tabId) => {
  try {
    _streamIdMemoByTab.delete(tabId);
  } catch {}
});

let creatingOffscreen = null;
let offscreenReady = false;
async function ensureOffscreenDocument() {
  if (offscreenReady) {
    return;
  }
  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }
  creatingOffscreen = (async () => {
    const url = chrome.runtime.getURL('src/pages/offscreen.html');
    try {
      const contexts = await (chrome.runtime.getContexts?.({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [url],
      }) || Promise.resolve([]));
      if (Array.isArray(contexts) && contexts.length > 0) {
        offscreenReady = true;
        return;
      }
      const reason = chrome.offscreen?.Reason?.USER_MEDIA || 'USER_MEDIA';
      await chrome.offscreen.createDocument({
        url,
        reasons: [reason],
        justification: 'Run WebAudio processing for tab capture and DSP.',
      });
      await new Promise((r) => setTimeout(r, 50));
      offscreenReady = true;
    } catch (e) {
      const msg = String((e && e.message) || e || '');
      if (/Only a single offscreen document/i.test(msg)) {
        offscreenReady = true;
      } else {
        console.error('[Auris Routing] ensureOffscreenDocument failed:', e);
      }
    } finally {
      creatingOffscreen = null;
    }
  })();
  await creatingOffscreen;
}

async function forwardToOffscreen(payload) {
  await ensureOffscreenDocument();
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(payload, (resp) => resolve(resp));
  });
}

async function setGainForTabNormalized(tabId, normalized) {
  if (typeof normalized !== 'number') {
    return;
  }
  const key = 'aurisGainByTab';
  const data = await chrome.storage.session.get(key);
  const map = data[key] || {};
  map[tabId] = Math.max(0, normalized);
  await chrome.storage.session.set({ [key]: map });
}

async function setGainForTabPercent(tabId, percent) {
  if (typeof percent !== 'number') {
    return;
  }
  return setGainForTabNormalized(tabId, Math.max(0, percent / 100));
}

export async function routeMessage(message, sender, sendResponse) {
  if (!message) {
    return;
  }

  if (message.target === 'offscreen') {
    const result = await forwardToOffscreen(message);
    if (sendResponse) {
      sendResponse(result);
    }
    return;
  }

  const captureEvents = new Set([
    'applySettings',
    'initPipeline',
    'updateEQ',
    'updateControls',
    'toggleEffect',
    'updateEffectParams',
  ]);

  if (captureEvents.has(message.event)) {
    try {
      await ensureOffscreenDocument();

      const tabId = message.tabId || (sender && sender.tab && sender.tab.id);
      if (!tabId) {
        throw new Error('Missing tabId for capture event');
      }

      async function resolveStreamId() {
        if (_streamIdMemoByTab.has(tabId)) {
          return _streamIdMemoByTab.get(tabId);
        }
        try {
          const id = await getStreamIdForTab(tabId);
          _streamIdMemoByTab.set(tabId, id);
          return id;
        } catch (e) {
          const msg = String((e && e.message) || e || '');
          if (/active\s*stream/i.test(msg) || /Cannot capture a tab/i.test(msg)) {
            const resp = await forwardToOffscreen({
              target: 'offscreen',
              event: 'resolveActiveStreamId',
              data: {},
            });
            if (resp && resp.ok && resp.streamId) {
              try {
                setStreamIdForTab(tabId, resp.streamId);
              } catch {}
              _streamIdMemoByTab.set(tabId, resp.streamId);
              return resp.streamId;
            }
            let lock = _fallbackLocksByTab.get(tabId);
            if (!lock) {
              lock = (async () => {
                await forwardToOffscreen({ target: 'offscreen', event: 'closeAllContexts', data: {} });
                noteGlobalClose();
                _lastGlobalCloseTs = Date.now();
                _streamIdMemoByTab.clear();
                await new Promise((r) => setTimeout(r, 200));
              })().finally(() => _fallbackLocksByTab.delete(tabId));
              _fallbackLocksByTab.set(tabId, lock);
            }
            await lock;
            const retried = await getStreamIdForTab(tabId);
            try { setStreamIdForTab(tabId, retried); } catch {}
            _streamIdMemoByTab.set(tabId, retried);
            return retried;
          }
          throw e;
        }
      }

      let streamId = _streamIdMemoByTab.get(tabId) || (await getPersistedStreamIdForTab(tabId));
      if (streamId && Date.now() - _lastGlobalCloseTs < 250) {
        _streamIdMemoByTab.delete(tabId);
        streamId = undefined;
      }
      if (!streamId) {
        const active = await forwardToOffscreen({
          target: 'offscreen',
          event: 'resolveActiveStreamId',
          data: {},
        });
        if (active && active.ok && active.streamId) {
          streamId = active.streamId;
          try {
            setStreamIdForTab(tabId, streamId);
          } catch {}
          _streamIdMemoByTab.set(tabId, streamId);
        } else {
          streamId = await resolveStreamId();
          _streamIdMemoByTab.set(tabId, streamId);
        }
      }
      const requiresPipeline = new Set([
        'applySettings',
        'updateEQ',
        'updateControls',
        'toggleEffect',
        'updateEffectParams',
      ]);
      if (requiresPipeline.has(message.event)) {
        if (!_pipelineReadyByStream.has(streamId)) {
          const status = await forwardToOffscreen({
            target: 'offscreen',
            event: 'hasPipeline',
            data: { streamId },
          });
          if (!(status && status.ok && status.exists)) {
            let inflight = _initLocks.get(streamId);
            if (!inflight) {
              inflight = (async () => {
                const initResp = await forwardToOffscreen({
                  target: 'offscreen',
                  event: 'initPipeline',
                  data: { streamId, gain: 1 },
                });
                if (!(initResp && initResp.ok)) {
                  const err = String((initResp && initResp.error) || '');
                  if (/active\s*stream/i.test(err) || /Cannot capture a tab/i.test(err)) {
                    let retries = 5;
                    while (retries-- > 0) {
                      await new Promise((r) => setTimeout(r, 60));
                      const has = await forwardToOffscreen({
                        target: 'offscreen',
                        event: 'hasPipeline',
                        data: { streamId },
                      });
                      if (has && has.ok && has.exists) {
                        break;
                      }
                    }
                  } else {
                    throw new Error(
                      (initResp && initResp.error) || 'Failed to initialize pipeline'
                    );
                  }
                }
                _pipelineReadyByStream.add(streamId);
              })().finally(() => _initLocks.delete(streamId));
              _initLocks.set(streamId, inflight);
            }
            await inflight;
          } else {
            _pipelineReadyByStream.add(streamId);
          }
        }
      }

      const data = { streamId };
      if (message.settings) {
        data.settings = message.settings;
      }
      if (message.eq) {
        data.eq = message.eq;
      }
      if (message.controls) {
        data.controls = message.controls;
      }
      if (message.name) {
        data.name = message.name;
      }
      if (message.active !== undefined) {
        data.active = message.active;
      }
      if (message.params) {
        data.params = message.params;
      }

      const offscreenResp = await forwardToOffscreen({
        target: 'offscreen',
        event: message.event,
        data,
      });

      if (message.event === 'applySettings') {
        if (message.settings) {
          const { volumeBoost, gain } = message.settings;
          if (typeof volumeBoost === 'number') {
            await setGainForTabPercent(tabId, volumeBoost);
          } else if (typeof gain === 'number') {
            await setGainForTabNormalized(tabId, gain);
          }
        }
      } else if (message.event === 'updateControls') {
        const vb = message.controls && message.controls.volumeBoost;
        if (typeof vb === 'number') {
          await setGainForTabPercent(tabId, vb);
        }
      }

      if (sendResponse) {
        sendResponse({ ok: true, streamId, offscreen: offscreenResp });
      }
    } catch (e) {
      console.error('[Auris Routing] capture event error:', e);
      if (sendResponse) {
        sendResponse({ ok: false, error: e && e.message });
      }
    }
    return;
  }

  if (sendResponse) {
    sendResponse({ acknowledged: true, phase: 2 });
  }
}
