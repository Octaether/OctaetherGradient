// Act 0: the spark. Prebiotic chemistry in two sites (vent and pond). Nothing
// replicates. Strand lengths follow the Flory distribution: with extension
// probability p, the share of strands at least L long is p^(L-1). A 45-nt
// polymerase ribozyme (QT45-like) inside a vesicle is the spark.
import type { Rng } from './rng';

export const AVOGADRO_ML = 6.022e17; // molecules per mM in 1 mL
export const SPARK_LEN = 45;

export interface Act0Upgrade {
  id: string;
  name: string;
  site: 'vent' | 'pond' | 'both';
  text: string;
  cost: { org?: number; nu?: number; fa?: number }; // mM-equivalents at level 0
  growth: number;
  levels: number;
  card: string;
  needs?: string;
  automates?: boolean;
}

export const ACT0_UPGRADES: Act0Upgrade[] = [
  { id: 'fes', name: 'Iron–sulfur walls', site: 'vent', text: 'FeS and NiFe minerals reduce CO₂ with H₂: simple organics ×1.6', cost: { org: 2.5 }, growth: 2.2, levels: 6, card: 'fes-surface' },
  { id: 'ftt', name: 'Fischer–Tropsch-type synthesis', site: 'vent', text: 'Hot mineral surfaces chain carbon into fatty acids ×2', cost: { org: 9 }, growth: 2.5, levels: 4, card: 'ftt' },
  { id: 'cyano', name: 'Cyanosulfidic chemistry', site: 'pond', text: 'UV light, HCN and H₂S build nucleotide precursors: nucleotides ×1.8', cost: { org: 5 }, growth: 2.3, levels: 5, card: 'cyanosulfidic' },
  { id: 'schreib', name: 'Schreibersite phosphate', site: 'pond', text: 'Meteoritic phosphide releases reactive phosphorus: nucleotides ×1.5', cost: { org: 14, nu: 2 }, growth: 3, levels: 3, card: 'schreibersite' },
  { id: 'borate', name: 'Borate minerals', site: 'pond', text: 'Borate shields ribose from breaking down: nucleotide loss ×0.6', cost: { nu: 4 }, growth: 3, levels: 2, card: 'borate' },
  { id: 'clay', name: 'Montmorillonite clay', site: 'pond', text: 'Clay surfaces line up nucleotides and seed vesicles: polymerisation and vesicle assembly ×2', cost: { nu: 6, fa: 2 }, growth: 2.6, levels: 4, card: 'clay' },
  { id: 'imid', name: 'Imidazole activation', site: 'pond', text: 'Activated nucleotides join without enzymes: polymerisation ×1.8', cost: { nu: 15, org: 20 }, growth: 3, levels: 3, card: 'activation', needs: 'clay' },
  { id: 'ice', name: 'Ice-rimmed pools', site: 'pond', text: 'Freezing concentrates solutes in brine veins between ice crystals. Unlocks freeze–thaw cycles', cost: { org: 30, nu: 8 }, growth: 1, levels: 1, card: 'freeze-thaw' },
  { id: 'pools', name: 'More pools', site: 'both', text: 'Spread chemistry to more pools and pores: all production ×1.5', cost: { org: 12, nu: 3 }, growth: 2.4, levels: 8, card: 'sites' },
  { id: 'geyser', name: 'Hot-spring field', site: 'pond', text: 'Geysers wet and dry the pools on their own: cycles run automatically', cost: { org: 60, nu: 25, fa: 10 }, growth: 1, levels: 1, card: 'hot-springs', automates: true },
];

export interface Act0State {
  time: number;
  org: number;
  nu: number;
  fa: number;
  rna: number; // mM of nucleotides in strands
  ves: number; // vesicles, log-ish count (×1e6)
  p: number; // extension probability (smoothed)
  wet: number; // wet-dry cycle intensity 0..1
  ice: number; // freeze-thaw intensity 0..1
  cycleT: number; // seconds remaining in current manual cycle
  freezeT: number;
  cycles: number;
  freezes: number;
  autoT: number;
  up: Record<string, number>;
  overdue: number; // seconds since the spark became possible
  sparked: boolean;
  bought: number;
}

export function newAct0(): Act0State {
  return {
    time: 0,
    org: 0.4,
    nu: 0.02,
    fa: 0.01,
    rna: 0,
    ves: 0,
    p: 0.3,
    wet: 0,
    ice: 0,
    cycleT: 0,
    freezeT: 0,
    cycles: 0,
    freezes: 0,
    autoT: 0,
    up: {},
    overdue: 0,
    sparked: false,
    bought: 0,
  };
}

const lv = (s: Act0State, id: string) => s.up[id] ?? 0;

export function upgradeCost(u: Act0Upgrade, level: number) {
  const m = Math.pow(u.growth, level);
  return { org: (u.cost.org ?? 0) * m, nu: (u.cost.nu ?? 0) * m, fa: (u.cost.fa ?? 0) * m };
}

export function rates0(s: Act0State) {
  const pools = Math.pow(1.5, lv(s, 'pools'));
  const orgProd = 0.045 * Math.pow(1.6, lv(s, 'fes')) * pools;
  const sat = s.org / (0.6 + s.org);
  const nuProd = 0.009 * sat * Math.pow(1.8, lv(s, 'cyano')) * Math.pow(1.5, lv(s, 'schreib')) * pools;
  const faProd = 0.004 * sat * Math.pow(2, lv(s, 'ftt')) * pools;
  const conc = 1 + 24 * s.wet + 12 * s.ice; // drying and eutectic freezing concentrate monomers
  const clay = Math.pow(2, lv(s, 'clay'));
  const act = Math.pow(1.8, lv(s, 'imid'));
  const ext = 0.9 * s.nu * conc * clay * act; // extension propensity
  const hyd = 0.55 + 0.1 / (1 + s.wet * 4); // hydrolysis (slower when dry)
  const pTarget = ext / (ext + hyd);
  const poly = 0.02 * s.nu * conc * clay * act;
  const vesForm = 4 * Math.max(0, s.fa - 0.08) * clay * (1 + 2 * s.wet + 3 * s.ice);
  return { orgProd, nuProd, faProd, conc, pTarget, poly, vesForm, pools };
}

export function strandLength(p: number) {
  return 1 / (1 - Math.min(p, 0.9999));
}

/** Share of strands at least SPARK_LEN long (Flory distribution). */
export function longShare(p: number) {
  return Math.pow(p, SPARK_LEN - 1);
}

export function sparkRate(s: Act0State): { lambda: number; ready: boolean; chem: number } {
  const L = strandLength(s.p);
  const strands = (s.rna / L) * AVOGADRO_ML; // molecules
  const encaps = Math.min(1, s.ves / 400);
  const chem = strands * longShare(s.p) * encaps * 2e-19 * (1 + 2 * s.wet + 2 * s.ice); // per minute
  const ready = L >= 6 && s.ves >= 40 && s.rna > 0.05;
  // Pacing: the chance rises steadily the longer the spark is overdue, so it
  // lands inside a target window. The codex says plainly that this compresses
  // an extremely unlikely event.
  const ramp = ready ? Math.pow(s.overdue / 240, 2) * 0.6 : 0;
  return { lambda: chem + ramp, ready, chem };
}

/** Advance chemistry by dt seconds. Returns true if the spark fired. */
export function tick0(s: Act0State, dt: number, rng: Rng, allowSpark: boolean): boolean {
  s.time += dt;
  // Manual cycles
  if (s.cycleT > 0) {
    s.cycleT = Math.max(0, s.cycleT - dt);
    s.wet = Math.min(1, s.wet + dt * 0.9);
  } else s.wet *= Math.exp(-dt / 7);
  if (s.freezeT > 0) {
    s.freezeT = Math.max(0, s.freezeT - dt);
    s.ice = Math.min(1, s.ice + dt * 0.7);
  } else s.ice *= Math.exp(-dt / 9);
  if (lv(s, 'geyser') > 0) {
    s.autoT -= dt;
    if (s.autoT <= 0) {
      s.autoT = 6;
      startCycle(s, true);
      if (lv(s, 'ice') > 0 && s.freezeT <= 0) startFreeze(s, true);
    }
  }
  const sub = Math.max(1, Math.ceil(dt / 0.25));
  const h = dt / sub;
  for (let i = 0; i < sub; i++) {
    const r = rates0(s);
    const nuLoss = 0.012 * Math.pow(0.6, lv(s, 'borate'));
    s.org += h * (r.orgProd - 0.6 * (r.nuProd + r.faProd) * 2 - 0.004 * s.org);
    s.org = Math.max(0, s.org);
    s.nu += h * (r.nuProd - r.poly - nuLoss * s.nu + 0.04 * s.rna * (1 - s.p));
    s.nu = Math.max(0, s.nu);
    s.fa += h * (r.faProd - 0.01 * s.fa - 0.002 * r.vesForm);
    s.fa = Math.max(0, s.fa);
    s.rna += h * (r.poly - 0.04 * s.rna * (1 - s.p) - 0.002 * s.rna);
    s.rna = Math.max(0, s.rna);
    s.ves += h * (r.vesForm - 0.01 * s.ves);
    s.ves = Math.max(0, s.ves);
    s.p += (r.pTarget - s.p) * (1 - Math.exp(-h / 4));
  }
  const sp = sparkRate(s);
  if (sp.ready) s.overdue += dt;
  if (allowSpark && sp.ready && rng.chance(sp.lambda / 60, dt)) {
    s.sparked = true;
    return true;
  }
  return false;
}

export function startCycle(s: Act0State, auto = false) {
  if (s.cycleT > 0) return;
  s.cycleT = 3;
  s.cycles++;
  if (!auto) s.wet = Math.min(1, s.wet + 0.15);
}

export function startFreeze(s: Act0State, auto = false) {
  if (lv(s, 'ice') <= 0 || s.freezeT > 0) return;
  s.freezeT = 4;
  s.freezes++;
  if (!auto) s.ice = Math.min(1, s.ice + 0.15);
}

export function canAfford0(s: Act0State, u: Act0Upgrade): boolean {
  const l = lv(s, u.id);
  if (l >= u.levels) return false;
  if (u.needs && lv(s, u.needs) <= 0) return false;
  const c = upgradeCost(u, l);
  return s.org >= c.org && s.nu >= c.nu && s.fa >= c.fa;
}

export function buy0(s: Act0State, id: string): boolean {
  const u = ACT0_UPGRADES.find((x) => x.id === id);
  if (!u || !canAfford0(s, u)) return false;
  const c = upgradeCost(u, lv(s, u.id));
  s.org -= c.org;
  s.nu -= c.nu;
  s.fa -= c.fa;
  s.up[u.id] = lv(s, u.id) + 1;
  s.bought++;
  return true;
}

export function molecules0(s: Act0State): number {
  return (s.org + s.nu + s.fa + s.rna) * AVOGADRO_ML;
}

/** A deterministic sample of the random RNA library for display. */
export function sampleStrands(s: Act0State, n: number, rng: Rng): string[] {
  const out: string[] = [];
  const letters = 'ACGU';
  for (let i = 0; i < n; i++) {
    // Flory: P(length = L) = (1-p) p^(L-1)
    let L = 1;
    while (rng.next() < s.p && L < 64) L++;
    let str = '';
    for (let k = 0; k < L; k++) str += letters[rng.int(4)];
    out.push(str);
  }
  return out;
}
