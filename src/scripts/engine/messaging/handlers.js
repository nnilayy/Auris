import { isValidEvent } from './protocol.js';
import { initEngineMessaging } from '../core/engineBootstrap.js';

const registry = new Map();

export function registerHandler(event, fn) {
  if (!isValidEvent(event)) {
    console.warn('[Auris Offscreen] Attempt to register invalid event', event);
    return;
  }
  registry.set(event, fn);
}

export function initHandlers() {
  initEngineMessaging((event, fn) => registerHandler(event, fn));
}

export async function dispatch(event, payload) {
  if (!isValidEvent(event)) {
    throw new Error('Invalid event: ' + event);
  }
  const fn = registry.get(event);
  if (!fn) {
    throw new Error('No handler for: ' + event);
  }
  return await fn(payload || {});
}
