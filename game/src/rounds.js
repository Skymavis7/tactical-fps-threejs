// The match: rounds, the bomb, and the money. One object owns the phase, the timer, the
// score and the player's wallet; main.js and bots.js report what happened (a kill, a plant,
// a defuse, an elimination) and this module decides what it means. First to 4 rounds,
// at most 7 rounds.
import * as THREE from 'three';

export const BUY_SECONDS = 12;
export const ROUND_SECONDS = 100;
export const PLANT_SECONDS = 3.5;
export const DETONATE_SECONDS = 35;
export const DEFUSE_SECONDS = 5;
export const ROUND_END_SECONDS = 4;
export const WIN_ROUNDS = 4;
export const MAX_ROUNDS = 7;

export function createMatch(hooks) {
  const state = {
    phase: 'buy', // buy | live | planted | roundEnd | matchEnd
    round: 1,
    scoreA: 0,
    scoreB: 0,
    timeLeft: BUY_SECONDS,
    money: 800,
    lossStreak: 0,
    bomb: { planted: false, site: null, pos: new THREE.Vector3(), timer: DETONATE_SECONDS },
    lastReason: '',
  };

  function awardWin() {
    state.money += 3250;
    state.lossStreak = 0;
  }
  function awardLoss() {
    state.money += 1900 + Math.min(2, state.lossStreak) * 500;
    state.lossStreak += 1;
  }

  function endRound(winner, reason) {
    if (state.phase === 'roundEnd' || state.phase === 'matchEnd') return;
    state.lastReason = reason;
    if (winner === 'A') {
      state.scoreA += 1;
      awardWin();
    } else {
      state.scoreB += 1;
      awardLoss();
    }
    state.bomb.planted = false;
    state.phase = 'roundEnd';
    state.timeLeft = ROUND_END_SECONDS;
    hooks.onRoundEnd(winner, reason, state.scoreA, state.scoreB);
    if (state.scoreA >= WIN_ROUNDS || state.scoreB >= WIN_ROUNDS || state.round >= MAX_ROUNDS) {
      state.phase = 'matchEnd';
      state.timeLeft = 0;
      hooks.onMatchEnd(state.scoreA > state.scoreB ? 'A' : 'B', state.scoreA, state.scoreB);
    }
  }

  function startRound() {
    state.phase = 'buy';
    state.timeLeft = BUY_SECONDS;
    state.bomb.planted = false;
    state.bomb.site = null;
    hooks.onPhase('buy', state.round);
  }

  return {
    state,
    startMatch() {
      state.round = 1;
      state.scoreA = 0;
      state.scoreB = 0;
      state.money = 800;
      state.lossStreak = 0;
      state.bomb.planted = false;
      hooks.onMatchStart();
      startRound();
    },
    nextRound() {
      state.round += 1;
      startRound();
    },
    startLive() {
      state.phase = 'live';
      state.timeLeft = ROUND_SECONDS;
      hooks.onPhase('live', state.round);
    },
    plantBomb(site, pos) {
      state.bomb.planted = true;
      state.bomb.site = site;
      state.bomb.pos.copy(pos);
      state.bomb.timer = DETONATE_SECONDS;
      state.phase = 'planted';
      state.timeLeft = DETONATE_SECONDS;
      state.money += 300;
      hooks.onPlant(site);
    },
    step(dt, alive) {
      if (state.phase === 'buy') {
        state.timeLeft -= dt;
        if (state.timeLeft <= 0) this.startLive();
        return;
      }
      if (state.phase === 'live') {
        state.timeLeft -= dt;
        if (alive.A === 0) return endRound('B', 'Tidebreakers eliminated');
        if (alive.B === 0) return endRound('A', 'Harbour Watch eliminated');
        if (state.timeLeft <= 0) return endRound('B', 'Time expired — charge never planted');
        return;
      }
      if (state.phase === 'planted') {
        state.timeLeft -= dt;
        state.bomb.timer = state.timeLeft;
        if (state.timeLeft <= 0) {
          hooks.onDetonate(state.bomb.pos.clone());
          return endRound('A', 'Charge detonated');
        }
        return;
      }
      if (state.phase === 'roundEnd') {
        state.timeLeft -= dt;
        if (state.timeLeft <= 0 && state.phase === 'roundEnd') this.nextRound();
      }
    },
    defuseBomb() {
      if (!state.bomb.planted) return;
      state.bomb.planted = false;
      endRound('B', 'Charge defused');
    },
    killReward() {
      state.money += 300;
    },
    canAfford(price) {
      return state.money >= price;
    },
    spend(price) {
      if (state.money < price) return false;
      state.money -= price;
      return true;
    },
    endRound,
  };
}
