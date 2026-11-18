// orders.js: commands a player (or a bot) can give. Placement on the coarse grid, power field, train, build, surge.
(function (root) {
  'use strict';
  if (!root.Arena && typeof require !== 'undefined') require('./core.js');
  if (typeof require !== 'undefined') { require('./tech.js'); require('./econ.js'); }
  const A = root.Arena;

  function fail(g, why) { g.why = why; return null; }

  // Is the s by s footprint with top-left cell (x0,y0) free? Core cells must be empty. A one cell pad keeps lanes open.
  function areaFree(g, x0, y0, s, pad, flip) {
    const W = g.map.W, H = g.map.H, gr = g.map.grid;
    for (let y = y0 - pad; y < y0 + s + pad; y++) {
      for (let x = x0 - pad; x < x0 + s + pad; x++) {
        if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) return false;
        const v = flip ? gr[(H - 1 - y) * W + (W - 1 - x)] : gr[y * W + x], core = x >= x0 && y >= y0 && x < x0 + s && y < y0 + s;
        if (core ? v !== 0 : (v === 2 || v === 3)) return false;
      }
    }
    return true;
  }

  function baseTaken(g, baseId) {
    for (const e of g.ents) if (!e.dead && e.kind === 'building' && e.base === baseId && g.D.t[e.type].supply_provided && /citadel|garrison_hub|nest/.test(e.type)) return true;
    return false;
  }

  function findSite(g, p, type, ahead) {
    const def = g.D.t[type], s = A.footprint(g, type);
    if (type === p.R.hall) {
      for (let i = 0; i < 3; i++) { const b = g.map.bases[p.base0 + i]; if (!baseTaken(g, b.id)) return { x: b.x, y: b.y, base: b.id, geyser: -1 }; }
      return null;
    }
    if (type === p.R.gas) {
      for (const bid of p.bases) for (const gid of g.map.bases[bid].geysers) { const gy = g.map.geysers[gid]; if (!gy.bld) return { x: gy.x, y: gy.y, base: bid, geyser: gid }; }
      return null;
    }
    const hall = g.byOwner(p.id, p.R.hall).find(h => h.done);
    if (!hall) return null;
    // Mirror-exact: the far side searches in the point-mirrored frame (same ring and scan order, cells read through the mirror), so both sides get mirror-image layouts.
    const W = g.map.W, H = g.map.H, flip = hall.x > W / 2;
    const hx = flip ? W - 1 - hall.x : hall.x, hy = flip ? H - 1 - hall.y : hall.y;
    const dx = W / 2 - hx, dy = H / 2 - hy, n = Math.hypot(dx, dy) || 1;
    const ax = Math.round(hx + 9 * dx / n), ay = Math.round(hy + 9 * dy / n);
    const power = A.needsPower(g, p, type);
    for (let r = 0; r <= 30; r++) {
      for (let oy = -r; oy <= r; oy++) {
        for (let ox = -r; ox <= r; ox++) {
          if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
          const x0 = ax + ox, y0 = ay + oy;
          if (!areaFree(g, x0, y0, s, 1, flip)) continue;
          const cx = x0 + (s - 1) / 2, cy = y0 + (s - 1) / 2;
          const rx = flip ? W - 1 - cx : cx, ry = flip ? H - 1 - cy : cy;
          if (power && !A.powered(g, p, rx, ry, ahead)) continue;
          return { x: rx, y: ry, base: hall.base, geyser: -1 };
        }
      }
    }
    return null;
  }

  function pickBuilder(g, p) {
    let best = null;
    for (const w of g.ents) {
      if (w.dead || w.owner !== p.id || w.kind !== 'worker' || w.job !== 'mine' || w.cargo) continue;
      if (w.ph === 'go' || w.ph === 'wait') return w;
      if (!best) best = w;
    }
    return best;
  }

  // Plan a build without committing. Returns {type,x,y,base,geyser,worker,walk,rm,rg} or null (g.why says why).
  function planBuild(g, p, type) {
    const def = g.D.t[type];
    if (!def || def.kind !== 'building') return fail(g, 'not a building');
    const ahead = A.loops(5); // send the builder early when the tech building finishes before it arrives
    if (!A.unlocked(g, p, type, ahead)) return fail(g, 'locked');
    const site = findSite(g, p, type, ahead);
    if (!site) return fail(g, 'no site');
    const w = pickBuilder(g, p);
    if (!w) return fail(g, 'no worker');
    const base = g.map.bases[g.map.patches[w.patch].base];
    const walk = g.D.M.leave + Math.ceil(A.dist(base.x, base.y, site.x, site.y) / g.D.M.speed * A.LPS);
    return { type, x: site.x, y: site.y, base: site.base, geyser: site.geyser, worker: w.id, walk, rm: def.cost.minerals, rg: def.cost.gas };
  }

  function commitBuild(g, p, plan) {
    const w = A.ent(g, plan.worker);
    A.release(g, w);
    w.job = 'build'; w.ph = 'walk'; w.t = plan.walk; w.order = { type: plan.type, x: plan.x, y: plan.y, base: plan.base, geyser: plan.geyser, rm: plan.rm, rg: plan.rg };
    p.resv.m += plan.rm; p.resv.g += plan.rg;
    if (plan.geyser >= 0) g.map.geysers[plan.geyser].bld = -1; // claimed, filled when placed
    return w;
  }

  // Train a unit now. opts.respect keeps money reserved for builds in flight. Returns the queue item or egg, or null.
  function train(g, p, id, opts) {
    opts = opts || {};
    const def = g.D.t[id];
    if (!def) return fail(g, 'unknown');
    if (!A.unlocked(g, p, id)) return fail(g, 'locked');
    const rm = opts.respect ? p.resv.m + (opts.extra || 0) : 0, rg = opts.respect ? p.resv.g : 0;
    if (p.minerals - rm < def.cost.minerals || p.gas - rg < def.cost.gas) return fail(g, 'money');
    const by = g.D.t[def.produced_by];
    if (def.kind === 'building' && def.produced_by !== 'brood') {
      // addon: dual or lab module on a yard
      if (!by || by.kind !== 'building') return fail(g, 'not an addon');
      const b = g.byOwner(p.id, def.produced_by).find(x => x.done && !x.addon && x.queue.length === 0);
      if (!b) return fail(g, 'no host');
      p.minerals -= def.cost.minerals; p.gas -= def.cost.gas;
      const it = { type: id, kind: 'addon', work: def.work, total: def.work };
      b.queue.push(it); g.emit(p, 'train', id, { id: b.id });
      return it;
    }
    if (p.used + def.supply > p.cap) return fail(g, 'supply');
    if (def.produced_by === 'brood') {
      const h = g.byOwner(p.id, p.R.hall).find(x => x.done && x.brood > 0);
      if (!h) return fail(g, 'no brood');
      p.minerals -= def.cost.minerals; p.gas -= def.cost.gas; p.used += def.supply; h.brood--;
      const egg = g.spawn({ owner: p.id, type: id, kind: 'egg', x: h.x, y: h.y, work: def.work });
      g.emit(p, 'train', id, { id: egg.id });
      return egg;
    }
    if (!by || by.kind !== 'building') return fail(g, 'unsupported producer ' + def.produced_by);
    const b = g.byOwner(p.id, def.produced_by).find(x => x.done && x.queue.length < Math.max(x.slots, opts.depth || 0));
    if (!b) return fail(g, 'no producer');
    p.minerals -= def.cost.minerals; p.gas -= def.cost.gas; p.used += def.supply;
    const it = { type: id, kind: 'unit', work: def.work, total: def.work };
    b.queue.push(it);
    g.emit(p, 'train', id, { id: b.id });
    return it;
  }

  // Solari surge boost: spend hall energy to speed up one producing building for the surge duration.
  function surge(g, p, targetId) {
    if (p.race !== 'solari') return fail(g, 'no surge');
    const E = g.D.E;
    const hall = g.byOwner(p.id, p.R.hall).find(h => h.done && h.energy >= E.surge_cost);
    if (!hall) return fail(g, 'no energy');
    const t = A.ent(g, targetId);
    if (!t || t.dead || !t.done || t.surge > 0 || t.queue.length === 0) return fail(g, 'bad target');
    hall.energy -= E.surge_cost; t.surge = E.surgeLoops;
    g.emit(p, 'surge', t.type, { id: t.id });
    return t;
  }

  Object.assign(A, { findSite, planBuild, commitBuild, train, surge, areaFree, baseTaken });
  root.Arena = A;
  if (typeof module !== 'undefined') module.exports = A;
})(typeof globalThis !== 'undefined' ? globalThis : this);
