// viewer.js: ARIS Arena in the browser. Runs the same sim as the CLI (src/*.js), draws it on a canvas, and takes orders.
// Classic script, no dependencies. Opens from file://. Study = bot vs bot. Play = you take side 1 against a scripted bot.
(function () {
  'use strict';
  const A = window.Arena, DATA = window.ARENA_DATA, STRATS = window.ARENA_STRATS;
  const D = A.makeData({ units: DATA.units, buildings: DATA.buildings, econ: DATA.econ, model: DATA.model });
  const LABELS = DATA.labels.labels, LPS = A.LPS, W = 128, H = 128;
  const $ = id => document.getElementById(id);
  const COL = ['#38bdf8', '#fb923c'];
  const SPEEDS = [0.5, 1, 2, 4, 8, 16, 'max'];
  const BUILD_KEYS = '1234567890', TRAIN_KEYS = 'qwertyuiop';
  const ids = Object.keys(STRATS).sort();

  const S = { mode: 'study', seed: 7, strat: [ids.includes('solari_timing') ? 'solari_timing' : ids[0], ids.includes('meridian_timing') ? 'meridian_timing' : ids[1] || ids[0]],
    speed: 1, paused: true, fog: false, analog: false, assist: true, cam: { x: 64, y: 64, z: 6 }, sel: [], ghost: null, armed: false, status: '' };
  let g, orders = [], oi = 0, samples = [], over = null, maxLoop = 0, acc = 0, lastTs = 0, hudAt = 0, drag = null, mouse = { x: 0, y: 0 }, pan = null, vis = null, tlKey = '';
  const cv = $('map'), ctx = cv.getContext('2d'), mini = $('mini'), mctx = mini.getContext('2d');
  let cw = 800, ch = 600, dpr = 1;

  // ------------------------------------------------------------------ names and small helpers
  const label = t => { const l = LABELS[t]; return l ? (S.analog ? l.analog : l.generic) : t; };
  const fmt = s => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  const say = m => { S.status = m; $('status').textContent = m; };
  const ent = id => g.ents[id - 1];
  const alive = e => e && !e.dead;
  const def = e => D.t[e.type];

  // ------------------------------------------------------------------ game lifecycle
  function humanSide(i) { return S.mode === 'play' && i === 0; }
  function newGame(keepOrders) {
    const sp = [STRATS[S.strat[0]], STRATS[S.strat[1]]];
    g = A.newMatch(D, sp, S.seed, S.mode === 'play' ? { assist: S.assist } : null);   // one place builds a game, so a replay starts the same way
    if (!keepOrders) orders = [];
    oi = 0; samples = []; over = null; vis = null; S.sel = []; S.ghost = null; S.armed = false; lastMined = [0, 0]; tlKey = '';
  }
  let lastMined = [0, 0];
  const armyValue = pid => { let v = 0; for (const e of g.ents) if (!e.dead && e.owner === pid && e.kind === 'unit' && e.type !== g.players[pid].R.worker) { const c = D.t[e.type].cost; v += c.minerals + c.gas; } return v; };
  const count = (pid, kind) => { let n = 0; for (const e of g.ents) if (!e.dead && e.owner === pid && e.kind === kind) n++; return n; };
  function sample() { samples.push(A.sampleRow(g, lastMined, 5)); }
  let replaying = false;
  function checkOver() {
    if (replaying) return;
    for (let i = 0; i < 2; i++) if (!g.ents.some(e => !e.dead && e.owner === i && e.kind === 'building')) { over = { loser: i, t: g.loop / LPS }; sample(); showBanner(); return; }
    if (g.loop >= LPS * 2400) { over = { loser: -1, t: g.loop / LPS }; sample(); showBanner(); }
  }
  function showBanner() {
    const b = $('banner'); b.hidden = false;
    b.textContent = over.loser < 0 ? 'Draw at 40:00' : 'Side ' + (2 - over.loser) + ' wins at ' + fmt(over.t) + ' (side ' + (over.loser + 1) + ' has no buildings left)';
    b.style.color = over.loser < 0 ? '#fbbf24' : COL[1 - over.loser];
    S.paused = true; syncControls(); drawGraphs(); $('graphwrap').hidden = false;   // post-game panel
  }
  function stepOne() {
    while (oi < orders.length && orders[oi].loop <= g.loop) applyOrder(orders[oi++]);
    g.tick();
    if (g.loop > maxLoop) maxLoop = g.loop;
    if (g.loop % 112 === 0) sample();
    if (g.loop % 22 === 0 && !over) checkOver();
  }
  function advance(n) { while (n-- > 0 && !over) stepOne(); }
  function seekTo(L) {
    L = Math.max(0, Math.round(L));
    if (L < g.loop) { orders = orders.filter(o => o.loop <= L); newGame(true); $('banner').hidden = true; }
    const was = S.paused; S.paused = true;
    advance(L - g.loop);
    S.paused = was; syncControls();
  }

  // ------------------------------------------------------------------ orders (recorded, so a rewind replays them)
  function siteFor(type, cx, cy) {
    const p = g.players[0], s = A.footprint(g, type), x0 = Math.round(cx - (s - 1) / 2), y0 = Math.round(cy - (s - 1) / 2);
    if (!A.areaFree(g, x0, y0, s, 1)) return null;
    const x = x0 + (s - 1) / 2, y = y0 + (s - 1) / 2;
    if (A.needsPower(g, p, type) && !A.powered(g, p, x, y, A.loops(5))) return null;
    return { x, y };
  }
  const manual = type => { const p = g.players[0]; return type !== p.R.hall && type !== p.R.gas; };
  const free = p => ({ m: p.minerals - p.resv.m, g: p.gas - p.resv.g });
  function applyOrder(o) { const msg = A.applyOrder(g, o, label); if (msg) say(msg); }
  function doOrder(o) {
    if (over) return say('the game is over, press Restart');
    if (S.mode !== 'play') return say('switch to Play mode to give orders');
    o.pid = 0; o.loop = g.loop; orders.push(o); applyOrder(o); oi = orders.length;
  }

  // ------------------------------------------------------------------ selection and input
  const own = e => alive(e) && e.owner === 0;
  const selEnts = () => S.sel.map(ent).filter(alive);
  const selUnits = () => selEnts().filter(e => e.kind === 'unit' && e.owner === 0);
  // The sim does not walk mining workers, so draw them at their patch (halfway home while returning) to give each one its own spot.
  function pos(e) {
    if (e.kind !== 'worker' || e.job !== 'mine' || e.patch === undefined || e.patch < 0) return e;
    const q = g.map.patches[e.patch], b = g.map.bases[q.base], j = ((e.id * 37) % 7 - 3) * 0.1;
    return e.ph === 'ret' ? { x: (q.x + b.x) / 2 + j, y: (q.y + b.y) / 2 + j } : { x: q.x + 0.5 + j, y: q.y + 1.3 + j };
  }
  const entRadius = e => e.kind === 'building' ? A.footprint(g, e.type) / 2 : (e.r || (e.kind === 'worker' ? 0.4 : 0.55));
  function toWorld(mx, my) { return { x: (mx - cw / 2) / S.cam.z + S.cam.x, y: (my - ch / 2) / S.cam.z + S.cam.y }; }
  function toScreen(x, y) { return { x: (x - S.cam.x) * S.cam.z + cw / 2, y: (y - S.cam.y) * S.cam.z + ch / 2 }; }
  function visible(e) { return !S.fog || e.owner === 0 || (vis && vis[Math.round(e.y) * W + Math.round(e.x)]); }
  function entAt(w, enemyOk) {
    let best = null, bd = 1e9;
    for (const e of g.ents) {
      if (e.dead || e.kind === 'egg' || (!enemyOk && e.owner !== 0) || !visible(e)) continue;
      const q = pos(e), r = entRadius(e) + 0.25, d = e.kind === 'building' ? Math.max(Math.abs(e.x - w.x), Math.abs(e.y - w.y)) : Math.hypot(q.x - w.x, q.y - w.y);
      if (d <= r && d < bd) { best = e; bd = d; }
    }
    return best;
  }
  function boxSelect(a, b, add) {
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    const hit = g.ents.filter(e => { if (!own(e) || !(e.kind === 'unit' || e.kind === 'worker')) return false; const q = pos(e); return q.x >= x0 && q.x <= x1 && q.y >= y0 && q.y <= y1; });
    const units = hit.filter(e => e.kind === 'unit');
    const pick = (units.length ? units : hit).map(e => e.id);
    S.sel = add ? Array.from(new Set(S.sel.concat(pick))) : pick;
  }
  function canvasXY(ev) { const r = cv.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; }

  cv.addEventListener('contextmenu', ev => ev.preventDefault());
  cv.addEventListener('mousedown', ev => {
    cv.focus(); const m = canvasXY(ev); mouse = m;
    if (ev.button === 1) { pan = { x: ev.clientX, y: ev.clientY, cx: S.cam.x, cy: S.cam.y }; ev.preventDefault(); return; }
    if (ev.button === 2) return rightClick(m, ev);
    if (S.ghost) return placeGhost(m);
    drag = { a: m, add: ev.shiftKey };
  });
  cv.addEventListener('mousemove', ev => {
    mouse = canvasXY(ev);
    if (pan) { S.cam.x = pan.cx - (ev.clientX - pan.x) / S.cam.z; S.cam.y = pan.cy - (ev.clientY - pan.y) / S.cam.z; }
  });
  window.addEventListener('mouseup', ev => {
    if (pan) { pan = null; return; }
    if (!drag || ev.button !== 0) return;
    const m = canvasXY(ev), a = drag.a; drag = null;
    if (S.armed) { S.armed = false; const w = toWorld(m.x, m.y); orderUnits('attackmove', w); return; }
    if (Math.hypot(m.x - a.x, m.y - a.y) < 5) {
      const e = entAt(toWorld(m.x, m.y), true);
      S.sel = e ? (ev.shiftKey ? Array.from(new Set(S.sel.concat([e.id]))) : [e.id]) : (ev.shiftKey ? S.sel : []);
    } else boxSelect(toWorld(a.x, a.y), toWorld(m.x, m.y), ev.shiftKey);
  });
  cv.addEventListener('wheel', ev => { ev.preventDefault(); S.cam.z = Math.max(3, Math.min(24, S.cam.z * (ev.deltaY < 0 ? 1.12 : 1 / 1.12))); }, { passive: false });
  function orderUnits(k, w) { const u = selUnits(); if (!u.length) return say('select some of your units first'); doOrder({ k, ids: u.map(e => e.id), x: w.x, y: w.y }); }
  function rightClick(m, ev) {
    if (S.ghost) { S.ghost = null; return; }
    if (S.mode !== 'play') return say('switch to Play mode to give orders');
    const w = toWorld(m.x, m.y), t = entAt(w, true), u = selUnits(), sel = selEnts();
    if (u.length) { if (t && t.owner !== 0) doOrder({ k: 'attack', ids: u.map(e => e.id), target: t.id }); else doOrder({ k: 'move', ids: u.map(e => e.id), x: w.x, y: w.y }); return; }
    const b = sel.find(e => e.kind === 'building' && e.owner === 0);
    if (b) { doOrder({ k: 'rally', id: b.id, x: w.x, y: w.y }); say('rally point set'); return; }
    say('nothing to order: select units or a building');
  }
  function placeGhost(m) {
    const w = toWorld(m.x, m.y), type = S.ghost.type, site = siteFor(type, w.x, w.y);
    if (!site) return say('cannot place ' + label(type) + ' there (blocked' + (A.needsPower(g, g.players[0], type) ? ' or no power' : '') + ')');
    doOrder({ k: 'build', type, x: site.x, y: site.y }); S.ghost = null;
  }
  function startBuild(type) {
    if (S.mode !== 'play') return say('switch to Play mode to build');
    const hasWorker = selEnts().some(e => e.kind === 'worker' && e.owner === 0);
    if (!hasWorker) return say('select a worker first');
    if (!manual(type)) { doOrder({ k: 'build', type }); return; }
    S.ghost = { type }; say('click the map to place ' + label(type) + ', Esc cancels');
  }
  function startTrain(type) { if (S.mode !== 'play') return say('switch to Play mode to train'); doOrder({ k: 'train', type }); }

  window.addEventListener('keydown', ev => {
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(ev.target.tagName) && ev.target.type !== 'checkbox' && ev.target.type !== 'range') return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const k = ev.key.toLowerCase(), c = S.cam, step = 40 / c.z;
    if (k === 'escape') { S.ghost = null; S.armed = false; return; }
    if (k === 'arrowleft') c.x -= step; else if (k === 'arrowright') c.x += step; else if (k === 'arrowup') c.y -= step; else if (k === 'arrowdown') c.y += step;
    else if (k === ' ') { ev.preventDefault(); S.paused = !S.paused; syncControls(); }
    else if (S.mode === 'play') {
      if (k === 'a') { S.armed = true; say('attack-move: click the target'); }
      else if (k === 'k') { const u = selUnits(); if (u.length) doOrder({ k: 'siege', ids: u.map(e => e.id) }); }
      else if (k === 'x') { const b = selEnts().find(e => e.kind === 'building' && e.owner === 0 && e.done); if (b) doOrder({ k: 'surge', id: b.id }); else say('select a producing building'); }
      else if (BUILD_KEYS.includes(k) && buildList()[BUILD_KEYS.indexOf(k)]) startBuild(buildList()[BUILD_KEYS.indexOf(k)]);
      else if (TRAIN_KEYS.includes(k) && trainList()[TRAIN_KEYS.indexOf(k)]) startTrain(trainList()[TRAIN_KEYS.indexOf(k)]);
    }
  });
  mini.addEventListener('mousedown', ev => { const r = mini.getBoundingClientRect(); S.cam.x = (ev.clientX - r.left) / r.width * W; S.cam.y = (ev.clientY - r.top) / r.height * H; });

  // ------------------------------------------------------------------ build and train lists for the human side
  const race = () => g.players[0].race;
  const prod = d => D.t[d.produced_by];
  function buildList() {
    return Object.keys(D.t).filter(id => { const d = D.t[id]; return d.kind === 'building' && d.race === race() && d.produced_by !== 'brood' && !(prod(d) && prod(d).kind === 'building'); });
  }
  function trainList() {
    return Object.keys(D.t).filter(id => { const d = D.t[id]; return d.race === race() && (d.kind === 'unit' || d.produced_by === 'brood' || (prod(d) && prod(d).kind === 'building')) && (d.produced_by === 'brood' || prod(d)); });
  }

  // ------------------------------------------------------------------ drawing
  const terrain = document.createElement('canvas'); terrain.width = W; terrain.height = H;
  function paintTerrain() {
    const c = terrain.getContext('2d'), im = c.createImageData(W, H), m = g.map;
    for (let i = 0; i < W * H; i++) { const v = m.grid[i], o = i * 4; const col = v === 1 ? [30, 41, 59] : [10, 18, 30]; im.data[o] = col[0]; im.data[o + 1] = col[1]; im.data[o + 2] = col[2]; im.data[o + 3] = 255; }
    c.putImageData(im, 0, 0);
  }
  function visibility() {
    if (!S.fog) { vis = null; return; }
    vis = new Uint8Array(W * H);
    for (const e of g.ents) {
      if (e.dead || e.owner !== 0 || e.kind === 'egg') continue;
      const r = (D.t[e.type] && D.t[e.type].sight) || 8, r2 = r * r, x0 = Math.floor(e.x), y0 = Math.floor(e.y);
      for (let y = Math.max(0, y0 - r); y <= Math.min(H - 1, y0 + r); y++) for (let x = Math.max(0, x0 - r); x <= Math.min(W - 1, x0 + r); x++) if ((x - e.x) * (x - e.x) + (y - e.y) * (y - e.y) <= r2) vis[y * W + x] = 1;
    }
  }
  function rectCells(x, y, s, fill, stroke) { const a = toScreen(x - s / 2, y - s / 2), z = S.cam.z * s; if (fill) { ctx.fillStyle = fill; ctx.fillRect(a.x, a.y, z, z); } if (stroke) { ctx.strokeStyle = stroke; ctx.strokeRect(a.x + .5, a.y + .5, z - 1, z - 1); } }
  function circle(x, y, r, fill, stroke) { const a = toScreen(x, y); ctx.beginPath(); ctx.arc(a.x, a.y, Math.max(2, r * S.cam.z), 0, 6.2832); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); } }
  function hpBar(e, r) {
    const d = D.t[e.type]; if (!d || e.hp === undefined) return;
    const max = d.hp + (d.shield || 0), cur = e.hp + (e.sh || 0); if (cur >= max) return;
    const a = toScreen(e.x, e.y - r - 0.5), w = Math.max(10, r * 2 * S.cam.z);
    ctx.fillStyle = '#1f2937'; ctx.fillRect(a.x - w / 2, a.y, w, 3); ctx.fillStyle = cur / max > .5 ? '#4ade80' : cur / max > .25 ? '#fbbf24' : '#f87171'; ctx.fillRect(a.x - w / 2, a.y, w * Math.max(0, cur / max), 3);
  }
  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#050a12'; ctx.fillRect(0, 0, cw, ch);
    const o = toScreen(-0.5, -0.5);
    ctx.imageSmoothingEnabled = false; ctx.drawImage(terrain, o.x, o.y, W * S.cam.z, H * S.cam.z);
    ctx.strokeStyle = '#1e3a5f'; ctx.strokeRect(o.x, o.y, W * S.cam.z, H * S.cam.z);
    const m = g.map;
    for (const p of m.patches) if (!p.dead) { const a = toScreen(p.x - 0.5, p.y - 0.5); ctx.globalAlpha = .35 + .65 * Math.min(1, p.amount / 1800); ctx.fillStyle = '#67e8f9'; ctx.fillRect(a.x, a.y, S.cam.z * 2, S.cam.z); ctx.globalAlpha = 1; }
    for (const gy of m.geysers) { const a = toScreen(gy.x - 1.5, gy.y - 1.5); ctx.fillStyle = gy.amount > 0 ? '#166534' : '#14231a'; ctx.fillRect(a.x, a.y, S.cam.z * 3, S.cam.z * 3); ctx.strokeStyle = '#4ade80'; ctx.strokeRect(a.x + .5, a.y + .5, S.cam.z * 3 - 1, S.cam.z * 3 - 1); }
    visibility();
    const sel = new Set(S.sel);
    for (const e of g.ents) if (!e.dead && e.kind === 'building' && visible(e)) {
      const s = A.footprint(g, e.type), c = COL[e.owner];
      ctx.globalAlpha = e.done ? 1 : .4; rectCells(e.x, e.y, s, c + '55', c); ctx.globalAlpha = 1;
      if (e.rally && sel.has(e.id)) { const a = toScreen(e.x, e.y), b = toScreen(e.rally.x, e.rally.y); ctx.strokeStyle = '#fbbf24'; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
      if (sel.has(e.id)) rectCells(e.x, e.y, s + 0.6, null, '#fbbf24');
      hpBar(e, s / 2);
    }
    for (const e of g.ents) if (!e.dead && e.kind !== 'building' && visible(e)) {
      const r = e.kind === 'egg' ? 0.3 : e.r || (e.kind === 'worker' ? 0.35 : 0.5), c = COL[e.owner];
      const q = pos(e);
      circle(q.x, q.y, r, e.kind === 'worker' ? c + '99' : c, sel.has(e.id) ? '#fbbf24' : '#0b1220');
      if (e.kind === 'unit') { if (e.sieged) circle(e.x, e.y, r + 0.2, null, '#f87171'); hpBar(e, r); }
      if (e.tgt && e.kind === 'unit' && S.speed !== 'max') { const t = ent(e.tgt); if (alive(t) && visible(t)) { const a = toScreen(e.x, e.y), b = toScreen(t.x, t.y); ctx.strokeStyle = COL[e.owner] + '66'; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); } }
    }
    if (S.fog && vis) {   // darken what we cannot see
      const f = document.createElement('canvas'); f.width = W; f.height = H; const fc = f.getContext('2d'), im = fc.createImageData(W, H);
      for (let i = 0; i < W * H; i++) { im.data[i * 4 + 3] = vis[i] ? 0 : 170; im.data[i * 4 + 2] = 8; }
      fc.putImageData(im, 0, 0); ctx.drawImage(f, o.x, o.y, W * S.cam.z, H * S.cam.z);
    }
    if (S.ghost) {
      const w = toWorld(mouse.x, mouse.y), site = siteFor(S.ghost.type, w.x, w.y), s = A.footprint(g, S.ghost.type), p = site || { x: Math.round(w.x), y: Math.round(w.y) };
      ctx.globalAlpha = .6; rectCells(p.x, p.y, s, site ? '#4ade80' : '#f87171', '#fff'); ctx.globalAlpha = 1;
    }
    if (drag) { const a = drag.a; ctx.strokeStyle = '#fbbf24'; ctx.strokeRect(Math.min(a.x, mouse.x), Math.min(a.y, mouse.y), Math.abs(mouse.x - a.x), Math.abs(mouse.y - a.y)); }
    drawMini();
  }
  function drawMini() {
    mctx.drawImage(terrain, 0, 0);
    for (const p of g.map.patches) if (!p.dead) { mctx.fillStyle = '#67e8f9'; mctx.fillRect(p.x, p.y, 2, 1); }
    for (const e of g.ents) if (!e.dead && e.kind !== 'egg' && visible(e)) { mctx.fillStyle = COL[e.owner]; const s = e.kind === 'building' ? 3 : 1.5; mctx.fillRect(e.x - s / 2, e.y - s / 2, s, s); }
    const a = toWorld(0, 0), b = toWorld(cw, ch); mctx.strokeStyle = '#fff'; mctx.lineWidth = 1; mctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
  }

  // ------------------------------------------------------------------ graphs (income, workers, army value, supply)
  function drawGraphs() {
    const c = $('graphs').getContext('2d'), Wd = 900, Ht = 520, defs = [['income', 'Mineral income per minute'], ['workers', 'Workers'], ['army', 'Army value (minerals + gas)'], ['supply', 'Supply used']];
    c.fillStyle = '#0d1726'; c.fillRect(0, 0, Wd, Ht); c.font = '12px ui-monospace, Menlo, monospace';
    const tmax = Math.max(60, samples.length ? samples[samples.length - 1].t : 60);
    defs.forEach(([key, title], i) => {
      const x0 = 50 + (i % 2) * 440, y0 = 40 + Math.floor(i / 2) * 240, w = 380, h = 170;
      let vmax = 1; for (const r of samples) for (const p of r.p) vmax = Math.max(vmax, p[key]);
      c.fillStyle = '#d8e6f5'; c.fillText(title, x0, y0 - 14);
      c.strokeStyle = '#1e3a5f'; c.strokeRect(x0, y0, w, h);
      c.fillStyle = '#7e93ad'; c.fillText(String(Math.round(vmax)), x0 - 40, y0 + 10); c.fillText('0', x0 - 14, y0 + h); c.fillText(fmt(tmax), x0 + w - 30, y0 + h + 14);
      for (let pi = 0; pi < 2; pi++) {
        c.strokeStyle = COL[pi]; c.lineWidth = 2; c.beginPath();
        samples.forEach((r, k) => { const x = x0 + r.t / tmax * w, y = y0 + h - r.p[pi][key] / vmax * h; k ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke();
      }
    });
    c.fillStyle = COL[0]; c.fillText('Side 1 ' + S.strat[0], 50, Ht - 14); c.fillStyle = COL[1]; c.fillText('Side 2 ' + S.strat[1], 330, Ht - 14);
  }

  // ------------------------------------------------------------------ DOM: HUD, panels, controls
  function hud() {
    $('clock').textContent = fmt(g.loop / LPS);
    $('hud').innerHTML = [0, 1].map(i => { const p = g.players[i]; return `<div class="pl p${i}"><b class="n">Side ${i + 1}</b> <span class="k">${p.race}</span><span class="k">M</span> <b>${Math.floor(p.minerals)}</b><span class="k">G</span> <b>${Math.floor(p.gas)}</b><span class="k">S</span> <b>${p.used}/${p.cap}</b><span class="k">W</span> <b>${count(i, 'worker')}</b><span class="k">Army</span> <b>${armyValue(i)}</b></div>`; }).join('');
    const sc = $('scrub'); if (document.activeElement !== sc) { sc.max = Math.max(1, Math.floor(maxLoop / LPS)); sc.value = Math.floor(g.loop / LPS); }
    $('scrubv').textContent = fmt(g.loop / LPS);
    const se = selEnts(), box = $('sel');
    if (!se.length) box.textContent = 'nothing selected';
    else if (se.length === 1) { const e = se[0], d = def(e); box.textContent = `${label(e.type)}  (side ${e.owner + 1})\n${e.kind}${e.done === false ? ', under construction' : ''}\nhp ${Math.ceil(e.hp === undefined ? (d ? d.hp : 0) : e.hp)}${e.sh ? '  shield ' + Math.ceil(e.sh) : ''}${e.queue ? '\nqueue ' + e.queue.length : ''}${e.energy !== undefined ? '\nenergy ' + Math.floor(e.energy) : ''}${e.rally ? '\nrally set' : ''}`; }
    else { const by = {}; for (const e of se) by[label(e.type)] = (by[label(e.type)] || 0) + 1; box.textContent = se.length + ' selected\n' + Object.keys(by).map(k => by[k] + ' ' + k).join(', '); }
    const play = S.mode === 'play'; $('playsec').hidden = !play;
    if (play) {
      const p = g.players[0], f = free(p);
      document.querySelectorAll('#builds button, #trains button').forEach(b => { const d = D.t[b.dataset.id], c = d.cost; b.disabled = !A.unlocked(g, p, b.dataset.id) || f.m < c.minerals || f.g < c.gas; });
    }
    const key = g.log.length + ':' + S.analog; if (key !== tlKey) { tlKey = key; timeline(); }
  }
  function timeline() {
    $('timeline').innerHTML = [0, 1].map(i => {
      const rows = g.log.filter(l => l.p === i && (l.ev === 'placed' || l.ev === 'trained') && l.what !== g.players[i].R.worker).slice(0, 22);
      return `<div class="p${i}"><h3>Side ${i + 1}: ${S.strat[i]}</h3><ol>${rows.map(l => `<li>${fmt(l.t)} ${label(l.what)}</li>`).join('') || '<li>nothing yet</li>'}</ol></div>`;
    }).join('');
  }
  function buildButtons() {
    if (!g) return;
    const mk = (list, keys, fn) => list.map((id, i) => `<button data-id="${id}" data-fn="${fn}"><span class="key">${keys[i] || ''}</span>${label(id)}<small>${D.t[id].cost.minerals}${D.t[id].cost.gas ? ' / ' + D.t[id].cost.gas : ''}</small></button>`).join('');
    $('builds').innerHTML = mk(buildList(), BUILD_KEYS.toUpperCase(), 'build');
    $('trains').innerHTML = mk(trainList(), TRAIN_KEYS.toUpperCase(), 'train');
    document.querySelectorAll('#builds button').forEach(b => b.addEventListener('click', () => startBuild(b.dataset.id)));
    document.querySelectorAll('#trains button').forEach(b => b.addEventListener('click', () => startTrain(b.dataset.id)));
  }
  function syncControls() {
    $('pp').textContent = S.paused ? 'Play' : 'Pause';
    $('mStudy').classList.toggle('on', S.mode === 'study'); $('mPlay').classList.toggle('on', S.mode === 'play');
    document.querySelectorAll('#speeds button').forEach(b => b.classList.toggle('on', b.dataset.s === String(S.speed)));
    $('modehint').textContent = S.mode === 'study' ? 'Both sides run their scripted strategy. Watch, rewind, compare.' : 'You are side 1. Side 2 runs its scripted strategy. Select a worker, then build.';
  }
  function setMode(m) { S.mode = m; restart(); }
  function restart() {
    S.seed = Math.max(1, Math.round(Number($('seed').value) || 7)); S.strat = [$('s0').value, $('s1').value]; S.assist = $('assist').checked;
    newGame(false); maxLoop = 0; $('banner').hidden = true; paintTerrain(); buildButtons(); fillSteps(); timeline(); syncControls(); fitCamera();
    say(S.mode === 'play' ? 'Play mode: you are side 1' : 'Study mode');
  }
  function fitCamera() { S.cam = { x: 64, y: 64, z: Math.max(3, Math.min(cw, ch) / 130) }; }
  function resize() { const r = cv.getBoundingClientRect(); dpr = window.devicePixelRatio || 1; cw = Math.max(300, r.width); ch = Math.max(300, r.height); cv.width = cw * dpr; cv.height = ch * dpr; }

  // ------------------------------------------------------------------ study tools: replays, what if, CSV
  function replayObject() { return A.makeReplay([STRATS[S.strat[0]], STRATS[S.strat[1]]], S.seed, S.mode === 'play' ? { assist: S.assist } : null, orders, g); }
  function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
  function addStratOption(id) { for (const sel of [$('s0'), $('s1')]) if (![...sel.options].some(o => o.value === id)) sel.add(new Option(id, id)); }
  function loadReplayObject(rp) {
    const use = rp.strats.map((st, k) => {   // keep the replay's own strategy objects: a what-if variant has the same id as its base but other steps
      const same = STRATS[st.id] && JSON.stringify(STRATS[st.id]) === JSON.stringify(st), id = same ? st.id : st.id + '~replay' + k;
      if (!same) STRATS[id] = Object.assign({}, st, { id }); addStratOption(id); return id;
    });
    S.strat = use; S.seed = rp.seed; S.mode = rp.human ? 'play' : 'study'; if (rp.human) S.assist = !!rp.human.assist;
    $('s0').value = use[0]; $('s1').value = use[1]; $('seed').value = rp.seed; $('assist').checked = S.assist;
    newGame(false); orders = rp.orders.slice(); maxLoop = rp.end; paintTerrain(); buildButtons(); fitCamera(); $('banner').hidden = true; S.paused = true;
    replaying = true; advance(rp.end); replaying = false; syncControls(); checkOver();
    const ok = g.hash() === rp.hash;
    say(ok ? 'replay loaded to ' + fmt(g.loop / LPS) + ': state hash ' + rp.hash + ' matches' : 'REPLAY MISMATCH: recorded ' + rp.hash + ', re-simulated ' + g.hash());
    return ok;
  }
  function fillSteps() {
    const steps = STRATS[S.strat[0]].steps || [];
    $('wiStep').innerHTML = steps.map((st, i) => `<option value="${i}">${i}: ${st.do} ${st.what ? label(st.what) : ''} @ ${JSON.stringify(st.at || {})}</option>`).join('');
  }
  function runWhatIf() {
    const i = Number($('wiStep').value), sup = Number($('wiSupply').value), base = STRATS[S.strat[0]];
    if (!base.steps || !base.steps[i]) return say('this strategy has no steps to change');
    const r = A.whatIf(D, base, STRATS[S.strat[1]], S.seed, 420, i, { supply: sup });
    const lines = [`step ${i} (${r.was.do} ${r.was.what || ''}) moved from ${JSON.stringify(r.was.at)} to ${JSON.stringify(r.now.at)}, both sides scripted, seed ${S.seed}, to 7:00`];
    lines.push(r.diffs.length ? 'timings that moved (everything else is identical):' : 'no timing moved');
    for (const d of r.diffs) lines.push(`  ${d.key.replace(/^(placed|trained) /, '$1 ').padEnd(28)} ${d.base === null ? '-' : fmt(d.base)} -> ${d.alt === null ? '-' : fmt(d.alt)}`);
    const b = r.result.base, a = r.result.alt;
    lines.push(`at 7:00: supply ${b.supply} -> ${a.supply}, army ${b.army} -> ${a.army}, minerals ${Math.round(b.minerals)} -> ${Math.round(a.minerals)}`);
    $('whatif').textContent = lines.join('\n');
    return r;
  }

  function init() {
    for (const sel of [$('s0'), $('s1')]) sel.innerHTML = ids.map(id => `<option value="${id}">${id}</option>`).join('');
    $('s0').value = S.strat[0]; $('s1').value = S.strat[1];
    $('speeds').innerHTML = SPEEDS.map(s => `<button data-s="${s}">${s === 'max' ? 'Max' : s + 'x'}</button>`).join('');
    document.querySelectorAll('#speeds button').forEach(b => b.addEventListener('click', () => { S.speed = b.dataset.s === 'max' ? 'max' : Number(b.dataset.s); syncControls(); }));
    $('pp').addEventListener('click', () => { if (over) return say('the game is over, press Restart'); S.paused = !S.paused; syncControls(); });
    $('back10').addEventListener('click', () => seekTo(g.loop - 10 * LPS));
    $('scrub').addEventListener('input', () => { $('scrubv').textContent = fmt(Number($('scrub').value)); });
    $('scrub').addEventListener('change', () => seekTo(Number($('scrub').value) * LPS));
    $('restart').addEventListener('click', restart);
    $('mStudy').addEventListener('click', () => setMode('study')); $('mPlay').addEventListener('click', () => setMode('play'));
    $('fog').addEventListener('change', () => { S.fog = $('fog').checked; });
    $('names').addEventListener('change', () => { S.analog = $('names').checked; buildButtons(); tlKey = ''; });
    for (const id of ['s0', 's1', 'assist']) $(id).addEventListener('change', restart);
    $('saveReplay').addEventListener('click', () => { const rp = replayObject(); download('arena_replay_' + S.seed + '.json', JSON.stringify(rp), 'application/json'); say('replay saved: ' + JSON.stringify(rp).length + ' bytes, ends ' + fmt(rp.end / LPS) + ', hash ' + rp.hash); });
    $('replayfile').addEventListener('change', ev => { const f = ev.target.files[0]; if (!f) return; f.text().then(t => { try { loadReplayObject(JSON.parse(t)); } catch (e) { say('could not read that replay: ' + e.message); } }); ev.target.value = ''; });
    $('csvBtn').addEventListener('click', () => { if (!samples.length) return say('no graph samples yet, let the game run first'); download('arena_graphs.csv', A.csv(samples), 'text/csv'); });
    $('wiRun').addEventListener('click', runWhatIf);
    $('graphsBtn').addEventListener('click', () => { sample(); drawGraphs(); $('graphwrap').hidden = false; });
    $('gclose').addEventListener('click', () => { $('graphwrap').hidden = true; });
    window.addEventListener('resize', resize);
    resize(); restart(); S.paused = true; syncControls();
    requestAnimationFrame(frame);
  }
  function frame(ts) {
    const dt = Math.min(100, ts - (lastTs || ts)); lastTs = ts;
    if (!S.paused && !over) {
      if (S.speed === 'max') { const t0 = performance.now(); while (performance.now() - t0 < 12 && !over) stepOne(); }
      else { acc += dt / 1000 * LPS * S.speed; let n = Math.min(Math.floor(acc), 600); acc -= Math.floor(acc); while (n-- > 0 && !over) stepOne(); }
    }
    draw();
    if (ts - hudAt > 150) { hudAt = ts; hud(); }
    requestAnimationFrame(frame);
  }

  // A small hook so tests and the console can drive the page.
  window.ARENA_VIEW = { S, advance, seekTo, restart, setMode, hud, draw, toScreen: (x, y) => { const r = cv.getBoundingClientRect(), s = toScreen(x, y); return { x: r.left + s.x, y: r.top + s.y }; },
    pos, replayObject, loadReplayObject, runWhatIf, csv: () => A.csv(samples), get g() { return g; }, get over() { return over; }, get orders() { return orders; }, get samples() { return samples; }, findSite: type => A.findSite(g, g.players[0], type, A.loops(5)), buildList, trainList, label };
  init();
})();
