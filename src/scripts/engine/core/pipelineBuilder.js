// pipelineBuilder.js (Phase 5)
// Order: source -> controls (sub/bass/voice) -> EQ -> compressor -> limiter -> effects mixer -> masterGain -> destination

import { createEQ } from '../dsp/equalizer.js';
import { createControls } from '../dsp/controls.js';
import { createAntiDistortion } from '../dsp/antiDistortion.js';
import { createEffectsMixer } from '../dsp/effects/mixer.js';

export function buildPipeline({ stream, initialGain = 1.0, eqArray, controlsSettings }) {

  const context = new AudioContext();

  const source = context.createMediaStreamSource(stream);

  // Controls (bass, voice, volume pre-stage)
  const controls = createControls(context);
  if (controlsSettings) {
    controls.applyControls(controlsSettings);
  }

  // EQ
  const eq = createEQ(context);
  if (Array.isArray(eqArray)) {
    try {
      eq.setAll(eqArray);
    } catch {}
  }

  // Anti-distortion (compressor + limiter)
  const anti = createAntiDistortion(context);
  if (controlsSettings) {
    try {
      anti.calibrate(controlsSettings);
    } catch {}
  }

  // Effects mixer (all effects always connected; internal active flags decide processing footprint)
  const effects = createEffectsMixer(context);

  // Master gain node
  const masterGain = context.createGain();
  masterGain.gain.value = Math.max(0, initialGain);

  // Wiring chain
  source.connect(controls.input);
  controls.output.connect(eq.input);
  eq.output.connect(anti.input);
  anti.output.connect(effects.input);

  // Analyser for telemetry (Phase 8)
  const analyser = context.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.8;

  effects.output.connect(masterGain).connect(context.destination);
  masterGain.connect(analyser);

  const buffer = new Float32Array(analyser.fftSize);

  function getRMS() {
    try {
      analyser.getFloatTimeDomainData(buffer);
      let sum = 0;
      for (let i = 0; i < buffer.length; i++) {
        const v = buffer[i];
        sum += v * v;
      }
      return Math.sqrt(sum / buffer.length);
    } catch (_) {
      return 0;
    }
  }

  return {
    context,
    nodes: { source, controls, eq, anti, effects, masterGain, analyser },
    updateGain(value) {
      const gain = Math.max(0, value);
      try {
        masterGain.gain.setTargetAtTime(gain, context.currentTime, 0.05);
      } catch {
        masterGain.gain.value = gain;
      }
    },
    updateEQBand(index, gain) {
      eq.setBand(index, gain);
    },
    updateEQAll(gains) {
      eq.setAll(gains);
    },
    updateControls(payload) {
      controls.applyControls(payload);
      anti.calibrate(payload);
    },
    setEffectActive(name, active) {
      effects.setEffectActive(name, active);
    },
    updateEffectParams(name, params) {
      effects.updateEffectParams(name, params);
    },
    getEffectsNodes() {
      return effects.nodes;
    },
    getRMS,
  };
}
