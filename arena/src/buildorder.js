// buildorder.js: declarative build-order interpreter plus the worker, surge and supply macro.
// A strategy is JSON: {id, race, workers, auto_surge, auto_supply, supply_buffer, steps:[{at:{...}, do, what, count}]}
// at: supply (used >= n), time (seconds), done (a finished building), after_s (seconds after the previous step fired),
// arrive_s (build steps only: send the builder so it arrives on this clock time). All keys must hold.
// do: build | train | surge | workers (set the worker target) | note
(function (root) {
  'use strict';
  if (!root.Arena && typeof require !== 'undefined') require('./core.js');
  if (typeof require !== 'undefined') { require('./tech.js'); require('./econ.js'); require('./orders.js'); }
  const A = root.Arena;

  function makeBot(g, p, strat) {
    const D = g.D, R = p.R, steps = strat.steps || [];
    const depth = strat.queue_depth === undefined ? 2 : strat.queue_depth; // players queue a second worker, supply counts it
    const st = { i: 0, prev: 0, n: 0, wtarget: strat.workers === undefined ? 44 : strat.workers, fired: [] };

    function workerCount() {
      let n = 0;
      for (const e of g.ents) {
        if (e.dead || e.owner !== p.id) continue;
        if (e.kind === 'worker') n++;
        else if (e.kind === 'egg' && e.type === R.worker) n++;
        else if (e.kind === 'building' && e.queue) for (const q of e.queue) if (q.type === R.worker) n++;
      }
      return n;
    }

    // Send a builder if money will be there when it arrives. Returns true once committed.
    function tryBuild(type, respect, arrive) {
      const def = D.t[type];
      const free = p.minerals - (respect ? p.resv.m : 0), freeG = p.gas - (respect ? p.resv.g : 0);
      if (freeG < def.cost.gas) return false;
      if (free + A.incomeRate(g, p) * 30 * A.LPS < def.cost.minerals) return false;
      const plan = A.planBuild(g, p, type);
      if (!plan) return false;
      if (arrive !== undefined && g.loop + plan.walk < A.loops(arrive)) return false; // timed step: arrive on the clock
      if (free + A.incomeRate(g, p) * plan.walk < def.cost.minerals) return false;
      A.commitBuild(g, p, plan);
      return true;
    }

    function triggered(s) {
      const a = s.at || {};
      if (a.supply !== undefined && p.used < a.supply) return false;
      if (a.time !== undefined && g.loop < A.loops(a.time)) return false;
      if (a.done !== undefined && !A.has(g, p, a.done)) return false;
      if (a.after_s !== undefined && g.loop < st.prev + A.loops(a.after_s)) return false;
      return true;
    }

    function attempt(s) {
      switch (s.do) {
        case 'build': return tryBuild(s.what, true, (s.at || {}).arrive_s);
        case 'train': return !!A.train(g, p, s.what, { respect: false });
        case 'surge': {
          const t = g.byOwner(p.id, s.what).find(b => b.done && b.queue.length && b.surge <= 0);
          return !!(t && A.surge(g, p, t.id));
        }
        case 'workers': st.wtarget = s.n; return true;
        default: return true;
      }
    }

    function pendingSupply() {
      let n = 0;
      for (const e of g.ents) {
        if (e.dead || e.owner !== p.id) continue;
        if (e.kind === 'building' && e.type === R.supply && !e.done) n++;
        else if (e.kind === 'egg' && e.type === R.supply) n++;
        else if (e.kind === 'worker' && e.job === 'build' && e.order && e.order.type === R.supply) n++;
      }
      return n;
    }

    function tick() {
      // 1. scripted steps, in order
      while (st.i < steps.length) {
        const s = steps[st.i];
        if (!triggered(s)) break;
        if (!attempt(s)) break;
        if (s.do === 'train' && s.count && ++st.n < s.count) break;
        st.n = 0; st.prev = g.loop; st.i++;
      }
      // the next build step has fired but its builder has not left yet: keep its money back from worker production
      let extra = 0;
      if (strat.save_for_steps !== false && st.i < steps.length && steps[st.i].do === 'build' && triggered(steps[st.i])) {
        // only hold money back once the building is within about 8 seconds of affordable, so a long wait for a big step never starves workers
        const c = D.t[steps[st.i].what].cost.minerals;
        if (c - (p.minerals - p.resv.m) <= A.incomeRate(g, p) * A.loops(8)) extra = c;
      }
      // 2. keep making workers, never touching money reserved for builds in flight
      if (st.wtarget > 0) {
        let n = workerCount();
        const halls = g.byOwner(p.id, R.hall).filter(h => h.done);
        if (p.race === 'verdant') {
          while (n < st.wtarget && A.train(g, p, R.worker, { respect: true, extra })) n++;
        } else {
          for (const h of halls) { if (n >= st.wtarget) break; if (h.queue.length < depth && A.train(g, p, R.worker, { respect: true, depth, extra })) n++; }
        }
      }
      // 3. surge the hall that is producing
      if (strat.auto_surge && p.race === 'solari') {
        const h = g.byOwner(p.id, R.hall).find(b => b.done && b.queue.length && b.surge <= 0);
        if (h && g.byOwner(p.id, R.hall).some(b => b.done && b.energy >= D.E.surge_cost)) A.surge(g, p, h.id);
      }
      // 4. supply
      if (strat.auto_supply && p.cap < D.E.supply_cap && p.cap - p.used < (strat.supply_buffer === undefined ? 4 : strat.supply_buffer) && pendingSupply() === 0) {
        if (p.race === 'verdant') A.train(g, p, R.supply, { respect: true });
        else tryBuild(R.supply, true);
      }
    }

    return { strat, st, tick };
  }

  function attachBot(g, pid, strat) { const b = makeBot(g, g.players[pid], strat); g.bots.push(b); return b; }

  Object.assign(A, { makeBot, attachBot });
  root.Arena = A;
  if (typeof module !== 'undefined') module.exports = A;
})(typeof globalThis !== 'undefined' ? globalThis : this);
