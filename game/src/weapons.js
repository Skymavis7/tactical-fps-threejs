// Weapons: the numbers and the view models. Four guns with distinct damage, fire rate,
// spread and recoil, plus two grenades. main.js owns the ray and the damage; this module
// owns magazines, reloads, spread, view models and muzzle flash.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'Kestrel P9', price: 0, damage: 34, headMult: 4,
    mag: 12, reserve: 36, fireGap: 0.14, auto: false, reloadTime: 1.4,
    spreadStill: 0.004, spreadMove: 0.02, recoil: 0.011, range: 80, adsFov: 60,
  },
  smg: {
    id: 'smg', name: 'Hornet SMG', price: 1400, damage: 26, headMult: 4,
    mag: 24, reserve: 96, fireGap: 0.075, auto: true, reloadTime: 1.8,
    spreadStill: 0.008, spreadMove: 0.03, recoil: 0.008, range: 60, adsFov: 62,
  },
  rifle: {
    id: 'rifle', name: 'Falcon AR-7', price: 2700, damage: 34, headMult: 4,
    mag: 30, reserve: 90, fireGap: 0.1, auto: true, reloadTime: 1.9,
    spreadStill: 0.0022, spreadMove: 0.028, recoil: 0.012, range: 90, adsFov: 55,
  },
  dmr: {
    id: 'dmr', name: 'Longbow DMR', price: 4750, damage: 88, headMult: 4,
    mag: 5, reserve: 15, fireGap: 0.9, auto: false, reloadTime: 2.6,
    spreadStill: 0.001, spreadMove: 0.02, recoil: 0.03, range: 120, adsFov: 40,
  },
};

export const GRENADES = {
  frag: { id: 'frag', name: 'Surge Frag', price: 300, damage: 120, radius: 6, fuse: 1.6 },
  smoke: { id: 'smoke', name: 'Drift Smoke', price: 300, duration: 12, radius: 4.5 },
};

function buildViewModel(def) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.55, metalness: 0.2 });
  const group = new THREE.Group();
  const add = (w, h, d, x, y, z, material = body) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  };
  if (def.id === 'pistol') {
    add(0.06, 0.09, 0.2, 0, 0, -0.1);
    add(0.05, 0.12, 0.06, 0, -0.09, 0.02, grip);
    add(0.02, 0.02, 0.02, 0, 0.055, -0.18, accent);
  } else if (def.id === 'smg') {
    add(0.08, 0.1, 0.34, 0, 0, -0.08);
    add(0.04, 0.04, 0.26, 0, 0.02, -0.32, grip);
    add(0.05, 0.12, 0.05, 0, -0.1, 0.06, grip);
    add(0.06, 0.05, 0.12, 0, 0.02, -0.12, accent);
  } else if (def.id === 'rifle') {
    add(0.09, 0.1, 0.42, 0, 0, -0.1);
    add(0.045, 0.045, 0.4, 0, 0.025, -0.46, grip);
    add(0.075, 0.08, 0.22, 0, -0.02, 0.22, grip);
    add(0.05, 0.14, 0.05, 0, -0.11, -0.02, grip);
    add(0.03, 0.03, 0.1, 0, 0.07, -0.2, accent);
  } else {
    // DMR: long barrel, scope, bipod hint.
    add(0.09, 0.11, 0.5, 0, 0, -0.14);
    add(0.04, 0.04, 0.55, 0, 0.03, -0.62, grip);
    add(0.07, 0.07, 0.2, 0, -0.02, 0.24, grip);
    add(0.05, 0.06, 0.22, 0, 0.09, -0.2, accent);
    add(0.04, 0.1, 0.04, 0.02, -0.08, -0.3, grip);
    add(0.04, 0.1, 0.04, -0.02, -0.08, -0.3, grip);
  }
  return group;
}

export function createWeaponSet(camera) {
  const models = {};
  for (const def of Object.values(WEAPONS)) {
    const model = buildViewModel(def);
    model.position.set(0.22, -0.19, -0.46);
    model.scale.setScalar(0.88);
    model.visible = false;
    camera.add(model);
    models[def.id] = model;
  }
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.22, -0.17, -0.98);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.22, -0.15, -0.62);
  camera.add(flashLight);

  const owned = {
    pistol: { mag: WEAPONS.pistol.mag, reserve: WEAPONS.pistol.reserve, reloadLeft: 0, cooldown: 0 },
  };
  let current = 'pistol';
  let flashLeft = 0;
  let kick = 0;
  let ads = 0; // 0 hip, 1 aimed

  models.pistol.visible = true;

  function def() {
    return WEAPONS[current];
  }
  function state() {
    return owned[current];
  }

  function step(dt, aiming) {
    const target = aiming ? 1 : 0;
    ads += (target - ads) * Math.min(1, dt * 12);
    const st = state();
    st.cooldown = Math.max(0, st.cooldown - dt);
    flashLeft = Math.max(0, flashLeft - dt);
    kick += (0 - kick) * Math.min(1, dt * 14);
    const model = models[current];
    model.position.set(0.22 * (1 - ads), -0.19 + ads * 0.06, -0.46 + ads * 0.12 + kick);
    model.rotation.x = kick * 2.2;
    if (st.reloadLeft > 0) {
      st.reloadLeft = Math.max(0, st.reloadLeft - dt);
      model.rotation.x = -0.55 * Math.min(1, (def().reloadTime - st.reloadLeft) * 2);
      if (st.reloadLeft === 0) {
        const need = def().mag - st.mag;
        const take = Math.min(need, st.reserve);
        st.mag += take;
        st.reserve -= take;
      }
    }
    flash.visible = flashLeft > 0;
    flash.rotation.z = flashLeft * 30;
    flashLight.intensity = flashLeft > 0 ? 18 : 0;
  }

  return {
    def,
    state,
    get current() {
      return current;
    },
    get adsAmount() {
      return ads;
    },
    ownedIds() {
      return Object.keys(owned);
    },
    has(id) {
      return Boolean(owned[id]);
    },
    buy(id) {
      if (owned[id]) return false;
      owned[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve, reloadLeft: 0, cooldown: 0 };
      return true;
    },
    switchTo(id) {
      if (!owned[id] || id === current) return false;
      models[current].visible = false;
      current = id;
      models[current].visible = true;
      return true;
    },
    ready() {
      const st = state();
      return st.mag > 0 && st.cooldown === 0 && st.reloadLeft === 0;
    },
    canFire() {
      return state().mag > 0 && state().cooldown === 0 && state().reloadLeft === 0;
    },
    pullTrigger() {
      const st = state();
      st.cooldown = def().fireGap;
      flashLeft = 0.06;
      kick = 0.055;
    },
    takeRound() {
      if (state().mag <= 0) return false;
      state().mag -= 1;
      return true;
    },
    reload() {
      const st = state();
      if (st.reloadLeft > 0 || st.mag === def().mag || st.reserve === 0) return false;
      st.reloadLeft = def().reloadTime;
      return true;
    },
    refillAll() {
      for (const [id, st] of Object.entries(owned)) {
        st.mag = WEAPONS[id].mag;
        st.reserve = WEAPONS[id].reserve;
        st.reloadLeft = 0;
        st.cooldown = 0;
      }
    },
    spread(speed) {
      const d = def();
      const moving = Math.min(1, speed / 4.6);
      const base = d.spreadStill + moving * d.spreadMove;
      return base * (1 - ads * 0.55);
    },
    step,
  };
}
