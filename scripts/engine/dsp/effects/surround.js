// surround.js (Phase 5)
// Simple stereo widening via ChannelSplitter/ChannelMerger + delay offset.

export function createSurroundEffect(context) {
  const splitter = context.createChannelSplitter(2);
  const merger = context.createChannelMerger(2);
  const leftDelay = context.createDelay();
  const rightDelay = context.createDelay();
  leftDelay.delayTime.value = 0.0;
  rightDelay.delayTime.value = 0.0;

  let depth = 0; // 0..100
  let active = false;

  function applyDepth(value) {
    depth = Math.min(100, Math.max(0, value || 0));
    const maxOffset = 0.012; // 12ms
    const offset = (depth / 100) * maxOffset;
    if (active) {
      leftDelay.delayTime.setValueAtTime(offset, context.currentTime);
      rightDelay.delayTime.setValueAtTime(0, context.currentTime);
    }
  }

  function setActive(flag) {
    const next = !!flag;
    active = next;
    if (!active) {
      // Hard bypass: zero delays for pass-through
      leftDelay.delayTime.setValueAtTime(0, context.currentTime);
      rightDelay.delayTime.setValueAtTime(0, context.currentTime);
    } else {
      // Re-apply current depth settings
      const maxOffset = 0.012;
      const offset = (depth / 100) * maxOffset;
      leftDelay.delayTime.setValueAtTime(offset, context.currentTime);
      rightDelay.delayTime.setValueAtTime(0, context.currentTime);
    }
  }

  splitter.connect(leftDelay, 0);
  splitter.connect(rightDelay, 1);
  leftDelay.connect(merger, 0, 0);
  rightDelay.connect(merger, 0, 1);

  return {
    input: splitter,
    output: merger,
    nodes: { splitter, merger, leftDelay, rightDelay },
    applyDepth,
    setActive,
    isActive: () => active,
  };
}
