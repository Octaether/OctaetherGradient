// Quick numeric probe of an act network: steady state, conservation, MCA.
import { compile, paramsFor, steadyState, controlCoefficients, integrate, conservationError, energyCharge } from '../../src/sim/cell';
import { ACTS } from '../../src/content';

const idx = Number(process.argv[2] ?? 2);
const flags = (process.argv[3] ?? '').split(',').filter(Boolean);
const act = ACTS[idx];
const net = act.network;
const env: Record<string, number> = { ...act.env };
for (const kv of (process.argv[4] ?? '').split(',').filter(Boolean)) {
  const [k, v] = kv.split('=');
  env[k] = Number(v);
}
const p = paramsFor(net, { muts: [] }, flags);
const { c, s } = compile(net, p, env);
console.log('species', c.ids.join(' '), '| pools', c.G.length);
const t0 = performance.now();
const ss = steadyState(c, s);
console.log('steady', ss.converged, 'iters', ss.iters, (performance.now() - t0).toFixed(1) + 'ms');
c.ids.forEach((id, i) => console.log('  ', id.padEnd(8), ss.s[i].toPrecision(4)));
c.rx.forEach((r, j) => console.log('  v', r.id.padEnd(8), ss.v[j].toPrecision(4)));
console.log('mu', ss.mu.toPrecision(4), 'EC', energyCharge(c, ss.s).toFixed(3));
const cc = controlCoefficients(c, ss);
console.log('FCC', Object.entries(cc).map(([k, v]) => k + '=' + v.toFixed(3)).join(' '), 'sum', Object.values(cc).reduce((a, b) => a + b, 0).toFixed(3));
const live = Float64Array.from(s);
integrate(c, live, 3600 * 10, 5);
console.log('conservation error after 10h:', conservationError(c, live).toExponential(2));
// food sweep
const food = process.env.FOOD ?? act.food;
const grid = [2, 1, 0.3, 0.1, 0.05, 0.01, 0.001].map((f) => f * act.foodIn);
let prev = ss.s;
for (const f of grid) {
  const e2 = { ...env, [food]: f };
  const r = compile(net, p, e2, prev);
  const st = steadyState(r.c, r.s);
  prev = st.s;
  console.log('food', f.toPrecision(3).padStart(8), 'mu', st.mu.toPrecision(4), 'EC', energyCharge(r.c, st.s).toFixed(2), st.converged ? '' : 'NC');
}
