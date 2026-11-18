// Deterministic RNG (mulberry32) so a seed replays the same match.
// The game uses one stream for gameplay and one for cosmetics, both seeded
// from the URL (?seed=N) or from Math.random when no seed is given.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(seed) {
  const next = mulberry32(seed);
  return {
    next,
    // float in [min, max)
    range(min, max) { return min + next() * (max - min); },
    // integer in [min, max]
    int(min, max) { return min + Math.floor(next() * (max - min + 1)); },
    // pick one element
    pick(list) { return list[Math.floor(next() * list.length)]; },
    // true with probability p
    chance(p) { return next() < p; },
    // gaussian-ish around 0, roughly in [-1, 1]
    gauss() { return (next() + next() + next() - 1.5) / 1.5; },
  };
}
