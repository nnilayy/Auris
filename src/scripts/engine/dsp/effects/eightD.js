// eightD.js (Phase 5)
// Simulates 8D audio by orbiting a StereoPannerNode around the listener.

export function createEightDEffect(context) {
  if (typeof context.createStereoPanner !== 'function') {
    throw new Error('StereoPannerNode is required for 8D effect');
  }

  const input = context.createGain();
  const panner = context.createStereoPanner();
  const output = context.createGain();

  input.connect(panner).connect(output);

  const lfoGain = context.createGain();
  lfoGain.gain.value = 0;
  lfoGain.connect(panner.pan);

  let lfo = null;
  let speedSec = 3;
  let active = false;

  function clampSpeed(seconds) {
    return typeof seconds === 'number' && seconds > 0.25 ? seconds : speedSec;
  }

  function currentFrequency() {
    return 1 / Math.max(0.25, speedSec);
  }

  function applyPan(value) {
    const pan = Math.max(-1, Math.min(1, value));
    try {
      panner.pan.cancelScheduledValues(context.currentTime);
      panner.pan.setValueAtTime(pan, context.currentTime);
    } catch {
      panner.pan.value = pan;
    }
  }

  function startLfo() {
    if (lfo) {
      return;
    }
    const osc = context.createOscillator();
    osc.type = 'sine';
    const freq = currentFrequency();
    try {
      osc.frequency.setValueAtTime(freq, context.currentTime);
    } catch {
      osc.frequency.value = freq;
    }
    osc.connect(lfoGain);
    osc.start();
    osc.onended = () => {
      try { osc.disconnect(); } catch {}
      if (lfo === osc) {
        lfo = null;
      }
    };
    lfo = osc;
  }

  function stopLfo() {
    const osc = lfo;
    if (!osc) {
      return;
    }
    lfo = null;
    try { osc.disconnect(); } catch {}
    try { osc.stop(); } catch {}
  }

  function updateLfoFrequency() {
    if (!lfo) {
      return;
    }
    const freq = currentFrequency();
    try {
      lfo.frequency.setTargetAtTime(freq, context.currentTime, 0.05);
    } catch {
      lfo.frequency.value = freq;
    }
  }

  function setSpeed(seconds) {
    speedSec = clampSpeed(seconds);
    updateLfoFrequency();
  }

  function setActive(flag) {
    const next = !!flag;
    if (next === active) {
      return;
    }
    active = next;
    const now = context.currentTime;
    lfoGain.gain.cancelScheduledValues(now);

    if (next) {
      startLfo();
      applyPan(0);
      lfoGain.gain.setValueAtTime(0, now);
      lfoGain.gain.linearRampToValueAtTime(1, now + 0.02);
    } else {
      lfoGain.gain.setValueAtTime(0, now);
      stopLfo();
      applyPan(0);
    }
  }

  function step() {
    // Oscillator drives panning internally; no per-frame work required.
  }

  applyPan(0);
  updateLfoFrequency();

  return {
    input,
    output,
    nodes: { panner, lfoGain },
    setSpeed,
    setActive,
    step,
    isActive: () => active,
  };
}
