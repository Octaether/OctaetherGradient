// Content and state types. Content is pure data (src/content/*.json); the sim
// interprets it. The UI only ever reads snapshots.

export type PoolColor =
  | 'atp'
  | 'nad'
  | 'proton'
  | 'carbon'
  | 'oxygen'
  | 'light'
  | 'nitrogen'
  | 'rna'
  | 'lipid'
  | 'sulfur';

export type Evidence = 'Established' | 'Likely' | 'Contested' | 'Convenience';

export interface SpeciesSpec {
  id: string;
  name: string;
  plain: string;
  pool: PoolColor;
  init: number; // mM (internal) or default env value (boundary)
  kind: 'main' | 'cofactor' | 'boundary';
  env?: string; // boundary: which environment variable supplies it
  x?: number;
  y?: number;
  card?: string;
  compartment?: string;
  label?: 'above' | 'below' | 'left' | 'right';
  /** Drawn as a small +/− tag on the arrows that use it (like CO₂), never as a node with lines. */
  tag?: boolean;
  smiles?: string;
}

export interface ModSpec {
  species: string;
  type: 'inh' | 'act';
  K: number;
  n?: number;
  basal?: number;
}

export interface LawSpec {
  type: 'mm' | 'ma' | 'diff' | 'supply';
  kcat?: number;
  Km?: Record<string, number>;
  Keq?: number;
  k?: number;
  kr?: number;
  a?: string;
  b?: string;
  max?: number; // supply: saturates as the first product approaches max
  scale?: string[]; // global params that multiply the rate
  cat?: string; // catalyst species whose concentration multiplies the rate (ribozymes)
}

export interface ReactionSpec {
  id: string;
  name: string;
  short: string;
  plain?: string;
  gene?: boolean; // an enzyme the player can evolve (and MCA ranks)
  /** Species this reaction shows as small tags instead of lines (minor side substrates). */
  tags?: string[];
  sub: Record<string, number>;
  prod: Record<string, number>;
  law: LawSpec;
  E?: number;
  mods?: ModSpec[];
  requires?: string; // flag set by an adaptation or unlock
  hiddenIf?: string; // flag that removes it (e.g. branch choice)
  steps?: number; // >1 = steps collapsed into one edge
  slots?: number;
  x: number;
  y: number;
  card?: string;
  compartment?: string;
  bend?: number; // curvature of drawn edges
  hide?: boolean; // not drawn on the map (maintenance, leaks)
}

export interface PoolSpec {
  id: string;
  name: string;
  plain: string;
  pool: PoolColor;
  charged: string; // the "useful" form (ATP, NAD+ ...) whose share is shown
  species: string[];
}

export interface CompartmentSpec {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  requires?: string;
}

export interface NetworkSpec {
  species: SpeciesSpec[];
  reactions: ReactionSpec[];
  pools: PoolSpec[];
  growth: string; // reaction whose flux builds new cells
  uptake: string; // reaction consuming the shared food
  carrier: string[]; // reactions whose flux is the act's "Flux"
  Ccell: number; // flux-seconds per new cell (growth = J_growth / Ccell)
  dilution?: boolean;
  ec?: { atp: string; adp: string };
  compartments?: CompartmentSpec[];
  params?: Record<string, number>;
  width?: number;
  height?: number;
  /** 'fixed' keeps the authored positions (no automatic cycle shapes). */
  layout?: 'auto' | 'fixed';
}

export type Effect =
  | { type: 'kcat'; rxn: string; mul: number }
  | { type: 'Km'; rxn: string; mul: number; species?: string }
  | { type: 'E'; rxn: string; mul: number }
  | { type: 'K'; rxn: string; species: string; mul: number } // regulation constant
  | { type: 'mod'; rxn: string; mod: ModSpec }
  | { type: 'flag'; key: string }
  | { type: 'unflag'; key: string }
  | { type: 'param'; key: string; mul?: number; add?: number; set?: number };

export interface AdaptationSpec {
  id: string;
  name: string;
  kind: 'point' | 'dup' | 'gene' | 'regulator' | 'stage' | 'defence' | 'tier';
  molecular: string; // the molecular change
  local: string; // its local effect on the enzyme
  target?: string; // reaction id (for map highlight)
  effects: Effect[];
  cost: number; // Variation
  block?: number; // building-block cost
  steps?: number;
  requires?: string[]; // adaptation ids
  needsFlag?: string; // unlock/world flag
  excludes?: string[];
  levels?: number; // repeatable
  costGrowth?: number;
  slots?: number;
  card?: string;
  automates?: string; // chore id it automates
  hint?: string; // shown on locked silhouette
  success?: number; // share of chosen cells that take it up (default by kind)
  /** Releasing it founds a new species in the World (e.g. oxygen breathers). */
  founds?: string;
  /** Different biology for the same step, keyed by an act flag (seaweed vs animals). */
  alt?: Record<string, { name?: string; molecular?: string; local?: string; card?: string }>;
}

export interface NicheSpec {
  id: string;
  name: string;
  text: string;
  cost: number; // in Biomass (multiplied by act base)
  growth: number; // cost multiplier per level
  levels: number;
  capacity: number; // multiplier on carrying capacity per level
  supply?: Record<string, number>; // env additions per level
  needsFlag?: string;
  /** Act flag set once any level is bought (e.g. 'surface' brings day and night). */
  flag?: string;
}

export type Condition =
  | { stat: string; op: '<' | '>' | '>=' | '<='; value: number; for?: number; label?: string }
  | { has: string; label?: string }
  | { flag: string; label?: string }
  | { all: Condition[] }
  | { any: Condition[] };

export interface UnlockSpec {
  id: string;
  title: string;
  when: Condition;
  flags?: string[];
  card: string; // science card id
  tutorial: string; // <= 3 sentences
  highlight?: string; // element id
  demo?: { rxn: string; seconds: number };
  event?: string;
  reveals?: string[]; // panel ids
}

export interface ActSpec {
  id: string;
  index: number;
  title: string;
  era: string;
  unit: [string, string];
  screen: string;
  blockName: string;
  /**
   * How released genes spread through the population. Each species picks a
   * pooled gene up at base(kind) × rate × e^(−length/lambda) per second, times
   * the factor of any receiver trait it carries (e.g. a tighter membrane).
   * Length is letters (nt) in Act I and genes (slots) later.
   */
  transfer?: { lambda: number; rate?: number; receivers?: { has: string; mul: number; why: string }[]; how: string; card?: string };
  /** Reserves gained per unit of leftover raw material when the act ends (default 1). */
  reserveValue?: number;
  blockPool: PoolColor;
  intro: string;
  quote: string;
  network: NetworkSpec;
  env: Record<string, number>;
  food: string; // env key of the shared food
  foodIn: number; // supply concentration
  pacing: {
    g: number; // generations per second at the reference growth rate
    k: number; // Variation constant
    delta0: number; // basal death relative to reference growth
    U: number; // mutation rate per genome per generation at default fidelity
    cellsPerSite: number;
    blockRate: number;
    biomassBase: number;
    bgMutRate: number; // background mutation events per minute
    carrierScale: number; // molecules per second per mM/s per cell (display)
  };
  adaptations: AdaptationSpec[];
  niches: NicheSpec[];
  unlocks: UnlockSpec[];
  chores: ChoreSpec[];
  gate: { flux: number; when: Condition; text: string; wall: string };
  virus?: { name: string; startsWhen: Condition; strength: number; defences: string[]; text: string };
  events?: EventSpec[];
  foodSwitch?: { flag: string; food: string; foodIn: number }[];
  envDyn?: Record<string, EnvDynSpec>;
  damage?: { rxn?: string; species?: string; param?: string; k: number; label: string }[];
  genome?: { copyCap: number; energyCap?: number; baseLen?: number; epsMin?: number };
  fixes?: Record<string, string[]>;
  dayCycle?: { key: string; period: number };
  /** The building-block name under an act flag (seaweed counts CO₂ supply, not oxygen). */
  altBlock?: Record<string, string>;
}

export interface EnvDynSpec {
  relax?: number; // rate back toward the base value
  flux?: number; // scale on the population's net production of this boundary species
  cycle?: { period: number; min: number; max: number; flag?: string; steady?: number }; // base value oscillates (day/night); with `flag`, only once it is set (else × steady)
  sink?: { capacity: number; rate: number }; // e.g. reduced iron soaking up O2 until exhausted
  max?: number;
}

export interface ChoreSpec {
  id: string;
  name: string;
  text: string;
  automatedBy: string; // adaptation id
  control: 'toggle' | 'slider' | 'choice';
  options?: { id: string; label: string; cost?: number; effects: Effect[] }[];
  param?: string;
  needsFlag?: string;
}

export interface EventSpec {
  id: string;
  when: Condition;
  title: string;
  text: string;
  env?: Record<string, number>; // multiply env
  flags?: string[];
  once?: boolean;
  ramp?: number; // seconds over which env multipliers take effect
  /** A species of the World this event brings in (the archaea when the domains split). */
  founds?: string;
}

export interface ScienceCard {
  id: string;
  title: string;
  evidence: Evidence;
  body: string;
  number: string;
  source: string;
  category: string;
  smiles?: string;
  pdb?: string;
  simplification?: string;
  scaling?: string;
}

export interface Mutation {
  id: string;
  adaptation?: string;
  label: string;
  effects: Effect[];
  background?: boolean;
}

export interface Genotype {
  muts: Mutation[];
}
