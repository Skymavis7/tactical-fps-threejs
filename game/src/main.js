// Meridian Docks: boot and the one loop. A fixed 60 Hz simulation feeds a render at
// the display's rate; the loop owns shooting, grenades, planting, buying and spectating,
// and every other module owns one job. ?shot=start|play|plant|end with &seed=N stages
// a deterministic frame for a capture, renders it twice, then freezes it and sets
// window.__shotReady. window.__diag (and the #diag element) carry a JSON status for
// headless verification. The shot scripts live in a small SHOTS table so a capture is
// one named staging, not a branch in the loop.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32 } from './rng.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createBody } from './player.js';
import { WEAPONS, GRENADES, createWeaponSet } from './weapons.js';
import { createCombat } from './combat.js';
import { createEffects } from './effects.js';
import { createBots } from './bots.js';
import { createMatch } from './rounds.js';
import { createStats } from './stats.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const random = mulberry32(seed);

// The buy menu's catalogue, shared by the buy phase and the B key.
const BUY_GUNS = [WEAPONS.rifle, WEAPONS.smg, WEAPONS.dmr];
const BUY_NADES = [GRENADES.frag, GRENADES.smoke];
const BUY_KEYS = { Digit1: 'rifle', Digit2: 'smg', Digit3: 'dmr', Digit4: 'frag', Digit5: 'smoke' };

const diag = { errors: [], phase: 'boot', scoreA: 0, scoreB: 0, botsAlive: 0, playerAlive: true, shots: 0 };
window.addEventListener('error', (e) => diag.errors.push(String(e.message || e.error)));
window.addEventListener('unhandledrejection', (e) => diag.errors.push(String(e.reason)));

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 30, 95);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const effects = createEffects(scene);
const audio = createAudio();
const stats = createStats();
const input = createInput(renderer.domElement, onLockChange);
const weapons = createWeaponSet(camera);

// The player figure: a body for movement and a simple mesh below eye level so the
// bots can hit it. The torso and head are returned by reference so combat registers
// the actual meshes instead of depending on their index in the group.
function buildPlayerFigure() {
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color('#20262e'), roughness: 0.85 });
  const vest = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.6 });
  const skin = new THREE.MeshStandardMaterial({ color: new THREE.Color('#c9a184'), roughness: 0.7 });
  const group = new THREE.Group();
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.18), dark);
  legL.position.set(-0.11, 0.25, 0);
  const legR = legL.clone();
  legR.position.x = 0.11;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), vest);
  torso.position.y = 0.82;
  torso.userData.part = 'torso';
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), skin);
  head.position.y = 1.32;
  head.userData.part = 'head';
  group.add(legL, legR, torso, head);
  group.traverse((mesh) => {
    if (mesh.isMesh) mesh.castShadow = true;
  });
  scene.add(group);
  return { group, torso, head };
}

const playerBody = createBody(world.colliders, world.spawns.attack[0]);
const playerFigure = buildPlayerFigure();
const playerOwner = { kind: 'player', ref: null };
const playerState = {
  pos: playerBody.state.position,
  chestY: 1.2,
  yaw: 0,
  alive: true,
};
playerOwner.ref = playerState;

// Match state. The loop reads these; the hooks below write them.
let playerHealth = 100;
let playerKills = 0;
let playerDeaths = 0;
let fragCount = 0;
let smokeCount = 0;
let plantProgress = 0;
let plantingSite = null;
let spectateBot = null;
let started = false;
let shake = 0;
let stepDistance = 0;
let prevFiring = false;
let frozen = false;
let elapsed = 0;
let accumulator = 0;
let lastTime = performance.now();
let minimapAt = 0;

const raycaster = new THREE.Raycaster();
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpV3 = new THREE.Vector3();
const grenades = [];

const hud = createHud(world, { onBuy: buyItem });
hud.onPlay(() => {
  if (shot) return;
  if (match.state.phase === 'matchEnd') {
    restartMatch();
    return;
  }
  audio.unlock();
  input.requestLock();
});

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
  } else if (match.state.phase !== 'matchEnd') {
    hud.showOverlay(started ? 'paused' : 'start');
  }
}

// A combat hit lands on a bot or on the player; the caller owns health and scoring,
// this only routes it. The player's own shots also light the hitmarker.
function handleCombatHit(record, attacker) {
  if (record.kind === 'bot') {
    const bot = record.owner.ref;
    const killed = bots.damage(bot, record.damage, record.part, attacker);
    if (attacker.kind === 'player') {
      stats.recordHit(weapons.current, record.part, record.damage, killed);
      hud.hitMarker(killed);
      audio.hit(killed);
    }
  } else if (record.kind === 'player') {
    damagePlayer(record.damage, attacker);
  }
}

const combat = createCombat(scene, world, effects, handleCombatHit);
combat.registerTarget(playerFigure.torso, playerOwner, 'torso');
combat.registerTarget(playerFigure.head, playerOwner, 'head');

const bots = createBots(scene, world, combat, random, {
  onBotShot(bot) {
    const d = bot.body.state.position.distanceTo(playerBody.state.position);
    if (d < 45) audio.distantShot();
    bots.notifyShot(bot.body.state.position, bot.team, elapsed);
  },
  onBotDeath(bot, attacker, part) {
    // The killer line: the player, a named bot, a frag grenade, or the world.
    // Grenades and world damage have no bot to credit, and naming them here is
    // what keeps the feed honest instead of crashing on a null reference.
    let killer = 'the harbour';
    let weaponName = '—';
    if (attacker.kind === 'player') {
      killer = 'You';
      weaponName = WEAPONS[weapons.current].name;
    } else if (attacker.kind === 'bot' && attacker.ref) {
      killer = attacker.ref.name;
      weaponName = WEAPONS[attacker.ref.weaponId].name;
    } else if (attacker.kind === 'grenade') {
      killer = 'Frag grenade';
      weaponName = GRENADES.frag.name;
    }
    hud.killFeed(killer, bot.name, weaponName, part === 'head');
    if (attacker.kind === 'player') {
      playerKills += 1;
      match.killReward();
      hud.setKills(playerKills, playerDeaths);
      hud.setMoney(match.state.money);
    } else if (attacker.kind === 'bot' && attacker.ref) {
      attacker.ref.kills += 1;
    }
    if (bot.role === 'plant') bots.reassignCarrier(bot.id);
  },
  onPlantDone(bot) {
    match.plantBomb(bot.assignedSite, bot.body.state.position);
  },
  onDefuseDone() {
    match.defuseBomb();
  },
});

const match = createMatch({
  onMatchStart() {
    bots.resetMatch();
    stats.reset();
    playerKills = 0;
    playerDeaths = 0;
    hud.setKills(0, 0);
  },
  onPhase(phase, round) {
    if (phase === 'buy') {
      respawnAll(round);
      hud.showBuy(true, BUY_GUNS, BUY_NADES, match.state.money, new Set(weapons.ownedIds()));
      hud.setScore(match.state.scoreA, match.state.scoreB, round);
      hud.setMoney(match.state.money);
    } else if (phase === 'live') {
      hud.showBuy(false);
      hud.showBanner(`ROUND ${round}`, 'Eliminate the Harbour Watch — or plant the charge.');
    }
  },
  onRoundEnd(winner, reason, a, b) {
    stats.recordRound(match.state.round, winner, reason);
    hud.showBanner(winner === 'A' ? 'ROUND WON' : 'ROUND LOST', `${reason} · ${a} — ${b}`);
    audio.roundWin(winner === 'A');
    hud.setScore(a, b, match.state.round);
    hud.showBuy(false);
  },
  onMatchEnd(winner, a, b) {
    hud.showOverlay('match', `${winner === 'A' ? 'Tidebreakers take the harbour' : 'Harbour Watch holds the docks'} — final score ${a} — ${b}. ${stats.summaryLine()}`);
    if (document.pointerLockElement) document.exitPointerLock();
  },
  onPlant(site) {
    hud.showBanner('CHARGE PLANTED', `Site ${site} — defend it until it blows.`);
    audio.plantBeep(true);
  },
  onDetonate(pos) {
    effects.explosion(pos);
    audio.explosion();
    shake = 1;
  },
});

function respawnAll(round) {
  bots.setLoadout(round);
  bots.spawnRound('a0');
  playerBody.teleport(world.spawns.attack[0].x, world.spawns.attack[0].z, world.spawns.attack[0].yaw);
  playerHealth = 100;
  playerState.alive = true;
  spectateBot = null;
  plantProgress = 0;
  plantingSite = null;
  grenades.length = 0;
  weapons.refillAll();
  playerFigure.group.visible = true;
  hud.setHealth(100);
  hud.setSpectate(null);
  hud.setAmmo(weapons.state().mag, weapons.state().reserve);
  hud.setWeapon(WEAPONS[weapons.current].name);
  hud.setGrenades(fragCount, smokeCount);
  syncCamera();
}

function restartMatch() {
  match.startMatch();
  hud.hideOverlay();
  input.requestLock();
}

function damagePlayer(amount, attacker) {
  if (!playerState.alive) return;
  if (shot) return; // captures are staged: the player never dies mid-frame
  playerHealth -= amount;
  hud.setHealth(playerHealth);
  hud.damageFlash();
  audio.hurt();
  if (playerHealth > 0) return;
  playerHealth = 0;
  playerState.alive = false;
  playerDeaths += 1;
  stats.recordDeath();
  plantProgress = 0;
  plantingSite = null;
  hud.setKills(playerKills, playerDeaths);
  playerFigure.group.visible = false;
  spectateBot = bots.list.find((b) => b.alive && b.team === 'A') || null;
  hud.setSpectate(spectateBot ? spectateBot.name : null);
  hud.showBanner('YOU ARE DOWN', spectateBot ? `Spectating ${spectateBot.name}` : 'No teammates left.');
}

function refreshBuyMenu() {
  hud.showBuy(true, BUY_GUNS, BUY_NADES, match.state.money, new Set(weapons.ownedIds()));
}

function buyItem(id) {
  if (match.state.phase !== 'buy') return;
  const gun = WEAPONS[id];
  if (gun) {
    if (weapons.has(id)) return;
    if (!match.spend(gun.price)) return;
    weapons.buy(id);
    weapons.switchTo(id);
    audio.buy();
  } else {
    const nade = GRENADES[id];
    if (!nade || !match.spend(nade.price)) return;
    if (id === 'frag') fragCount += 1;
    else smokeCount += 1;
    audio.buy();
  }
  hud.setMoney(match.state.money);
  hud.setGrenades(fragCount, smokeCount);
  hud.setAmmo(weapons.state().mag, weapons.state().reserve);
  hud.setWeapon(WEAPONS[weapons.current].name);
  refreshBuyMenu();
}

function throwGrenade(kind) {
  if (!playerState.alive) return;
  if (kind === 'frag' && fragCount <= 0) return;
  if (kind === 'smoke' && smokeCount <= 0) return;
  if (kind === 'frag') fragCount -= 1;
  else smokeCount -= 1;
  hud.setGrenades(fragCount, smokeCount);
  audio.throwPin();
  camera.getWorldDirection(tmpV);
  const pos = playerBody.eyePos(tmpV2).clone().addScaledVector(tmpV, 0.6);
  const vel = tmpV.clone().multiplyScalar(15);
  vel.y += 4.2;
  grenades.push({ kind, pos, vel, fuse: 1.6, bounced: 0 });
}

function explodeGrenade(g) {
  if (g.kind === 'smoke') {
    effects.addSmoke(g.pos, GRENADES.smoke.duration, GRENADES.smoke.radius);
    audio.bounce();
    return;
  }
  effects.explosion(g.pos);
  audio.explosion();
  const dPlayer = g.pos.distanceTo(playerBody.state.position);
  if (dPlayer < 8) shake = Math.max(shake, 1 - dPlayer / 8);
  const victims = [];
  if (playerState.alive) victims.push({ kind: 'player', ref: playerState, pos: playerBody.state.position, chest: 1.2 });
  for (const bot of bots.list) {
    if (bot.alive) victims.push({ kind: 'bot', ref: bot, pos: bot.body.state.position, chest: 1.2 });
  }
  for (const v of victims) {
    tmpV.set(v.pos.x, v.pos.y + v.chest, v.pos.z);
    const d = g.pos.distanceTo(tmpV);
    if (d > GRENADES.frag.radius) continue;
    if (!combat.hasLineOfSight(g.pos, tmpV)) continue;
    const amount = Math.round(GRENADES.frag.damage * (1 - d / (GRENADES.frag.radius + 0.5)));
    if (v.kind === 'player') damagePlayer(amount, { kind: 'grenade', ref: null });
    // A frag kill is reported by onBotDeath, which owns the kill feed — this
    // only applies the damage.
    else bots.damage(v.ref, amount, 'torso', { kind: 'grenade', ref: null });
  }
}

function stepGrenades(dt) {
  for (let i = grenades.length - 1; i >= 0; i -= 1) {
    const g = grenades[i];
    g.fuse -= dt;
    g.vel.y -= 13 * dt;
    const next = g.pos.clone().addScaledVector(g.vel, dt);
    // Ground bounce.
    if (next.y < 0.12) {
      next.y = 0.12;
      g.vel.y = Math.abs(g.vel.y) * 0.42;
      g.vel.x *= 0.7;
      g.vel.z *= 0.7;
      if (g.vel.length() > 3) audio.bounce();
    }
    // Wall bounce: revert the axis that entered a collider, damped.
    let hitBox = null;
    for (const box of world.colliders) {
      if (next.x > box.min.x - 0.12 && next.x < box.max.x + 0.12 && next.y > box.min.y - 0.12 && next.y < box.max.y + 0.12 && next.z > box.min.z - 0.12 && next.z < box.max.z + 0.12) {
        hitBox = box;
        break;
      }
    }
    if (hitBox) {
      const px = Math.min(Math.abs(next.x - (hitBox.min.x - 0.12)), Math.abs(next.x - (hitBox.max.x + 0.12)));
      const pz = Math.min(Math.abs(next.z - (hitBox.min.z - 0.12)), Math.abs(next.z - (hitBox.max.z + 0.12)));
      const py = Math.min(Math.abs(next.y - (hitBox.min.y - 0.12)), Math.abs(next.y - (hitBox.max.y + 0.12)));
      if (px <= pz && px <= py) g.vel.x *= -0.45;
      else if (pz <= py) g.vel.z *= -0.45;
      else g.vel.y *= -0.45;
      next.copy(g.pos);
      if (g.vel.length() > 3) audio.bounce();
    }
    g.pos.copy(next);
    if (g.fuse <= 0) {
      explodeGrenade(g);
      grenades.splice(i, 1);
    }
  }
}

function shootPlayer(spread) {
  const def = WEAPONS[weapons.current];
  if (!weapons.takeRound()) {
    audio.dry();
    return;
  }
  stats.recordShot(weapons.current);
  camera.getWorldDirection(tmpV);
  tmpV.x += (random() * 2 - 1) * spread;
  tmpV.y += (random() * 2 - 1) * spread;
  tmpV.z += (random() * 2 - 1) * spread;
  tmpV.normalize();
  const eye = playerBody.eyePos(tmpV2);
  combat.fire(eye, tmpV, def, playerOwner);
  weapons.pullTrigger();
  playerBody.recoil(def.recoil * (0.85 + random() * 0.3), (random() * 2 - 1) * def.recoil * 0.35);
  audio.shot(def.id);
  bots.notifyShot(playerBody.state.position, 'A', elapsed);
  diag.shots += 1;
  hud.setAmmo(weapons.state().mag, weapons.state().reserve);
}

function syncCamera() {
  if (playerState.alive) {
    camera.position.set(playerBody.state.position.x, playerBody.state.position.y + playerBody.state.eye, playerBody.state.position.z);
    camera.rotation.set(playerBody.state.pitch, playerBody.state.yaw, 0, 'YXZ');
  } else if (spectateBot && spectateBot.alive) {
    const eye = spectateBot.body.eyePos(tmpV);
    camera.position.copy(eye);
    camera.rotation.set(spectateBot.body.state.pitch, spectateBot.body.state.yaw, 0, 'YXZ');
  }
  if (shake > 0) {
    camera.rotation.x += (random() - 0.5) * 0.05 * shake;
    camera.rotation.y += (random() - 0.5) * 0.05 * shake;
  }
}

// What the bots get to know: the player, the bomb, the phase, and the clock. The
// clock is what lets them push late in the round instead of holding forever.
function botContext() {
  playerState.pos = playerBody.state.position;
  playerState.chestY = playerBody.state.crouching ? 0.75 : 1.2;
  playerState.yaw = playerBody.state.yaw;
  return {
    player: playerState,
    bomb: match.state.bomb,
    phase: match.state.phase,
    timeLeft: match.state.timeLeft,
  };
}

function pollKeys() {
  const phase = match.state.phase;
  const live = phase === 'live' || phase === 'planted';
  const pressed = input.takePressed();
  if (!started || shot) return;
  for (const code of pressed) {
    if (code === 'KeyM') audio.setMuted(!audio.isMuted());
    if (code === 'KeyB' && phase === 'buy') refreshBuyMenu();
    if (code === 'KeyR' && playerState.alive && weapons.reload()) audio.reload();
    if (code === 'KeyG' && live) throwGrenade('frag');
    if (code === 'KeyH' && live) throwGrenade('smoke');
    if (code === 'KeyQ' && playerState.alive) {
      const owned = weapons.ownedIds();
      const next = owned[(owned.indexOf(weapons.current) + 1) % owned.length];
      if (weapons.switchTo(next)) {
        hud.setWeapon(WEAPONS[next].name);
        hud.setAmmo(weapons.state().mag, weapons.state().reserve);
      }
    }
    if (phase === 'buy') {
      if (BUY_KEYS[code]) buyItem(BUY_KEYS[code]);
    } else if (live && playerState.alive) {
      const owned = weapons.ownedIds();
      const switchMap = { Digit1: owned[0], Digit2: owned[1], Digit3: owned[2] };
      if (switchMap[code] && weapons.switchTo(switchMap[code])) {
        hud.setWeapon(WEAPONS[weapons.current].name);
        hud.setAmmo(weapons.state().mag, weapons.state().reserve);
      }
    }
  }
}

function drivePlayer(dt) {
  const phase = match.state.phase;
  const live = phase === 'live' || phase === 'planted';
  if (!playerState.alive || !started || frozen) return;
  const look = input.takeLook();
  playerBody.look(look.x, look.y);
  const def = WEAPONS[weapons.current];
  const firing = input.state.firing;
  if (firing && live && (def.auto || !prevFiring) && weapons.canFire()) {
    shootPlayer(weapons.spread(playerBody.groundSpeed()));
  }
  prevFiring = firing;
  // Planting: hold E inside a site during the live phase.
  if (live && !match.state.bomb.planted && input.state.keys.has('KeyE')) {
    let site = null;
    for (const [name, s] of Object.entries(world.sites)) {
      if (Math.hypot(playerBody.state.position.x - s.center.x, playerBody.state.position.z - s.center.z) < s.radius) site = name;
    }
    if (site) {
      plantingSite = site;
      plantProgress += dt / 3.5;
      hud.setPlant(plantProgress, `PLANTING — SITE ${site}`);
      if (plantProgress >= 1) {
        match.plantBomb(site, playerBody.state.position);
        stats.recordPlantDone();
        plantProgress = 0;
        plantingSite = null;
        hud.setPlant(0);
      }
    } else {
      plantProgress = 0;
      hud.setPlant(0);
    }
  } else if (plantProgress > 0) {
    plantProgress = 0;
    hud.setPlant(0);
  }
  // Movement, with a footstep every couple of metres on the ground.
  const before = playerBody.state.position.clone();
  playerBody.step(dt, input.state.keys, input.state.aiming ? 0.55 : 1);
  const moved = playerBody.state.position.distanceTo(before);
  stepDistance += moved;
  if (stepDistance > 2.2 && playerBody.state.onGround && moved > 0) {
    stepDistance = 0;
    audio.step();
  }
}

function step(dt) {
  elapsed += dt;
  const phase = match.state.phase;

  pollKeys();
  drivePlayer(dt);
  weapons.step(dt, input.state.aiming && playerState.alive);

  // Aim-down-sights field of view.
  const targetFov = 74 - weapons.adsAmount * (74 - WEAPONS[weapons.current].adsFov);
  if (Math.abs(camera.fov - targetFov) > 0.1) {
    camera.fov = targetFov;
    camera.updateProjectionMatrix();
  }

  bots.step(dt, elapsed, botContext());
  stepGrenades(dt);
  effects.step(dt);
  if (started) {
    match.step(dt, {
      A: (playerState.alive ? 1 : 0) + bots.aliveCount('A'),
      B: bots.aliveCount('B'),
    });
  }
  shake = Math.max(0, shake - dt * 1.8);

  // HUD (minimap throttled to four times a second). The ammo line is refreshed
  // every frame so a reload that finishes between shots shows up at once — the
  // setter itself skips the write when nothing changed.
  hud.setHealth(playerHealth);
  hud.setTimer(match.state.timeLeft, match.state.bomb.planted);
  hud.setMoney(match.state.money);
  hud.setAmmo(weapons.state().mag, weapons.state().reserve);
  hud.setCrosshair(6 + weapons.spread(playerBody.groundSpeed()) * 900);
  if (elapsed - minimapAt > 0.25) {
    minimapAt = elapsed;
    hud.drawMinimap(playerState, bots.list, match.state.bomb);
  }
  playerFigure.group.position.copy(playerBody.state.position);
  playerFigure.group.rotation.y = playerBody.state.yaw;
  playerState.chestY = playerBody.state.crouching ? 0.75 : 1.2;
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function aimAt(point) {
  const eye = playerBody.eyePos(tmpV);
  const dx = point.x - eye.x;
  const dy = point.y - eye.y;
  const dz = point.z - eye.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  playerBody.state.yaw = Math.atan2(-dx, -dz);
  playerBody.state.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
      diag.phase = match.state.phase;
      diag.scoreA = match.state.scoreA;
      diag.scoreB = match.state.scoreB;
      diag.botsAlive = bots.list.filter((b) => b.alive).length;
      diag.playerAlive = playerState.alive;
      document.getElementById('diag').textContent = JSON.stringify(diag);
    }
  }
  requestAnimationFrame(paint);
}

// One named staging per capture. Each one teleports the player, settles the sim,
// and leaves the frame exactly where the screenshot wants it.
const SHOTS = {
  start() {
    playerBody.teleport(0, 14, 0);
    settle(20);
    aimAt(new THREE.Vector3(0, 1.5, -9));
    hud.showOverlay('start');
  },
  play() {
    playerBody.teleport(0, 6, 0);
    weapons.buy('rifle');
    weapons.switchTo('rifle');
    hud.setWeapon(WEAPONS.rifle.name);
    settle(170);
    // Face the nearest living defender with a line of sight; fall back to nearest.
    let best = null;
    let bestD = Infinity;
    for (const bot of bots.list) {
      if (!bot.alive || bot.team !== 'B') continue;
      const eye = playerBody.eyePos(tmpV);
      tmpV2.set(bot.body.state.position.x, 1.2, bot.body.state.position.z);
      const d = eye.distanceTo(tmpV2);
      const los = combat.hasLineOfSight(eye, tmpV2);
      if (los && d < bestD) {
        bestD = d;
        best = bot;
      }
    }
    if (!best) best = bots.list.filter((b) => b.alive && b.team === 'B')[0];
    if (best) {
      // Re-aim before every shot: the target walks between shots.
      for (let round = 0; round < 3; round += 1) {
        aimAt(new THREE.Vector3(best.body.state.position.x, 1.2, best.body.state.position.z));
        shootPlayer(0);
        settle(6);
      }
      settle(4);
    }
    hud.setAmmo(weapons.state().mag, weapons.state().reserve);
  },
  plant() {
    playerBody.teleport(-19, -6, Math.PI * 0.9);
    settle(40);
    plantProgress = 0.62;
    hud.setPlant(0.62, 'PLANTING — SITE A');
    aimAt(new THREE.Vector3(-19, 1.2, -9));
  },
  end() {
    match.state.scoreA = 2;
    match.state.scoreB = 1;
    match.state.round = 4;
    hud.setScore(2, 1, 4);
    settle(120);
    // Two defenders down for the scoreboard read.
    const fallen = bots.list.filter((b) => b.alive && b.team === 'B').slice(0, 2);
    for (const bot of fallen) bots.damage(bot, 500, 'torso', playerOwner);
    match.endRound('A', 'Harbour Watch eliminated');
    settle(10);
    hud.showBanner('ROUND WON', 'Harbour Watch eliminated · 3 — 1', true);
  },
};

function runShot(name) {
  started = true;
  hud.hideOverlay();
  hud.showBuy(false);
  // Buy phase gives the bots their routes; settle so they walk out of spawn.
  settle(30);
  match.startLive();
  SHOTS[name]();
  hud.setScore(match.state.scoreA, match.state.scoreB, match.state.round);
  hud.setAmmo(weapons.state().mag, weapons.state().reserve);
  hud.setHealth(playerHealth);
  paintTwiceThenReady();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

diag.phase = match.state.phase;
match.startMatch();
syncCamera();
if (shot) runShot(shot);
else requestAnimationFrame(frame);
