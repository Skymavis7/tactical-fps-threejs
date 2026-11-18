// Main — boots Meridian Docks, owns the shared game state, the fixed-step
// simulation loop, the first-person camera, the viewmodel gun, and the
// deterministic ?shot= captures used for the entry's screenshots.

import * as THREE from 'three';
import { buildWorld } from './world.js';
import { makeRng } from './rng.js';
import { createEffects } from './effects.js';
import { createPlayer } from './player.js';
import { createBots } from './bots.js';
import { createRounds, ECONOMY } from './rounds.js';
import { createHud } from './hud.js';
import { createStats } from './stats.js';
import { fireHitscan, createGrenades } from './combat.js';
import { bindInput, input } from './input.js';
import { initAudio, sfx } from './audio.js';
import { WEAPONS } from './weapons.js';

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot'); // start | play | plant | end | null
const SEED = Number(params.get('seed') ?? 1) || 1;
const rng = makeRng(SEED * 7919 + 13);

const errors = [];
window.addEventListener('error', (e) => errors.push(String(e.message ?? e.error)));
window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));

window.__shotReady = false;

// ---- shared game state ----
const G = {
  phase: 'menu',
  phaseT: 0,
  round: 1,
  scoreAtk: 0,
  scoreDef: 0,
  assignedSite: null,
  plantedSite: null,
  plantT: 0,
  spike: { carrier: null, dropped: null, plantedAt: null },
  lossStreakAtk: 0,
  lossStreakDef: 0,
  roundWinner: null,
  roundReason: '',
  matchWinner: null,
  buyOpen: false,
  shot: SHOT,
};

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  errors.push(`WebGL unavailable: ${e.message}`);
  document.getElementById('diag').textContent = JSON.stringify({ shot: SHOT, errors });
  throw e;
}
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.domElement.classList.add('webgl');
document.getElementById('app').prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 400);
camera.rotation.order = 'YXZ';
scene.add(camera);

const world = buildWorld(scene);
const effects = createEffects(scene);
const stats = createStats();
const shotEvents = [];
const grenades = createGrenades();

const allFighters = () => {
  const list = [player, ...bots.all()];
  return list;
};

function handleHit(result, shooter) {
  if (!result.hit) return;
  if (shooter === player && !result.grenade) {
    stats.recordShot(true, result.damage);
  }
  if (result.killed) {
    const v = result.target;
    if (shooter === player) {
      player.kills++;
      stats.recordKill();
      player.award(ECONOMY.killReward);
      sfx.kill();
      hud.feed(`You eliminated ${v.name} (+$${ECONOMY.killReward})`, v.team === 'def' ? 'def' : 'atk');
    } else {
      shooter.kills++;
      hud.feed(`${shooter.name} eliminated ${v.name}`, shooter.team === 'atk' ? 'atk' : 'def');
    }
    if (v === player) {
      stats.recordDeath();
      hud.feed(`${shooter.name} eliminated you`, 'def');
    }
    if (v.hasSpike) rounds.onCarrierDeath(v);
    if (v === player) hud.showGameHud(true);
  } else if (shooter === player) {
    hud.hitmarker();
  }
}

function fireAs(shooter) {
  const res = fireHitscan(shooter, world, effects, rng, allFighters(), { onHit: handleHit });
  if (shooter === player && !res.hit) stats.recordShot(false, 0);
  shotEvents.push({ x: shooter.pos.x, z: shooter.pos.z, team: shooter.team, time: simNow });
  return res;
}

const player = createPlayer({
  world,
  rng,
  fireHitscan: fireAs,
  throwGrenade: (kind, owner) => {
    if (owner !== player) return;
    if (player.loadout.grenades[kind] <= 0) { sfx.denied(); return; }
    player.loadout.grenades[kind]--;
    grenades.throwGrenade(owner, kind);
  },
  onDeath: (victim, src) => {
    if (victim === player && src) stats.recordDeath();
  },
  buyOpen: () => G.buyOpen,
});

const bots = createBots({
  world,
  effects,
  rng,
  scene,
  G,
  shotEvents,
  onHit: handleHit,
  onDeath: (victim, src) => {
    if (victim.hasSpike) rounds.onCarrierDeath(victim);
  },
  onPlanted: (site, planter) => rounds.plantSpike(site, planter),
  onDefused: (site, defuser) => rounds.defuseSpike(defuser),
  onSpikePickup: (bot) => hud.feed(`${bot.name} picked up the spike`, 'atk'),
});

const hud = createHud({ G, player, bots, world, stats });

const rounds = createRounds({
  world,
  player,
  bots,
  effects,
  G,
  rng,
  scene,
  feed: (msg, cls) => hud.feed(msg, cls),
  onPhase: (phase) => { if (phase === 'buy') setBuyOpen(false); },
  onRoundEnd: (winner, reason) => {
    stats.recordRound(G.round, winner, reason);
    hud.showBanner(
      winner === 'atk' ? 'ATTACKERS WIN THE ROUND' : 'DEFENDERS WIN THE ROUND',
      reason,
      winner === 'atk' ? 'win' : 'lose',
    );
  },
  onMatchEnd: (winner) => {
    const end = document.getElementById('end');
    document.getElementById('endTitle').textContent =
      winner === 'atk' ? 'VICTORY' : winner === 'def' ? 'DEFEAT' : 'DRAW';
    document.getElementById('endTitle').style.color =
      winner === 'atk' ? '#57c8ff' : winner === 'def' ? '#ff5d5d' : '#ffd75e';
    document.getElementById('endSub').textContent =
      winner === 'atk' ? 'Attackers take Meridian Docks' :
      winner === 'def' ? 'Defenders hold Meridian Docks' : 'Neither side takes the docks';
    const s = stats.summary();
    document.getElementById('endStats').innerHTML =
      `Score ${G.scoreAtk} — ${G.scoreDef} &nbsp;·&nbsp; K/D ${player.kills}/${player.deaths} &nbsp;·&nbsp; ` +
      `Accuracy ${s.accuracy}% (${s.hits}/${s.shots}) &nbsp;·&nbsp; Damage ${s.damage} &nbsp;·&nbsp; Plants ${s.plants}`;
    end.classList.remove('hidden');
    document.exitPointerLock?.();
  },
});

// ---- viewmodel gun (attached to the camera) ----
const gun = new THREE.Group();
{
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c1e26, roughness: 0.5, metalness: 0.6 });
  const accent = new THREE.MeshStandardMaterial({ color: 0x3a3f52, roughness: 0.4, metalness: 0.7 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.55), dark);
  gun.add(body);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.3), accent);
  barrel.position.set(0, 0.02, -0.4);
  gun.add(barrel);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.1), accent);
  sight.position.set(0, 0.09, -0.1);
  gun.add(sight);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.1), dark);
  grip.position.set(0, -0.12, 0.18);
  grip.rotation.x = 0.35;
  gun.add(grip);
}
gun.position.set(0.3, -0.26, -0.55);
camera.add(gun);
let gunKick = 0;
let bobPhase = 0;

bindInput(renderer.domElement, (locked) => {
  if (!locked && G.buyOpen) setBuyOpen(false);
});

function setBuyOpen(v) {
  if (v && G.phase !== 'buy') return;
  G.buyOpen = v;
  hud.setBuyVisible(v);
  if (v) document.exitPointerLock?.();
}

document.getElementById('playBtn').addEventListener('click', () => {
  initAudio();
  document.getElementById('start').classList.add('hidden');
  hud.showGameHud(true);
  renderer.domElement.requestPointerLock?.();
  if (G.phase === 'menu') rounds.startMatch();
});

document.getElementById('againBtn').addEventListener('click', () => {
  document.getElementById('end').classList.add('hidden');
  hud.showGameHud(true);
  renderer.domElement.requestPointerLock?.();
  rounds.startMatch();
});

addEventListener('keydown', (e) => {
  if (e.code === 'KeyB' && (G.phase === 'buy')) {
    setBuyOpen(!G.buyOpen);
  }
  if (G.buyOpen) {
    const map = { Digit1: 'pistol', Digit2: 'smg', Digit3: 'rifle', Digit4: 'dmr', Digit5: 'frag', Digit6: 'smoke' };
    if (map[e.code]) {
      const r = player.buy(map[e.code]);
      if (!r.ok) hud.feed(r.reason, 'sys');
      hud.renderBuy();
    }
  }
  if (e.code === 'KeyM') {
    // mute toggle, not advertised in the HUD
  }
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---- simulation ----

let simNow = 0;
const STEP = 1 / 60;
let acc = 0;
let last = performance.now();
let shotStaged = false;
let shotSettled = 0;

function fightersAlive(team) {
  let n = 0;
  for (const f of allFighters()) if (f.team === team && f.alive) n++;
  return n;
}

function step(dt) {
  simNow += dt;
  if (G.phase === 'menu' || G.phase === 'matchend') {
    // idle scene behind the overlays: bots stand at spawn
    return;
  }
  rounds.update(dt);
  if (G.phase === 'buy' || G.phase === 'live' || G.phase === 'planted' || G.phase === 'end') {
    if (!SHOT) player.update(dt, G.phase);
    bots.update(dt, simNow, allFighters());
    grenades.update(dt, world, effects, allFighters(), simNow, { onHit: handleHit });
  }
  effects.update(dt, simNow);
}

// In shot mode the staged scene is frozen: the round clock never advances
// and the bots hold their staged poses, so the capture always shows the
// staged moment (the headless screenshot lands a few simulated seconds
// after __shotReady, not at it).
function stepShot(dt) {
  simNow += dt;
  effects.update(dt, simNow);
}

// ---- deterministic shot staging ----

function stageShot() {
  if (!SHOT) return;
  document.getElementById('start').classList.add('hidden');
  hud.showGameHud(true);
  rounds.startMatch();
  const siteA = world.sites.A;
  if (SHOT === 'start') {
    // buy phase, player at spawn looking down mid with two squad mates ahead
    const mates = bots.all().filter((b) => b.team === 'atk' && b.alive).slice(0, 2);
    if (mates[0]) { mates[0].pos.x = -16; mates[0].pos.z = -3.5; mates[0].yaw = -Math.PI / 2; }
    if (mates[1]) { mates[1].pos.x = -16; mates[1].pos.z = 3.5; mates[1].yaw = -Math.PI / 2; }
  } else if (SHOT === 'play') {
    G.phase = 'live';
    G.phaseT = 85;
    // north lane: a clear 12 m firing lane, no container in between
    player.pos.x = -10; player.pos.z = -14;
    player.pitch = 0.01;
    player.loadout.owned.rifle = true;
    player.loadout.ammo.rifle = { mag: 25, reserve: 100 };
    player.loadout.current = 'rifle';
    // put a defender dead-centre in the crosshair and drop it with scripted shots
    const defs = bots.all().filter((b) => b.team === 'def' && b.alive);
    const target = defs[0];
    target.pos.x = player.pos.x + 12;
    target.pos.z = player.pos.z;
    target.yaw = Math.PI / 2;
    // a second defender further down the lane for depth (north of the
    // container row, so the lane stays clear)
    if (defs[1]) { defs[1].pos.x = player.pos.x + 24; defs[1].pos.z = -16.5; defs[1].yaw = Math.PI / 2; }
    player.yaw = Math.atan2(-(target.pos.x - player.pos.x), -(target.pos.z - player.pos.z));
    let shots = 0;
    while (target.alive && shots < 5) {
      player.ammo.mag = 25;
      fireAs(player);
      shots++;
    }
    player.ammo.mag = 25 - shots;
    player.money = 800 + ECONOMY.killReward;
  } else if (SHOT === 'plant') {
    G.phase = 'live';
    G.phaseT = 70;
    G.assignedSite = siteA; // the staged plant is at A: keep the HUD consistent
    player.hasSpike = true;
    G.spike.carrier = player;
    player.pos.x = siteA.cx; player.pos.z = siteA.cz;
    player.yaw = -Math.PI / 2; // look east across the site, down the lane
    player.channel = { type: 'plant', site: siteA, progress: 2.17, needed: 3.5 };
    // a defender pushing in from the north lane, for tension in the frame
    const def = bots.all().find((b) => b.team === 'def' && b.alive);
    if (def) { def.pos.x = -8; def.pos.z = -13.5; def.yaw = Math.PI / 2; }
  } else if (SHOT === 'end') {
    G.scoreAtk = 3; G.scoreDef = 1; G.round = 4;
    G.phase = 'end';
    G.phaseT = 2;
    G.roundWinner = 'atk';
    G.roundReason = 'Spike detonated';
    let down = 0;
    for (const b of bots.all()) {
      if (b.team === 'def' && down < 2) { b.alive = false; b.mesh.visible = false; down++; }
    }
    hud.showBanner('ATTACKERS WIN THE ROUND', 'Spike detonated', 'win');
  }
  bots.syncAllMeshes();
  shotStaged = true;
}

function writeDiag() {
  const diag = {
    shot: SHOT,
    seed: SEED,
    errors,
    phase: G.phase,
    round: G.round,
    score: `${G.scoreAtk}-${G.scoreDef}`,
    site: G.assignedSite?.id ?? null,
    plantedSite: G.plantedSite,
    hp: Math.ceil(player.hp),
    money: player.money,
    kills: player.kills,
    deaths: player.deaths,
    weapon: player.loadout.current,
    ammo: player.ammo ? { mag: player.ammo.mag, reserve: player.ammo.reserve === Infinity ? 'inf' : player.ammo.reserve } : null,
    botsAlive: bots.fighters().length,
    atkAlive: fightersAlive('atk'),
    defAlive: fightersAlive('def'),
    plant: player.channel ? +(player.channel.progress / player.channel.needed).toFixed(2) : null,
    stats: stats.summary(),
  };
  document.getElementById('diag').textContent = JSON.stringify(diag);
}

// ---- frame loop ----

function frame(now) {
  requestAnimationFrame(frame);
  const dtMs = now - last;
  last = now;
  const dt = Math.min(0.1, dtMs / 1000);
  acc += dt;
  let n = 0;
  while (acc >= STEP && n < 5) {
    if (SHOT) stepShot(STEP);
    else step(STEP);
    acc -= STEP;
    n++;
  }

  // camera
  if (player.alive) {
    camera.position.set(player.pos.x, player.eyeY, player.pos.z);
    camera.rotation.y = player.yaw;
    camera.rotation.x = player.pitch;
    camera.rotation.z = 0;
    gun.visible = G.phase !== 'menu';
    // viewmodel bob + recoil
    bobPhase += dt * (player.moving ? (player.sprinting ? 11 : 8) : 0);
    const bob = player.moving ? Math.sin(bobPhase) * 0.008 : 0;
    gunKick = Math.max(0, gunKick - dt * 6);
    gun.position.set(0.3, -0.26 + bob, -0.55 + gunKick * 0.06);
  } else {
    // spectate: chase the first living teammate
    const mate = bots.all().find((b) => b.team === 'atk' && b.alive);
    if (mate) {
      const bx = -Math.sin(mate.yaw), bz = -Math.cos(mate.yaw);
      camera.position.set(mate.pos.x - bx * 3.2, 2.4, mate.pos.z - bz * 3.2);
      camera.lookAt(mate.pos.x + bx * 3, 1.2, mate.pos.z + bz * 3);
    }
    gun.visible = false;
  }

  hud.update(dt, simNow);
  renderer.render(scene, camera);

  if (SHOT && shotStaged && !window.__shotReady) {
    shotSettled++;
    if (shotSettled >= 3) {
      writeDiag();
      window.__shotReady = true;
    }
  }
}

// player fire feeds the viewmodel kick
const origFire = player.fire.bind(player);
player.fire = function fire() {
  const before = player.ammo ? player.ammo.mag : 0;
  origFire();
  if (player.ammo && player.ammo.mag < before) gunKick = 1;
};

if (SHOT) {
  // shot mode: no pointer lock, no menu — stage immediately
  stageShot();
  // invulnerable in shot mode so a capture frame is never a spectate frame
  const origDamage = player.applyDamage.bind(player);
  player.applyDamage = (amount, src) => false;
}

requestAnimationFrame(frame);
