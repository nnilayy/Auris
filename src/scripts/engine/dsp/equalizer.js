// equalizer.js (Phase 3)
// 10-band equalizer factory and update helpers.

const FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export function createEQ(context) {
  const filters = FREQUENCIES.map((freq, i) => {
    const f = context.createBiquadFilter();
    f.type = i === 0 ? 'lowshelf' : i === FREQUENCIES.length - 1 ? 'highshelf' : 'peaking';
    f.frequency.value = freq;
    f.gain.value = 0;
    if (f.type === 'peaking') {
      f.Q.value = 1.1; // moderate width
    }
    return f;
  });
  // Chain them in series
  for (let i = 0; i < filters.length - 1; i++) {
    filters[i].connect(filters[i + 1]);
  }
  return {
    input: filters[0],
    output: filters[filters.length - 1],
    filters,
    setBand(index, gain) {
      if (filters[index]) {
        try {
          filters[index].gain.setTargetAtTime(gain, context.currentTime, 0.03);
        } catch {
          filters[index].gain.value = gain;
        }
      }
    },
    setAll(gains) {
      gains.forEach((g, i) => this.setBand(i, g));
    },
  };
}

export function validateEQArray(arr) {
  return (
    Array.isArray(arr) &&
    arr.length === FREQUENCIES.length &&
    arr.every((v) => typeof v === 'number')
  );
}

export { FREQUENCIES };
