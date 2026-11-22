// The World: one community that grows act by act from Act III on. Every guild
// is a species the player raised; it stays alive in later acts and comes back
// as the key actor (archaea + oxygen breathers merge in Act V, your
// eukaryotes eat your cyanobacteria in Act VI...). The current act's species
// (the protagonist) runs on the detailed cell model; the World couples it to
// the others through shared resources:
//   fermenters → lactate, H₂ → lactate eaters, archaea (syntrophy)
//   every death → organics → debris digesters, oxygen breathers
//   phototrophs → O₂ → iron sink, then toxic to anaerobes outside the sediment
//   hunters ⇄ algae (predator–prey)
// Pure functions over plain data: the Game owns the state and calls tickWorld.

export type GuildId = 'ferm' | 'archaea' | 'lact' | 'debris' | 'photo' | 'resp' | 'euk' | 'alga' | 'hunter' | 'body';
/** 0 sunlit surface, 1 dim middle water (and the mat), 2 dark sediment. */
export type Layer = 0 | 1 | 2;
export const LAYER_NAMES = ['Sunlit surface', 'Dim middle water', 'Dark sediment'] as const;

export interface Guild {
  id: GuildId;
  B: number; // biomass relative to one guild's carrying capacity
  layer: Layer;
  alive: boolean;
  act: number; // raised in
  born: number; // world time
  lostAt?: number;
}

export interface WorldState {
  time: number;
  guilds: Guild[];
  res: { sugar: number; lactate: number; H2: number; organics: number; O2: number; iron: number; CH4: number; light: number };
  /** Community traits bought (id → level). */
  traits: Record<string, number>;
  /** [t, B of each guild in GUILD_ORDER..., sugar, lactate, H2, O2] every 2 s. */
  hist: number[][];
  partner: number; // Act V: partner health 0..1
  partnerLow: number; // seconds the partner has been starving
  waves: number; // Act VI: recent swing of the hunters (coefficient of variation)
  log: { t: number; act: number; text: string }[];
  histNext: number;
  warned: string[];
}

export interface GuildDef {
  id: GuildId;
  name: string;
  sci: string;
  domain: 'bacteria' | 'archaea' | 'eukaryote';
  color: string; // POOL key in the UI
  /** Strict anaerobe: oxygen kills it anywhere but the sediment. */
  anaerobe?: boolean;
  r: number; // max growth per second
  m: number; // death per second
  eats: string;
  makes: string;
  card: string;
  layer: Layer;
}

export const GUILDS: Record<GuildId, GuildDef> = {
  ferm: { id: 'ferm', name: 'Fermenting bacteria', sci: 'Your first bacteria: sugar fermenters', domain: 'bacteria', color: 'carbon', r: 0.03, m: 0.006, eats: 'Sugar from the seeps, and organics', makes: 'Lactate, H₂ and acid', card: 'fermentation', layer: 1 },
  archaea: { id: 'archaea', name: 'H₂-eating archaea', sci: 'Methanogens: the other great line from LUCA', domain: 'archaea', color: 'nad', anaerobe: true, r: 0.022, m: 0.006, eats: 'H₂ (with CO₂)', makes: 'Methane', card: 'methanogens', layer: 1 },
  lact: { id: 'lact', name: 'Lactate eaters', sci: 'Lactate-oxidising bacteria', domain: 'bacteria', color: 'lipid', anaerobe: true, r: 0.026, m: 0.006, eats: 'Lactate', makes: 'H₂', card: 'lactate-oxidisers', layer: 1 },
  debris: { id: 'debris', name: 'Debris digesters', sci: 'Bacteria that secrete digestive enzymes', domain: 'bacteria', color: 'sulfur', r: 0.022, m: 0.006, eats: 'Dead cells (organics)', makes: 'Sugars and H₂, recycled', card: 'exoenzymes', layer: 1 },
  photo: { id: 'photo', name: 'Phototrophs', sci: 'Bacteria that harvest light', domain: 'bacteria', color: 'light', r: 0.03, m: 0.006, eats: 'Light (with H₂S, later water)', makes: 'Organics (and O₂ once oxygenic)', card: 'anoxygenic', layer: 1 },
  resp: { id: 'resp', name: 'Oxygen breathers', sci: 'Alphaproteobacteria', domain: 'bacteria', color: 'oxygen', r: 0.03, m: 0.006, eats: 'Organics and O₂', makes: 'CO₂', card: 'respiration', layer: 1 },
  euk: { id: 'euk', name: 'Eukaryotes', sci: 'An archaeal host with a mitochondrion', domain: 'eukaryote', color: 'atp', r: 0.02, m: 0.005, eats: 'Organics, O₂ and smaller cells', makes: 'CO₂', card: 'eukaryogenesis', layer: 1 },
  alga: { id: 'alga', name: 'Algae', sci: 'Eukaryotes with a captive cyanobacterium', domain: 'eukaryote', color: 'nitrogen', r: 0.03, m: 0.006, eats: 'Light', makes: 'Organics and O₂', card: 'chloroplast', layer: 0 },
  hunter: { id: 'hunter', name: 'Hunters', sci: 'Eukaryotes that engulf other cells', domain: 'eukaryote', color: 'proton', r: 0.03, m: 0.018, eats: 'Algae (and cyanobacteria)', makes: 'Organics', card: 'phagocytosis', layer: 0 },
  body: { id: 'body', name: 'Bodies', sci: 'Many cells that live and die as one', domain: 'eukaryote', color: 'rna', r: 0.015, m: 0.004, eats: 'Food or light', makes: 'Organics', card: 'multicellularity', layer: 1 },
};
export const GUILD_ORDER: GuildId[] = ['ferm', 'archaea', 'lact', 'debris', 'photo', 'resp', 'euk', 'alga', 'hunter', 'body'];

/** The species each act puts under the microscope. */
export const PROTAGONIST: Record<number, GuildId> = { 3: 'ferm', 4: 'photo', 5: 'euk', 6: 'alga', 7: 'body' };

export type TraitMod = 'r' | 'K' | 'eff' | 'attack' | 'refuge' | 'self' | 'switch' | 'mixo' | 'syn';
const ADDITIVE_MODS: TraitMod[] = ['refuge', 'self', 'switch', 'mixo', 'syn'];

export interface WorldTrait {
  id: string;
  act: number; // first act it can be bought in
  guild: GuildId;
  name: string;
  text: string;
  science: string;
  cost: number;
  levels?: number;
  growth?: number;
  founds?: GuildId;
  relocate?: Layer;
  mods?: Partial<Record<TraitMod, number>>;
  requires?: string[];
  needsFlag?: string; // act flag
  needsGuild?: GuildId;
  excludes?: string[];
  flags?: string[]; // act flags it sets
  card: string;
}

export const WORLD_TRAITS: WorldTrait[] = [
  // Act III: waste is food
  { id: 'w3-lact', act: 3, guild: 'lact', founds: 'lact', needsFlag: 'heterotrophy', name: 'Found the lactate eaters', text: 'Some cells live on your fermenters’ lactate instead of sugar. They clear the acid and pass on H₂.', science: 'Lactate permease plus a lactate dehydrogenase run in reverse: lactate → pyruvate → acetate, CO₂ and H₂.', cost: 60, card: 'lactate-oxidisers' },
  { id: 'w3-debris', act: 3, guild: 'debris', founds: 'debris', needsFlag: 'heterotrophy', name: 'Found the debris digesters', text: 'Some cells secrete enzymes that break down dead cells outside the cell, then eat the pieces. Sugar flows back to the seeps.', science: 'Secreted proteases, nucleases and glycosidases (exoenzymes) digest polymers too big to take up.', cost: 70, card: 'exoenzymes' },
  { id: 'w3-mcr', act: 3, guild: 'archaea', needsGuild: 'archaea', name: 'Methyl-coenzyme M reductase', text: 'The last enzyme of methanogenesis, faster: archaea grow ×1.35 on the same H₂.', science: 'Mcr carries the nickel cofactor F430 and releases methane; it is the signature enzyme of methanogens.', cost: 55, levels: 2, growth: 2.2, mods: { r: 1.35 }, card: 'methanogens' },
  { id: 'w3-hyd', act: 3, guild: 'archaea', needsGuild: 'archaea', name: 'High-affinity hydrogenase', text: 'Archaea scavenge H₂ at lower levels (half-saturation ×0.6), so they keep it lower for your fermenters.', science: 'Methanogens can draw H₂ down to a few pascals, low enough to make fermentation exergonic.', cost: 80, mods: { K: 0.6 }, card: 'syntrophy' },
  { id: 'w3-agg', act: 3, guild: 'archaea', needsGuild: 'archaea', requires: ['w3-mcr'], name: 'Syntrophic aggregates', text: 'Fermenters and archaea live side by side: H₂ passes over micrometres instead of millimetres. The syntrophy boost is 50% stronger.', science: 'Interspecies hydrogen transfer is limited by diffusion distance; partners in aggregates exchange H₂ far faster.', cost: 130, mods: { syn: 0.5 }, card: 'syntrophy' },
  { id: 'w3-lperm', act: 3, guild: 'lact', needsGuild: 'lact', name: 'Lactate permease', text: 'Lactate eaters take up lactate faster: growth ×1.3.', science: 'A proton-coupled transporter (LutP-like) brings lactate in.', cost: 65, levels: 2, growth: 2.2, mods: { r: 1.3 }, card: 'lactate-oxidisers' },
  { id: 'w3-prot', act: 3, guild: 'debris', needsGuild: 'debris', name: 'Broader exoenzymes', text: 'Debris digesters break down more kinds of polymer: growth ×1.3.', science: 'Each secreted hydrolase opens one class of polymer: proteins, nucleic acids, polysaccharides.', cost: 65, levels: 2, growth: 2.2, mods: { r: 1.3 }, card: 'exoenzymes' },
  // Act IV: the oxygen we made
  { id: 'w4-sed-a', act: 4, guild: 'archaea', needsGuild: 'archaea', relocate: 2, name: 'Archaea retreat to the sediment', text: 'Move your archaea down into the dark, oxygen-free mud. Oxygen will kill them anywhere else.', science: 'Methanogens are strict anaerobes; today they live in sediments, wetlands and guts, where oxygen never reaches.', cost: 60, card: 'anoxic-refuges' },
  { id: 'w4-sed-l', act: 4, guild: 'lact', needsGuild: 'lact', relocate: 2, name: 'Lactate eaters retreat to the sediment', text: 'Move your lactate eaters down into the mud before oxygen arrives.', science: 'Many lactate oxidisers are sulfate reducers, strict anaerobes of the sediment.', cost: 50, card: 'anoxic-refuges' },
  { id: 'w4-cox', act: 4, guild: 'resp', needsGuild: 'resp', name: 'Cytochrome c oxidase', text: 'Oxygen breathers grow ×1.3 on the same organics.', science: 'The terminal oxidase hands electrons to O₂, pumping protons as it goes.', cost: 85, levels: 2, growth: 2.3, mods: { r: 1.3 }, card: 'respiration' },
  // Act VI: algae and hunters
  { id: 'w6-hunt', act: 6, guild: 'hunter', founds: 'hunter', needsFlag: 'plastid', name: 'Branch · Hunters', text: 'Not every eukaryote keeps its captive: some digest everything they catch. A second branch of your tree, and it eats algae.', science: 'Phagotrophy, engulfing whole cells, is ancestral to eukaryotes; most lineages kept it.', cost: 40, card: 'phagocytosis' },
  { id: 'w6-lyso', act: 6, guild: 'hunter', needsGuild: 'hunter', name: 'Lysosomal digestion', text: 'Hunters turn more of their prey into new hunters (efficiency ×1.4). Efficient predators also swing harder.', science: 'Acid hydrolases in lysosomes break prey down inside the cell.', cost: 60, mods: { eff: 1.4 }, card: 'lysosomes' },
  { id: 'w6-big', act: 6, guild: 'hunter', needsGuild: 'hunter', name: 'Bigger hunters', text: 'Larger cells engulf more (attack ×1.3), and size becomes the arms race.', science: 'Bigger predators can eat bigger prey: a driver of increasing cell size.', cost: 80, mods: { attack: 1.3 }, flags: ['bighunters'], card: 'size-arms-race' },
  { id: 'w6-refuge', act: 6, guild: 'alga', needsGuild: 'hunter', name: 'Colonies and spines', text: 'Some algae become hard to catch: a share of them is out of reach. Refuges damp predator–prey waves.', science: 'Prey refuges stabilise predator–prey cycles (Gause; Rosenzweig–MacArthur models).', cost: 75, levels: 2, growth: 2.2, mods: { refuge: 0.1 }, card: 'refuges' },
  { id: 'w6-switch', act: 6, guild: 'hunter', needsGuild: 'hunter', name: 'Prey switching', text: 'Hunters also graze cyanobacteria and switch to whatever is common, so no prey is hunted to the bottom.', science: 'Switching predators stabilise communities: a generalist does not chase rare prey down.', cost: 80, mods: { switch: 1 }, card: 'prey-switching' },
  { id: 'w6-terr', act: 6, guild: 'hunter', needsGuild: 'hunter', name: 'Interference', text: 'Crowded hunters get in each other’s way: self-limitation caps the booms.', science: 'Predator interference (Beddington–DeAngelis) damps oscillations.', cost: 95, mods: { self: 1 }, card: 'self-limitation' },
  { id: 'w6-mixo', act: 6, guild: 'hunter', needsGuild: 'hunter', requires: ['w6-lyso'], name: 'Secondary endosymbiosis', text: 'Some hunters keep an alga instead of digesting it: they photosynthesise when prey is scarce.', science: 'Euglenids, dinoflagellates and others got plastids by keeping a eukaryotic alga.', cost: 140, mods: { mixo: 1 }, card: 'secondary-endosymbiosis' },
  // Act VII: which branch builds a body first
  { id: 'w7-seaweed', act: 7, guild: 'alga', name: 'Algae go first: seaweed', text: 'Your algae stick together into fronds. Light is the food; the hunters stay single-celled for now.', science: 'Multicellularity evolved independently in red, green and brown algae.', cost: 0, excludes: ['w7-animals'], flags: ['seaweed', 'multi'], card: 'multicellularity' },
  { id: 'w7-animals', act: 7, guild: 'hunter', name: 'Hunters go first: animals', text: 'Your hunters stick together into bodies that eat. The algae stay single-celled for now.', science: 'Animals descend from single-celled relatives much like choanoflagellates.', cost: 0, excludes: ['w7-seaweed'], flags: ['animal', 'multi'], card: 'multicellularity' },
];

export function newWorld(): WorldState {
  return {
    time: 0,
    guilds: [],
    res: { sugar: 1, lactate: 0, H2: 0, organics: 0.2, O2: 0, iron: 1, CH4: 0, light: 1 },
    traits: {},
    hist: [],
    partner: 1,
    partnerLow: 0,
    waves: 0,
    log: [],
    histNext: 0,
    warned: [],
  };
}

export function guild(w: WorldState, id: GuildId): Guild | undefined {
  return w.guilds.find((g) => g.id === id);
}
export function alive(w: WorldState, id: GuildId): boolean {
  const g = guild(w, id);
  return !!g && g.alive;
}

/** Add a guild (or bring a lost one back). */
export function found(w: WorldState, id: GuildId, act: number, B = 0.04, layer?: Layer): Guild {
  let g = guild(w, id);
  if (g) {
    if (!g.alive) {
      g.alive = true;
      g.B = B;
      g.lostAt = undefined;
    }
    return g;
  }
  g = { id, B, layer: layer ?? GUILDS[id].layer, alive: true, act, born: w.time };
  w.guilds.push(g);
  return g;
}

/**
 * A world as it would look at the start of `act` if the player had raised
 * everything (dev jumps, challenges, and saves from before the World).
 */
export function seedWorld(act: number): WorldState {
  const w = newWorld();
  const add = (id: GuildId, B: number, layer?: Layer, a = 3) => found(w, id, a, B, layer);
  if (act >= 4) {
    add('ferm', 0.5);
    add('archaea', 0.45);
    add('lact', 0.35);
    add('debris', 0.3);
    w.res = { ...w.res, sugar: 0.3, lactate: 0.2, H2: 0.12, organics: 0.6, CH4: 0.4 };
  }
  if (act >= 5) {
    guild(w, 'archaea')!.layer = 2;
    guild(w, 'lact')!.layer = 2;
    add('photo', 0.7, 0, 4);
    add('resp', 0.4, 1, 4);
    w.res.O2 = 1;
    w.res.iron = 0;
    w.res.CH4 = 0.05;
  }
  if (act >= 6) add('euk', 0.45, 1, 5);
  if (act >= 7) {
    add('alga', 0.6, 0, 6);
    add('hunter', 0.3, 0, 6);
  }
  if (act >= 8) add('body', 0.5, 1, 7);
  return w;
}

/** Guild parameters after community traits. */
export function guildParams(w: WorldState, id: GuildId) {
  const d = GUILDS[id];
  const p: Record<TraitMod, number> = { r: d.r, K: 1, eff: 1, attack: 1, refuge: 0, self: 0, switch: 0, mixo: 0, syn: 0 };
  for (const t of WORLD_TRAITS) {
    if (t.guild !== id || !t.mods) continue;
    const l = w.traits[t.id] ?? 0;
    if (!l) continue;
    for (const [k, v] of Object.entries(t.mods) as [TraitMod, number][]) {
      if (ADDITIVE_MODS.includes(k)) p[k] += v * l;
      else p[k] *= Math.pow(v, l);
    }
  }
  return p;
}

export interface WorldCtx {
  act: number;
  /** The act's species: biomass (occupancy) and how hard it is working (growth relative to reference). */
  prot: { B: number; activity: number };
  flag: (f: string) => boolean;
  virus: boolean;
  /** Share of the protagonist carrying lactate dehydrogenase (Act III). */
  ldh: number;
  O2?: number; // Act IV: oxygen from the act's environment
  light?: number;
  iron?: number; // Act IV: share of the iron sink still unrusted
  share?: number; // Act V: how much organics the host lets its partner burn
}

export interface WorldOut {
  /** Multiplier on the protagonist's growth (syntrophy, acid). */
  mu: number;
  /** Extra deaths of the protagonist per second (predation). */
  delta: number;
  events: { title: string; text: string; kind: 'event' | 'toast' | 'lost' }[];
}

/** "Lactate eaters" → "lactate eaters", but "H₂-eating archaea" stays as it is. */
export const lowerFirst = (t: string) => (/^[A-Z][a-z]/.test(t) ? t[0].toLowerCase() + t.slice(1) : t);

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** O₂ a guild meets in its layer. */
export function layerO2(O2: number, layer: Layer) {
  return layer === 2 ? O2 * 0.004 : layer === 1 ? O2 * 0.8 : O2;
}

/** Acid stress on fermenters (and the protagonist in Act III) from lactate. */
export function acidStress(lactate: number) {
  return 0.6 * smooth(1.0, 2.5, lactate);
}

/** The syntrophy boost to fermenters when the H₂ they make is eaten. */
export function syntrophyBoost(w: WorldState) {
  if (!alive(w, 'archaea')) return 1;
  const syn = 1 + guildParams(w, 'archaea').syn;
  return 1 + 0.25 * syn * Math.max(0, 1 - w.res.H2 / 1.5);
}

/** One step of the community. */
export function tickWorld(w: WorldState, dt: number, ctx: WorldCtx): WorldOut {
  const out: WorldOut = { mu: 1, delta: 0, events: [] };
  w.time += dt;
  const R = w.res;
  if (ctx.O2 !== undefined) R.O2 = ctx.O2;
  if (ctx.iron !== undefined) R.iron = ctx.iron;
  // after Act IV the World keeps its own sunlight (the act no longer models it)
  R.light = ctx.light ?? (ctx.act >= 5 ? 1 : R.light);
  const prot = PROTAGONIST[ctx.act];
  const hetero = ctx.act > 3 || ctx.flag('heterotrophy');
  const live = w.guilds.filter((g) => g.alive);
  const total = live.reduce((n, g) => n + (g.id === prot ? ctx.prot.B : g.B), 0) || 1;
  const A: Partial<Record<GuildId, number>> = {}; // activity: biomass × how well fed
  const gp = (id: GuildId) => guildParams(w, id);

  // protagonist: the act decides its numbers
  const pg = prot ? guild(w, prot) : undefined;
  // Act VI: the algae have their own (slower) logistic growth so predator–prey waves can form
  const ownAlgae = prot === 'alga' && ctx.act === 6;
  if (pg && !ownAlgae) pg.B += (Math.max(0.01, Math.min(1.5, ctx.prot.B)) - pg.B) * Math.min(1, dt * 0.5);
  if (pg) A[prot!] = pg.B * Math.max(0, Math.min(1.3, ctx.prot.activity));

  // hunters and their prey (algae protagonist in Act VI, algae guild later)
  const hunter = live.find((g) => g.id === 'hunter');
  const algaB = prot === 'alga' ? (pg?.B ?? 0) : guild(w, 'alga')?.alive ? guild(w, 'alga')!.B : 0;
  const photoB = alive(w, 'photo') ? guild(w, 'photo')!.B : 0;
  let predAlga = 0; // biomass eaten per second
  let predPhoto = 0;
  if (hunter && ctx.act >= 6 && ctx.act < 7) {
    const hp = gp('hunter');
    const ap = gp('alga');
    const a = 0.15 * hp.attack;
    const h = 0.35;
    const exposed = Math.max(0, algaB - ap.refuge);
    const sw = hp.switch;
    // switching: attack each prey in proportion to how common it is
    const wA = sw ? exposed / (exposed + photoB + 1e-6) : 1;
    const wP = sw ? 1 - wA : 0;
    const food = wA * exposed + wP * photoB;
    const fr = (a * hunter.B) / (h + food);
    predAlga = fr * wA * exposed;
    predPhoto = fr * wP * photoB;
  }

  for (const g of live) {
    if (g.id === prot) continue;
    const d = GUILDS[g.id];
    const p = gp(g.id);
    let M = 0;
    switch (g.id) {
      case 'ferm':
        M = 0.7 * (R.sugar / (0.3 + R.sugar)) + 0.3 * (R.organics / (0.5 + R.organics));
        M *= 1 - acidStress(R.lactate);
        M *= syntrophyBoost(w);
        break;
      case 'archaea':
        M = R.H2 / (0.2 * p.K + R.H2);
        break;
      case 'lact':
        M = R.lactate / (0.3 + R.lactate);
        break;
      case 'debris':
        M = R.organics / (0.3 + R.organics);
        break;
      case 'photo':
        M = (g.layer === 0 ? 1 : 0.55) * (R.light / (0.3 + R.light));
        break;
      case 'resp':
        M = (R.organics / (0.4 + R.organics)) * (R.O2 / (0.1 + R.O2));
        break;
      case 'euk':
        M = (0.5 * (R.organics / (0.4 + R.organics)) + 0.5 * (photoB / (0.5 + photoB))) * (R.O2 / (0.1 + R.O2));
        break;
      case 'alga':
        M = R.light / (0.3 + R.light);
        break;
      case 'hunter':
        M = ctx.act >= 7 ? 0.5 : 0; // Act VI: growth comes from what they eat (below)
        break;
      case 'body':
        M = 0.6;
        break;
    }
    A[g.id] = g.B * M;
    // deaths: baseline, crowding, oxygen, phages (kill the winner), being eaten
    const o2 = layerO2(R.O2, g.layer);
    const tox = d.anaerobe ? (0.035 * Math.max(0, o2 - 0.01)) / (0.05 + o2) : 0;
    const share = g.B / total;
    const phage = ctx.virus ? 0.02 * share * share : 0;
    const eaten = g.id === 'photo' ? predPhoto / Math.max(1e-6, g.B) : g.id === 'alga' && prot !== 'alga' ? predAlga / Math.max(1e-6, g.B) : 0;
    const self = g.id === 'hunter' ? 0.03 * p.self * g.B : 0;
    let grow = p.r * M * (1 - g.B / p.K);
    if (g.id === 'hunter' && ctx.act === 6) {
      // Rosenzweig–MacArthur: conversion of prey eaten (no ceiling but their own interference), plus light if they keep algae
      const ate = (predAlga + predPhoto) / Math.max(1e-6, g.B);
      grow = 0.3 * p.eff * ate + p.r * 0.35 * p.mixo * (R.light / (0.3 + R.light)) * (1 - g.B);
      A[g.id] = g.B * Math.min(1, ate * 4);
    }
    const die = d.m + tox + phage + eaten + self;
    g.B += dt * g.B * (grow - die);
    // dormant remnants survive hunger, but not oxygen
    const floor = tox > 0.004 ? 0 : 0.012;
    if (g.B < floor) g.B = floor;
    R.organics += dt * g.B * (d.m + phage + self) * 0.8;
    if (tox > 0.004 && g.B < 0.15 && !w.warned.includes('o2:' + g.id)) {
      w.warned.push('o2:' + g.id);
      out.events.push({ kind: 'event', title: `Oxygen is killing your ${lowerFirst(d.name)}`, text: `They are strict anaerobes in the ${LAYER_NAMES[g.layer].toLowerCase()}. Move them into the sediment before they are gone.` });
    }
    if (g.B < 0.008) {
      g.alive = false;
      g.lostAt = w.time;
      w.log.push({ t: w.time, act: ctx.act, text: `${d.name} lost` });
      out.events.push({ kind: 'lost', title: `${d.name} lost`, text: `Your ${lowerFirst(d.name)} died out. Species lost along the way are missing from later acts and the finale.` });
    }
  }

  // protagonist's own exchange with the world
  if (pg && prot) {
    const P = pg.B;
    if (prot === 'ferm') {
      if (hetero) {
        out.mu *= syntrophyBoost(w);
        out.mu *= 1 - acidStress(R.lactate);
      }
    }
    if (ownAlgae) {
      const rA = 0.075 * Math.max(0, Math.min(1.3, ctx.prot.activity));
      pg.B += dt * (pg.B * rA * (1 - pg.B) - predAlga);
      pg.B = Math.max(0.02, Math.min(1.2, pg.B));
      out.delta += predAlga / Math.max(0.02, pg.B);
    }
    R.organics += dt * P * 0.004;
  }

  // resources
  const aF = (A.ferm ?? 0) * (hetero ? 1 : 0);
  const ldh = prot === 'ferm' ? ctx.ldh : 0.5;
  // fermenters always make some acid (mixed-acid fermentation); lactate dehydrogenase makes more
  R.sugar += dt * (0.00012 * (1 - R.sugar) - 0.0005 * aF + 0.0002 * (A.debris ?? 0));
  R.lactate += dt * (0.012 * aF * (0.35 + 0.65 * ldh) - 0.03 * (A.lact ?? 0) - 0.004 * R.lactate);
  R.H2 += dt * (0.012 * aF * (1 - 0.5 * ldh) + 0.012 * (A.lact ?? 0) + 0.006 * (A.debris ?? 0) - 0.06 * (A.archaea ?? 0) - 0.01 * R.H2 - 0.05 * R.O2 * R.H2);
  R.organics += dt * (0.004 * ((A.photo ?? 0) + (A.alga ?? 0)) - 0.015 * (A.debris ?? 0) - 0.01 * (A.resp ?? 0) - 0.006 * (A.euk ?? 0) - 0.002 * R.organics);
  R.CH4 += dt * (0.01 * (A.archaea ?? 0) - 0.0008 * R.CH4 - 0.02 * R.O2 * R.CH4);
  R.sugar = Math.max(0, Math.min(1, R.sugar));
  R.lactate = Math.max(0, Math.min(4, R.lactate));
  R.H2 = Math.max(0, Math.min(3, R.H2));
  R.organics = Math.max(0, Math.min(3, R.organics));
  R.CH4 = Math.max(0, Math.min(3, R.CH4));

  // Act V: the partner's health follows how fairly organics are shared
  if (ctx.act === 5 && ctx.share !== undefined && ctx.flag('endo') && !ctx.flag('organelle')) {
    const target = Math.max(0, Math.min(1, (ctx.share - 0.15) / 0.3));
    w.partner += (target - w.partner) * Math.min(1, dt / 30);
    w.partnerLow = w.partner < 0.2 ? w.partnerLow + dt : 0;
  } else {
    w.partner += (1 - w.partner) * Math.min(1, dt / 20);
    w.partnerLow = 0;
  }

  // history (and the hunters' swing)
  if (w.time >= w.histNext) {
    w.histNext = w.time + 2;
    w.hist.push([Math.round(w.time), ...GUILD_ORDER.map((id) => {
      const g = guild(w, id);
      return g && g.alive ? +g.B.toFixed(4) : 0;
    }), +R.sugar.toFixed(4), +R.lactate.toFixed(4), +R.H2.toFixed(4), +R.O2.toFixed(4)]);
    if (w.hist.length > 240) w.hist.splice(0, w.hist.length - 240);
    const hi = 1 + GUILD_ORDER.indexOf('hunter');
    const recent = w.hist.slice(-150).map((r) => r[hi]).filter((v) => v > 0);
    if (recent.length > 20) {
      const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
      const sd = Math.sqrt(recent.reduce((a, b) => a + (b - mean) * (b - mean), 0) / recent.length);
      w.waves = sd / Math.max(1e-6, mean);
    } else w.waves = 1;
  }
  return out;
}

/** The act's species as World biomass: occupancy saturates (the act's population can run far above its nominal capacity). */
export function protBiomass(occupancy: number) {
  const x = Math.max(0, occupancy);
  return (1.2 * x) / (x + 4);
}

/** Number of living guilds that each make up at least `min` of the community. */
export function coexisting(w: WorldState, protB: number, prot: GuildId | undefined, min = 0.05): number {
  const live = w.guilds.filter((g) => g.alive);
  const B = (g: Guild) => (g.id === prot ? protB : g.B);
  const total = live.reduce((n, g) => n + B(g), 0) || 1;
  return live.filter((g) => B(g) / total >= min).length;
}

export function traitCost(t: WorldTrait, level: number) {
  return t.cost * Math.pow(t.growth ?? 2, level);
}
