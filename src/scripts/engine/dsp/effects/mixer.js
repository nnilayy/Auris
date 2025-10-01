import { createEightDEffect } from './eightD.js';
import { createSurroundEffect } from './surround.js';
import { createEchoEffect } from './echo.js';

const CROSSFADE_SEC = 0.08;

function setImmediate(node, value, when) {
  node.gain.cancelScheduledValues(when);
  node.gain.setValueAtTime(value, when);
}

export function createEffectsMixer(context) {
  const effectsBusIn = context.createGain();
  const dryGain = context.createGain();
  const wetGain = context.createGain();
  const effectsBusOut = context.createGain();

  dryGain.gain.value = 1;
  wetGain.gain.value = 0;

  effectsBusIn.connect(dryGain);
  dryGain.connect(effectsBusOut);
  wetGain.connect(effectsBusOut);

  const eightD = createEightDEffect(context);
  const surround = createSurroundEffect(context);
  const echo = createEchoEffect(context);

  const activeChain = [];

  function disconnectActiveChain() {
    if (activeChain.length === 0) {
      return;
    }
    for (let i = 0; i < activeChain.length; i++) {
      const effect = activeChain[i];
      try {
        effectsBusIn.disconnect(effect.input);
      } catch {}
      try {
        effect.output.disconnect(wetGain);
      } catch {}
      if (i < activeChain.length - 1) {
        try {
          effect.output.disconnect(activeChain[i + 1].input);
        } catch {}
      }
    }
    activeChain.length = 0;
  }

  function buildChain() {
    const chain = [];
    if (eightD.isActive && eightD.isActive()) {
      chain.push(eightD);
    }
    if (surround.isActive && surround.isActive()) {
      chain.push(surround);
    }
    if (echo.isActive && echo.isActive()) {
      chain.push(echo);
    }
    return chain;
  }

  function reconnect() {
    disconnectActiveChain();

    const chain = buildChain();
    const now = context.currentTime;

    if (chain.length === 0) {
      setImmediate(dryGain, 1, now);
      setImmediate(wetGain, 0, now);
      return;
    }

    const hasEightD = chain.includes(eightD);

    setImmediate(wetGain, 0, now);

    effectsBusIn.connect(chain[0].input);
    for (let i = 0; i < chain.length - 1; i++) {
      chain[i].output.connect(chain[i + 1].input);
    }
    chain[chain.length - 1].output.connect(wetGain);
    activeChain.push(...chain);

    dryGain.gain.cancelScheduledValues(now);
    if (hasEightD) {
      dryGain.gain.setValueAtTime(0, now);
    } else {
      dryGain.gain.setValueAtTime(0.9, now);
    }

    const wetRamp = hasEightD ? 0.02 : CROSSFADE_SEC;
    wetGain.gain.linearRampToValueAtTime(1, now + wetRamp);
  }

  function setEffectActive(name, active) {
    switch (name) {
      case 'audio8d':
        eightD.setActive(active);
        reconnect();
        break;
      case 'surround':
        surround.setActive(active);
        reconnect();
        break;
      case 'echo':
        echo.setActive(active);
        reconnect();
        break;
    }
  }

  function updateEffectParams(name, params) {
    if (name === 'audio8d') {
      if (params.speed !== undefined) {
        eightD.setSpeed(params.speed);
      }
    } else if (name === 'surround') {
      if (params.depth !== undefined) {
        surround.applyDepth(params.depth);
      }
    } else if (name === 'echo') {
      if (params.delay !== undefined) {
        echo.setDelaySeconds(params.delay);
      }
      if (params.feedback !== undefined) {
        echo.setFeedback(params.feedback);
      }
      if (params.wet !== undefined) {
        echo.setWet(params.wet);
      }
    }
  }

  function step(deltaMs) {
    eightD.step(deltaMs);
  }

  reconnect();

  return {
    input: effectsBusIn,
    output: effectsBusOut,
    nodes: { eightD, surround, echo, dryGain, wetGain },
    setEffectActive,
    updateEffectParams,
    step,
  };
}
