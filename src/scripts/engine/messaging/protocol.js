export const EVENTS = Object.freeze([
  'initPipeline',
  'applySettings',
  'updateEQ',
  'updateControls',
  'toggleEffect',
  'updateEffectParams',
  'closeContext',
  'resolveActiveStreamId',
  'hasPipeline',
  'closeAllContexts',
]);

export function isValidEvent(event) {
  return EVENTS.includes(event);
}
