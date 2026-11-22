// The pathway layout is pure, so it is tested in Node against every act's network.
import { describe, expect, it } from 'vitest';
import { ACTS } from '../../content';
import { buildGeometry, layoutNet, placeLabels } from './layout';

describe('pathway layout', () => {
  for (let i = 1; i <= 7; i++) {
    it(`act ${i}: molecules apart, every reaction drawn, labels near their arrows`, () => {
      const net = ACTS[i].network;
      const present = new Set(net.reactions.filter((r) => !r.hide).map((r) => r.id));
      const L = layoutNet(net, present);
      const shown = new Set<string>();
      for (const r of L.net.reactions) {
        if (!present.has(r.id)) continue;
        for (const id of [...Object.keys(r.sub), ...Object.keys(r.prod)]) {
          const s = L.net.species.find((x) => x.id === id);
          if (s && s.kind !== 'cofactor' && s.x !== undefined) shown.add(id);
        }
      }
      const sp = L.net.species.filter((s) => shown.has(s.id));
      for (let a = 0; a < sp.length; a++)
        for (let b = a + 1; b < sp.length; b++) expect(Math.hypot(sp[a].x! - sp[b].x!, sp[a].y! - sp[b].y!)).toBeGreaterThan(60);

      const geo = buildGeometry(L.net, L.curve, L.primary);
      for (const id of present) if (L.primary.has(id)) expect(geo.has(id)).toBe(true);
      expect(Number.isFinite(L.box.w) && Number.isFinite(L.box.h)).toBe(true);

      const labels = placeLabels(geo, present, L.net.species, shown, null);
      for (const [id, p] of labels) {
        const g = geo.get(id)!;
        expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
        expect(Math.hypot(p.x - g.p.x, p.y - g.p.y)).toBeLessThan(220);
      }
    });
  }
});
