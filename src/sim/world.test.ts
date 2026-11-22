// The World (community model), achievements and act challenges.
import { describe, expect, it } from 'vitest';
import { ACTS } from '../content';
import { Game } from './game';
import { guild, seedWorld, syntrophyBoost, tickWorld, type WorldCtx } from './world';

const run = (g: Game, seconds: number) => {
  for (let t = 0; t < seconds; t += 0.5) g.tick(0.5);
};

const ctx = (over: Partial<WorldCtx> = {}): WorldCtx => ({
  act: 4,
  prot: { B: 0.6, activity: 1 },
  flag: () => false,
  virus: false,
  ldh: 0.5,
  ...over,
});

describe('the World', () => {
  it('kills strict anaerobes that meet oxygen, but not in the sediment', () => {
    const w = seedWorld(4);
    guild(w, 'archaea')!.layer = 2; // moved down
    guild(w, 'lact')!.layer = 1; // left in the middle water
    for (let t = 0; t < 900; t += 0.5) tickWorld(w, 0.5, ctx({ O2: 1 }));
    expect(guild(w, 'archaea')!.alive).toBe(true);
    expect(guild(w, 'lact')!.alive).toBe(false);
  });

  it('archaea eating H₂ keep it low, which helps fermenters (syntrophy)', () => {
    const fed = seedWorld(4);
    const none = seedWorld(4);
    none.guilds = none.guilds.filter((g) => g.id !== 'archaea');
    const c = ctx({ act: 3, flag: (f) => f === 'heterotrophy', O2: 0 });
    for (let t = 0; t < 1200; t += 0.5) {
      tickWorld(fed, 0.5, c);
      tickWorld(none, 0.5, c);
    }
    expect(fed.res.H2).toBeLessThan(none.res.H2);
    expect(syntrophyBoost(fed)).toBeGreaterThan(1.1);
    expect(syntrophyBoost(none)).toBe(1);
  });

  it('starts with Act III, carries species across acts, and founds specialists', () => {
    const g = new Game(ACTS, null, 5);
    g.jumpTo(3);
    run(g, 4);
    expect(g.snapshot().world).not.toBeNull();
    g.command({ type: 'dev', flag: 'heterotrophy', set: { variation: 1000 } });
    expect(g.command({ type: 'worldBuy', id: 'w3-debris' })).toBe(true);
    expect(g.s.world!.guilds.some((x) => x.id === 'debris' && x.alive)).toBe(true);
    // the same community is there in the next act, with the new protagonist added
    g.command({ type: 'dev', forceGate: true });
    run(g, 2);
    expect(g.command({ type: 'advance' })).toBe(true);
    expect(g.s.act).toBe(4);
    const ids = g.s.world!.guilds.map((x) => x.id);
    expect(ids).toContain('debris');
    expect(ids).toContain('photo');
  });

  it('moves a species to the sediment', () => {
    const g = new Game(ACTS, null, 6);
    g.jumpTo(4);
    run(g, 2);
    g.command({ type: 'dev', set: { variation: 500 } });
    expect(g.command({ type: 'worldBuy', id: 'w4-sed-a' })).toBe(true);
    expect(guild(g.s.world!, 'archaea')!.layer).toBe(2);
    expect(g.command({ type: 'worldBuy', id: 'w4-sed-a' })).toBe(false); // already there
  });
});

describe('achievements and challenges', () => {
  it('earns an achievement for finishing an act', () => {
    const g = new Game(ACTS, null, 7);
    g.jumpTo(1);
    run(g, 4);
    g.command({ type: 'dev', forceGate: true });
    run(g, 2);
    g.command({ type: 'advance' });
    expect(g.s.achievements).toContain('a1-done');
    expect(g.snapshot().achBonus).toBeGreaterThan(1);
  });

  it('plays a challenge while the real game waits, then restores it with the bonus', () => {
    const g = new Game(ACTS, null, 8);
    g.jumpTo(4);
    run(g, 4);
    g.command({ type: 'dev', set: { variation: 123 } });
    const evo = g.s.evolvability;
    expect(g.command({ type: 'actChallenge', id: 'c3' })).toBe(true);
    expect(g.s.act).toBe(3);
    expect(g.s.world!.res.sugar).toBeCloseTo(0.5, 6);
    // abandoning brings the game back unchanged
    expect(g.command({ type: 'abandonChallenge' })).toBe(true);
    expect(g.s.act).toBe(4);
    expect(g.s.a!.variation).toBeCloseTo(123, 0);
    expect(g.s.challengesDone).not.toContain('c3');
    // finishing it is a permanent bonus
    g.command({ type: 'actChallenge', id: 'c3' });
    run(g, 2);
    g.command({ type: 'dev', forceGate: true });
    run(g, 2);
    expect(g.command({ type: 'advance' })).toBe(true);
    expect(g.s.act).toBe(4);
    expect(g.s.challengesDone).toContain('c3');
    expect(g.s.evolvability).toBeGreaterThan(evo);
    expect(g.s.challengeRun).toBeNull();
  });

  it('gives the finale a roster of the species still alive', () => {
    const g = new Game(ACTS, null, 9);
    g.jumpTo(7);
    run(g, 2);
    g.s.world!.guilds.find((x) => x.id === 'archaea')!.alive = false;
    g.command({ type: 'dev', forceGate: true });
    run(g, 2);
    g.command({ type: 'advance' });
    expect(g.s.act).toBe(8);
    expect(g.s.finale!.roster).not.toContain('archaea');
    const snap = g.snapshot();
    expect(snap.finale!.roster!.find((r) => r.id === 'archaea')!.alive).toBe(false);
  });
});
