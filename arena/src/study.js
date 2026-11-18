// study.js: the study tools shared by the CLI and the viewer.
//   newMatch      one place that builds a game from strategies (so a replay and a live game start the same way)
//   applyOrder    the human orders (recorded in a replay, replayed on rewind)
//   replay        replay = {v, seed, strats:[strat, strat], human:null|{assist}, orders, end, hash}: tiny JSON, re-simulated, hash checked
//   whatIf        change exactly one build-order step, rerun, list only the timings that moved
//   sampleRow     one row of the post-game graphs, also exported as CSV
(function (root) {
  'use strict';
  if (!root.Arena && typeof require !== 'undefined') require('./core.js');
  if (typeof require !== 'undefined') ['tech', 'econ', 'orders', 'buildorder', 'combat', 'bot'].forEach(m => require('./' + m + '.js'));
  const A = root.Arena;

  // human = null (both sides scripted) or {assist}: side 0 is a person, the sim only runs his workers, supply and surge if assist
  function newMatch(data, strats, seed, human) {
    const g = new A.Game({ data, seed, players: strats.map(s => ({ race: s.race })) });
    strats.forEach((s, i) => {
      if (human && i === 0) A.attachBot(g, i, { race: s.race, workers: human.assist ? 44 : 0, auto_surge: !!human.assist, auto_supply: !!human.assist, supply_buffer: 6, steps: [] });
      else A.attachBrain(g, i, s);
    });
    return g;
  }

  // Returns '' on success or a short reason. Orders reference entities by id, which are the same on every re-simulation.
  function applyOrder(g, o, label) {
    const p = g.players[o.pid], L = label || (t => t), D = g.D, LPS = A.LPS;
    const us = () => (o.ids || []).map(id => g.ents[id - 1]).filter(e => e && !e.dead && e.kind === 'unit' && e.hp > 0);
    switch (o.k) {
      case 'build': {
        const plan = A.planBuild(g, p, o.type);
        if (!plan) return 'cannot build ' + L(o.type) + ': ' + g.why;
        if (o.x !== undefined) {
          plan.x = o.x; plan.y = o.y;
          const w = A.ent(g, plan.worker), b = g.map.bases[g.map.patches[w.patch].base];
          plan.walk = D.M.leave + Math.ceil(A.dist(b.x, b.y, o.x, o.y) / D.M.speed * LPS);
        }
        if (p.minerals - p.resv.m < plan.rm || p.gas - p.resv.g < plan.rg) return 'not enough money for ' + L(o.type);
        A.commitBuild(g, p, plan); return '';
      }
      case 'train': return A.train(g, p, o.type, { respect: false }) ? '' : 'cannot train ' + L(o.type) + ': ' + g.why;
      case 'surge': return A.surge(g, p, o.id) ? '' : 'surge failed: ' + g.why;
      case 'move': A.orderMove(g, us(), o.x, o.y); return '';
      case 'attackmove': A.orderAttackMove(g, us(), o.x, o.y); return '';
      case 'attack': A.orderAttack(g, us(), o.target); return '';
      case 'siege': for (const e of us()) A.setSiege(g, e, !e.sieged); return '';
      case 'rally': { const b = g.ents[o.id - 1]; if (b && !b.dead) b.rally = { x: o.x, y: o.y }; return ''; }
    }
    return '';
  }

  function runTo(g, loop, orders) {
    let oi = 0; orders = orders || [];
    while (g.loop < loop) { while (oi < orders.length && orders[oi].loop <= g.loop) applyOrder(g, orders[oi++]); g.tick(); }
    return g;
  }

  function makeReplay(strats, seed, human, orders, g) {
    return { v: 1, seed, strats, human: human || null, orders: orders || [], end: g.loop, hash: g.hash() };
  }
  // Re-simulate a replay from its seed and orders. ok = the state hash at the end equals the recorded one.
  function replay(data, rp) {
    const g = newMatch(data, rp.strats, rp.seed, rp.human);
    runTo(g, rp.end, rp.orders);
    return { g, hash: g.hash(), ok: g.hash() === rp.hash };
  }

  // placed buildings and trained units, in the order they happened, keyed "event what #n" so two runs line up
  function timings(g, pid) {
    const seen = {}, out = {}, worker = g.players[pid].R.worker;
    for (const l of g.log) {
      if (l.p !== pid || (l.ev !== 'placed' && l.ev !== 'trained') || l.what === worker) continue;
      const k = l.ev + ' ' + l.what; seen[k] = (seen[k] || 0) + 1; out[k + ' #' + seen[k]] = l.t;
    }
    return out;
  }
  function diffTimings(a, b, minDelta) {
    const rows = [], md = minDelta === undefined ? 0.5 : minDelta;
    for (const k of Object.keys(Object.assign({}, a, b))) {
      const x = a[k], y = b[k];
      if (x === undefined || y === undefined) rows.push({ key: k, base: x === undefined ? null : x, alt: y === undefined ? null : y });
      else if (Math.abs(x - y) >= md) rows.push({ key: k, base: x, alt: y });
    }
    return rows.sort((p, q) => (p.base === null ? p.alt : p.base) - (q.base === null ? q.alt : q.base));
  }

  // Change ONE step of side 0's strategy: patch = {supply: n} | {time: s}. Everything else, the opponent and the seed stay the same.
  function whatIf(data, base, opp, seed, until, stepIndex, patch) {
    const alt = JSON.parse(JSON.stringify(base));
    const st = alt.steps[stepIndex]; if (!st) throw new Error('no step ' + stepIndex);
    st.at = Object.assign({}, patch);   // the step now fires on exactly this trigger
    const end = A.loops(until || 600), a = runTo(newMatch(data, [base, opp], seed), end), b = runTo(newMatch(data, [alt, opp], seed), end);
    const army = g => g.ents.filter(e => !e.dead && e.owner === 0 && e.kind === 'unit' && e.hp > 0).length;
    return { alt, step: stepIndex, was: base.steps[stepIndex], now: st, diffs: diffTimings(timings(a, 0), timings(b, 0)),
      result: { base: { supply: a.players[0].used, army: army(a), minerals: a.players[0].minerals, enemyBuildings: a.ents.filter(e => !e.dead && e.owner === 1 && e.kind === 'building').length },
                alt: { supply: b.players[0].used, army: army(b), minerals: b.players[0].minerals, enemyBuildings: b.ents.filter(e => !e.dead && e.owner === 1 && e.kind === 'building').length } } };
  }

  // Graph sample: income per minute over the last interval, workers, army value, supply. `last` = previous mined totals.
  function sampleRow(g, last, intervalS) {
    const row = { t: g.loop / A.LPS, p: [] };
    for (let i = 0; i < 2; i++) {
      const p = g.players[i]; let army = 0, workers = 0;
      for (const e of g.ents) { if (e.dead || e.owner !== i) continue; if (e.kind === 'worker') workers++; else if (e.kind === 'unit' && e.type !== p.R.worker) { const c = g.D.t[e.type].cost; army += c.minerals + c.gas; } }
      row.p.push({ income: (p.mined - last[i]) * 60 / (intervalS || 5), workers, army, supply: p.used }); last[i] = p.mined;
    }
    return row;
  }
  function csv(samples) {
    const head = ['t_seconds']; for (const s of [1, 2]) for (const k of ['income_per_min', 'workers', 'army_value', 'supply']) head.push('side' + s + '_' + k);
    return [head.join(',')].concat(samples.map(r => [r.t.toFixed(1)].concat(r.p.flatMap(p => [Math.round(p.income), p.workers, p.army, p.supply])).join(','))).join('\n') + '\n';
  }

  Object.assign(A, { newMatch, applyOrder, runTo, makeReplay, replay, timings, diffTimings, whatIf, sampleRow, csv });
  root.Arena = A;
  if (typeof module !== 'undefined') module.exports = A;
})(typeof globalThis !== 'undefined' ? globalThis : this);
