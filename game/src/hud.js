// HUD — every DOM element the player sees: vitals, weapon, timer, score,
// money, minimap, kill feed, banners, buy menu and the plant bar. The game
// writes state here; this module never writes game state back, except the
// buy menu's click-to-buy rows.

import { WEAPONS, WEAPON_ORDER, GRENADES } from './weapons.js';

export function createHud(ctx) {
  const { G, player, bots, world } = ctx;
  const $ = (id) => document.getElementById(id);
  const els = {
    cross: $('cross'), hitmark: $('hitmark'),
    vitals: $('vitals'), hpfill: $('hpfill'), hptext: $('hptext'),
    weapon: $('weapon'), wname: $('wname'), ammo: $('ammo'), slots: $('slots'),
    topbar: $('topbar'), timer: $('timer'), score: $('score'), phase: $('phase'),
    wallet: $('wallet'), money: $('money'), kd: $('kd'), round: $('round'),
    minimap: $('minimap'), feed: $('feed'),
    banner: $('banner'), plant: $('plant'), plantfill: $('plantfill'),
    plantLabel: document.querySelector('#plant .label'),
    hint: $('hint'), buy: $('buy'), buylist: $('buylist'), buybal: $('buybal'),
    spectate: $('spectate'),
  };
  const mm = els.minimap.getContext('2d');
  const spotted = new Map(); // bot id -> timestamp until which it is shown
  let hitTimer = 0;
  let bannerTimer = 0;

  const fmtTime = (t) => {
    const s = Math.max(0, Math.ceil(t));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  function feed(msg, cls = '') {
    const div = document.createElement('div');
    if (cls) div.className = cls;
    div.textContent = msg;
    els.feed.prepend(div);
    while (els.feed.children.length > 6) els.feed.lastChild.remove();
    setTimeout(() => { div.style.opacity = '0.25'; }, 6000);
    setTimeout(() => { div.remove(); }, 8000);
  }

  function showBanner(title, sub, cls = '') {
    els.banner.className = `hud ${cls}`;
    els.banner.innerHTML = `<h1>${title}</h1><p>${sub}</p>`;
    bannerTimer = 3.5;
  }

  function hideBanner() {
    els.banner.classList.add('hidden');
    bannerTimer = 0;
  }

  function hitmarker() { hitTimer = 0.18; }

  function renderBuy() {
    const rows = [];
    for (const id of WEAPON_ORDER) {
      const w = WEAPONS[id];
      const owned = player.loadout.owned[id];
      rows.push(`<tr data-buy="${id}"><td class="key">${WEAPON_ORDER.indexOf(id) + 1}</td><td>${w.name}<br><span style="color:#9fb0d0;font-size:12px">${w.desc}</span></td><td class="price ${owned ? 'own' : ''}">${owned ? 'OWNED' : '$' + w.price}</td></tr>`);
    }
    for (const [id, g] of Object.entries(GRENADES)) {
      const n = player.loadout.grenades[id];
      rows.push(`<tr data-buy="${id}"><td class="key">${id === 'frag' ? 5 : 6}</td><td>${g.name} ×${n}<br><span style="color:#9fb0d0;font-size:12px">${g.desc}</span></td><td class="price">$${g.price}</td></tr>`);
    }
    els.buylist.innerHTML = rows.join('');
    els.buybal.textContent = `$${player.money}`;
    for (const tr of els.buylist.querySelectorAll('tr')) {
      tr.style.cursor = 'pointer';
      tr.addEventListener('click', () => {
        const r = player.buy(tr.dataset.buy);
        if (!r.ok) feed(r.reason, 'sys');
        renderBuy();
        updateStatic();
      });
    }
  }

  function setBuyVisible(v) {
    els.buy.classList.toggle('hidden', !v);
    if (v) renderBuy();
  }

  function drawMinimap(now) {
    const W = 170, H = 124;
    const px = (x) => (x + 26) / 52 * W;
    const py = (z) => (z + 19) / 38 * H;
    mm.clearRect(0, 0, W, H);
    mm.fillStyle = 'rgba(20,26,48,0.85)';
    mm.fillRect(0, 0, W, H);
    // cover
    mm.fillStyle = '#4a4a55';
    for (const c of world.colliders) {
      if (c.x1 < -26 || c.x2 > 26) continue; // perimeter
      mm.fillRect(px(c.x1), py(c.z1), px(c.x2) - px(c.x1), py(c.z2) - py(c.z1));
    }
    // sites
    for (const s of Object.values(world.sites)) {
      mm.strokeStyle = s.id === 'A' ? '#57c8ff' : '#ff9a57';
      mm.lineWidth = 1.5;
      mm.strokeRect(px(s.cx - s.hx), py(s.cz - s.hz), px(s.cx + s.hx) - px(s.cx - s.hx), py(s.cz + s.hz) - py(s.cz - s.hz));
      mm.fillStyle = mm.strokeStyle;
      mm.font = 'bold 9px sans-serif';
      mm.textAlign = 'center';
      mm.fillText(s.id, px(s.cx), py(s.cz) + 3);
    }
    // spike
    if (G.spike.dropped) {
      mm.fillStyle = '#ffd75e';
      mm.beginPath(); mm.arc(px(G.spike.dropped.x), py(G.spike.dropped.z), 3, 0, Math.PI * 2); mm.fill();
    }
    if (G.plantedSite) {
      const s = world.sites[G.plantedSite];
      mm.fillStyle = '#ffd75e';
      mm.beginPath(); mm.arc(px(s.cx), py(s.cz), 4, 0, Math.PI * 2); mm.fill();
    }
    // fighters: teammates always, enemies only while spotted
    const drawDot = (f, color, r, ring = false) => {
      mm.fillStyle = color;
      mm.beginPath(); mm.arc(px(f.pos.x), py(f.pos.z), r, 0, Math.PI * 2); mm.fill();
      if (ring) {
        mm.strokeStyle = '#fff'; mm.lineWidth = 1;
        mm.beginPath(); mm.arc(px(f.pos.x), py(f.pos.z), r + 2, 0, Math.PI * 2); mm.stroke();
      }
    };
    if (player.alive) drawDot(player, '#ffffff', 3.5, true);
    for (const b of bots.all()) {
      if (!b.alive) continue;
      if (b.team === 'atk') {
        drawDot(b, '#57c8ff', 3);
      } else if ((spotted.get(b.id) ?? 0) > now) {
        drawDot(b, '#ff5d5d', 3);
      }
    }
    // player view cone
    if (player.alive) {
      mm.strokeStyle = 'rgba(255,255,255,0.5)';
      mm.beginPath();
      mm.moveTo(px(player.pos.x), py(player.pos.z));
      const a = Math.atan2(-Math.cos(player.yaw), -Math.sin(player.yaw));
      mm.lineTo(px(player.pos.x) + Math.cos(a) * 12, py(player.pos.z) + Math.sin(a) * 12);
      mm.stroke();
    }
  }

  function updateSpotted(now) {
    // enemies the player can see stay on the minimap for 3 seconds
    for (const b of bots.all()) {
      if (b.team !== 'def' || !b.alive || !player.alive) continue;
      const dx = b.pos.x - player.pos.x, dz = b.pos.z - player.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 45) continue;
      const facing = { x: -Math.sin(player.yaw), z: -Math.cos(player.yaw) };
      const dot = (dx * facing.x + dz * facing.z) / (dist || 1);
      if (dot < 0.35 && dist > 8) continue;
      if (world.segmentBlocked(player.pos.x, 1.62, player.pos.z, b.pos.x, 1.1, b.pos.z)) continue;
      spotted.set(b.id, now + 3);
    }
  }

  function updateStatic() {
    els.money.textContent = `$${player.money}`;
    els.kd.textContent = `K ${player.kills}   D ${player.deaths}   K/D ${ctx.stats.kd()}`;
    els.round.textContent = `ROUND ${G.round} / 7`;
    const w = player.weapon;
    els.wname.textContent = w.name;
    const a = player.ammo;
    els.ammo.innerHTML = `${a ? a.mag : 0} <small>/ ${a && a.reserve === Infinity ? '∞' : (a ? a.reserve : 0)}</small>`;
    const slotTxt = WEAPON_ORDER
      .filter((id) => player.loadout.owned[id])
      .map((id, i) => `<b>${i + 1}</b> ${WEAPONS[id].name.split(' ')[1] ?? WEAPONS[id].name}`)
      .join(' · ');
    const nades = ` · <b>5</b> Frag ×${player.loadout.grenades.frag} · <b>6</b> Smoke ×${player.loadout.grenades.smoke}`;
    els.slots.innerHTML = slotTxt + nades;
  }

  function update(dt, now) {
    // timer / score / phase
    const t = G.phase === 'planted' ? G.plantT : G.phaseT;
    els.timer.textContent = fmtTime(t);
    els.timer.classList.toggle('low', t <= 10 && (G.phase === 'live' || G.phase === 'planted'));
    els.score.innerHTML = `<span class="atk">ATK ${G.scoreAtk}</span> — <span class="def">${G.scoreDef} DEF</span>`;
    els.phase.textContent =
      G.phase === 'buy' ? `Buy phase — push Site ${G.assignedSite?.id ?? ''}` :
      G.phase === 'live' ? 'Round live' :
      G.phase === 'planted' ? `Spike planted — Site ${G.plantedSite}` :
      G.phase === 'end' ? (G.roundWinner === 'atk' ? 'Attackers take the round' : 'Defenders take the round') :
      G.phase === 'matchend' ? 'Match over' : 'Lobby';
    els.hpfill.style.width = `${player.hp}%`;
    els.hpfill.style.background = player.hp > 50
      ? 'linear-gradient(90deg,#37d67a,#7be495)'
      : player.hp > 25 ? 'linear-gradient(90deg,#e8a13a,#ffd75e)' : 'linear-gradient(90deg,#e83a3a,#ff5d5d)';
    els.hptext.innerHTML = `${Math.ceil(player.hp)} <small>HP</small>`;
    updateStatic();

    // crosshair + hitmarker
    els.cross.classList.toggle('hidden', !player.alive || G.phase === 'buy');
    if (hitTimer > 0) {
      hitTimer -= dt;
      els.hitmark.style.opacity = hitTimer > 0 ? '1' : '0';
    }

    // plant / defuse bar
    if (player.channel) {
      els.plant.classList.remove('hidden');
      els.plantLabel.textContent = player.channel.type === 'plant' ? 'Planting spike' : 'Defusing spike';
      els.plantfill.style.width = `${(player.channel.progress / player.channel.needed) * 100}%`;
    } else {
      els.plant.classList.add('hidden');
    }

    // contextual hint
    let hint = '';
    if (G.phase === 'buy') hint = 'Press <b>B</b> to buy — round starts soon';
    else if (player.alive && player.hasSpike && !G.plantedSite) {
      const site = world.siteAt(player.pos.x, player.pos.z);
      hint = site && site.id === G.assignedSite.id
        ? 'Hold <b>E</b> to plant the spike'
        : `Carry the spike to <b>Site ${G.assignedSite.id}</b> — ${G.assignedSite.name}`;
    } else if (G.phase === 'planted' && player.alive) {
      const s = world.sites[G.plantedSite];
      const d = Math.hypot(player.pos.x - s.cx, player.pos.z - s.cz);
      hint = d < 2.2 ? 'Hold <b>E</b> to defuse' : `Spike planted at <b>Site ${G.plantedSite}</b> — defend it`;
    } else if (!player.alive) hint = 'You are down — spectating your squad';
    els.hint.innerHTML = hint;
    els.hint.classList.toggle('hidden', hint === '');
    els.spectate.classList.toggle('hidden', player.alive);

    if (bannerTimer > 0 && !G.shot) {
      bannerTimer -= dt;
      if (bannerTimer <= 0) hideBanner();
    }
    updateSpotted(now);
    drawMinimap(now);
  }

  function showGameHud(v) {
    for (const id of ['vitals', 'weapon', 'topbar', 'wallet', 'minimap']) {
      els[id].classList.toggle('hidden', !v);
    }
  }

  return { feed, showBanner, hideBanner, hitmarker, renderBuy, setBuyVisible, update, showGameHud, updateStatic };
}
