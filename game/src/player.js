// Player — first-person movement, weapons, economy and the spike.
// The player is a "fighter" (see combat.js) so bots and grenades can hurt
// them through the same code path.

import * as THREE from 'three';
import { WEAPONS, GRENADES, freshLoadout, freshAmmo } from './weapons.js';
import { input } from './input.js';
import { sfx } from './audio.js';

const EYE = 1.62;
const RADIUS = 0.42;
const WALK_SPEED = 4.6;
const SPRINT_SPEED = 6.9;

export function createPlayer(ctx) {
  const { world, rng } = ctx;
  const p = {
    id: 'player',
    name: 'You',
    team: 'atk',
    alive: true,
    hp: 100,
    pos: { x: -23, z: 0 },
    yaw: -Math.PI / 2,
    pitch: 0,
    eyeY: EYE,
    height: 1.8,
    radius: RADIUS,
    headY: 1.45,
    money: 800,
    kills: 0,
    deaths: 0,
    assists: 0,
    loadout: freshLoadout(),
    fireTimer: 0,
    reloadTimer: 0,
    reloading: false,
    moving: false,
    sprinting: false,
    hasSpike: false,
    channel: null, // {type:'plant'|'defuse', site, progress, needed}
    stepTimer: 0,

    get weapon() { return WEAPONS[this.loadout.current]; },
    get ammo() { return this.loadout.ammo[this.loadout.current]; },

    get aimDir() {
      const cp = Math.cos(this.pitch);
      return new THREE.Vector3(
        -Math.sin(this.yaw) * cp,
        Math.sin(this.pitch),
        -Math.cos(this.yaw) * cp,
      );
    },

    resetForRound(spawn, keepMoney = true) {
      this.pos.x = spawn.x; this.pos.z = spawn.z;
      this.yaw = -Math.PI / 2; this.pitch = 0;
      this.hp = 100; this.alive = true;
      this.fireTimer = 0; this.reloadTimer = 0; this.reloading = false;
      this.channel = null;
      if (!keepMoney) this.money = 800;
      // refill the current magazine from reserve, free
      const a = this.ammo;
      if (a && a.reserve !== Infinity) {
        const need = this.weapon.mag - a.mag;
        const take = Math.min(need, a.reserve);
        a.mag += take; a.reserve -= take;
      } else if (a) {
        a.mag = this.weapon.mag;
      }
    },

    applyDamage(amount, src) {
      if (!this.alive) return false;
      this.hp -= amount;
      sfx.hurt();
      if (this.hp <= 0) {
        this.hp = 0;
        this.alive = false;
        this.deaths++;
        this.channel = null;
        ctx.onDeath?.(this, src);
        return true;
      }
      return false;
    },

    healFull() { this.hp = 100; },

    update(dt, phase) {
      if (!this.alive) return;
      // look
      const look = input.consumeLook();
      this.yaw -= look.dx * 0.0023;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - look.dy * 0.0023));

      // move (WASD relative to yaw; disabled while channelling)
      const fwd = { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) };
      const right = { x: -fwd.z, z: fwd.x };
      let mx = 0, mz = 0;
      const channelling = this.channel !== null;
      if (!channelling) {
        if (input.down('KeyW')) { mx += fwd.x; mz += fwd.z; }
        if (input.down('KeyS')) { mx -= fwd.x; mz -= fwd.z; }
        if (input.down('KeyD')) { mx += right.x; mz += right.z; }
        if (input.down('KeyA')) { mx -= right.x; mz -= right.z; }
      }
      const len = Math.hypot(mx, mz);
      this.moving = len > 0;
      this.sprinting = this.moving && input.down('ShiftLeft') && input.down('KeyW') && !channelling;
      if (len > 0) {
        const speed = this.sprinting ? SPRINT_SPEED : WALK_SPEED;
        this.pos.x += (mx / len) * speed * dt;
        this.pos.z += (mz / len) * speed * dt;
        world.resolveCircle(this.pos, RADIUS);
        this.stepTimer -= dt;
        if (this.stepTimer <= 0 && this.moving) {
          this.stepTimer = this.sprinting ? 0.32 : 0.45;
          sfx.step();
        }
      }

      // weapon switching (not while the buy menu owns the number keys)
      if (!ctx.buyOpen?.()) {
        const order = ['pistol', 'smg', 'rifle', 'dmr'];
        for (let i = 0; i < order.length; i++) {
          if (input.consumePress(`Digit${i + 1}`)) this.switchWeapon(order[i]);
        }
        if (input.consumePress('KeyR')) this.startReload();
        if (input.consumePress('Digit5')) ctx.throwGrenade?.('frag', this);
        if (input.consumePress('Digit6')) ctx.throwGrenade?.('smoke', this);
      }

      // fire
      this.fireTimer -= dt;
      if (this.reloadTimer > 0) {
        this.reloadTimer -= dt;
        if (this.reloadTimer <= 0) this.finishReload();
      }
      const w = this.weapon;
      const wantFire = w.auto ? input.mouseDown : input.consumeClick();
      if (wantFire && phase === 'live' && !this.reloading && this.fireTimer <= 0) {
        this.fire();
      }
    },

    fire() {
      const w = this.weapon;
      const a = this.ammo;
      if (!a || a.mag <= 0) {
        sfx.dryFire();
        this.startReload();
        return;
      }
      a.mag--;
      this.fireTimer = 60 / w.fireRate;
      ctx.fireHitscan?.(this);
    },

    startReload() {
      const w = this.weapon;
      const a = this.ammo;
      if (this.reloading || !a || a.mag >= w.mag) return;
      if (a.reserve !== Infinity && a.reserve <= 0) return;
      this.reloading = true;
      this.reloadTimer = w.reload;
      sfx.reload();
    },

    finishReload() {
      const w = this.weapon;
      const a = this.ammo;
      this.reloading = false;
      if (!a) return;
      const need = w.mag - a.mag;
      if (a.reserve === Infinity) {
        a.mag = w.mag;
      } else {
        const take = Math.min(need, a.reserve);
        a.mag += take;
        a.reserve -= take;
      }
    },

    switchWeapon(id) {
      if (!this.loadout.owned[id]) return false;
      if (this.loadout.current === id) return true;
      this.loadout.current = id;
      this.reloading = false;
      this.reloadTimer = 0;
      this.fireTimer = Math.max(this.fireTimer, 0.15);
      return true;
    },

    buy(id) {
      if (WEAPONS[id]) {
        const w = WEAPONS[id];
        if (this.loadout.owned[id]) {
          this.switchWeapon(id);
          return { ok: true, note: 'equipped' };
        }
        if (this.money < w.price) return { ok: false, reason: 'Not enough money' };
        this.money -= w.price;
        this.loadout.owned[id] = true;
        this.loadout.ammo[id] = freshAmmo(w);
        this.switchWeapon(id);
        sfx.buy();
        return { ok: true, note: `Bought ${w.name}` };
      }
      if (GRENADES[id]) {
        const g = GRENADES[id];
        if (this.loadout.grenades[id] >= 2) return { ok: false, reason: 'Carrying max' };
        if (this.money < g.price) return { ok: false, reason: 'Not enough money' };
        this.money -= g.price;
        this.loadout.grenades[id]++;
        sfx.buy();
        return { ok: true, note: `Bought ${g.name}` };
      }
      return { ok: false, reason: 'Unknown item' };
    },

    award(amount) { this.money += amount; },
  };
  return p;
}
