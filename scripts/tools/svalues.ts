// Selection coefficient of every adaptation in an act, measured through the
// cell model: s = mu(founders + prerequisites + adaptation) / mu(founders + prerequisites) - 1
// at full food. Usage: npx tsx scripts/svalues.ts <act> [worldFlags]
import { Game } from '../../src/sim/game';
import { ACTS } from '../../src/content';
import { compile, paramsFor, steadyState } from '../../src/sim/cell';
import type { Mutation } from '../../src/sim/types';

const actIdx = Number(process.argv[2] ?? 2);
const extraFlags = (process.argv[3] ?? '').split(',').filter(Boolean);
const basePre = (process.argv[4] ?? '').split(',').filter(Boolean);
const g = new Game(ACTS, null, 1);
g.jumpTo(actIdx);
for (const f of extraFlags) g.s.a!.flags.push(f);
for (const kv of (process.argv[5] ?? '').split(',').filter(Boolean)) {
  const [k, v] = kv.split('=');
  g.s.a!.env[k] = Number(v);
}
for (let i = 0; i < 4; i++) g.tick(0.5);
const act = ACTS[actIdx];
const a = g.s.a!;
const flags = [...a.flags, ...extraFlags, ...act.unlocks.map((u) => u.id), ...act.unlocks.flatMap((u) => u.flags ?? []), 'virus', 'parasites', 'types', 'cheaters', 'heterotrophy'];
const { key, foodIn } = g.foodKey();
function mu(ids: string[], food = foodIn): number {
  const muts: Mutation[] = ids.map((id, i) => {
    const ad = act.adaptations.find((x) => x.id === id)!;
    return { id: id + i, adaptation: id, label: id, effects: ad.effects };
  });
  const p = paramsFor(act.network, { muts }, flags);
  g.finishParams(p);
  const { c, s } = compile(act.network, p, { ...a.env, [key]: food });
  const ss = steadyState(c, s);
  return ss.mu;
}
function chain(id: string, acc: string[] = []): string[] {
  const ad = act.adaptations.find((x) => x.id === id)!;
  for (const r of ad.requires ?? []) if (!acc.includes(r)) chain(r, acc);
  return acc.includes(id) ? acc : (acc.push(id), acc);
}
const base = mu(basePre);
const d0 = act.pacing.delta0;
/** Food level where this genotype's growth equals death: the chemostat equilibrium. */
function eqFood(ids: string[]): number {
  let lo = foodIn * 1e-5;
  let hi = foodIn * 2;
  if (mu(ids, hi) / base < d0) return hi;
  for (let i = 0; i < 30; i++) {
    const m = Math.sqrt(lo * hi);
    if (mu(ids, m) / base > d0) hi = m;
    else lo = m;
  }
  return hi;
}
console.log(`act ${actIdx} founders mu=${base.toPrecision(4)} (food ${key}=${foodIn})`);
for (const ad of act.adaptations) {
  const pre = [...new Set([...basePre, ...chain(ad.id).filter((x) => x !== ad.id)])];
  if (pre.includes(ad.id)) continue;
  const m0 = mu(pre);
  const m1 = mu([...pre, ad.id]);
  const s = m1 / m0 - 1;
  const S = eqFood(pre);
  const se = mu([...pre, ad.id], S) / mu(pre, S) - 1;
  console.log(`${ad.kind.padEnd(9)} ${ad.id.padEnd(14)} full ${(s * 100).toFixed(1).padStart(7)}%  eq ${(se * 100).toFixed(1).padStart(7)}% @${(S / foodIn).toFixed(3)}  ${pre.length ? 'after ' + pre.join('+') : ''}`);
}
