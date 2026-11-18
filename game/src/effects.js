// Effects — tracers, muzzle flashes, impact sparks, explosions and smoke.
// Everything is transient: each effect has a lifetime and is removed when it
// expires, so the scene never accumulates garbage.

import * as THREE from 'three';
import { PALETTE } from './palette.js';

export function createEffects(scene) {
  const live = [];
  const smokeZones = []; // {x, z, r, until} — bots treat these as vision blockers

  function add(mesh, life, onTick) {
    scene.add(mesh);
    const e = { mesh, life, age: 0, onTick };
    live.push(e);
    return e;
  }

  function tracer(from, to, team) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(from.x, from.y, from.z),
      new THREE.Vector3(to.x, to.y, to.z),
    ]);
    const mat = new THREE.LineBasicMaterial({
      color: team === 'atk' ? PALETTE.tracerAtk : PALETTE.tracerDef,
      transparent: true, opacity: 0.9,
    });
    const line = new THREE.Line(geo, mat);
    add(line, 0.09, (e) => { e.mesh.material.opacity = 0.9 * (1 - e.age / e.life); });
    return line;
  }

  function muzzleFlash(pos, dir) {
    const geo = new THREE.PlaneGeometry(0.34, 0.34);
    const mat = new THREE.MeshBasicMaterial({
      color: PALETTE.muzzle, transparent: true, opacity: 0.95,
      side: THREE.DoubleSide, depthWrite: false,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(pos.x + dir.x * 0.5, pos.y + dir.y * 0.5, pos.z + dir.z * 0.5);
    m.lookAt(pos.x + dir.x * 2, pos.y + dir.y * 2, pos.z + dir.z * 2);
    add(m, 0.05, (e) => { e.mesh.material.opacity = 0.95 * (1 - e.age / e.life); });
  }

  function impact(pos, color = 0xffc27a) {
    const n = 10;
    const positions = new Float32Array(n * 3);
    const vels = [];
    for (let i = 0; i < n; i++) {
      positions[i * 3] = pos.x; positions[i * 3 + 1] = pos.y; positions[i * 3 + 2] = pos.z;
      const a = Math.random() * Math.PI * 2, b = (Math.random() - 0.3) * Math.PI;
      const s = 2 + Math.random() * 3.5;
      vels.push([Math.cos(a) * Math.cos(b) * s, Math.sin(b) * s + 1.5, Math.sin(a) * Math.cos(b) * s]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({ color, size: 0.09, transparent: true, opacity: 1 });
    const pts = new THREE.Points(geo, mat);
    add(pts, 0.35, (e) => {
      const arr = e.mesh.geometry.attributes.position.array;
      for (let i = 0; i < n; i++) {
        vels[i][1] -= 9 * 0.016;
        arr[i * 3] += vels[i][0] * 0.016;
        arr[i * 3 + 1] = Math.max(0.02, arr[i * 3 + 1] + vels[i][1] * 0.016);
        arr[i * 3 + 2] += vels[i][2] * 0.016;
      }
      e.mesh.geometry.attributes.position.needsUpdate = true;
      e.mesh.material.opacity = 1 - e.age / e.life;
    });
  }

  function explosion(pos) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.9 }),
    );
    mesh.position.set(pos.x, Math.max(0.6, pos.y), pos.z);
    const light = new THREE.PointLight(0xff8a2a, 60, 22, 1.6);
    light.position.copy(mesh.position);
    scene.add(light);
    add(mesh, 0.55, (e) => {
      const k = e.age / e.life;
      e.mesh.scale.setScalar(1 + k * 9);
      e.mesh.material.opacity = 0.9 * (1 - k);
      light.intensity = 60 * (1 - k);
      if (k >= 1) scene.remove(light);
    });
    impact(pos, 0xff6a2a);
  }

  function smoke(pos, radius, duration, now) {
    smokeZones.push({ x: pos.x, z: pos.z, r: radius, until: now + duration });
    const group = new THREE.Group();
    for (let i = 0; i < 9; i++) {
      const puff = new THREE.Mesh(
        new THREE.SphereGeometry(1 + Math.random() * 0.9, 10, 8),
        new THREE.MeshBasicMaterial({ color: PALETTE.smoke, transparent: true, opacity: 0.42, depthWrite: false }),
      );
      const a = Math.random() * Math.PI * 2, d = Math.random() * radius * 0.6;
      puff.position.set(pos.x + Math.cos(a) * d, 0.5 + Math.random() * 1.6, pos.z + Math.sin(a) * d);
      group.add(puff);
    }
    add(group, duration, (e) => {
      const k = e.age / e.life;
      for (const puff of e.mesh.children) {
        puff.material.opacity = 0.42 * (k < 0.8 ? 1 : (1 - k) / 0.2);
        puff.scale.setScalar(1 + k * 0.35);
      }
    });
  }

  // A floating damage / event marker that rises and fades (used sparingly).
  function ring(pos, color) {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.4, 0.55, 24),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(pos.x, 0.05, pos.z);
    add(mesh, 0.7, (e) => {
      const k = e.age / e.life;
      e.mesh.scale.setScalar(1 + k * 2.2);
      e.mesh.material.opacity = 0.85 * (1 - k);
    });
  }

  function inSmoke(x1, y1, z1, x2, y2, z2, now) {
    // a sight line is blocked if it passes within a live smoke zone (2D test
    // at the segment's midpoint height — smoke fills 0..2.5 m)
    const midY = (y1 + y2) / 2;
    if (midY > 2.6) return false;
    for (const s of smokeZones) {
      if (now > s.until) continue;
      // distance from zone centre to the 2D segment
      const dx = x2 - x1, dz = z2 - z1;
      const len2 = dx * dx + dz * dz;
      let t = len2 === 0 ? 0 : ((s.x - x1) * dx + (s.z - z1) * dz) / len2;
      t = Math.max(0, Math.min(1, t));
      const cx = x1 + dx * t, cz = z1 + dz * t;
      if (Math.hypot(s.x - cx, s.z - cz) < s.r) return true;
    }
    return false;
  }

  function update(dt, now = 0) {
    for (let i = live.length - 1; i >= 0; i--) {
      const e = live[i];
      e.age += dt;
      e.onTick?.(e);
      if (e.age >= e.life) {
        scene.remove(e.mesh);
        e.mesh.geometry?.dispose?.();
        e.mesh.material?.dispose?.();
        live.splice(i, 1);
      }
    }
    for (let i = smokeZones.length - 1; i >= 0; i--) {
      if (smokeZones[i].until < now) smokeZones.splice(i, 1);
    }
  }

  return { tracer, muzzleFlash, impact, explosion, smoke, ring, inSmoke, smokeZones, update };
}
