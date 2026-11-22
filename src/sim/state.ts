// Everything that is saved: the shape of a save, a fresh state, and migration
// between save versions. Pure data, no behaviour.
import { newAct0, type Act0State } from './act0';
import type { FinaleState } from './finale';
import type { WorldState } from './world';
import type { MullerSample, Policies } from './snapshot';
import type { Mutation } from './types';

export const SAVE_VERSION = 1;
export const FINALE_INDEX = 8;

export interface Lineage {
  id: number;
  parent: number;
  name: string;
  muts: Mutation[];
  freq: number;
  born: number;
  color: number;
  drive?: boolean; // selection is amplifying a structural step (game convenience)
  bought?: boolean; // created by the player's purchase
  tag?: number; // stable key for the player's name for this variant
  pooled?: boolean; // formed by picking up genes from the shared pool
}

export interface ActState {
  index: number;
  time: number;
  /** Genes released into the shared pool: each holds one mutation per level released so far. */
  pool?: { id: string; muts: Mutation[]; t: number; peak: number; noted?: boolean }[];
  /** Cells part-way to forming a new combination (genotype key → share of the population). */
  pending?: Record<string, number>;
  P: string;
  biomass: string;
  dead: string;
  variation: number;
  block: number;
  env: Record<string, number>;
  envMul: Record<string, number>;
  sink: Record<string, number>;
  lineages: Lineage[];
  nextId: number;
  selected: number;
  viewed: number;
  niches: Record<string, number>;
  flags: string[];
  chores: Record<string, string | number | string[]>;
  strikes: Record<string, number>;
  fired: string[]; // unlock + event ids
  timers: Record<string, number>;
  history: MullerSample[];
  histDt: number;
  histNext: number;
  fidelity: number;
  snapshots: { t: number; label: string; muts: Mutation[] }[];
  ref: { mu: number; u: number; carrier: number };
  stats: { sweeps: number; purchases: number; crashes: number; maxFlux: number };
  dominantId: number;
  crashed: boolean;
  goe: number;
  colorNext: number;
  readyNoted?: boolean; // the player was told the goals are met
  names?: Record<string, number>; // how many variants have used each name this act
  rejected?: Record<string, { n: number; s: number }>;
  ramps?: { key: string; from: number; to: number; start: number; dur: number }[];
}

export interface GameState {
  version: number;
  seed: number;
  rng: number;
  created: number;
  saved: number;
  act: number;
  totalTime: number;
  act0: Act0State;
  a: ActState | null;
  finale: FinaleState | null;
  evolvability: number;
  actGenomes: { act: number; title: string; muts: string[]; summary: string }[];
  seen: string[];
  revealsGlobal: string[];
  policies: Policies;
  policiesUnlocked: boolean;
  won: boolean;
  virusCampaign: { unlocked: boolean; done: boolean };
  bench: string[];
  library: string[];
  branch: 'alga' | 'hetero' | null;
  /** Stored energy carried between acts (polyphosphate, glycogen, lipid droplets). */
  reserves: number;
  /** Acts in which every upgrade was owned (each gives a permanent bonus). */
  completed: number[];
  /** The community, from Act III on: every species you raised. */
  world: WorldState | null;
  /** Achievement ids earned (each is a small permanent bonus). */
  achievements: string[];
  /** Act challenges finished (each is a permanent bonus). */
  challengesDone: string[];
  /** A challenge being played: the real game waits in `saved` until it ends. */
  challengeRun: { id: string; saved: string; started: number } | null;
  /** Running records some achievements need (first crash recovered, error peaks...). */
  records: Record<string, number>;
}

export function newState(seed: number): GameState {
  return {
    version: SAVE_VERSION,
    seed,
    rng: seed,
    created: Date.now(),
    saved: Date.now(),
    act: 0,
    totalTime: 0,
    act0: newAct0(),
    a: null,
    finale: null,
    evolvability: 1,
    actGenomes: [],
    seen: [],
    revealsGlobal: [],
    policies: { enabled: false, rule: 'control', skipStructural: true, reserve: 0.2, niches: false },
    policiesUnlocked: false,
    won: false,
    virusCampaign: { unlocked: false, done: false },
    bench: [],
    library: [],
    branch: null,
    reserves: 0,
    completed: [],
    world: null,
    achievements: [],
    challengesDone: [],
    challengeRun: null,
    records: {},
  };
}

/** One migration function per save version, from the first commit. */
export function migrate(s: GameState): GameState {
  const out = { ...newState(s.seed ?? 1), ...s };
  if (!out.version) out.version = 1;
  // v1 is current. Future: if (out.version === 1) { ...; out.version = 2; }
  return out;
}
