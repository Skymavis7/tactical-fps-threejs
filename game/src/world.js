// World — Meridian Docks. A 52 x 38 m harbour at dusk: three lanes, two plant
// sites, containers, crates and a gantry crane. All collision is analytic
// (axis-aligned boxes in the XZ plane), so line of sight and bullets never
// depend on the renderer's matrices.

import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WORLD = { minX: -26, maxX: 26, minZ: -19, maxZ: 19 };

// [x1, z1, x2, z2, height, kind] — kind 'block' stops movement and sight,
// 'low' stops movement but lets eye-level sight pass over it.
const COLLIDER_DEFS = [
  // perimeter
  [-27, -20, 27, -19, 4, 'block'],
  [-27, 19, 27, 20, 4, 'block'],
  [-27, -19, -26, 19, 4, 'block'],
  [26, -19, 27, 19, 4, 'block'],
  // mid containers
  [-5, -3, -1, 1, 2.6, 'block'],
  [2, -1, 6, 3, 2.6, 'block'],
  // site B container row
  [11, 8, 14, 11, 2.6, 'block'],
  [16, 11, 19, 14, 2.6, 'block'],
  // site A crane yard
  [-19, -8, -15, -5, 2.6, 'block'],
  // flank containers
  [-9, 10, -5, 13, 2.6, 'block'],
  [8, -14, 12, -11, 2.6, 'block'],
  // crates
  [-13.8, -2.8, -12.2, -1.2, 1.2, 'low'],
  [-2.8, -12.8, -1.2, -11.2, 1.2, 'low'],
  [-0.8, 11.2, 0.8, 12.8, 1.2, 'low'],
  [13.2, -4.8, 14.8, -3.2, 1.2, 'low'],
  [-20.8, 5.2, -19.2, 6.8, 1.2, 'low'],
  [19.2, -12.8, 20.8, -11.2, 1.2, 'low'],
  [5.2, 5.2, 6.8, 6.8, 1.2, 'low'],
  // low cover walls on mid
  [-8, -0.5, -6, 0.5, 1.1, 'low'],
  [7, -0.5, 9, 0.5, 1.1, 'low'],
  // crane legs
  [-18.5, -14.5, -17.5, -13.5, 9, 'block'],
  [-12.5, -14.5, -11.5, -13.5, 9, 'block'],
];

export const SITES = {
  A: { id: 'A', name: 'Crane Yard', cx: -15, cz: -11, hx: 4, hz: 3, color: PALETTE.siteA },
  B: { id: 'B', name: 'Container Row', cx: 15, cz: 11, hx: 4, hz: 3, color: PALETTE.siteB },
};

export const SPAWNS = {
  atk: [
    { x: -23, z: -6 }, { x: -23, z: -2 }, { x: -23, z: 2 }, { x: -23, z: 6 },
    { x: -23, z: 0 },
  ],
  def: [
    { x: -11, z: -11 }, { x: -13, z: -8 }, // hold A
    { x: 11, z: 11 }, { x: 13, z: 8 }, // hold B
    { x: 19, z: 0 }, // mid anchor
  ],
};

// Waypoint nodes the bot graph walks. Hand-placed in open ground; edges are
// auto-connected between nodes that are close and have a clear walking line.
const WAYPOINTS = [
  [-23, -8], [-23, 0], [-23, 8],
  [-17, -12], [-17, 0], [-17, 12],
  [-15, -11], [-11, -11],
  [-10, -14], [-10, 0], [-10, 14],
  [-4, -8], [-4, 8], [0, 0],
  [4, -8], [4, 8],
  [10, -14], [10, 0], [10, 14],
  [15, 11], [11, 11],
  [17, -12], [17, 0], [17, 12],
  [22, -6], [22, 0], [22, 6],
  [19, 0], [-20, -4], [20, 4],
];

function groundTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 768;
  const g = c.getContext('2d');
  g.fillStyle = '#3d3a38';
  g.fillRect(0, 0, 1024, 768);
  // speckle
  for (let i = 0; i < 9000; i++) {
    const v = Math.random();
    g.fillStyle = v < 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.05)';
    g.fillRect(Math.random() * 1024, Math.random() * 768, 2, 2);
  }
  // lane dashes (north / mid / south), map x -26..26 -> px 0..1024, z -19..19 -> py 0..768
  const px = (x) => (x + 26) / 52 * 1024;
  const py = (z) => (z + 19) / 38 * 768;
  g.strokeStyle = 'rgba(255,215,94,0.55)';
  g.lineWidth = 3;
  g.setLineDash([26, 22]);
  for (const z of [-15, 0, 15]) {
    g.beginPath(); g.moveTo(px(-25), py(z)); g.lineTo(px(25), py(z)); g.stroke();
  }
  g.setLineDash([]);
  // site paint
  for (const s of Object.values(SITES)) {
    g.strokeStyle = s.id === 'A' ? '#57c8ff' : '#ff9a57';
    g.lineWidth = 5;
    g.strokeRect(px(s.cx - s.hx), py(s.cz - s.hz), s.hx * 2 / 52 * 1024, s.hz * 2 / 38 * 768);
    g.font = 'bold 44px sans-serif';
    g.fillStyle = s.id === 'A' ? '#57c8ff' : '#ff9a57';
    g.textAlign = 'center';
    g.fillText(s.id, px(s.cx), py(s.cz) + 15);
  }
  // dock edge stripes along the water side
  g.fillStyle = 'rgba(255,215,94,0.7)';
  for (let x = -25; x < 25; x += 2) g.fillRect(px(x), py(-18.6), 20, 6);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function skyTexture() {
  const c = document.createElement('canvas');
  c.width = 16; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#141c38');
  grad.addColorStop(0.45, '#3a3560');
  grad.addColorStop(0.62, '#8a5570');
  grad.addColorStop(0.72, '#d97b4f');
  grad.addColorStop(0.8, '#2a1a20');
  grad.addColorStop(1, '#120e14');
  g.fillStyle = grad;
  g.fillRect(0, 0, 16, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function box(w, h, d, color, x, y, z, rough = 0.9) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.08 }),
  );
  m.position.set(x, y, z);
  return m;
}

export function buildWorld(scene) {
  const colliders = COLLIDER_DEFS.map(([x1, z1, x2, z2, h, kind]) => ({ x1, z1, x2, z2, h, kind }));

  // sky dome + fog
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(160, 24, 16),
    new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false }),
  );
  scene.add(sky);
  scene.fog = new THREE.Fog(PALETTE.fog, 45, 150);

  // lights: low warm sun + cool ambient
  const hemi = new THREE.HemisphereLight(0x8a6a9a, 0x2a2018, 1.15);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xff9a5e, 2.1);
  sun.position.set(-30, 18, -25);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x5a7ac8, 0.5);
  fill.position.set(20, 12, 20);
  scene.add(fill);

  // ground + water
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(54, 40),
    new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.95, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshStandardMaterial({ color: PALETTE.water, roughness: 0.25, metalness: 0.55 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = -0.45;
  scene.add(water);

  // perimeter walls
  const wallMat = new THREE.MeshStandardMaterial({ color: PALETTE.wall, roughness: 0.9 });
  const wallTopMat = new THREE.MeshStandardMaterial({ color: PALETTE.wallTop, roughness: 0.8 });
  const mkWall = (w, d, x, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 4, d), wallMat);
    m.position.set(x, 2, z);
    scene.add(m);
    const top = new THREE.Mesh(new THREE.BoxGeometry(w, 0.25, d), wallTopMat);
    top.position.set(x, 4.1, z);
    scene.add(top);
  };
  mkWall(54, 1, 0, -19.5);
  mkWall(54, 1, 0, 19.5);
  mkWall(1, 40, -26.5, 0);
  mkWall(1, 40, 26.5, 0);

  // containers, crates, low walls, crane
  const contColors = [PALETTE.containerA, PALETTE.containerB, PALETTE.containerC, PALETTE.containerD];
  let ci = 0;
  for (const col of colliders) {
    const w = col.x2 - col.x1, d = col.z2 - col.z1;
    const cx = (col.x1 + col.x2) / 2, cz = (col.z1 + col.z2) / 2;
    if (col.h >= 2.6 && w > 2 && d > 2) {
      const m = box(w, col.h, d, contColors[ci++ % contColors.length], cx, col.h / 2, cz, 0.75);
      scene.add(m);
      // ribbed top edge
      const rib = box(w, 0.12, d, 0x2a2a2e, cx, col.h + 0.05, cz);
      scene.add(rib);
      // a second stacked box on two of them, purely visual
      if ((cx < -14 && cz < -4) || (cx > 15 && cz > 10)) {
        const top = box(w * 0.85, 1.2, d * 0.85, contColors[ci++ % contColors.length], cx + 0.3, col.h + 0.6, cz - 0.2, 0.75);
        scene.add(top);
      }
    } else if (col.h >= 2.6) {
      // crane legs
      const m = box(w, col.h, d, PALETTE.craneDark, cx, col.h / 2, cz, 0.6);
      scene.add(m);
    } else if (col.kind === 'low' && w > 2) {
      const m = box(w, col.h, d, PALETTE.wall, cx, col.h / 2, cz, 0.9);
      scene.add(m);
    } else {
      const m = box(w, col.h, d, PALETTE.crate, cx, col.h / 2, cz, 0.95);
      scene.add(m);
      const lid = box(w * 0.9, 0.08, d * 0.9, 0x6b4f2c, cx, col.h + 0.04, cz);
      scene.add(lid);
    }
  }
  // crane beam across the two legs + hook block
  const beam = box(7.5, 1.1, 1.4, PALETTE.crane, -15, 9.2, -14, 0.55);
  scene.add(beam);
  const hook = box(1.2, 1.6, 1.2, PALETTE.craneDark, -13.5, 7.6, -14, 0.6);
  scene.add(hook);
  const cable = box(0.08, 1.6, 0.08, 0x1a1a1a, -13.5, 8.6, -14, 0.5);
  scene.add(cable);

  // floodlight poles
  const lampPositions = [[-20, -16], [20, 16], [-20, 16], [20, -16]];
  for (const [x, z] of lampPositions) {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.12, 5.4, 8),
      new THREE.MeshStandardMaterial({ color: 0x2e3138, roughness: 0.6, metalness: 0.5 }),
    );
    pole.position.set(x, 2.7, z);
    scene.add(pole);
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffd9a0 }),
    );
    lamp.position.set(x, 5.5, z);
    scene.add(lamp);
    const light = new THREE.PointLight(0xffc27a, 24, 20, 1.8);
    light.position.set(x, 5.4, z);
    scene.add(light);
  }

  // site markers: glowing ground ring + corner posts
  for (const s of Object.values(SITES)) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.6, 3.1, 32),
      new THREE.MeshBasicMaterial({ color: s.color, transparent: true, opacity: 0.75, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(s.cx, 0.03, s.cz);
    scene.add(ring);
    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(s.hx * 2, s.hz * 2),
      new THREE.MeshBasicMaterial({ color: s.color, transparent: true, opacity: 0.07, side: THREE.DoubleSide }),
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(s.cx, 0.02, s.cz);
    scene.add(pad);
    for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const post = box(0.18, 1.5, 0.18, 0x22242c, s.cx + ox * s.hx, 0.75, s.cz + oz * s.hz, 0.5);
      scene.add(post);
      const tip = new THREE.Mesh(
        new THREE.SphereGeometry(0.14, 8, 6),
        new THREE.MeshBasicMaterial({ color: s.color }),
      );
      tip.position.set(s.cx + ox * s.hx, 1.6, s.cz + oz * s.hz);
      scene.add(tip);
    }
  }

  // ---- navigation graph ----
  const nodes = WAYPOINTS.map(([x, z]) => ({ x, z }));
  const edges = new Map();
  const clearWalk = (a, b) => {
    // walking line at knee height; 'low' boxes are walkable-around only if
    // the segment clears them — treat every collider as blocking for paths
    for (const c of colliders) {
      if (segmentHitsBox(a.x, 0.6, a.z, b.x, 0.6, b.z, c)) return false;
    }
    return true;
  };
  for (let i = 0; i < nodes.length; i++) {
    edges.set(i, []);
    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue;
      const a = nodes[i], b = nodes[j];
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d > 11 || d < 0.5) continue;
      if (clearWalk(a, b)) edges.get(i).push(j);
    }
  }

  // ---- queries ----
  function segmentHitsBox(ax, ay, az, bx, by, bz, c) {
    // slab test of segment vs AABB (y from 0 to c.h), 'low' boxes only block
    // below their height — the segment's own y range decides that already.
    let tmin = 0, tmax = 1;
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const mins = [c.x1, 0, c.z1], maxs = [c.x2, c.h, c.z2], o = [ax, ay, az], d = [dx, dy, dz];
    for (let k = 0; k < 3; k++) {
      if (Math.abs(d[k]) < 1e-9) {
        if (o[k] < mins[k] || o[k] > maxs[k]) return false;
      } else {
        let t1 = (mins[k] - o[k]) / d[k];
        let t2 = (maxs[k] - o[k]) / d[k];
        if (t1 > t2) [t1, t2] = [t2, t1];
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) return false;
      }
    }
    return true;
  }

  function segmentBlocked(ax, ay, az, bx, by, bz) {
    for (const c of colliders) {
      if (segmentHitsBox(ax, ay, az, bx, by, bz, c)) return true;
    }
    return false;
  }

  function pointBlocked(x, z, r) {
    for (const c of colliders) {
      if (x + r > c.x1 && x - r < c.x2 && z + r > c.z1 && z - r < c.z2) return c;
    }
    return null;
  }

  // Push a circle (XZ) out of every collider it overlaps. Returns true if moved.
  function resolveCircle(p, r) {
    let moved = false;
    for (const c of colliders) {
      const nx = Math.max(c.x1, Math.min(p.x, c.x2));
      const nz = Math.max(c.z1, Math.min(p.z, c.z2));
      const dx = p.x - nx, dz = p.z - nz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      moved = true;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        p.x = nx + (dx / d) * r;
        p.z = nz + (dz / d) * r;
      } else {
        // centre inside the box: push out along the smallest penetration axis
        const pl = p.x - c.x1, pr = c.x2 - p.x, pt = p.z - c.z1, pb = c.z2 - p.z;
        const m = Math.min(pl, pr, pt, pb);
        if (m === pl) p.x = c.x1 - r;
        else if (m === pr) p.x = c.x2 + r;
        else if (m === pt) p.z = c.z1 - r;
        else p.z = c.z2 + r;
      }
    }
    p.x = Math.max(WORLD.minX + r, Math.min(WORLD.maxX - r, p.x));
    p.z = Math.max(WORLD.minZ + r, Math.min(WORLD.maxZ - r, p.z));
    return moved;
  }

  function siteAt(x, z) {
    for (const s of Object.values(SITES)) {
      if (Math.abs(x - s.cx) <= s.hx && Math.abs(z - s.cz) <= s.hz) return s;
    }
    return null;
  }

  function nearestNode(x, z) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < nodes.length; i++) {
      const d = (nodes[i].x - x) ** 2 + (nodes[i].z - z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  // BFS path over the waypoint graph; returns an array of node indices.
  function findPath(from, to) {
    if (from === to) return [to];
    const prev = new Map([[from, -1]]);
    const queue = [from];
    while (queue.length) {
      const cur = queue.shift();
      for (const nb of edges.get(cur) ?? []) {
        if (prev.has(nb)) continue;
        prev.set(nb, cur);
        if (nb === to) {
          const path = [to];
          let n = to;
          while (prev.get(n) !== -1) { n = prev.get(n); path.unshift(n); }
          return path;
        }
        queue.push(nb);
      }
    }
    return [to];
  }

  return {
    colliders, nodes, edges, sites: SITES, spawns: SPAWNS,
    segmentBlocked, pointBlocked, resolveCircle, siteAt, nearestNode, findPath,
    update(_dt, _t) { /* the docks are static; lamps flicker via materials in main */ },
  };
}
