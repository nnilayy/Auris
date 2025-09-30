// engineBootstrap.js (Phase 5)
// Initializes handling for pipeline creation, gain, EQ, controls, anti-distortion and effects (8D, surround, echo).

import { getPipeline, setPipeline, deletePipeline, safeCloseContext } from './stateRegistry.js';
import { buildPipeline } from './pipelineBuilder.js';
import { validateEQArray } from '../dsp/equalizer.js';
import { createScheduler } from './scheduler.js';

async function getUserMediaFromStreamId(streamId) {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
      },
    },
  });
}

const scheduler = createScheduler();
if (scheduler) {
  scheduler.start();
}

const activityMap = new Map(); // streamId -> { lastActive: number }

function markActive(streamId) {
  activityMap.set(streamId, { lastActive: performance.now() });
}

// Concurrency guard: avoid multiple parallel creations per streamId
const creatingPipelines = new Map(); // streamId -> Promise<pipeline>

async function ensurePipeline(streamId, { gain, eq, controls }) {
  const existing = getPipeline(streamId);
  if (existing) {
    // If context was previously closed, purge and rebuild
    if (existing.context?.state === 'closed' || existing._closed) {
      try { deletePipeline(streamId); } catch {}
    } else {
      return existing;
    }
  }
  const inflight = creatingPipelines.get(streamId);
  if (inflight) {
    return inflight;
  }
  const createPromise = (async () => {
    const media = await getUserMediaFromStreamId(streamId);
    const pipeline = buildPipeline({
      stream: media,
      initialGain: gain,
      eqArray: eq,
      controlsSettings: controls,
    });
    // Register effects animation step (8D)
    if (pipeline.nodes?.effects && scheduler && !pipeline.nodes.effects._stepFn) {
      const effectsObj = pipeline.nodes.effects;
      if (effectsObj?.step) {
        const stepFn = (delta) => effectsObj.step(delta);
        effectsObj._stepFn = stepFn;
        scheduler.add(stepFn);
      }
    }
    setPipeline(streamId, pipeline);
    markActive(streamId);
    return pipeline;
  })().finally(() => creatingPipelines.delete(streamId));
  creatingPipelines.set(streamId, createPromise);
  return createPromise;
}

export function initEngineMessaging(register) {
  // Resolve best active streamId when background can't call getMediaStreamId
  register('resolveActiveStreamId', async () => {
    const { listPipelines } = await import('./stateRegistry.js');
    const ids = listPipelines();
    if (ids.length === 0) {
      return { ok: false, error: 'No active streams' };
    }
    if (ids.length === 1) {
      return { ok: true, streamId: ids[0] };
    }
    // Choose most recently active
    let best = null;
    let bestTs = -1;
    ids.forEach((id) => {
      const rec = activityMap.get(id);
      const ts = (rec && rec.lastActive) || 0;
      if (ts > bestTs) {
        bestTs = ts;
        best = id;
      }
    });
    if (best) {
      return { ok: true, streamId: best };
    }
    return { ok: false, error: 'Unable to resolve active stream' };
  });
  register('initPipeline', async ({ streamId, gain = 1, eq, controls }) => {
    await ensurePipeline(streamId, { gain, eq, controls });
    return { ok: true };
  });

  register('hasPipeline', async ({ streamId }) => {
    const exists = !!getPipeline(streamId);
    return { ok: true, exists };
  });

  register('applySettings', async ({ streamId, settings }) => {
    const { gain = 1, eq, volumeBoost, bassBoost, voiceBoost } = settings || {}; // eq optional
    const controls =
      volumeBoost !== undefined || bassBoost !== undefined || voiceBoost !== undefined
        ? { volumeBoost, bassBoost, voiceBoost }
        : undefined;
    const pipeline = await ensurePipeline(streamId, { gain, eq, controls });
    if (gain !== undefined) {
      pipeline.updateGain(gain);
    }
    if (controls && pipeline.updateControls) {
      pipeline.updateControls(controls);
    }
    if (eq && validateEQArray(eq) && pipeline.updateEQAll) {
      pipeline.updateEQAll(eq);
    }
    markActive(streamId);
    return { ok: true, gain };
  });
  register('updateControls', async ({ streamId, controls }) => {
    const pipeline = getPipeline(streamId);
    if (!pipeline) {
      throw new Error('Pipeline not initialized');
    }
    if (controls && pipeline.updateControls) {
      pipeline.updateControls(controls);
      markActive(streamId);
      return { ok: true };
    }
    return { ok: false, error: 'Invalid controls payload' };
  });

  register('updateEQ', async ({ streamId, eq, index, value }) => {
    const pipeline = getPipeline(streamId);
    if (!pipeline) {
      throw new Error('Pipeline not initialized');
    }
    if (Array.isArray(eq) && validateEQArray(eq) && pipeline.updateEQAll) {
      pipeline.updateEQAll(eq);
      markActive(streamId);
      return { ok: true, mode: 'all' };
    }
    if (typeof index === 'number' && typeof value === 'number' && pipeline.updateEQBand) {
      pipeline.updateEQBand(index, value);
      markActive(streamId);
      return { ok: true, mode: 'single', index };
    }
    return { ok: false, error: 'Invalid EQ update payload' };
  });

  register('closeContext', async ({ streamId }) => {
    const pipeline = getPipeline(streamId);
    if (!pipeline) { return { ok: true, skipped: true }; }
    if (pipeline?.nodes?.effects?._stepFn && scheduler) {
      try { scheduler.remove(pipeline.nodes.effects._stepFn); } catch {}
      delete pipeline.nodes.effects._stepFn;
    }
    safeCloseContext(pipeline);
    deletePipeline(streamId);
    return { ok: true };
  });

  register('closeAllContexts', async () => {
    const ids = (await import('./stateRegistry.js')).listPipelines();
    for (const id of ids) {
      const pipeline = getPipeline(id);
      if (!pipeline) { continue; }
      if (pipeline?.nodes?.effects?._stepFn && scheduler) {
        try { scheduler.remove(pipeline.nodes.effects._stepFn); } catch {}
        delete pipeline.nodes.effects._stepFn;
      }
      safeCloseContext(pipeline);
      deletePipeline(id);
    }
    return { ok: true, closed: ids.length };
  });

  register('toggleEffect', async ({ streamId, name, active }) => {
    const pipeline = getPipeline(streamId);
    if (!pipeline || !pipeline.setEffectActive) {
      throw new Error('Pipeline not initialized');
    }
    pipeline.setEffectActive(name, active);
    markActive(streamId);
    return { ok: true };
  });

  register('updateEffectParams', async ({ streamId, name, params }) => {
    const pipeline = getPipeline(streamId);
    if (!pipeline || !pipeline.updateEffectParams) {
      throw new Error('Pipeline not initialized');
    }
    pipeline.updateEffectParams(name, params || {});
    markActive(streamId);
    return { ok: true };
  });

  // Phase 8: analyser-backed status with fallback to lastActive heuristic
  register('requestStatus', async ({ streamId }) => {
    const rec = activityMap.get(streamId);
    const now = performance.now();
    const lastActive = rec?.lastActive || 0;
    let rms = 0;
    const pipeline = getPipeline(streamId);
    if (pipeline && typeof pipeline.getRMS === 'function') {
      try {
        rms = pipeline.getRMS();
      } catch {
        rms = 0;
      }
    }
    // Thresholds: -60dBFS ~= 0.001, -50dBFS ~= 0.003
    const audioByRMS = rms > 0.0025;
    const audioByRecent = now - lastActive < 5000;
    const audioActive = audioByRMS || audioByRecent;
    return { ok: true, audioActive, lastActive, rms };
  });
}
