// Meridian Docks: an original harbour map, 52 x 38 m, built from boxes. Every box is a
// collider and a surface a bullet stops on. Two plant sites (A Crane Yard west, B Container
// Row east), three lanes (A-long west, Gantry mid, B-short east), and a waypoint graph the
// bots walk. Textures are painted on canvases at runtime — no image files, no ripped art.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

function canvasTexture(size, paint, repeatX = 1, repeatY = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  paint(canvas.getContext('2d'), size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function speckle(ctx, size, base, spots, alpha) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < spots; i += 1) {
    const v = Math.random();
    ctx.fillStyle = `rgba(${v > 0.5 ? '255,255,255' : '0,0,0'},${alpha * Math.random()})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
}

function letterTexture(letter, colour) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 256, 256);
  ctx.strokeStyle = colour;
  ctx.lineWidth = 10;
  ctx.strokeRect(14, 14, 228, 228);
  ctx.fillStyle = colour;
  ctx.font = 'bold 150px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, 128, 138);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const groundTex = canvasTexture(256, (ctx, s) => speckle(ctx, s, '#232d38', 2600, 0.16), 13, 9);
  const concreteTex = canvasTexture(256, (ctx, s) => speckle(ctx, s, '#2b3540', 1800, 0.12), 2, 1);
  const rustTex = canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#b4552d';
    ctx.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x += 16) {
      ctx.fillStyle = x % 32 === 0 ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.06)';
      ctx.fillRect(x, 0, 8, s);
    }
    speckle(ctx, s, 'rgba(0,0,0,0)', 300, 0.2);
  }, 2, 1);
  const tealTex = canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#2e6f6a';
    ctx.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x += 16) {
      ctx.fillStyle = x % 32 === 0 ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.05)';
      ctx.fillRect(x, 0, 8, s);
    }
    speckle(ctx, s, 'rgba(0,0,0,0)', 240, 0.18);
  }, 2, 1);
  const ochreTex = canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#7a6a3f';
    ctx.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x += 16) {
      ctx.fillStyle = x % 32 === 0 ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.06)';
      ctx.fillRect(x, 0, 8, s);
    }
    speckle(ctx, s, 'rgba(0,0,0,0)', 260, 0.18);
  }, 2, 1);
  const hazardTex = canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = '#d8a028';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#14161a';
    for (let i = -s; i < s * 2; i += 32) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + 16, 0);
      ctx.lineTo(i + 16 + s, s);
      ctx.lineTo(i + s, s);
      ctx.closePath();
      ctx.fill();
    }
  }, 4, 1);

  function mat(map, rough = 0.9, metal = 0.05, extra = {}) {
    return new THREE.MeshStandardMaterial({ map, roughness: rough, metalness: metal, ...extra });
  }
  const groundMat = mat(groundTex, 0.96, 0);
  const wallMat = mat(concreteTex, 0.92, 0.02);
  const rustMat = mat(rustTex, 0.82, 0.12);
  const tealMat = mat(tealTex, 0.82, 0.12);
  const ochreMat = mat(ochreTex, 0.82, 0.12);
  const crateMat = mat(concreteTex, 0.9, 0.05, { color: new THREE.Color('#8a7a55') });
  const hazardMat = mat(hazardTex, 0.8, 0.05);
  const steelMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.55, metalness: 0.55 });

  const colliders = [];
  const shootables = [];

  function box(w, h, d, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }

  // A forklift: a low body, a tall mast at the front, an overhead guard and a pair
  // of forks. The body and the mast stop bullets and bodies; the guard and forks
  // are thin enough to be visual only. It always faces north, toward the sites,
  // which keeps the axis-aligned colliders exact.
  function forklift(x, z) {
    const parts = new THREE.Group();
    parts.position.set(x, 0, z);
    group.add(parts);
    const bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.0, 2.0), ochreMat);
    bodyMesh.position.y = 0.5;
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    parts.add(bodyMesh);
    const mast = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.3, 0.18), steelMat);
    mast.position.set(0, 1.15, -1.05);
    mast.castShadow = true;
    parts.add(mast);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.08, 1.4), steelMat);
    guard.position.set(0, 1.95, 0.2);
    parts.add(guard);
    for (const dx of [-0.35, 0.35]) {
      const fork = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 1.1), steelMat);
      fork.position.set(dx, 0.12, -1.5);
      parts.add(fork);
    }
    colliders.push(new THREE.Box3(new THREE.Vector3(x - 0.6, 0, z - 1.05), new THREE.Vector3(x + 0.6, 1.0, z + 1.05)));
    colliders.push(new THREE.Box3(new THREE.Vector3(x - 0.55, 0, z - 1.15), new THREE.Vector3(x + 0.55, 2.3, z - 0.95)));
    shootables.push(bodyMesh, mast);
  }

  // A sandbag line: a row of low boxes, crouch cover that a bullet still clears.
  function sandbags(x, z, count, alongX) {
    for (let i = 0; i < count; i += 1) {
      const dx = alongX ? (i - (count - 1) / 2) * 1.05 : 0;
      const dz = alongX ? 0 : (i - (count - 1) / 2) * 1.05;
      box(1.0, 0.55, 0.7, x + dx, 0.28, z + dz, crateMat);
    }
  }

  // Ground and outer walls (52 x 38 m, 4.2 m walls).
  const floor = new THREE.Mesh(new THREE.BoxGeometry(52.4, 0.4, 38.4), groundMat);
  floor.position.set(0, -0.2, 0);
  floor.receiveShadow = true;
  group.add(floor);
  shootables.push(floor);
  box(0.4, 4.2, 38.4, -26.2, 2.1, 0, wallMat);
  box(0.4, 4.2, 38.4, 26.2, 2.1, 0, wallMat);
  box(52.4, 4.2, 0.4, 0, 2.1, -19.2, wallMat);
  box(52.4, 4.2, 0.4, 0, 2.1, 19.2, wallMat);

  // North warehouse stubs: two wall teeth that break the north sightline.
  box(6, 4.2, 0.4, -10, 2.1, -15, wallMat);
  box(6, 4.2, 0.4, 10, 2.1, -15, wallMat);

  // Gantry crane across mid (z = -3): legs and a top beam, plus a hanging hook block.
  box(1, 7, 1, -4, 3.5, -3, steelMat);
  box(1, 7, 1, 4, 3.5, -3, steelMat);
  box(10, 1, 1.6, 0, 7.2, -3, steelMat);
  box(1.4, 1.2, 1.4, 1.5, 5.6, -3, hazardMat);

  // Containers: mid zigzag, A-long, B-short, and site cover. Axis-aligned on purpose.
  box(6, 2.6, 2.4, -3.5, 1.3, 2, rustMat);
  box(2.4, 2.6, 6, 4, 1.3, -2, tealMat);
  box(2.4, 2.6, 6, -6, 1.3, -8, ochreMat);
  box(6, 2.6, 2.4, 7, 1.3, -10, rustMat);
  box(2.4, 2.6, 6, -21, 1.3, 8, tealMat);
  box(2.4, 2.6, 6, 21, 1.3, 8, rustMat);
  box(2.4, 2.6, 6, -23, 1.3, -9, rustMat);
  box(6, 2.6, 2.4, -15, 1.3, -13, tealMat);
  box(2.4, 2.6, 6, 23, 1.3, -9, tealMat);
  box(6, 2.6, 2.4, 15, 1.3, -13, ochreMat);
  // Stacked second layer, visible over the first (visual depth, still one collider each).
  box(6, 2.6, 2.4, -3.5, 3.9, 2, tealMat);
  box(2.4, 2.6, 6, 4, 3.9, -2, rustMat);

  // Crates (crouch cover) and barrels.
  const crates = [
    [-17, 4], [-23, 0], [17, 4], [23, 0], [-17, -7], [17, -7],
    [-9, 8], [9, 8], [-12, -5], [12, -5], [0, 13], [-6, -13], [6, -13],
  ];
  for (const [x, z] of crates) box(1.2, 1.1, 1.2, x, 0.55, z, crateMat);
  for (const [x, z] of [[-10, -1], [-8.5, -1.4], [10, -1], [8.5, -1.4], [-20, 12], [20, 12]]) {
    box(0.8, 1.0, 0.8, x, 0.5, z, rustMat);
  }

  // Map v2 cover: forklifts on the two side lanes, sandbag lines at both spawns,
  // corner container stacks, and a pair of crates guarding the north mid. All of
  // it sits off the waypoint segments and off the capture sightlines.
  forklift(-14, 8);
  forklift(14, 8);
  sandbags(-8, 12, 3, true);
  sandbags(8, 12, 3, true);
  sandbags(-10, -14, 3, true);
  sandbags(10, -14, 3, true);
  box(6, 2.6, 2.4, -22, 1.3, 16, tealMat);
  box(6, 2.6, 2.4, -22, 3.9, 16, rustMat);
  box(6, 2.6, 2.4, 22, 1.3, 16, rustMat);
  box(6, 2.6, 2.4, 22, 3.9, 16, tealMat);
  box(1.2, 1.1, 1.2, -2, 0.55, -14, crateMat);
  box(1.2, 1.1, 1.2, 2, 0.55, -14, crateMat);

  // Site markers: glowing floor decal + light beam at each site centre.
  const sites = {
    A: { center: new THREE.Vector3(-19, 0, -9), radius: 4.5 },
    B: { center: new THREE.Vector3(19, 0, -9), radius: 4.5 },
  };
  for (const [name, site] of Object.entries(sites)) {
    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(7, 7),
      new THREE.MeshBasicMaterial({ map: letterTexture(name, name === 'A' ? PALETTE.accent : PALETTE.teamB), transparent: true, opacity: 0.85, depthWrite: false }),
    );
    decal.rotation.x = -Math.PI / 2;
    decal.position.set(site.center.x, 0.02, site.center.z);
    group.add(decal);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.55, 9, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(name === 'A' ? PALETTE.accent : PALETTE.teamB), transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }),
    );
    beam.position.set(site.center.x, 4.5, site.center.z);
    group.add(beam);
  }

  // Sodium lamps on poles: warm pools of light, emissive heads.
  const lampHeads = [];
  for (const [x, z] of [[-12, 6], [12, 6], [-12, -12], [12, -12], [0, 16]]) {
    box(0.18, 5, 0.18, x, 2.5, z, steelMat, false);
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.18, 0.3),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.lamp), emissive: new THREE.Color(PALETTE.lamp), emissiveIntensity: 2.2 }),
    );
    head.position.set(x, 5.05, z);
    group.add(head);
    lampHeads.push(head);
    const light = new THREE.PointLight(new THREE.Color(PALETTE.lamp), 14, 16, 1.6);
    light.position.set(x, 4.8, z);
    scene.add(light);
  }

  // Distant harbour silhouettes outside the walls: depth without gameplay cost.
  const silhouetteMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#0a0f16') });
  for (const [x, z, w, h, d] of [[-38, -14, 10, 18, 4], [38, -10, 8, 14, 4], [-20, -34, 22, 10, 6], [24, -32, 16, 22, 5], [0, 34, 30, 8, 6]]) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), silhouetteMat);
    mesh.position.set(x, h / 2 - 0.2, z);
    group.add(mesh);
  }
  // Setting sun: a low orange disc over the west wall.
  const sun = new THREE.Mesh(
    new THREE.CircleGeometry(5, 24),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff7a1a'), fog: false }),
  );
  sun.position.set(-60, 7, -30);
  sun.lookAt(0, 4, 0);
  group.add(sun);

  // Light: low dusk sun from the west, cool sky fill, warm hemisphere.
  const sky = new THREE.HemisphereLight(new THREE.Color('#5a6d84'), new THREE.Color('#1a2027'), 1.0);
  scene.add(sky);
  const key = new THREE.DirectionalLight(new THREE.Color('#ffb26b'), 2.6);
  key.position.set(-30, 16, -12);
  key.target.position.set(6, 0, 2);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -30;
  key.shadow.camera.right = 30;
  key.shadow.camera.top = 24;
  key.shadow.camera.bottom = -24;
  key.shadow.camera.far = 90;
  key.shadow.bias = -0.0006;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#7d94ad'), 0.5);
  fill.position.set(18, 12, 16);
  scene.add(fill);

  // Waypoint graph: nodes the bots walk, links they may take. BFS in pathBetween().
  const nodes = [
    { id: 'as0', x: -4, z: 15 }, { id: 'as1', x: 0, z: 15 }, { id: 'as2', x: 4, z: 15 },
    { id: 'al1', x: -14, z: 12 }, { id: 'al2', x: -21, z: 6 }, { id: 'al3', x: -21, z: -2 }, { id: 'al4', x: -19, z: -6 },
    { id: 'm1', x: 0, z: 10 }, { id: 'm2', x: 0, z: 4 }, { id: 'm3', x: 0, z: -3 }, { id: 'm4', x: 0, z: -9 },
    { id: 'bs1', x: 14, z: 12 }, { id: 'bs2', x: 21, z: 6 }, { id: 'bs3', x: 21, z: -2 }, { id: 'bs4', x: 19, z: -6 },
    { id: 'a1', x: -19, z: -9 }, { id: 'a2', x: -15, z: -11 }, { id: 'a3', x: -22, z: -11 },
    { id: 'b1', x: 19, z: -9 }, { id: 'b2', x: 15, z: -11 }, { id: 'b3', x: 22, z: -11 },
    { id: 'ds0', x: -4, z: -15 }, { id: 'ds1', x: 0, z: -15 }, { id: 'ds2', x: 4, z: -15 },
    { id: 'hA', x: -17, z: -5 }, { id: 'hB', x: 17, z: -5 }, { id: 'hM', x: 0, z: -12 }, { id: 'hA2', x: -12, z: -8 }, { id: 'hB2', x: 12, z: -8 },
    { id: 'fA', x: -14, z: 8 }, { id: 'fB', x: 14, z: 8 },
  ];
  const links = {
    as0: ['as1', 'al1', 'm1'], as1: ['as0', 'as2', 'm1'], as2: ['as1', 'bs1', 'm1'],
    al1: ['as0', 'al2', 'fA'], al2: ['al1', 'al3', 'm2', 'fA'], al3: ['al2', 'al4', 'hA'], al4: ['al3', 'a1'],
    m1: ['as1', 'm2'], m2: ['m1', 'm3', 'al2', 'bs2'], m3: ['m2', 'm4', 'hM'], m4: ['m3', 'hA2', 'hB2'],
    bs1: ['as2', 'bs2', 'fB'], bs2: ['bs1', 'bs3', 'm2', 'fB'], bs3: ['bs2', 'bs4', 'hB'], bs4: ['bs3', 'b1'],
    a1: ['al4', 'a2', 'a3'], a2: ['a1', 'hA2'], a3: ['a1', 'hA'],
    b1: ['bs4', 'b2', 'b3'], b2: ['b1', 'hB2'], b3: ['b1', 'hB'],
    ds0: ['ds1', 'hA', 'hM'], ds1: ['ds0', 'ds2', 'hM'], ds2: ['ds1', 'hB', 'hM'],
    hA: ['ds0', 'al3', 'a3', 'hA2'], hB: ['ds2', 'bs3', 'b3', 'hB2'], hM: ['ds1', 'm3', 'hA2', 'hB2'],
    hA2: ['hA', 'a2', 'm4', 'hM'], hB2: ['hB', 'b2', 'm4', 'hM'],
    fA: ['al1', 'al2'], fB: ['bs1', 'bs2'],
  };
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  function pathBetween(fromId, toId) {
    if (fromId === toId) return [nodeById.get(toId)];
    const prev = new Map([[fromId, null]]);
    const queue = [fromId];
    while (queue.length) {
      const current = queue.shift();
      for (const next of links[current] || []) {
        if (prev.has(next)) continue;
        prev.set(next, current);
        if (next === toId) {
          const path = [];
          let at = toId;
          while (at) {
            path.unshift(nodeById.get(at));
            at = prev.get(at);
          }
          return path;
        }
        queue.push(next);
      }
    }
    return [nodeById.get(toId)];
  }

  function nearestNode(x, z) {
    let best = nodes[0];
    let bestD = Infinity;
    for (const node of nodes) {
      const d = (node.x - x) ** 2 + (node.z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = node;
      }
    }
    return best;
  }

  return {
    colliders,
    shootables,
    sites,
    spawns: {
      attack: [
        { x: -4, z: 15.5, yaw: 0 }, { x: -1.5, z: 16.5, yaw: 0 }, { x: 1.5, z: 16.5, yaw: 0 },
        { x: 4, z: 15.5, yaw: 0 }, { x: 0, z: 17.5, yaw: 0 },
      ],
      defend: [
        { x: -4, z: -15.5, yaw: Math.PI }, { x: -1.5, z: -16.5, yaw: Math.PI }, { x: 1.5, z: -16.5, yaw: Math.PI },
        { x: 4, z: -15.5, yaw: Math.PI }, { x: 0, z: -17.5, yaw: Math.PI },
      ],
    },
    waypoints: { nodes, nodeById, pathBetween, nearestNode },
    bounds: { minX: -26, maxX: 26, minZ: -19, maxZ: 19 },
    group,
  };
}
