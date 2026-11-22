// Finale: the biosphere. A closed carbon loop (producers, consumers,
// microbes, viruses, detritus, CO2) with oxygen as the mirror of carbon
// fixation and a nitrogen budget kept by fixation versus denitrification.
// Light is the only input. You win by holding every quantity inside its band.
import type { Rng } from './rng';

export interface FinaleTrait {
  id: string;
  guild: 'producers' | 'consumers' | 'microbes' | 'viruses';
  name: string;
  text: string;
  cost: number;
  levels: number;
  growth: number;
  effects: Record<string, number>; // multiplicative on params
  card: string;
}

export const FINALE_TRAITS: FinaleTrait[] = [
  { id: 'f-stoma', guild: 'producers', name: 'Stomatal control', text: 'Pores open wider when CO₂ is plentiful and close when it is scarce: fixation tracks CO₂, pulling it back toward balance', cost: 50, levels: 3, growth: 2.3, effects: { co2fb: 0.5 }, card: 'stomata' },
  { id: 'f-ccm', guild: 'producers', name: 'Carbon-concentrating mechanism', text: 'Pumps bicarbonate to RuBisCO so producers survive CO₂ dips (kC ×0.85)', cost: 80, levels: 2, growth: 2.5, effects: { kC: 0.85 }, card: 'ccm' },
  { id: 'f-myco', guild: 'producers', name: 'Mycorrhizal partners', text: 'Fungal threads trade nitrogen for sugar: producers need less free N (kN ×0.75)', cost: 110, levels: 2, growth: 2.6, effects: { kN: 0.75 }, card: 'mycorrhiza' },
  { id: 'f-satiate', guild: 'consumers', name: 'Predator satiation', text: 'Grazers eat less when full: grazing saturates sooner, which damps boom-and-bust cycles', cost: 60, levels: 3, growth: 2.3, effects: { hP: 1.25, aC: 1.12 }, card: 'functional-response' },
  { id: 'f-refuge', guild: 'consumers', name: 'Prey refuges', text: 'Some producers hide where grazers cannot reach: grazing ignores a protected stock', cost: 90, levels: 2, growth: 2.5, effects: { refuge: 0.12 }, card: 'refuges' },
  { id: 'f-territory', guild: 'consumers', name: 'Territoriality', text: 'Crowded consumers die faster: self-limitation keeps grazing in check', cost: 100, levels: 2, growth: 2.6, effects: { selfC: 1 }, card: 'self-limitation' },
  { id: 'f-nfix', guild: 'microbes', name: 'Nitrogenase switch-off', text: 'Fixers shut nitrogenase down when ammonium is plentiful, as nif genes do: fixed N holds near its set point', cost: 60, levels: 3, growth: 2.3, effects: { nreg: 1.5 }, card: 'heterocysts' },
  { id: 'f-decomp', guild: 'microbes', name: 'Lignin-degrading fungi', text: 'Detritus recycles faster: decomposition ×1.4', cost: 80, levels: 2, growth: 2.5, effects: { rM: 1.4 }, card: 'decomposers' },
  { id: 'f-denit', guild: 'microbes', name: 'Anammox balance', text: 'Nitrogen loss speeds up only when nitrate is in excess', cost: 100, levels: 2, growth: 2.6, effects: { dreg: 1 }, card: 'nitrogen-cycle' },
  { id: 'f-lysogeny', guild: 'viruses', name: 'Lysogeny', text: 'Viruses hide in host genomes when hosts are scarce: they persist through crashes and burst less violently', cost: 60, levels: 2, growth: 2.5, effects: { dV: 0.8, vir: 0.9 }, card: 'lysogeny' },
  { id: 'f-ktw', guild: 'viruses', name: 'Kill the winner', text: 'Viruses specialise on the commonest host: blooms are cut down, diversity kept', cost: 90, levels: 2, growth: 2.5, effects: { ktw: 1.6 }, card: 'kill-the-winner' },
  { id: 'f-shunt', guild: 'viruses', name: 'Viral shunt', text: 'Lysed cells feed microbes directly: nutrients recycle near the surface', cost: 120, levels: 1, growth: 1, effects: { shunt: 1 }, card: 'viral-shunt' },
];

export interface FinaleChallenge {
  id: string;
  name: string;
  text: string;
  mods: Record<string, number>;
  swing?: { key: string; period: number; amp: number };
}

export const FINALE_CHALLENGES: FinaleChallenge[] = [
  { id: 'c-temp', name: 'Temperature swings', text: 'Warm and cold eras alternate: every rate swings ±35% on a 4-minute cycle.', mods: {}, swing: { key: 'temp', period: 240, amp: 0.35 } },
  { id: 'c-starve', name: 'Starvation', text: 'A dimmer young Sun: light ×0.65.', mods: { light: 0.65 } },
  { id: 'c-acid', name: 'Acid oceans', text: 'Shells and enzymes suffer: consumer and microbe deaths ×1.5.', mods: { dC: 1.5, dM: 1.5 } },
  { id: 'c-o2crash', name: 'Oxygen crashes', text: 'Volcanic sinks pull oxygen down in sudden pulses.', mods: { o2sink: 1 } },
];

export interface FinaleState {
  time: number;
  Pr: number;
  Co: number;
  Mi: number;
  Vi: number;
  De: number;
  CO2: number;
  O2: number;
  N: number;
  stable: number; // current streak (s)
  best: number;
  won: boolean;
  traits: Record<string, number>;
  nextPerturb: number;
  perturb: { id: string; until: number; text: string } | null;
  challenge: string | null;
  challengeBest: Record<string, number>;
  variation: number;
  hist: number[][]; // [t, Pr, Co, Mi, Vi, CO2, O2, N]
  /** Species from your World still alive when the finale began (missing ones make it harder). */
  roster?: string[];
}

/**
 * What each species you raised does for the biosphere, and what its absence
 * costs. Multipliers on finale parameters when the species is missing.
 */
export const ROSTER_ROLES: { id: string; role: string; missing: Record<string, number> }[] = [
  { id: 'ferm', role: 'Ferments sugars in the mud', missing: { rM: 0.9 } },
  { id: 'archaea', role: 'Finish anaerobic decay as methane', missing: { rM: 0.85 } },
  { id: 'lact', role: 'Recycle fermentation acids', missing: { rM: 0.92 } },
  { id: 'debris', role: 'Break down dead cells', missing: { rM: 0.85 } },
  { id: 'photo', role: 'Cyanobacteria: fix nitrogen and carbon', missing: { fN: 0.55, rP: 0.92 } },
  { id: 'resp', role: 'Breathe oxygen, return CO₂', missing: { eM: 0.85 } },
  { id: 'euk', role: 'Single-celled grazers', missing: { aC: 0.9 } },
  { id: 'alga', role: 'Algae: most of the ocean’s photosynthesis', missing: { rP: 0.8 } },
  { id: 'hunter', role: 'Hunters keep algae in check', missing: { aC: 0.75 } },
  { id: 'body', role: 'Seaweed or animals: big, slow buffers', missing: { Kp: 0.85, selfC: 1 } },
];

export const WIN_SECONDS = 300;

export const BANDS: Record<string, [number, number]> = {
  CO2: [0.5, 2.0],
  O2: [0.5, 1.8],
  N: [0.35, 3.0],
  Pr: [0.4, 6],
  Co: [0.04, 3],
  Mi: [0.08, 3],
  Vi: [0.01, 4],
};

export function newFinale(): FinaleState {
  return {
    time: 0,
    Pr: 1.4,
    Co: 0.45,
    Mi: 0.6,
    Vi: 0.08,
    De: 0.45,
    CO2: 1.0,
    O2: 1.0,
    N: 0.8,
    stable: 0,
    best: 0,
    won: false,
    traits: {},
    nextPerturb: 75,
    perturb: null,
    challenge: null,
    challengeBest: {},
    variation: 30,
    hist: [],
  };
}

const ADDITIVE = new Set(['co2fb', 'refuge', 'nreg', 'dreg']);

export function finaleParams(s: FinaleState) {
  const p: Record<string, number> = {
    rP: 0.5, kC: 0.6, kN: 0.45, Kp: 6, rp: 0.03, dP: 0.02,
    aC: 0.2, hP: 0.8, eC: 0.5, rc: 0.025, dC: 0.025, selfC: 0,
    rM: 0.3, kD: 0.5, eM: 0.3, dM: 0.04,
    vir: 0.32, burst: 1, dV: 0.12, ktw: 1, shunt: 0,
    fN: 0.06, den: 0.02, nR: 0.25, light: 1, temp: 1, o2sink: 0,
    co2fb: 0, refuge: 0, nreg: 0, dreg: 0,
  };
  for (const t of FINALE_TRAITS) {
    const l = s.traits[t.id] ?? 0;
    for (const [k, m] of Object.entries(t.effects)) {
      if (k === 'shunt') p.shunt = l > 0 ? 1 : 0;
      else if (k === 'selfC') p.selfC += 0.015 * l * m;
      else if (ADDITIVE.has(k)) p[k] += m * l;
      else p[k] *= Math.pow(m, l);
    }
  }
  if (s.roster) {
    for (const r of ROSTER_ROLES) {
      if (s.roster.includes(r.id)) continue;
      for (const [k, m] of Object.entries(r.missing)) p[k] = k === 'selfC' ? p[k] + 0.01 * m : p[k] * m;
    }
  }
  const ch = FINALE_CHALLENGES.find((c) => c.id === s.challenge);
  if (ch) {
    for (const [k, m] of Object.entries(ch.mods)) p[k] = k === 'o2sink' ? m : p[k] * m;
    if (ch.swing) p.temp = 1 + ch.swing.amp * Math.sin((2 * Math.PI * s.time) / ch.swing.period);
  }
  return p;
}

export function lightAt(s: FinaleState, p: Record<string, number>) {
  let I = (0.75 + 0.25 * Math.sin((2 * Math.PI * s.time) / 120)) * p.light;
  if (s.perturb?.id === 'cold') I *= 0.5;
  return I;
}

function deriv(s: FinaleState, p: Record<string, number>, I: number) {
  const T = p.temp;
  const co2resp = Math.pow(Math.max(s.CO2, 1e-6), p.co2fb);
  const gP = p.rP * T * I * s.Pr * (s.CO2 / (p.kC + s.CO2)) * (s.N / (p.kN + s.N)) * Math.max(0, 1 - s.Pr / p.Kp) * co2resp;
  const avail = Math.max(0, s.Pr - p.refuge);
  const G = p.aC * T * s.Co * (avail / (p.hP + avail));
  const Dm = p.rM * T * s.Mi * (s.De / (p.kD + s.De));
  const tot = s.Pr + s.Mi + 1e-9;
  // Kill the winner: lysis concentrates on the more common host
  const wP = Math.pow(s.Pr / tot, p.ktw);
  const wM = Math.pow(s.Mi / tot, p.ktw);
  const shareP = wP / (wP + wM);
  const shareM = wM / (wP + wM);
  // Most viruses are phages: microbes carry most of the infection load.
  const Lp = 0.15 * p.vir * s.Vi * s.Pr * shareP;
  const Lm = p.vir * s.Vi * s.Mi * shareM;
  const respP = p.rp * s.Pr;
  const respC = p.rc * s.Co;
  const deathC = (p.dC + p.selfC * s.Co) * s.Co;
  const respM = (1 - p.eM) * Dm;
  const nfix = (p.fN * T * s.Mi) / (1 + s.O2 / 1.2) / (1 + p.nreg * Math.pow(s.N / 0.9, 3));
  const shuntToMi = p.shunt ? 0.35 * (Lp + Lm) : 0;
  const d = {
    Pr: gP - G - p.dP * s.Pr - respP - Lp,
    Co: p.eC * G - respC - deathC,
    Mi: p.eM * Dm - p.dM * s.Mi - Lm + shuntToMi * p.eM,
    Vi: p.burst * 0.9 * (Lp + Lm) - p.dV * s.Vi,
    De: p.dP * s.Pr + deathC + (1 - p.eC) * G + p.dM * s.Mi + (Lp + Lm) - shuntToMi - Dm,
    // Silicate weathering slowly pulls CO2 back toward its long-run level.
    CO2: -gP + respP + respC + respM + shuntToMi * (1 - p.eM) - 0.006 * (s.CO2 - 1),
    O2: 0,
    // Respiration and decay both release the nitrogen that fixation locked up.
    N: p.nR * (respP + respC + Dm - gP) + nfix - p.den * s.N * (1 + p.dreg * Math.max(0, s.N - 1.2)),
  };
  const bioCO2 = d.CO2 + 0.006 * (s.CO2 - 1);
  d.O2 = -bioCO2 * 0.9 - p.o2sink * 0.004 - 0.01 * (s.O2 - 1);
  return d;
}

const KEYS = ['Pr', 'Co', 'Mi', 'Vi', 'De', 'CO2', 'O2', 'N'] as const;

export function inBands(s: FinaleState): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [k, [lo, hi]] of Object.entries(BANDS)) {
    const v = (s as unknown as Record<string, number>)[k];
    out[k] = v >= lo && v <= hi;
  }
  return out;
}

const PERTURBS = [
  { id: 'volcano', text: 'A volcanic outgassing pulse floods the air with CO₂' },
  { id: 'cold', text: 'A cold snap: sunlight reaching the surface halves for a while' },
  { id: 'bloom', text: 'A virus bloom sweeps the oceans' },
  { id: 'washout', text: 'Floods wash fixed nitrogen out to sea' },
  { id: 'die-off', text: 'A grazer die-off: consumer numbers crash' },
];

export function tickFinale(s: FinaleState, dt: number, rng: Rng): { events: string[] } {
  const events: string[] = [];
  const sub = Math.max(1, Math.ceil(dt / 0.2));
  const h = dt / sub;
  for (let i = 0; i < sub; i++) {
    const p = finaleParams(s);
    const I = lightAt(s, p);
    const d = deriv(s, p, I);
    for (const k of KEYS) {
      const v = (s as unknown as Record<string, number>)[k] + h * (d as Record<string, number>)[k];
      (s as unknown as Record<string, number>)[k] = Math.max(1e-6, v);
    }
    s.time += h;
  }
  if (s.perturb && s.time > s.perturb.until) s.perturb = null;
  if (s.time >= s.nextPerturb) {
    const pk = rng.pick(PERTURBS);
    s.perturb = { id: pk.id, until: s.time + 40, text: pk.text };
    if (pk.id === 'volcano') s.CO2 += 0.9;
    if (pk.id === 'bloom') s.Vi *= 3;
    if (pk.id === 'washout') s.N *= 0.45;
    if (pk.id === 'die-off') s.Co *= 0.6;
    const ch = FINALE_CHALLENGES.find((c) => c.id === s.challenge);
    if (ch?.mods.o2sink) s.O2 *= 0.6;
    s.nextPerturb = s.time + rng.range(60, 100);
    events.push(pk.text);
  }
  const ok = Object.values(inBands(s)).every(Boolean);
  if (ok) s.stable += dt;
  else s.stable = 0;
  s.best = Math.max(s.best, s.stable);
  if (s.challenge) s.challengeBest[s.challenge] = Math.max(s.challengeBest[s.challenge] ?? 0, s.stable);
  // Diversity earns Variation: Shannon diversity of the four guilds
  const g = [s.Pr, s.Co, s.Mi, s.Vi];
  const tot = g.reduce((a, b) => a + b, 0);
  const H = -g.reduce((a, x) => a + (x / tot) * Math.log(x / tot + 1e-12), 0);
  s.variation += dt * 0.45 * H;
  if (s.hist.length === 0 || s.time - s.hist[s.hist.length - 1][0] >= 1) {
    s.hist.push([s.time, s.Pr, s.Co, s.Mi, s.Vi, s.CO2, s.O2, s.N]);
    if (s.hist.length > 400) s.hist.splice(0, s.hist.length - 400);
  }
  return { events };
}

export function traitCost(t: FinaleTrait, level: number) {
  return t.cost * Math.pow(t.growth, level);
}
