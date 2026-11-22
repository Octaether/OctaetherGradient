import { describe, expect, it } from 'vitest';
import { compile, conservationError, integrate, paramsFor, steadyState } from './cell';
import { ACTS, CARDS } from '../content';
import { Game } from './game';
import { newFinale, tickFinale, FINALE_TRAITS, inBands } from './finale';
import { Rng } from './rng';

const ALL_FLAGS = ['atps', 'wl', 'ech', 'glycolysis', 'ldh', 'oxygenic', 'sod', 'resp', 'aac', 'endo', 'plastid', 'nitroplast', 'lipidzyme', 'parasites'];

describe('conserved pools', () => {
  for (const [i, act] of Object.entries(ACTS)) {
    it(`act ${i}: every conserved pool stays constant to 1e-9 over a 10-hour run`, () => {
      const p = paramsFor(act.network, { muts: [] }, ALL_FLAGS);
      const { c, s } = compile(act.network, p, act.env);
      integrate(c, s, 36000, 5);
      expect(conservationError(c, s)).toBeLessThan(1e-9);
      for (const x of s) expect(Number.isFinite(x)).toBe(true);
    });
  }
  it('declared pools are in the left null space', () => {
    for (const act of Object.values(ACTS)) {
      if (act.network.dilution) continue;
      const p = paramsFor(act.network, { muts: [] }, ALL_FLAGS);
      const { c, s } = compile(act.network, p, act.env);
      for (const pool of act.network.pools) {
        const before = pool.species.reduce((a, id) => a + s[c.index[id]], 0);
        integrate(c, s, 600, 2);
        const after = pool.species.reduce((a, id) => a + s[c.index[id]], 0);
        expect(Math.abs(after - before) / before).toBeLessThan(1e-9);
      }
    }
  });
});

describe('steady states', () => {
  for (const [i, act] of Object.entries(ACTS)) {
    it(`act ${i}: founding genotype has a positive steady growth rate`, () => {
      const p = paramsFor(act.network, { muts: [] }, []);
      p.globals.functional = 0.26;
      const { c, s } = compile(act.network, p, act.env);
      const ss = steadyState(c, s);
      expect(ss.mu).toBeGreaterThan(0);
    });
  }
});

describe('content', () => {
  it('every card has a source and an evidence level', () => {
    for (const c of Object.values(CARDS)) {
      expect(c.source.length).toBeGreaterThan(0);
      expect(['Established', 'Likely', 'Contested', 'Convenience']).toContain(c.evidence);
    }
  });
  it('every reaction and species card reference resolves', () => {
    for (const act of Object.values(ACTS)) {
      for (const r of act.network.reactions) if (r.card) expect(CARDS[r.card], r.card).toBeTruthy();
      for (const a of act.adaptations) if (a.card) expect(CARDS[a.card], a.card).toBeTruthy();
      for (const u of act.unlocks) expect(CARDS[u.card], u.card).toBeTruthy();
    }
  });
});

describe('game', () => {
  it('runs every act headless and serialises', () => {
    const g = new Game(ACTS, null, 3);
    for (let act = 1; act <= 7; act++) {
      g.jumpTo(act);
      for (let i = 0; i < 120; i++) g.tick(0.5);
      const snap = g.snapshot();
      expect(snap.act).toBe(act);
      expect(Number(snap.P)).toBeGreaterThan(0);
      const save = JSON.parse(JSON.stringify(g.serialize()));
      const g2 = new Game(ACTS, save, 3);
      expect(g2.s.act).toBe(act);
    }
  });
  it('the finale is winnable with every trait', () => {
    const f = newFinale();
    for (const t of FINALE_TRAITS) f.traits[t.id] = t.levels;
    const rng = new Rng(2);
    let ok = 0;
    for (let t = 0; t < 1200; t++) {
      tickFinale(f, 1, rng);
      if (Object.values(inBands(f)).every(Boolean)) ok++;
    }
    expect(f.best).toBeGreaterThanOrEqual(300);
    expect(ok).toBeGreaterThan(600);
  });
});
