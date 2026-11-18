// Combat — hitscan fire, damage falloff and grenades. All hit tests are
// analytic (ray vs axis-aligned box), so shots never depend on render state.
// A "fighter" is any object with: id, name, team, alive, hp, pos {x, z},
// eyeY, height, radius, applyDamage(amount, src) -> killed boolean.

import * as THREE from 'three';
import { GRENADES } from './weapons.js';
import { sfx } from './audio.js';

// Ray vs AABB, returns the entry t or Infinity. Origin o, unit dir d.
export function rayBoxT(o, d, min, max) {
  let tmin = 0, tmax = Infinity;
  const oo = [o.x, o.y, o.z], dd = [d.x, d.y, d.z];
  const mn = [min.x, min.y, min.z], mx = [max.x, max.y, max.z];
  for (let k = 0; k < 3; k++) {
    if (Math.abs(dd[k]) < 1e-9) {
      if (oo[k] < mn[k] || oo[k] > mx[k]) return Infinity;
    } else {
      let t1 = (mn[k] - oo[k]) / dd[k];
      let t2 = (mx[k] - oo[k]) / dd[k];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}

function applySpread(dir, spread, rng) {
  // perturb the direction by a small random cone
  const up = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(dir, up).normalize();
  const upv = new THREE.Vector3().crossVectors(right, dir).normalize();
  const a = rng.next() * Math.PI * 2;
  const r = rng.next() * spread;
  return dir.clone()
    .addScaledVector(right, Math.cos(a) * r)
    .addScaledVector(upv, Math.sin(a) * r)
    .normalize();
}

export function fireHitscan(shooter, world, effects, rng, targets, callbacks) {
  const w = shooter.weapon;
  const origin = { x: shooter.pos.x, y: shooter.eyeY, z: shooter.pos.z };
  let dir = shooter.aimDir.clone();
  const moving = shooter.moving ? 1 : 0;
  const spread = w.spread + moving * w.moveSpread;
  dir = applySpread(dir, spread, rng);

  // nearest wall hit
  let wallT = Infinity;
  for (const c of world.colliders) {
    const t = rayBoxT(origin, dir, { x: c.x1, y: 0, z: c.z1 }, { x: c.x2, y: c.h, z: c.z2 });
    if (t < wallT) wallT = t;
  }

  // nearest fighter hit (head box first, then body box)
  let best = null;
  for (const t of targets) {
    if (!t.alive || t.team === shooter.team) continue;
    const r = t.radius;
    const headT = rayBoxT(origin, dir,
      { x: t.pos.x - 0.24, y: t.headY, z: t.pos.z - 0.24 },
      { x: t.pos.x + 0.24, y: t.height, z: t.pos.z + 0.24 });
    const bodyT = rayBoxT(origin, dir,
      { x: t.pos.x - r, y: 0, z: t.pos.z - r },
      { x: t.pos.x + r, y: t.height, z: t.pos.z + r });
    const hitT = Math.min(headT, bodyT);
    if (hitT === Infinity) continue;
    if (!best || hitT < best.t) best = { t: hitT, target: t, head: headT <= bodyT };
  }

  const maxDist = 130;
  let endT = Math.min(wallT, maxDist);
  let result = { hit: false, killed: false, target: null, damage: 0, head: false, point: null };
  if (best && best.t < wallT && best.t < maxDist) {
    endT = best.t;
    const dist = best.t;
    let dmg = w.damage;
    if (dist > w.range) dmg *= Math.max(w.falloff, 1 - ((dist - w.range) / w.range) * (1 - w.falloff));
    if (best.head) dmg *= w.headMult;
    dmg = Math.round(dmg);
    const killed = best.target.applyDamage(dmg, shooter);
    result = { hit: true, killed, target: best.target, damage: dmg, head: best.head, point: {
      x: origin.x + dir.x * endT, y: origin.y + dir.y * endT, z: origin.z + dir.z * endT,
    } };
    callbacks.onHit?.(result, shooter);
  } else {
    if (wallT < maxDist) {
      effects.impact({ x: origin.x + dir.x * wallT, y: origin.y + dir.y * wallT, z: origin.z + dir.z * wallT });
    }
  }

  const end = {
    x: origin.x + dir.x * endT,
    y: origin.y + dir.y * endT,
    z: origin.z + dir.z * endT,
  };
  effects.tracer({ x: origin.x + dir.x * 0.4, y: origin.y + dir.y * 0.4, z: origin.z + dir.z * 0.4 }, end, shooter.team);
  effects.muzzleFlash(origin, dir);
  sfx.shot(w.kind);
  result.point = result.point ?? end;
  return result;
}

// ---- grenades ----

export function createGrenades() {
  const list = [];
  return {
    list,
    throwGrenade(owner, kind) {
      const g = GRENADES[kind];
      if (!g) return null;
      const dir = owner.aimDir.clone();
      const pos = { x: owner.pos.x + dir.x * 0.5, y: owner.eyeY - 0.15, z: owner.pos.z + dir.z * 0.5 };
      const vel = { x: dir.x * 13, y: dir.y * 13 + 3.2, z: dir.z * 13 };
      const nade = { kind, owner, pos, vel, fuse: g.fuse, alive: true };
      list.push(nade);
      sfx.grenadeThrow();
      return nade;
    },
    update(dt, world, effects, fighters, now, callbacks) {
      for (let i = list.length - 1; i >= 0; i--) {
        const n = list[i];
        n.fuse -= dt;
        n.vel.y -= 12 * dt;
        n.pos.x += n.vel.x * dt;
        n.pos.y += n.vel.y * dt;
        n.pos.z += n.vel.z * dt;
        if (n.pos.y < 0.12) {
          n.pos.y = 0.12;
          if (Math.abs(n.vel.y) > 2) sfx.bounce();
          n.vel.y = Math.abs(n.vel.y) * 0.35;
          n.vel.x *= 0.6; n.vel.z *= 0.6;
        }
        const p = { x: n.pos.x, z: n.pos.z };
        if (world.resolveCircle(p, 0.14)) {
          n.pos.x = p.x; n.pos.z = p.z;
          n.vel.x *= -0.3; n.vel.z *= -0.3;
        }
        if (n.fuse > 0) continue;
        list.splice(i, 1);
        const g = GRENADES[n.kind];
        if (n.kind === 'frag') {
          effects.explosion(n.pos);
          sfx.explosion();
          for (const f of fighters) {
            if (!f.alive || f === n.owner) continue;
            const dx = f.pos.x - n.pos.x, dz = f.pos.z - n.pos.z;
            const d = Math.hypot(dx, dz);
            if (d > g.radius) continue;
            // walls shield: grenade to chest must be clear
            if (world.segmentBlocked(n.pos.x, 0.6, n.pos.z, f.pos.x, 1.0, f.pos.z)) continue;
            const dmg = Math.round(g.damage * Math.max(g.falloff, 1 - (d / g.radius) * (1 - g.falloff)));
            const killed = f.applyDamage(dmg, n.owner);
            callbacks.onHit?.({ hit: true, killed, target: f, damage: dmg, head: false, point: { ...n.pos }, grenade: true }, n.owner);
          }
        } else {
          effects.smoke(n.pos, g.radius, g.duration, now);
          sfx.bounce();
        }
      }
    },
  };
}
