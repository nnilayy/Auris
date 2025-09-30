// antiDistortion.js (Phase 4)
// Simple compressor + limiter chain to mitigate clipping at high boosts.

export function createAntiDistortion(context) {
  const compressor = context.createDynamicsCompressor();
  const limiter = context.createDynamicsCompressor();
  const shaper = context.createWaveShaper();
  // Post-dynamics makeup gain (allows cleaner loudness after controlled peaks)
  const makeupGain = context.createGain();
  makeupGain.gain.value = 1;
  // Pre-trim low shelf to control infra/sub energy BEFORE compression
  const preLowTrim = context.createBiquadFilter();
  preLowTrim.type = 'lowshelf';
  preLowTrim.frequency.value = 55; // below primary bass punch (center ~60-80Hz), still tames boom
  preLowTrim.gain.value = 0;
  // Post restore low shelf to re-inject musical bass AFTER control
  const bassRestore = context.createBiquadFilter();
  bassRestore.type = 'lowshelf';
  bassRestore.frequency.value = 80; // punch region
  bassRestore.gain.value = 0;

  // Presence clarity shelf (adds air after heavy dynamics so loudness feels cleaner)
  const presenceShelf = context.createBiquadFilter();
  presenceShelf.type = 'highshelf';
  presenceShelf.frequency.value = 4800;
  presenceShelf.gain.value = 0;

  // Final gain stage (clean loudness after shaping)
  const finalGain = context.createGain();
  finalGain.gain.value = 1;

  // Parallel punch enhancement path (restores transient mid-bass energy for thump)
  const punchHP = context.createBiquadFilter();
  punchHP.type = 'highpass';
  punchHP.frequency.value = 50; // clear sub rumble
  const punchPeak = context.createBiquadFilter();
  punchPeak.type = 'peaking';
  punchPeak.frequency.value = 80; // main thump center
  punchPeak.Q.value = 1.0;
  punchPeak.gain.value = 0;
  const punchGain = context.createGain();
  punchGain.gain.value = 0; // mix amount (0..~0.65)

  // Base tuned profile (always-on dynamics)
  function setBase() {
    // Baseline: moderate compression, leave some punch (slightly slower attack)
    compressor.threshold.value = -6;
    compressor.knee.value = 10;
    compressor.ratio.value = 6;
    compressor.attack.value = 0.003; // allow leading transient edge
    compressor.release.value = 0.12;

    limiter.threshold.value = -0.7; // tiny bit more headroom buffer
    limiter.knee.value = 1;
    limiter.ratio.value = 14; // slightly softer than 20:1
    limiter.attack.value = 0.001; // still fast but not ultra-snap
    limiter.release.value = 0.06;
  }

  // Older tuned base values ("felt better" profile)
  function setTunedCompressor(
    threshold = -6,
    knee = 10,
    ratio = 6,
    attack = 0.003,
    release = 0.12
  ) {
    compressor.threshold.value = threshold;
    compressor.knee.value = knee;
    compressor.ratio.value = ratio;
    compressor.attack.value = attack;
    compressor.release.value = release;
  }
  function setLimiter(
    threshold = -0.7,
    knee = 1,
    ratio = 14,
    attack = 0.001,
    release = 0.06
  ) {
    limiter.threshold.value = threshold;
    limiter.knee.value = knee;
    limiter.ratio.value = ratio;
    limiter.attack.value = attack;
    limiter.release.value = release;
  }

  function createSoftClippingCurve() {
    const samples = 44100;
    const curve = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      if (Math.abs(x) < 0.5) {
        curve[i] = x;
      } else {
        const sign = Math.sign(x);
        const ax = Math.abs(x);
        const compressed = 1.5 * ax - 0.5 * Math.pow(ax, 3);
        curve[i] = sign * Math.min(compressed, 0.9);
      }
    }
    return curve;
  }

  // Wiring (new): preLowTrim -> compressor -> [optional shaper] -> limiter -> makeupGain -> bassRestore -> presenceShelf -> finalGain
  // Parallel: preLowTrim -> punchHP -> punchPeak -> punchGain -> (sums into makeupGain)
  let shaperActive = false;
  function updateConnections() {
    try { preLowTrim.disconnect(); } catch {}
    try { compressor.disconnect(); } catch {}
    try {
      shaper.disconnect();
    } catch {}
    if (shaperActive) {
      preLowTrim.connect(compressor);
      compressor.connect(shaper);
      shaper.connect(limiter);
    } else {
      preLowTrim.connect(compressor);
      compressor.connect(limiter);
    }
    try {
      limiter.disconnect();
    } catch {}
    limiter.connect(makeupGain);
    try { makeupGain.disconnect(); } catch {}
  makeupGain.connect(bassRestore);
  try { bassRestore.disconnect(); } catch {}
  bassRestore.connect(presenceShelf);
  try { presenceShelf.disconnect(); } catch {}
  presenceShelf.connect(finalGain);

    // Rebuild punch parallel path
    try { punchHP.disconnect(); } catch {}
    try { punchPeak.disconnect(); } catch {}
    try { punchGain.disconnect(); } catch {}
    preLowTrim.connect(punchHP);
    punchHP.connect(punchPeak);
    punchPeak.connect(punchGain);
    punchGain.connect(makeupGain); // sum before restore shelf so restore still shapes composite
  }

  setBase();
  updateConnections();

  function calibrate({ volumeBoost, bassBoost }) {
    const x = typeof volumeBoost === 'number' ? Math.max(1, volumeBoost / 100) : 1;
    const bassDb = typeof bassBoost === 'number' ? bassBoost : 0;
    const bassHeavy = bassDb >= 10;
    const loudIntensity = Math.min((x - 1) / 7, 1);
    const bassNorm = Math.max(0, Math.min(1, bassDb / 20));

    let trimGain = 0;
    let restoreGain = 0;
    if (bassDb > 0) {
      trimGain = -Math.min(8, bassDb * (0.32 + 0.14 * loudIntensity));
      restoreGain = Math.min(10, bassDb * (0.48 - 0.18 * loudIntensity));
      if (restoreGain < 0) {
        restoreGain = 0;
      }
    } else if (loudIntensity > 0) {
      trimGain = -loudIntensity * 1.5;
    }

    let punchMix = Math.min(0.4, bassNorm * 0.35 + loudIntensity * 0.2);
    if (loudIntensity > 0.75) {
      punchMix *= 0.85;
    }

    let makeupTarget = 1.0;

    if (x <= 2) {
      setTunedCompressor(-6, 10, 4.8, 0.004, 0.12);
      setLimiter(-0.9, 1, 11, 0.001, 0.06);
      shaperActive = false;
      makeupTarget = 1.03;
    } else if (x <= 4) {
      setTunedCompressor(bassHeavy ? -7.5 : -8.5, 9, bassHeavy ? 6 : 6.5, 0.0036, 0.14);
      setLimiter(-0.85, 1, 12.5, 0.001, 0.065);
      shaperActive = false;
      makeupTarget = bassHeavy ? 1.06 : 1.08;
    } else if (x <= 6) {
      setTunedCompressor(bassHeavy ? -8.8 : -9.5, 8, bassHeavy ? 7.5 : 8.2, 0.0033, 0.18);
      setLimiter(-0.95, 1, 15, 0.001, 0.075);
      if (x > 5.2) {
        shaper.curve = createSoftClippingCurve();
        shaper.oversample = '4x';
        shaperActive = true;
      } else {
        shaperActive = false;
      }
      makeupTarget = bassHeavy ? 1.08 : 1.1;
    } else {
      setTunedCompressor(bassHeavy ? -9.5 : -10.5, 7, bassHeavy ? 8 : 8.8, 0.0035, 0.22);
      setLimiter(-1.25, 0.8, 18, 0.001, 0.09);
      shaperActive = false;
      makeupTarget = bassHeavy ? 1.05 : 1.08;
      punchMix = Math.min(punchMix, 0.32);
    }

    try {
      makeupGain.gain.setTargetAtTime(makeupTarget, context.currentTime, 0.08);
    } catch {
      makeupGain.gain.value = makeupTarget;
    }

    let presence = loudIntensity * 4;
    if (presence > 4.5) {
      presence = 4.5;
    }
    if (bassHeavy) {
      presence *= 0.8;
    }
    if (x >= 6.5) {
      presence *= 0.75;
    }
    try {
      presenceShelf.gain.setTargetAtTime(presence, context.currentTime, 0.15);
    } catch {
      presenceShelf.gain.value = presence;
    }

    let finalTarget = 1 + loudIntensity * 0.32;
    if (finalTarget > 1.35) {
      finalTarget = 1.35;
    }
    if (shaperActive) {
      finalTarget *= 0.92;
    }
    if (bassHeavy) {
      finalTarget *= 0.92;
    }
    try {
      finalGain.gain.setTargetAtTime(finalTarget, context.currentTime, 0.12);
    } catch {
      finalGain.gain.value = finalTarget;
    }

    try {
      preLowTrim.gain.setTargetAtTime(trimGain, context.currentTime, 0.08);
    } catch {
      preLowTrim.gain.value = trimGain;
    }
    try {
      bassRestore.gain.setTargetAtTime(restoreGain, context.currentTime, 0.12);
    } catch {
      bassRestore.gain.value = restoreGain;
    }

    const peakGainDb = punchMix * 12;
    try {
      punchPeak.gain.setTargetAtTime(peakGainDb, context.currentTime, 0.05);
    } catch {
      punchPeak.gain.value = peakGainDb;
    }
    try {
      punchGain.gain.setTargetAtTime(punchMix, context.currentTime, 0.05);
    } catch {
      punchGain.gain.value = punchMix;
    }

    updateConnections();
  }
  return {
    input: preLowTrim,
    output: finalGain,
    nodes: { compressor, limiter, shaper, makeupGain, preLowTrim, bassRestore, presenceShelf, finalGain, punchHP, punchPeak, punchGain },
    calibrate,
  };
}

