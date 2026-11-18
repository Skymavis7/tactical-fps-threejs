// Rounds — the match state machine: buy phase, live round, planted spike,
// round end and match end, plus the economy (win/loss bonuses, kill and
// plant rewards). The shared game state object G lives in main.js; this
// module owns its transitions.

import * as THREE from 'three';
import { input } from './input.js';
import { sfx } from './audio.js';

export const ECONOMY = {
  startMoney: 800,
  winBonus: 3250,
  lossBase: 1900,
  lossStreakStep: 500,
  lossStreakMax: 1000,
  killReward: 300,
  plantReward: 300,
};

const BUY_TIME = 12;
const ROUND_TIME = 100;
const PLANT_TIME = 3.5;
const DETONATE_TIME = 35;
const DEFUSE_TIME = 5;
const END_TIME = 4;
const WIN_SCORE = 4;
const MAX_ROUNDS = 7;

export function createRounds(ctx) {
  const { world, player, bots, effects, G, rng, scene } = ctx;

  // the spike itself: a small glowing device, shown planted or dropped
  const spikeMesh = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.26, 0.34),
    new THREE.MeshStandardMaterial({ color: 0x8a6d1f, emissive: 0xffd75e, emissiveIntensity: 0.9, roughness: 0.4 }),
  );
  body.position.y = 0.13;
  spikeMesh.add(body);
  const spikeLight = new THREE.PointLight(0xffd75e, 6, 6, 2);
  spikeLight.position.y = 0.5;
  spikeMesh.add(spikeLight);
  spikeMesh.visible = false;
  scene.add(spikeMesh);
  let beepTimer = 0;

  function resetSpike() {
    G.spike.carrier = null;
    G.spike.dropped = null;
    G.spike.plantedAt = null;
    G.plantedSite = null;
    spikeMesh.visible = false;
  }

  function startRound() {
    G.phase = 'buy';
    G.phaseT = BUY_TIME;
    G.roundWinner = null;
    G.roundReason = '';
    G.assignedSite = rng.chance(0.5) ? world.sites.A : world.sites.B;
    resetSpike();
    bots.spawnAll();
    player.resetForRound(world.spawns.atk[4]);
    player.hasSpike = false;
    ctx.feed?.(`Round ${G.round} — push Site ${G.assignedSite.id}, ${G.assignedSite.name}`, 'sys');
    ctx.onPhase?.('buy');
  }

  function startMatch() {
    G.scoreAtk = 0;
    G.scoreDef = 0;
    G.round = 1;
    G.lossStreakAtk = 0;
    G.lossStreakDef = 0;
    G.matchWinner = null;
    startRound();
  }

  function teamAlive(team) {
    let n = player.team === team && player.alive ? 1 : 0;
    for (const b of bots.all()) if (b.team === team && b.alive) n++;
    return n;
  }

  function plantSpike(site, planter) {
    G.phase = 'planted';
    G.plantedSite = site.id;
    G.plantT = DETONATE_TIME;
    G.spike.plantedAt = { x: site.cx, z: site.cz };
    G.spike.carrier = null;
    G.spike.dropped = null;
    if (planter === player) {
      player.hasSpike = false;
      player.award(ECONOMY.plantReward);
      ctx.feed?.(`You planted the spike (+$${ECONOMY.plantReward})`, 'sys');
    } else {
      planter.hasSpike = false;
      ctx.feed?.(`${planter.name} planted the spike at Site ${site.id}`, 'def');
    }
    spikeMesh.visible = true;
    spikeMesh.position.set(site.cx, 0, site.cz);
    beepTimer = 0;
    sfx.planted();
    ctx.onPhase?.('planted');
  }

  function defuseSpike(defuser) {
    ctx.feed?.(defuser === player ? 'You defused the spike!' : `${defuser.name} defused the spike`, 'sys');
    endRound('def', 'Spike defused');
  }

  function endRound(winner, reason) {
    G.phase = 'end';
    G.phaseT = END_TIME;
    G.roundWinner = winner;
    G.roundReason = reason;
    if (winner === 'atk') {
      G.scoreAtk++;
      G.lossStreakAtk = 0;
      G.lossStreakDef++;
      player.award(ECONOMY.winBonus);
      ctx.feed?.(`Round to attackers — ${reason} (+$${ECONOMY.winBonus})`, 'atk');
      sfx.roundWin();
    } else {
      G.scoreDef++;
      G.lossStreakDef = 0;
      G.lossStreakAtk++;
      const bonus = ECONOMY.lossBase + Math.min(ECONOMY.lossStreakMax, (G.lossStreakAtk - 1) * ECONOMY.lossStreakStep);
      player.award(bonus);
      ctx.feed?.(`Round to defenders — ${reason} (+$${bonus})`, 'def');
      sfx.roundLose();
    }
    ctx.onRoundEnd?.(winner, reason);
  }

  function checkMatchEnd() {
    if (G.scoreAtk >= WIN_SCORE || G.scoreDef >= WIN_SCORE || G.round >= MAX_ROUNDS) {
      G.matchWinner = G.scoreAtk > G.scoreDef ? 'atk' : G.scoreDef > G.scoreAtk ? 'def' : 'draw';
      G.phase = 'matchend';
      ctx.onMatchEnd?.(G.matchWinner);
      return true;
    }
    return false;
  }

  function onCarrierDeath(carrier) {
    if (G.phase !== 'live' || G.plantedSite) return;
    if (carrier.hasSpike) {
      carrier.hasSpike = false;
      G.spike.carrier = null;
      G.spike.dropped = { x: carrier.pos.x, z: carrier.pos.z };
      spikeMesh.visible = true;
      spikeMesh.position.set(carrier.pos.x, 0, carrier.pos.z);
      ctx.feed?.(carrier === player ? 'You dropped the spike' : `${carrier.name} dropped the spike`, 'sys');
    }
  }

  function updatePlayerChannel(dt) {
    if (G.shot) return; // staged captures keep their channel as scripted
    if (!player.alive) { player.channel = null; return; }
    if (G.phase === 'live' && player.hasSpike && !G.plantedSite) {
      const site = world.siteAt(player.pos.x, player.pos.z);
      if (site && site.id === G.assignedSite.id && input.down('KeyE')) {
        if (!player.channel || player.channel.type !== 'plant') {
          player.channel = { type: 'plant', site, progress: 0, needed: PLANT_TIME };
        }
        player.channel.progress += dt;
        if (Math.floor(player.channel.progress * 4) !== Math.floor((player.channel.progress - dt) * 4)) sfx.plantTick();
        if (player.channel.progress >= PLANT_TIME) {
          player.channel = null;
          plantSpike(site, player);
        }
        return;
      }
    }
    if (G.phase === 'planted' && G.plantedSite) {
      const site = world.sites[G.plantedSite];
      const d = Math.hypot(player.pos.x - site.cx, player.pos.z - site.cz);
      if (d < 2.2 && input.down('KeyE')) {
        if (!player.channel || player.channel.type !== 'defuse') {
          player.channel = { type: 'defuse', site, progress: 0, needed: DEFUSE_TIME };
        }
        player.channel.progress += dt;
        if (Math.floor(player.channel.progress * 4) !== Math.floor((player.channel.progress - dt) * 4)) sfx.plantTick();
        if (player.channel.progress >= DEFUSE_TIME) {
          player.channel = null;
          defuseSpike(player);
        }
        return;
      }
    }
    player.channel = null;
  }

  function update(dt) {
    // dropped-spike pickup by the player
    if (G.phase === 'live' && G.spike.dropped && player.alive) {
      const d = Math.hypot(player.pos.x - G.spike.dropped.x, player.pos.z - G.spike.dropped.z);
      if (d < 1.4) {
        player.hasSpike = true;
        G.spike.carrier = player;
        G.spike.dropped = null;
        spikeMesh.visible = false;
        ctx.feed?.('You picked up the spike', 'sys');
      }
    }
    // blinking spike light while planted
    if (G.phase === 'planted') {
      beepTimer -= dt;
      spikeLight.intensity = 4 + Math.sin(performance.now() / 90) * 3;
      if (beepTimer <= 0) {
        beepTimer = G.plantT > 10 ? 1 : 0.5;
        sfx.beep();
      }
    }

    if (G.phase === 'buy') {
      G.phaseT -= dt;
      if (G.phaseT <= 0) {
        G.phase = 'live';
        G.phaseT = ROUND_TIME;
        ctx.feed?.(`Round ${G.round} — go!`, 'sys');
        sfx.roundStart();
        ctx.onPhase?.('live');
      }
      return;
    }
    if (G.phase === 'live') {
      G.phaseT -= dt;
      updatePlayerChannel(dt);
      if (teamAlive('def') === 0) { endRound('atk', 'Defenders eliminated'); return; }
      if (teamAlive('atk') === 0) { endRound('def', 'Attackers eliminated'); return; }
      if (G.phaseT <= 0) { endRound('def', 'Time expired'); return; }
      return;
    }
    if (G.phase === 'planted') {
      G.plantT -= dt;
      updatePlayerChannel(dt);
      if (teamAlive('def') === 0) { endRound('atk', 'Defenders eliminated'); return; }
      if (teamAlive('atk') === 0 && !G.spike.plantedAt) { endRound('def', 'Attackers eliminated'); return; }
      if (teamAlive('atk') === 0) { /* spike still ticks: defenders must defuse */ }
      if (G.plantT <= 0) {
        effects.explosion({ x: G.spike.plantedAt.x, y: 0.6, z: G.spike.plantedAt.z });
        sfx.explosion();
        endRound('atk', 'Spike detonated');
      }
      return;
    }
    if (G.phase === 'end') {
      G.phaseT -= dt;
      if (G.phaseT <= 0) {
        if (checkMatchEnd()) return;
        G.round++;
        startRound();
      }
      return;
    }
  }

  return {
    startMatch,
    startRound,
    update,
    plantSpike,
    defuseSpike,
    endRound,
    onCarrierDeath,
    canBuy: () => G.phase === 'buy',
  };
}
