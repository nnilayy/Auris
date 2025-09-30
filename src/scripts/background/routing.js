// routing.js (Phase 6)
// Routes all capture engine events and maintains session storage map aurisGainByTab.

import {
  getStreamIdForTab,
  setStreamIdForTab,
  getPersistedStreamIdForTab,
  noteGlobalClose,
} from './captureOrchestrator.js';

// Local memo to avoid repeated streamId resolution per tab during a session
const _streamIdMemoByTab = new Map();
const _pipelineReadyByStream = new Set(); // streamId that we know are ready
const _initLocks = new Map(); // streamId -> Promise to serialize init only
const _fallbackLocksByTab = new Map(); // tabId -> Promise for fallback recovery
let _lastGlobalCloseTs = 0;
chrome.tabs?.onRemoved?.addListener?.((tabId) => {
  try {
    _streamIdMemoByTab.delete(tabId);
  } catch {}
});

// Offscreen creation aligned with reference pattern (fast path after first setup)
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
      // Give the offscreen page a brief moment to attach listeners (only on first create)
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

// Maintain per-tab normalized gain (1.0 => 100%).
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

// Maintain per-tab gain from percent volumeBoost (100..800 => 1.0..8.0)
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

  // Direct pass-through if explicitly targeted to offscreen already
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
    'requestStatus',
  ]);

  if (captureEvents.has(message.event)) {
    try {
      await ensureOffscreenDocument();

      const tabId = message.tabId || (sender && sender.tab && sender.tab.id);
      if (!tabId) {
        throw new Error('Missing tabId for capture event');
      }

      // Helpers to resolve/refresh streamId
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
            // Ask offscreen to resolve the current active streamId from its pipelines
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
            // Last resort: release captures and retry once with cooldown + single-flight per tab
            let lock = _fallbackLocksByTab.get(tabId);
            if (!lock) {
              lock = (async () => {
                await forwardToOffscreen({ target: 'offscreen', event: 'closeAllContexts', data: {} });
                noteGlobalClose();
                _lastGlobalCloseTs = Date.now();
                // Invalidate memo for all tabs (pipelines were closed)
                _streamIdMemoByTab.clear();
                // Cooldown: wait up to 250ms (adaptive if we just recently closed)
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

      // Resolve streamId in a reference-like order
      let streamId = _streamIdMemoByTab.get(tabId) || (await getPersistedStreamIdForTab(tabId));
      // If we very recently closed all contexts, force fresh resolution path once
      if (streamId && Date.now() - _lastGlobalCloseTs < 250) {
        _streamIdMemoByTab.delete(tabId);
        streamId = undefined;
      }
      if (!streamId) {
        // Try offscreen active first
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
          // Last, and only now, get a new media stream id
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
        // Fast path: if we already know it's ready, skip init
        if (!_pipelineReadyByStream.has(streamId)) {
          // Ask offscreen if it's ready; if not, init it with single-flight per stream
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
                    // Wait briefly for inflight init in offscreen
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

      // Build payload for the target event
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

      // Maintain gain map on relevant mutations
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

      // requestStatus returns minimal info for popup pill
      if (message.event === 'requestStatus') {
        if (sendResponse) {
          sendResponse({ ok: true, streamId, status: offscreenResp });
        }
      } else {
        if (sendResponse) {
          sendResponse({ ok: true, streamId, offscreen: offscreenResp });
        }
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
