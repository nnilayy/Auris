// Feature Flags for Auris engine modes
// Default engineMode is 'capture'. Accessors minimize refactors.

const ENGINE_MODES = Object.freeze({
  legacy: 'legacy',
  capture: 'capture',
});

// Internal mutable state (can be persisted later if needed)
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

// Future TODO (Phase 6): Persist selected mode in chrome.storage.local if user toggle retained.
