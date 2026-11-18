// Weapons — the arsenal. Every weapon is data: damage, falloff, fire rate,
// magazine, spread, price and sound. Grenades are items, not weapons, but
// live here too so the buy menu and the combat code share one table.

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'Kestrel P9', kind: 'pistol', price: 0,
    damage: 34, headMult: 2.0, range: 42, falloff: 0.45,
    fireRate: 320, auto: false, mag: 12, reserve: Infinity, reload: 1.1,
    spread: 0.011, moveSpread: 0.02, zoom: 1,
    desc: 'Sidearm. Free, always in your kit.',
  },
  smg: {
    id: 'smg', name: 'Hornet SMG', kind: 'smg', price: 1400,
    damage: 24, headMult: 1.8, range: 30, falloff: 0.5,
    fireRate: 780, auto: true, mag: 28, reserve: 112, reload: 1.6,
    spread: 0.02, moveSpread: 0.034, zoom: 1,
    desc: 'Fast close-quarters spray. Shreds at short range.',
  },
  rifle: {
    id: 'rifle', name: 'Falcon AR-7', kind: 'rifle', price: 2700,
    damage: 33, headMult: 2.0, range: 60, falloff: 0.35,
    fireRate: 600, auto: true, mag: 25, reserve: 100, reload: 1.9,
    spread: 0.008, moveSpread: 0.02, zoom: 1.15,
    desc: 'The all-rounder. Accurate, steady, dependable.',
  },
  dmr: {
    id: 'dmr', name: 'Longbow DMR', kind: 'dmr', price: 4750,
    damage: 88, headMult: 2.2, range: 90, falloff: 0.15,
    fireRate: 90, auto: false, mag: 5, reserve: 20, reload: 2.4,
    spread: 0.0015, moveSpread: 0.03, zoom: 2.2,
    desc: 'One-shot headshot at any range. Slow, punishing, precise.',
  },
};

export const WEAPON_ORDER = ['pistol', 'smg', 'rifle', 'dmr'];

export const GRENADES = {
  frag: {
    id: 'frag', name: 'Surge Frag', price: 300, fuse: 1.4,
    radius: 7, damage: 95, falloff: 0.25,
    desc: 'Explodes after a short fuse. Clears corners.',
  },
  smoke: {
    id: 'smoke', name: 'Drift Smoke', price: 300, fuse: 1.1,
    radius: 5.5, duration: 14,
    desc: 'Blooms into a vision-blocking cloud. Cross safely.',
  },
};

// A fresh loadout: pistol owned, everything else to buy.
export function freshLoadout() {
  return {
    owned: { pistol: true, smg: false, rifle: false, dmr: false },
    ammo: { pistol: { mag: 12, reserve: Infinity } },
    grenades: { frag: 0, smoke: 0 },
    current: 'pistol',
  };
}

// Ammo state for a weapon the player just bought (full mag + full reserve).
export function freshAmmo(weapon) {
  return { mag: weapon.mag, reserve: weapon.reserve };
}
