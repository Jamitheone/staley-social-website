// tech.js: what a player owns, what is unlocked, power fields, supply.
(function (root) {
  'use strict';
  if (!root.Arena && typeof require !== 'undefined') require('./core.js');
  const A = root.Arena;

  // finished building of this type, or a finished addon on one
  // ahead: also count a building that will finish within that many loops (work is in half loops)
  function has(g, p, id, ahead) {
    for (const e of g.ents) {
      if (e.dead || e.owner !== p.id) continue;
      if (!e.done && !(ahead && e.kind === 'building' && e.work <= ahead * 2)) continue;
      if (e.type === id || e.addon === id) return true;
    }
    return false;
  }

  // requires is a list of ids. Anything not in the data tables (lair, starport, ...) can never be met in M1.
  function unlocked(g, p, id, ahead) {
    const def = g.D.t[id];
    if (!def) return false;
    for (const r of def.requires) { if (!g.D.t[r] || !has(g, p, r, ahead)) return false; }
    return true;
  }

  function needsPower(g, p, id) {
    return p.race === 'solari' && !['beacon', 'citadel', 'tapper'].includes(id) && g.D.t[id].kind === 'building';
  }

  function powered(g, p, x, y, ahead) {
    const r2 = g.D.M.powerR * g.D.M.powerR;
    for (const e of g.ents) {
      if (e.dead || e.owner !== p.id || e.type !== 'beacon') continue;
      if (!e.done && !(ahead && e.work <= ahead * 2)) continue;
      if ((e.x - x) * (e.x - x) + (e.y - y) * (e.y - y) <= r2) return true;
    }
    return false;
  }

  function recalcSupply(g, p) {
    let cap = 0;
    for (const e of g.ents) {
      if (e.dead || e.owner !== p.id) continue;
      const d = g.D.t[e.type];
      if (d && d.supply_provided && (e.kind !== 'building' || e.done) && e.kind !== 'egg') cap += d.supply_provided;
    }
    p.cap = Math.min(cap, g.D.E.supply_cap);
  }

  Object.assign(A, { has, unlocked, needsPower, powered, recalcSupply });
  root.Arena = A;
  if (typeof module !== 'undefined') module.exports = A;
})(typeof globalThis !== 'undefined' ? globalThis : this);
