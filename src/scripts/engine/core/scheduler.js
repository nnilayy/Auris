export function createScheduler() {
  let lastTs = performance.now();
  let intervalId = null;
  const listeners = new Set();

  function add(fn) {
    listeners.add(fn);
  }
  function remove(fn) {
    listeners.delete(fn);
  }

  function tick() {
    const now = performance.now();
    const delta = now - lastTs;
    lastTs = now;
    listeners.forEach((fn) => {
      try {
        fn(delta);
      } catch (e) {
        console.warn('[Auris Scheduler] listener error', e);
      }
    });
  }

  function start() {
    if (intervalId) {
      return;
    }
    lastTs = performance.now();
    intervalId = setInterval(tick, 50);
  }

  function stop() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  return { add, remove, start, stop };
}
