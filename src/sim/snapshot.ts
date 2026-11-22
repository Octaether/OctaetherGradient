// What the worker sends to the UI. Plain data only; Decimals travel as strings.

export interface ShopItem {
  id: string;
  name: string;
  kind: string;
  molecular: string;
  local: string;
  target?: string;
  cost: number;
  block: number;
  level: number;
  levels: number;
  state: 'available' | 'locked' | 'owned' | 'sweeping';
  affordable: boolean;
  needs: string[];
  card?: string;
  automates?: string;
  slots: number;
  steps: number;
  isNew: boolean;
  rejected: number;
  rejectedS: number;
  share: number; // fraction of the population carrying it
  /** Share of the commonest species that picks it up per minute from the pool. */
  uptake: number;
  /** Genome length it adds: letters (Act I) or genes (later). */
  len: number;
  /** Already released: share of the population carrying the released level. */
  pooled: number | null;
}

export interface NicheItem {
  id: string;
  name: string;
  text: string;
  level: number;
  levels: number;
  cost: string;
  affordable: boolean;
  capacity: number;
}

export interface ChoreItem {
  id: string;
  name: string;
  text: string;
  control: string;
  automated: boolean;
  value: string | number | string[];
  options: { id: string; label: string; cost?: number; chosen?: boolean; affordable?: boolean }[];
  strikes: number;
  automatedBy: string;
}

export interface LineageSnap {
  id: number;
  parent: number;
  name: string;
  freq: number;
  color: number;
  mu: number;
  delta: number;
  s: number; // selection coefficient relative to dominant
  dormant: boolean;
  muts: { id: string; label: string; background?: boolean }[];
  born: number;
  bought: boolean;
  tag: number;
}

export interface CellSnap {
  genotypeKey: string;
  ids: string[];
  conc: number[];
  rx: string[];
  v: number[];
  sat: number[]; // v / vmax (0..1) for fading starved reactions
  control: Record<string, number>;
  bottleneck: string | null;
  pools: { id: string; share: number; total: number }[];
  pile: string[];
  bval: Record<string, number>;
  present: string[];
  flags: string[];
  globals: Record<string, number>;
  eff: Record<string, { vmax: number; km: number }>;
}

export interface GateSnap {
  ready: boolean;
  flux: number;
  fluxNeed: number;
  conds: { text: string; ok: boolean }[];
  text: string;
  wall: string;
}

export interface GenomeSnap {
  used: number;
  copyCap: number;
  energyCap: number;
  U: number;
  fidelity: number;
  fidelityRange: [number, number];
  tier: string;
  load: number;
  errorRatio: number;
  genomeLen: number;
  library: string[];
  /** The viewed species' genome, gene by gene (length in letters in Act I, genes later). */
  genes: { id: string; name: string; len: number; kind: string }[];
  /** Pooled genes this species does not carry yet. */
  missing: { id: string; name: string; len: number; kind: string }[];
  unit: 'nt' | 'genes';
  species: string;
}

export interface AlertSnap {
  kind: 'crash' | 'warning' | 'dormant';
  title: string;
  text: string;
  fix?: { type: 'adaptation' | 'niche' | 'chore' | 'rollback'; id: string; label: string };
  postmortem?: { t: number; pools: Record<string, number> }[];
}

export interface GameEvent {
  kind:
    | 'toast'
    | 'unlock'
    | 'sweep'
    | 'mutation'
    | 'transition'
    | 'spark'
    | 'purchase'
    | 'event'
    | 'crash'
    | 'experiment'
    | 'goe'
    | 'milestone'
    | 'win'
    | 'strikes'
    | 'achievement'
    | 'lost';
  title?: string;
  text?: string;
  id?: string;
  data?: unknown;
}

export interface AdvanceSnap {
  ready: boolean;
  next: number;
  carry: { variation: number; biomass: string; reserves: number };
  unbought: string[];
  complete: boolean;
}

export interface Act0Snap {
  time: number;
  org: number;
  nu: number;
  fa: number;
  rna: number;
  ves: number;
  p: number;
  L: number;
  longShare: number;
  wet: number;
  ice: number;
  cycleT: number;
  freezeT: number;
  cycles: number;
  molecules: number;
  rates: { org: number; nu: number; fa: number; join: number; unjoin: number };
  upgrades: { id: string; name: string; site: string; text: string; level: number; levels: number; cost: { org: number; nu: number; fa: number }; affordable: boolean; visible: boolean; card: string }[];
  spark: { ready: boolean; lambda: number; chem: number; overdue: number };
  /** Seconds left in the spark scene (0 when none is playing). */
  sparkT: number;
  strands: string[];
  auto: boolean;
  iceUnlocked: boolean;
}

export interface FinaleSnap {
  time: number;
  vals: Record<string, number>;
  bands: Record<string, [number, number]>;
  inBand: Record<string, boolean>;
  stable: number;
  best: number;
  win: number;
  won: boolean;
  light: number;
  traits: { id: string; guild: string; name: string; text: string; level: number; levels: number; cost: number; affordable: boolean; card: string }[];
  variation: number;
  perturb: string | null;
  challenge: string | null;
  challenges: { id: string; name: string; text: string; best: number }[];
  hist: number[][];
  /** Your species and what each does for the biosphere (missing ones cost a feedback). */
  roster: { id: string; name: string; role: string; alive: boolean; cost: string }[] | null;
}

/** One species of the community. */
export interface WorldGuildSnap {
  id: string;
  name: string;
  sci: string;
  domain: 'bacteria' | 'archaea' | 'eukaryote';
  color: string;
  B: number;
  share: number;
  layer: number;
  alive: boolean;
  protagonist: boolean;
  status: 'thriving' | 'growing' | 'steady' | 'declining' | 'rare' | 'lost' | 'in focus';
  eats: string;
  makes: string;
  card: string;
  act: number;
  /** Change per minute (relative). */
  trend: number;
  /** Strict anaerobe meeting oxygen where it lives. */
  danger: boolean;
  /** Which form it has now: purple sulfur bacteria or cyanobacteria; seaweed or animals. */
  look: string;
}

/** A world gauge: a level with its meaningful lines (toxic, goal). */
export interface WorldGaugeSnap {
  id: string;
  label: string;
  v: number;
  max: number;
  color: string;
  lines: { v: number; label: string; kind: 'toxic' | 'goal' | 'info' }[];
  text: string;
  unit: 'pct' | 'num';
}

export interface WorldSnap {
  act: number;
  time: number;
  guilds: WorldGuildSnap[];
  gauges: WorldGaugeSnap[];
  res: Record<string, number>;
  /** [t, B per guild in histKeys order..., sugar, lactate, H2, O2] */
  hist: number[][];
  histKeys: string[];
  layers: string[];
  /** O₂ each layer meets (surface, middle, sediment). */
  o2Layers: number[];
  surface: boolean;
  partner: { health: number; dependence: number; hostGenes: number; partnerGenes: number } | null;
  waves: number | null;
  flows: { from: string; to: string; what: string; rate: number; color: string }[];
  log: { t: number; act: number; text: string }[];
  coexist: number;
}

/** A community trait in the drawer. */
export interface WorldTraitItem {
  id: string;
  guild: string;
  guildName: string;
  name: string;
  text: string;
  science: string;
  cost: number;
  level: number;
  levels: number;
  state: 'available' | 'locked' | 'owned';
  affordable: boolean;
  needs: string[];
  card: string;
  founds?: string;
  relocate?: number;
}

export interface AchievementSnap {
  id: string;
  act: number;
  name: string;
  text: string;
  done: boolean;
}

export interface ChallengeSnap {
  id: string;
  act: number;
  name: string;
  text: string;
  bonus: number;
  done: boolean;
  available: boolean;
  running: boolean;
}

export interface MullerSample {
  t: number;
  f: Record<number, number>;
}

export interface Snapshot {
  t: number;
  act: number;
  actTime: number;
  totalTime: number;
  speed: number;
  act0?: Act0Snap;
  finale?: FinaleSnap;
  P: string;
  K: string;
  biomass: string;
  variation: number;
  block: number;
  evolvability: number;
  reserves: number;
  /** What happens when you advance: readiness, what carries over, what is left unbought. */
  advance: AdvanceSnap | null;
  growth: number;
  mu: number;
  delta: number;
  ec: number;
  flux: number; // log10 of total carrier flux (molecules / s)
  fluxPerCell: number;
  vIncome: number;
  bIncome: string;
  env: Record<string, number>;
  food: string;
  foodLevel: number; // food / foodIn
  cell: CellSnap | null;
  lineages: LineageSnap[];
  dominant: number;
  selected: number;
  viewed: number;
  shop: ShopItem[];
  niches: NicheItem[];
  chores: ChoreItem[];
  reveals: string[];
  unlocked: string[];
  seenCards: string[];
  gate: GateSnap | null;
  genome: GenomeSnap | null;
  alert: AlertSnap | null;
  history: MullerSample[] | null;
  fluxHistory: number[];
  events: GameEvent[];
  flags: string[];
  dayPhase: number | null;
  virus: { active: boolean; name: string; pressure: number } | null;
  policies: Policies;
  policiesUnlocked: boolean;
  snapshots: { t: number; label: string }[];
  actGenomes: { act: number; title: string; muts: string[]; summary: string }[];
  won: boolean;
  virusCampaign: { unlocked: boolean; done: boolean };
  experiments: ExperimentResult[];
  goe: number; // 0..1 rust progress
  branch: 'alga' | 'hetero' | null;
  /** The shared gene pool: what is in it and how far each gene has spread. */
  pool: { id: string; name: string; level: number; share: number; uptake: number; len: number }[];
  /** How genes travel in this act (vesicle fusion, transformation, sex…). */
  transferHow: string;
  /** The community from Act III on (null before). */
  world: WorldSnap | null;
  worldTraits: WorldTraitItem[];
  achievements: AchievementSnap[];
  /** Variation income multiplier from achievements. */
  achBonus: number;
  challenges: ChallengeSnap[];
  challengeRun: { id: string; name: string; text: string; act: number } | null;
  /** This act's raw material, as named under its current branch. */
  blockName: string;
  counts: { sweeps: number; purchases: number; crashes: number };
}

export interface Policies {
  enabled: boolean;
  rule: 'control' | 'cheapest';
  skipStructural: boolean;
  reserve: number;
  niches: boolean;
}

export interface ExperimentResult {
  id: number;
  kind: string;
  rxn: string;
  label: string;
  t: number[];
  series: Record<string, number[]>;
  growth: number[];
  before: number;
  after: number;
}

export type Command =
  | { type: 'buy'; id: string }
  | { type: 'niche'; id: string }
  | { type: 'chore'; id: string; value: string | number }
  | { type: 'select'; lineage: number }
  | { type: 'view'; lineage: number }
  | { type: 'fidelity'; value: number }
  | { type: 'advance' }
  | { type: 'act0'; action: 'cycle' | 'freeze' | 'buy'; id?: string }
  | { type: 'experiment'; kind: 'knockout' | 'overexpress' | 'inhibit'; rxn: string }
  | { type: 'rollback'; index: number }
  | { type: 'policies'; policies: Policies }
  | { type: 'release'; id: string }
  | { type: 'seen'; id: string }
  | { type: 'finaleBuy'; id: string }
  | { type: 'challenge'; id: string | null }
  | { type: 'worldBuy'; id: string }
  | { type: 'actChallenge'; id: string }
  | { type: 'abandonChallenge' }
  | { type: 'virusDone' }
  | { type: 'benchSolved'; id: string }
  | {
      type: 'dev';
      speed?: number;
      skip?: boolean;
      grant?: boolean;
      jump?: number;
      flag?: string;
      unflag?: string;
      own?: string;
      ownAll?: boolean;
      forceGate?: boolean;
      ff?: number;
      spark?: boolean;
      set?: { variation?: number; block?: number; biomass?: number; reserves?: number; org?: number; nu?: number; fa?: number };
    }
  | { type: 'reserves'; amount: number };
