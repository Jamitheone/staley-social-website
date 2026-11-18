// core.js: fixed timestep loop, seeded PRNG, entity store, map, state hash. No Date, no Math.random.
(function (root) {
  'use strict';
  const LPS = 22.4;
  const loops = s => Math.round(s * LPS);

  // mulberry32, one stream per game
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Build the lookup tables from the raw JSON. raw = {units, buildings, econ, model}
  function makeData(raw) {
    const t = {};
    for (const x of raw.units.units.concat(raw.buildings.buildings)) {
      const bt = x.build_time === null ? null : loops(x.build_time);
      t[x.id] = Object.assign({}, x, { bt, work: bt === null ? null : bt * 2, supply_provided: x.supply_provided || 0 });
    }
    const e = raw.econ, m = raw.model, v = o => o.value;
    const E = {
      start_minerals: v(e.start_minerals), start_workers: v(e.start_workers), patches: v(e.mineral_patches_per_base),
      big_amount: v(e.mineral_big_patch_amount), small_amount: v(e.mineral_small_patch_amount), geyser_amount: v(e.geyser_amount),
      geysers: v(e.geysers_per_base), mineral_carry: v(e.mineral_carry), gas_carry: v(e.gas_carry), supply_cap: v(e.supply_cap),
      surge_cost: v(e.surge_boost.energy_cost), surge_s: v(e.surge_boost.duration_s), surge_bonus: v(e.surge_boost.speed_bonus),
      hall_energy: v(e.surge_boost.citadel_start_energy), energy_regen: v(e.energy_regen_per_s),
      brood_interval: v(e.brood.spawn_interval_s),
    };
    const M = {
      mine: loops(v(m.mining.mine_s)), tripClose: loops(v(m.mining.trip_close_s)), tripFar: loops(v(m.mining.trip_far_s)),
      jitter: v(m.mining.jitter_loops), gasCycle: loops(v(m.mining.gas_cycle_s)), gasWorkers: v(m.mining.gas_workers),
      leave: loops(v(m.build.leave_s)), speed: v(m.build.base_walk_speed),
      brood0: v(m.start.verdant_brood), broodCap: v(m.start.brood_cap), powerR: v(m.power_radius),
      footprint: v(m.footprint), races: m.races,
    };
    const C = {};
    if (m.combat) {
      for (const k in m.combat) if (k !== 'note' && m.combat[k] && 'value' in m.combat[k]) C[k] = m.combat[k].value;
      C.rings = {}; for (const k in m.combat.splash_rings) C.rings[k] = v(m.combat.splash_rings[k]);
      C.siege = {}; for (const k in m.combat.siege_mode) C.siege[k] = v(m.combat.siege_mode[k]);
    }
    E.surgeLoops = loops(E.surge_s);
    E.regenPerLoop = E.energy_regen / LPS;
    E.broodLoops = loops(E.brood_interval);
    return { t, E, M, C, raw };
  }

  // Our own symmetric 2-player map. 128x128 cells. Player 1 is the point mirror of player 0.
  function makeMap(D) {
    const W = 128, H = 128, E = D.E;
    const cliffs = [
      { x0: 36, y0: 2, x1: 37, y1: 23 }, { x0: 36, y0: 33, x1: 37, y1: 40 }, { x0: 2, y0: 40, x1: 37, y1: 41 },
    ];
    const ramps = [{ x: 36.5, y: 28, w: 8, note: 'main ramp, the choke between main and natural' }];
    const defs = [['main', 20, 20], ['natural', 46, 30], ['third', 24, 56]];
    const bases = [], patches = [], geysers = [];
    const cl = (x, y) => Math.max(1, Math.min(W - 2, Math.round(x))) + ',' + Math.max(1, Math.min(H - 2, Math.round(y)));
    for (let side = 0; side < 2; side++) {
      for (const [name, bx0, by0] of defs) {
        const bx = side ? W - 1 - bx0 : bx0, by = side ? H - 1 - by0 : by0;
        const id = bases.length;
        bases.push({ id, name, side, x: bx, y: by, patches: [], geysers: [] });
        // minerals sit on an arc facing away from map center
        const ang0 = Math.atan2(by - H / 2, bx - W / 2);
        for (let i = 0; i < E.patches; i++) {
          const a = ang0 + (-70 + i * 20) * Math.PI / 180;
          const big = i % 2 === 0;
          const close = i >= 2 && i <= 5;
          const p = { id: patches.length, base: id, x: Math.round(bx + 7 * Math.cos(a)), y: Math.round(by + 7 * Math.sin(a)),
            amount: big ? E.big_amount : E.small_amount, close, workers: 0, occ: 0, queue: [], dead: false };
          patches.push(p); bases[id].patches.push(p.id);
        }
        for (let k = 0; k < E.geysers; k++) {
          const a = ang0 + (k ? 1 : -1) * 105 * Math.PI / 180;
          const gy = { id: geysers.length, base: id, x: Math.round(bx + 8 * Math.cos(a)), y: Math.round(by + 8 * Math.sin(a)), amount: E.geyser_amount, bld: 0 };
          geysers.push(gy); bases[id].geysers.push(gy.id);
        }
      }
    }
    // occupancy grid: 1 = blocked (cliff), 2 = resource, 3 = structure
    const grid = new Uint8Array(W * H);
    const fill = (x0, y0, x1, y1, v) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (x >= 0 && y >= 0 && x < W && y < H) grid[y * W + x] = v; };
    for (const c of cliffs) {
      fill(c.x0, c.y0, c.x1, c.y1, 1);
      fill(W - 1 - c.x1, H - 1 - c.y1, W - 1 - c.x0, H - 1 - c.y0, 1);
    }
    for (const r of ramps) { fill(Math.floor(r.x - 1), Math.floor(r.y - r.w / 2), Math.ceil(r.x + 1), Math.ceil(r.y + r.w / 2), 0); }
    for (const p of patches) fill(p.x, p.y, p.x + 1, p.y, 2);
    for (const gy of geysers) fill(gy.x - 1, gy.y - 1, gy.x + 1, gy.y + 1, 2);
    for (const b of bases) fill(b.x - 2, b.y - 2, b.x + 2, b.y + 2, 0);
    return { W, H, cliffs, ramps, bases, patches, geysers, grid };
  }

  // FNV-1a over integers
  function hashState(g) {
    let h = 0x811c9dc5;
    const mix = n => { n = n | 0; for (let i = 0; i < 4; i++) { h ^= (n >>> (i * 8)) & 255; h = Math.imul(h, 0x01000193); } };
    const f = x => mix(Math.round(x * 1000));
    mix(g.loop);
    for (const p of g.players) { mix(p.minerals); mix(p.gas); mix(p.used); mix(p.cap); mix(p.resv.m); mix(p.resv.g); mix(p.mined); }
    for (const e of g.ents) {
      if (e.dead) continue;
      mix(e.id); mix(e.type.length); for (let i = 0; i < e.type.length; i++) mix(e.type.charCodeAt(i));
      mix(e.x); mix(e.y); mix(e.done ? 1 : 0); mix(e.work | 0); mix(e.t | 0); mix(e.cargo | 0); mix(e.patch | 0);
      mix(e.surge | 0); mix(e.brood | 0); mix(e.queue ? e.queue.length : 0);
      if (e.queue) for (const q of e.queue) mix(q.work);
      if (e.energy !== undefined) f(e.energy);
      if (e.hp !== undefined) { f(e.x); f(e.y); f(e.hp); f(e.sh); f(e.cd); mix(e.tgt | 0); }
    }
    for (const p of g.map.patches) { mix(p.amount); mix(p.occ); mix(p.workers); }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  class Game {
    // opts: {data, seed, players:[{race}]}
    constructor(opts) {
      this.D = opts.data;
      this.seed = opts.seed >>> 0;
      this.rand = rng(this.seed);
      this.map = makeMap(this.D);
      this.loop = 0;
      this.ents = [];
      this.nextId = 1;
      this.log = [];
      this.players = [];
      this.systems = [];
      this.bots = [];
      const R = this.D.M.races;
      opts.players.forEach((po, i) => {
        const p = { id: i, race: po.race, R: R[po.race], minerals: this.D.E.start_minerals, gas: 0, used: 0, cap: 0,
          resv: { m: 0, g: 0 }, mined: 0, base0: i * 3 };
        this.players.push(p);
        if (opts.skirmish) p.bases = []; // combat tests: no hall, no workers, units are placed by hand
        else root.Arena.setupPlayer(this, p);
      });
    }
    spawn(e) { e.id = this.nextId++; e.dead = false; this.ents.push(e); return e; }
    byOwner(pid, type) { return this.ents.filter(e => !e.dead && e.owner === pid && (!type || e.type === type)); }
    emit(p, ev, what, extra) {
      this.log.push(Object.assign({ loop: this.loop, t: this.loop / LPS, p: p.id, ev, what, supply: p.used, minerals: p.minerals }, extra || {}));
    }
    tick() {
      const A = root.Arena;
      A.tickEcon(this);
      if (A.tickCombat) A.tickCombat(this);
      for (const b of this.bots) b.tick();
      this.loop++;
    }
    run(untilLoop, snapAt) {
      const snaps = {};
      while (this.loop < untilLoop) {
        this.tick();
        if (snapAt && snapAt.indexOf(this.loop) >= 0) snaps[this.loop] = hashState(this);
      }
      return snaps;
    }
    hash() { return hashState(this); }
  }

  const api = root.Arena || {};
  Object.assign(api, { LPS, loops, rng, makeData, makeMap, hashState, Game });
  root.Arena = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
