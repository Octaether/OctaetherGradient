// The game: acts, populations, evolution, currencies, unlocks, saves.
// Pure TypeScript, no DOM. Runs in a Web Worker in the game and in Node for
// tests and headless bot runs. The UI sends commands and renders snapshots.
//
// Sections of the Game class, in order:
//   helpers        flags, levels, world effects, genome limits, parameters, growth tables
//   act setup      initAct: a fresh population, environment and niches for an act
//   conditions     stat() and evalCond(): what gates, unlocks and events test
//   main tick      tick → tickAct → stepPopulation (replicator dynamics, currencies)
//   unlocks …      unlocks, timed events, crashes and their diagnosis
//   evolution      the cassette, buy(), recombination, background mutations, policies, niches
//   gates …        act transitions
//   commands       command(): every message the UI can send
//   offline        progress while the tab was closed
//   snapshot       snapshot(): the read-only view sent to the UI
// Saved state lives in state.ts, growth-table maths in growth.ts.
import {
  carrierFlux,
  compile,
  controlCoefficients,
  energyCharge,
  integrate,
  paramsFor,
  rates,
  setEnv,
  steadyState,
  type Compiled,
  type Params,
} from './cell';
import { Decimal, dec, roman } from './num';
import { Rng } from './rng';
import { FOOD_GRID, clamp, dequant, foodIndex, interp, quant, type Table, type TablePt } from './growth';
import { FINALE_INDEX, migrate, newState, type ActState, type GameState, type Lineage } from './state';
import {
  ACT0_UPGRADES,
  buy0,
  canAfford0,
  longShare,
  molecules0,
  newAct0,
  rates0,
  sampleStrands,
  sparkRate,
  startCycle,
  startFreeze,
  strandLength,
  tick0,
  upgradeCost,
} from './act0';
import {
  BANDS,
  ROSTER_ROLES,
  FINALE_CHALLENGES,
  FINALE_TRAITS,
  WIN_SECONDS,
  finaleParams,
  inBands,
  lightAt,
  newFinale,
  tickFinale,
  traitCost,
} from './finale';
import {
  GUILDS,
  GUILD_ORDER,
  LAYER_NAMES,
  PROTAGONIST,
  WORLD_TRAITS,
  alive as guildAlive,
  coexisting,
  found,
  guild as guildOf,
  layerO2,
  protBiomass,
  seedWorld,
  syntrophyBoost,
  tickWorld,
  traitCost as worldTraitCost,
  type GuildId,
  type WorldCtx,
  type WorldTrait,
} from './world';
import { ACHIEVEMENTS, CHALLENGES, achievementBonus, type AchView } from './achievements';
import type { ActSpec, AdaptationSpec, Condition, Effect, Genotype, Mutation } from './types';
import type {
  AdvanceSnap,
  AlertSnap,
  CellSnap,
  ChoreItem,
  Command,
  ExperimentResult,
  GameEvent,
  GateSnap,
  GenomeSnap,
  LineageSnap,
  NicheItem,
  ShopItem,
  Snapshot,
  WorldGaugeSnap,
  WorldSnap,
  WorldTraitItem,
} from './snapshot';

const MAX_LINEAGES = 12;

/** Finale parameters in words, for what a missing species costs. */
const ROSTER_PARAM: Record<string, string> = { rM: 'decay', fN: 'nitrogen fixing', rP: 'photosynthesis', eM: 'microbe efficiency', aC: 'grazing', Kp: 'producer room', selfC: 'consumers' };

/** What a community trait is waiting for, in words. */
const TRAIT_HINT: Record<string, string> = {
  ldh: 'Appears once your fermenters make lactate',
  heterotrophy: 'Appears once your cells eat sugar',
  plastid: 'Appears once a captive cyanobacterium survives',
};

interface LineageRt {
  key: string;
  table: Table | null;
  params: Params | null;
}

export interface ActsProvider {
  acts: Record<number, ActSpec>;
}

export class Game {
  s: GameState;
  acts: Record<number, ActSpec>;
  rng: Rng;
  rt = new Map<number, LineageRt>();
  events: GameEvent[] = [];
  fluxHist: number[] = [];
  pm: { t: number; pools: Record<string, number> }[] = [];
  experiments: ExperimentResult[] = [];
  speed = 1;
  private live: {
    key: string;
    c: Compiled;
    s: Float64Array;
    control: Record<string, number>;
    controlAt: number;
    lid: number;
  } | null = null;
  private derived: {
    mu: number;
    delta: number;
    growth: number;
    ec: number;
    flux: number;
    fluxPerCell: number;
    vIncome: number;
    bIncome: Decimal;
    perLineage: Map<number, { mu: number; delta: number; dormant: boolean; ec: number; carrier: number; pt: TablePt }>;
    occupancy: number;
  } = { mu: 0, delta: 0, growth: 0, ec: 1, flux: 0, fluxPerCell: 0, vIncome: 0, bIncome: dec(0), perLineage: new Map(), occupancy: 0 };
  private alert: AlertSnap | null = null;
  private condTimer = 0;
  private policyTimer = 0;
  private bgTimer = 0;
  private snapTimer = 0;
  private lastSig = '';
  private sendHistory = true;
  private expId = 1;
  private act0Strands: string[] = [];
  private strandTimer = 0;
  private sparkT = 0;
  private devGate = false;
  private _P: Decimal = dec(0);
  private _biomass: Decimal = dec(0);
  private _dead: Decimal = dec(0);
  /** The World's effect on the act's species: growth multiplier and extra deaths per second. */
  private worldMu = 1;
  private worldDelta = 0;
  private achTimer = 0;
  private trendRef: Record<string, { t: number; B: number }> = {};

  constructor(acts: Record<number, ActSpec>, save?: GameState | null, seed = Date.now() % 1e9) {
    this.acts = acts;
    this.s = save ? migrate(save) : newState(seed);
    this.rng = new Rng(this.s.rng || this.s.seed);
    if (this.s.a) this.loadDecimals();
    // saves from before the World: give them the community their act expects
    if (this.s.a && this.s.act >= 3 && this.s.act < FINALE_INDEX && !this.s.world) {
      this.s.world = seedWorld(this.s.act);
      this.worldActStart(this.s.act);
    }
  }

  // ---------- helpers ----------
  get act(): ActSpec | null {
    return this.s.act >= 1 && this.s.act < FINALE_INDEX ? this.acts[this.s.act] ?? null : null;
  }
  private loadDecimals() {
    const a = this.s.a!;
    this._P = dec(a.P);
    this._biomass = dec(a.biomass);
    this._dead = dec(a.dead);
  }
  private storeDecimals() {
    const a = this.s.a;
    if (!a) return;
    a.P = this._P.toString();
    a.biomass = this._biomass.toString();
    a.dead = this._dead.toString();
  }
  private emit(e: GameEvent) {
    this.events.push(e);
    if (this.events.length > 60) this.events.splice(0, this.events.length - 60);
  }
  private hasFlag(f: string) {
    return this.s.a?.flags.includes(f) ?? false;
  }
  private addFlag(f: string) {
    const a = this.s.a!;
    if (!a.flags.includes(f)) a.flags.push(f);
  }

  foodKey(): { key: string; foodIn: number } {
    const act = this.act!;
    let key = act.food;
    let foodIn = act.foodIn;
    for (const sw of act.foodSwitch ?? []) {
      if (this.hasFlag(sw.flag)) {
        key = sw.food;
        foodIn = sw.foodIn;
      }
    }
    return { key, foodIn };
  }

  private lineage(id: number): Lineage | undefined {
    return this.s.a?.lineages.find((l) => l.id === id);
  }
  dominant(): Lineage {
    const a = this.s.a!;
    let best = a.lineages[0];
    for (const l of a.lineages) if (l.freq > best.freq) best = l;
    return best;
  }
  private level(l: Lineage, id: string) {
    let n = 0;
    for (const m of l.muts) if (m.adaptation === id) n++;
    return n;
  }
  private has(l: Lineage, id: string) {
    return l.muts.some((m) => m.adaptation === id);
  }
  private automated(choreId: string): boolean {
    const act = this.act;
    if (!act) return false;
    const ch = act.chores.find((c) => c.id === choreId);
    if (!ch) return false;
    return this.has(this.dominant(), ch.automatedBy);
  }

  /** Effects applied to every lineage: chores done by hand. */
  private worldEffects(): Effect[] {
    const act = this.act!;
    const a = this.s.a!;
    const out: Effect[] = [];
    for (const ch of act.chores) {
      if (ch.needsFlag && !a.flags.includes(ch.needsFlag)) continue;
      const v = a.chores[ch.id];
      if (ch.control === 'choice') {
        const chosen = (v as string[]) ?? [];
        for (const o of ch.options ?? []) if (chosen.includes(o.id)) out.push(...o.effects);
      } else if (ch.control === 'toggle') {
        if (this.automated(ch.id)) continue;
        const o = ch.options?.find((x) => x.id === v) ?? ch.options?.[0];
        if (o) out.push(...o.effects);
      } else if (ch.control === 'slider' && ch.param) {
        if (this.automated(ch.id)) continue;
        out.push({ type: 'param', key: ch.param, set: typeof v === 'number' ? v : 0.5 });
      }
    }
    return out;
  }

  private envForCompile(): Record<string, number> {
    const a = this.s.a!;
    const { key } = this.foodKey();
    const env: Record<string, number> = {};
    for (const [k, v] of Object.entries(a.env)) env[k] = k === key ? v : dequant(quant(v));
    return env;
  }

  private worldSig(): string {
    const a = this.s.a!;
    const { key } = this.foodKey();
    const envq = Object.entries(a.env)
      .filter(([k]) => k !== key)
      .map(([k, v]) => k + quant(v))
      .join(',');
    const chores = JSON.stringify(this.worldEffects());
    return [a.flags.slice().sort().join(','), envq, chores, a.fidelity.toFixed(2), key].join('|');
  }

  /** Genome-derived globals for a lineage (act-specific rules). */
  private genomeInfo(p: Params) {
    const act = this.act!;
    const a = this.s.a!;
    const g = act.genome ?? { copyCap: 99 };
    if (act.index === 1) {
      const L = (g.baseLen ?? 45) + (p.globals.L ?? 0);
      const epsMin = (g.epsMin ?? 0.03) * (p.globals.eps ?? 1);
      const eps = epsMin * a.fidelity;
      const U = eps * L;
      const Lmax = Math.log(10) / epsMin;
      return { U, L, eps, epsMin, Lmax, functional: Math.exp(-U), errorRatio: L / Lmax, copyCap: Lmax, used: L };
    }
    const U = act.pacing.U * (p.globals.U ?? 1) * a.fidelity;
    return { U, L: 0, eps: 0, epsMin: 0, Lmax: 0, functional: 1, errorRatio: 0, copyCap: g.copyCap + (p.globals.copyCap ?? 0), used: 0 };
  }

  private slotsUsed(l: Lineage, p: Params): number {
    const act = this.act!;
    let used = 0;
    for (const r of act.network.reactions) {
      if (!r.gene) continue;
      if (r.requires && !p.flags.has(r.requires)) continue;
      if (r.hiddenIf && p.flags.has(r.hiddenIf)) continue;
      used += r.slots ?? 1;
    }
    for (const m of l.muts) {
      const ad = act.adaptations.find((x) => x.id === m.adaptation);
      if (ad?.slots && ad.kind !== 'gene') used += ad.slots;
    }
    return used;
  }

  private energyCap(p: Params, carrier: number): number {
    const act = this.act!;
    const g = act.genome;
    if (!g?.energyCap) return Infinity;
    const ref = this.s.a!.ref.carrier || 1;
    return g.energyCap * Math.sqrt(Math.max(carrier, 1e-9) / ref) * (p.globals.energyPerGene ?? 1);
  }

  private paramsOf(l: Lineage, extra: Effect[] = []): Params {
    const act = this.act!;
    const g: Genotype = { muts: [...l.muts, { id: 'world', label: 'world', effects: this.worldEffects() }, { id: 'x', label: 'x', effects: extra }] };
    const p = paramsFor(act.network, g, this.s.a!.flags);
    this.finishParams(p);
    return p;
  }

  /** Act-specific derived globals (fidelity, body plan). */
  finishParams(p: Params) {
    const act = this.act!;
    p.globals.functional = this.genomeInfo(p).functional;
    if (act.index === 7) {
      const g = p.globals;
      const size = g.size ?? 4;
      let aFeed = g.aFeed ?? 0.5;
      let aTrans = g.aTrans ?? 0;
      let aGerm = g.aGerm ?? 0.5;
      if (!p.flags.has('types')) {
        aFeed = 0.5;
        aTrans = 0;
        aGerm = 0.5;
      }
      if (g.grn) {
        aTrans = clamp(0.045 * Math.log2(size), 0, 0.32);
        aFeed = (1 - aTrans) * 0.56;
        aGerm = 1 - aTrans - aFeed;
      }
      g.coord = (g.coordBase ?? 1) * (g.grn ? 1.1 : 1);
      g.feeders = 2 * aFeed;
      g.diffusion = ((g.o2carry ?? 1) * (1 + 3 * aTrans)) / Math.cbrt(size);
      g.germ = 2 * aGerm * (g.germBonus ?? 1);
      g.soma = Math.pow(size, 0.2) * (g.aging ?? 1);
      g.predation = 1 / (1 + Math.pow(size / 12, 0.8));
      g.cheat = p.flags.has('cheaters') ? 0.35 * (g.cheatMul ?? 1) * Math.min(1, size / 8) : 0;
    }
  }

  private keyOf(l: Lineage): string {
    return l.muts.map((m) => m.id).join(',') + '#' + this.lastSig;
  }

  private overflowPenalty(l: Lineage, p: Params, carrier: number): number {
    const gi = this.genomeInfo(p);
    if (this.act!.index === 1) return 1;
    const used = this.slotsUsed(l, p);
    const cap = Math.min(gi.copyCap, this.energyCap(p, carrier));
    const over = Math.max(0, used - cap);
    return Math.exp(-0.12 * over);
  }

  private computeTable(l: Lineage, p: Params): Table {
    const act = this.act!;
    const { key, foodIn } = this.foodKey();
    const env = this.envForCompile();
    const foods = FOOD_GRID.map((f) => f * foodIn);
    const pts: TablePt[] = new Array(foods.length);
    let prev: Float64Array | null = null;
    // First pass at reference food to get carrier for the energy ceiling.
    const refC = compile(act.network, p, { ...env, [key]: foodIn });
    const refSS = steadyState(refC.c, refC.s);
    const vScale = this.overflowPenalty(l, p, carrierFlux(refC.c, refSS.v));
    prev = refSS.s;
    const dyn = Object.keys(act.envDyn ?? {});
    for (let i = foods.length - 1; i >= 0; i--) {
      const { c, s } = compile(act.network, p, { ...env, [key]: foods[i] }, prev, vScale);
      const ss = steadyState(c, s);
      prev = ss.s;
      let uptake = 0;
      const bflux: Record<string, number> = {};
      const bi = foodIndex(c, key);
      for (let j = 0; j < c.rx.length; j++) {
        const r = c.rx[j];
        for (let k = 0; k < r.sub.length; k++) {
          const ref = r.sub[k];
          if (ref < 0) {
            const b = -1 - ref;
            if (b === bi) uptake += r.subSto[k] * ss.v[j];
            const id = c.bIds[b];
            if (dyn.includes(act.network.species.find((sp) => sp.id === id)?.env ?? id)) {
              const ek = act.network.species.find((sp) => sp.id === id)?.env ?? id;
              bflux[ek] = (bflux[ek] ?? 0) - r.subSto[k] * ss.v[j];
            }
          }
        }
        for (let k = 0; k < r.prod.length; k++) {
          const ref = r.prod[k];
          if (ref < 0) {
            const b = -1 - ref;
            if (b === bi) uptake -= r.prodSto[k] * ss.v[j];
            const id = c.bIds[b];
            const ek = act.network.species.find((sp) => sp.id === id)?.env ?? id;
            if (dyn.includes(ek)) bflux[ek] = (bflux[ek] ?? 0) + r.prodSto[k] * ss.v[j];
          }
        }
      }
      let dmg = 0;
      for (const d of act.damage ?? []) {
        if (d.rxn && c.rIndex[d.rxn] !== undefined) dmg += d.k * Math.max(0, ss.v[c.rIndex[d.rxn]]);
        if (d.species && c.index[d.species] !== undefined) dmg += d.k * ss.s[c.index[d.species]];
        if (d.param) dmg += d.k * (p.globals[d.param] ?? 0);
      }
      pts[i] = { mu: ss.mu, carrier: carrierFlux(c, ss.v), ec: energyCharge(c, ss.s), uptake: Math.max(0, uptake), dmg, bflux };
    }
    return { foods, pts };
  }

  private ensureTables(budgetMs: number) {
    const a = this.s.a!;
    const sig = this.worldSig();
    if (sig !== this.lastSig) this.lastSig = sig;
    const t0 = Date.now();
    // Dominant first, then the rest
    const order = [...a.lineages].sort((x, y) => y.freq - x.freq);
    for (const l of order) {
      const key = this.keyOf(l);
      let rt = this.rt.get(l.id);
      if (rt && rt.key === key && rt.table) continue;
      if (Date.now() - t0 > budgetMs && rt?.table) continue;
      const p = this.paramsOf(l);
      const table = this.computeTable(l, p);
      rt = { key, table, params: p };
      this.rt.set(l.id, rt);
    }
  }

  private tableOf(l: Lineage): Table | null {
    let rt = this.rt.get(l.id);
    if (rt?.table) return rt.table;
    // fall back to parent
    let cur: Lineage | undefined = l;
    while (cur) {
      rt = this.rt.get(cur.parent);
      if (rt?.table) return rt.table;
      cur = this.lineage(cur.parent);
    }
    return null;
  }

  // ---------- act setup ----------
  private initAct(index: number) {
    if (index === 0) {
      this.s.act0 = newAct0();
      this.s.a = null;
      return;
    }
    if (index >= FINALE_INDEX) {
      this.s.a = null;
      this.s.finale = newFinale();
      this.s.finale.variation = 40 * this.s.evolvability;
      // the finale's species are the ones you kept alive
      this.s.world ??= seedWorld(FINALE_INDEX);
      this.s.finale.roster = this.s.world.guilds.filter((g) => g.alive).map((g) => g.id);
      return;
    }
    const act = this.acts[index];
    const a: ActState = {
      index,
      time: 0,
      P: '2000',
      biomass: '0',
      dead: '0',
      variation: 4,
      block: 0,
      env: { ...act.env },
      envMul: {},
      sink: {},
      lineages: [{ id: 1, parent: 0, name: 'Founders', muts: [], freq: 1, born: 0, color: 0 }],
      nextId: 2,
      selected: 1,
      viewed: 1,
      niches: {},
      flags: [],
      chores: {},
      strikes: {},
      fired: [],
      timers: {},
      history: [],
      histDt: 1,
      histNext: 0,
      fidelity: 1,
      snapshots: [],
      ref: { mu: 1, u: 1, carrier: 1 },
      stats: { sweeps: 0, purchases: 0, crashes: 0, maxFlux: 0 },
      dominantId: 1,
      crashed: false,
      goe: 0,
      colorNext: 1,
    };
    for (const ch of act.chores) {
      a.chores[ch.id] = ch.control === 'choice' ? [] : ch.control === 'slider' ? 0.5 : ch.options?.[0]?.id ?? '';
    }
    for (const [k, d] of Object.entries(act.envDyn ?? {})) if (d.sink) a.sink[k] = d.sink.capacity;
    this.s.a = a;
    this.rt.clear();
    this.live = null;
    this.loadDecimals();
    // Reference growth: the founding genotype at full food.
    const { key, foodIn } = this.foodKey();
    const p = paramsFor(act.network, { muts: [{ id: 'w', label: 'w', effects: this.worldEffects() }] }, a.flags);
    this.finishParams(p);
    const { c, s } = compile(act.network, p, { ...a.env, [key]: foodIn });
    const ss = steadyState(c, s);
    let u = 0;
    const bi = foodIndex(c, key);
    c.rx.forEach((r, j) => r.sub.forEach((ref, k) => ref < 0 && -1 - ref === bi && (u += r.subSto[k] * ss.v[j])));
    a.ref = { mu: Math.max(ss.mu, 1e-9), u: Math.max(u, 1e-9), carrier: Math.max(carrierFlux(c, ss.v), 1e-9) };
    a.env[key] = foodIn;
    this.fluxHist = [];
    this.pm = [];
    this.sendHistory = true;
    this.worldMu = 1;
    this.worldDelta = 0;
    for (const k of ['errPeak', 'acidPeak', 'partnerMin', 'calmT']) delete this.s.records[k];
    if (index >= 3) this.worldActStart(index);
  }

  // ---------- the World ----------
  /** Each act from III on: the community carries on, and this act's species comes into focus. */
  private worldActStart(index: number) {
    this.s.world ??= seedWorld(index);
    const w = this.s.world;
    w.warned = [];
    const prot = PROTAGONIST[index];
    if (index === 5) {
      // the host is your archaeon, the partner your oxygen breather (hydrogen hypothesis)
      const own = guildAlive(w, 'archaea') && guildAlive(w, 'resp');
      if (own) this.addFlag('ownPartners');
      w.log.push({ t: w.time, act: 5, text: own ? 'Your archaea and your oxygen breathers begin to merge' : 'A wild archaeon and a wild bacterium begin to merge (yours were lost)' });
    }
    if (prot) {
      const existed = guildOf(w, prot);
      const g = found(w, prot, index, existed?.alive ? existed.B : 0.3);
      if (index === 4) g.layer = 1; // anoxygenic phototrophs start in the dim middle water
      if (index === 6) g.layer = 0;
    }
  }

  private worldCtx(mbar: number, x: number): WorldCtx {
    const act = this.act!;
    const a = this.s.a!;
    let ldh = 0;
    for (const l of a.lineages) if (this.has(l, 'a3-ldh')) ldh += l.freq;
    const ctx: WorldCtx = {
      act: act.index,
      prot: { B: protBiomass(x), activity: mbar / Math.max(1e-9, act.pacing.g) },
      flag: (f) => this.hasFlag(f),
      virus: this.hasFlag('virus'),
      ldh,
    };
    if (act.index === 4) {
      ctx.O2 = a.env.O2 ?? 0;
      ctx.light = a.env.light ?? 1;
      const cap = act.envDyn?.O2?.sink?.capacity ?? 1;
      ctx.iron = Math.max(0, Math.min(1, (a.sink.O2 ?? 0) / cap));
    } else if (act.index >= 5) {
      ctx.O2 = a.env.O2 ?? 1;
      ctx.iron = 0;
    } else ctx.O2 = 0;
    if (act.index === 5) {
      const v = a.chores.balance;
      ctx.share = this.automated('balance') ? 0.55 : typeof v === 'number' ? v : 0.5;
    }
    return ctx;
  }

  private worldStat(k: string): number {
    const w = this.s.world;
    if (!w) return 0;
    const prot = this.act ? PROTAGONIST[this.act.index] : undefined;
    switch (k) {
      case 'coexist':
        return coexisting(w, protBiomass(this.derived.occupancy), prot);
      case 'syn':
        return this.hasFlag('heterotrophy') || (this.act?.index ?? 0) > 3 ? syntrophyBoost(w) : 1;
      case 'waves':
        return w.waves;
      case 'partner':
        return w.partner;
      case 'archaeaSafe': {
        const g = guildOf(w, 'archaea');
        return g && g.alive && g.layer === 2 ? 1 : 0;
      }
    }
    if (k in w.res) return w.res[k as keyof typeof w.res];
    const g = guildOf(w, k as GuildId);
    if (g) return g.alive ? g.B : 0;
    return 0;
  }

  /** Act V: how much of the partner's genome has moved to the host's nucleus. */
  private partnerDependence(): number {
    if (this.act?.index !== 5) return 0;
    const dom = this.dominant();
    let d = 0;
    if (this.has(dom, 'a5-ent')) d = 0.05;
    if (this.has(dom, 'a5-endo')) d = 0.2;
    if (this.has(dom, 'a5-egt')) d = 0.45;
    d += 0.15 * this.level(dom, 'a5-move');
    if (this.has(dom, 'a5-import')) d += 0.05;
    return Math.min(1, d);
  }

  /** Remove an adaptation, and everything built on it, from every species (a partner walking out). */
  private revoke(id: string) {
    const act = this.act!;
    const a = this.s.a!;
    const gone = new Set([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const ad of act.adaptations) {
        if (!gone.has(ad.id) && (ad.requires ?? []).some((r) => gone.has(r))) {
          gone.add(ad.id);
          grew = true;
        }
      }
    }
    for (const l of a.lineages) l.muts = l.muts.filter((m) => !m.adaptation || !gone.has(m.adaptation));
    a.pool = (a.pool ?? []).filter((e) => !gone.has(e.id));
    for (const g of gone) {
      const ad = act.adaptations.find((x) => x.id === g);
      for (const e of ad?.effects ?? []) if (e.type === 'flag') a.flags = a.flags.filter((f) => f !== e.key);
    }
  }

  /** Conditions the World watches every half second: losses, the partner, records. */
  private worldChecks() {
    const w = this.s.world;
    const act = this.act;
    const a = this.s.a;
    if (!w || !act || !a) return;
    for (const g of w.guilds) if (!g.alive) this.addFlag(g.id + 'Lost');
    const rec = this.s.records;
    if (act.index === 3) rec.acidPeak = Math.max(rec.acidPeak ?? 0, w.res.lactate);
    if (act.index === 5 && this.hasFlag('endo') && !this.hasFlag('organelle')) {
      rec.partnerMin = Math.min(rec.partnerMin ?? 1, w.partner);
      if (w.partner < 0.35 && !w.warned.includes('partner')) {
        w.warned.push('partner');
        this.emit({ kind: 'event', title: 'Your partner is starving', text: 'The host keeps too much of the organics. Share more with the partner (the slider), or it will leave before it can become an organelle.' });
      }
      if (w.partner > 0.6) w.warned = w.warned.filter((x) => x !== 'partner');
      if (w.partnerLow > 30) {
        this.revoke('a5-endo');
        w.partner = 0.6;
        w.partnerLow = 0;
        this.emit({ kind: 'event', title: 'Your partner escaped', text: 'Starved inside its host, the bacterium broke free. The endosymbiosis, and every stage built on it, has to be evolved again. Keep the exchange fair this time.' });
      }
    }
    if (act.index === 6) rec.calmT = w.waves < 0.08 && guildAlive(w, 'hunter') ? (rec.calmT ?? 0) + 0.5 : 0;
    if (act.index === 1) rec.errPeak = Math.max(rec.errPeak ?? 0, this.stat('errorRatio'));
  }

  private worldTraitState(t: WorldTrait): { state: 'available' | 'locked' | 'owned' | 'hidden'; needs: string[] } {
    const w = this.s.world;
    if (!w || this.s.act < t.act || this.s.act >= FINALE_INDEX) return { state: 'hidden', needs: [] };
    const lev = w.traits[t.id] ?? 0;
    if (t.founds) {
      if (guildAlive(w, t.founds)) return { state: 'owned', needs: [] };
    } else if (t.relocate !== undefined) {
      const g = guildOf(w, t.guild);
      if (g && g.layer === t.relocate) return { state: 'owned', needs: [] };
    } else if (lev >= (t.levels ?? 1)) return { state: 'owned', needs: [] };
    for (const ex of t.excludes ?? []) if ((w.traits[ex] ?? 0) > 0) return { state: 'hidden', needs: [] };
    // earlier acts' traits stay on offer only while they still matter
    if (t.act < this.s.act && t.founds) return { state: 'hidden', needs: [] };
    const needs: string[] = [];
    if (t.needsGuild && !guildAlive(w, t.needsGuild)) {
      if (t.act < this.s.act) return { state: 'hidden', needs: [] };
      needs.push('Needs ' + GUILDS[t.needsGuild].name.toLowerCase());
    }
    if (t.needsFlag && !this.carries(t.needsFlag)) needs.push(TRAIT_HINT[t.needsFlag] ?? 'Not yet reachable');
    for (const r of t.requires ?? []) if (!(w.traits[r] ?? 0)) needs.push(WORLD_TRAITS.find((x) => x.id === r)?.name ?? r);
    return { state: needs.length ? 'locked' : 'available', needs };
  }

  /** A flag set in the act, or carried by the commonest species (adaptation flags live on lineages). */
  private carries(f: string): boolean {
    if (this.hasFlag(f)) return true;
    if (!this.s.a) return false;
    return this.dominant().muts.some((m) => m.effects.some((e) => e.type === 'flag' && e.key === f));
  }

  /** Buy a community trait: found a species, move one, or improve one. */
  private worldBuy(id: string): boolean {
    const w = this.s.world;
    const a = this.s.a;
    const t = WORLD_TRAITS.find((x) => x.id === id);
    if (!w || !a || !t) return false;
    if (this.worldTraitState(t).state !== 'available') return false;
    const lev = w.traits[id] ?? 0;
    const cost = worldTraitCost(t, lev);
    if (a.variation < cost) return false;
    a.variation -= cost;
    w.traits[id] = lev + 1;
    if (t.founds) {
      found(w, t.founds, this.s.act, 0.05);
      w.log.push({ t: w.time, act: this.s.act, text: GUILDS[t.founds].name + ' appear' });
    }
    if (t.relocate !== undefined) {
      const g = guildOf(w, t.guild);
      if (g) g.layer = t.relocate;
      w.log.push({ t: w.time, act: this.s.act, text: `${GUILDS[t.guild].name} move to the ${LAYER_NAMES[t.relocate].toLowerCase()}` });
    }
    for (const f of t.flags ?? []) this.addFlag(f);
    if (id === 'w7-seaweed') this.s.branch = 'alga';
    if (id === 'w7-animals') this.s.branch = 'hetero';
    a.stats.purchases++;
    this.emit({ kind: 'purchase', id, title: t.name, text: t.founds ? 'A new species in your community' : t.relocate !== undefined ? 'Moved' : 'Community trait' });
    return true;
  }

  private worldTraitItems(): WorldTraitItem[] {
    const w = this.s.world;
    const a = this.s.a;
    if (!w || !a) return [];
    const out: WorldTraitItem[] = [];
    for (const t of WORLD_TRAITS) {
      const st = this.worldTraitState(t);
      if (st.state === 'hidden') continue;
      if (st.state === 'owned' && t.act < this.s.act) continue;
      const lev = w.traits[t.id] ?? 0;
      const cost = worldTraitCost(t, lev);
      const owned = st.state === 'owned';
      out.push({
        id: t.id,
        guild: t.guild,
        guildName: GUILDS[t.guild].name,
        name: t.name,
        text: t.text,
        science: t.science,
        cost,
        level: owned ? Math.max(lev, 1) : lev,
        levels: owned ? Math.max(lev, t.levels ?? 1) : t.levels ?? 1,
        state: st.state,
        affordable: a.variation >= cost,
        needs: st.needs,
        card: t.card,
        founds: t.founds,
        relocate: t.relocate,
      });
    }
    return out;
  }

  private guildName(id: GuildId): string {
    if (id === 'photo' && (this.hasFlag('oxygenic') || this.s.act > 4)) return 'Cyanobacteria';
    if (id === 'photo') return 'Purple sulfur bacteria';
    if (id === 'body') return this.s.branch === 'alga' ? 'Seaweed' : this.s.branch === 'hetero' ? 'Animals' : 'Bodies';
    if (id === 'ferm' && this.s.act === 3 && !this.hasFlag('heterotrophy')) return 'Your bacteria';
    return GUILDS[id].name;
  }

  private worldSnap(): WorldSnap | null {
    const w = this.s.world;
    if (!w) return null;
    const actIndex = this.s.act;
    const inFinale = actIndex >= FINALE_INDEX;
    const prot = PROTAGONIST[actIndex] as GuildId | undefined;
    const f = this.s.finale;
    // in the finale the World shows the biosphere: your species scaled to its guilds
    const finaleB = (id: GuildId): number | null => {
      if (!inFinale || !f) return null;
      const v = f.Pr !== undefined ? { Pr: f.Pr, Co: f.Co, Mi: f.Mi } : { Pr: 1, Co: 0.4, Mi: 0.6 };
      if (['photo', 'alga'].includes(id) || (id === 'body' && this.s.branch === 'alga')) return v.Pr / 3;
      if (['hunter', 'euk'].includes(id) || id === 'body') return v.Co / 1.2;
      return v.Mi / 1.5;
    };
    const Bof = (id: GuildId, B: number) => finaleB(id) ?? (id === prot && !(id === 'alga' && actIndex === 6) ? protBiomass(this.derived.occupancy) : B);
    const live = w.guilds.filter((g) => g.alive);
    const total = live.reduce((n, g) => n + Bof(g.id, g.B), 0) || 1;
    const now = w.time;
    const O2 = inFinale ? (f?.O2 ?? 1) : w.res.O2;
    const guilds = w.guilds
      .slice()
      .sort((x, y) => GUILD_ORDER.indexOf(x.id) - GUILD_ORDER.indexOf(y.id))
      .map((g) => {
        const B = Math.min(1.5, Bof(g.id, g.B));
        const ref = this.trendRef[g.id];
        if (!ref || now - ref.t > 30) this.trendRef[g.id] = { t: now, B };
        const trend = ref && now > ref.t ? ((B - ref.B) / Math.max(0.02, ref.B)) * (60 / Math.max(1, now - ref.t)) : 0;
        const d = GUILDS[g.id];
        const danger = !!d.anaerobe && g.alive && layerO2(O2, g.layer) > 0.02;
        const status: WorldSnap['guilds'][number]['status'] = !g.alive ? 'lost' : g.id === prot ? 'in focus' : B < 0.05 ? 'rare' : trend > 0.15 ? 'growing' : trend < -0.15 ? 'declining' : B > 0.4 ? 'thriving' : 'steady';
        const look = g.id === 'photo' ? (this.hasFlag('oxygenic') || actIndex > 4 ? 'cyano' : 'purple') : g.id === 'body' ? (this.s.branch === 'alga' ? 'seaweed' : 'animal') : g.id;
        return { id: g.id, name: this.guildName(g.id), sci: g.id === 'photo' && look === 'purple' ? 'Anoxygenic phototrophs: light plus sulfide, no oxygen' : d.sci, domain: d.domain, color: d.color, B, share: g.alive ? B / total : 0, layer: g.layer, alive: g.alive, protagonist: g.id === prot, status, eats: d.eats, makes: d.makes, card: d.card, act: g.act, trend, danger, look };
      });
    const gauges: WorldGaugeSnap[] = [];
    const R = w.res;
    if (actIndex === 3) {
      gauges.push({ id: 'sugar', label: 'Sugar in the seeps', v: R.sugar, max: 1, color: 'var(--carbon)', unit: 'pct', lines: [{ v: 0.45, label: 'runs short', kind: 'info' }], text: 'A finite reserve. Every sugar eater draws it down; debris digesters return a little.' });
      gauges.push({ id: 'lactate', label: 'Lactate (acid)', v: R.lactate, max: 3, color: 'var(--lipid)', unit: 'num', lines: [{ v: 1.0, label: 'harms fermenters', kind: 'toxic' }], text: 'Fermentation waste. Above the line the acid slows your fermenters. Lactate eaters clear it.' });
      gauges.push({ id: 'H2', label: 'Hydrogen', v: R.H2, max: 1.5, color: 'var(--nad)', unit: 'num', lines: [{ v: 0.3, label: 'low: fermentation runs easily', kind: 'goal' }], text: 'Fermenters make H₂; when it builds up, fermentation stalls. Archaea that eat it keep it low (syntrophy).' });
    }
    if (actIndex === 4) {
      gauges.push({ id: 'iron', label: 'Iron sink', v: R.iron, max: 1, color: 'var(--rust, #c8643c)', unit: 'pct', lines: [], text: 'Dissolved iron rusts as oxygen appears and settles as red bands on the seafloor. While it lasts, O₂ cannot build up.' });
      gauges.push({ id: 'O2', label: 'Oxygen', v: O2, max: 1.5, color: 'var(--oxygen)', unit: 'num', lines: [{ v: 0.12, label: 'oxidation event', kind: 'toxic' }], text: 'Once the iron is rusted, oxygen rises. It is poison to strict anaerobes outside the sediment.' });
      gauges.push({ id: 'CH4', label: 'Methane', v: R.CH4, max: 1.5, color: 'var(--nad)', unit: 'num', lines: [], text: 'Made by your archaea; oxygen destroys it.' });
    }
    if (actIndex === 5) {
      gauges.push({ id: 'partner', label: 'Partner health', v: w.partner, max: 1, color: 'var(--oxygen)', unit: 'pct', lines: [{ v: 0.2, label: 'escapes', kind: 'toxic' }], text: 'Follows how fairly the host shares organics. Starve the partner too long before it is an organelle and it leaves.' });
      gauges.push({ id: 'dep', label: 'Partner genes moved', v: this.partnerDependence(), max: 1, color: 'var(--accent)', unit: 'pct', lines: [{ v: 0.9, label: 'organelle', kind: 'goal' }], text: 'Each gene moved to the nucleus makes the partner more dependent, and gives the host more energy per gene.' });
    }
    if (actIndex === 6) {
      gauges.push({ id: 'waves', label: 'Predator–prey swing', v: Math.min(1, w.waves), max: 1, color: 'var(--proton)', unit: 'pct', lines: [{ v: 0.15, label: 'calm', kind: 'goal' }], text: 'How much the hunters boom and bust over the last five minutes. Refuges, switching, interference and mixotrophy calm the waves.' });
    }
    if (actIndex === 7) {
      const cheat = this.stat('globals.cheat');
      gauges.push({ id: 'cheat', label: 'Cheating cells', v: Math.min(1, cheat), max: 1, color: 'var(--danger)', unit: 'pct', lines: [{ v: 0.05, label: 'kept in check', kind: 'goal' }], text: 'Cells inside your bodies that divide for themselves. A single-cell bottleneck, programmed cell death and policing keep them down.' });
    }
    if (actIndex >= 3 && actIndex !== 4) gauges.push({ id: 'O2', label: 'Oxygen', v: O2, max: 1.5, color: 'var(--oxygen)', unit: 'num', lines: [], text: actIndex === 3 ? 'None yet: the world is anoxic.' : 'Oxygen in the water since the Great Oxidation.' });
    const flows: WorldSnap['flows'] = [];
    const B = (id: GuildId) => {
      const g = guilds.find((x) => x.id === id);
      return g && g.alive ? g.B : 0;
    };
    const hetero = actIndex > 3 || this.hasFlag('heterotrophy');
    if (hetero && B('archaea')) flows.push({ from: 'ferm', to: 'archaea', what: 'H₂', rate: B('ferm') * B('archaea'), color: 'nad' });
    if (hetero && B('lact')) flows.push({ from: 'ferm', to: 'lact', what: 'lactate', rate: B('ferm') * B('lact'), color: 'lipid' });
    if (B('lact') && B('archaea')) flows.push({ from: 'lact', to: 'archaea', what: 'H₂', rate: B('lact') * B('archaea'), color: 'nad' });
    if (B('debris')) for (const g of guilds) if (g.alive && g.id !== 'debris' && g.B > 0.1) flows.push({ from: g.id, to: 'debris', what: 'dead cells', rate: 0.3 * g.B * B('debris'), color: 'sulfur' });
    if (B('photo') && B('resp') && O2 > 0.05) flows.push({ from: 'photo', to: 'resp', what: 'O₂ and organics', rate: B('photo') * B('resp'), color: 'oxygen' });
    if (B('hunter') && B('alga')) flows.push({ from: 'alga', to: 'hunter', what: 'eaten', rate: B('alga') * B('hunter'), color: 'proton' });
    if (B('hunter') && B('photo') && (w.traits['w6-switch'] ?? 0)) flows.push({ from: 'photo', to: 'hunter', what: 'eaten', rate: B('photo') * B('hunter'), color: 'proton' });
    if (B('euk') && B('photo') && actIndex >= 5) flows.push({ from: 'photo', to: 'euk', what: 'eaten', rate: 0.5 * B('photo') * B('euk'), color: 'atp' });
    const dep = this.partnerDependence();
    return {
      act: actIndex,
      time: w.time,
      guilds,
      gauges,
      res: { ...R, O2 },
      hist: w.hist.slice(-150),
      histKeys: [...GUILD_ORDER, 'sugar', 'lactate', 'H2', 'O2'],
      layers: [...LAYER_NAMES],
      o2Layers: [0, 1, 2].map((l) => layerO2(O2, l as 0 | 1 | 2)),
      surface: actIndex !== 4 || this.hasFlag('surface'),
      partner: actIndex === 5 ? { health: w.partner, dependence: dep, hostGenes: Math.round(this.genomeSnap()?.used ?? 0), partnerGenes: Math.round(1600 * (1 - dep * 0.97)) } : null,
      waves: actIndex === 6 && guildAlive(w, 'hunter') ? w.waves : null,
      flows,
      log: w.log.slice(-12),
      coexist: coexisting(w, protBiomass(this.derived.occupancy), prot),
    };
  }

  // ---------- achievements & challenges ----------
  private achView(advancing: boolean): AchView {
    const a = this.s.a;
    const act = this.act;
    return {
      s: this.s,
      act: this.s.act,
      stat: (k: string) => this.stat(k),
      flag: (f: string) => this.hasFlag(f),
      owns: (id: string) => (a && act ? act.adaptations.some((x) => x.id === id) && this.has(this.dominant(), id) : false) || (this.s.world?.traits[id] ?? 0) > 0,
      minutes: a ? a.time / 60 : 0,
      advancing,
      complete: advancing && !!a && this.unbought().length === 0,
      crashes: a?.stats.crashes ?? 0,
    };
  }

  private checkAchievements(advancing = false) {
    const v = this.achView(advancing);
    for (const ach of ACHIEVEMENTS) {
      if (this.s.achievements.includes(ach.id)) continue;
      let ok = false;
      try {
        ok = ach.check(v);
      } catch {
        ok = false;
      }
      if (!ok) continue;
      this.s.achievements.push(ach.id);
      this.emit({ kind: 'achievement', id: ach.id, title: 'Achievement · ' + ach.name, text: `${ach.text} Variation income ×${achievementBonus(this.s).toFixed(2)} from achievements.` });
    }
  }

  private startChallenge(id: string): boolean {
    const c = CHALLENGES.find((x) => x.id === id);
    if (!c || this.s.challengeRun) return false;
    if (!this.challengeAvailable(c.act)) return false;
    const branchBefore = this.s.branch;
    const saved = JSON.stringify(this.serialize());
    this.s.challengeRun = { id, saved, started: Date.now() };
    if (c.act >= 3) this.s.world = seedWorld(c.act);
    this.s.act = c.act;
    this.devGate = false;
    this.initAct(c.act);
    const a = this.s.a!;
    for (const [k, m] of Object.entries(c.env ?? {})) {
      a.envMul[k] = (a.envMul[k] ?? 1) * m;
      a.env[k] = (a.env[k] ?? 0) * m;
    }
    for (const f of c.flags ?? []) this.addFlag(f);
    const w = this.s.world;
    if (w && c.world) {
      if (c.world.sugar !== undefined) w.res.sugar = c.world.sugar;
      if (c.world.ironCap !== undefined && a.sink.O2 !== undefined) a.sink.O2 *= c.world.ironCap;
      for (const tid of c.world.traits ?? []) {
        const t = WORLD_TRAITS.find((x) => x.id === tid);
        if (!t) continue;
        w.traits[tid] = 1;
        if (t.founds) found(w, t.founds, c.act, 0.2);
        for (const f of t.flags ?? []) this.addFlag(f);
      }
    }
    if (id === 'c7' && w) {
      const tid = branchBefore === 'hetero' ? 'w7-seaweed' : 'w7-animals';
      const t = WORLD_TRAITS.find((x) => x.id === tid)!;
      w.traits[tid] = 1;
      for (const f of t.flags ?? []) this.addFlag(f);
      this.s.branch = tid === 'w7-seaweed' ? 'alga' : 'hetero';
    }
    this.emit({ kind: 'transition', data: { from: c.act - 1, to: c.act, challenge: id } });
    return true;
  }

  /** A challenge for an act opens once you have played past that act. */
  private challengeAvailable(act: number): boolean {
    const real = this.s.challengeRun ? (JSON.parse(this.s.challengeRun.saved) as GameState).act : this.s.act;
    return real > act;
  }

  private endChallenge(success: boolean) {
    const run = this.s.challengeRun;
    if (!run) return false;
    const c = CHALLENGES.find((x) => x.id === run.id);
    if (success) this.checkAchievements(true);
    const earned = this.s.achievements.slice();
    const saved = migrate(JSON.parse(run.saved) as GameState);
    saved.achievements = Array.from(new Set([...saved.achievements, ...earned]));
    if (success && c && !saved.challengesDone.includes(c.id)) {
      saved.challengesDone.push(c.id);
      saved.evolvability += c.bonus;
    }
    saved.challengeRun = null;
    this.s = saved;
    this.rt.clear();
    this.live = null;
    this.lastSig = '';
    this.fluxHist = [];
    this.pm = [];
    this.sendHistory = true;
    this.worldMu = 1;
    this.worldDelta = 0;
    this.devGate = false;
    if (this.s.a) this.loadDecimals();
    this.checkAchievements();
    this.emit({ kind: 'transition', data: { from: -1, to: this.s.act, restored: true } });
    this.emit({ kind: 'milestone', title: success ? 'Challenge complete' : 'Challenge abandoned', text: success && c ? `${c.name}: Variation income ×${this.s.evolvability.toFixed(2)} from now on. Your game is back where you left it.` : 'Your game is back where you left it.' });
    return true;
  }

  // ---------- conditions ----------
  stat(key: string): number {
    if (key.startsWith('act0.')) {
      const s0 = this.s.act0;
      if (key === 'act0.L') return strandLength(s0.p);
      if (key === 'act0.complete') return ACT0_UPGRADES.every((u) => (s0.up[u.id] ?? 0) >= u.levels) ? 1 : 0;
      return 0;
    }
    const a = this.s.a;
    if (!a) return 0;
    const d = this.derived;
    if (key.startsWith('world.')) return this.worldStat(key.slice(6));
    if (key === 'partner.dependence') return this.partnerDependence();
    if (key.startsWith('globals.')) {
      const p = this.rt.get(this.dominant().id)?.params;
      return p?.globals[key.slice(8)] ?? 0;
    }
    if (key.startsWith('species.')) {
      const id = key.slice(8);
      if (!this.live) return 0;
      const i = this.live.c.index[id];
      return i === undefined ? 0 : this.live.s[i];
    }
    if (key.startsWith('share.')) {
      const pid = key.slice(6);
      return this.cellPools().find((p) => p.id === pid)?.share ?? 1;
    }
    if (key.startsWith('env.')) return a.env[key.slice(4)] ?? 0;
    switch (key) {
      case 'time':
        return a.time;
      case 'P':
        return this._P.log10().toNumber();
      case 'flux':
        return d.flux;
      case 'ec':
        return d.ec;
      case 'growth':
        return d.growth;
      case 'variation':
        return a.variation;
      case 'biomass':
        return this._biomass.gt(0) ? this._biomass.log10().toNumber() : 0;
      case 'dead':
        return this._dead.gt(0) ? this._dead.log10().toNumber() : 0;
      case 'block':
        return a.block;
      case 'adaptations':
        return this.dominant().muts.filter((m) => m.adaptation).length;
      case 'lineages':
        return a.lineages.length;
      case 'chosen': {
        let n = 0;
        for (const v of Object.values(a.chores)) if (Array.isArray(v)) n += v.length;
        return n;
      }
      case 'food': {
        const { key: fk, foodIn } = this.foodKey();
        return (a.env[fk] ?? 0) / foodIn;
      }
      case 'errorRatio': {
        const p = this.rt.get(this.dominant().id)?.params ?? this.paramsOf(this.dominant());
        return this.genomeInfo(p).errorRatio;
      }
      case 'energyRatio':
      case 'copyRatio': {
        const g = this.genomeSnap();
        if (!g) return 0;
        return key === 'energyRatio' ? g.used / Math.max(g.energyCap, 1e-9) : g.used / Math.max(g.copyCap, 1e-9);
      }
      case 'sweeps':
        return a.stats.sweeps;
      case 'occupancy':
        return d.occupancy;
      case 'goe':
        return a.goe;
    }
    return 0;
  }

  evalCond(c: Condition, id = ''): boolean {
    const a = this.s.a;
    if ('all' in c) return c.all.every((x, i) => this.evalCond(x, id + '.' + i));
    if ('any' in c) return c.any.some((x, i) => this.evalCond(x, id + '.' + i));
    if ('has' in c) return a ? this.has(this.dominant(), c.has) : false;
    if ('flag' in c) return this.hasFlag(c.flag);
    const v = this.stat(c.stat);
    let ok = false;
    switch (c.op) {
      case '<':
        ok = v < c.value;
        break;
      case '>':
        ok = v > c.value;
        break;
      case '<=':
        ok = v <= c.value;
        break;
      case '>=':
        ok = v >= c.value;
        break;
    }
    if (c.for && a) {
      const tk = id + c.stat;
      if (ok) a.timers[tk] = (a.timers[tk] ?? 0) + 0.5;
      else a.timers[tk] = 0;
      return a.timers[tk] >= c.for;
    }
    return ok;
  }

  describeCond(c: Condition): { text: string; ok: boolean }[] {
    if ('all' in c) return c.all.flatMap((x) => this.describeCond(x));
    if ('any' in c) {
      // labelled alternatives: name the main path (the others are fallbacks, like a lost species)
      const first = c.any[0] as { label?: string };
      const text = first.label ?? c.any.map((x) => this.describeCond(x).map((d) => d.text).join(' & ')).join(' or ');
      return [{ text, ok: this.evalCond(c) }];
    }
    if ('has' in c) {
      const ad = this.act?.adaptations.find((x) => x.id === c.has);
      return [{ text: c.label ?? 'Evolve ' + (ad?.name ?? c.has), ok: this.evalCond(c) }];
    }
    if ('flag' in c) {
      const ev = this.act?.events?.find((e) => e.flags?.includes(c.flag));
      const un = this.act?.unlocks.find((u) => u.flags?.includes(c.flag));
      return [{ text: c.label ?? ev?.title ?? un?.title ?? c.flag, ok: this.evalCond(c) }];
    }
    return [{ text: c.label ?? `${c.stat} ${c.op} ${c.value}`, ok: this.evalCond(c) }];
  }

  // ---------- main tick ----------
  tick(dtReal: number) {
    const dt = dtReal * this.speed;
    this.s.totalTime += dt;
    if (this.s.act === 0) this.tickAct0(dt);
    else if (this.s.act >= FINALE_INDEX) this.tickFinale(dt);
    else this.tickAct(dt, true);
    this.s.rng = this.rng.state;
    this.achTimer -= dt;
    if (this.achTimer <= 0) {
      this.achTimer = 2;
      this.checkAchievements();
    }
  }

  private tickAct0(dt: number) {
    const s0 = this.s.act0;
    if (this.sparkT > 0) {
      // the spark scene plays in the pond before Act I begins
      tick0(s0, dt, this.rng, false);
      this.sparkT -= dt / Math.max(1, this.speed);
      if (this.sparkT <= 0) {
        this.sparkT = 0;
        this.transition(1);
      }
      return;
    }
    if (s0.sparked) {
      // reloaded mid-scene
      this.transition(1);
      return;
    }
    const fired = tick0(s0, dt, this.rng, true);
    if (fired) {
      this.sparkT = 5.5;
      this.emit({ kind: 'spark', title: 'The spark', text: 'A strand that can copy itself has landed inside a vesicle. Heredity begins.' });
      return;
    }
    // Act 0 unlock cards
    const fire = (id: string, cond: boolean, title: string, text: string, card: string) => {
      if (cond && !this.s.seen.includes('a0:' + id)) {
        this.s.seen.push('a0:' + id);
        this.emit({ kind: 'unlock', id, title, text, data: { card } });
      }
    };
    fire('vessel', s0.time > 0.3, 'Before life', 'Two sites, because science has not chosen one: a hydrothermal vent makes simple organics, a shallow pond turns them into nucleotides and fatty acids.', 'origin-sites');
    fire('cycle', s0.time > 6, 'Wet and dry', 'Drying a pool concentrates nucleotides so they join into strands; wetting it releases them. Run a cycle by hand.', 'wet-dry');
    fire('library', s0.rna > 0.01, 'A library of random RNA', 'Strand lengths follow a Flory distribution: if each join succeeds with chance p, a strand at least 45 long has chance p^44. Push p up.', 'flory');
    fire('vesicles', s0.ves > 5, 'Vesicles', 'Fatty acids above a critical concentration close into vesicles. They grow and split, but split their contents at random, so nothing is inherited yet.', 'vesicles');
    fire('spark', sparkRate(s0).ready, 'The spark is possible', 'Long strands and vesicles are both present. A 45-nucleotide polymerase ribozyme inside a vesicle would start heredity. Every cycle raises the chance.', 'polymerase-ribozyme');
    this.strandTimer -= dt;
    if (this.strandTimer <= 0) {
      this.strandTimer = 1.2;
      this.act0Strands = sampleStrands(s0, 14, new Rng(Math.floor(s0.time * 7) + 3));
    }
  }

  private tickFinale(dt: number) {
    const f = this.s.finale!;
    const r = tickFinale(f, dt, this.rng);
    for (const e of r.events) this.emit({ kind: 'event', title: 'Perturbation', text: e });
    if (!f.won && !f.challenge && f.stable >= WIN_SECONDS) {
      f.won = true;
      this.s.won = true;
      this.emit({ kind: 'win', title: 'A living planet', text: 'Producers, consumers, microbes and viruses hold carbon, nitrogen and oxygen in balance on light alone.' });
    }
  }

  /** One step of the population model. */
  tickAct(dt: number, online: boolean) {
    const act = this.act!;
    const a = this.s.a!;
    a.time += dt;
    this.ensureTables(online ? 12 : 1000);
    this.stepPopulation(dt);
    if (online) this.stepLive(dt);
    this.condTimer -= dt;
    if (this.condTimer <= 0) {
      this.condTimer = 0.5;
      this.checkUnlocks();
      this.checkEvents();
      this.checkCrash();
      this.autoChores();
      this.worldChecks();
    }
    if (online && a.time > 5 && !a.readyNoted && this.gateSnap().ready) {
      a.readyNoted = true;
      this.emit({ kind: 'milestone', title: 'Goals met', text: 'You can advance to the next act whenever you are ready. Unspent Variation and Biomass carry over in part; leftover raw material is stored as Reserves.' });
    }
    this.policyTimer -= dt;
    if (this.policyTimer <= 0) {
      this.policyTimer = 3;
      this.runPolicies();
    }
    this.bgTimer -= dt;
    if (this.bgTimer <= 0) {
      this.bgTimer = 4;
      this.backgroundMutations(4);
    }
    // Muller history with adaptive decimation
    if (a.time >= a.histNext) {
      const f: Record<number, number> = {};
      for (const l of a.lineages) f[l.id] = l.freq;
      a.history.push({ t: a.time, f });
      a.histNext = a.time + a.histDt;
      if (a.history.length > 400) {
        a.history = a.history.filter((_, i) => i % 2 === 0);
        a.histDt *= 2;
      }
      this.sendHistory = true;
    }
    this.snapTimer -= dt;
    if (this.snapTimer <= 0) {
      this.snapTimer = 20;
      this.takeSnapshot();
    }
    this.fluxHistPush();
    void act;
  }

  private fluxHistT = -1;
  private fluxHistPush() {
    const t = Math.floor(this.s.a!.time);
    if (t !== this.fluxHistT) {
      this.fluxHistT = t;
      this.fluxHist.push(this.derived.flux);
      if (this.fluxHist.length > 120) this.fluxHist.shift();
    }
  }

  private stepPopulation(dt: number) {
    const act = this.act!;
    const a = this.s.a!;
    const g = act.pacing.g;
    const { key: fk, foodIn } = this.foodKey();
    const Kscale = this.capacity();
    const sub = Math.max(1, Math.ceil(dt / 0.25));
    const h = dt / sub;
    const per = new Map<number, { mu: number; delta: number; dormant: boolean; ec: number; carrier: number; pt: TablePt }>();
    let mbar = 0;
    let dbar = 0;
    let growth = 0;
    let ecW = 0;
    let carrierW = 0;
    let vIncome = 0;
    let bIncome = dec(0);
    const virus = act.virus && this.hasFlag('virus') ? act.virus : null;
    for (let step = 0; step < sub; step++) {
      // env base values (events, niche supply, cycles)
      this.updateEnvBase(h);
      const food = a.env[fk] ?? foodIn;
      const x = this._P.div(Kscale).toNumber();
      const crowd = act.pacing.delta0 * Math.pow(this._P.div(Kscale * 6).toNumber(), 2);
      mbar = 0;
      dbar = 0;
      ecW = 0;
      carrierW = 0;
      let cons = 0;
      const bfl: Record<string, number> = {};
      per.clear();
      for (const l of a.lineages) {
        const t = this.tableOf(l);
        if (!t) continue;
        const pt = interp(t, food);
        const p = this.rt.get(l.id)?.params;
        const gi = p ? this.genomeInfo(p) : null;
        const load = act.index === 1 || !gi ? 1 : Math.exp(-0.3 * gi.U);
        let mu = ((g * pt.mu * load) / a.ref.mu) * this.worldMu;
        let delta = g * (act.pacing.delta0 + crowd + pt.dmg) + this.worldDelta;
        if (pt.ec < 0.5 && act.network.ec) delta += g * (0.5 - pt.ec) * 1.2;
        const dormant = act.network.ec ? pt.ec < 0.22 : mu < 0.02 * g;
        if (virus) {
          const defended = virus.defences.reduce((acc, d) => acc + (this.has(l, d) ? 1 : 0), 0);
          const dfac = Math.pow(0.35, defended);
          delta += g * virus.strength * l.freq * l.freq * Math.min(1.5, x) * dfac;
        }
        if (dormant) {
          mu = 0;
          delta = g * act.pacing.delta0 * 0.12;
        }
        per.set(l.id, { mu, delta, dormant, ec: pt.ec, carrier: pt.carrier, pt });
        mbar += l.freq * mu;
        dbar += l.freq * delta;
        ecW += l.freq * pt.ec;
        carrierW += l.freq * pt.carrier;
        // Dormant cells barely eat, so a crashed population lets its food recover.
        const eat = dormant ? 0.03 : 1;
        cons += l.freq * pt.uptake * eat;
        for (const [k, v] of Object.entries(pt.bflux)) bfl[k] = (bfl[k] ?? 0) + l.freq * v * eat;
      }
      const rbar = mbar - dbar;
      growth = rbar;
      // Selection amplifies a chosen structural step to fixation over a visible
      // sweep: a frequency-only advantage (population size uses true growth).
      let netMax = -Infinity;
      for (const l of a.lineages) {
        const q = per.get(l.id);
        if (q && !l.drive) netMax = Math.max(netMax, q.mu - q.delta);
      }
      const selBonus = new Map<number, number>();
      let rsel = rbar;
      for (const l of a.lineages) {
        const q = per.get(l.id);
        if (!q || !l.drive) continue;
        // The newest step in a chain carries everything before it: ancestors stop being driven.
        if (l.freq >= 0.97 || a.lineages.some((o) => o.drive && o.parent === l.id)) {
          l.drive = false;
          continue;
        }
        const ref = Number.isFinite(netMax) ? netMax : q.mu - q.delta;
        const bonus = Math.max(0, ref + 0.15 * g - (q.mu - q.delta));
        selBonus.set(l.id, bonus);
        rsel += l.freq * bonus;
      }
      // Replicator dynamics
      let tot = 0;
      for (const l of a.lineages) {
        const q = per.get(l.id);
        if (!q) continue;
        l.freq *= Math.exp((q.mu - q.delta + (selBonus.get(l.id) ?? 0) - rsel) * h);
        tot += l.freq;
      }
      for (const l of a.lineages) l.freq /= tot || 1;
      // Population
      const births = this._P.mul(mbar * h);
      const deaths = this._P.mul(dbar * h);
      bIncome = this._P.mul(mbar);
      this._P = this._P.mul(Math.exp(rbar * h));
      if (this._P.lt(50)) this._P = dec(50);
      this._biomass = this._biomass.add(births.mul(act.pacing.biomassBase > 0 ? 1 : 1));
      this._dead = this._dead.add(deaths);
      // the community answers: syntrophy, acid, predation
      if (this.s.world && act.index >= 3) {
        const out = tickWorld(this.s.world, h, this.worldCtx(mbar, x));
        this.worldMu = out.mu;
        this.worldDelta = out.delta;
        for (const e of out.events) this.emit({ kind: e.kind === 'lost' ? 'lost' : e.kind, title: e.title, text: e.text });
      }
      // Food (chemostat): dS/dt = D (Sin - S) - D Sin x cons/uRef
      const D = Math.max(0.5 * g, 0.1);
      const Sin = this.envBaseValue(fk);
      const consRate = (D * Sin * x * cons) / a.ref.u;
      // implicit in S for the consumption term (cons ∝ S at low S)
      const kc = food > 1e-9 ? consRate / food : 0;
      a.env[fk] = Math.max(1e-9, (food + h * D * Sin) / (1 + h * (D + kc)));
      // Other dynamic env variables
      for (const [k, spec] of Object.entries(act.envDyn ?? {})) {
        if (k === fk) continue;
        const base = this.envBaseValue(k);
        let v = a.env[k] ?? base;
        const relax = spec.relax ?? 0;
        v += h * relax * (base - v);
        if (spec.flux) v += (h * spec.flux * x * (bfl[k] ?? 0)) / a.ref.u;
        if (spec.sink && a.sink[k] > 0 && v > 0) {
          const take = Math.min(a.sink[k], v * spec.sink.rate * h);
          v -= take;
          a.sink[k] -= take;
        }
        if (spec.max) v = Math.min(spec.max, v);
        a.env[k] = Math.max(0, v);
      }
      // Currencies
      const gbar = Math.max(mbar, 1e-6);
      const dom = this.dominant();
      const dp = this.rt.get(dom.id)?.params;
      const U = dp ? this.genomeInfo(dp).U : act.pacing.U;
      const lnN = Math.log(1 + this._P.toNumber() || 1) || this._P.ln().toNumber();
      const challengeK = this.s.challengeRun ? CHALLENGES.find((c) => c.id === this.s.challengeRun!.id)?.pacingK ?? 1 : 1;
      vIncome = act.pacing.k * U * gbar * lnN * this.s.evolvability * achievementBonus(this.s) * challengeK * (this.hasFlag('sex') ? 2 : 1) * (this.s.virusCampaign.done ? 1.15 : 1);
      a.variation += vIncome * h;
      // A floor keeps building blocks trickling in even when starving cells barely run their carrier pathway.
      const blockGain = act.pacing.blockRate * Math.max(0.25, carrierW / a.ref.carrier) * Math.max(1, this._P.log10().toNumber() - 1);
      a.block += blockGain * h;
    }
    // Derived
    const fluxPerCell = carrierW * act.pacing.carrierScale;
    const totalFlux = this._P.mul(Math.max(fluxPerCell, 1e-30));
    this.derived = {
      mu: mbar,
      delta: dbar,
      growth,
      ec: ecW,
      flux: totalFlux.gt(0) ? totalFlux.log10().toNumber() : 0,
      fluxPerCell,
      vIncome,
      bIncome,
      perLineage: per,
      occupancy: this._P.div(Kscale).toNumber(),
    };
    a.stats.maxFlux = Math.max(a.stats.maxFlux, this.derived.flux);
    this.transferStep(dt);
    this.manageLineages();
    this.storeDecimals();
  }

  private envBaseValue(k: string): number {
    const act = this.act!;
    const a = this.s.a!;
    let v = act.env[k] ?? 0;
    const { key: fk, foodIn } = this.foodKey();
    if (k === fk) v = foodIn;
    let mul = a.envMul[k] ?? 1;
    const ramp = a.ramps?.find((r) => r.key === k && a.time < r.start + r.dur);
    if (ramp) mul = ramp.from + (ramp.to - ramp.from) * Math.min(1, (a.time - ramp.start) / ramp.dur);
    v *= mul;
    for (const n of act.niches) {
      const l = a.niches[n.id] ?? 0;
      if (l && n.supply?.[k]) v *= 1 + n.supply[k] * l;
    }
    // the community's sugar reserve feeds the seeps (Act III)
    if (act.index === 3 && k === 'glucose' && this.s.world) v *= 0.12 + 0.88 * this.s.world.res.sugar;
    const cyc = act.envDyn?.[k]?.cycle;
    if (cyc && (!cyc.flag || this.hasFlag(cyc.flag))) {
      const ph = ((a.time / cyc.period + 0.06) % 1 + 1) % 1; // acts begin just after dawn
      const day = Math.max(0, Math.sin(ph * 2 * Math.PI));
      v *= cyc.min + (cyc.max - cyc.min) * day;
    } else if (cyc?.flag) v *= cyc.steady ?? 1;
    return v;
  }

  private updateEnvBase(_h: number) {
    const act = this.act!;
    const a = this.s.a!;
    const { key: fk } = this.foodKey();
    // light-like food with a cycle: chemostat relaxes it toward the cycling base
    for (const [k, spec] of Object.entries(act.envDyn ?? {})) {
      if (spec.cycle && k !== fk && !spec.relax) a.env[k] = this.envBaseValue(k);
    }
    for (const r of a.ramps ?? []) {
      if (r.key !== fk && !act.envDyn?.[r.key] && a.time <= r.start + r.dur + 1) a.env[r.key] = this.envBaseValue(r.key);
    }
  }

  capacity(): number {
    const act = this.act!;
    const a = this.s.a!;
    let K = act.pacing.cellsPerSite;
    for (const n of act.niches) K *= Math.pow(n.capacity, a.niches[n.id] ?? 0);
    return K;
  }

  private manageLineages() {
    const a = this.s.a!;
    const dom = this.dominant();
    const prevDom = this.lineage(a.dominantId);
    // Sweeps (with hysteresis: a new leader needs a real majority)
    if (dom.id !== a.dominantId && (!prevDom || dom.freq > 0.5)) {
      const prev = a.dominantId;
      a.dominantId = dom.id;
      a.stats.sweeps++;
      const newMut = dom.muts.length ? dom.muts[dom.muts.length - 1] : null;
      this.emit({ kind: 'sweep', title: 'A sweep', text: `${dom.name} has taken over the population.`, data: { from: prev, to: dom.id, label: newMut?.label } });
      if (a.viewed === prev || !this.lineage(a.viewed)) a.viewed = dom.id;
      if (a.selected === prev || !this.lineage(a.selected)) a.selected = dom.id;
    }
    // Prune tiny lineages (keep newborns briefly; never a driven sweep)
    a.lineages = a.lineages.filter((l) => {
      if (l.id === dom.id || l.drive) return true;
      if (l.freq < 2e-6 && a.time - l.born > 20) {
        this.noteRejection(l, dom);
        this.rt.delete(l.id);
        // reparent children
        for (const c of a.lineages) if (c.parent === l.id) c.parent = l.parent;
        return false;
      }
      return true;
    });
    // Merge if too many (never the leader or a driven sweep)
    while (a.lineages.length > MAX_LINEAGES) {
      const candidates = a.lineages.filter((l) => l.id !== dom.id && !l.drive);
      if (!candidates.length) break;
      let smallest = candidates[0];
      for (const l of candidates) if (l.freq < smallest.freq) smallest = l;
      this.noteRejection(smallest, dom);
      const parent = this.lineage(smallest.parent) ?? dom;
      parent.freq += smallest.freq;
      for (const c of a.lineages) if (c.parent === smallest.id) c.parent = smallest.parent;
      a.lineages = a.lineages.filter((l) => l !== smallest);
      this.rt.delete(smallest.id);
    }
    if (!this.lineage(a.selected)) a.selected = dom.id;
    if (!this.lineage(a.viewed)) a.viewed = dom.id;
  }

  /** A variant that vanished without its adaptation reaching the leader was rejected by selection. */
  private noteRejection(l: Lineage, dom: Lineage) {
    const a = this.s.a!;
    const last = l.muts[l.muts.length - 1];
    if (l.pooled || !last?.adaptation || this.has(dom, last.adaptation)) return;
    if (a.lineages.some((o) => o.id !== l.id && this.level(o, last.adaptation!) >= this.level(l, last.adaptation!))) return;
    const q = this.derived.perLineage.get(l.id);
    const dq = this.derived.perLineage.get(dom.id);
    const s = q && dq && dq.mu > 0 ? q.mu / dq.mu - 1 : -0.01;
    a.rejected ??= {};
    const r = a.rejected[last.adaptation] ?? { n: 0, s: 0 };
    a.rejected[last.adaptation] = { n: r.n + 1, s };
    const ad = this.act!.adaptations.find((x) => x.id === last.adaptation);
    this.emit({
      kind: 'toast',
      title: 'Selection rejected ' + (ad?.name ?? last.label),
      text: `In this cell and environment it did not help (s ≈ ${(s * 100).toFixed(1)}%). Read the map and control coefficients before trying again.`,
    });
  }

  private stepLive(dt: number) {
    const act = this.act!;
    const a = this.s.a!;
    const l = this.lineage(a.viewed) ?? this.dominant();
    const rt = this.rt.get(l.id);
    if (!rt?.params) return;
    const env = { ...a.env };
    const key = this.keyOf(l);
    if (!this.live || this.live.key !== key || this.live.lid !== l.id) {
      const prev = this.live;
      const vScale = this.overflowPenalty(l, rt.params, interp(rt.table!, a.env[this.foodKey().key] ?? 1).carrier);
      const { c, s } = compile(act.network, rt.params, env, null, vScale);
      if (prev) prev.c.ids.forEach((id, i) => c.index[id] !== undefined && (s[c.index[id]] = prev.s[i]));
      this.live = { key, c, s, control: prev?.control ?? {}, controlAt: -1e9, lid: l.id };
      if (prev) this.emit({ kind: 'toast', id: 'rebalance' });
    }
    const L = this.live;
    setEnv(L.c, env);
    integrate(L.c, L.s, Math.min(dt * 1.5, 3), 0.6);
    if (a.time - L.controlAt > 12) {
      L.controlAt = a.time;
      const ss = steadyState(L.c, L.s);
      L.control = controlCoefficients(L.c, ss);
    }
    // postmortem buffer
    if (this.pm.length === 0 || a.time - this.pm[this.pm.length - 1].t >= 1) {
      const pools: Record<string, number> = {};
      for (const p of this.cellPools()) pools[p.id] = p.share;
      pools.ec = this.derived.ec;
      this.pm.push({ t: a.time, pools });
      if (this.pm.length > 90) this.pm.shift();
    }
  }

  private cellPools(): { id: string; share: number; total: number }[] {
    const act = this.act;
    if (!act || !this.live) return [];
    const L = this.live;
    return act.network.pools.map((p) => {
      let tot = 0;
      for (const sp of p.species) tot += L.s[L.c.index[sp]] ?? 0;
      const ch = L.s[L.c.index[p.charged]] ?? 0;
      return { id: p.id, share: tot > 0 ? ch / tot : 0, total: tot };
    });
  }

  // ---------- unlocks / events / crashes ----------
  private checkUnlocks() {
    const act = this.act!;
    const a = this.s.a!;
    for (const u of act.unlocks) {
      if (a.fired.includes(u.id)) continue;
      if (!this.evalCond(u.when, u.id)) continue;
      a.fired.push(u.id);
      this.addFlag(u.id);
      for (const f of u.flags ?? []) this.addFlag(f);
      for (const r of u.reveals ?? []) if (!this.s.revealsGlobal.includes(r)) this.s.revealsGlobal.push(r);
      this.emit({ kind: 'unlock', id: u.id, title: u.title, text: u.tutorial, data: { card: u.card, highlight: u.highlight, demo: u.demo } });
      if (u.flags?.includes('luca')) this.emit({ kind: 'milestone', title: u.title, text: u.tutorial });
    }
    // virus start
    if (act.virus && !this.hasFlag('virus') && this.evalCond(act.virus.startsWhen, 'virus')) {
      this.addFlag('virus');
      this.emit({ kind: 'event', title: act.virus.name, text: act.virus.text, id: 'virus' });
      if (act.index >= 3 && !this.s.virusCampaign.unlocked) {
        this.s.virusCampaign.unlocked = true;
        this.emit({ kind: 'toast', title: 'Side campaign', text: 'Play the virus is now open from the Codex.' });
      }
    }
    // auto-spend policies unlock at the end of Act 1
    if (act.index === 1 && !this.s.policiesUnlocked && this.gateSnap().ready) {
      this.s.policiesUnlocked = true;
      this.emit({ kind: 'unlock', id: 'policies', title: 'Auto-spend policies', text: 'Write simple rules that spend Variation for you. They are a game convenience, not biology, and the codex says so.', data: { card: 'policies' } });
    }
  }

  private checkEvents() {
    const act = this.act!;
    const a = this.s.a!;
    for (const e of act.events ?? []) {
      if (a.fired.includes(e.id)) continue;
      if (!this.evalCond(e.when, e.id)) continue;
      a.fired.push(e.id);
      for (const [k, m] of Object.entries(e.env ?? {})) {
        const from = a.envMul[k] ?? 1;
        a.envMul[k] = from * m;
        if (e.ramp) {
          a.ramps ??= [];
          a.ramps.push({ key: k, from, to: from * m, start: a.time, dur: e.ramp });
        } else a.env[k] = (a.env[k] ?? 0) * m; // live value follows immediately
      }
      for (const f of e.flags ?? []) this.addFlag(f);
      if (e.founds && this.s.world) {
        found(this.s.world, e.founds as GuildId, act.index, 0.06);
        this.s.world.log.push({ t: this.s.world.time, act: act.index, text: GUILDS[e.founds as GuildId].name + ' appear' });
      }
      this.emit({ kind: e.flags?.includes('goe') ? 'goe' : 'event', id: e.id, title: e.title, text: e.text });
    }
    // Great Oxidation rust progress
    if (this.hasFlag('goe')) a.goe = Math.min(1, a.goe + 0.5 / 6);
  }

  private checkCrash() {
    const act = this.act!;
    const a = this.s.a!;
    const d = this.derived;
    const dom = this.dominant();
    const q = d.perLineage.get(dom.id);
    if (!q) return;
    const night = act.dayCycle ? this.envBaseValue(act.dayCycle.key) < 0.15 * act.foodIn : false;
    const crashed = !night && (act.network.ec ? q.ec < 0.25 : q.dormant);
    if (crashed && !a.crashed) {
      a.crashed = true;
      a.stats.crashes++;
      this.alert = this.diagnose(true);
      this.emit({ kind: 'crash', title: this.alert.title, text: this.alert.text });
    } else if (!crashed && a.crashed && q.ec > 0.4) {
      a.crashed = false;
      this.alert = null;
      this.emit({ kind: 'toast', title: 'Recovered', text: 'Energy charge is back above the danger line.' });
    } else if (!crashed) {
      // warnings
      const dp = this.rt.get(dom.id)?.params;
      const gi = act.index === 1 && dp ? this.genomeInfo(dp) : null;
      const pools = this.cellPools();
      const stranded = pools.find((p) => p.total > 0 && (p.share < 0.03 || p.share > 0.992) && !p.id.startsWith('adenylate'));
      if (gi && gi.errorRatio > 1 && gi.functional < 0.3) {
        // Error catastrophe: the genome outgrew copying accuracy (Eigen's threshold)
        const fid = act.adaptations.find((x) => x.id === 'a1-fid');
        const ok = fid && this.shopState(fid, dom).state === 'available';
        this.alert = {
          kind: 'warning',
          title: 'Error catastrophe',
          text: `Your genome (${Math.round(gi.L)} nucleotides) is longer than copying accuracy can carry (about ${Math.round(gi.Lmax)}). Most copies come out broken, so replication stalls. Improve copying accuracy.`,
          fix: ok ? { type: 'adaptation', id: fid!.id, label: fid!.name } : undefined,
        };
      } else if (stranded && a.time > 90 && q.ec < 0.6) this.alert = this.diagnose(false);
      else if (this.alert?.kind === 'warning') this.alert = null;
    }
  }

  private diagnose(crash: boolean): AlertSnap {
    const act = this.act!;
    const a = this.s.a!;
    const pools = this.cellPools();
    const pm = this.pm.slice(-60);
    for (const p of pools) {
      const spec = act.network.pools.find((x) => x.id === p.id)!;
      if (p.id.startsWith('adenylate')) continue;
      if (p.total > 0 && (p.share < 0.03 || p.share > 0.992)) {
        const other = spec.species.find((x) => x !== spec.charged) ?? '';
        const stuckAs = p.share < 0.06 ? other : spec.charged;
        const fixIds = act.fixes?.[p.id] ?? [];
        const fix = fixIds.map((id) => act.adaptations.find((x) => x.id === id)).find((ad) => ad && this.poolState(ad).state === 'available');
        const name = act.network.species.find((s) => s.id === stuckAs)?.name ?? stuckAs;
        return {
          kind: crash ? 'crash' : 'warning',
          title: crash ? 'Redox jam: the cells went dormant' : 'A pool is stranded',
          text: `${spec.name} is stranded as ${name}; everything upstream stalls.` + (fix ? ` Raise ${fix.name}.` : ' Add or boost a route that regenerates it.'),
          fix: fix ? { type: 'adaptation', id: fix.id, label: fix.name } : undefined,
          postmortem: pm,
        };
      }
    }
    const { key: fk, foodIn } = this.foodKey();
    if ((a.env[fk] ?? 0) < 0.08 * foodIn) {
      const niche = act.niches.find((n) => (a.niches[n.id] ?? 0) < n.levels && (!n.needsFlag || this.hasFlag(n.needsFlag)));
      return {
        kind: crash ? 'crash' : 'warning',
        title: crash ? 'Starvation: the cells went dormant' : 'Food is running low',
        text: 'The food supply is nearly gone; flux and energy charge fall. Expand into a new niche or evolve a better uptake enzyme.',
        fix: niche ? { type: 'niche', id: niche.id, label: niche.name } : undefined,
        postmortem: pm,
      };
    }
    const top = this.bottleneck();
    const ad = top ? act.adaptations.find((x) => x.target === top && this.shopState(x, this.dominant()).state === 'available') : undefined;
    return {
      kind: crash ? 'crash' : 'warning',
      title: crash ? 'Energy collapse: the cells went dormant' : 'Energy is falling',
      text: 'ATP demand outruns supply. Dormant cells barely die, so nothing is lost but growth.' + (top ? ` The control analysis points at ${this.rxName(top)}.` : ''),
      fix: ad ? { type: 'adaptation', id: ad.id, label: ad.name } : a.snapshots.length ? { type: 'rollback', id: String(a.snapshots.length - 1), label: 'Restore last stable genome' } : undefined,
      postmortem: pm,
    };
  }

  private rxName(id: string) {
    return this.act?.network.reactions.find((r) => r.id === id)?.name ?? id;
  }

  bottleneck(): string | null {
    if (!this.live) return null;
    let best: string | null = null;
    let bv = 0.04;
    for (const [k, v] of Object.entries(this.live.control)) {
      if (v > bv) {
        bv = v;
        best = k;
      }
    }
    return best;
  }

  private takeSnapshot() {
    const a = this.s.a!;
    const dom = this.dominant();
    const q = this.derived.perLineage.get(dom.id);
    if (!q || q.ec < 0.5 || q.dormant) return;
    const last = a.snapshots[a.snapshots.length - 1];
    const sig = dom.muts.map((m) => m.id).join(',');
    if (last && last.muts.map((m) => m.id).join(',') === sig) return;
    a.snapshots.push({ t: a.time, label: dom.name, muts: dom.muts.slice() });
    if (a.snapshots.length > 5) a.snapshots.shift();
  }

  // ---------- evolution ----------
  /** Variant names stay unique within an act: a second "Rotor bearing I" becomes "Rotor bearing I #2". */
  private uniqueName(base: string): string {
    const a = this.s.a!;
    const used = (a.names ??= {});
    for (const l of a.lineages) if (used[l.name] === undefined) used[l.name] = 1;
    const n = (used[base] ?? 0) + 1;
    used[base] = n;
    return n === 1 ? base : `${base} #${n}`;
  }

  private newLineage(parent: Lineage, mut: Mutation, freq: number, name?: string): Lineage {
    const a = this.s.a!;
    const l: Lineage = {
      id: a.nextId++,
      parent: parent.id,
      name: this.uniqueName(name ?? mut.label),
      muts: [...parent.muts, mut],
      freq,
      born: a.time,
      color: a.colorNext++ % 12,
    };
    parent.freq = Math.max(1e-9, parent.freq - freq);
    a.lineages.push(l);
    return l;
  }

  /** Genome length a trait adds: letters (nt) in Act I, genes (slots) later. Enzyme tunings add none. */
  geneLen(ad: AdaptationSpec): number {
    const act = this.act!;
    if (act.index === 1) return ad.effects.reduce((n, e) => n + (e.type === 'param' && e.key === 'L' ? e.add ?? 0 : 0), 0);
    if (ad.slots) return ad.slots;
    if (ad.kind === 'gene') {
      const flags = ad.effects.filter((e) => e.type === 'flag').map((e) => (e as { key: string }).key);
      return act.network.reactions.filter((r) => r.gene && r.requires && flags.includes(r.requires)).reduce((n, r) => n + (r.slots ?? 1), 0) || 1;
    }
    return 0;
  }

  /** Per-second rate at which a species picks a pooled gene up. */
  uptakeRate(l: Lineage, ad: AdaptationSpec): number {
    const act = this.act!;
    const tr = act.transfer ?? { lambda: act.index === 1 ? 40 : 3, how: '' };
    const base: Record<string, number> = { point: 0.006, dup: 0.005, gene: 0.004, regulator: 0.004, tier: 0.004, defence: 0.005, stage: 0.0025 };
    let u = (base[ad.kind] ?? 0.004) * (tr.rate ?? 1) * Math.exp(-this.geneLen(ad) / tr.lambda);
    for (const rc of tr.receivers ?? []) if (this.has(l, rc.has)) u *= rc.mul;
    if (this.hasFlag('sex')) u *= 1.5;
    return u;
  }

  /** How many levels of a trait are out in the world: in the pool or in the commonest species. */
  private poolLevel(id: string): number {
    const a = this.s.a!;
    const e = a.pool?.find((x) => x.id === id);
    return Math.max(e?.muts.length ?? 0, this.level(this.dominant(), id));
  }

  /** Can this trait be released (again)? Prerequisites count if they are pooled or common. */
  private poolState(ad: AdaptationSpec): { state: ShopItem['state']; needs: string[] } {
    const act = this.act!;
    const lev = this.poolLevel(ad.id);
    if (lev >= (ad.levels ?? 1)) return { state: 'owned', needs: [] };
    const needs: string[] = [];
    for (const r of ad.requires ?? []) if (this.poolLevel(r) === 0) needs.push(act.adaptations.find((x) => x.id === r)?.name ?? r);
    if (ad.needsFlag && !this.hasFlag(ad.needsFlag)) needs.push(ad.hint ?? 'Not yet reachable');
    for (const ex of ad.excludes ?? []) if (this.poolLevel(ex) > 0) return { state: 'owned', needs: ['excluded'] };
    return { state: needs.length ? 'locked' : 'available', needs };
  }

  adaptationCost(ad: AdaptationSpec, level: number): number {
    const act = this.act!;
    let c = ad.cost * Math.pow(ad.costGrowth ?? 2, level);
    // Physical limits: improvements near the diffusion limit get rarer.
    if (ad.levels && ad.levels > 1) c *= 1 + Math.pow(level / ad.levels, 3) * 2;
    c *= Math.pow(1.6, (ad.steps ?? 1) - 1);
    void act;
    return c;
  }

  private shopState(ad: AdaptationSpec, l: Lineage): { state: ShopItem['state']; needs: string[] } {
    const act = this.act!;
    const lev = this.level(l, ad.id);
    const max = ad.levels ?? 1;
    if (lev >= max) return { state: 'owned', needs: [] };
    // being swept in by another lineage?
    const needs: string[] = [];
    for (const r of ad.requires ?? []) {
      if (!this.has(l, r)) needs.push(act.adaptations.find((x) => x.id === r)?.name ?? r);
    }
    if (ad.needsFlag && !this.hasFlag(ad.needsFlag)) needs.push(ad.hint ?? 'Not yet reachable');
    for (const ex of ad.excludes ?? []) if (this.has(l, ex)) return { state: 'owned', needs: ['excluded'] };
    if (needs.length) return { state: 'locked', needs };
    // Only a real driven sweep, or a fresh purchase still finding its level, blocks buying again.
    const now = this.s.a!.time;
    const sweeping = this.s.a!.lineages.some((o) => o.id !== l.id && this.level(o, ad.id) > lev && (o.drive || (o.freq < 0.5 && o.muts.length > l.muts.length && now - o.born < 120)));
    return { state: sweeping ? 'sweeping' : 'available', needs };
  }

  /** Old name, kept for policies and the bot: buying a trait releases it into the pool. */
  buy(id: string, auto = false): boolean {
    return this.release(id, auto);
  }

  /**
   * Release a trait into the shared gene pool. Nobody is forced to carry it:
   * each species picks it up at its own rate, new combinations appear, and
   * selection decides which of them grow.
   */
  release(id: string, auto = false): boolean {
    const act = this.act;
    const a = this.s.a;
    if (!act || !a) return false;
    const ad = act.adaptations.find((x) => x.id === id);
    if (!ad) return false;
    if (this.poolState(ad).state !== 'available') return false;
    const lev = this.poolLevel(id);
    const cost = this.adaptationCost(ad, lev);
    if (a.variation < cost || a.block < (ad.block ?? 0)) return false;
    a.variation -= cost;
    a.block -= ad.block ?? 0;
    a.pool ??= [];
    let e = a.pool.find((x) => x.id === id);
    if (!e) {
      e = { id, muts: [], t: a.time, peak: 0 };
      a.pool.push(e);
    }
    // the pool holds one mutation per level; reuse a common species' alleles so genotypes match
    const dom = this.dominant();
    while (e.muts.length < lev) e.muts.push(dom.muts.filter((m) => m.adaptation === id)[e.muts.length] ?? { id: `${id}#${e.muts.length + 1}@pool`, adaptation: id, label: ad.name, effects: ad.effects });
    e.muts.push({ id: `${id}#${lev + 1}@pool`, adaptation: id, label: (ad.levels ?? 1) > 1 ? `${ad.name} ${roman(lev + 1)}` : ad.name, effects: ad.effects });
    e.t = a.time;
    e.noted = false;
    a.stats.purchases++;
    this.emit({ kind: 'purchase', id: ad.id, title: ad.name, text: auto ? 'Released by your policy' : 'Released into the gene pool', data: { target: ad.target } });
    for (const ef of ad.effects) if (ef.type === 'flag' && (ef.key === 'sex' || ef.key.startsWith('world.'))) this.addFlag(ef.key);
    if (ad.founds && this.s.world && !guildAlive(this.s.world, ad.founds as GuildId)) {
      found(this.s.world, ad.founds as GuildId, act.index, 0.05);
      this.s.world.log.push({ t: this.s.world.time, act: act.index, text: GUILDS[ad.founds as GuildId].name + ' appear' });
      this.emit({ kind: 'toast', title: GUILDS[ad.founds as GuildId].name + ' appear', text: 'A new branch of your tree joins the community. See the World screen.' });
    }
    if (this.hasFlag('sex')) this.recombine();
    return true;
  }

  /**
   * A readable name for a species: the gene it most recently picked up and how
   * many traits it carries ("Rotor bearing II · 9"); a letter tells apart
   * living species that would otherwise share a name.
   */
  private speciesName(muts: Mutation[]): string {
    const a = this.s.a!;
    const traits = muts.filter((m) => m.adaptation).length;
    const newest = muts[muts.length - 1];
    const base = newest ? `${newest.label} · ${traits}` : 'Original cells';
    const taken = new Set(a.lineages.map((l) => l.name));
    if (!taken.has(base)) return base;
    for (const c of 'bcdefghijklmnopqrstuvwxyz') if (!taken.has(`${base} ${c}`)) return `${base} ${c}`;
    return `${base} ${a.nextId}`;
  }

  /**
   * Gene flow from the pool: every species picks up pooled genes it lacks.
   * Cells that gained the same set of genes join that species; a new set
   * becomes a new species once enough cells (0.2% of all) share it.
   */
  private transferStep(dt: number) {
    const a = this.s.a!;
    const act = this.act!;
    const pool = a.pool ?? [];
    if (!pool.length) return;
    const key = (ms: Mutation[]) => ms.map((m) => m.id).sort().join('|');
    const byKey = new Map(a.lineages.map((l) => [key(l.muts), l]));
    a.pending ??= {};
    let created = false;
    for (const l of [...a.lineages]) {
      if (l.freq < 1e-6) continue;
      for (const e of pool) {
        const ad = act.adaptations.find((x) => x.id === e.id);
        if (!ad) continue;
        const have = this.level(l, e.id);
        if (have >= e.muts.length) continue;
        if ((ad.requires ?? []).some((r) => !this.has(l, r))) continue;
        if ((ad.excludes ?? []).some((x) => this.has(l, x))) continue;
        const flux = Math.min(l.freq * 0.5, l.freq * this.uptakeRate(l, ad) * dt);
        if (!(flux > 0)) continue;
        const muts = [...l.muts, ...e.muts.slice(have)];
        const k = key(muts);
        const target = byKey.get(k);
        if (target) {
          l.freq -= flux;
          target.freq += flux;
          continue;
        }
        a.pending[k] = (a.pending[k] ?? 0) + flux;
        if (!created && a.pending[k] >= 0.002) {
          const f0 = Math.min(a.pending[k], l.freq * 0.5);
          const nl = this.newLineage(l, e.muts[have], f0);
          nl.muts.push(...e.muts.slice(have + 1));
          nl.name = this.speciesName(nl.muts);
          nl.pooled = true;
          nl.tag = nl.id;
          byKey.set(k, nl);
          delete a.pending[k];
          created = true;
        }
      }
    }
    for (const k of Object.keys(a.pending)) {
      a.pending[k] *= Math.exp(-dt / 60);
      if (a.pending[k] < 1e-5) delete a.pending[k];
    }
    // a released gene that selection keeps rejecting: say so once
    for (const e of pool) {
      const share = a.lineages.reduce((n, l) => n + (this.level(l, e.id) >= e.muts.length ? l.freq : 0), 0);
      e.peak = Math.max(e.peak, share);
      if (!e.noted && a.time - e.t > 180 && share < 0.01) {
        e.noted = true;
        const name = act.adaptations.find((x) => x.id === e.id)?.name ?? e.id;
        a.rejected ??= {};
        const r = a.rejected[e.id] ?? { n: 0, s: 0 };
        a.rejected[e.id] = { n: r.n + 1, s: r.s };
        this.emit({ kind: 'toast', title: `${name} is not taking hold`, text: 'It is in the gene pool, but cells that carry it do not out-grow the rest here. Check the genome length and the map before releasing more.' });
      }
    }
  }

  /** With sex, beneficial mutations in different lineages combine instead of competing. */
  private recombine() {
    const a = this.s.a!;
    const dom = this.dominant();
    const all = new Map<string, Mutation>();
    for (const l of a.lineages) for (const m of l.muts) if (!all.has(m.id)) all.set(m.id, m);
    if (all.size === dom.muts.length) return;
    const muts = [...all.values()];
    const nl: Lineage = { id: a.nextId++, parent: dom.id, name: this.uniqueName('Recombinant'), muts, freq: 0.06, born: a.time, color: a.colorNext++ % 12 };
    for (const l of a.lineages) l.freq *= 0.94;
    a.lineages.push(nl);
  }

  private backgroundMutations(dt: number) {
    const act = this.act!;
    const a = this.s.a!;
    const dom = this.dominant();
    const rt = this.rt.get(dom.id);
    if (!rt?.params || !rt.table) return;
    const gi = this.genomeInfo(rt.params);
    const lnN = Math.max(1, this._P.log10().toNumber());
    const lambda = (act.pacing.bgMutRate / 60) * Math.sqrt(gi.U / act.pacing.U) * (lnN / 8);
    if (!this.rng.chance(lambda, dt)) return;
    const genes = act.network.reactions.filter((r) => r.gene && (!r.requires || rt.params!.flags.has(r.requires)));
    if (!genes.length) return;
    const r = this.rng.pick(genes);
    // Most mutations are neutral or harmful; only the rare beneficial ones can escape drift.
    if (this.rng.next() > 0.3) return;
    const kind = this.rng.next() < 0.6 ? 'kcat' : 'Km';
    const size = 0.04 + this.rng.exp(0.08);
    const eff: Effect = kind === 'kcat' ? { type: 'kcat', rxn: r.id, mul: 1 + size } : { type: 'Km', rxn: r.id, mul: 1 / (1 + size) };
    const mut: Mutation = {
      id: 'bg' + a.nextId + '-' + r.id,
      label: `${r.short} ${kind === 'kcat' ? 'kcat' : 'Km'} ${kind === 'kcat' ? '+' : '−'}${Math.round(size * 100)}%`,
      effects: [eff],
      background: true,
    };
    // Evaluate its real effect through the cell model (epistasis for free).
    const trial: Lineage = { ...dom, muts: [...dom.muts, mut] };
    const p = this.paramsOf(trial);
    const t = this.computeTable(trial, p);
    const { key: fk } = this.foodKey();
    const food = a.env[fk];
    const s = interp(t, food).mu / Math.max(1e-12, interp(rt.table, food).mu) - 1;
    if (s <= 0.002) return;
    // Patwa & Wahl 2008: establishment probability ≈ 2s.
    if (this.rng.next() > Math.min(1, 2 * s)) return;
    const nl = this.newLineage(dom, mut, 0.004);
    this.rt.set(nl.id, { key: this.keyOf(nl), table: t, params: p });
    this.emit({ kind: 'mutation', title: 'A free mutation', text: `A spontaneous change in ${r.name} (${mut.label}) escaped drift. s ≈ +${(s * 100).toFixed(1)}%.` });
  }

  private runPolicies() {
    const a = this.s.a!;
    const act = this.act!;
    const pol = this.s.policies;
    if (!this.s.policiesUnlocked || !pol.enabled) return;
    if (pol.niches) {
      for (const n of act.niches) this.buyNiche(n.id);
    }
    const dom = this.dominant();
    const items = act.adaptations
      .filter((ad) => this.poolState(ad).state === 'available')
      .filter((ad) => !(pol.skipStructural && (ad.kind === 'regulator' || ad.kind === 'stage' || ad.kind === 'tier' || ad.kind === 'gene')))
      .map((ad) => ({ ad, cost: this.adaptationCost(ad, this.level(dom, ad.id)) }))
      .filter((x) => a.block >= (x.ad.block ?? 0));
    if (!items.length) return;
    let pick = items.sort((x, y) => x.cost - y.cost)[0];
    if (pol.rule === 'control') {
      const top = this.bottleneck();
      const onTop = items.filter((x) => x.ad.target === top);
      if (onTop.length) pick = onTop.sort((x, y) => x.cost - y.cost)[0];
    }
    const reserveOk = a.variation - pick.cost >= pol.reserve * a.variation;
    if (a.variation >= pick.cost && reserveOk) {
      a.selected = dom.id;
      this.buy(pick.ad.id, true);
    }
  }

  private autoChores() {
    const act = this.act!;
    const a = this.s.a!;
    for (const ch of act.chores) {
      if (ch.control !== 'choice' || !this.automated(ch.id)) continue;
      const chosen = (a.chores[ch.id] as string[]) ?? [];
      const next = ch.options?.find((o) => !chosen.includes(o.id));
      if (next && a.block >= (next.cost ?? 0)) {
        a.block -= next.cost ?? 0;
        a.chores[ch.id] = [...chosen, next.id];
        this.emit({ kind: 'toast', title: ch.name, text: `${next.label}: handled by evolved regulation` });
      }
    }
  }

  nicheCost(id: string): Decimal {
    const act = this.act!;
    const n = act.niches.find((x) => x.id === id)!;
    const l = this.s.a!.niches[id] ?? 0;
    return dec(act.pacing.cellsPerSite).mul(act.pacing.biomassBase * n.cost).mul(Decimal.pow(n.growth, l));
  }

  buyNiche(id: string): boolean {
    const act = this.act;
    const a = this.s.a;
    if (!act || !a) return false;
    const n = act.niches.find((x) => x.id === id);
    if (!n) return false;
    const l = a.niches[id] ?? 0;
    if (l >= n.levels) return false;
    if (n.needsFlag && !this.hasFlag(n.needsFlag)) return false;
    const cost = this.nicheCost(id);
    if (this._biomass.lt(cost)) return false;
    this._biomass = this._biomass.sub(cost);
    a.niches[id] = l + 1;
    if (n.flag) this.addFlag(n.flag);
    if (n.flag === 'surface' && this.s.world) {
      const g = guildOf(this.s.world, 'photo');
      if (g) g.layer = 0;
    }
    this.storeDecimals();
    this.emit({ kind: 'purchase', id, title: n.name, text: 'New ground: carrying capacity ×' + n.capacity });
    return true;
  }

  // ---------- gates & transitions ----------
  gateSnap(): GateSnap {
    const act = this.act!;
    const conds = this.describeCond(act.gate.when);
    const fluxOk = this.derived.flux >= act.gate.flux;
    const ready = this.devGate || (fluxOk && this.evalCond(act.gate.when, 'gate'));
    return { ready, flux: this.derived.flux, fluxNeed: act.gate.flux, conds, text: act.gate.text, wall: act.gate.wall };
  }

  /** What carries into the next act: half the Variation, a tenth of the Biomass, leftovers as Reserves. */
  private carryOver(): { variation: number; biomass: Decimal; reserves: number } {
    const a = this.s.a;
    const act = this.act;
    if (this.s.act === 0) {
      const s0 = this.s.act0;
      return { variation: 0, biomass: dec(0), reserves: 0.1 * (s0.org + s0.nu + s0.fa) };
    }
    if (!a || !act) return { variation: 0, biomass: dec(0), reserves: 0 };
    const nextAct = this.acts[this.s.act + 1];
    const scale = nextAct ? nextAct.pacing.cellsPerSite / act.pacing.cellsPerSite : 1;
    return {
      variation: 0.5 * a.variation,
      biomass: this._biomass.mul(0.1 * scale),
      reserves: Math.max(0, a.block) * (act.reserveValue ?? 1),
    };
  }

  /** Upgrades of this act the dominant species does not own. */
  private unbought(): string[] {
    const act = this.act;
    if (!act || !this.s.a) return [];
    return act.adaptations.filter((ad) => this.poolState(ad).state !== 'owned').map((ad) => ad.name);
  }

  private advanceSnap(): AdvanceSnap | null {
    if (!this.s.a || !this.act || this.s.act >= FINALE_INDEX) return null;
    const c = this.carryOver();
    const unbought = this.unbought();
    return { ready: this.gateSnap().ready, next: this.s.act + 1, carry: { variation: c.variation, biomass: c.biomass.toString(), reserves: c.reserves }, unbought, complete: unbought.length === 0 };
  }

  private transition(to: number) {
    const from = this.s.act;
    const carry = this.carryOver();
    if (from === 0) this.s.records.sparkCycles = this.s.act0.cycles;
    this.checkAchievements(true);
    if (this.s.a && this.act) {
      const dom = this.dominant();
      const left = this.unbought();
      this.s.actGenomes.push({
        act: from,
        title: this.act.title,
        muts: dom.muts.filter((m) => m.adaptation).map((m) => m.label),
        summary: `Population 10^${this._P.log10().toNumber().toFixed(1)} · flux 10^${this.derived.flux.toFixed(1)} · ${this.s.a.stats.sweeps} sweeps` + (left.length ? ` · left unbought: ${left.slice(0, 4).join(', ')}${left.length > 4 ? ` and ${left.length - 4} more` : ''}` : ' · every upgrade owned'),
      });
      if (from === 6) this.s.branch = null; // chosen at the start of Act VII
      // owning every upgrade of an act is a permanent bonus
      if (!left.length && !this.s.completed.includes(from)) {
        this.s.completed.push(from);
        this.s.evolvability += 0.1;
        this.emit({ kind: 'toast', title: 'Act completed', text: `Every upgrade owned: Variation income ×${this.s.evolvability.toFixed(2)} from now on.` });
      }
    } else if (from === 0) {
      this.s.actGenomes.push({ act: 0, title: 'The spark', muts: ['QT45-like polymerase ribozyme'], summary: `${this.s.act0.cycles} cycles · strands averaging ${strandLength(this.s.act0.p).toFixed(1)} nt` });
    }
    this.s.reserves += carry.reserves;
    this.s.act = to;
    this.devGate = false;
    this.initAct(to);
    if (this.s.a) {
      this.s.a.variation += carry.variation;
      this._biomass = this._biomass.add(carry.biomass);
      this.storeDecimals();
    }
    this.emit({ kind: 'transition', data: { from, to, carry: { variation: carry.variation, biomass: carry.biomass.toString(), reserves: carry.reserves } } });
  }

  /** This act's raw material, named for the current branch. */
  private blockName(): string {
    const act = this.act;
    if (!act) return 'Raw material';
    for (const [f, name] of Object.entries(act.altBlock ?? {})) if (this.hasFlag(f)) return name;
    return act.blockName;
  }

  /** Reserves → this act's raw material, at half efficiency. */
  private drawReserves(amount: number): boolean {
    const a = this.s.a;
    if (!a || !(amount > 0)) return false;
    const n = Math.min(amount, this.s.reserves);
    if (n <= 0) return false;
    this.s.reserves -= n;
    a.block += 0.5 * n;
    return true;
  }

  /** Dev/testing: every species gains one level of a trait (and its prerequisites) at once. */
  private devOwn(id: string, depth = 0) {
    const act = this.act;
    const a = this.s.a;
    if (!act || !a || depth > 8) return;
    const ad = act.adaptations.find((x) => x.id === id);
    if (!ad) return;
    for (const r of ad.requires ?? []) if (!this.has(this.dominant(), r)) this.devOwn(r, depth + 1);
    const dom = this.dominant();
    const lev = this.level(dom, id);
    if (lev >= (ad.levels ?? 1)) return;
    const mut: Mutation = { id: ad.id + '#' + (lev + 1) + '@' + a.nextId++, adaptation: ad.id, label: (ad.levels ?? 1) > 1 ? `${ad.name} ${roman(lev + 1)}` : ad.name, effects: ad.effects };
    for (const l of a.lineages) if (this.level(l, id) === lev) l.muts = [...l.muts, mut];
    for (const e of ad.effects) if (e.type === 'flag') this.addFlag(e.key);
  }

  /** Dev/testing: jump straight to an act. */
  jumpTo(index: number) {
    this.s.act = index;
    if (index >= 3) this.s.world = seedWorld(index);
    this.initAct(index);
    this.emit({ kind: 'transition', data: { from: index - 1, to: index } });
  }

  advance(): boolean {
    if (this.s.act === 0) return false;
    if (this.s.act >= FINALE_INDEX) return false;
    if (!this.gateSnap().ready) return false;
    if (this.s.challengeRun) return this.endChallenge(true);
    this.transition(this.s.act + 1);
    return true;
  }

  // ---------- commands ----------
  command(cmd: Command): unknown {
    const a = this.s.a;
    switch (cmd.type) {
      case 'buy':
        return this.buy(cmd.id);
      case 'niche':
        return this.buyNiche(cmd.id);
      case 'select':
        if (a && this.lineage(cmd.lineage)) a.selected = cmd.lineage;
        return true;
      case 'view':
        if (a && this.lineage(cmd.lineage)) a.viewed = cmd.lineage;
        return true;
      case 'fidelity':
        if (a) a.fidelity = clamp(cmd.value, 1, this.act?.index === 1 ? 3 : 8);
        return true;
      case 'chore':
        return this.setChore(cmd.id, cmd.value);
      case 'advance':
        return this.advance();
      case 'act0': {
        const s0 = this.s.act0;
        if (cmd.action === 'cycle') startCycle(s0);
        else if (cmd.action === 'freeze') startFreeze(s0);
        else if (cmd.action === 'buy' && cmd.id) {
          const ok = buy0(s0, cmd.id);
          if (ok) this.emit({ kind: 'purchase', id: cmd.id, title: ACT0_UPGRADES.find((u) => u.id === cmd.id)?.name });
          return ok;
        }
        return true;
      }
      case 'experiment':
        return this.experiment(cmd.kind, cmd.rxn);
      case 'rollback':
        return this.rollback(cmd.index);
      case 'policies':
        this.s.policies = { ...cmd.policies };
        return true;
      case 'release':
        return this.release(cmd.id);
      case 'seen':
        if (!this.s.seen.includes(cmd.id)) this.s.seen.push(cmd.id);
        return true;
      case 'finaleBuy':
        return this.finaleBuy(cmd.id);
      case 'challenge': {
        const f = this.s.finale;
        if (!f || !f.won) return false;
        const best = f.challengeBest;
        const traits = f.traits;
        const nf = newFinale();
        nf.won = true;
        nf.traits = traits;
        nf.challengeBest = best;
        nf.best = f.best;
        nf.variation = f.variation;
        nf.challenge = cmd.id;
        this.s.finale = nf;
        return true;
      }
      case 'virusDone':
        if (!this.s.virusCampaign.done) {
          this.s.virusCampaign.done = true;
          this.emit({ kind: 'milestone', title: 'Transfer genes', text: 'Your virus carried genes between lineages. Variation income ×1.15 for the rest of the game.' });
        }
        return true;
      case 'benchSolved':
        if (!this.s.bench.includes(cmd.id)) {
          this.s.bench.push(cmd.id);
          if (a) a.variation += 15;
          this.emit({ kind: 'toast', title: 'Bench insight', text: 'Mechanism understood. +15 Variation, and the card is in your codex.' });
        }
        return true;
      case 'reserves':
        return this.drawReserves(cmd.amount);
      case 'worldBuy':
        return this.worldBuy(cmd.id);
      case 'actChallenge':
        return this.startChallenge(cmd.id);
      case 'abandonChallenge':
        return this.endChallenge(false);
      case 'dev':
        if (cmd.speed !== undefined) this.speed = cmd.speed;
        if (cmd.jump !== undefined && cmd.jump >= 0 && cmd.jump <= FINALE_INDEX) this.jumpTo(cmd.jump);
        if (cmd.flag && a) this.addFlag(cmd.flag);
        if (cmd.unflag && a) a.flags = a.flags.filter((f) => f !== cmd.unflag);
        if (cmd.grant && a) {
          a.variation += 1e4;
          a.block += 1e4;
          this._biomass = this._biomass.add(this.act ? dec(this.act.pacing.cellsPerSite).mul(1e8) : 0);
          this.storeDecimals();
        }
        if (cmd.grant && this.s.finale) this.s.finale.variation += 1e4;
        if (cmd.grant && this.s.act === 0) {
          this.s.act0.org += 500;
          this.s.act0.nu += 200;
          this.s.act0.fa += 100;
        }
        if (cmd.set) {
          const v = cmd.set;
          if (a && v.variation !== undefined) a.variation = v.variation;
          if (a && v.block !== undefined) a.block = v.block;
          if (a && v.biomass !== undefined) this._biomass = dec(v.biomass);
          if (this.s.finale && v.variation !== undefined) this.s.finale.variation = v.variation;
          if (v.reserves !== undefined) this.s.reserves = v.reserves;
          if (v.org !== undefined) this.s.act0.org = v.org;
          if (v.nu !== undefined) this.s.act0.nu = v.nu;
          if (v.fa !== undefined) this.s.act0.fa = v.fa;
          this.storeDecimals();
        }
        if (cmd.own) this.devOwn(cmd.own);
        if (cmd.ownAll && this.act) for (const ad of this.act.adaptations) for (let k = 0; k < (ad.levels ?? 1); k++) this.devOwn(ad.id);
        // Act 0: build every site upgrade to its top level, free
        if (cmd.ownAll && this.s.act === 0) for (const u of ACT0_UPGRADES) this.s.act0.up[u.id] = u.levels;
        if (cmd.forceGate !== undefined) this.devGate = !!cmd.forceGate;
        if (cmd.ff) this.offline(cmd.ff);
        if (cmd.spark && this.s.act === 0 && this.sparkT <= 0) {
          this.sparkT = 5.5;
          this.emit({ kind: 'spark', title: 'The spark', text: 'A strand that can copy itself has landed inside a vesicle. Heredity begins.' });
        }
        if (cmd.skip) {
          if (this.s.act === 0) this.transition(1);
          else if (this.s.act < FINALE_INDEX) this.transition(this.s.act + 1);
        }
        return true;
    }
    return false;
  }

  private setChore(id: string, value: string | number): boolean {
    const act = this.act;
    const a = this.s.a;
    if (!act || !a) return false;
    const ch = act.chores.find((c) => c.id === id);
    if (!ch) return false;
    if (ch.needsFlag && !this.hasFlag(ch.needsFlag)) return false;
    if (ch.control === 'choice') {
      const chosen = (a.chores[id] as string[]) ?? [];
      const o = ch.options?.find((x) => x.id === value);
      if (!o || chosen.includes(o.id) || a.block < (o.cost ?? 0)) return false;
      a.block -= o.cost ?? 0;
      a.chores[id] = [...chosen, o.id];
    } else {
      if (a.chores[id] === value) return false;
      a.chores[id] = value;
    }
    a.strikes[id] = (a.strikes[id] ?? 0) + 1;
    if (a.strikes[id] === 3 && !this.automated(id)) {
      const reg = act.adaptations.find((x) => x.id === ch.automatedBy);
      this.emit({ kind: 'strikes', title: 'Three times by hand', text: `Evolution can fix this in the genome: ${reg?.name ?? 'a regulator'} takes over this chore.`, id: ch.automatedBy });
    }
    return true;
  }

  private rollback(index: number): boolean {
    const a = this.s.a;
    if (!a) return false;
    const snap = a.snapshots[index];
    if (!snap) return false;
    const l: Lineage = { id: a.nextId++, parent: 0, name: 'Restored: ' + snap.label, muts: snap.muts.slice(), freq: 1, born: a.time, color: a.colorNext++ % 12 };
    a.lineages = [l];
    a.selected = a.viewed = a.dominantId = l.id;
    this.rt.clear();
    this.alert = null;
    a.crashed = false;
    this.emit({ kind: 'toast', title: 'Rolled back', text: 'The population now carries the restored genome.' });
    return true;
  }

  private finaleBuy(id: string): boolean {
    const f = this.s.finale;
    if (!f) return false;
    const t = FINALE_TRAITS.find((x) => x.id === id);
    if (!t) return false;
    const l = f.traits[id] ?? 0;
    if (l >= t.levels) return false;
    const c = traitCost(t, l);
    if (f.variation < c) return false;
    f.variation -= c;
    f.traits[id] = l + 1;
    this.emit({ kind: 'purchase', id, title: t.name });
    return true;
  }

  private experiment(kind: 'knockout' | 'overexpress' | 'inhibit', rxn: string): ExperimentResult | null {
    const act = this.act;
    const a = this.s.a;
    if (!act || !a || !this.live) return null;
    const l = this.lineage(a.viewed) ?? this.dominant();
    const p = this.paramsOf(l);
    const env = { ...a.env };
    const base = compile(act.network, p, env, this.live.s);
    const ss0 = steadyState(base.c, base.s);
    const mul = kind === 'knockout' ? 0.0 : kind === 'overexpress' ? 5 : 0.2;
    const eff: Effect = { type: 'E', rxn, mul: Math.max(mul, 1e-6) };
    const p2 = this.paramsOf(l, [eff]);
    const exp = compile(act.network, p2, env, ss0.s);
    const s = Float64Array.from(ss0.s);
    const series: Record<string, number[]> = {};
    const ids = exp.c.ids;
    ids.forEach((id) => (series[id] = []));
    const tArr: number[] = [];
    const growth: number[] = [];
    const v = new Float64Array(exp.c.rx.length);
    const T = 90;
    const N = 90;
    for (let i = 0; i <= N; i++) {
      if (i > 0) integrate(exp.c, s, T / N, 0.5);
      tArr.push((i * T) / N);
      ids.forEach((id, k) => series[id].push(s[k]));
      // growth flux
      const tmp = new Float64Array(exp.c.rx.length);
      void v;
      rates(exp.c, s, tmp);
      growth.push(exp.c.growthIdx >= 0 ? tmp[exp.c.growthIdx] / exp.c.Ccell : 0);
    }
    const res: ExperimentResult = {
      id: this.expId++,
      kind,
      rxn,
      label: `${kind === 'knockout' ? 'Knock out' : kind === 'overexpress' ? 'Overexpress ×5' : 'Inhibit ×0.2'} ${this.rxName(rxn)}`,
      t: tArr,
      series,
      growth,
      before: ss0.mu,
      after: growth[growth.length - 1],
    };
    this.experiments.unshift(res);
    if (this.experiments.length > 8) this.experiments.pop();
    this.emit({ kind: 'experiment', title: res.label, text: `Growth ${res.after > res.before ? 'rose' : 'fell'} to ${((res.after / Math.max(res.before, 1e-12)) * 100).toFixed(0)}% of before.`, data: res.id });
    return res;
  }

  // ---------- offline ----------
  offline(seconds: number): { seconds: number; summary: string[] } {
    const out: string[] = [];
    const sec = Math.min(seconds, 24 * 3600);
    if (sec < 30) return { seconds: 0, summary: [] };
    if (this.s.act === 0) {
      const s0 = this.s.act0;
      const before = molecules0(s0);
      let t = 0;
      while (t < sec) {
        const h = Math.min(2, sec - t);
        tick0(s0, h, this.rng, false);
        t += h;
      }
      out.push(`Chemistry ran for ${Math.round(sec / 60)} min: molecules ${fmtE(before)} → ${fmtE(molecules0(s0))}.`);
      if (sparkRate(s0).ready) out.push('The spark is overdue; it can strike any moment now.');
      return { seconds: sec, summary: out };
    }
    if (this.s.act >= FINALE_INDEX) {
      const f = this.s.finale!;
      const v0 = f.variation;
      let t = 0;
      while (t < sec) {
        const h = Math.min(1, sec - t);
        tickFinale(f, h, this.rng);
        t += h;
      }
      out.push(`The biosphere ran on its own. +${Math.round(f.variation - v0)} Variation. Best stable stretch ${Math.round(f.best)}s.`);
      return { seconds: sec, summary: out };
    }
    const a = this.s.a!;
    const P0 = this._P;
    const V0 = a.variation;
    const B0 = this._biomass;
    const sweeps0 = a.stats.sweeps;
    const crash0 = a.stats.crashes;
    let t = 0;
    const step = 2;
    let crashAt: number | null = null;
    while (t < sec) {
      const h = Math.min(step, sec - t);
      this.tickAct(h, false);
      if (a.crashed && crashAt === null) crashAt = t;
      t += h;
    }
    out.push(`Population ${fmtE(P0)} → ${fmtE(this._P)}.`);
    out.push(`+${Math.round(a.variation - V0)} Variation, +${fmtE(this._biomass.sub(B0).max(0))} Biomass.`);
    if (a.stats.sweeps > sweeps0) out.push(`${a.stats.sweeps - sweeps0} sweep${a.stats.sweeps - sweeps0 > 1 ? 's' : ''} completed while you were away.`);
    if (a.stats.crashes > crash0 && crashAt !== null) {
      const d = this.diagnose(true);
      out.push(`At ${Math.round(crashAt / 60)} min the cells went dormant: ${d.text}`);
      this.alert = d;
    }
    const others = a.lineages.filter((l) => l.id !== this.dominant().id && l.freq > 0.05);
    if (others.length) out.push(`A minority lineage (${others[0].name}) holds ${(others[0].freq * 100).toFixed(0)}% as insurance.`);
    return { seconds: sec, summary: out };
  }

  // ---------- snapshot ----------
  private poolSnap(): Snapshot['pool'] {
    const a = this.s.a!;
    const act = this.act!;
    const dom = this.dominant();
    return (a.pool ?? []).map((e) => {
      const ad = act.adaptations.find((x) => x.id === e.id)!;
      return {
        id: e.id,
        name: ad?.name ?? e.id,
        level: e.muts.length,
        share: a.lineages.reduce((n, l) => n + (this.level(l, e.id) >= e.muts.length ? l.freq : 0), 0),
        uptake: ad ? this.uptakeRate(dom, ad) * 60 : 0,
        len: ad ? this.geneLen(ad) : 0,
      };
    });
  }

  /** The viewed species' genome, gene by gene, plus pooled genes it lacks. */
  private genesOf(l: Lineage, p: Params): { genes: GenomeSnap['genes']; missing: GenomeSnap['missing'] } {
    const act = this.act!;
    const a = this.s.a!;
    const genes: GenomeSnap['genes'] = [];
    if (act.index === 1) {
      genes.push({ id: 'core', name: 'Replicase core', len: act.genome?.baseLen ?? 45, kind: 'core' });
      for (const m of l.muts) {
        const ad = m.adaptation ? act.adaptations.find((x) => x.id === m.adaptation) : undefined;
        const len = ad ? this.geneLen(ad) : 0;
        if (len > 0) genes.push({ id: m.id, name: m.label, len, kind: ad!.kind });
      }
    } else {
      for (const r of act.network.reactions) {
        if (!r.gene) continue;
        if (r.requires && !p.flags.has(r.requires)) continue;
        if (r.hiddenIf && p.flags.has(r.hiddenIf)) continue;
        genes.push({ id: r.id, name: r.name, len: r.slots ?? 1, kind: 'gene' });
      }
      for (const m of l.muts) {
        const ad = m.adaptation ? act.adaptations.find((x) => x.id === m.adaptation) : undefined;
        if (ad?.slots && ad.kind !== 'gene') genes.push({ id: m.id, name: m.label, len: ad.slots, kind: ad.kind });
      }
    }
    const missing: GenomeSnap['missing'] = [];
    for (const e of a.pool ?? []) {
      if (this.level(l, e.id) >= e.muts.length) continue;
      const ad = act.adaptations.find((x) => x.id === e.id);
      if (ad && this.geneLen(ad) > 0) missing.push({ id: e.id, name: ad.name, len: this.geneLen(ad), kind: ad.kind });
    }
    return { genes, missing };
  }

  private genomeSnap(): GenomeSnap | null {
    const act = this.act;
    const a = this.s.a;
    if (!act || !a) return null;
    const dom = this.lineage(a.viewed) ?? this.dominant();
    const rt = this.rt.get(dom.id);
    if (!rt?.params) return null;
    const p = rt.params;
    const gi = this.genomeInfo(p);
    const q = this.derived.perLineage.get(dom.id);
    const used = act.index === 1 ? gi.L : this.slotsUsed(dom, p);
    const tier = p.flags.has('mmr') ? 'DNA + repair' : p.flags.has('proof') ? 'DNA + proofreading' : p.flags.has('dna') || act.index > 2 ? 'DNA' : 'RNA';
    return {
      used,
      copyCap: act.index === 1 ? gi.Lmax : gi.copyCap,
      energyCap: act.index === 1 ? Infinity : this.energyCap(p, q?.carrier ?? a.ref.carrier),
      U: gi.U,
      fidelity: a.fidelity,
      fidelityRange: [1, act.index === 1 ? 3 : 8],
      tier: act.index >= 5 ? 'Eukaryotic' : tier,
      load: act.index === 1 ? 1 - gi.functional : 1 - Math.exp(-0.3 * gi.U),
      errorRatio: gi.errorRatio,
      genomeLen: gi.L,
      library: this.s.library,
      ...this.genesOf(dom, p),
      unit: act.index === 1 ? 'nt' : 'genes',
      species: dom.name,
    };
  }

  snapshot(): Snapshot {
    const s = this.s;
    const events = this.events;
    this.events = [];
    const base = {
      t: Date.now(),
      act: s.act,
      totalTime: s.totalTime,
      speed: this.speed,
      evolvability: s.evolvability,
      reserves: s.reserves,
      advance: this.advanceSnap(),
      reveals: s.revealsGlobal,
      seenCards: s.seen,
      events,
      policies: s.policies,
      policiesUnlocked: s.policiesUnlocked,
      actGenomes: s.actGenomes,
      won: s.won,
      virusCampaign: s.virusCampaign,
      experiments: this.experiments,
      branch: s.branch,
      pool: s.a && this.act ? this.poolSnap() : [],
      transferHow: this.act?.transfer?.how ?? '',
      world: s.act >= 3 ? this.worldSnap() : null,
      worldTraits: s.a ? this.worldTraitItems() : [],
      achievements: ACHIEVEMENTS.map((x) => ({ id: x.id, act: x.act, name: x.name, text: x.text, done: s.achievements.includes(x.id) })),
      achBonus: achievementBonus(s),
      challenges: CHALLENGES.map((c) => ({ id: c.id, act: c.act, name: c.name, text: c.text, bonus: c.bonus, done: s.challengesDone.includes(c.id), available: !s.challengeRun && this.challengeAvailable(c.act), running: s.challengeRun?.id === c.id })),
      challengeRun: s.challengeRun ? (() => {
        const c = CHALLENGES.find((x) => x.id === s.challengeRun!.id)!;
        return { id: c.id, name: c.name, text: c.text, act: c.act };
      })() : null,
      blockName: this.blockName(),
    };
    const empty = {
      actTime: 0,
      P: '0',
      K: '0',
      biomass: '0',
      variation: 0,
      block: 0,
      growth: 0,
      mu: 0,
      delta: 0,
      ec: 1,
      flux: 0,
      fluxPerCell: 0,
      vIncome: 0,
      bIncome: '0',
      env: {},
      food: '',
      foodLevel: 1,
      cell: null,
      lineages: [],
      dominant: 0,
      selected: 0,
      viewed: 0,
      shop: [],
      niches: [],
      chores: [],
      unlocked: [],
      gate: null,
      genome: null,
      alert: null,
      history: null,
      fluxHistory: [],
      flags: [],
      dayPhase: null,
      virus: null,
      snapshots: [],
      goe: 0,
      counts: { sweeps: 0, purchases: 0, crashes: 0 },
    };
    if (s.act === 0) {
      const s0 = s.act0;
      const r = rates0(s0);
      const sp = sparkRate(s0);
      return {
        ...base,
        ...empty,
        actTime: s0.time,
        act0: {
          time: s0.time,
          org: s0.org,
          nu: s0.nu,
          fa: s0.fa,
          rna: s0.rna,
          ves: s0.ves,
          p: s0.p,
          L: strandLength(s0.p),
          longShare: longShare(s0.p),
          wet: s0.wet,
          ice: s0.ice,
          cycleT: s0.cycleT,
          freezeT: s0.freezeT,
          cycles: s0.cycles,
          molecules: molecules0(s0),
          // join = free nucleotides joining strands; unjoin = strands breaking back into nucleotides
          rates: { org: r.orgProd, nu: r.nuProd, fa: r.faProd, join: r.poly, unjoin: 0.04 * s0.rna * (1 - s0.p) },
          upgrades: ACT0_UPGRADES.map((u) => {
            const lvl = s0.up[u.id] ?? 0;
            const cost = upgradeCost(u, lvl);
            const visible = (!u.needs || (s0.up[u.needs] ?? 0) > 0) && (u.id !== 'geyser' || s0.cycles >= 3) && (u.id !== 'imid' || s0.rna > 0.005);
            return { id: u.id, name: u.name, site: u.site, text: u.text, level: lvl, levels: u.levels, cost, affordable: canAfford0(s0, u), visible, card: u.card };
          }),
          spark: { ready: sp.ready, lambda: sp.lambda, chem: sp.chem, overdue: s0.overdue },
          sparkT: this.sparkT,
          strands: this.act0Strands,
          auto: (s0.up.geyser ?? 0) > 0,
          iceUnlocked: (s0.up.ice ?? 0) > 0,
        },
      };
    }
    if (s.act >= FINALE_INDEX) {
      const f = s.finale!;
      const p = finaleParams(f);
      return {
        ...base,
        ...empty,
        actTime: f.time,
        finale: {
          time: f.time,
          vals: { Pr: f.Pr, Co: f.Co, Mi: f.Mi, Vi: f.Vi, De: f.De, CO2: f.CO2, O2: f.O2, N: f.N },
          bands: BANDS,
          inBand: inBands(f),
          stable: f.stable,
          best: f.best,
          win: WIN_SECONDS,
          won: f.won,
          light: lightAt(f, p),
          traits: FINALE_TRAITS.map((t) => {
            const l = f.traits[t.id] ?? 0;
            const c = traitCost(t, l);
            return { id: t.id, guild: t.guild, name: t.name, text: t.text, level: l, levels: t.levels, cost: c, affordable: f.variation >= c && l < t.levels, card: t.card };
          }),
          variation: f.variation,
          perturb: f.perturb?.text ?? null,
          challenge: f.challenge,
          challenges: FINALE_CHALLENGES.map((c) => ({ id: c.id, name: c.name, text: c.text, best: f.challengeBest[c.id] ?? 0 })),
          hist: f.hist,
          roster: f.roster
            ? ROSTER_ROLES.map((r) => ({
                id: r.id,
                name: this.s.world?.guilds.some((g) => g.id === r.id) ? this.guildName(r.id as GuildId) : GUILDS[r.id as GuildId].name,
                role: r.role,
                alive: f.roster!.includes(r.id),
                cost: Object.entries(r.missing)
                  .map(([k, m]) => (ROSTER_PARAM[k] ?? k) + (k === 'selfC' ? ' unsteady' : ` ×${m}`))
                  .join(', '),
              }))
            : null,
        },
      };
    }
    const act = this.act!;
    const a = s.a!;
    const dom = this.dominant();
    const sel = this.lineage(a.selected) ?? dom;
    const d = this.derived;
    const domMu = d.perLineage.get(dom.id)?.mu ?? 0;
    const lineages: LineageSnap[] = a.lineages.map((l) => {
      const q = d.perLineage.get(l.id);
      return {
        id: l.id,
        parent: l.parent,
        name: l.name,
        freq: l.freq,
        color: l.color,
        mu: q?.mu ?? 0,
        delta: q?.delta ?? 0,
        s: domMu > 0 && q ? q.mu / domMu - 1 : 0,
        dormant: q?.dormant ?? false,
        muts: l.muts.map((m) => ({ id: m.id, label: m.label, background: m.background })),
        born: l.born,
        bought: !!l.bought,
        tag: l.tag ?? l.id,
      };
    });
    const shop: ShopItem[] = act.adaptations
      .map((ad) => {
        const st = this.poolState(ad);
        const lev = this.poolLevel(ad.id);
        const cost = this.adaptationCost(ad, lev);
        const alt = Object.entries(ad.alt ?? {}).find(([f]) => this.hasFlag(f))?.[1];
        return {
          id: ad.id,
          name: alt?.name ?? ad.name,
          kind: ad.kind,
          molecular: alt?.molecular ?? ad.molecular,
          local: alt?.local ?? ad.local,
          target: ad.target,
          cost,
          block: ad.block ?? 0,
          level: lev,
          levels: ad.levels ?? 1,
          state: st.state,
          affordable: a.variation >= cost && a.block >= (ad.block ?? 0),
          needs: st.needs,
          card: alt?.card ?? ad.card,
          automates: ad.automates,
          slots: ad.slots ?? 0,
          steps: ad.steps ?? 1,
          isNew: !s.seen.includes('ad:' + ad.id),
          rejected: a.rejected?.[ad.id]?.n ?? 0,
          rejectedS: a.rejected?.[ad.id]?.s ?? 0,
          share: a.lineages.reduce((acc, o) => acc + (this.has(o, ad.id) ? o.freq : 0), 0),
          uptake: this.uptakeRate(dom, ad) * 60,
          len: this.geneLen(ad),
          pooled: a.pool?.some((e) => e.id === ad.id) ? a.lineages.reduce((n, l) => n + (this.level(l, ad.id) >= lev ? l.freq : 0), 0) : null,
        } as ShopItem;
      })
      // Adjacent possible: show available, owned, and locked items one step away.
      .filter((it) => {
        if (it.state !== 'locked') return true;
        const ad = act.adaptations.find((x) => x.id === it.id)!;
        const reqMissing = (ad.requires ?? []).filter((r) => !this.has(sel, r));
        const deep = reqMissing.some((r) => {
          const ra = act.adaptations.find((x) => x.id === r);
          return ra && (ra.requires ?? []).some((rr) => !this.has(sel, rr));
        });
        return !deep;
      });
    const niches: NicheItem[] = act.niches
      .filter((n) => !n.needsFlag || this.hasFlag(n.needsFlag))
      .map((n) => {
        const cost = this.nicheCost(n.id);
        const l = a.niches[n.id] ?? 0;
        return { id: n.id, name: n.name, text: n.text, level: l, levels: n.levels, cost: cost.toString(), affordable: l < n.levels && this._biomass.gte(cost), capacity: n.capacity };
      });
    const chores: ChoreItem[] = act.chores
      .filter((ch) => (!ch.needsFlag || this.hasFlag(ch.needsFlag)) && this.choreRevealed(ch.id))
      .map((ch) => {
        const v = a.chores[ch.id];
        return {
          id: ch.id,
          name: ch.name,
          text: ch.text,
          control: ch.control,
          automated: this.automated(ch.id),
          value: v,
          options: (ch.options ?? []).map((o) => ({
            id: o.id,
            label: o.label,
            cost: o.cost,
            chosen: Array.isArray(v) ? v.includes(o.id) : v === o.id,
            affordable: a.block >= (o.cost ?? 0),
          })),
          strikes: a.strikes[ch.id] ?? 0,
          automatedBy: ch.automatedBy,
        };
      });
    const history = this.sendHistory ? a.history : null;
    this.sendHistory = false;
    const virus = act.virus ? { active: this.hasFlag('virus'), name: act.virus.name, pressure: this.hasFlag('virus') ? act.virus.strength * dom.freq * dom.freq : 0 } : null;
    const cyc = act.dayCycle;
    return {
      ...base,
      ...empty,
      actTime: a.time,
      P: this._P.toString(),
      K: dec(this.capacity()).toString(),
      biomass: this._biomass.toString(),
      variation: a.variation,
      block: a.block,
      growth: d.growth,
      mu: d.mu,
      delta: d.delta,
      ec: d.ec,
      flux: d.flux,
      fluxPerCell: d.fluxPerCell,
      vIncome: d.vIncome,
      bIncome: d.bIncome.toString(),
      env: { ...a.env },
      food: this.foodKey().key,
      foodLevel: this.stat('food'),
      cell: this.cellSnap(),
      lineages,
      dominant: dom.id,
      selected: sel.id,
      viewed: a.viewed,
      shop,
      niches,
      chores,
      unlocked: a.fired,
      gate: this.gateSnap(),
      genome: this.genomeSnap(),
      alert: this.alert,
      history,
      fluxHistory: this.fluxHist.slice(),
      flags: a.flags,
      dayPhase: cyc && (!act.envDyn?.[cyc.key]?.cycle?.flag || this.hasFlag(act.envDyn[cyc.key].cycle!.flag!)) ? (((a.time / cyc.period + 0.06) % 1) + 1) % 1 : null,
      virus,
      snapshots: a.snapshots.map((x) => ({ t: x.t, label: x.label })),
      goe: a.goe,
      counts: { sweeps: a.stats.sweeps, purchases: a.stats.purchases, crashes: a.stats.crashes },
    };
  }

  private choreRevealed(id: string): boolean {
    const act = this.act!;
    const a = this.s.a!;
    const u = act.unlocks.find((x) => x.reveals?.includes('chores') || x.id === 'u.' + id);
    if (!u) return true;
    return a.fired.includes(u.id) || act.unlocks.every((x) => !(x.reveals ?? []).includes('chores'));
  }

  private cellSnap(): CellSnap | null {
    const act = this.act;
    const L = this.live;
    if (!act || !L) return null;
    const v = new Float64Array(L.c.rx.length);
    rates(L.c, L.s, v);
    const sat: number[] = L.c.rx.map((r, j) => (r.vmax > 0 && r.law === 0 ? clamp(v[j] / r.vmax, 0, 1) : 1));
    const pile: string[] = [];
    act.network.species.forEach((sp) => {
      if (sp.kind !== 'main') return;
      const i = L.c.index[sp.id];
      if (i === undefined) return;
      if (L.s[i] > Math.max(3 * sp.init, 1.2)) pile.push(sp.id);
    });
    const bval: Record<string, number> = {};
    L.c.bIds.forEach((id, i) => (bval[id] = L.c.bval[i]));
    return {
      genotypeKey: L.key,
      ids: L.c.ids,
      conc: Array.from(L.s),
      rx: L.c.rx.map((r) => r.id),
      v: Array.from(v),
      sat,
      control: L.control,
      bottleneck: this.bottleneck(),
      pools: this.cellPools(),
      pile,
      bval,
      present: L.c.rx.map((r) => r.id),
      flags: [...L.c.params.flags],
      globals: { ...L.c.params.globals },
      eff: Object.fromEntries(L.c.rx.filter((r) => r.law === 0).map((r) => [r.id, { vmax: r.vmax, km: r.subKm[0] ?? 0 }])),
    };
  }

  serialize(): GameState {
    this.storeDecimals();
    this.s.saved = Date.now();
    this.s.rng = this.rng.state;
    return JSON.parse(JSON.stringify(this.s));
  }
}

function fmtE(x: number | Decimal): string {
  const d = x instanceof Decimal ? x : dec(x);
  if (d.lt(1e4)) return d.toNumber().toFixed(0);
  const e = d.log10().floor().toNumber();
  return (d.div(Decimal.pow(10, e)).toNumber()).toFixed(2) + 'e' + e;
}

