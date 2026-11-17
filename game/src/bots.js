// Squad AI for Meridian Docks. Nine bots play a real round of tactical FPS against
// the player: attackers split into two fireteams (Alpha hits Site A, Bravo hits Site B),
// defenders hold crossfire pairs at each site with one roamer in mid. Each bot runs a
// small state machine — advance, clear, hold, contact, execute, plant, defuse, retake,
// guard — and perceives the world the way a player does: a field of view, line of
// sight, a short spotting delay before a target counts, hearing that only reaches so
// far, and intel shared with its fireteam when it spots someone. Fire is burst-based
// and per-bot: every bot rolls a skill profile (reaction, burst length, accuracy,
// strafe) at spawn, so the point man is quick and the anchor is patient. The public
// surface is deliberately narrow: main.js drives spawnRound / step / damage and reads
// bot.alive, bot.role, bot.assignedSite and the meshes it registered as targets.
import * as THREE from 'three';
import { createBody } from './player.js';
import { WEAPONS } from './weapons.js';

const THINK_HZ = 10;
const HEARING_RADIUS = 28;
const VISION_RANGE = 46;
const FOV_COS = Math.cos((110 * Math.PI) / 180 / 2);
const PLANT_CHANNEL = 3.5;
const DEFUSE_CHANNEL = 5;
const BOMB_GUARD_RADIUS = 9;

const ATTACK_NAMES = ['Raka', 'Bima', 'Sari', 'Dewi'];
const DEFEND_NAMES = ['Agus', 'Putri', 'Joko', 'Maya', 'Eko'];

// A bot's eyes sit a little below the top of its head; the chest is the target the
// player aims at most of the time.
const EYE_HEIGHT = 1.52;
const CHEST_HEIGHT = 1.18;

function angleTo(from, to) {
  return Math.atan2(-(to.x - from.x), -(to.z - from.z));
}

function flatDistance(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.hypot(dx, dz);
}

// One figure, two uniforms: attackers wear the safety-orange trim of the
// Tidebreakers, defenders the harbour teal of the Watch. The silhouette is a
// crouched-ready operator — slim torso, chest plate, backpack with antenna,
// shoulder pads, visor — and the torso/head meshes are the hit targets.
function buildBotFigure(team) {
  const trim = team === 'A' ? 0xff8a2a : 0x35c4b5;
  const cloth = team === 'A' ? 0x8a6b52 : 0x4a5a66;
  const dark = 0x232a31;
  const skin = 0xc9a184;

  const figure = new THREE.Group();
  const clothMat = new THREE.MeshStandardMaterial({ color: cloth, roughness: 0.92 });
  const darkMat = new THREE.MeshStandardMaterial({ color: dark, roughness: 0.85 });
  const trimMat = new THREE.MeshStandardMaterial({ color: trim, roughness: 0.5, emissive: trim, emissiveIntensity: 0.25 });
  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.8 });

  function box(w, h, d, mat, x, y, z, parent = figure) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }

  // Legs — slightly staggered, one forward, so the figure reads as moving.
  box(0.17, 0.52, 0.2, darkMat, -0.11, 0.26, 0.04);
  box(0.17, 0.52, 0.2, darkMat, 0.11, 0.26, -0.05);
  // Torso, slim and upright, with a chest plate on the front.
  const torso = box(0.42, 0.56, 0.26, clothMat, 0, 1.06, 0);
  box(0.44, 0.34, 0.05, darkMat, 0, 1.1, -0.15);
  // Shoulder pads and the trim stripe that marks the team.
  box(0.16, 0.09, 0.28, darkMat, -0.26, 1.32, 0);
  box(0.16, 0.09, 0.28, darkMat, 0.26, 1.32, 0);
  box(0.44, 0.04, 0.27, trimMat, 0, 1.28, 0);
  // Backpack with a radio antenna — the thing you see first over a crate.
  box(0.3, 0.42, 0.13, darkMat, 0, 1.08, 0.19);
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.42, 6), darkMat);
  antenna.position.set(0.12, 1.48, 0.2);
  figure.add(antenna);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 6), trimMat);
  tip.position.set(0.12, 1.7, 0.2);
  figure.add(tip);
  // Head with a visor band — the headshot target.
  const head = box(0.26, 0.26, 0.26, skinMat, 0, 1.52, 0);
  box(0.27, 0.08, 0.03, trimMat, 0, 1.55, -0.14);
  box(0.28, 0.06, 0.28, darkMat, 0, 1.67, 0); // helmet brim
  // Arms angled forward onto the rifle.
  const armL = box(0.12, 0.48, 0.15, clothMat, -0.29, 1.04, -0.1);
  armL.rotation.x = -0.55;
  const armR = box(0.12, 0.48, 0.15, clothMat, 0.29, 1.04, -0.1);
  armR.rotation.x = -0.55;
  // The rifle itself, carried low and forward.
  box(0.06, 0.1, 0.72, darkMat, 0.05, 1.22, -0.32);
  box(0.05, 0.14, 0.05, darkMat, 0.05, 1.22, -0.6); // foregrip

  figure.traverse((mesh) => {
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  return { figure, torso, head };
}

export function createBots(scene, world, combat, random, hooks) {
  const bots = [];
  const eyeScratch = new THREE.Vector3();
  const targetScratch = new THREE.Vector3();
  const dirScratch = new THREE.Vector3();

  function rollSkill(role) {
    // Point men are quick, anchors are steady, everyone else sits in between.
    const quick = role === 'point' ? 0.55 : role === 'hold' ? 0.25 : 0.4;
    return {
      reaction: Math.max(0.15, 0.35 + random() * 0.45 - quick * 0.2),
      burst: 2 + Math.floor(random() * 4),
      accuracy: 0.75 + random() * 0.5,
      strafe: random() < 0.55,
    };
  }

  function makeBot(id, name, team, spawn) {
    const { figure, torso, head } = buildBotFigure(team);
    figure.visible = false;
    scene.add(figure);
    const body = createBody(world.colliders, spawn);
    const bot = {
      id,
      name,
      team,
      body,
      mesh: figure,
      torsoMesh: torso,
      headMesh: head,
      health: 100,
      alive: false,
      kills: 0,
      deaths: 0,
      weaponId: 'pistol',
      baseWeapon: 'pistol',
      role: 'hold',
      slot: 'rifler',
      fireteam: 'alpha',
      assignedSite: 'A',
      mode: 'hold',
      path: [],
      pathIndex: 0,
      holdPos: null,
      holdYaw: 0,
      holdNode: null,
      patrolNode: 'm2',
      target: null,
      contact: null, // { kind, target, pos, seenAt, reactAt, committed }
      reportedPos: null, // intel from a fireteam mate
      reportedAt: -99,
      heardPos: null,
      heardAt: -99,
      skill: rollSkill('rifler'),
      burstLeft: 0,
      nextShotAt: 0,
      burstPauseUntil: 0,
      thinkAt: random() * 0.1,
      clearUntil: 0,
      clearedAt: -99,
      sweepYaw: 0,
      channelUntil: 0,
      channelSite: null,
      stuckAt: 0,
      lastPathPos: new THREE.Vector3(),
      repathAt: 0,
      fallT: 0,
      strafeDir: 1,
      strafeUntil: 0,
      owner: null,
    };
    bot.owner = { kind: 'bot', ref: bot };
    combat.registerTarget(torso, bot.owner, 'torso');
    combat.registerTarget(head, bot.owner, 'head');
    bots.push(bot);
    return bot;
  }

  // Attackers use spawns 1..4 — spawn 0 is the player's. Defenders use all five.
  for (let i = 0; i < ATTACK_NAMES.length; i += 1) {
    makeBot(`a${i}`, ATTACK_NAMES[i], 'A', world.spawns.attack[i + 1]);
  }
  for (let i = 0; i < DEFEND_NAMES.length; i += 1) {
    makeBot(`d${i}`, DEFEND_NAMES[i], 'B', world.spawns.defend[i]);
  }

  function fireteamOf(bot) {
    return bots.filter((other) => other.team === bot.team && other.fireteam === bot.fireteam && other !== bot && other.alive);
  }

  function routeTo(bot, x, z) {
    const from = world.waypoints.nearestNode(bot.body.state.position.x, bot.body.state.position.z);
    const to = world.waypoints.nearestNode(x, z);
    bot.path = world.waypoints.pathBetween(from.id, to.id);
    bot.pathIndex = 0;
    bot.lastPathPos.copy(bot.body.state.position);
    bot.stuckAt = 0;
    return bot.path.length > 0;
  }

  function setHold(bot, x, z, yaw) {
    bot.holdPos = new THREE.Vector3(x, 0, z);
    bot.holdYaw = yaw;
    bot.mode = 'hold';
    bot.path = [];
    bot.pathIndex = 0;
  }

  function assignRound(carrierId) {
    // Attackers: Alpha (a0 point, a1 rifler) takes A, Bravo (a2 support, a3 rifler)
    // takes B. The carrier keeps the 'plant' role so the round logic can find it.
    const attackers = bots.filter((b) => b.team === 'A');
    attackers.forEach((bot, index) => {
      bot.fireteam = index < 2 ? 'alpha' : 'bravo';
      bot.slot = index === 0 ? 'point' : index === 2 ? 'support' : 'rifler';
      bot.assignedSite = index < 2 ? 'A' : 'B';
      bot.role = bot.id === carrierId ? 'plant' : bot.slot;
      bot.skill = rollSkill(bot.slot);
    });
    // Defenders: a pair holds each site in crossfire (hA/hA2, hB/hB2), one roams mid.
    const defenders = bots.filter((b) => b.team === 'B');
    defenders.forEach((bot, index) => {
      if (index < 2) {
        bot.fireteam = 'a';
        bot.assignedSite = 'A';
        bot.role = 'hold';
        bot.holdNode = index === 0 ? 'hA' : 'hA2';
      } else if (index < 4) {
        bot.fireteam = 'b';
        bot.assignedSite = 'B';
        bot.role = 'hold';
        bot.holdNode = index === 2 ? 'hB' : 'hB2';
      } else {
        bot.fireteam = 'mid';
        bot.assignedSite = 'A';
        bot.role = 'roam';
        bot.holdNode = null;
      }
      bot.skill = rollSkill(bot.role);
    });
  }

  function spawnRound(carrierId) {
    assignRound(carrierId);
    for (const bot of bots) {
      const spawnList = bot.team === 'A' ? world.spawns.attack : world.spawns.defend;
      const teamIndex = bots.filter((b) => b.team === bot.team).indexOf(bot);
      const spawn = bot.team === 'A' ? spawnList[teamIndex + 1] : spawnList[teamIndex];
      bot.body.teleport(spawn.x, spawn.z, spawn.yaw);
      bot.mesh.visible = true;
      bot.mesh.position.copy(bot.body.state.position);
      bot.mesh.rotation.set(0, bot.body.state.yaw, 0);
      bot.health = 100;
      bot.alive = true;
      bot.mode = 'advance';
      bot.target = null;
      bot.contact = null;
      bot.reportedPos = null;
      bot.heardPos = null;
      bot.fallT = 0;
      bot.burstLeft = 0;
      bot.nextShotAt = 0;
      bot.channelUntil = 0;
      bot.channelSite = null;
      bot.path = [];
      bot.pathIndex = 0;
      bot.thinkAt = random() * 0.1;
      bot.clearUntil = 0;
      bot.clearedAt = -99;
      // Targets are registered once at creation and unregistered on death, so a
      // new round only re-registers the ones a death took out.
      if (!bot.torsoMesh.userData.combat) combat.registerTarget(bot.torsoMesh, bot.owner, 'torso');
      if (!bot.headMesh.userData.combat) combat.registerTarget(bot.headMesh, bot.owner, 'head');
      if (bot.team === 'A') {
        const siteDef = world.sites[bot.assignedSite];
        routeTo(bot, siteDef.center.x, siteDef.center.z);
      } else if (bot.role === 'roam') {
        routeTo(bot, 0, 4);
      } else {
        // Walk to the hold node, then settle into the angle.
        const node = world.waypoints.nodeById.get(bot.holdNode);
        bot.holdPos = new THREE.Vector3(node.x, 0, node.z);
        bot.holdYaw = Math.atan2(-(0 - node.x), -(0 - node.z));
        routeTo(bot, node.x, node.z);
      }
    }
  }

  function setLoadout(round) {
    bots.forEach((bot) => {
      if (round <= 1) {
        bot.weaponId = 'pistol';
        return;
      }
      bot.baseWeapon = bot.team === 'A'
        ? (bot.slot === 'point' ? 'smg' : bot.slot === 'support' ? 'rifle' : 'dmr')
        : (bot.role === 'roam' ? 'smg' : 'rifle');
      bot.weaponId = bot.baseWeapon;
    });
  }

  function carrier() {
    return bots.find((bot) => bot.team === 'A' && bot.alive && bot.role === 'plant') || null;
  }

  function reassignCarrier(deadId) {
    const dead = bots.find((bot) => bot.id === deadId);
    if (dead && dead.role === 'plant') dead.role = dead.slot;
    const next = bots.find((bot) => bot.team === 'A' && bot.alive && bot.id !== deadId);
    if (next) next.role = 'plant';
  }

  function aliveCount(team) {
    return bots.filter((bot) => bot.team === team && bot.alive).length;
  }

  function resetMatch() {
    bots.forEach((bot) => {
      bot.kills = 0;
      bot.deaths = 0;
    });
  }

  function notifyShot(pos, shooterTeam, now) {
    // A shot is a sound: enemies inside the hearing radius get a position to
    // investigate once. The shooter's own team already knows where it is.
    for (const bot of bots) {
      if (!bot.alive || bot.team === shooterTeam) continue;
      const d = Math.hypot(bot.body.state.position.x - pos.x, bot.body.state.position.z - pos.z);
      if (d <= HEARING_RADIUS) {
        bot.heardPos = new THREE.Vector3(pos.x, 0, pos.z);
        bot.heardAt = now;
      }
    }
  }

  function damage(bot, amount, part, attacker) {
    if (!bot.alive) return false;
    bot.health -= amount;
    if (bot.health > 0) {
      // A hit interrupts a channel and tells the bot where the pain came from.
      if (bot.mode === 'plant' || bot.mode === 'defuse') {
        bot.mode = bot.team === 'A' ? 'advance' : 'retake';
        bot.channelUntil = 0;
      }
      if (attacker && attacker.ref && attacker.ref.body) {
        const from = attacker.ref.body.state.position;
        bot.reportedPos = new THREE.Vector3(from.x, 0, from.z);
        bot.reportedAt = performance.now() / 1000;
      }
      return false;
    }
    bot.alive = false;
    bot.deaths += 1;
    bot.fallT = 0;
    bot.mode = 'dead';
    bot.target = null;
    bot.contact = null;
    combat.unregisterTarget(bot.torsoMesh);
    combat.unregisterTarget(bot.headMesh);
    // Kill credit, the kill feed and the carrier handoff live in main.js, which
    // owns scoring — this only reports the death and who caused it.
    hooks.onBotDeath(bot, attacker || { kind: 'world', ref: null }, part);
    return true;
  }

  // --- perception ----------------------------------------------------------

  function canSee(bot, enemyPos, enemyChestY) {
    const eye = bot.body.eyePos(eyeScratch);
    targetScratch.set(enemyPos.x, enemyPos.y + enemyChestY, enemyPos.z);
    dirScratch.copy(targetScratch).sub(eye);
    const distance = dirScratch.length();
    if (distance > VISION_RANGE || distance < 0.5) return false;
    dirScratch.normalize();
    const forwardX = -Math.sin(bot.body.state.yaw);
    const forwardZ = -Math.cos(bot.body.state.yaw);
    if (forwardX * dirScratch.x + forwardZ * dirScratch.z < FOV_COS) return false;
    return combat.hasLineOfSight(eye, targetScratch);
  }

  function scanForEnemies(bot, ctx) {
    // The nearest visible enemy wins — the player first if they are the closest.
    let best = null;
    let bestD = Infinity;
    const consider = (kind, ref, pos, chestY) => {
      if (!canSee(bot, pos, chestY)) return;
      const d = bot.body.state.position.distanceTo(pos);
      if (d < bestD) {
        bestD = d;
        best = { kind, ref, pos, chestY, dist: d };
      }
    };
    if (ctx.player && ctx.player.alive) {
      consider('player', null, ctx.player.pos, ctx.player.chestY || CHEST_HEIGHT);
    }
    for (const other of bots) {
      if (other.team === bot.team || !other.alive) continue;
      consider('bot', other, other.body.state.position, CHEST_HEIGHT);
    }
    return best;
  }

  function shareIntel(bot, enemyPos, now) {
    // The spotter tells its fireteam where the enemy is; mates pre-aim there.
    for (const mate of fireteamOf(bot)) {
      mate.reportedPos = new THREE.Vector3(enemyPos.x, 0, enemyPos.z);
      mate.reportedAt = now;
    }
  }

  // --- firing --------------------------------------------------------------

  function aimError(bot, enemy, distance, targetSpeed) {
    // Error grows with range and with how fast the target is moving, and shrinks
    // when the bot is still and crouched. A skilled bot is simply tighter.
    const still = bot.body.groundSpeed() < 0.5 ? 0.7 : 1;
    const crouched = bot.body.state.crouching ? 0.8 : 1;
    const base = (0.028 + distance * 0.0016 + targetSpeed * 0.006) * still * crouched;
    return base / bot.skill.accuracy;
  }

  function fireAt(bot, enemy, now) {
    const def = WEAPONS[bot.weaponId];
    if (now < bot.nextShotAt) return;
    if (bot.burstLeft <= 0) {
      if (now < bot.burstPauseUntil) return;
      bot.burstLeft = bot.skill.burst;
      bot.burstPauseUntil = now + 0.45 + random() * 0.5;
    }
    bot.burstLeft -= 1;
    bot.nextShotAt = now + def.fireGap;

    const eye = bot.body.eyePos(eyeScratch);
    const enemyPos = enemy.pos;
    const targetSpeed = enemy.kind === 'bot' && enemy.ref ? enemy.ref.body.groundSpeed() : 0;
    const distance = eye.distanceTo(targetScratch.set(enemyPos.x, enemyPos.y + enemy.chestY, enemyPos.z));
    const error = aimError(bot, enemy, distance, targetSpeed);
    dirScratch.copy(targetScratch).sub(eye).normalize();
    // Jitter the aim point rather than the direction: a miss lands near the target.
    dirScratch.x += (random() - 0.5) * error * 2;
    dirScratch.y += (random() - 0.5) * error * 2;
    dirScratch.z += (random() - 0.5) * error * 2;
    dirScratch.normalize();
    combat.fire(eye, dirScratch, def, bot.owner);
    hooks.onBotShot(bot);
    bot.body.recoil(0.012 + random() * 0.008, (random() - 0.5) * 0.01);
  }

  // --- movement ------------------------------------------------------------

  function followPath(bot, dt, now, speedScale, sneak) {
    if (bot.pathIndex >= bot.path.length) return true;
    const node = bot.path[bot.pathIndex];
    const pos = bot.body.state.position;
    const dx = node.x - pos.x;
    const dz = node.z - pos.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.7) {
      bot.pathIndex += 1;
      return bot.pathIndex >= bot.path.length;
    }
    // Turn toward the node, then walk. A bot that makes no progress for a while
    // re-paths once, then walks straight at the goal.
    const desiredYaw = Math.atan2(-dx, -dz);
    let yawDiff = desiredYaw - bot.body.state.yaw;
    while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
    while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
    bot.body.state.yaw += Math.max(-3.2 * dt, Math.min(3.2 * dt, yawDiff));
    const keys = new Set(['KeyW']);
    if (sneak) keys.add('ControlLeft');
    bot.body.step(dt, keys, speedScale);
    if (flatDistance(pos, bot.lastPathPos) > 0.4) {
      bot.lastPathPos.copy(pos);
      bot.stuckAt = now;
    } else if (now - bot.stuckAt > 2.5 && now - bot.repathAt > 4) {
      bot.repathAt = now;
      const goal = bot.path[bot.path.length - 1];
      routeTo(bot, goal.x, goal.z);
    }
    return false;
  }

  function walkToward(bot, dt, x, z, speedScale) {
    // The last mile: no waypoint, just face the point and walk at it. Used when
    // the graph ends a few metres short of the objective.
    const pos = bot.body.state.position;
    const dx = x - pos.x;
    const dz = z - pos.z;
    if (Math.hypot(dx, dz) < 0.6) return true;
    const desiredYaw = Math.atan2(-dx, -dz);
    let yawDiff = desiredYaw - bot.body.state.yaw;
    while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
    while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
    bot.body.state.yaw += Math.max(-3.2 * dt, Math.min(3.2 * dt, yawDiff));
    bot.body.step(dt, new Set(['KeyW']), speedScale);
    return false;
  }

  function faceToward(bot, target, dt) {
    const pos = bot.body.state.position;
    const desiredYaw = angleTo(pos, target);
    let yawDiff = desiredYaw - bot.body.state.yaw;
    while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
    while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
    bot.body.state.yaw += Math.max(-4 * dt, Math.min(4 * dt, yawDiff));
  }

  function strafeKeys(bot, now) {
    // In a fight a bot strafes in bursts, changing direction every half second
    // or so, and crouches when it is holding an angle rather than pushing.
    if (now > bot.strafeUntil) {
      bot.strafeDir = random() < 0.5 ? -1 : 1;
      bot.strafeUntil = now + 0.4 + random() * 0.5;
    }
    const keys = new Set();
    if (bot.skill.strafe) keys.add(bot.strafeDir < 0 ? 'KeyA' : 'KeyD');
    if (bot.mode === 'hold' && random() < 0.3) keys.add('KeyC');
    return keys;
  }

  // --- the think tick (10 Hz) ----------------------------------------------

  function think(bot, ctx, now) {
    if (!bot.alive) return;
    const pos = bot.body.state.position;
    const bomb = ctx.bomb;
    const phase = ctx.phase;

    // Perception: a visible enemy takes a moment to register (reaction), then
    // the bot commits to the fight and tells its fireteam.
    const seen = scanForEnemies(bot, ctx);
    if (seen) {
      const sameTarget = bot.contact && bot.contact.kind === seen.kind && bot.contact.target === seen.ref;
      if (!sameTarget) {
        bot.contact = {
          kind: seen.kind,
          target: seen.ref,
          pos: new THREE.Vector3(seen.pos.x, 0, seen.pos.z),
          seenAt: now,
          reactAt: now + bot.skill.reaction,
          committed: false,
        };
      } else {
        bot.contact.pos.set(seen.pos.x, 0, seen.pos.z);
        bot.contact.seenAt = now;
      }
      if (!bot.contact.committed) {
        bot.contact.committed = true;
        shareIntel(bot, seen.pos, now);
      }
      if (now >= bot.contact.reactAt) {
        bot.target = seen;
        if (bot.mode !== 'plant' && bot.mode !== 'defuse') bot.mode = 'contact';
      }
    } else if (bot.contact) {
      // Lost sight: keep the last known position for a few seconds, then let go.
      if (now - bot.contact.seenAt > 4) {
        bot.contact = null;
        bot.target = null;
        if (bot.mode === 'contact') bot.mode = bot.team === 'A' ? 'advance' : 'hold';
      }
    }

    if (bot.mode === 'contact') return; // the fight drives the frame step below.

    // The bomb changes everyone's job.
    if (bomb && bomb.planted) {
      if (bot.team === 'A') {
        if (bot.mode !== 'guard') {
          const siteDef = world.sites[bomb.site];
          const d = flatDistance(pos, siteDef.center);
          if (d > BOMB_GUARD_RADIUS) routeTo(bot, siteDef.center.x, siteDef.center.z);
          bot.mode = 'guard';
        }
        return;
      }
      // Defenders retake, then defuse when they reach the charge.
      if (bot.mode !== 'defuse' && bot.mode !== 'retake') {
        routeTo(bot, bomb.pos.x, bomb.pos.z);
        bot.mode = 'retake';
      }
      if (bot.mode === 'retake' && flatDistance(pos, bomb.pos) < 2.2) {
        bot.mode = 'defuse';
        bot.channelUntil = now + DEFUSE_CHANNEL;
      }
      return;
    }

    if (phase !== 'live') return;

    if (bot.team === 'A') {
      // The carrier plants when it reaches its site; everyone else pushes.
      if (bot.role === 'plant' && bot.mode !== 'plant') {
        const siteDef = world.sites[bot.assignedSite];
        if (flatDistance(pos, siteDef.center) <= siteDef.radius) {
          bot.mode = 'plant';
          bot.channelUntil = now + PLANT_CHANNEL;
          bot.channelSite = bot.assignedSite;
          return;
        }
      }
      const attackersAlive = aliveCount('A');
      const defendersAlive = aliveCount('B');
      const timeLeft = ctx.timeLeft ?? 99;
      const numbersUp = attackersAlive > defendersAlive;
      const late = timeLeft < 35;
      if ((numbersUp || late) && bot.mode !== 'execute') {
        const siteDef = world.sites[bot.assignedSite];
        routeTo(bot, siteDef.center.x, siteDef.center.z);
        bot.mode = 'execute';
      }
      if (bot.mode === 'advance' || bot.mode === 'execute') {
        // A sound worth investigating pulls one bot off the route, once.
        if (bot.heardPos && now - bot.heardAt < 6 && bot.mode === 'advance') {
          const heard = bot.heardPos;
          bot.heardPos = null;
          routeTo(bot, heard.x, heard.z);
        }
        // Near the site, pause and clear the corners before pushing in.
        if (bot.mode === 'advance' && bot.pathIndex >= bot.path.length - 1 && now - bot.clearedAt > 8) {
          const siteDef = world.sites[bot.assignedSite];
          if (flatDistance(pos, siteDef.center) < 12) {
            bot.clearedAt = now;
            bot.clearUntil = now + 0.7;
            bot.sweepYaw = bot.body.state.yaw - 0.9;
          }
        }
      }
      return;
    }

    // Defenders: walk to the hold angle and settle, or patrol mid if that is the job.
    if (bot.role === 'hold') {
      if (bot.mode === 'advance' && bot.pathIndex >= bot.path.length) {
        setHold(bot, bot.holdPos.x, bot.holdPos.z, bot.holdYaw);
      } else if (bot.mode === 'hold' && bot.holdPos && flatDistance(pos, bot.holdPos) > 1.5) {
        routeTo(bot, bot.holdPos.x, bot.holdPos.z);
        bot.mode = 'advance';
      }
      return;
    }
    if (bot.role === 'roam') {
      if (bot.mode === 'advance' && bot.pathIndex >= bot.path.length) {
        // Reached one end of the patrol — walk to the other.
        bot.patrolNode = bot.patrolNode === 'm2' ? 'm3' : 'm2';
        const node = world.waypoints.nodeById.get(bot.patrolNode);
        routeTo(bot, node.x, node.z);
      }
      if (bot.heardPos && now - bot.heardAt < 6) {
        const heard = bot.heardPos;
        bot.heardPos = null;
        routeTo(bot, heard.x, heard.z);
      }
    }
  }

  // --- the per-frame step ---------------------------------------------------

  function syncMesh(bot) {
    bot.mesh.position.copy(bot.body.state.position);
    bot.mesh.rotation.y = bot.body.state.yaw;
    bot.mesh.rotation.x = 0;
  }

  function stepBot(bot, dt, now, ctx) {
    if (!bot.alive) {
      // The fall: the figure tips backwards over half a second and stays down.
      if (bot.fallT < 1) {
        bot.fallT = Math.min(1, bot.fallT + dt * 2);
        bot.mesh.rotation.x = -Math.PI / 2 * bot.fallT;
        bot.mesh.position.y = bot.body.state.position.y + 0.15 * (1 - bot.fallT);
      }
      return;
    }

    if (now >= bot.thinkAt) {
      bot.thinkAt = now + 1 / THINK_HZ;
      think(bot, ctx, now);
    }

    // Frozen phases: buy time, round end, match end — stand still.
    if (ctx.phase === 'buy' || ctx.phase === 'end' || ctx.phase === 'matchEnd') {
      bot.body.step(dt, new Set());
      syncMesh(bot);
      return;
    }

    const pos = bot.body.state.position;
    const bomb = ctx.bomb;

    // Channels: planting and defusing are a held posture, not a fight.
    if (bot.mode === 'plant') {
      bot.body.step(dt, new Set(['KeyC']), 0.5);
      if (now >= bot.channelUntil) {
        hooks.onPlantDone(bot);
        bot.mode = 'guard';
      }
      syncMesh(bot);
      return;
    }
    if (bot.mode === 'defuse') {
      bot.body.step(dt, new Set(['KeyC']), 0.5);
      if (now >= bot.channelUntil) hooks.onDefuseDone(bot);
      syncMesh(bot);
      return;
    }

    // In a fight the bot aims at its target and fires in bursts, strafing.
    if (bot.mode === 'contact' && bot.target) {
      const enemy = bot.target;
      const enemyPos = enemy.pos;
      faceToward(bot, { x: enemyPos.x, z: enemyPos.z }, dt);
      // Look slightly up at the chest, not at the feet.
      const eye = bot.body.eyePos(eyeScratch);
      const aimY = enemyPos.y + enemy.chestY;
      bot.body.state.pitch = Math.max(-1.45, Math.min(1.45, Math.atan2(aimY - eye.y, Math.max(0.5, flatDistance(pos, enemyPos)))));
      const keys = strafeKeys(bot, now);
      bot.body.step(dt, keys, 0.55);
      fireAt(bot, enemy, now);
      syncMesh(bot);
      return;
    }

    // Guarding the planted bomb: hold near the site, facing the approach.
    if (bot.mode === 'guard') {
      const siteDef = world.sites[bomb ? bomb.site : bot.assignedSite];
      const d = flatDistance(pos, siteDef.center);
      if (d > BOMB_GUARD_RADIUS) {
        const done = followPath(bot, dt, now, 0.9, false);
        if (done) walkToward(bot, dt, siteDef.center.x, siteDef.center.z, 0.9);
      } else {
        faceToward(bot, { x: 0, z: 0 }, dt);
        bot.body.step(dt, new Set(['KeyC']), 0.5);
      }
      syncMesh(bot);
      return;
    }

    // Retaking: walk to the charge; the think tick switches to defuse on arrival.
    if (bot.mode === 'retake') {
      const done = followPath(bot, dt, now, 0.95, false);
      if (done && bomb) walkToward(bot, dt, bomb.pos.x, bomb.pos.z, 0.95);
      syncMesh(bot);
      return;
    }

    // Holding an angle: stand (or crouch) and sweep the view slowly — or face a
    // position a fireteam mate just reported.
    if (bot.mode === 'hold') {
      if (bot.holdPos) {
        const d = flatDistance(pos, bot.holdPos);
        if (d > 0.6) {
          followPath(bot, dt, now, 0.9, false);
        } else if (bot.reportedPos && now - bot.reportedAt < 6) {
          faceToward(bot, bot.reportedPos, dt);
          bot.body.step(dt, new Set(['KeyC']), 0.5);
        } else {
          const sweep = Math.sin(now * 0.5 + bot.holdYaw) * 0.45;
          bot.body.state.yaw = bot.holdYaw + sweep;
          bot.body.step(dt, new Set(['KeyC']), 0.5);
        }
      }
      syncMesh(bot);
      return;
    }

    // Clearing a corner: pause and sweep the view across the approach.
    if (bot.mode === 'advance' && now < bot.clearUntil) {
      bot.body.state.yaw = bot.sweepYaw + Math.sin(((now % 0.7) / 0.7) * Math.PI) * 1.2;
      bot.body.step(dt, new Set(), 0.5);
      syncMesh(bot);
      return;
    }

    // Advancing or executing: follow the route, faster on an execute. When the
    // graph ends short of the site, walk the last few metres directly.
    if (bot.mode === 'advance' || bot.mode === 'execute') {
      const speed = bot.mode === 'execute' ? 1 : 0.92;
      const sneak = bot.mode === 'advance' && bot.contact !== null;
      const done = followPath(bot, dt, now, speed, sneak);
      if (done) {
        if (bot.team === 'A') {
          const siteDef = world.sites[bot.assignedSite];
          if (flatDistance(pos, siteDef.center) > siteDef.radius) {
            walkToward(bot, dt, siteDef.center.x, siteDef.center.z, speed);
          } else if (bot.role !== 'plant') {
            // Arrived at the site with the carrier: take a guarding angle.
            setHold(bot, pos.x, pos.z, Math.atan2(-(0 - pos.x), -(0 - pos.z)));
          }
        } else if (bot.role === 'hold' && bot.holdPos) {
          setHold(bot, bot.holdPos.x, bot.holdPos.z, bot.holdYaw);
        }
      }
      syncMesh(bot);
      return;
    }

    // Anything else: stand still rather than drift.
    bot.body.step(dt, new Set());
    syncMesh(bot);
  }

  function step(dt, now, ctx) {
    for (const bot of bots) stepBot(bot, dt, now, ctx);
  }

  return { list: bots, spawnRound, damage, setLoadout, reassignCarrier, carrier, notifyShot, aliveCount, step, resetMatch };
}
