// econ.js: workers, mining with one worker per patch at a time, gas, supply, construction, production queues, surge, brood.
(function (root) {
  'use strict';
  if (!root.Arena && typeof require !== 'undefined') require('./core.js');
  if (typeof require !== 'undefined') require('./tech.js');
  const A = root.Arena;
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  const jit = g => { const j = g.D.M.jitter; return j ? Math.floor(g.rand() * (2 * j + 1)) - j : 0; };
  const ent = (g, id) => g.ents[id - 1];

  function footprint(g, type) { const f = g.D.M.footprint; return f[type] || f.default; }
  function markFoot(g, b, v) {
    const s = footprint(g, b.type), x0 = Math.floor(b.x - s / 2 + 0.5), y0 = Math.floor(b.y - s / 2 + 0.5), W = g.map.W;
    for (let y = y0; y < y0 + s; y++) for (let x = x0; x < x0 + s; x++) g.map.grid[y * W + x] = v;
  }

  function spawnBuilding(g, p, type, x, y, done) {
    const def = g.D.t[type];
    const b = g.spawn({ owner: p.id, type, kind: 'building', x, y, done, work: done ? 0 : def.work, queue: [], slots: 1, addon: null,
      surge: 0, energy: 0, brood: 0, brood_t: 0, base: -1, t: 0, cargo: 0, patch: 0 });
    if (type === p.R.hall) {
      if (p.race === 'solari') b.energy = g.D.E.hall_energy;
    }
    markFoot(g, b, 3);
    return b;
  }

  function tripLoops(g, patch) { return patch.close ? g.D.M.tripClose : g.D.M.tripFar; }
  function goLoops(g, patch) { return Math.max(1, (tripLoops(g, patch) >> 1) + jit(g)); }
  function retLoops(g, patch) { const t = tripLoops(g, patch); return Math.max(1, t - (t >> 1) + jit(g)); }

  function livePatches(g, baseId) { return g.map.bases[baseId].patches.map(i => g.map.patches[i]).filter(p => !p.dead); }

  function assignMineral(g, p, w) {
    let best = null, bs = 0;
    for (const bid of p.bases) {
      const live = livePatches(g, bid);
      if (!live.length) continue;
      let wk = 0; for (const q of live) wk += q.workers;
      const s = wk / live.length;
      if (best === null || s < bs) { best = live; bs = s; }
    }
    if (!best) { w.job = 'idle'; w.patch = -1; return; }
    let pick = best[0];
    for (const q of best) if (q.workers < pick.workers) pick = q;
    pick.workers++; w.patch = pick.id; w.job = 'mine'; w.ph = 'go'; w.t = goLoops(g, pick); w.cargo = 0;
  }

  function release(g, w) {
    if (w.patch >= 0) {
      const q = g.map.patches[w.patch];
      q.workers--;
      const qi = q.queue.indexOf(w.id); if (qi >= 0) q.queue.splice(qi, 1);
      if (q.occ === w.id) { q.occ = 0; startNext(g, q); }
      w.patch = -1;
    }
  }

  function startMine(g, w, q) { q.occ = w.id; w.ph = 'mine'; w.t = g.D.M.mine; }
  function startNext(g, q) {
    while (q.queue.length) {
      const w = ent(g, q.queue.shift());
      if (w && !w.dead && w.patch === q.id && w.ph === 'wait') { startMine(g, w, q); return; }
    }
  }

  function spawnWorker(g, p, x, y) {
    const w = g.spawn({ owner: p.id, type: p.R.worker, kind: 'worker', x, y, job: 'idle', ph: 'go', t: 0, cargo: 0, patch: -1, geyser: -1, order: null, con: 0 });
    assignMineral(g, p, w);
    return w;
  }

  function setupPlayer(g, p) {
    const base = g.map.bases[p.base0];
    const hall = spawnBuilding(g, p, p.R.hall, base.x, base.y, true);
    hall.base = base.id;
    if (p.race === 'verdant') hall.brood = g.D.M.brood0;
    p.bases = [base.id];
    for (let i = 0; i < g.D.E.start_workers; i++) spawnWorker(g, p, base.x, base.y);
    p.used = g.D.E.start_workers * g.D.t[p.R.worker].supply;
    if (p.race === 'verdant') g.spawn({ owner: p.id, type: 'floater', kind: 'unit', x: base.x, y: base.y, done: true });
    A.recalcSupply(g, p);
  }

  // How many minerals per loop the player is mining, as a planning estimate
  function incomeRate(g, p) {
    let n = 0, cap = 0;
    for (const e of g.ents) if (!e.dead && e.owner === p.id && e.kind === 'worker' && e.job === 'mine') n++;
    for (const bid of p.bases) cap += livePatches(g, bid).length * 2;
    const M = g.D.M, cycle = M.mine + (M.tripClose + M.tripFar) / 2;
    return Math.min(n, cap) * g.D.E.mineral_carry / cycle;
  }

  function backToMine(g, p, w, fromX, fromY) {
    const hall = g.byOwner(p.id, p.R.hall).find(h => h.done);
    assignMineral(g, p, w);
    if (w.job === 'mine' && hall) w.t = Math.ceil(dist(fromX, fromY, hall.x, hall.y) / g.D.M.speed * A.LPS);
  }

  function assignGas(g, p, b) {
    const gy = g.map.geysers.find(q => q.bld === b.id);
    if (!gy) return;
    let n = g.D.M.gasWorkers;
    for (const w of g.ents) {
      if (n <= 0) break;
      if (w.dead || w.owner !== p.id || w.kind !== 'worker' || w.job !== 'mine' || w.cargo) continue;
      release(g, w);
      w.job = 'gas'; w.geyser = gy.id; w.ph = 'go'; w.t = Math.max(1, Math.floor(g.D.M.gasCycle / 3) + jit(g)); n--;
    }
  }

  function rebalance(g, p, newBase) {
    const live = livePatches(g, newBase), want = live.length * 2;
    let have = 0; for (const q of live) have += q.workers;
    for (const bid of p.bases) {
      if (bid === newBase) continue;
      const lp = livePatches(g, bid);
      for (const w of g.ents) {
        if (have >= want) return;
        if (w.dead || w.owner !== p.id || w.kind !== 'worker' || w.job !== 'mine' || w.cargo) continue;
        if (!lp.some(q => q.id === w.patch)) continue;
        let wk = 0; for (const q of lp) wk += q.workers;
        if (wk <= lp.length * 2) break;
        release(g, w);
        const q = live.reduce((a, b) => (b.workers < a.workers ? b : a), live[0]);
        q.workers++; w.patch = q.id; w.job = 'mine'; w.ph = 'go'; w.t = 4 * goLoops(g, q); have++;
      }
    }
  }

  function finishBuilding(g, p, b) {
    b.done = true; b.work = 0;
    A.recalcSupply(g, p);
    const def = g.D.t[b.type];
    if (b.type === p.R.gas) assignGas(g, p, b);
    if (b.type === p.R.hall) {
      if (p.race === 'verdant') b.brood = 1;
      if (p.bases.indexOf(b.base) < 0) { p.bases.push(b.base); rebalance(g, p, b.base); }
    }
    if (p.R.builder === 'constructs') {
      for (const w of g.ents) if (!w.dead && w.owner === p.id && w.job === 'construct' && w.con === b.id) backToMine(g, p, w, b.x, b.y);
    }
    g.emit(p, 'done', b.type, { id: b.id });
  }

  function finishItem(g, p, b, it) {
    if (it.kind === 'addon') { b.addon = it.type; if (it.type === 'dual') b.slots = 2; g.emit(p, 'done', it.type, { id: b.id }); return; }
    const def = g.D.t[it.type];
    if (def.id === p.R.worker) spawnWorker(g, p, b.x, b.y);
    else { const u = g.spawn({ owner: p.id, type: it.type, kind: 'unit', x: b.x, y: b.y, done: true }); if (b.rally) u.ord = { k: 'attackmove', x: b.rally.x, y: b.rally.y }; }   // rally point set from the viewer
    if (def.supply_provided) A.recalcSupply(g, p);
    g.emit(p, 'trained', it.type, { id: b.id });
  }

  function stepWorker(g, p, w) {
    const M = g.D.M;
    if (w.job === 'mine') {
      if (w.ph === 'wait') return;
      if (--w.t > 0) return;
      const q = g.map.patches[w.patch];
      if (w.ph === 'go') {
        if (q.dead) { release(g, w); assignMineral(g, p, w); return; }
        if (q.occ === 0) startMine(g, w, q);
        else {
          // a busy patch: bounce to a free patch at the same base if there is one, like the real game does
          let alt = null;
          for (const c of livePatches(g, q.base)) if (c.occ === 0 && c.queue.length === 0 && (alt === null || c.workers < alt.workers)) alt = c;
          if (alt) { q.workers--; alt.workers++; w.patch = alt.id; startMine(g, w, alt); }
          else { w.ph = 'wait'; q.queue.push(w.id); }
        }
      } else if (w.ph === 'mine') {
        const take = Math.min(g.D.E.mineral_carry, q.amount);
        q.amount -= take; w.cargo = take; if (q.amount <= 0) q.dead = true;
        q.occ = 0; w.ph = 'ret'; w.t = retLoops(g, q);
        startNext(g, q);
      } else if (w.ph === 'ret') {
        p.minerals += w.cargo; p.mined += w.cargo; w.cargo = 0; w.ph = 'go'; w.t = goLoops(g, q);
        if (q.dead) { release(g, w); assignMineral(g, p, w); }
      }
    } else if (w.job === 'gas') {
      if (--w.t > 0) return;
      const gy = g.map.geysers[w.geyser], third = Math.floor(M.gasCycle / 3);
      if (w.ph === 'go') { w.ph = 'mine'; w.t = Math.max(1, M.gasCycle - 2 * third); }
      else if (w.ph === 'mine') { w.cargo = Math.min(g.D.E.gas_carry, gy.amount); gy.amount -= w.cargo; w.ph = 'ret'; w.t = Math.max(1, third + jit(g)); }
      else { p.gas += w.cargo; w.cargo = 0; w.ph = 'go'; w.t = Math.max(1, third + jit(g)); if (gy.amount <= 0) { w.job = 'idle'; } }
    } else if (w.job === 'build') {
      const o = w.order;
      if (w.ph === 'walk') { if (--w.t <= 0) w.ph = 'at'; else return; }
      if (w.ph === 'at') {
        const def = g.D.t[o.type];
        if (p.minerals < def.cost.minerals || p.gas < def.cost.gas) return;
        if (!A.unlocked(g, p, o.type)) return;
        if (A.needsPower(g, p, o.type) && !A.powered(g, p, o.x, o.y)) return;
        p.minerals -= def.cost.minerals; p.gas -= def.cost.gas; p.resv.m -= o.rm; p.resv.g -= o.rg;
        const b = spawnBuilding(g, p, o.type, o.x, o.y, false);
        b.base = o.base;
        if (o.geyser >= 0) g.map.geysers[o.geyser].bld = b.id;
        g.emit(p, 'placed', o.type, { id: b.id });
        w.order = null;
        const how = p.R.builder;
        if (how === 'stays') backToMine(g, p, w, o.x, o.y);
        else if (how === 'constructs') { w.job = 'construct'; w.con = b.id; }
        else { w.dead = true; p.used -= g.D.t[p.R.worker].supply; }
      }
    }
  }

  function stepBuilding(g, p, b) {
    const E = g.D.E;
    if (!b.done) { b.work -= 2; if (b.work <= 0) finishBuilding(g, p, b); return; }
    if (b.type === p.R.hall) {
      b.energy = Math.min(200, b.energy + E.regenPerLoop);
      if (p.race === 'verdant' && b.brood < g.D.M.broodCap) { if (++b.brood_t >= E.broodLoops) { b.brood++; b.brood_t = 0; } }
    }
    const rate = b.surge > 0 ? 3 : 2;
    if (b.surge > 0) b.surge--;
    const n = Math.min(b.slots, b.queue.length);
    for (let i = 0; i < n; i++) b.queue[i].work -= rate;
    for (let i = 0; i < n; i++) {
      if (b.queue[i].work <= 0) { const it = b.queue.splice(i, 1)[0]; finishItem(g, p, b, it); break; }
    }
  }

  function stepEgg(g, p, e) {
    e.work -= 2;
    if (e.work > 0) return;
    e.dead = true;
    finishItem(g, p, { x: e.x, y: e.y, slots: 1 }, { type: e.type, kind: 'unit' });
  }

  function tickEcon(g) {
    for (let i = 0; i < g.ents.length; i++) {
      const e = g.ents[i];
      if (e.dead) continue;
      const p = g.players[e.owner];
      if (e.kind === 'worker') stepWorker(g, p, e);
      else if (e.kind === 'building') stepBuilding(g, p, e);
      else if (e.kind === 'egg') stepEgg(g, p, e);
    }
  }

  Object.assign(A, { setupPlayer, tickEcon, spawnBuilding, spawnWorker, assignMineral, release, incomeRate, footprint, markFoot, finishItem, ent, dist });
  root.Arena = A;
  if (typeof module !== 'undefined') module.exports = A;
})(typeof globalThis !== 'undefined' ? globalThis : this);
