const ENGINE_MODES = Object.freeze({
  legacy: 'legacy',
  capture: 'capture',
});

let currentEngineMode = ENGINE_MODES.capture;

export function getEngineMode() {
  return currentEngineMode;
}

export function setEngineMode(mode) {
  if (mode in ENGINE_MODES || Object.values(ENGINE_MODES).includes(mode)) {
    currentEngineMode = mode;
  } else {
    console.warn('[Auris][featureFlags] Invalid engine mode:', mode);
  }
}

export function isCaptureEnabled() {
  return getEngineMode() === ENGINE_MODES.capture;
}

export function listEngineModes() {
  return { ...ENGINE_MODES };
}
