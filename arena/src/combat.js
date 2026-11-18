// combat.js: units fight. Movement with separation, A* on the coarse grid, attack-move, target priority, range, cooldown,
// bonus damage, armor, shields, splash (bombard, burster, paragon, strider), attack orders, simple retreat.
// All numbers come from the unit tables (data/units.json) and the combat knobs in data/model.json. Deterministic, no Date, no Math.random.
// Simplifications (listed in data/SOURCES.md): attacks hit instantly (no projectile or animation delay), no upgrades, no abilities,
// no skiff heal, siege mode switches instantly, buildings are passive targets, air units only move straight.
(function (root) {
  'use strict';
  if (!root.Arena && typeof require !== 'undefined') require('./core.js');
  if (typeof require !== 'undefined') { require('./tech.js'); require('./econ.js'); }
  const A = root.Arena;
  const has = (e, tag) => e.tags && e.tags.indexOf(tag) >= 0;

  // ------------------------------------------------------------------ entities
  function radiusOf(g, e, def) {
    if (e.kind === 'building') return A.footprint(g, e.type) * g.D.C.radius_building_per_cell;
    if (has(def, 'massive')) return g.D.C.radius_massive;
    return has(def, 'armored') ? g.D.C.radius_armored : g.D.C.radius_light;
  }

  // Give an entity its combat state once. Trained units and buildings get armed lazily, so the economy code stays untouched.
  function arm(g, e) {
    const def = g.D.t[e.type];
    if (!def || def.hp === null || def.hp === undefined || e.hp !== undefined) return;
    e.hp = def.hp; e.sh = def.shield || 0; e.cd = 0; e.tgt = 0; e.ord = e.ord || null; e.r = radiusOf(g, e, def);
    e.air = has(def, 'air'); e.sieged = false;
  }

  // The weapon this entity fires right now, or null. Sieged tanks swap to the siege weapon.
  function weaponOf(g, e) {
    const cache = g.D._w || (g.D._w = {}), key = e.sieged ? e.type + '#' : e.type;
    if (key in cache) return cache[key];
    return (cache[key] = weaponFor(g, e));
  }
  function weaponFor(g, e) {
    const def = g.D.t[e.type], w = def.weapon;
    if (e.sieged) {
      const s = g.D.C.siege;
      return { damage: s.damage, attacks: 1, bonus: s.bonus, bonus_vs: 'armored', cooldown: s.cooldown, range: s.range, minRange: s.min_range, hits_air: false, hits_ground: true, splash: 'tank', friendly: true };
    }
    if (!w || w.damage === null || w.damage === undefined) return null;
    if (e.type === 'burster') return { damage: w.damage, attacks: 1, bonus: w.bonus, bonus_vs: w.bonus_vs, cooldown: 0, range: w.range, minRange: 0, hits_air: false, hits_ground: true, splash: 'burster', suicide: true };
    return { damage: w.damage, attacks: w.attacks || 1, bonus: w.bonus, bonus_vs: w.bonus_vs, cooldown: w.cooldown, range: w.range, minRange: 0, hits_air: w.hits_air, hits_ground: w.hits_ground, splash: w.splash === 'radius' ? 'paragon' : w.splash };
  }

  const isFighter = (g, e) => e.kind === 'unit' && e.hp > 0 && !e.dead && !!weaponOf(g, e) && !(e.type === 'tender' || e.type === 'laborer' || e.type === 'grub');

  function spawnUnit(g, owner, type, x, y, opts) {
    const e = g.spawn(Object.assign({ owner, type, kind: 'unit', x, y, done: true, nc: true }, opts || {}));
    arm(g, e);
    return e;
  }

  // ------------------------------------------------------------------ geometry and A*
  const cellOf = v => Math.round(v);
  const passable = (g, cx, cy) => {
    const m = g.map;
    // the outer two rings are walls, so the cliffs that start at y 2 seal the map edge for walkers
    return cx >= 2 && cy >= 2 && cx < m.W - 2 && cy < m.H - 2 && m.grid[cy * m.W + cx] === 0;
  };

  // straight walk free of blocked cells? Cells within `skip` of the start are ignored (units spawn inside buildings).
  function losClear(g, x0, y0, x1, y1, skip) {
    const d = Math.hypot(x1 - x0, y1 - y0), n = Math.ceil(d / 0.5);
    for (let i = 1; i <= n; i++) {
      const t = i / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
      if (Math.hypot(x - x0, y - y0) < (skip || 0)) continue;
      if (!passable(g, cellOf(x), cellOf(y))) return false;
    }
    return true;
  }

  // binary heap keyed on [f, index] so equal costs break the same way every run
  function heapPush(h, f, i) { h.push([f, i]); let k = h.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (less(h[k], h[p])) { const t = h[k]; h[k] = h[p]; h[p] = t; k = p; } else break; } }
  function less(a, b) { return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]); }
  function heapPop(h) {
    const top = h[0], last = h.pop();
    if (h.length) { h[0] = last; let k = 0; for (;;) { let l = 2 * k + 1, r = l + 1, m = k; if (l < h.length && less(h[l], h[m])) m = l; if (r < h.length && less(h[r], h[m])) m = r; if (m === k) break; const t = h[k]; h[k] = h[m]; h[m] = t; k = m; } }
    return top;
  }

  // 8 neighbour A* on the coarse grid. Returns waypoints [{x,y}] ending at (x1,y1), smoothed by line of sight, or null.
  function findPath(g, x0, y0, x1, y1) {
    const W = g.map.W, H = g.map.H;
    const sx = cellOf(x0), sy = cellOf(y0);
    let gx = cellOf(x1), gy = cellOf(y1);
    if (!passable(g, gx, gy)) { // goal inside a wall or building: nearest free cell by rings
      let found = false;
      for (let r = 1; r <= 8 && !found; r++) for (let oy = -r; oy <= r && !found; oy++) for (let ox = -r; ox <= r; ox++) {
        if (Math.max(Math.abs(ox), Math.abs(oy)) === r && passable(g, gx + ox, gy + oy)) { gx += ox; gy += oy; found = true; break; }
      }
      if (!found) return null;
    }
    const start = sy * W + sx, goal = gy * W + gx;
    const gs = new Float32Array(W * H).fill(Infinity), from = new Int32Array(W * H).fill(-1), closed = new Uint8Array(W * H);
    const hf = (x, y) => { const dx = Math.abs(x - gx), dy = Math.abs(y - gy); return Math.max(dx, dy) + 0.4142 * Math.min(dx, dy); };
    const open = []; gs[start] = 0; heapPush(open, hf(sx, sy), start);
    while (open.length) {
      const [, cur] = heapPop(open);
      if (closed[cur]) continue;
      closed[cur] = 1;
      if (cur === goal) break;
      const cx = cur % W, cy = (cur / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy, ni = ny * W + nx;
        if (!passable(g, nx, ny) || closed[ni]) continue;
        if (dx && dy && (!passable(g, cx + dx, cy) || !passable(g, cx, cy + dy))) continue; // no corner cutting
        const ng = gs[cur] + (dx && dy ? 1.4142 : 1);
        if (ng < gs[ni]) { gs[ni] = ng; from[ni] = cur; heapPush(open, ng + hf(nx, ny), ni); }
      }
    }
    if (!closed[goal]) return null;
    const cells = [];
    for (let c = goal; c !== -1; c = from[c]) cells.push({ x: c % W, y: (c / W) | 0 });
    cells.reverse();
    // string pulling: keep a waypoint only when the straight line to the next one is blocked
    const out = []; let a = { x: x0, y: y0 }, i = 0;
    while (i < cells.length) {
      let j = cells.length - 1;
      while (j > i && !losClear(g, a.x, a.y, cells[j].x, cells[j].y, 0)) j--;
      out.push({ x: cells[j].x, y: cells[j].y }); a = cells[j]; i = j + 1;
    }
    return out;
  }

  // ------------------------------------------------------------------ damage
  const edgeDist = (a, b) => Math.max(0, Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r);

  // Simultaneous resolution: hits queue during the tick and land together at the end, so unit order never decides who fires first.
  function queueHit(g, t, dmg) { (g._hits || (g._hits = [])).push(t, dmg); }
  function hit(g, t, dmg) {
    const D = g.D.t[t.type], minD = g.D.C.min_damage;
    if (t.sh > 0) { const s = Math.min(t.sh, dmg); t.sh -= s; dmg -= s; }
    if (dmg > 0) t.hp -= Math.max(minD, dmg - (D.armor || 0));
  }

  const dmgVs = (w, t, td) => w.damage + (w.bonus && w.bonus_vs && has(td, w.bonus_vs) ? w.bonus : 0);
  const canHit = (w, t, td) => (t.air ? w.hits_air : w.hits_ground);

  // fire once at t. Primary hits plus splash.
  function fire(g, e, w, t) {
    const td = g.D.t[t.type], C = g.D.C, per = dmgVs(w, t, td);
    if (w.splash === 'tank') {
      const rings = C.rings.tank;
      for (const o of (g._live || g.ents)) {
        if (o.dead || o.hp === undefined || o.hp <= 0 || o.air || o.kind === 'building') continue;
        if (o.owner === e.owner && !w.friendly) continue;
        const d = Math.hypot(o.x - t.x, o.y - t.y) - o.r;
        const frac = o === t || d <= rings[0] ? 1 : d <= rings[1] ? 0.5 : d <= rings[2] ? 0.25 : 0;
        if (frac) queueHit(g, o, dmgVs(w, o, g.D.t[o.type]) * frac);
      }
      return;
    }
    if (w.splash === 'burster') {
      for (const o of (g._live || g.ents)) {
        if (o.dead || o.hp === undefined || o.hp <= 0 || o.air || o.owner === e.owner || o.kind === 'building') continue;
        if (Math.hypot(o.x - e.x, o.y - e.y) - o.r <= C.rings.burster[0]) queueHit(g, o, dmgVs(w, o, g.D.t[o.type]));
      }
      return;
    }
    for (let k = 0; k < w.attacks; k++) queueHit(g, t, per);
    if (w.splash === 'paragon') {
      const rings = C.rings.paragon;
      for (const o of (g._live || g.ents)) {
        if (o === t || o.dead || o.hp === undefined || o.hp <= 0 || o.air || o.owner === e.owner || o.kind === 'building') continue;
        const d = Math.hypot(o.x - t.x, o.y - t.y) - o.r;
        const frac = d <= rings[0] ? 1 : d <= rings[1] ? 0.5 : d <= rings[2] ? 0.25 : 0;
        if (frac) queueHit(g, o, dmgVs(w, o, g.D.t[o.type]) * frac);
      }
    } else if (w.splash === 'line') {
      // strider beam: every enemy near the line from the strider through the target and one cell past it
      const dx = t.x - e.x, dy = t.y - e.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len, reach = len + 1;
      for (const o of (g._live || g.ents)) {
        if (o === t || o.dead || o.hp === undefined || o.hp <= 0 || o.air || o.owner === e.owner || o.kind === 'building') continue;
        const px = o.x - e.x, py = o.y - e.y, along = px * ux + py * uy, off = Math.abs(px * uy - py * ux);
        if (along > 0 && along <= reach && off - o.r <= C.rings.strider_line_width) for (let k = 0; k < w.attacks; k++) queueHit(g, o, dmgVs(w, o, g.D.t[o.type]));
      }
    }
  }

  // ------------------------------------------------------------------ target choice
  const classOf = (g, t) => t.kind === 'building' ? 3 : t.kind === 'worker' ? 1 : (isFighter(g, t) ? 0 : 2);

  // Pick the best enemy within weapon range plus `acq`. In range beats out of range. Threats beat workers beat the rest.
  // Candidates come from a coarse grid of the live entities built once per tick (the order of visiting does not change the answer:
  // the best key wins and equal keys go to the lower id). 4 covers the largest building radius plus a tick of movement.
  const GC = 6;
  function buildGrid(g, live) {
    const GW = Math.ceil(g.map.W / GC) + 1, grids = [new Array(GW * GW), new Array(GW * GW)];
    for (const e of live) { const cx = Math.max(0, Math.min(GW - 1, (e.x / GC) | 0)), cy = Math.max(0, Math.min(GW - 1, (e.y / GC) | 0)), i = cy * GW + cx, gr = grids[e.owner & 1]; (gr[i] || (gr[i] = [])).push(e); }
    g._grids = grids; g._gw = GW;
  }
  function pickTarget(g, e, w, acq) {
    let best = null, bk = Infinity;
    if (g._gridLoop !== g.loop) { buildGrid(g, g._live); g._gridLoop = g.loop; }
    const grid = g._grids[(e.owner & 1) ^ 1], GW = g._gw, R = w.range + acq + (e.r || 0) + 4;   // two players: the other side's grid
    const x0 = Math.max(0, ((e.x - R) / GC) | 0), x1 = Math.min(GW - 1, ((e.x + R) / GC) | 0), y0 = Math.max(0, ((e.y - R) / GC) | 0), y1 = Math.min(GW - 1, ((e.y + R) / GC) | 0);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const cell = grid[cy * GW + cx]; if (!cell) continue;
      for (const t of cell) {
        if (t.hp <= 0 || t.owner === e.owner || !canHit(w, t, g.D.t[t.type])) continue;
        const d = edgeDist(e, t);
        if (d > w.range + acq || d < w.minRange) continue;
        const k = (d <= w.range ? 0 : 1000) + classOf(g, t) * 100 + d;
        if (k < bk || (k === bk && best && t.id < best.id)) { bk = k; best = t; }
      }
    }
    return best;
  }

  // ------------------------------------------------------------------ movement
  function stepTo(g, e, x, y) {
    const sp = g.D.t[e.type].speed / A.LPS, d = Math.hypot(x - e.x, y - e.y);
    if (d <= sp) { e.x = x; e.y = y; return true; }
    e.x += (x - e.x) / d * sp; e.y += (y - e.y) / d * sp;
    return false;
  }

  // Walk toward (x,y). Straight when the line is clear, else along an A* path that is refreshed when the goal moves.
  function moveToward(g, e, x, y, straightOnly) {
    if (e.sieged) return;
    if (e.air || straightOnly || losClear(g, e.x, e.y, x, y, 3)) { e.path = null; stepTo(g, e, x, y); return; }
    const gk = cellOf(x) * 4096 + cellOf(y);
    if (!e.path || e.pgoal !== gk || e.path.length === 0) { e.path = findPath(g, e.x, e.y, x, y); e.pgoal = gk; }
    if (!e.path || !e.path.length) { stepTo(g, e, x, y); return; }
    const wp = e.path[0];
    if (stepTo(g, e, wp.x, wp.y) || Math.hypot(wp.x - e.x, wp.y - e.y) < 0.3) e.path.shift();
  }

  function separate(g, units) {
    const push = g.D.C.separation_push;
    for (let i = 0; i < units.length; i++) {
      const a = units[i];
      for (let j = i + 1; j < units.length; j++) {
        const b = units[j];
        if (a.air !== b.air) continue;
        const dx = b.x - a.x, dy = b.y - a.y, min = a.r + b.r;
        if (Math.abs(dx) >= min || Math.abs(dy) >= min) continue;
        let d = Math.hypot(dx, dy);
        if (d >= min) continue;
        let ux, uy;
        if (d < 1e-6) { ux = (a.id & 1) ? 1 : -1; uy = 0; d = 0; } else { ux = dx / d; uy = dy / d; }
        const move = (min - d) * push / 2;
        // sieged tanks and units shooting in place hold their ground, the other one gives way
        const wa = a.sieged ? 0 : 1, wb = b.sieged ? 0 : 1, tot = wa + wb;
        if (!tot) continue;
        nudge(g, a, -ux * move * 2 * wa / tot, -uy * move * 2 * wa / tot);
        nudge(g, b, ux * move * 2 * wb / tot, uy * move * 2 * wb / tot);
      }
    }
  }
  function nudge(g, e, dx, dy) {
    // staying inside the same cell is always allowed (passable(c) || !passable(c)), so skip the two lookups in the common tiny nudge
    const c0x = cellOf(e.x), c0y = cellOf(e.y);
    if (e.air || (cellOf(e.x + dx) === c0x && cellOf(e.y + dy) === c0y) || passable(g, cellOf(e.x + dx), cellOf(e.y + dy)) || !passable(g, c0x, c0y)) { e.x += dx; e.y += dy; }
  }

  // ------------------------------------------------------------------ one unit, one loop
  function step(g, e) {
    const C = g.D.C, o = e.ord, w = weaponOf(g, e);
    if (e.cd > 0) e.cd--;
    if (o && o.k === 'retreat') { if (stepToward(g, e, o)) e.ord = null; return; }
    if (o && o.k === 'move') { if (stepToward(g, e, o)) e.ord = null; return; }
    if (!w) { if (o) { if (stepToward(g, e, o)) e.ord = null; } return; }
    let t = e.tgt ? g.ents[e.tgt - 1] : null;
    if (t && (t.dead || t.hp <= 0)) { t = null; e.tgt = 0; }
    if (o && o.k === 'attack') {
      const f = g.ents[o.id - 1];
      if (!f || f.dead || f.hp <= 0 || !canHit(w, f, g.D.t[f.type])) { e.ord = null; t = null; } else t = f;
    } else if (!t || ((g.loop + e.id) % C.retarget_loops === 0)) {
      const acq = o && o.k === 'attackmove' && !e.sieged ? C.acquire_range : 0;
      const n = pickTarget(g, e, w, acq);
      if (n) t = n;
      else if (t && edgeDist(e, t) > w.range + acq) t = null;
    }
    e.tgt = t ? t.id : 0;
    if (!t) { if (o && o.k === 'attackmove' && stepToward(g, e, o)) e.ord = null; return; }
    const d = edgeDist(e, t);
    if (d <= w.range && d >= w.minRange) {
      if (e.cd <= 0) {
        fire(g, e, w, t);
        e.cd += w.cooldown * A.LPS;
        if (w.suicide) e.hp = 0;
      }
    } else if (!e.sieged) moveToward(g, e, t.x, t.y, t.kind === 'building');
  }
  function stepToward(g, e, o) {
    if (e.sieged) return false;
    moveToward(g, e, o.x, o.y);
    return Math.hypot(o.x - e.x, o.y - e.y) < 0.6;
  }

  function die(g, e) {
    e.dead = true;
    const p = g.players[e.owner];
    if (e.kind === 'building') { A.markFoot(g, e, 0); A.recalcSupply(g, p); return; }
    if (!e.nc) p.used -= g.D.t[e.type].supply;
    if (e.kind === 'worker') {
      if (e.order) { p.resv.m -= e.order.rm; p.resv.g -= e.order.rg; }
      A.release(g, e);
    }
  }

  function tickCombat(g) {
    let fighters = null;
    for (let i = g._armIdx || 0; i < g.ents.length; i++) { const e = g.ents[i]; if (!e.dead && e.hp === undefined && e.type) arm(g, e); }
    g._armIdx = g.ents.length;   // entities are only ever appended, and arm() runs once per entity
    const live = [], units = [];
    for (const e of g.ents) if (!e.dead && e.hp !== undefined && e.hp > 0) { live.push(e); if (e.kind === 'unit') units.push(e); }
    g._live = live; g._gridLoop = -1;   // the grid is built on the first target search of the tick
    for (const e of units) if (isFighter(g, e) || e.ord) { if (!fighters) fighters = []; fighters.push(e); }
    if (!fighters) return;
    for (const e of fighters) if (e.hp > 0) step(g, e);
    if (g._hits) { const q = g._hits; g._hits = null; for (let i = 0; i < q.length; i += 2) hit(g, q[i], q[i + 1]); }
    separate(g, units.filter(e => e.hp > 0 && !e.air));
    for (const e of live) if (!e.dead && e.hp <= 0) die(g, e);
  }

  // ------------------------------------------------------------------ orders
  const list = (g, who) => Array.isArray(who) ? who : g.ents.filter(e => !e.dead && e.kind === 'unit' && e.owner === who && e.hp > 0);
  function order(g, who, o) { const us = list(g, who); for (const e of us) { e.ord = Object.assign({}, o); e.path = null; if (o.k !== 'attack') e.tgt = 0; } return us.length; }
  const orderAttackMove = (g, who, x, y) => order(g, who, { k: 'attackmove', x, y });
  const orderMove = (g, who, x, y) => order(g, who, { k: 'move', x, y });
  const orderAttack = (g, who, id) => order(g, who, { k: 'attack', id });
  const orderRetreat = (g, who, x, y) => order(g, who, { k: 'retreat', x, y });
  function setSiege(g, e, on) { if (e.type === 'bombard') { e.sieged = !!on; e.path = null; } }

  // value of a set of units in minerals plus gas
  function value(g, us) { let v = 0; for (const e of us) { const c = g.D.t[e.type].cost; v += c.minerals + c.gas; } return v; }

  // Simple army rules for a scripted strategy: strat.army = {attack_supply, retreat_ratio}. Gather, attack when big enough,
  // retreat when the local fight is lost by the ratio, go again when the army regrew. M4 adds the full bot.
  function attachArmy(g, pid, army) {
    const p = g.players[pid], foe = g.players.find(q => q.id !== pid);
    const st = { mode: 'gather', retreats: 0, attacks: 0 };
    const home = () => { const b = g.map.bases[p.base0 + 1]; return { x: b.x + (g.map.W / 2 - b.x) * 0.2, y: b.y + (g.map.H / 2 - b.y) * 0.2 }; };
    // attack the enemy building nearest to us, so a won fight ends with every building dead; the main base while none is known
    const target = (cx, cy) => {
      let best = null, bd = 1e9;
      for (const e of g.ents) if (!e.dead && e.owner === foe.id && e.kind === 'building') { const d = Math.hypot(e.x - cx, e.y - cy); if (d < bd) { bd = d; best = e; } }
      if (best) return { x: best.x, y: best.y };
      const b = g.map.bases[foe.base0]; return { x: b.x, y: b.y };
    };
    const bot = {
      st,
      tick() {
        if (g.loop % 22 !== 0) return;
        const us = list(g, pid).filter(e => weaponOf(g, e) && !['tender', 'laborer', 'grub'].includes(e.type));
        if (!us.length) return;
        let sup = 0; for (const e of us) sup += g.D.t[e.type].supply;
        const cx = us.reduce((s, e) => s + e.x, 0) / us.length, cy = us.reduce((s, e) => s + e.y, 0) / us.length;
        const near = g.ents.filter(e => !e.dead && e.owner !== pid && e.kind === 'unit' && e.hp > 0 && isFighter(g, e) && Math.hypot(e.x - cx, e.y - cy) < 20);
        if (st.mode === 'gather') {
          const h = home(); for (const e of us) if (!e.ord) { e.ord = { k: 'attackmove', x: h.x, y: h.y }; }
          if (sup >= army.attack_supply || (army.attack_time !== undefined && g.loop >= A.loops(army.attack_time) && sup >= (army.min_supply || 8))) { st.mode = 'attack'; st.attacks++; const t = target(cx, cy); orderAttackMove(g, us, t.x, t.y); }
        } else if (st.mode === 'attack') {
          if (near.length && value(g, us) < value(g, near) * (army.retreat_ratio === undefined ? 0.7 : army.retreat_ratio)) {
            st.mode = 'retreat'; st.retreats++; const h = home(); orderRetreat(g, us, h.x, h.y);
          } else for (const e of us) if (!e.ord) { const t = target(e.x, e.y); e.ord = { k: 'attackmove', x: t.x, y: t.y }; }
        } else if (st.mode === 'retreat' && (sup >= army.attack_supply || (army.attack_time !== undefined && sup >= (army.min_supply || 8) * 1.5))) { st.mode = 'attack'; st.attacks++; const t = target(cx, cy); orderAttackMove(g, us, t.x, t.y); }
      },
    };
    g.bots.push(bot);
    return bot;
  }

  Object.assign(A, { arm, spawnUnit, weaponOf, isFighter, findPath, losClear, tickCombat, edgeDist, hit,
    orderAttackMove, orderMove, orderAttack, orderRetreat, setSiege, attachArmy, armyValue: value });
  root.Arena = A;
  if (typeof module !== 'undefined') module.exports = A;
})(typeof globalThis !== 'undefined' ? globalThis : this);
