// The DOM HUD: health, ammunition, timer, score, money, kill feed, minimap, buy menu and
// the overlay panels. It never touches the simulation; main.js pushes numbers in and reads
// the button callbacks out. Every setter skips a write when nothing changed.
export function createHud(world, hooks) {
  const $ = (id) => document.getElementById(id);
  const els = {
    healthBar: $('health-fill'), healthNum: $('health-num'), ammoMag: $('ammo-mag'),
    ammoReserve: $('ammo-reserve'), weaponName: $('weapon-name'), timer: $('timer'),
    score: $('score'), money: $('money'), kills: $('kills'), feed: $('feed'),
    banner: $('banner'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'),
    crosshair: $('crosshair'), hitmarker: $('hitmarker'), vignette: $('vignette'),
    overlay: $('overlay'), overlayTitle: $('overlay-title'), overlayCopy: $('overlay-copy'),
    play: $('play'), buyMenu: $('buy-menu'), buyMoney: $('buy-money'),
    plantBar: $('plant-bar'), plantFill: $('plant-fill'), plantLabel: $('plant-label'),
    minimap: $('minimap'), spectate: $('spectate'), grenades: $('grenades'),
    roundLabel: $('round-label'),
  };
  const mapCtx = els.minimap.getContext('2d');
  const MAP_SIZE = 168;
  const bounds = world.bounds;
  const mapX = (x) => ((x - bounds.minX) / (bounds.maxX - bounds.minX)) * MAP_SIZE;
  const mapZ = (z) => ((z - bounds.minZ) / (bounds.maxZ - bounds.minZ)) * MAP_SIZE;

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
  let last = {};
  let hitTimer = 0;
  let bannerTimer = 0;

  function setText(el, key, value) {
    if (last[key] === value) return;
    last[key] = value;
    el.textContent = value;
  }

  function drawMinimap(player, bots, bomb) {
    const ctx = mapCtx;
    ctx.clearRect(0, 0, MAP_SIZE, MAP_SIZE);
    ctx.fillStyle = 'rgba(13,20,29,0.85)';
    ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
    ctx.fillStyle = '#35424f';
    for (const box of world.colliders) {
      const w = mapX(box.max.x) - mapX(box.min.x);
      const h = mapZ(box.max.z) - mapZ(box.min.z);
      if (w < 1 && h < 1) continue;
      ctx.fillRect(mapX(box.min.x), mapZ(box.min.z), Math.max(1, w), Math.max(1, h));
    }
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [name, site] of Object.entries(world.sites)) {
      ctx.fillStyle = name === 'A' ? '#ff8a2a' : '#35c4b5';
      ctx.fillText(name, mapX(site.center.x), mapZ(site.center.z));
    }
    if (bomb.planted) {
      ctx.fillStyle = '#e5484d';
      ctx.beginPath();
      ctx.arc(mapX(bomb.pos.x), mapZ(bomb.pos.z), 4, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const bot of bots) {
      if (!bot.alive) continue;
      ctx.fillStyle = bot.team === 'A' ? '#ff8a2a' : '#35c4b5';
      ctx.beginPath();
      ctx.arc(mapX(bot.body.state.position.x), mapZ(bot.body.state.position.z), 3, 0, Math.PI * 2);
      ctx.fill();
    }
    if (player.alive) {
      const x = mapX(player.pos.x);
      const y = mapZ(player.pos.z);
      ctx.fillStyle = '#ece7db';
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.atan2(-Math.sin(player.yaw), -Math.cos(player.yaw)) + Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(4, 5);
      ctx.lineTo(-4, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  return {
    setHealth(hp) {
      setText(els.healthNum, 'hp', String(Math.max(0, Math.ceil(hp))));
      const pct = Math.max(0, Math.min(100, hp));
      if (last.hpPct !== pct) {
        last.hpPct = pct;
        els.healthBar.style.width = `${pct}%`;
        els.healthBar.classList.toggle('low', pct <= 30);
      }
    },
    setAmmo(mag, reserve) {
      setText(els.ammoMag, 'mag', String(mag));
      setText(els.ammoReserve, 'res', `/ ${reserve}`);
    },
    setWeapon(name) {
      setText(els.weaponName, 'wname', name);
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
      setText(els.roundLabel, 'round', `ROUND ${round}`);
    },
    setMoney(value) {
      setText(els.money, 'money', `$${value.toLocaleString('en-US')}`);
      setText(els.buyMoney, 'buymoney', `$${value.toLocaleString('en-US')}`);
    },
    setKills(k, d) {
      setText(els.kills, 'kd', `${k} K · ${d} D`);
    },
    setCrosshair(px) {
      const v = Math.round(px);
      if (last.xhair === v) return;
      last.xhair = v;
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
      els.bannerTitle.textContent = title;
      els.bannerSub.textContent = sub || '';
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
        els.plantBar.hidden = true;
        return;
      }
      els.plantBar.hidden = false;
      els.plantFill.style.width = `${Math.round(frac * 100)}%`;
      setText(els.plantLabel, 'plant', label);
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
      els.overlayTitle.textContent = text.title;
      els.overlayCopy.textContent = detail || text.copy;
      els.play.textContent = text.action;
      els.overlay.hidden = false;
      els.play.focus();
    },
    hideOverlay() {
      els.overlay.hidden = true;
    },
    showBuy(show, weapons, grenades, money, owned) {
      els.buyMenu.hidden = !show;
      if (!show) return;
      const list = $('buy-list');
      list.innerHTML = '';
      const addRow = (def, ownedAlready, afford) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'buy-row';
        row.disabled = ownedAlready || !afford;
        row.innerHTML = `<b>${def.name}</b><span>${def.price === 0 ? 'OWNED' : `$${def.price}`}</span><i>${def.blurb || ''}</i>`;
        row.addEventListener('click', () => hooks.onBuy(def.id));
        list.appendChild(row);
      };
      for (const def of weapons) addRow({ ...def, blurb: `${def.damage} dmg · ${def.mag} rnd` }, owned.has(def.id), money >= def.price);
      for (const def of grenades) addRow({ ...def, blurb: def.id === 'frag' ? '120 dmg blast' : 'Blocks sight 12s' }, false, money >= def.price);
    },
    drawMinimap,
    onPlay(handler) {
      els.play.addEventListener('click', handler);
    },
  };
}
