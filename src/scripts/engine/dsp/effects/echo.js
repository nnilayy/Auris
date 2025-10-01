export function createEchoEffect(context) {
  const delay = context.createDelay(5.0);
  delay.delayTime.value = 0.25;
  const feedback = context.createGain();
  feedback.gain.value = 0.3;
  const wet = context.createGain();
  wet.gain.value = 0.0;
  const dry = context.createGain();
  dry.gain.value = 1.0;
  const input = context.createGain();
  const output = context.createGain();

  input.connect(dry).connect(output);
  input.connect(delay);
  delay.connect(feedback).connect(delay);
  delay.connect(wet).connect(output);

  let active = false;
  let wetLevel = 0.5;

  function setActive(flag) {
    active = !!flag;
    const target = active ? wetLevel : 0.0;
    wet.gain.setValueAtTime(target, context.currentTime);
  }
  function setDelaySeconds(sec) {
    if (typeof sec === 'number') {
      delay.delayTime.setValueAtTime(Math.min(5, Math.max(0.05, sec)), context.currentTime);
    }
  }
  function setFeedback(val) {
    if (typeof val === 'number') {
      feedback.gain.setValueAtTime(Math.min(0.95, Math.max(0, val)), context.currentTime);
    }
  }
  function setWet(val) {
    if (typeof val === 'number') {
      wetLevel = Math.min(1, Math.max(0, val));
      if (active) {
        wet.gain.setValueAtTime(wetLevel, context.currentTime);
      }
    }
  }

  return {
    input,
    output,
    nodes: { input, output, delay, feedback, wet, dry },
    setActive,
    setDelaySeconds,
    setFeedback,
    setWet,
    isActive: () => active,
  };
}
