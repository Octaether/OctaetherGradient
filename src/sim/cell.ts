// Layer 1: the cell. ds/dt = N v(s), Michaelis-Menten rate laws with
// multiplicative regulation, conserved pools enforced by reprojection onto
// the left null space of N.
import { invertSmall, leftNullSpace, solveInPlace } from './linalg';
import type { Effect, Genotype, ModSpec, NetworkSpec, ReactionSpec } from './types';

export interface Params {
  vmax: Record<string, number>; // multiplier on kcat*E
  km: Record<string, number>; // multiplier on all Km of a reaction
  kmS: Record<string, number>; // "rxn|species" specific Km multiplier
  K: Record<string, number>; // "rxn|species" regulation constant multiplier
  extraMods: Record<string, ModSpec[]>;
  flags: Set<string>;
  globals: Record<string, number>;
}

export function baseParams(net: NetworkSpec): Params {
  return { vmax: {}, km: {}, kmS: {}, K: {}, extraMods: {}, flags: new Set(), globals: { ...(net.params ?? {}) } };
}

export function applyEffects(p: Params, effects: Effect[]): void {
  for (const e of effects) {
    switch (e.type) {
      case 'kcat':
      case 'E':
        p.vmax[e.rxn] = (p.vmax[e.rxn] ?? 1) * e.mul;
        break;
      case 'Km':
        if (e.species) p.kmS[e.rxn + '|' + e.species] = (p.kmS[e.rxn + '|' + e.species] ?? 1) * e.mul;
        else p.km[e.rxn] = (p.km[e.rxn] ?? 1) * e.mul;
        break;
      case 'K':
        p.K[e.rxn + '|' + e.species] = (p.K[e.rxn + '|' + e.species] ?? 1) * e.mul;
        break;
      case 'mod':
        (p.extraMods[e.rxn] ??= []).push(e.mod);
        break;
      case 'flag':
        p.flags.add(e.key);
        break;
      case 'unflag':
        p.flags.delete(e.key);
        break;
      case 'param': {
        let v = p.globals[e.key] ?? (e.mul !== undefined && e.add === undefined && e.set === undefined ? 1 : 0);
        if (e.set !== undefined) v = e.set;
        if (e.mul !== undefined) v *= e.mul;
        if (e.add !== undefined) v += e.add;
        p.globals[e.key] = v;
        break;
      }
    }
  }
}

export function paramsFor(net: NetworkSpec, g: Genotype, worldFlags: Iterable<string> = []): Params {
  const p = baseParams(net);
  for (const f of worldFlags) p.flags.add(f);
  for (const m of g.muts) applyEffects(p, m.effects);
  return p;
}

export function reactionPresent(r: ReactionSpec, flags: Set<string>): boolean {
  if (r.requires && !flags.has(r.requires)) return false;
  if (r.hiddenIf && flags.has(r.hiddenIf)) return false;
  return true;
}

const LAW = { mm: 0, ma: 1, diff: 2, supply: 3 } as const;

interface CRxn {
  id: string;
  idx: number; // index into full reaction list
  law: number;
  vmax: number;
  k: number;
  kr: number;
  keq: number;
  max: number;
  sub: Int32Array; // >=0 internal, <0: -(1+boundary index)
  subSto: Float64Array;
  subKm: Float64Array;
  prod: Int32Array;
  prodSto: Float64Array;
  modIdx: Int32Array;
  modType: Int8Array;
  modK: Float64Array;
  modN: Float64Array;
  modBasal: Float64Array;
  a: number;
  b: number;
  cat: number; // catalyst species ref, or 1e9 for none
}

export interface Compiled {
  net: NetworkSpec;
  ids: string[]; // internal species ids
  index: Record<string, number>;
  bIds: string[];
  bIndex: Record<string, number>;
  bval: Float64Array;
  rx: CRxn[]; // present reactions
  rIndex: Record<string, number>; // reaction id -> index in rx
  growthIdx: number;
  uptakeIdx: number;
  carrierIdx: number[];
  n: number;
  G: number[][]; // conserved moieties
  T: number[];
  M: number[][]; // projection helper
  dilution: boolean;
  Ccell: number;
  params: Params;
  vmaxScale: number; // global multiplier (temperature, error load, damage)
}

function speciesRef(id: string, index: Record<string, number>, bIndex: Record<string, number>): number {
  if (id in index) return index[id];
  if (id in bIndex) return -(1 + bIndex[id]);
  throw new Error('Unknown species ' + id);
}

export function compile(
  net: NetworkSpec,
  params: Params,
  env: Record<string, number>,
  s0?: Float64Array | null,
  vmaxScale = 1,
): { c: Compiled; s: Float64Array } {
  const internal = net.species.filter((s) => s.kind !== 'boundary');
  const boundary = net.species.filter((s) => s.kind === 'boundary');
  const ids = internal.map((s) => s.id);
  const index: Record<string, number> = {};
  ids.forEach((id, i) => (index[id] = i));
  const bIds = boundary.map((s) => s.id);
  const bIndex: Record<string, number> = {};
  bIds.forEach((id, i) => (bIndex[id] = i));
  const bval = new Float64Array(boundary.length);
  boundary.forEach((s, i) => (bval[i] = env[s.env ?? s.id] ?? s.init));

  const rx: CRxn[] = [];
  const rIndex: Record<string, number> = {};
  net.reactions.forEach((r, ri) => {
    if (!reactionPresent(r, params.flags)) return;
    const subs = Object.entries(r.sub);
    const prods = Object.entries(r.prod);
    const kmMul = params.km[r.id] ?? 1;
    const mods = [...(r.mods ?? []), ...(params.extraMods[r.id] ?? [])].filter(
      (m) => m.species in index || m.species in bIndex,
    );
    let scale = 1;
    for (const key of r.law.scale ?? []) scale *= params.globals[key] ?? 1;
    const lawType = LAW[r.law.type];
    const base = lawType === LAW.mm ? (r.law.kcat ?? 1) * (r.E ?? 1) : 1;
    const c: CRxn = {
      id: r.id,
      idx: ri,
      law: lawType,
      vmax: base * (params.vmax[r.id] ?? 1) * scale * (r.gene ? vmaxScale : 1),
      k: (r.law.k ?? 0) * scale * (lawType !== LAW.mm ? params.vmax[r.id] ?? 1 : 1),
      kr: (r.law.kr ?? 0) * scale,
      keq: r.law.Keq ?? 0,
      max: r.law.max ?? 0,
      sub: Int32Array.from(subs.map(([id]) => speciesRef(id, index, bIndex))),
      subSto: Float64Array.from(subs.map(([, n]) => n)),
      subKm: Float64Array.from(
        subs.map(([id]) => (r.law.Km?.[id] ?? 0.1) * kmMul * (params.kmS[r.id + '|' + id] ?? 1)),
      ),
      prod: Int32Array.from(prods.map(([id]) => speciesRef(id, index, bIndex))),
      prodSto: Float64Array.from(prods.map(([, n]) => n)),
      modIdx: Int32Array.from(mods.map((m) => speciesRef(m.species, index, bIndex))),
      modType: Int8Array.from(mods.map((m) => (m.type === 'inh' ? 0 : 1))),
      modK: Float64Array.from(mods.map((m) => m.K * (params.K[r.id + '|' + m.species] ?? 1))),
      modN: Float64Array.from(mods.map((m) => m.n ?? 1)),
      modBasal: Float64Array.from(mods.map((m) => m.basal ?? 0)),
      a: r.law.a ? speciesRef(r.law.a, index, bIndex) : 0,
      b: r.law.b ? speciesRef(r.law.b, index, bIndex) : 0,
      cat: r.law.cat ? speciesRef(r.law.cat, index, bIndex) : 1e9,
    };
    rIndex[r.id] = rx.length;
    rx.push(c);
  });

  const n = ids.length;
  // Stoichiometric matrix of present reactions (internal species only).
  const N: number[][] = ids.map(() => new Array(rx.length).fill(0));
  rx.forEach((r, j) => {
    r.sub.forEach((si, k) => {
      if (si >= 0) N[si][j] -= r.subSto[k];
    });
    r.prod.forEach((si, k) => {
      if (si >= 0) N[si][j] += r.prodSto[k];
    });
  });

  const s = new Float64Array(n);
  internal.forEach((sp, i) => (s[i] = s0 && s0.length === n ? s0[i] : sp.init));

  const dilution = !!net.dilution;
  let G: number[][] = [];
  let T: number[] = [];
  let M: number[][] = [];
  if (!dilution) {
    G = leftNullSpace(N, n, rx.length);
    T = G.map((g) => g.reduce((acc, gi, i) => acc + gi * s[i], 0));
    if (G.length) {
      const GG = G.map((gi) => G.map((gj) => gi.reduce((a, x, k) => a + x * gj[k], 0)));
      const inv = invertSmall(GG);
      // M = G^T (G G^T)^-1  (n x k)
      M = ids.map((_, i) => G.map((_, col) => G.reduce((a, g, row) => a + g[i] * inv[row][col], 0)));
    }
  }

  const c: Compiled = {
    net,
    ids,
    index,
    bIds,
    bIndex,
    bval,
    rx,
    rIndex,
    growthIdx: rIndex[net.growth] ?? -1,
    uptakeIdx: rIndex[net.uptake] ?? -1,
    carrierIdx: net.carrier.map((id) => rIndex[id] ?? -1).filter((i) => i >= 0),
    n,
    G,
    T,
    M,
    dilution,
    Ccell: net.Ccell,
    params,
    vmaxScale,
  };
  return { c, s };
}

/** Re-read boundary values from env without recompiling. */
export function setEnv(c: Compiled, env: Record<string, number>): void {
  c.net.species
    .filter((s) => s.kind === 'boundary')
    .forEach((s, i) => (c.bval[i] = env[s.env ?? s.id] ?? s.init));
}

export function rates(c: Compiled, s: Float64Array, v: Float64Array): void {
  const bv = c.bval;
  const get = (i: number) => (i >= 0 ? s[i] : bv[-1 - i]);
  for (let j = 0; j < c.rx.length; j++) {
    const r = c.rx[j];
    let rate = 0;
    switch (r.law) {
      case 0: {
        // Michaelis-Menten (multi-substrate product of saturations)
        let sat = 1;
        for (let k = 0; k < r.sub.length; k++) {
          const x = Math.max(get(r.sub[k]), 0);
          sat *= x / (r.subKm[k] + x);
        }
        let rev = 1;
        if (r.keq > 0) {
          let num = 1;
          let den = 1;
          for (let k = 0; k < r.prod.length; k++) num *= Math.pow(Math.max(get(r.prod[k]), 0), r.prodSto[k]);
          for (let k = 0; k < r.sub.length; k++) den *= Math.pow(Math.max(get(r.sub[k]), 1e-30), r.subSto[k]);
          rev = 1 - Math.min(num / den / r.keq, 3);
        }
        rate = r.vmax * sat * rev;
        break;
      }
      case 1: {
        let f = r.k;
        for (let k = 0; k < r.sub.length; k++) f *= Math.pow(Math.max(get(r.sub[k]), 0), r.subSto[k]);
        let b = r.kr;
        if (b > 0) for (let k = 0; k < r.prod.length; k++) b *= Math.pow(Math.max(get(r.prod[k]), 0), r.prodSto[k]);
        rate = f - b;
        break;
      }
      case 2:
        rate = r.k * (get(r.a) - get(r.b));
        break;
      case 3: {
        rate = r.k;
        if (r.max > 0 && r.prod.length) rate *= Math.max(0, 1 - get(r.prod[0]) / r.max);
        break;
      }
    }
    if (r.cat !== 1e9) rate *= Math.max(get(r.cat), 0);
    for (let k = 0; k < r.modIdx.length; k++) {
      const x = Math.max(get(r.modIdx[k]), 0);
      const q = Math.pow(x / r.modK[k], r.modN[k]);
      rate *= r.modType[k] === 0 ? 1 / (1 + q) : (r.modBasal[k] + q) / (1 + q);
    }
    v[j] = rate;
  }
}

export function growthRate(c: Compiled, v: Float64Array): number {
  return c.growthIdx >= 0 ? Math.max(v[c.growthIdx], 0) / c.Ccell : 0;
}

export function deriv(c: Compiled, s: Float64Array, v: Float64Array, ds: Float64Array): void {
  rates(c, s, v);
  ds.fill(0);
  for (let j = 0; j < c.rx.length; j++) {
    const r = c.rx[j];
    const vj = v[j];
    for (let k = 0; k < r.sub.length; k++) if (r.sub[k] >= 0) ds[r.sub[k]] -= r.subSto[k] * vj;
    for (let k = 0; k < r.prod.length; k++) if (r.prod[k] >= 0) ds[r.prod[k]] += r.prodSto[k] * vj;
  }
  if (c.dilution) {
    const mu = growthRate(c, v);
    for (let i = 0; i < c.n; i++) ds[i] -= mu * s[i];
  }
}

const FLOOR = 1e-12;

export function project(c: Compiled, s: Float64Array): void {
  for (let pass = 0; pass < 3; pass++) {
    if (c.G.length) {
      const r = c.G.map((g, k) => g.reduce((a, gi, i) => a + gi * s[i], 0) - c.T[k]);
      for (let i = 0; i < c.n; i++) {
        let d = 0;
        for (let k = 0; k < r.length; k++) d += c.M[i][k] * r[k];
        s[i] -= d;
      }
    }
    let clipped = false;
    for (let i = 0; i < c.n; i++) {
      if (!(s[i] > FLOOR)) {
        s[i] = FLOOR;
        clipped = true;
      }
    }
    if (!clipped) break;
  }
}

/** Largest deviation of any conserved total from its target. */
export function conservationError(c: Compiled, s: Float64Array): number {
  let worst = 0;
  c.G.forEach((g, k) => {
    const tot = g.reduce((a, gi, i) => a + gi * s[i], 0);
    worst = Math.max(worst, Math.abs(tot - c.T[k]) / Math.max(1e-9, Math.abs(c.T[k])));
  });
  return worst;
}

// Scratch buffers reused across steps (sim is single-threaded per worker).
let bufN = 0;
let J: Float64Array, A: Float64Array, f0: Float64Array, f1: Float64Array, sp: Float64Array, vv: Float64Array, rhs: Float64Array;
function ensure(n: number, r: number) {
  if (n <= bufN && vv && vv.length >= r) return;
  bufN = Math.max(n, bufN);
  const m = bufN;
  J = new Float64Array(m * m);
  A = new Float64Array(m * m);
  f0 = new Float64Array(m);
  f1 = new Float64Array(m);
  sp = new Float64Array(m);
  rhs = new Float64Array(m);
  vv = new Float64Array(Math.max(r, 64));
}

/**
 * One linearly implicit (Rosenbrock-Euler) step with a numerical Jacobian,
 * then reprojection onto the conserved-pool manifold. Returns false if the
 * step would have driven a species strongly negative (caller shrinks dt).
 */
export function implicitStep(c: Compiled, s: Float64Array, dt: number): boolean {
  const n = c.n;
  if (n === 0) return true;
  ensure(n, c.rx.length);
  deriv(c, s, vv, f0);
  for (let j = 0; j < n; j++) {
    const h = Math.max(Math.abs(s[j]) * 1e-6, 1e-10);
    const old = s[j];
    s[j] = old + h;
    deriv(c, s, vv, f1);
    s[j] = old;
    for (let i = 0; i < n; i++) J[i * n + j] = (f1[i] - f0[i]) / h;
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) A[i * n + j] = (i === j ? 1 : 0) - dt * J[i * n + j];
    rhs[i] = dt * f0[i];
  }
  if (!solveInPlace(A.subarray(0, n * n), rhs, n)) return false;
  for (let i = 0; i < n; i++) {
    const next = s[i] + rhs[i];
    if (!Number.isFinite(next)) return false;
    if (next < -0.5 * Math.abs(s[i]) - 1e-9) return false;
    sp[i] = next;
  }
  for (let i = 0; i < n; i++) s[i] = sp[i];
  project(c, s);
  return true;
}

/** Advance the live cell by `time` seconds with adaptive implicit steps. */
export function integrate(c: Compiled, s: Float64Array, time: number, maxDt = 0.5): void {
  let t = 0;
  let dt = Math.min(maxDt, time);
  let guard = 0;
  while (t < time - 1e-12 && guard++ < 200) {
    const h = Math.min(dt, time - t);
    const backup = Float64Array.from(s);
    if (implicitStep(c, s, h)) {
      t += h;
      dt = Math.min(maxDt, dt * 1.5);
    } else {
      s.set(backup);
      dt *= 0.25;
      if (dt < 1e-9) break;
    }
  }
}

export interface Steady {
  s: Float64Array;
  v: Float64Array;
  mu: number;
  converged: boolean;
  iters: number;
}

export function residual(c: Compiled, s: Float64Array): number {
  ensure(c.n, c.rx.length);
  deriv(c, s, vv, f0);
  let worst = 0;
  for (let i = 0; i < c.n; i++) worst = Math.max(worst, Math.abs(f0[i]) / (Math.abs(s[i]) + 1e-4));
  return worst;
}

/** Pseudo-transient continuation to steady state (implicit Euler with growing dt). */
export function steadyState(c: Compiled, s0: Float64Array, tol = 1e-7, maxIter = 260): Steady {
  const s = Float64Array.from(s0);
  project(c, s);
  let dt = 0.05;
  let it = 0;
  let converged = false;
  let res = residual(c, s);
  for (; it < maxIter; it++) {
    if (res < tol) {
      converged = true;
      break;
    }
    const backup = Float64Array.from(s);
    if (implicitStep(c, s, dt)) {
      const r2 = residual(c, s);
      if (r2 > res * 50 && dt > 1e-4) {
        s.set(backup);
        dt *= 0.3;
        continue;
      }
      res = r2;
      dt = Math.min(dt * 2.2, 1e7);
    } else {
      s.set(backup);
      dt *= 0.25;
      if (dt < 1e-10) break;
    }
  }
  const v = new Float64Array(c.rx.length);
  rates(c, s, v);
  return { s, v, mu: growthRate(c, v), converged, iters: it };
}

/**
 * Metabolic control analysis: flux control coefficient of every gene
 * reaction over the growth flux. C_i = d ln J / d ln E_i, by finite
 * difference around the steady state. The largest one is "what to upgrade".
 */
export function controlCoefficients(c: Compiled, ss: Steady, rel = 0.02): Record<string, number> {
  const out: Record<string, number> = {};
  const J0 = c.growthIdx >= 0 ? ss.v[c.growthIdx] : 0;
  if (!(J0 > 1e-15)) return out;
  for (const r of c.rx) {
    const spec = c.net.reactions[r.idx];
    if (!spec.gene) continue;
    const old = r.vmax;
    const oldK = r.k;
    r.vmax = old * (1 + rel);
    r.k = oldK * (1 + rel);
    const p = steadyState(c, ss.s, 1e-9, 120);
    r.vmax = old;
    r.k = oldK;
    const J1 = p.v[c.growthIdx];
    out[r.id] = Math.log(Math.max(J1, 1e-30) / J0) / Math.log(1 + rel);
  }
  return out;
}

export function carrierFlux(c: Compiled, v: Float64Array): number {
  let f = 0;
  for (const i of c.carrierIdx) f += Math.max(0, v[i]);
  return f;
}

export function energyCharge(c: Compiled, s: Float64Array): number {
  const ec = c.net.ec;
  if (!ec) return 1;
  const a = s[c.index[ec.atp]] ?? 0;
  const d = s[c.index[ec.adp]] ?? 0;
  // Atkinson energy charge with AMP folded into ADP for this model.
  return a + d > 0 ? a / (a + d) : 0;
}
