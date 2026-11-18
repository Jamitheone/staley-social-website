// bot.js: the strategy bot. A strategy is data: the build-order steps (buildorder.js), plus
//   produce: {comp:{unit: weight}, from:{supply|time|done}}   keep training units in this ratio once `from` holds (losses are replaced)
//   grow:    [{what, max, minerals}]                          build more of a building once the bank reaches `minerals`
//   army:    {attack_supply, attack_time, min_supply, retreat_ratio}  gather, attack when big enough or on time, retreat when losing (0 = never)
// attachBrain(g, pid, strat) wires all of it: the build order, workers, surge, supply, production, growth and the army.
(function (root) {
  'use strict';
  if (!root.Arena && typeof require !== 'undefined') require('./core.js');
  if (typeof require !== 'undefined') ['tech', 'econ', 'orders', 'buildorder', 'combat'].forEach(m => require('./' + m + '.js'));
  const A = root.Arena;

  function attachBrain(g, pid, strat) {
    const p = g.players[pid], pr = strat.produce, grow = strat.grow || [];
    A.attachBot(g, pid, strat);
    if (strat.army) A.attachArmy(g, pid, strat.army);

    const holds = a => {
      if (!a) return true;
      if (a.supply !== undefined && p.used < a.supply) return false;
      if (a.time !== undefined && g.loop < A.loops(a.time)) return false;
      if (a.done !== undefined && !A.has(g, p, a.done)) return false;
      return true;
    };
    // units of a type that exist or are on the way (egg or queue), so the ratio counts what is already paid for
    function made(type) {
      let n = 0;
      for (const e of g.ents) {
        if (e.dead || e.owner !== pid) continue;
        if (e.type === type && (e.kind === 'unit' || e.kind === 'egg')) n++;
        else if (e.kind === 'building' && e.queue) for (const q of e.queue) if (q.type === type) n++;
      }
      return n;
    }
    function inflight(type) {
      let n = 0;
      for (const e of g.ents) {
        if (e.dead || e.owner !== pid) continue;
        if (e.kind === 'building' && e.type === type) n++;
        else if (e.kind === 'worker' && e.job === 'build' && e.order && e.order.type === type) n++;
      }
      return n;
    }
    function produce() {
      const cand = Object.keys(pr.comp).filter(t => A.unlocked(g, p, t));
      for (let tries = 0; tries < 16 && cand.length; tries++) {
        let best = cand[0], bs = made(best) / pr.comp[best];
        for (const t of cand) { const s = made(t) / pr.comp[t]; if (s < bs) { bs = s; best = t; } }
        if (!A.train(g, p, best, { respect: true })) cand.splice(cand.indexOf(best), 1);
      }
    }
    function growBuildings() {
      for (const r of grow) {
        if (inflight(r.what) >= r.max) continue;
        const def = D().t[r.what];
        if (p.minerals - p.resv.m < (r.minerals === undefined ? def.cost.minerals : r.minerals)) continue;
        const plan = A.planBuild(g, p, r.what);
        if (!plan || p.minerals - p.resv.m < plan.rm || p.gas - p.resv.g < plan.rg) continue;
        A.commitBuild(g, p, plan); return;
      }
    }
    const D = () => g.D;
    const brain = { tick() {
      if (g.loop % 11 !== 0) return;
      if (pr && holds(pr.from)) produce();
      if (grow.length) growBuildings();
    } };
    g.bots.push(brain);
    return brain;
  }

  Object.assign(A, { attachBrain });
  root.Arena = A;
  if (typeof module !== 'undefined') module.exports = A;
})(typeof globalThis !== 'undefined' ? globalThis : this);
