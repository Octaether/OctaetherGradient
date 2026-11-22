// Developer panel (only with ?dev in the URL; toggle with the ` key).
// Jump between acts, set currencies, flip flags, own traits, fast-forward,
// and keep save slots, so any stage of the game can be tested in seconds.
import { useEffect, useMemo, useState } from 'react';
import { useGame } from '../store';
import { send, requestSave, exportSave, loadSlot } from '../simClient';
import { ACTS } from '../../content';
import { fmt } from '../../sim/num';
import { ROMAN } from '../theme';
import type { ActSpec } from '../../sim/types';

export const DEV = typeof location !== 'undefined' && /[?&]dev/.test(location.search);
const SLOT = (i: number) => `gradient.dev.slot${i}`;

/** Every flag an act's content refers to, so each can be toggled. */
function flagsOf(act: ActSpec | undefined): string[] {
  const out = new Set<string>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (o.type === 'flag' && typeof o.key === 'string') out.add(o.key);
      for (const k of ['flag', 'needsFlag', 'hiddenIf']) if (typeof o[k] === 'string') out.add(o[k] as string);
      if (typeof o.requires === 'string') out.add(o.requires);
      Object.values(o).forEach(walk);
    }
  };
  if (act) walk(act);
  return [...out].sort();
}

export function DevPanel() {
  const snap = useGame((s) => s.snap);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'run' | 'traits' | 'flags' | 'species'>('run');
  const [slots, setSlots] = useState<(string | null)[]>(() => [1, 2, 3, 4, 5].map((i) => readSlotLabel(i)));
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === '`' && !(e.target instanceof HTMLInputElement)) setOpen((o) => !o);
    };
    addEventListener('keydown', h);
    return () => removeEventListener('keydown', h);
  }, []);
  const act = snap && snap.act >= 1 && snap.act < 8 ? ACTS[snap.act] : undefined;
  const flags = useMemo(() => flagsOf(act), [act]);
  if (!DEV || !snap) return null;
  if (!open)
    return (
      <button className="dev-tab" onClick={() => setOpen(true)} title="Developer panel (`)">
        DEV
      </button>
    );
  const dev = (o: Record<string, unknown>) => send({ type: 'dev', ...o } as never);
  const a0 = snap.act0;
  const money: { key: string; name: string; value: number }[] = a0
    ? [
        { key: 'org', name: 'Organics (mM)', value: a0.org },
        { key: 'nu', name: 'Nucleotides (mM)', value: a0.nu },
        { key: 'fa', name: 'Fatty acids (mM)', value: a0.fa },
        { key: 'reserves', name: 'Reserves', value: snap.reserves },
      ]
    : snap.finale
      ? [{ key: 'variation', name: 'Variation', value: snap.finale.variation }]
      : [
          { key: 'variation', name: 'Variation', value: snap.variation },
          { key: 'block', name: act?.blockName ?? 'Raw material', value: snap.block },
          { key: 'biomass', name: 'Biomass', value: Number(snap.biomass) },
          { key: 'reserves', name: 'Reserves', value: snap.reserves },
        ];
  const saveSlot = async (i: number) => {
    await requestSave();
    const code = exportSave();
    if (!code) return;
    const label = `${snap.act >= 8 ? 'Finale' : 'Act ' + ROMAN[snap.act]} · ${new Date().toLocaleTimeString()}`;
    try {
      localStorage.setItem(SLOT(i), JSON.stringify({ label, code }));
    } catch {
      /* storage full or blocked */
    }
    setSlots([1, 2, 3, 4, 5].map((k) => readSlotLabel(k)));
  };
  const load = (i: number) => {
    try {
      const raw = localStorage.getItem(SLOT(i));
      if (raw) loadSlot(JSON.parse(raw).code);
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="dev-panel">
      <div className="dev-head">
        <b>Developer</b>
        <span className="faint">` to toggle</span>
        <button className="icon-btn" style={{ marginLeft: 'auto', width: 24, height: 24 }} onClick={() => setOpen(false)}>
          ×
        </button>
      </div>
      <div className="dev-tabs">
        {(['run', 'traits', 'flags', 'species'] as const).map((t) => (
          <button key={t} className={'dev-t' + (tab === t ? ' on' : '')} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      <div className="dev-body">
        {tab === 'run' && (
          <>
            <div className="dev-row">
              <span className="dev-k">Speed</span>
              {[0, 1, 5, 20, 100].map((x) => (
                <button key={x} className={'btn sm' + (snap.speed === x ? ' primary' : '')} onClick={() => dev({ speed: x })}>
                  {x === 0 ? 'Pause' : '×' + x}
                </button>
              ))}
            </div>
            <div className="dev-row">
              <span className="dev-k">Act</span>
              {Array.from({ length: 9 }, (_, i) => (
                <button key={i} className={'btn sm' + (snap.act === i ? ' primary' : '')} onClick={() => dev({ jump: i })}>
                  {i === 8 ? 'F' : ROMAN[i]}
                </button>
              ))}
            </div>
            <div className="dev-row">
              <span className="dev-k">Goals</span>
              <button className="btn sm" onClick={() => dev({ forceGate: !snap.advance?.ready })}>
                {snap.advance?.ready ? 'Un-complete' : 'Complete goals'}
              </button>
              <button className="btn sm" onClick={() => dev({ skip: true })}>
                Skip act
              </button>
              {snap.act === 0 && (
                <button className="btn sm" onClick={() => dev({ spark: true })}>
                  Spark now
                </button>
              )}
            </div>
            <div className="dev-row">
              <span className="dev-k">Time</span>
              {[1, 5, 30].map((m) => (
                <button key={m} className="btn sm" onClick={() => dev({ ff: m * 60 })}>
                  +{m} min
                </button>
              ))}
            </div>
            <div className="dev-sec">Currencies</div>
            {money.map((m) => (
              <MoneyRow key={m.key} name={m.name} value={m.value} onSet={(v) => dev({ set: { [m.key]: v } })} />
            ))}
            <div className="dev-row">
              <button className="btn sm" onClick={() => dev({ grant: true })}>
                Grant a lot
              </button>
            </div>
            <div className="dev-sec">Save slots</div>
            {slots.map((label, i) => (
              <div key={i} className="dev-row">
                <span className="dev-k">{i + 1}</span>
                <span className="faint" style={{ flex: 1, fontSize: 11 }}>
                  {label ?? 'empty'}
                </span>
                <button className="btn sm" onClick={() => saveSlot(i + 1)}>
                  Save
                </button>
                <button className="btn sm" disabled={!label} onClick={() => load(i + 1)}>
                  Load
                </button>
              </div>
            ))}
            <div className="faint" style={{ fontSize: 11, marginTop: 8 }}>
              Start any act fresh from the address bar: <code>?dev&amp;act=3</code>
            </div>
          </>
        )}
        {tab === 'traits' && (
          <>
            <div className="dev-row">
              <button className="btn sm" onClick={() => dev({ ownAll: true })}>
                Own all
              </button>
            </div>
            {snap.shop.map((s) => (
              <div key={s.id} className="dev-row">
                <span style={{ flex: 1, fontSize: 12 }}>
                  {s.name}
                  <span className="faint"> · {s.state}</span>
                </span>
                <button className="btn sm" disabled={s.state === 'owned'} onClick={() => dev({ own: s.id })}>
                  Own
                </button>
              </div>
            ))}
            {!snap.shop.length && <div className="faint">No traits in this act.</div>}
          </>
        )}
        {tab === 'flags' && (
          <>
            {flags.map((f) => {
              const on = snap.flags.includes(f);
              return (
                <div key={f} className="dev-row">
                  <span style={{ flex: 1, fontFamily: 'var(--mono)', fontSize: 11.5 }}>{f}</span>
                  <button className={'toggle' + (on ? ' on' : '')} onClick={() => dev(on ? { unflag: f } : { flag: f })} />
                </div>
              );
            })}
            {!flags.length && <div className="faint">No flags in this act.</div>}
          </>
        )}
        {tab === 'species' && (
          <table className="dev-table">
            <thead>
              <tr>
                <th>Species</th>
                <th>Share</th>
                <th>Growth</th>
                <th>s</th>
              </tr>
            </thead>
            <tbody>
              {snap.lineages.map((l) => (
                <tr key={l.id}>
                  <td>{l.name}</td>
                  <td>{(l.freq * 100).toFixed(1)}%</td>
                  <td>{fmt(l.mu, 3)}</td>
                  <td style={{ color: l.s > 0 ? 'var(--green)' : l.s < 0 ? 'var(--danger)' : undefined }}>{(l.s * 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function MoneyRow({ name, value, onSet }: { name: string; value: number; onSet: (v: number) => void }) {
  const [text, setText] = useState('');
  return (
    <div className="dev-row">
      <span className="dev-k" style={{ width: 120 }}>
        {name}
      </span>
      <span className="num" style={{ width: 64, fontSize: 11.5 }}>
        {fmt(value)}
      </span>
      <input type="text" placeholder="set to…" value={text} onChange={(e) => setText(e.target.value)} style={{ width: 80, padding: '3px 6px', borderRadius: 0 }} onKeyDown={(e) => e.key === 'Enter' && Number.isFinite(Number(text)) && (onSet(Number(text)), setText(''))} />
      <button className="btn sm" onClick={() => onSet(Math.max(100, value * 10))}>
        ×10
      </button>
    </div>
  );
}

function readSlotLabel(i: number): string | null {
  try {
    const raw = localStorage.getItem(SLOT(i));
    return raw ? (JSON.parse(raw).label as string) : null;
  } catch {
    return null;
  }
}
