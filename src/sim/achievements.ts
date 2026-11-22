// Achievements and act challenges: the long game. Each achievement is a small
// permanent bonus to Variation income; each finished challenge a bigger one.
// Pure data plus checks against a narrow view of the game.
import type { GameState } from './state';

export interface AchView {
  s: GameState;
  /** The act being played (or just finished, at an advance). */
  act: number;
  stat(key: string): number;
  flag(f: string): boolean;
  /** The commonest species owns this adaptation, or the community owns this trait. */
  owns(id: string): boolean;
  /** Minutes spent in the act. */
  minutes: number;
  /** Set while checking an advance out of `act`. */
  advancing: boolean;
  /** Every upgrade of the act is owned. */
  complete: boolean;
  crashes: number;
}

export interface AchievementSpec {
  id: string;
  act: number; // row it sits in (0..8, 9 = across the game)
  name: string;
  text: string;
  check: (v: AchView) => boolean;
}

const done = (act: number) => (v: AchView) => v.advancing && v.act === act;
const fast = (act: number, min: number) => (v: AchView) => v.advancing && v.act === act && v.minutes <= min;
const all = (act: number) => (v: AchView) => v.advancing && v.act === act && v.complete;
const calm = (act: number) => (v: AchView) => v.advancing && v.act === act && v.crashes === 0;

export const ACHIEVEMENTS: AchievementSpec[] = [
  // Act 0 (checked against Act 0's state, which is kept after the spark, so they can be earned late)
  { id: 'a0-done', act: 0, name: 'Heredity', text: 'A strand copies itself inside a vesicle.', check: (v) => v.s.act >= 1 || (v.advancing && v.act === 0) },
  { id: 'a0-ice', act: 0, name: 'Brine veins', text: 'Run a freeze–thaw cycle.', check: (v) => v.s.act0.freezes > 0 },
  { id: 'a0-geyser', act: 0, name: 'Hands off', text: 'Let a hot-spring field run the cycles for you.', check: (v) => (v.s.act0.up.geyser ?? 0) > 0 },
  { id: 'a0-long', act: 0, name: 'Long strands', text: 'Strands averaging 12 nucleotides or more.', check: (v) => v.stat('act0.L') >= 12 },
  { id: 'a0-few', act: 0, name: 'Patient chemist', text: 'The spark with 40 wet–dry cycles or fewer: build the chemistry and let time do the rest.', check: (v) => {
      // Act 0's state is frozen at the spark, so this also counts for saves from before achievements
      const c = v.s.records.sparkCycles ?? v.s.act0.cycles;
      return ((v.s.act >= 1 && v.s.act0.sparked) || (v.advancing && v.act === 0)) && c <= 40;
    } },
  { id: 'a0-all', act: 0, name: 'Shaped the world', text: 'Build every Act 0 upgrade to its top level.', check: (v) => v.stat('act0.complete') >= 1 },
  // Act I
  { id: 'a1-done', act: 1, name: 'Protocells', text: 'Finish Act I.', check: done(1) },
  { id: 'a1-err', act: 1, name: 'Error catastrophe', text: 'Cross the error threshold, then recover below 90% of it.', check: (v) => v.act === 1 && (v.s.records.errPeak ?? 0) > 1 && v.stat('errorRatio') < 0.9 },
  { id: 'a1-lean', act: 1, name: 'Lean genome', text: 'Finish Act I under 70% of the error threshold.', check: (v) => v.advancing && v.act === 1 && v.stat('errorRatio') < 0.7 },
  { id: 'a1-par', act: 1, name: 'Parasite proof', text: 'Finish Act I with parasites in the pool and a defence against them.', check: (v) => v.advancing && v.act === 1 && v.flag('parasites') && (v.owns('a1-purge') || v.owns('a1-discrim')) },
  { id: 'a1-all', act: 1, name: 'Every letter counts', text: 'Own every Act I upgrade.', check: all(1) },
  { id: 'a1-fast', act: 1, name: 'Quick protocells', text: 'Finish Act I within 50 minutes.', check: fast(1, 50) },
  // Act II
  { id: 'a2-done', act: 2, name: 'LUCA', text: 'Finish Act II: the last universal common ancestor.', check: done(2) },
  { id: 'a2-ech', act: 2, name: 'Your own gradient', text: 'Pump your own protons with Ech.', check: (v) => v.act === 2 && v.owns('a2-ech') },
  { id: 'a2-mmr', act: 2, name: 'Faithful copies', text: 'DNA with proofreading and mismatch repair.', check: (v) => v.act === 2 && v.owns('a2-mmr') },
  { id: 'a2-calm', act: 2, name: 'Smooth assembly', text: 'Finish Act II without a crash.', check: calm(2) },
  { id: 'a2-all', act: 2, name: 'Protein world', text: 'Own every Act II upgrade.', check: all(2) },
  { id: 'a2-fast', act: 2, name: 'Quick ancestor', text: 'Finish Act II within 45 minutes.', check: fast(2, 45) },
  // Act III
  { id: 'a3-done', act: 3, name: 'Two domains', text: 'Finish Act III.', check: done(3) },
  { id: 'a3-syn', act: 3, name: 'Syntrophy', text: 'Archaea eat your fermenters’ H₂ so well that fermenters grow 15% faster.', check: (v) => v.act === 3 && v.stat('world.syn') >= 1.15 },
  { id: 'a3-five', act: 3, name: 'Waste is food', text: 'Five species coexisting, each at least 5% of the community.', check: (v) => v.act === 3 && v.stat('world.coexist') >= 5 },
  { id: 'a3-acid', act: 3, name: 'Acid test', text: 'Bring lactate back under the toxic line after it crossed it.', check: (v) => v.act === 3 && (v.s.records.acidPeak ?? 0) > 1.6 && v.stat('world.lactate') < 1.0 },
  { id: 'a3-all', act: 3, name: 'Sugar economy', text: 'Own every Act III upgrade.', check: all(3) },
  { id: 'a3-fast', act: 3, name: 'Quick split', text: 'Finish Act III within 55 minutes.', check: fast(3, 55) },
  // Act IV
  { id: 'a4-done', act: 4, name: 'The oxygen we made', text: 'Finish Act IV.', check: done(4) },
  { id: 'a4-goe', act: 4, name: 'Survived the oxidation', text: 'Get through the Great Oxidation Event without losing a species.', check: (v) => v.advancing && v.act === 4 && v.flag('goe') && !(v.s.world?.guilds ?? []).some((g) => !g.alive) },
  { id: 'a4-iron', act: 4, name: 'Banded iron', text: 'Rust the whole iron sink.', check: (v) => v.act === 4 && v.flag('oxygenic') && v.stat('world.iron') <= 0.001 },
  { id: 'a4-clock', act: 4, name: 'Clockwork', text: 'Evolve a circadian clock.', check: (v) => v.act === 4 && v.owns('a4-kai') },
  { id: 'a4-all', act: 4, name: 'Light and oxygen', text: 'Own every Act IV upgrade.', check: all(4) },
  { id: 'a4-fast', act: 4, name: 'Quick dawn', text: 'Finish Act IV within 55 minutes.', check: fast(4, 55) },
  // Act V
  { id: 'a5-done', act: 5, name: 'Two became one', text: 'Finish Act V.', check: done(5) },
  { id: 'a5-eve', act: 5, name: 'Mitochondrial Eve', text: 'An organelle that kept fewer than 10% of its genes.', check: (v) => v.act === 5 && v.flag('organelle') && v.stat('partner.dependence') >= 0.9 },
  { id: 'a5-fair', act: 5, name: 'Fair trade', text: 'Finish Act V without your partner’s health dropping under 30%.', check: (v) => v.advancing && v.act === 5 && (v.s.records.partnerMin ?? 1) >= 0.3 },
  { id: 'a5-own', act: 5, name: 'Family reunion', text: 'Build the eukaryote from your own archaea and your own oxygen breathers.', check: (v) => v.act === 5 && v.flag('ownPartners') },
  { id: 'a5-all', act: 5, name: 'Eukaryogenesis', text: 'Own every Act V upgrade.', check: all(5) },
  { id: 'a5-fast', act: 5, name: 'Quick merger', text: 'Finish Act V within 50 minutes.', check: fast(5, 50) },
  // Act VI
  { id: 'a6-done', act: 6, name: 'Algae and hunters', text: 'Finish Act VI.', check: done(6) },
  { id: 'a6-calm', act: 6, name: 'Calm waters', text: 'Hunters swing less than 8% for two minutes.', check: (v) => v.act === 6 && v.stat('world.hunter') > 0.05 && (v.s.records.calmT ?? 0) >= 120 },
  { id: 'a6-mixo', act: 6, name: 'Secondary endosymbiosis', text: 'Hunters that keep algae of their own.', check: (v) => v.act === 6 && v.owns('w6-mixo') },
  { id: 'a6-nitro', act: 6, name: 'Nitroplast', text: 'A captive nitrogen fixer, as in Braarudosphaera.', check: (v) => v.act === 6 && v.owns('a6-nitro') },
  { id: 'a6-all', act: 6, name: 'Plastids', text: 'Own every Act VI upgrade.', check: all(6) },
  { id: 'a6-fast', act: 6, name: 'Quick bloom', text: 'Finish Act VI within 55 minutes.', check: fast(6, 55) },
  // Act VII
  { id: 'a7-done', act: 7, name: 'Bodies', text: 'Finish Act VII.', check: done(7) },
  { id: 'a7-clean', act: 7, name: 'No cheaters', text: 'Finish Act VII with cheating cells under 5%.', check: (v) => v.advancing && v.act === 7 && v.stat('globals.cheat') < 0.05 },
  { id: 'a7-germ', act: 7, name: 'Weismann barrier', text: 'Set a germline apart.', check: (v) => v.act === 7 && v.owns('a7-germ') },
  { id: 'a7-calm', act: 7, name: 'Steady growth', text: 'Finish Act VII without a crash.', check: calm(7) },
  { id: 'a7-all', act: 7, name: 'Multicellularity', text: 'Own every Act VII upgrade.', check: all(7) },
  { id: 'a7-both', act: 7, name: 'Both kingdoms', text: 'Finish Act VII with seaweed and, in a challenge, with animals (or the other way round).', check: (v) => v.s.challengesDone.includes('c7') && (v.s.achievements.includes('a7-done') || (v.advancing && v.act === 7)) },
  // Finale
  { id: 'f-win', act: 8, name: 'A living planet', text: 'Hold the biosphere in balance for five minutes.', check: (v) => !!v.s.finale?.won },
  { id: 'f-roster', act: 8, name: 'Full roster', text: 'Win the finale with every species you could have raised still alive.', check: (v) => !!v.s.finale?.won && (v.s.finale.roster ?? []).length >= 10 },
  { id: 'f-storm', act: 8, name: 'Through the storm', text: 'Hold balance for five minutes under a finale challenge.', check: (v) => Object.values(v.s.finale?.challengeBest ?? {}).some((b) => b >= 300) },
  // Across the game
  { id: 'g-ch1', act: 9, name: 'Challenger', text: 'Finish an act challenge.', check: (v) => v.s.challengesDone.length >= 1 },
  { id: 'g-ch4', act: 9, name: 'Glutton for punishment', text: 'Finish four act challenges.', check: (v) => v.s.challengesDone.length >= 4 },
  { id: 'g-ch7', act: 9, name: 'Every road', text: 'Finish all seven act challenges.', check: (v) => v.s.challengesDone.length >= 7 },
  { id: 'g-cards', act: 9, name: 'Reader', text: 'Open 40 science cards.', check: (v) => v.s.seen.filter((x) => x.startsWith('card:')).length >= 40 },
  { id: 'g-complete', act: 9, name: 'Completionist', text: 'Own every upgrade in four acts.', check: (v) => v.s.completed.length >= 4 },
  { id: 'g-res', act: 9, name: 'Squirrel', text: 'Hold 1,000 Reserves at once.', check: (v) => v.s.reserves >= 1000 },
];

/** Variation income multiplier from achievements: +2% each. */
export function achievementBonus(s: GameState): number {
  return 1 + 0.02 * s.achievements.length;
}

export const ROW_NAMES = ['The spark', 'Protocells', 'LUCA', 'Two domains', 'Oxygen', 'The merger', 'Algae and hunters', 'Bodies', 'Biosphere', 'Across the game'];

export interface ChallengeSpec {
  id: string;
  act: number;
  name: string;
  text: string;
  /** Permanent Variation income bonus when finished. */
  bonus: number;
  env?: Record<string, number>; // multipliers on the act's environment
  flags?: string[]; // set at the start
  pacingK?: number; // multiplier on Variation income during the run
  world?: { sugar?: number; ironCap?: number; traits?: string[] };
}

export const CHALLENGES: ChallengeSpec[] = [
  { id: 'c1', act: 1, name: 'Parasites from the start', text: 'Parasitic RNA is in the pool from the first second. Defend early or drown.', bonus: 0.06, flags: ['parasites'] },
  { id: 'c2', act: 2, name: 'A fading vent', text: 'The vent gives 40% less hydrogen. Pump your own protons sooner.', bonus: 0.06, env: { H2: 0.6, vent: 0.7 } },
  { id: 'c3', act: 3, name: 'Half the sugar', text: 'The seeps start half drained. The crash comes early: build the community fast.', bonus: 0.06, world: { sugar: 0.5 } },
  { id: 'c4', act: 4, name: 'Little iron', text: 'Only 30% of the iron sink: oxygen arrives much sooner. Get the anaerobes down in time.', bonus: 0.06, world: { ironCap: 0.3 } },
  { id: 'c5', act: 5, name: 'A thin margin', text: 'Variation comes 30% slower. Every stage of the merger counts.', bonus: 0.06, pacingK: 0.7 },
  { id: 'c6', act: 6, name: 'Hungry hunters', text: 'Big hunters are already there when the act begins.', bonus: 0.06, world: { traits: ['w6-hunt', 'w6-big'] } },
  { id: 'c7', act: 7, name: 'The other branch', text: 'The branch you did not choose builds the body: seaweed if you made animals, animals if you made seaweed.', bonus: 0.08 },
];
