// The DOM HUD: health, ammunition, timer, score, money, kill feed, minimap, buy menu
// and the overlay panels. It never touches the simulation; main.js pushes numbers in
// and reads the button callbacks out. Every setter skips a write when nothing changed,
// and the minimap is redrawn from scratch on each call — it is cheap at four frames
// a second and it means the map can never go stale.
export function createHud(world, hooks) {
  const $ = (id) => document.getElementById(id);
  const els = {};
  for (const id of [
    'health-fill', 'health-num', 'ammo-mag', 'ammo-reserve', 'weapon-name', 'timer',
    'score', 'money', 'kills', 'feed', 'banner', 'banner-title', 'banner-sub',
    'crosshair', 'hitmarker', 'vignette', 'overlay', 'overlay-title', 'overlay-copy',
    'play', 'buy-menu', 'buy-money', 'buy-list', 'plant-bar', 'plant-fill',
    'plant-label', 'minimap', 'spectate', 'grenades', 'round-label',
  ]) {
    els[id] = $(id);
  }

  const mapCtx = els['minimap'].getContext('2d');
  const MAP_SIZE = 168;
  const bounds = world.bounds;
  const toMapX = (x) => ((x - bounds.minX) / (bounds.maxX - bounds.minX)) * MAP_SIZE;
  const toMapY = (z) => ((z - bounds.minZ) / (bounds.maxZ - bounds.minZ)) * MAP_SIZE;

  const COPY = {
    start: {
      title: 'MERIDIAN DOCKS',
      copy: 'Tidebreakers attack. Plant the surge charge at Site A or Site B — or eliminate the Harbour Watch. First to 4 rounds takes the harbour.',
      action: 'Click to play',
    },
    paused: { title: 'MERIDIAN DOCKS', copy: 'Paused. Click to resume.', action: 'Click to resume' },
    end: { title: 'Round over', copy: '', action: 'Next round' },
    match: { title: 'Match over', copy: '', action: 'Play again' },
  };

  // Last-written values, so a setter that repeats itself costs nothing.
  const last = new Map();
  let hitTimer = 0;
  let bannerTimer = 0;

  function setText(el, key, value) {
    if (last.get(key) === value) return;
    last.set(key, value);
    el.textContent = value;
  }

  function drawMinimap(player, bots, bomb) {
    const ctx = mapCtx;
    ctx.clearRect(0, 0, MAP_SIZE, MAP_SIZE);
    // Dusk water under everything.
    ctx.fillStyle = 'rgba(13,20,29,0.85)';
    ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
    // A faint grid, so distance reads at a glance.
    ctx.strokeStyle = 'rgba(53,66,79,0.35)';
    ctx.lineWidth = 1;
    for (let g = 1; g < 4; g += 1) {
      ctx.beginPath();
      ctx.moveTo((MAP_SIZE / 4) * g, 0);
      ctx.lineTo((MAP_SIZE / 4) * g, MAP_SIZE);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, (MAP_SIZE / 4) * g);
      ctx.lineTo(MAP_SIZE, (MAP_SIZE / 4) * g);
      ctx.stroke();
    }
    // Site zones: a soft circle and a letter, so the objective reads instantly.
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [name, site] of Object.entries(world.sites)) {
      const cx = toMapX(site.center.x);
      const cy = toMapY(site.center.z);
      const r = ((site.radius * 2) / (bounds.maxX - bounds.minX)) * MAP_SIZE;
      ctx.fillStyle = name === 'A' ? 'rgba(255,138,42,0.14)' : 'rgba(53,196,181,0.14)';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = name === 'A' ? '#ff8a2a' : '#35c4b5';
      ctx.fillText(name, cx, cy);
    }
    // Cover blocks.
    ctx.fillStyle = '#35424f';
    for (const box of world.colliders) {
      const w = toMapX(box.max.x) - toMapX(box.min.x);
      const h = toMapY(box.max.z) - toMapY(box.min.z);
      if (w < 1 && h < 1) continue;
      ctx.fillRect(toMapX(box.min.x), toMapY(box.min.z), Math.max(1, w), Math.max(1, h));
    }
    // The planted charge: a red dot with a ring.
    if (bomb.planted) {
      const bx = toMapX(bomb.pos.x);
      const by = toMapY(bomb.pos.z);
      ctx.strokeStyle = '#e5484d';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(bx, by, 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#e5484d';
      ctx.beginPath();
      ctx.arc(bx, by, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // Living bots, team-coloured.
    for (const bot of bots) {
      if (!bot.alive) continue;
      ctx.fillStyle = bot.team === 'A' ? '#ff8a2a' : '#35c4b5';
      ctx.beginPath();
      ctx.arc(toMapX(bot.body.state.position.x), toMapY(bot.body.state.position.z), 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // The player: an arrow that points the way the player is facing. The angle is
    // measured clockwise from map-up, which is world -z.
    if (player.alive) {
      const x = toMapX(player.pos.x);
      const y = toMapY(player.pos.z);
      const yaw = player.yaw ?? 0;
      ctx.fillStyle = '#ece7db';
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.atan2(-Math.sin(yaw), Math.cos(yaw)));
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(4, 5);
      ctx.lineTo(-4, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  function buyRow(def, label, disabled, afford) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'buy-row';
    row.disabled = disabled || !afford;
    row.innerHTML = `<b>${def.name}</b><span>${def.price === 0 ? 'OWNED' : `$${def.price}`}</span><i>${label}</i>`;
    row.addEventListener('click', () => hooks.onBuy(def.id));
    return row;
  }

  return {
    setHealth(hp) {
      setText(els['health-num'], 'hp', String(Math.max(0, Math.ceil(hp))));
      const pct = Math.max(0, Math.min(100, hp));
      if (last.get('hpPct') !== pct) {
        last.set('hpPct', pct);
        els['health-fill'].style.width = `${pct}%`;
        els['health-fill'].classList.toggle('low', pct <= 30);
      }
    },
    setAmmo(mag, reserve) {
      setText(els['ammo-mag'], 'mag', String(mag));
      setText(els['ammo-reserve'], 'res', `/ ${reserve}`);
    },
    setWeapon(name) {
      setText(els['weapon-name'], 'wname', name);
    },
    setGrenades(frag, smoke) {
      setText(els.grenades, 'nades', `Frag ${frag} · Smoke ${smoke}`);
    },
    setTimer(seconds, planted) {
      const s = Math.max(0, Math.ceil(seconds));
      const text = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      setText(els.timer, 'timer', text);
      els.timer.classList.toggle('urgent', s <= 10 || planted);
    },
    setScore(a, b, round) {
      setText(els.score, 'score', `${a} — ${b}`);
      setText(els['round-label'], 'round', `ROUND ${round}`);
    },
    setMoney(value) {
      setText(els.money, 'money', `$${value.toLocaleString('en-US')}`);
      setText(els['buy-money'], 'buymoney', `$${value.toLocaleString('en-US')}`);
    },
    setKills(k, d) {
      setText(els.kills, 'kd', `${k} K · ${d} D`);
    },
    setCrosshair(px) {
      const v = Math.round(px);
      if (last.get('xhair') === v) return;
      last.set('xhair', v);
      els.crosshair.style.setProperty('--gap', `${v}px`);
    },
    hitMarker(killed) {
      els.hitmarker.classList.add('on');
      els.hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => els.hitmarker.classList.remove('on', 'kill'), 110);
    },
    damageFlash() {
      els.vignette.classList.add('on');
      setTimeout(() => els.vignette.classList.remove('on'), 220);
    },
    killFeed(killer, victim, weapon, headshot) {
      const row = document.createElement('div');
      row.className = 'feed-row';
      row.textContent = `${killer}  ▸  ${victim}  ·  ${weapon}${headshot ? '  ◉' : ''}`;
      els.feed.prepend(row);
      while (els.feed.children.length > 5) els.feed.removeChild(els.feed.lastChild);
      setTimeout(() => row.remove(), 5200);
    },
    showBanner(title, sub, hold = false) {
      els['banner-title'].textContent = title;
      els['banner-sub'].textContent = sub || '';
      els.banner.hidden = false;
      clearTimeout(bannerTimer);
      if (!hold) {
        bannerTimer = setTimeout(() => {
          els.banner.hidden = true;
        }, 3400);
      }
    },
    hideBanner() {
      els.banner.hidden = true;
    },
    setPlant(frac, label) {
      if (frac <= 0) {
        els['plant-bar'].hidden = true;
        return;
      }
      els['plant-bar'].hidden = false;
      els['plant-fill'].style.width = `${Math.round(frac * 100)}%`;
      setText(els['plant-label'], 'plant', label);
    },
    setSpectate(name) {
      if (name) {
        els.spectate.hidden = false;
        setText(els.spectate, 'spec', `SPECTATING — ${name}`);
      } else {
        els.spectate.hidden = true;
      }
    },
    showOverlay(mode, detail) {
      const text = COPY[mode];
      els['overlay-title'].textContent = text.title;
      els['overlay-copy'].textContent = detail || text.copy;
      els.play.textContent = text.action;
      els.overlay.hidden = false;
      els.play.focus();
    },
    hideOverlay() {
      els.overlay.hidden = true;
    },
    showBuy(show, weapons, grenades, money, owned) {
      els['buy-menu'].hidden = !show;
      if (!show) return;
      const list = els['buy-list'];
      list.innerHTML = '';
      for (const def of weapons) {
        list.appendChild(buyRow(def, `${def.damage} dmg · ${def.mag} rnd`, owned.has(def.id), money >= def.price));
      }
      for (const def of grenades) {
        list.appendChild(buyRow(def, def.id === 'frag' ? '120 dmg blast' : 'Blocks sight 12s', false, money >= def.price));
      }
    },
    drawMinimap,
    onPlay(handler) {
      els.play.addEventListener('click', handler);
    },
  };
}
