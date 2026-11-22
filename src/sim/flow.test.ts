// Act flow: no auto-advance, carry-over, Reserves, and the dev commands used for testing.
import { describe, expect, it } from 'vitest';
import { ACTS } from '../content';
import { Game } from './game';

const run = (g: Game, seconds: number) => {
  for (let t = 0; t < seconds; t += 0.5) g.tick(0.5);
};

describe('act flow', () => {
  it('waits for the player when the goals are met, then carries half the Variation over', () => {
    const g = new Game(ACTS, null, 3);
    g.jumpTo(1);
    run(g, 6);
    g.command({ type: 'dev', set: { variation: 200, block: 40 } });
    g.command({ type: 'dev', forceGate: true });
    run(g, 10);
    expect(g.s.act).toBe(1); // no auto-advance
    const snap = g.snapshot();
    expect(snap.advance?.ready).toBe(true);
    expect(snap.advance!.carry.variation / g.s.a!.variation).toBeCloseTo(0.5, 6);
    const reservesBefore = g.s.reserves;
    expect(g.command({ type: 'advance' })).toBe(true);
    expect(g.s.act).toBe(2);
    expect(g.s.reserves).toBeGreaterThan(reservesBefore);
    expect(g.s.a!.variation).toBeGreaterThanOrEqual(snap.advance!.carry.variation);
  });

  it('draws Reserves into raw material at half efficiency', () => {
    const g = new Game(ACTS, null, 4);
    g.jumpTo(2);
    run(g, 2);
    g.command({ type: 'dev', set: { reserves: 100, block: 0 } });
    g.command({ type: 'reserves', amount: 40 });
    expect(g.s.reserves).toBeCloseTo(60, 6);
    expect(g.s.a!.block).toBeCloseTo(20, 6);
    g.command({ type: 'reserves', amount: 1000 });
    expect(g.s.reserves).toBe(0);
  });

  it('owning every upgrade gives the completion bonus on advancing', () => {
    const g = new Game(ACTS, null, 5);
    g.jumpTo(1);
    run(g, 2);
    g.command({ type: 'dev', ownAll: true });
    expect(g.snapshot().advance?.complete).toBe(true);
    const ev = g.s.evolvability;
    g.command({ type: 'dev', forceGate: true });
    g.command({ type: 'advance' });
    expect(g.s.completed).toContain(1);
    expect(g.s.evolvability).toBeCloseTo(ev + 0.1, 6);
  });

  it('dev flags toggle on and off', () => {
    const g = new Game(ACTS, null, 6);
    g.jumpTo(1);
    g.command({ type: 'dev', flag: 'parasites' });
    expect(g.s.a!.flags).toContain('parasites');
    g.command({ type: 'dev', unflag: 'parasites' });
    expect(g.s.a!.flags).not.toContain('parasites');
  });
});

describe('gene pool', () => {
  it('a released gene enters the pool and spreads into new species', () => {
    const g = new Game(ACTS, null, 7);
    g.jumpTo(1);
    run(g, 4);
    g.command({ type: 'dev', set: { variation: 1e4, block: 1e4 } });
    expect(g.command({ type: 'release', id: 'a1-kcat' })).toBe(true);
    expect(g.s.a!.pool?.find((e) => e.id === 'a1-kcat')?.muts.length).toBe(1);
    run(g, 120);
    const carriers = g.s.a!.lineages.filter((l) => l.muts.some((m) => m.adaptation === 'a1-kcat'));
    expect(carriers.length).toBeGreaterThan(0);
    expect(carriers.reduce((n, l) => n + l.freq, 0)).toBeGreaterThan(0.01);
  });

  it('longer genes travel more slowly, and phospholipid membranes take up less', () => {
    const g = new Game(ACTS, null, 8);
    g.jumpTo(1);
    run(g, 2);
    const act = ACTS[1];
    const ad = (id: string) => act.adaptations.find((x) => x.id === id)!;
    const dom = g.dominant();
    expect(g.uptakeRate(dom, ad('a1-ptc'))).toBeLessThan(g.uptakeRate(dom, ad('a1-aa')));
    const base = g.uptakeRate(dom, ad('a1-kcat'));
    g.command({ type: 'dev', own: 'a1-lipid' });
    expect(g.uptakeRate(g.dominant(), ad('a1-kcat'))).toBeCloseTo(base * 0.4, 6);
  });
});
