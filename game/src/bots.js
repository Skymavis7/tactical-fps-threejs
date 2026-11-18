// Bots — squad AI for both teams. Attackers push a site and plant; defenders
// hold angles and defuse. Each bot thinks at 10 Hz (vision cone, line of
// sight, hearing), walks a waypoint graph, and fires in bursts with a human
// reaction delay. Bots are "fighters" (see combat.js).

import * as THREE from 'three';
import { WEAPONS } from './weapons.js';
import { fireHitscan } from './combat.js';
import { sfx } from './audio.js';

const EYE = 1.55;
const THINK_HZ = 10;
const VISION_RANGE = 55;
const VISION_FOV = 1.92; // ~110 degrees total
const HEARING = 28;
const BOT_SPEED = 3.4;

const ATK_NAMES = ['Vex', 'Mara', 'Kilo', 'Juno'];
const DEF_NAMES = ['Rook', 'Bishop', 'Havoc', 'Sable', 'Orin'];

function buildFigure(teamColor) {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x23242c, roughness: 0.85 });
  const cloth = new THREE.MeshStandardMaterial({ color: teamColor, roughness: 0.8 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc8a882, roughness: 0.8 });
  const add = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  // legs (facing local +z)
  add(new THREE.BoxGeometry(0.17, 0.52, 0.17), dark, -0.13, 0.26, 0);
  add(new THREE.BoxGeometry(0.17, 0.52, 0.17), dark, 0.13, 0.26, 0);
  // torso + vest
  add(new THREE.BoxGeometry(0.62, 0.72, 0.36), cloth, 0, 0.9, 0);
  add(new THREE.BoxGeometry(0.66, 0.4, 0.42), dark, 0, 0.98, 0);
  // arms + gun
  add(new THREE.BoxGeometry(0.14, 0.5, 0.14), cloth, -0.36, 0.95, 0.12);
  add(new THREE.BoxGeometry(0.14, 0.5, 0.14), cloth, 0.36, 0.95, 0.12);
  add(new THREE.BoxGeometry(0.09, 0.13, 0.72), dark, 0.22, 1.12, 0.42);
  // head + helmet + visor
  add(new THREE.BoxGeometry(0.34, 0.32, 0.32), skin, 0, 1.5, 0);
  add(new THREE.BoxGeometry(0.38, 0.15, 0.36), dark, 0, 1.68, 0);
  add(new THREE.BoxGeometry(0.3, 0.09, 0.05),
    new THREE.MeshBasicMaterial({ color: teamColor }), 0, 1.52, 0.17);
  return g;
}

function makeBar(color) {
  const bg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x11131c, depthTest: true }));
  bg.scale.set(0.95, 0.1, 1);
  const fg = new THREE.Sprite(new THREE.SpriteMaterial({ color, depthTest: true }));
  fg.scale.set(0.95, 0.07, 1);
  return { bg, fg };
}

export function createBots(ctx) {
  const { world, effects, rng, scene, G } = ctx;
  const bots = [];

  function spawnBot(team, name, weaponId, spawn) {
    const teamColor = team === 'atk' ? 0x57c8ff : 0xff9a57;
    const mesh = buildFigure(teamColor);
    scene.add(mesh);
    const bar = makeBar(teamColor);
    bar.bg.position.y = 2.0;
    bar.fg.position.y = 2.0;
    mesh.add(bar.bg);
    mesh.add(bar.fg);
    const b = {
      id: `bot-${team}-${name}`,
      name,
      team,
      alive: true,
      hp: 100,
      pos: { x: spawn.x, z: spawn.z },
      yaw: team === 'atk' ? -Math.PI / 2 : Math.PI / 2,
      pitch: 0,
      eyeY: EYE,
      height: 1.8,
      radius: 0.42,
      headY: 1.45,
      weapon: WEAPONS[weaponId],
      ammo: { mag: WEAPONS[weaponId].mag, reserve: Infinity },
      fireTimer: 0,
      reloadTimer: 0,
      reloading: false,
      moving: false,
      skill: rng.range(0.85, 1.35), // spread multiplier: lower is better
      reaction: rng.range(0.35, 0.7),
      thinkTimer: rng.range(0, 0.1),
      target: null,
      targetLost: 0,
      reactTimer: 0,
      burstLeft: 0,
      burstPause: 0,
      path: [],
      pathIdx: 0,
      holdNode: -1,
      holdYaw: 0,
      objective: 'spawn',
      investigate: null,
      stuckTimer: 0,
      lastPos: { x: spawn.x, z: spawn.z },
      hasSpike: false,
      channel: null,
      mesh,
      bar,
      kills: 0,
      deaths: 0,
      walkPhase: rng.range(0, Math.PI * 2),

      get aimDir() {
        const cp = Math.cos(this.pitch);
        return new THREE.Vector3(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
      },

      applyDamage(amount, src) {
        if (!this.alive) return false;
        this.hp -= amount;
        this.bar.fg.scale.x = Math.max(0.01, 0.95 * (this.hp / 100));
        if (this.hp <= 0) {
          this.hp = 0;
          this.alive = false;
          this.deaths++;
          this.mesh.visible = false;
          this.channel = null;
          effects.ring(this.pos, 0xff5d5d);
          ctx.onDeath?.(this, src);
          return true;
        }
        // being shot at reveals the shooter to this bot (snap attention)
        if (src && src.alive && src.team !== this.team) {
          this.target = src;
          this.reactTimer = Math.min(this.reactTimer, 0.15);
        }
        return false;
      },

      reset(spawn, weaponId) {
        this.pos.x = spawn.x; this.pos.z = spawn.z;
        this.yaw = this.team === 'atk' ? -Math.PI / 2 : Math.PI / 2;
        this.pitch = 0;
        this.hp = 100; this.alive = true;
        this.weapon = WEAPONS[weaponId];
        this.ammo = { mag: WEAPONS[weaponId].mag, reserve: Infinity };
        this.fireTimer = 0; this.reloadTimer = 0; this.reloading = false;
        this.target = null; this.burstLeft = 0; this.burstPause = 0;
        this.path = []; this.pathIdx = 0;
        this.channel = null;
        this.hasSpike = false;
        this.mesh.visible = true;
        this.mesh.position.set(spawn.x, 0, spawn.z);
        this.bar.fg.scale.x = 0.95;
      },
    };
    bots.push(b);
    return b;
  }

  function spawnAll() {
    const atkWeapons = ['rifle', 'rifle', 'smg', 'dmr'];
    const defWeapons = ['rifle', 'rifle', 'smg', 'dmr', 'rifle'];
    if (bots.length === 0) {
      ATK_NAMES.forEach((n, i) => spawnBot('atk', n, atkWeapons[i], world.spawns.atk[i]));
      DEF_NAMES.forEach((n, i) => spawnBot('def', n, defWeapons[i], world.spawns.def[i]));
    } else {
      bots.forEach((b, i) => {
        const list = b.team === 'atk' ? atkWeapons : defWeapons;
        const spawn = b.team === 'atk' ? world.spawns.atk[i] : world.spawns.def[i - ATK_NAMES.length];
        b.reset(spawn, list[b.team === 'atk' ? i : i - ATK_NAMES.length]);
      });
    }
    setHoldPositions();
    // spike carrier: a random attacker bot (never the player at round start)
    const carrier = bots.filter((b) => b.team === 'atk')[rng.int(0, 3)];
    carrier.hasSpike = true;
    G.spike.carrier = carrier;
    G.spike.dropped = null;
  }

  function canSee(bot, t, now) {
    if (!t.alive) return false;
    const dx = t.pos.x - bot.pos.x, dz = t.pos.z - bot.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > VISION_RANGE) return false;
    // vision cone (bots also notice close movement behind them)
    const facing = { x: -Math.sin(bot.yaw), z: -Math.cos(bot.yaw) };
    const dot = (dx * facing.x + dz * facing.z) / (dist || 1);
    if (dist > 6 && Math.acos(Math.max(-1, Math.min(1, dot))) > VISION_FOV / 2) return false;
    if (world.segmentBlocked(bot.pos.x, EYE, bot.pos.z, t.pos.x, 1.1, t.pos.z)) return false;
    if (effects.inSmoke(bot.pos.x, EYE, bot.pos.z, t.pos.x, 1.1, t.pos.z, now)) return false;
    return true;
  }

  function nearestVisibleEnemy(bot, fighters, now) {
    let best = null, bd = Infinity;
    for (const f of fighters) {
      if (f.team === bot.team || !f.alive) continue;
      if (!canSee(bot, f, now)) continue;
      const d = Math.hypot(f.pos.x - bot.pos.x, f.pos.z - bot.pos.z);
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  }

  function setPath(bot, destNode) {
    const from = world.nearestNode(bot.pos.x, bot.pos.z);
    bot.path = world.findPath(from, destNode);
    bot.pathIdx = 0;
  }

  function setHoldPositions() {
    // defenders: two hold A, two hold B, one anchors mid
    const defs = bots.filter((b) => b.team === 'def');
    const holds = [
      { node: world.nearestNode(-11, -11), yaw: Math.PI / 2 },
      { node: world.nearestNode(-16, -8), yaw: Math.PI * 0.75 },
      { node: world.nearestNode(11, 11), yaw: -Math.PI / 2 },
      { node: world.nearestNode(16, 8), yaw: -Math.PI * 0.25 },
      { node: world.nearestNode(19, 0), yaw: Math.PI / 2 },
    ];
    defs.forEach((b, i) => {
      b.holdNode = holds[i].node;
      b.holdYaw = holds[i].yaw;
      b.yaw = holds[i].yaw;
    });
    const atks = bots.filter((b) => b.team === 'atk');
    atks.forEach((b) => { b.holdNode = -1; });
  }

  function nodeForObjective(bot) {
    const idx = bots.indexOf(bot);
    const site = G.assignedSite;
    if (bot.team === 'atk') {
      if (G.spike.dropped) return world.nearestNode(G.spike.dropped.x, G.spike.dropped.z);
      if (G.phase === 'planted') {
        // guard the planted spike
        const s = world.sites[G.plantedSite];
        return world.nearestNode(s.cx + ((idx % 3) - 1) * 3, s.cz);
      }
      if (bot.hasSpike) return world.nearestNode(site.cx, site.cz);
      // escort: head for the site via a spread of approach nodes
      const lane = idx % 3;
      const spots = [
        world.nearestNode(site.cx, site.cz),
        world.nearestNode(site.cx * 0.55, site.cz * 0.4),
        world.nearestNode(site.cx * 0.3, site.cz * 0.6),
      ];
      return spots[lane] ?? spots[0];
    }
    // defenders
    if (G.phase === 'planted') {
      const s = world.sites[G.plantedSite];
      return world.nearestNode(s.cx, s.cz);
    }
    if (bot.holdNode >= 0) return bot.holdNode;
    return world.nearestNode(bot.pos.x, bot.pos.z);
  }

  function think(bot, fighters, now) {
    // --- targeting ---
    const seen = nearestVisibleEnemy(bot, fighters, now);
    if (seen) {
      if (bot.target !== seen) {
        bot.target = seen;
        bot.reactTimer = bot.reaction * rng.range(0.8, 1.2);
        bot.burstLeft = 0;
      }
      bot.targetLost = 0;
    } else if (bot.target) {
      bot.targetLost += 1 / THINK_HZ;
      if (bot.targetLost > 1.2 || !bot.target.alive) bot.target = null;
    }
    // --- hearing: recent enemy shots nearby pull the bot's attention ---
    if (!bot.target) {
      for (const s of ctx.shotEvents ?? []) {
        if (now - s.time > 1.5 || s.team === bot.team) continue;
        const d = Math.hypot(s.x - bot.pos.x, s.z - bot.pos.z);
        if (d < HEARING) {
          bot.investigate = { x: s.x, z: s.z, until: now + 3 };
          break;
        }
      }
    }
    // --- objective ---
    if (G.phase === 'buy' || G.phase === 'end') { bot.path = []; return; }
    if (bot.channel) return; // busy planting/defusing
    if (bot.target) return; // busy fighting

    // pick up a dropped spike
    if (bot.team === 'atk' && G.spike.dropped) {
      const d = Math.hypot(bot.pos.x - G.spike.dropped.x, bot.pos.z - G.spike.dropped.z);
      if (d < 1.4) {
        bot.hasSpike = true;
        G.spike.carrier = bot;
        G.spike.dropped = null;
        ctx.onSpikePickup?.(bot);
      }
    }

    if (bot.team === 'atk' && bot.hasSpike && G.phase === 'live' && !G.plantedSite) {
      const site = world.siteAt(bot.pos.x, bot.pos.z);
      if (site && site.id === G.assignedSite.id) {
        bot.channel = { type: 'plant', site, progress: 0, needed: 3.5 };
        return;
      }
    }
    if (bot.team === 'def' && G.phase === 'planted' && G.plantedSite) {
      const site = world.sites[G.plantedSite];
      if (Math.hypot(bot.pos.x - site.cx, bot.pos.z - site.cz) < 1.6) {
        bot.channel = { type: 'defuse', site, progress: 0, needed: 5 };
        return;
      }
    }
    // walk the objective
    const dest = nodeForObjective(bot);
    if (bot.path.length === 0 || bot.path[bot.path.length - 1] !== dest) setPath(bot, dest);
  }

  function moveAlongPath(bot, dt) {
    if (bot.path.length === 0 || bot.pathIdx >= bot.path.length) { bot.moving = false; return; }
    const node = world.nodes[bot.path[bot.pathIdx]];
    const dx = node.x - bot.pos.x, dz = node.z - bot.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.7) { bot.pathIdx++; bot.moving = false; return; }
    const step = BOT_SPEED * dt;
    bot.pos.x += (dx / d) * Math.min(step, d);
    bot.pos.z += (dz / d) * Math.min(step, d);
    world.resolveCircle(bot.pos, bot.radius);
    bot.yaw = Math.atan2(-(dx / d), -(dz / d));
    bot.moving = true;
    bot.walkPhase += dt * 9;
  }

  function engage(bot, dt, fighters, now) {
    const t = bot.target;
    if (!t || !t.alive) return;
    const dx = t.pos.x - bot.pos.x, dz = t.pos.z - bot.pos.z;
    const dist = Math.hypot(dx, dz);
    // face the target, aim at the chest with a little error
    bot.yaw = Math.atan2(-dx, -dz);
    const dy = 1.1 - EYE;
    bot.pitch = Math.atan2(dy, dist) + rng.gauss() * 0.012 * bot.skill;
    if (bot.reactTimer > 0) { bot.reactTimer -= dt; return; }
    if (bot.reloadTimer > 0) {
      bot.reloadTimer -= dt;
      if (bot.reloadTimer <= 0) { bot.ammo.mag = bot.weapon.mag; bot.reloading = false; }
      return;
    }
    bot.fireTimer -= dt;
    if (bot.burstLeft <= 0) {
      bot.burstPause -= dt;
      if (bot.burstPause > 0) return;
      bot.burstLeft = bot.weapon.kind === 'dmr' ? 1 : rng.int(3, 5);
      bot.burstPause = rng.range(0.45, 0.95);
    }
    if (bot.fireTimer > 0) return;
    if (bot.ammo.mag <= 0) {
      bot.reloading = true;
      bot.reloadTimer = bot.weapon.reload;
      sfx.reload();
      return;
    }
    bot.ammo.mag--;
    bot.fireTimer = 60 / bot.weapon.fireRate;
    bot.burstLeft--;
    // bot spread is its weapon spread scaled by skill and distance
    const spreadScale = bot.skill * (1 + dist / 60);
    const saveSpread = bot.weapon.spread;
    bot.weapon.spread = saveSpread * spreadScale;
    fireHitscan(bot, world, effects, rng, fighters, {
      onHit: (result, shooter) => ctx.onHit?.(result, shooter),
    });
    bot.weapon.spread = saveSpread;
    ctx.shotEvents?.push({ x: bot.pos.x, z: bot.pos.z, team: bot.team, time: now });
  }

  function syncMesh(bot, dt) {
    const m = bot.mesh;
    m.position.set(bot.pos.x, bot.moving ? Math.abs(Math.sin(bot.walkPhase)) * 0.05 : 0, bot.pos.z);
    m.rotation.y = bot.yaw + Math.PI;
    // aim the gun arm slightly with pitch (visual only)
    m.rotation.x = 0;
    if (bot.channel) {
      // kneel-ish: lower the figure while channelling
      m.position.y = -0.25;
    }
  }

  function update(dt, now, fighters) {
    for (const bot of bots) {
      if (!bot.alive) continue;
      // channel progress (plant / defuse)
      if (bot.channel) {
        bot.channel.progress += dt;
        if (bot.channel.type === 'plant' && bot.channel.progress >= bot.channel.needed) {
          ctx.onPlanted?.(bot.channel.site, bot);
          bot.channel = null;
        } else if (bot.channel.type === 'defuse' && bot.channel.progress >= bot.channel.needed) {
          ctx.onDefused?.(bot.channel.site, bot);
          bot.channel = null;
        }
        if (bot.channel?.type === 'plant' && Math.floor(bot.channel.progress * 4) !== Math.floor((bot.channel.progress - dt) * 4)) {
          sfx.plantTick();
        }
      }
      bot.thinkTimer -= dt;
      if (bot.thinkTimer <= 0) {
        bot.thinkTimer = 1 / THINK_HZ;
        think(bot, fighters, now);
      }
      if (bot.channel) { bot.moving = false; }
      else if (bot.target) {
        // strafe while fighting: slow sideways drift
        bot.moving = false;
        const strafe = Math.sin(now * 0.7 + bot.id.length) > 0 ? 1 : -1;
        const fx = -Math.sin(bot.yaw), fz = -Math.cos(bot.yaw);
        const rx = -fz, rz = fx;
        bot.pos.x += rx * strafe * 0.9 * dt;
        bot.pos.z += rz * strafe * 0.9 * dt;
        world.resolveCircle(bot.pos, bot.radius);
        engage(bot, dt, fighters, now);
      } else if (G.phase === 'live' || G.phase === 'planted') {
        moveAlongPath(bot, dt);
        // idle defenders settle back to their hold angle
        if (!bot.moving && !bot.target && bot.holdNode >= 0) {
          let d = bot.holdYaw - bot.yaw;
          while (d > Math.PI) d -= Math.PI * 2;
          while (d < -Math.PI) d += Math.PI * 2;
          bot.yaw += d * Math.min(1, dt * 3);
        }
        // stuck? pick a random neighbour and walk there
        const moved = Math.hypot(bot.pos.x - bot.lastPos.x, bot.pos.z - bot.lastPos.z);
        if (moved < 0.05) {
          bot.stuckTimer += dt;
          if (bot.stuckTimer > 2 && bot.path.length > 0) {
            bot.stuckTimer = 0;
            const cur = world.nearestNode(bot.pos.x, bot.pos.z);
            const nbs = world.edges.get(cur) ?? [];
            if (nbs.length) setPath(bot, nbs[rng.int(0, nbs.length - 1)]);
          }
        } else bot.stuckTimer = 0;
        bot.lastPos.x = bot.pos.x; bot.lastPos.z = bot.pos.z;
      }
      syncMesh(bot, dt);
    }
  }

  return {
    bots,
    spawnAll,
    update,
    setHoldPositions,
    syncAllMeshes() {
      for (const bot of bots) syncMesh(bot, 0);
    },
    fighters: () => bots.filter((b) => b.alive),
    all: () => bots,
    carrier: () => bots.find((b) => b.hasSpike && b.alive) ?? null,
  };
}
