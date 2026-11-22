// The codex: everything learned, with the real biochemistry and notes on what
// science still disputes. Tutorial cards are replayable here.
import { useMemo, useState } from 'react';
import { useGame } from '../store';
import { ACTS, CARDS } from '../../content';
import { ScienceCard } from '../components/Overlays';
import { IconVirus } from '../components/Icons';
import { ACT0_UPGRADES } from '../../sim/act0';
import { FINALE_TRAITS } from '../../sim/finale';

const ORDER = ['Origins', 'Molecules', 'Enzymes', 'Pathways', 'Cells', 'Evolution', 'Viruses', 'Ecology', 'Game'];
const ACT0_CARDS = ['origin-sites', 'wet-dry', 'flory', 'vesicles', 'polymerase-ribozyme', 'spark-compression', 'nucleotides', 'major-transitions'];

export function Codex() {
  const snap = useGame((s) => s.snap)!;
  const set = useGame((s) => s.set);
  const known = useMemo(() => {
    const k = new Set<string>(ACT0_CARDS);
    for (const u of ACT0_UPGRADES) k.add(u.card);
    for (let i = 1; i < Math.min(snap.act, 8); i++) {
      const txt = JSON.stringify(ACTS[i]);
      for (const m of txt.matchAll(/"card":"([^"]+)"/g)) k.add(m[1]);
    }
    if (snap.act >= 1 && snap.act < 8) {
      const act = ACTS[snap.act];
      for (const u of act.unlocks) if (snap.unlocked.includes(u.id)) k.add(u.card);
      for (const r of act.network.reactions) if (snap.cell?.present.includes(r.id) && r.card) k.add(r.card);
      for (const s of snap.shop) if (s.state !== 'locked' && s.card) k.add(s.card);
      for (const sp of act.network.species) if (sp.card && (snap.cell?.ids.includes(sp.id) || sp.kind === 'boundary')) k.add(sp.card);
      ['muller', 'variation', 'drift-2s', 'energy-charge', 'growth', 'maintenance', 'dormancy', 'mutators', 'clonal-interference'].forEach((c) => k.add(c));
    }
    if (snap.act >= 8) {
      for (const id of Object.keys(CARDS)) k.add(id);
      for (const t of FINALE_TRAITS) k.add(t.card);
    }
    if (snap.policiesUnlocked) k.add('policies');
    if (snap.evolvability > 1) k.add('evolvability');
    for (const s of snap.seenCards) if (s.startsWith('card:')) k.add(s.slice(5));
    return k;
  }, [snap.act, snap.unlocked, snap.cell?.present, snap.shop, snap.seenCards, snap.policiesUnlocked, snap.evolvability, snap.cell?.ids]);
  const [open, setOpen] = useState<string | null>(null);
  const [cat, setCat] = useState<string>('All');
  const cards = Object.values(CARDS).filter((c) => known.has(c.id) && (cat === 'All' || c.category === cat));
  const total = Object.keys(CARDS).length;
  const sel = open && CARDS[open] ? open : cards[0]?.id;
  const tutorials = snap.act >= 1 && snap.act < 8 ? ACTS[snap.act].unlocks.filter((u) => snap.unlocked.includes(u.id)) : [];
  return (
    <div className={'codex' + (open ? ' reading' : '')}>
      <div className="codex-list">
        <h2 className="screen-title" style={{ padding: '0 6px' }}>Codex</h2>
        <div className="faint" style={{ fontSize: 11.5, padding: '0 6px 12px' }}>
          {known.size >= total ? total : Math.min(known.size, total)} of {total} entries
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '0 4px 12px' }}>
          {['All', ...ORDER].map((c) => (
            <button key={c} className={'btn sm' + (cat === c ? ' primary' : ' ghost')} onClick={() => setCat(c)}>
              {c}
            </button>
          ))}
        </div>
        {cards
          .sort((a, b) => ORDER.indexOf(a.category) - ORDER.indexOf(b.category) || a.title.localeCompare(b.title))
          .map((c) => (
            <button
              key={c.id}
              onClick={() => setOpen(c.id)}
              className="btn ghost"
              style={{ width: '100%', justifyContent: 'space-between', height: 32, background: (sel === c.id ? 'rgba(255,255,255,.05)' : undefined) as string, color: sel === c.id ? 'var(--text)' : undefined }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</span>
              <span className={'badge ev-' + c.evidence} style={{ height: 16, fontSize: 9.5 }}>
                {c.evidence[0]}
              </span>
            </button>
          ))}
        {snap.virusCampaign.unlocked && (
          <button className="btn" style={{ width: '100%', marginTop: 16 }} onClick={() => set({ showVirus: true })}>
            <IconVirus size={16} /> Play the virus{snap.virusCampaign.done ? ' ✓' : ''}
          </button>
        )}
      </div>
      <div className="codex-detail">
        <div style={{ maxWidth: 680 }}>
          <button className="btn ghost sm codex-back" onClick={() => setOpen(null)}>
            ← All entries
          </button>
          {sel ? <ScienceCard id={sel} /> : <div className="faint">Nothing here yet.</div>}
          {tutorials.length > 0 && (
            <>
              <div style={{ marginTop: 34, marginBottom: 10, fontSize: 13, fontWeight: 600, color: 'var(--text-2)' }}>Guide for this act</div>
              {tutorials.map((u) => (
                <div key={u.id} className="card" style={{ padding: '11px 14px', marginBottom: 8 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>{u.title}</div>
                  <div style={{ color: 'var(--text-2)', fontSize: 12.5, lineHeight: 1.55, marginTop: 3 }}>{u.tutorial}</div>
                </div>
              ))}
            </>
          )}
          <p className="faint" style={{ fontSize: 11.5, marginTop: 30, lineHeight: 1.6 }}>
            Every rule traces to a source. Where the game merges or omits steps, the card says so. Parameters start from measured values and are scaled for pacing by documented factors. Evidence: <b>Established</b> = textbook consensus; <b>Likely</b> = strong evidence, some debate; <b>Contested</b> = active disagreement, both sides named; <b>Convenience</b> = a game mechanic, not biology.
          </p>
        </div>
      </div>
    </div>
  );
}
