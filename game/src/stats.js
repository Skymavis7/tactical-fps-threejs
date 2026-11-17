// Match statistics: every shot, hit, plant and round the player plays, so the
// match-end screen can say how the harbour was won or lost instead of just the
// score. It is pure bookkeeping — no scene, no DOM — and main.js feeds it from
// the same places the kill feed and the score already read from.
export function createStats() {
  const byWeapon = {};
  const rounds = [];
  const totals = {
    shots: 0,
    hits: 0,
    headshots: 0,
    kills: 0,
    deaths: 0,
    damage: 0,
    plants: 0,
    plantsDone: 0,
    defuses: 0,
  };
  let roundKills = 0;
  let bestRound = { round: 0, kills: 0 };

  function weaponEntry(id) {
    if (!byWeapon[id]) byWeapon[id] = { shots: 0, hits: 0, kills: 0, damage: 0 };
    return byWeapon[id];
  }

  function weaponAccuracy(id) {
    const entry = byWeapon[id];
    if (!entry || entry.shots === 0) return 0;
    return Math.round((entry.hits / entry.shots) * 100);
  }

  return {
    // A read-only view for the HUD and for tests.
    get totals() {
      return { ...totals };
    },
    get rounds() {
      return rounds.map((round) => ({ ...round }));
    },
    get bestRound() {
      return { ...bestRound };
    },

    recordShot(weaponId) {
      totals.shots += 1;
      weaponEntry(weaponId).shots += 1;
    },

    recordHit(weaponId, part, damage, killed) {
      totals.hits += 1;
      totals.damage += damage;
      if (part === 'head') totals.headshots += 1;
      if (killed) {
        totals.kills += 1;
        roundKills += 1;
      }
      const entry = weaponEntry(weaponId);
      entry.hits += 1;
      entry.damage += damage;
      if (killed) entry.kills += 1;
    },

    recordDeath() {
      totals.deaths += 1;
    },

    recordPlantStarted() {
      totals.plants += 1;
    },

    recordPlantDone() {
      totals.plantsDone += 1;
    },

    recordDefuse() {
      totals.defuses += 1;
    },

    recordRound(round, winner, reason) {
      rounds.push({ round, winner, reason, kills: roundKills });
      if (roundKills > bestRound.kills) bestRound = { round, kills: roundKills };
      roundKills = 0;
    },

    accuracy() {
      if (totals.shots === 0) return 0;
      return Math.round((totals.hits / totals.shots) * 100);
    },

    kd() {
      if (totals.deaths === 0) return String(totals.kills);
      return (totals.kills / totals.deaths).toFixed(1);
    },

    headshotRate() {
      if (totals.hits === 0) return 0;
      return Math.round((totals.headshots / totals.hits) * 100);
    },

    favouriteWeapon() {
      let best = null;
      let bestKills = -1;
      for (const [id, entry] of Object.entries(byWeapon)) {
        if (entry.kills > bestKills) {
          bestKills = entry.kills;
          best = id;
        }
      }
      return best;
    },

    weaponLine(id) {
      const entry = byWeapon[id];
      if (!entry) return null;
      return `${id}: ${entry.kills} kills · ${weaponAccuracy(id)}% acc · ${entry.damage} dmg`;
    },

    // One line for the kill feed area, and a full report for the match-end screen.
    summaryLine() {
      return `${totals.kills} eliminations · ${this.accuracy()}% accuracy · ${totals.headshots} headshots · K/D ${this.kd()}`;
    },

    report() {
      const lines = [
        this.summaryLine(),
        `Damage dealt: ${totals.damage} · Plants: ${totals.plantsDone}/${totals.plants} · Defuses: ${totals.defuses}`,
      ];
      const favourite = this.favouriteWeapon();
      if (favourite) lines.push(`Best weapon: ${this.weaponLine(favourite)}`);
      if (bestRound.kills > 0) lines.push(`Best round: round ${bestRound.round} with ${bestRound.kills} eliminations`);
      if (rounds.length > 0) {
        const log = rounds.map((round) => `R${round.round} ${round.winner === 'A' ? 'W' : 'L'} (${round.kills}K)`).join(' · ');
        lines.push(`Rounds: ${log}`);
      }
      return lines.join('\n');
    },

    reset() {
      totals.shots = 0;
      totals.hits = 0;
      totals.headshots = 0;
      totals.kills = 0;
      totals.deaths = 0;
      totals.damage = 0;
      totals.plants = 0;
      totals.plantsDone = 0;
      totals.defuses = 0;
      rounds.length = 0;
      roundKills = 0;
      bestRound = { round: 0, kills: 0 };
      for (const key of Object.keys(byWeapon)) delete byWeapon[key];
    },
  };
}
