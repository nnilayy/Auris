// protocol.js (Phase 5)
// Adds effect toggle & params events.

export const EVENTS = Object.freeze([
  'initPipeline',
  'applySettings',
  'updateEQ',
  'updateControls',
  'toggleEffect',
  'updateEffectParams',
  'requestStatus',
  'closeContext',
  'resolveActiveStreamId',
  'hasPipeline',
  'closeAllContexts',
]);

export function isValidEvent(event) {
  return EVENTS.includes(event);
}
