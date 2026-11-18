// Stats — the match record: the player's accuracy, kills and deaths, the
// round-by-round history and the end-of-match summary. The diagnostic panel
// (#diag) reads the same record, so a screenshot's JSON always matches the
// screen.

export function createStats() {
  const s = {
    shots: 0,
    hits: 0,
    kills: 0,
    deaths: 0,
    plants: 0,
    defuses: 0,
    damageDealt: 0,
    rounds: [], // {round, winner, reason}

    recordShot(hit, damage = 0) {
      this.shots++;
      if (hit) { this.hits++; this.damageDealt += damage; }
    },
    recordKill() { this.kills++; },
    recordDeath() { this.deaths++; },
    recordPlant() { this.plants++; },
    recordDefuse() { this.defuses++; },
    recordRound(round, winner, reason) {
      this.rounds.push({ round, winner, reason });
    },
    accuracy() {
      return this.shots === 0 ? 0 : Math.round((this.hits / this.shots) * 100);
    },
    kd() {
      if (this.deaths === 0) return this.kills === 0 ? '—' : `${this.kills}.0`;
      return (this.kills / this.deaths).toFixed(1);
    },
    summary() {
      return {
        shots: this.shots,
        hits: this.hits,
        accuracy: this.accuracy(),
        kills: this.kills,
        deaths: this.deaths,
        kd: this.kd(),
        damage: this.damageDealt,
        plants: this.plants,
        defuses: this.defuses,
        rounds: this.rounds.map((r) => `${r.round}:${r.winner}`),
      };
    },
  };
  return s;
}
