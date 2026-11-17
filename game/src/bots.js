// Bots: nine teammates and opponents with one job each — walk the waypoint graph to their
// site, hold angles, and fight what they see. They think at 10 Hz (vision, hearing, role)
// and move at 60 Hz. A bot that sees an enemy reacts, bursts, strafes and pauses like a
// player would; a bot that hears a shot investigates it. All names are original.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createBody } from './player.js';
import { WEAPONS } from './weapons.js';
import { pick } from './rng.js';

const ATTACK_NAMES = ['Raka', 'Bima', 'Sari', 'Dewi'];
const DEFEND_NAMES = ['Agus', 'Putri', 'Joko', 'Maya', 'Eko'];
const THINK_HZ = 10;
const FOV_COS = Math.cos((110 * Math.PI) / 180 / 2);

function buildBotMesh(team) {
  const colour = team === 'A' ? PALETTE.accent : PALETTE.teamB;
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color('#20262e'), roughness: 0.85 });
  const vest = new THREE.MeshStandardMaterial({ color: new THREE.Color(colour), roughness: 0.6, metalness: 0.1 });
  const skin = new THREE.MeshStandardMaterial({ color: new THREE.Color('#c9a184'), roughness: 0.7 });
  const gunMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#14161a'), roughness: 0.5, metalness: 0.4 });

  const group = new THREE.Group();
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.18), dark);
  legL.position.set(-0.11, 0.25, 0);
  const legR = legL.clone();
  legR.position.x = 0.11;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), vest);
  torso.position.y = 0.82;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), skin);
  head.position.y = 1.32;
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), vest);
  helmet.position.y = 1.34;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.55), gunMat);
  gun.position.set(0.18, 1.05, -0.3);
  group.add(legL, legR, torso, head, helmet, gun);
  group.traverse((mesh) => {
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  return { group, torso, head, gun };
}

export function createBots(scene, world, combat, random, hooks) {
  const bots = [];
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const tmp3 = new THREE.Vector3();

  function makeBot(id, name, team, spawn, weaponId) {
    const body = createBody(world.colliders, spawn);
    const mesh = buildBotMesh(team);
    scene.add(mesh.group);
    const bot = {
      id, name, team, body, weaponId, baseWeapon: weaponId,
      mesh: mesh.group, torsoMesh: mesh.torso, headMesh: mesh.head,
      health: 100, alive: true,
      state: 'route', path: [], pathIndex: 0, holdUntil: 0,
      thinkAt: random() * 0.1, target: null, reaction: 0,
      burstLeft: 0, burstTimer: 0, pauseTimer: 0,
      strafeDir: 1, strafeAt: 0, stuckAt: 0, stuckPos: new THREE.Vector3(),
      heardPos: null, heardAt: -99,
      assignedSite: 'A', role: 'push', plantProgress: 0, defuseProgress: 0,
      kills: 0, deaths: 0, fallT: 0, lastSeen: new THREE.Vector3(), lastSeenAt: -99,
      aimSkill: 0.7 + random() * 0.5, // higher is worse aim
    };
    mesh.torso.userData.part = 'torso';
    mesh.head.userData.part = 'head';
    bot.owner = { kind: 'bot', ref: bot };
    combat.registerTarget(mesh.torso, bot.owner, 'torso');
    combat.registerTarget(mesh.head, bot.owner, 'head');
    bots.push(bot);
    return bot;
  }

  for (let i = 0; i < ATTACK_NAMES.length; i += 1) {
    makeBot(`a${i}`, ATTACK_NAMES[i], 'A', world.spawns.attack[i + 1], i === 3 ? 'smg' : 'rifle');
  }
  for (let i = 0; i < DEFEND_NAMES.length; i += 1) {
    makeBot(`d${i}`, DEFEND_NAMES[i], 'B', world.spawns.defend[i], i === 4 ? 'dmr' : i % 2 ? 'smg' : 'rifle');
  }

  function setPath(bot, toNodeId) {
    const from = world.waypoints.nearestNode(bot.body.state.position.x, bot.body.state.position.z);
    bot.path = world.waypoints.pathBetween(from.id, toNodeId);
    bot.pathIndex = 0;
  }

  function spawnRound(carrierId) {
    for (const bot of bots) {
      const spawns = bot.team === 'A' ? world.spawns.attack : world.spawns.defend;
      const spawn = spawns[bots.filter((b) => b.team === bot.team).indexOf(bot)];
      bot.body.teleport(spawn.x, spawn.z, spawn.yaw);
      bot.health = 100;
      bot.alive = true;
      bot.state = 'route';
      bot.target = null;
      bot.plantProgress = 0;
      bot.defuseProgress = 0;
      bot.fallT = 0;
      bot.mesh.rotation.set(0, bot.body.state.yaw, 0);
      bot.mesh.position.copy(bot.body.state.position);
      bot.mesh.visible = true;
      if (!bot.torsoMesh.userData.combat) combat.registerTarget(bot.torsoMesh, bot.owner, 'torso');
      if (!bot.headMesh.userData.combat) combat.registerTarget(bot.headMesh, bot.owner, 'head');
      // Roles: attackers split across both sites, one carries the charge.
      if (bot.team === 'A') {
        bot.assignedSite = bot.id === 'a0' || bot.id === 'a1' ? 'A' : 'B';
        bot.role = bot.id === carrierId ? 'plant' : 'push';
      } else {
        bot.assignedSite = bot.id === 'd0' || bot.id === 'd1' ? 'A' : 'B';
        bot.role = 'hold';
      }
      setPath(bot, bot.team === 'A' ? (bot.assignedSite === 'A' ? 'a1' : 'b1') : (bot.assignedSite === 'A' ? 'hA' : 'hB'));
    }
  }

  function visibleEnemy(bot, ctx, now) {
    const eye = bot.body.eyePos(tmp);
    let best = null;
    let bestD = Infinity;
    const candidates = [];
    if (ctx.player.alive) candidates.push({ kind: 'player', ref: ctx.player, pos: ctx.player.pos, chest: ctx.player.chestY });
    for (const other of bots) {
      if (!other.alive || other.team === bot.team) continue;
      candidates.push({ kind: 'bot', ref: other, pos: other.body.state.position, chest: 1.2 });
    }
    for (const cand of candidates) {
      tmp2.copy(cand.pos);
      const dx = tmp2.x - eye.x;
      const dz = tmp2.z - eye.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 55 || dist < 0.5) continue;
      // Facing check: dot of forward (-sin yaw, -cos yaw) with direction to target.
      const fx = -Math.sin(bot.body.state.yaw);
      const fz = -Math.cos(bot.body.state.yaw);
      if ((dx * fx + dz * fz) / dist < FOV_COS) continue;
      tmp3.set(cand.pos.x, cand.pos.y + cand.chest, cand.pos.z);
      if (!combat.hasLineOfSight(eye, tmp3)) continue;
      if (dist < bestD) {
        bestD = dist;
        best = { ...cand, dist, aimPoint: tmp3.clone() };
      }
    }
    return best;
  }

  function think(bot, ctx, now) {
    if (!bot.alive) return;
    const seen = visibleEnemy(bot, ctx, now);
    if (seen) {
      bot.lastSeen.copy(seen.aimPoint);
      bot.lastSeenAt = now;
      if (bot.state !== 'engage') {
        bot.state = 'engage';
        bot.target = seen;
        bot.reaction = 0.35 + random() * 0.35 * bot.aimSkill;
        bot.burstLeft = 0;
        bot.pauseTimer = 0;
      } else {
        bot.target = seen;
      }
      return;
    }
    // Lost sight: keep hunting the last seen spot briefly, then resume the role.
    if (bot.state === 'engage' && now - bot.lastSeenAt < 1.2) {
      bot.target = { aimPoint: bot.lastSeen, dist: bot.body.state.position.distanceTo(bot.lastSeen) };
      return;
    }
    bot.state = bot.role === 'hold' && bot.pathIndex >= bot.path.length ? 'hold' : 'route';
    bot.target = null;
    // Hearing: a recent shot nearby pulls the bot to investigate once.
    if (bot.heardPos && now - bot.heardAt < 6 && bot.state === 'route') {
      const node = world.waypoints.nearestNode(bot.heardPos.x, bot.heardPos.z);
      setPath(bot, node.id);
      bot.heardPos = null;
    }
    // Role routing.
    if (bot.team === 'A' && ctx.bomb.planted) {
      // Attackers defend the planted charge: hold near its site.
      const site = ctx.bomb.site;
      if (bot.path.length === 0 || bot.pathIndex >= bot.path.length) setPath(bot, site === 'A' ? 'a1' : 'b1');
    } else if (bot.team === 'B' && ctx.bomb.planted) {
      // Defenders retake: route to the planted site, then defuse.
      if (bot.state !== 'defuse') setPath(bot, ctx.bomb.site === 'A' ? 'a1' : 'b1');
    } else if (bot.team === 'A' && bot.role === 'plant') {
      // The carrier always walks to its site; if the role just moved to this bot, re-path.
      const siteNode = bot.assignedSite === 'A' ? 'a1' : 'b1';
      const dest = bot.path.length ? bot.path[bot.path.length - 1].id : null;
      if (dest !== siteNode) setPath(bot, siteNode);
      const site = bot.assignedSite;
      const centre = world.sites[site].center;
      const d = Math.hypot(bot.body.state.position.x - centre.x, bot.body.state.position.z - centre.z);
      if (d < world.sites[site].radius * 0.7 && !ctx.bomb.planted) {
        bot.state = 'plant';
      }
    }
  }

  function fireAt(bot, now, dt) {
    const def = WEAPONS[bot.weaponId];
    if (bot.reaction > 0) {
      bot.reaction -= dt;
      return;
    }
    if (bot.pauseTimer > 0) {
      bot.pauseTimer -= dt;
      return;
    }
    if (bot.burstLeft <= 0) {
      bot.burstLeft = 3 + Math.floor(random() * 3);
      return;
    }
    bot.burstTimer -= dt;
    if (bot.burstTimer > 0) return;
    bot.burstTimer = def.fireGap + 0.02;
    bot.burstLeft -= 1;
    if (bot.burstLeft <= 0) bot.pauseTimer = 0.5 + random() * 0.5;
    const target = bot.target;
    if (!target) return;
    const eye = bot.body.eyePos(tmp);
    const aim = tmp2.copy(target.aimPoint).sub(eye).normalize();
    const err = (0.012 + target.dist * 0.00045) * bot.aimSkill;
    aim.x += (random() * 2 - 1) * err;
    aim.y += (random() * 2 - 1) * err;
    aim.z += (random() * 2 - 1) * err;
    aim.normalize();
    combat.fire(eye, aim, def, bot.owner);
    hooks.onBotShot(bot);
  }

  function moveAlongPath(bot, dt, now) {
    const keys = new Set();
    if (bot.pathIndex >= bot.path.length) return keys;
    const node = bot.path[bot.pathIndex];
    const dx = node.x - bot.body.state.position.x;
    const dz = node.z - bot.body.state.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.7) {
      bot.pathIndex += 1;
      return keys;
    }
    const wantYaw = Math.atan2(-dx, -dz);
    let dyaw = wantYaw - bot.body.state.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    bot.body.state.yaw += Math.max(-3.2 * dt, Math.min(3.2 * dt, dyaw));
    if (Math.abs(dyaw) < 0.6) keys.add('KeyW');
    // Stuck: sidestep for a moment, then re-path.
    const moved = bot.body.state.position.distanceTo(bot.stuckPos);
    if (moved > 0.5) {
      bot.stuckPos.copy(bot.body.state.position);
      bot.stuckAt = now;
    } else if (now - bot.stuckAt > 1.6) {
      keys.add(random() > 0.5 ? 'KeyA' : 'KeyD');
      if (now - bot.stuckAt > 2.4) {
        bot.stuckAt = now;
        setPath(bot, bot.path[bot.path.length - 1].id);
      }
    }
    return keys;
  }

  function stepBot(bot, dt, now, ctx) {
    if (!bot.alive) {
      if (bot.fallT < 1) {
        bot.fallT = Math.min(1, bot.fallT + dt / 0.45);
        bot.mesh.rotation.x = -bot.fallT * 1.45;
        bot.mesh.position.y = bot.body.state.position.y - bot.fallT * 0.1;
      }
      return;
    }
    bot.thinkAt -= dt;
    if (bot.thinkAt <= 0) {
      bot.thinkAt = 1 / THINK_HZ;
      think(bot, ctx, now);
    }
    const keys = new Set();
    if (ctx.phase === 'buy' || ctx.phase === 'end' || ctx.phase === 'matchEnd') {
      // Frozen: stand still, face the objective.
      bot.body.step(dt, keys);
      return;
    }
    if (bot.state === 'plant') {
      bot.plantProgress += dt / 3.5;
      if (bot.plantProgress >= 1) {
        bot.plantProgress = 0;
        bot.state = 'route';
        hooks.onPlantDone(bot);
      }
      bot.body.step(dt, keys);
      return;
    }
    if (bot.state === 'defuse') {
      bot.defuseProgress += dt / 5;
      if (bot.defuseProgress >= 1) {
        bot.defuseProgress = 0;
        bot.state = 'route';
        hooks.onDefuseDone(bot);
      }
      bot.body.step(dt, keys);
      return;
    }
    if (bot.state === 'engage' && bot.target) {
      // Face the target, strafe, and shoot in bursts.
      const dx = bot.target.aimPoint.x - bot.body.state.position.x;
      const dz = bot.target.aimPoint.z - bot.body.state.position.z;
      const wantYaw = Math.atan2(-dx, -dz);
      let dyaw = wantYaw - bot.body.state.yaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      bot.body.state.yaw += Math.max(-4.5 * dt, Math.min(4.5 * dt, dyaw));
      bot.body.state.pitch = Math.max(-0.4, Math.min(0.4, Math.asin(Math.max(-1, Math.min(1, (bot.target.aimPoint.y - (bot.body.state.position.y + bot.body.state.eye)) / Math.max(1, bot.target.dist))))));
      if (now > bot.strafeAt) {
        bot.strafeAt = now + 0.6 + random() * 0.8;
        bot.strafeDir = random() > 0.5 ? 1 : -1;
      }
      keys.add(bot.strafeDir > 0 ? 'KeyD' : 'KeyA');
      if (random() < 0.002) keys.add('KeyC');
      fireAt(bot, now, dt);
    } else if (bot.state === 'hold') {
      // Slow scan across the angle they guard.
      bot.body.state.yaw += Math.sin(now * 0.5 + bot.id.charCodeAt(1)) * dt * 0.4;
    } else {
      // Route: walk the path; arrive at a defuse when the bomb is planted and close.
      if (bot.team === 'B' && ctx.bomb.planted) {
        const d = Math.hypot(bot.body.state.position.x - ctx.bomb.pos.x, bot.body.state.position.z - ctx.bomb.pos.z);
        if (d < 1.6) {
          bot.state = 'defuse';
          bot.defuseProgress = 0;
          bot.body.step(dt, keys);
          return;
        }
      }
      const pathKeys = moveAlongPath(bot, dt, now);
      for (const key of pathKeys) keys.add(key);
    }
    bot.body.step(dt, keys, 0.92);
    bot.mesh.position.copy(bot.body.state.position);
    bot.mesh.rotation.y = bot.body.state.yaw;
  }

  function damage(bot, amount, part, attacker) {
    if (!bot.alive) return false;
    bot.health -= amount;
    if (bot.health > 0) {
      // Being shot interrupts a plant/defuse channel.
      if (bot.state === 'plant') bot.plantProgress = Math.max(0, bot.plantProgress - 0.4);
      if (bot.state === 'defuse') bot.defuseProgress = Math.max(0, bot.defuseProgress - 0.4);
      return false;
    }
    bot.alive = false;
    bot.deaths += 1;
    bot.state = 'dead';
    combat.unregisterTarget(bot.torsoMesh);
    combat.unregisterTarget(bot.headMesh);
    hooks.onBotDeath(bot, attacker, part);
    return true;
  }

  return {
    list: bots,
    spawnRound,
    damage,
    // Round 1 is pistols only; from round 2 the bots carry their real weapons.
    setLoadout(round) {
      for (const bot of bots) bot.weaponId = round === 1 ? 'pistol' : bot.baseWeapon;
    },
    // The charge moves to another living attacker when its carrier falls.
    reassignCarrier(deadId) {
      const carrier = bots.find((b) => b.alive && b.team === 'A' && b.role === 'plant');
      if (carrier && carrier.id !== deadId) return carrier;
      const next = bots.find((b) => b.alive && b.team === 'A');
      if (!next) return null;
      if (carrier) carrier.role = 'push';
      next.role = 'plant';
      return next;
    },
    carrier() {
      return bots.find((b) => b.alive && b.team === 'A' && b.role === 'plant') || null;
    },
    notifyShot(pos, shooterTeam, now) {
      for (const bot of bots) {
        if (!bot.alive || bot.team === shooterTeam) continue;
        const d = bot.body.state.position.distanceTo(pos);
        if (d < 28) {
          bot.heardPos = pos.clone();
          bot.heardAt = now;
        }
      }
    },
    aliveCount(team) {
      return bots.filter((b) => b.alive && b.team === team).length;
    },
    step(dt, now, ctx) {
      for (const bot of bots) stepBot(bot, dt, now, ctx);
    },
    resetMatch() {
      for (const bot of bots) {
        bot.kills = 0;
        bot.deaths = 0;
      }
    },
  };
}
