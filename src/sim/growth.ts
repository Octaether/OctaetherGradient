// Growth tables: each lineage's steady-state growth, energy charge and fluxes,
// computed by the cell model at a grid of food levels and interpolated in
// log-food between them. Building a table is the expensive step; reading one
// is cheap, so the population can be stepped many times per second.
import type { Compiled } from './cell';

/** Food levels (relative to the act's supply) at which tables are sampled. */
export const FOOD_GRID = [1e-4, 4e-4, 1.5e-3, 5e-3, 0.015, 0.04, 0.09, 0.18, 0.32, 0.5, 0.75, 1.05, 1.5, 2.4];

export interface TablePt {
  mu: number;
  carrier: number;
  ec: number;
  uptake: number;
  dmg: number;
  bflux: Record<string, number>;
}
export interface Table {
  foods: number[];
  pts: TablePt[];
}

export function clamp(x: number, a: number, b: number) {
  return Math.max(a, Math.min(b, x));
}

/** A table read at any food level: linear in log-food between grid points. */
export function interp(t: Table, food: number): TablePt {
  const f = Math.max(food, t.foods[0]);
  const n = t.foods.length;
  if (f >= t.foods[n - 1]) return t.pts[n - 1];
  let i = 0;
  while (i < n - 2 && t.foods[i + 1] < f) i++;
  const a = Math.log(t.foods[i]);
  const b = Math.log(t.foods[i + 1]);
  const w = clamp((Math.log(f) - a) / (b - a), 0, 1);
  const p = t.pts[i];
  const q = t.pts[i + 1];
  const bflux: Record<string, number> = {};
  for (const k of Object.keys(p.bflux)) bflux[k] = p.bflux[k] * (1 - w) + (q.bflux[k] ?? 0) * w;
  return {
    mu: p.mu * (1 - w) + q.mu * w,
    carrier: p.carrier * (1 - w) + q.carrier * w,
    ec: p.ec * (1 - w) + q.ec * w,
    uptake: p.uptake * (1 - w) + q.uptake * w,
    dmg: p.dmg * (1 - w) + q.dmg * w,
    bflux,
  };
}

/** Environment values are bucketed in 8% steps so similar worlds share tables. */
export const quant = (v: number) => Math.round(Math.log(Math.max(v, 1e-6)) / Math.log(1.08));
export const dequant = (q: number) => Math.exp(q * Math.log(1.08));

/** Boundary-species index of the act's food, matched by environment key. */
export function foodIndex(c: Compiled, envKey: string): number {
  const boundary = c.net.species.filter((s) => s.kind === 'boundary');
  return boundary.findIndex((s) => (s.env ?? s.id) === envKey);
}
