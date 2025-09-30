// controls.js (Phase 4)
// Provides bass/sub/voice shaping and gain staging (preGain + volumeGain).

export function createControls(context) {
  // Sub-bass peaking filter (~40Hz)
  const subBassFilter = context.createBiquadFilter();
  subBassFilter.type = 'peaking';
  subBassFilter.frequency.value = 40;
  subBassFilter.Q.value = 2.0; // tuned Q
  subBassFilter.gain.value = 0;


  // Bass shelf (~100Hz)
  const bassFilter = context.createBiquadFilter();
  bassFilter.type = 'lowshelf';
  bassFilter.frequency.value = 100;
  bassFilter.gain.value = 0;


  // Voice presence peak (~1kHz)
  const voiceFilter = context.createBiquadFilter();
  voiceFilter.type = 'peaking';
  voiceFilter.frequency.value = 1000;
  voiceFilter.Q.value = 1.2;
  voiceFilter.gain.value = 0;

  const preGain = context.createGain(); // Used before heavy processing (later for compressor input calibration)
  preGain.gain.value = 1;

  const volumeGain = context.createGain(); // User volume boost (main visible control)
  volumeGain.gain.value = 1;

  // Wire chain: subBass -> bass -> voice -> preGain -> volumeGain
  subBassFilter.connect(bassFilter);
  bassFilter.connect(voiceFilter);
  voiceFilter.connect(preGain);
  preGain.connect(volumeGain);

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function calculateGainStaging(totalBoost) {
    // Distribute volume boost between pre- and post-stage gains.
    if (totalBoost <= 2.0) {
      return { preGain: 1.0, mainGain: totalBoost };
    }
    if (totalBoost <= 4.0) {
      const pg = Math.min(1.3, Math.sqrt(totalBoost * 0.85));
      return { preGain: pg, mainGain: totalBoost / pg };
    }
    if (totalBoost <= 6.0) {
      const pg = 1.5;
      return { preGain: pg, mainGain: totalBoost / pg };
    }
    const ratio = Math.min((totalBoost - 6) / 2, 1); // 0..1 over 6->8
    const pg = 1.4 - 0.3 * ratio; // 1.4 -> 1.1
    return { preGain: pg, mainGain: totalBoost / pg };
  }
  function applyControls({ volumeBoost, bassBoost, voiceBoost }) {
    // Bass/Voice clamps: bass up to ??20 dB, voice ??12 dB
    let appliedBassDb = 0;
    if (typeof bassBoost === 'number') {
      const bass = clamp(bassBoost, -20, 20);
      appliedBassDb = bass;
      try {
        bassFilter.gain.setTargetAtTime(bass, context.currentTime, 0.05);
      } catch {
        bassFilter.gain.value = bass;
      }
      // Dynamic sub scaling: keep sub region slightly under main bass to avoid mud
  // Allow a little more sub now that preLowTrim + bassRestore manage clarity
  const subScale = bass >= 12 ? 0.72 : bass >= 8 ? 0.78 : 0.82;
      let sub = bass * subScale;
      // Hard cap sub boost to prevent excessive 40Hz energy
      if (sub > 12) {
        sub = 12;
      }
      try {
        subBassFilter.gain.setTargetAtTime(sub, context.currentTime, 0.05);
      } catch {
        subBassFilter.gain.value = sub;
      }
    }
    if (typeof voiceBoost === 'number') {
      const voice = clamp(voiceBoost, -12, 12);
      try {
        voiceFilter.gain.setTargetAtTime(voice, context.currentTime, 0.05);
      } catch {
        voiceFilter.gain.value = voice;
      }
    }
    if (typeof volumeBoost === 'number') {
      // Clamp: 100%..800% (1x..8x)
      const clamped = clamp(volumeBoost, 100, 800);
      const totalBoost = clamped / 100; // factor
      const { preGain: pg, mainGain: mg } = calculateGainStaging(totalBoost);
      // Headroom logic: if bass elevated reduce preGain; if NO bass boost but extremely high loudness also trim a bit to avoid low build pumping.
      let bassLoadFactor = appliedBassDb >= 12 ? 0.85 : appliedBassDb >= 8 ? 0.92 : 1.0;
      if (appliedBassDb <= 0 && totalBoost >= 6) {
        // Light headroom reserve for un-boosted bass to prevent natural low-end from over-triggering dynamics.
        const extra = Math.min((totalBoost - 6) / 2, 1) * 0.06; // up to 6% reduction
        bassLoadFactor *= (1 - extra);
      }
      const adjustedPre = pg * bassLoadFactor;
      try {
        preGain.gain.setTargetAtTime(adjustedPre, context.currentTime, 0.02);
      } catch {
        preGain.gain.value = adjustedPre;
      }
      try {
        volumeGain.gain.setTargetAtTime(mg, context.currentTime, 0.02);
      } catch {
        volumeGain.gain.value = mg;
      }
      // Gentle psychoacoustic clarity tweaks at extreme boosts: tame deep sub build-up slightly
      if (totalBoost > 4) {
        try {
          const compensatedBass = Math.min(bassFilter.gain.value, 18); // ensure not boosting harder
          // Apply a slight -1 dB dynamic trim if extreme to keep compressor from over-triggering
          if (compensatedBass > 10) {
            bassFilter.gain.setTargetAtTime(compensatedBass - 1, context.currentTime, 0.1);
          }
        } catch {}
      }
    }
  }

  return {
    input: subBassFilter,
    output: volumeGain,
    nodes: { subBassFilter, bassFilter, voiceFilter, preGain, volumeGain },
    applyControls,
  };
}

