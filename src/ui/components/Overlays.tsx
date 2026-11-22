import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useMoreBelow } from '../hooks';
import { useGame } from '../store';
import { CARDS, ACTS } from '../../content';
import STORY from '../../content/story.json';
import { send, exportSave, importSave, wipeSave, requestSave } from '../simClient';
import { audio } from '../audio/engine';
import { ACT_TITLES, MOODS, ROMAN } from '../theme';
import { IconClose } from './Icons';
import { Molecule } from './Molecule';
import { fmt, fmtTime, prettyPow } from '../../sim/num';
import { cellSprite, drawSpriteCell, type CellLook } from '../art';

/** Notifications stay until you close them. */
export function Notifications() {
  const notes = useGame((s) => s.notes);
  const dismiss = useGame((s) => s.dismissNote);
  const set = useGame((s) => s.set);
  const shown = notes.slice(-2);
  const hidden = notes.length - shown.length;
  return (
    <div className="notes">
      {hidden > 0 && (
        <button className="btn sm note-more" onClick={() => set({ notes: notes.slice(-2) })}>
          {hidden} more · clear
        </button>
      )}
      <AnimatePresence initial={false}>
        {shown.map((n) => (
          <motion.div key={n.id} className="note" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12, transition: { duration: 0.15 } }} transition={{ duration: 0.25 }}>
            <span className="sw" style={{ background: n.color }} />
            <div style={{ minWidth: 0 }}>
              <div className="t">{n.title}</div>
              {n.text && <div className="b">{n.text}</div>}
            </div>
            <button className="icon-btn x" onClick={() => dismiss(n.id)} aria-label="Dismiss">
              <IconClose size={14} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export function TutorialCard() {
  const tut = useGame((s) => s.tutorials[0]);
  const queued = useGame((s) => s.tutorials.length);
  const dismiss = useGame((s) => s.dismissTutorial);
  const set = useGame((s) => s.set);
  const transition = useGame((s) => s.transition);
  if (!tut || transition) return null;
  const close = () => {
    audio.click();
    send({ type: 'seen', id: 'tut:' + tut.id });
    dismiss();
  };
  return (
    <motion.div key={tut.id} className="tutorial" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <div className="kick">New{queued > 1 ? ` · ${queued - 1} more after this` : ''}</div>
      <h3>{tut.title}</h3>
      <p>{tut.text}</p>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        {tut.card && CARDS[tut.card] && (
          <button className="btn ghost sm" onClick={() => set({ cardOpen: tut.card! })}>
            Read the science
          </button>
        )}
        <button className="btn primary sm" style={{ marginLeft: 'auto' }} onClick={close}>
          Got it
        </button>
      </div>
    </motion.div>
  );
}

export function AlertBanner() {
  const alert = useGame((s) => s.snap?.alert);
  const set = useGame((s) => s.set);
  if (!alert) return null;
  const fix = () => {
    if (!alert.fix) return;
    audio.click();
    if (alert.fix.type === 'adaptation') set({ tab: 'evolve', highlight: alert.fix.id });
    else if (alert.fix.type === 'niche') {
      send({ type: 'niche', id: alert.fix.id });
      set({ tab: 'expand' });
    } else if (alert.fix.type === 'rollback') send({ type: 'rollback', index: Number(alert.fix.id) });
  };
  return (
    <div className={'alert ' + alert.kind}>
      <div className="t">{alert.title}</div>
      <div className="b">{alert.text}</div>
      {alert.fix && (
        <button className="btn sm" style={{ marginTop: 9 }} onClick={fix}>
          {alert.fix.type === 'adaptation' ? 'Show me: ' : ''}
          {alert.fix.label}
        </button>
      )}
    </div>
  );
}

export function CardModal() {
  const id = useGame((s) => s.cardOpen);
  const set = useGame((s) => s.set);
  const card = id ? CARDS[id] : null;
  useEffect(() => {
    if (id) send({ type: 'seen', id: 'card:' + id });
  }, [id]);
  if (!card) return null;
  return (
    <div className="overlay" onClick={() => set({ cardOpen: null })}>
      <motion.div className="modal" initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} onClick={(e) => e.stopPropagation()}>
        <ScienceCard id={card.id} onClose={() => set({ cardOpen: null })} />
      </motion.div>
    </div>
  );
}

export function ScienceCard({ id, onClose }: { id: string; onClose?: () => void }) {
  const card = CARDS[id];
  if (!card) return null;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className="label">{card.category}</span>
        <span className={'badge ev-' + card.evidence}>{card.evidence}</span>
        {onClose && (
          <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Close">
            <IconClose size={16} />
          </button>
        )}
      </div>
      <h2 style={{ marginTop: 10 }}>{card.title}</h2>
      <p style={{ fontSize: 14.5, lineHeight: 1.65, color: 'var(--text)' }}>{card.body}</p>
      {card.smiles && (
        <div className="card" style={{ display: 'grid', placeItems: 'center', padding: 12, margin: '14px 0' }}>
          <Molecule smiles={card.smiles} width={380} height={200} />
        </div>
      )}
      <div className="card" style={{ padding: '12px 14px', marginTop: 14, display: 'grid', gap: 8 }}>
        <Row k="The number" v={<span className="num" style={{ color: 'var(--light)' }}>{card.number}</span>} />
        {card.pdb && (
          <Row
            k="Structure"
            v={
              <a href={`https://www.rcsb.org/structure/${card.pdb}`} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
                PDB {card.pdb}
              </a>
            }
          />
        )}
        {card.simplification && <Row k="Simplified" v={<span className="muted">{card.simplification}</span>} />}
        <Row k="Source" v={<span className="muted">{card.source}</span>} />
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '96px 1fr', gap: 12, fontSize: 12.5 }}>
      <span className="faint">{k}</span>
      {v}
    </div>
  );
}

export function AwayModal() {
  const away = useGame((s) => s.away);
  const set = useGame((s) => s.set);
  if (!away) return null;
  return (
    <div className="overlay">
      <motion.div className="modal" initial={{ y: 12 }} animate={{ y: 0 }} style={{ width: 'min(500px, calc(100vw - 32px))' }}>
        <div className="label">While you were away · {fmtTime(away.seconds)}</div>
        <h2 style={{ marginTop: 6 }}>Evolution kept going</h2>
        <ul style={{ margin: '14px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 8 }}>
          {away.summary.map((s, i) => (
            <li key={i} style={{ display: 'flex', gap: 10, fontSize: 13.5 }}>
              <span style={{ color: 'var(--accent)' }}>›</span>
              <span>{s}</span>
            </li>
          ))}
        </ul>
        <div style={{ textAlign: 'right', marginTop: 22 }}>
          <button className="btn primary" onClick={() => set({ away: null })}>
            Back to it
          </button>
        </div>
      </motion.div>
    </div>
  );
}

export function SettingsModal() {
  const show = useGame((s) => s.showSettings);
  const set = useGame((s) => s.set);
  const st = useGame((s) => s.settings);
  const setS = useGame((s) => s.setSettings);
  const [exp, setExp] = useState('');
  const [imp, setImp] = useState('');
  const [msg, setMsg] = useState('');
  const dev = typeof location !== 'undefined' && /[?&]dev/.test(location.search);
  if (!show) return null;
  const slider = (k: 'master' | 'music' | 'sfx', label: string) => (
    <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 36px', alignItems: 'center', gap: 12, marginTop: 6 }}>
      <span className="muted">{label}</span>
      <input type="range" min={0} max={1} step={0.01} value={st[k]} style={{ ['--fill' as string]: st[k] * 100 + '%' }} onChange={(e) => setS({ [k]: Number(e.target.value) })} />
      <span className="num faint" style={{ fontSize: 11 }}>{Math.round(st[k] * 100)}</span>
    </div>
  );
  return (
    <div className="overlay" onClick={() => set({ showSettings: false })}>
      <motion.div className="modal" initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <h2>Settings</h2>
          <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={() => set({ showSettings: false })}>
            <IconClose size={16} />
          </button>
        </div>
        <div className="label" style={{ marginTop: 14 }}>Sound</div>
        {slider('master', 'Master')}
        {slider('music', 'Music')}
        {slider('sfx', 'Effects')}
        <div className="label" style={{ marginTop: 18 }}>Display</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }} className="muted">
          <button className={'toggle' + (st.reducedMotion ? ' on' : '')} onClick={() => setS({ reducedMotion: !st.reducedMotion })} />
          Reduced motion
        </label>
        <div className="label" style={{ marginTop: 18 }}>Save</div>
        <p style={{ fontSize: 12.5 }}>The game saves every 15 seconds. Export a string to move your save to another browser.</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            className="btn sm"
            onClick={async () => {
              await requestSave();
              const s = exportSave();
              setExp(s);
              try {
                await navigator.clipboard.writeText(s);
                setMsg('Copied to clipboard.');
              } catch {
                setMsg('Select and copy the text below.');
              }
            }}
          >
            Export save
          </button>
          <button className="btn sm" disabled={!imp} onClick={() => (importSave(imp) ? location.reload() : setMsg('That does not look like a Gradient save.'))}>
            Import save
          </button>
          <button
            className="btn sm ghost"
            style={{ marginLeft: 'auto', color: 'var(--danger)' }}
            onClick={() => {
              if (confirm('Erase this save and start again from before life?')) {
                wipeSave();
                location.reload();
              }
            }}
          >
            Erase save
          </button>
        </div>
        {exp && <textarea readOnly value={exp} rows={3} style={{ marginTop: 10 }} onFocus={(e) => e.currentTarget.select()} />}
        <textarea placeholder="Paste a save string to import" value={imp} onChange={(e) => setImp(e.target.value)} rows={2} style={{ marginTop: 10 }} />
        {msg && <p className="faint" style={{ fontSize: 12 }}>{msg}</p>}
        {dev && (
          <p className="faint" style={{ fontSize: 12, marginTop: 18 }}>
            Developer tools: press <kbd>`</kbd> or the DEV tab in the corner.
          </p>
        )}
      </motion.div>
    </div>
  );
}

/** Act transitions: a cinematic that waits for you to continue. */
const EMBLEM: Record<number, CellLook | undefined> = {
  0: { morph: 'proto', color: '#cdb3ff', aspect: 1, features: [], variant: 11 },
  1: { morph: 'proto', color: '#ff7aa8', aspect: 1, features: [], variant: 1 },
  2: { morph: 'rod', color: '#6fe3cf', aspect: 1.6, features: ['fes', 'atps'], variant: 2 },
  3: { morph: 'rod', color: '#ffcb6b', aspect: 1.85, features: ['atps', 'flag', 'glyc'], variant: 3 },
  4: { morph: 'cyano', color: '#c5f27a', aspect: 1, features: ['atps'], variant: 4 },
  5: { morph: 'euk', color: '#9d95ff', aspect: 1, features: ['nucleus', 'mito', 'golgi'], variant: 5 },
  6: { morph: 'euk', color: '#c5e384', aspect: 1, features: ['nucleus', 'golgi', 'mito4', 'chloro'], variant: 6 },
  7: { morph: 'euk', color: '#ff9fc0', aspect: 1, features: ['nucleus', 'mito'], variant: 7 },
};

/**
 * Deep time between acts: a timeline from 4.2 to 0.6 billion years ago, a
 * sentence linking the last act to this one, your lineage so far and what
 * carried over.
 */
function DeepTime({ to }: { to: number }) {
  const snap = useGame((s) => s.snap);
  const tr = useGame((s) => s.transition);
  const tl = STORY.timeline;
  // evenly spaced stops (deep time is far from linear), dates written under each
  const x = (i: number) => 4 + (i / (tl.length - 1)) * 92;
  const link = (STORY.links as Record<string, string>)[String(to)];
  const past = (snap?.actGenomes ?? []).slice(-3);
  const c = tr?.carry;
  return (
    <motion.div style={{ marginTop: 20, textAlign: 'left' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.5, duration: 1 }}>
      <div className="deeptime">
        <div className="dt-line" />
        {tl.map((p, i) => (
          <div key={p.act} className={'dt-pt' + (p.act < to ? ' done' : p.act === to ? ' now' : '')} style={{ left: x(i) + '%' }}>
            <i />
            <span>{p.label}</span>
            <b>{p.ga.toFixed(1)}</b>
          </div>
        ))}
        <div className="dt-unit">billions of years ago</div>
      </div>
      {link && <p style={{ color: 'var(--text)', fontSize: 14, lineHeight: 1.55, margin: '14px 0 0' }}>{link}</p>}
      {snap?.world && to >= 4 && (
        <div className="dt-carry">
          Your community:{' '}
          {snap.world.guilds
            .filter((g) => g.alive)
            .map((g) => g.name)
            .join(' · ')}
          {snap.world.guilds.some((g) => !g.alive) && (
            <span style={{ color: 'var(--danger)' }}>
              {' '}
              · lost:{' '}
              {snap.world.guilds
                .filter((g) => !g.alive)
                .map((g) => g.name)
                .join(', ')}
            </span>
          )}
        </div>
      )}
      {past.length > 0 && (
        <div className="dt-lineage">
          <div className="label">Your lineage so far</div>
          {past.map((g, i) => (
            <div key={i} className="dt-row">
              <b>{g.act === 0 ? 'Act 0' : `Act ${ROMAN[g.act]}`} · {g.title}</b>
              <span>{g.muts.slice(-6).join(' · ') || 'no traits'}</span>
              {g.summary.includes('left unbought') && <em>{g.summary.slice(g.summary.indexOf('left unbought'))}</em>}
            </div>
          ))}
        </div>
      )}
      {c && (c.variation > 0 || c.reserves > 0 || Number(c.biomass) > 0) && (
        <div className="dt-carry">
          Carried over:{' '}
          {[
            c.variation > 0 && <b key="v" style={{ color: 'var(--cur-v)' }}>{fmt(c.variation)} Variation</b>,
            Number(c.biomass) > 0 && <b key="b" style={{ color: 'var(--cur-b)' }}>{fmt(Number(c.biomass))} Biomass</b>,
            c.reserves > 0 && <b key="r" style={{ color: 'var(--atp)' }}>+{fmt(c.reserves)} Reserves</b>,
          ]
            .filter(Boolean)
            .flatMap((el, i) => (i ? [' · ', el] : [el]))}
        </div>
      )}
    </motion.div>
  );
}

export function TransitionCinematic() {
  const tr = useGame((s) => s.transition);
  const introRef = useRef<HTMLDivElement>(null);
  const introMore = useMoreBelow(introRef, tr);
  const set = useGame((s) => s.set);
  const reduced = useGame((s) => s.settings.reducedMotion);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!tr) return;
    setReady(false);
    if (tr.to <= 8) audio.transitionCue();
    else audio.chime('win');
    if (tr.to <= 8) audio.setAct(tr.to);
    const id = setTimeout(() => setReady(true), 1800);
    return () => clearTimeout(id);
  }, [tr]);
  useEffect(() => {
    if (!tr || reduced) return;
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    const dpr = Math.min(2, devicePixelRatio || 1);
    c.width = innerWidth * dpr;
    c.height = innerHeight * dpr;
    const accent = MOODS[Math.min(tr.to, 8)]?.accent ?? '#00e5ff';
    const parts = Array.from({ length: 220 }, () => ({
      a: Math.random() * Math.PI * 2,
      r: 40 + Math.random() * Math.max(innerWidth, innerHeight) * 0.6,
      sp: 0.02 + Math.random() * 0.08,
      s: Math.random() * 1.6 + 0.4,
    }));
    let raf = 0;
    const t0 = performance.now();
    const draw = (t: number) => {
      const el = (t - t0) / 1000;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      const cx = innerWidth / 2;
      const cy = innerHeight / 2 - 40;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(innerWidth, innerHeight) * 0.55);
      g.addColorStop(0, accent + '26');
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, innerWidth, innerHeight);
      // the act's emblem, drawn as line art
      const em = EMBLEM[Math.min(tr.to, 9)];
      if (em) {
        const R = Math.min(innerWidth, innerHeight) * (em.morph === 'rod' ? 0.17 : 0.27);
        const fade = Math.min(1, el * 0.5) * 0.16;
        if (tr.to === 7) {
          for (let i = 0; i < 7; i++) {
            const an = i * 1.0472 + el * 0.03;
            const d = i === 0 ? 0 : R * 0.62;
            drawSpriteCell(ctx, cellSprite(em), cx + Math.cos(an) * d, cy + Math.sin(an) * d, R * 0.34, an, fade, accent);
          }
        } else drawSpriteCell(ctx, cellSprite(em), cx, cy, R, el * 0.04, fade, accent);
      }
      // keep the text area calm and readable
      const vg = ctx.createRadialGradient(cx, cy + 40, 0, cx, cy + 40, 420);
      vg.addColorStop(0, 'rgba(3,5,7,0.82)');
      vg.addColorStop(1, 'rgba(3,5,7,0)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, innerWidth, innerHeight);
      for (const p of parts) {
        p.a += p.sp * 0.016;
        ctx.fillStyle = accent;
        ctx.globalAlpha = Math.min(0.8, el * 0.4) * (0.3 + 0.7 * Math.abs(Math.sin(el + p.r)));
        ctx.beginPath();
        ctx.arc(cx + Math.cos(p.a) * p.r, cy + Math.sin(p.a) * p.r * 0.6, p.s, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [tr, reduced]);
  const to = tr?.to ?? 0;
  const win = to === 9;
  const title = win ? 'A living planet' : to === 0 || to >= 8 ? ACT_TITLES[to >= 8 ? 8 : 0].title : ACTS[to]?.title;
  const quote = win ? 'Producers, consumers, microbes and viruses keep carbon, nitrogen and oxygen in balance on light alone.' : to === 0 || to >= 8 ? ACT_TITLES[to >= 8 ? 8 : 0].quote : ACTS[to]?.quote;
  const intro = win
    ? 'You closed the loop. The postgame keeps going: challenge seeds test whether your biosphere survives temperature swings, starvation, acid and oxygen crashes.'
    : to >= 1 && to < 8
      ? ACTS[to].intro
      : to >= 8
        ? 'Every act is folded into one genome. Now keep a closed planet stable under perturbation, with light as the only input.'
        : 'Four billion years ago there were no cells, only chemistry. At hydrothermal vents and in shallow ponds, simple molecules formed on minerals. Gather them, run wet–dry cycles to join nucleotides into RNA, and wait for one strand that can copy itself.';
  const chText = tr?.challenge ? useGame.getState().snap?.challenges.find((c) => c.id === tr.challenge)?.text : null;
  const goal = to >= 1 && to < 8 ? (chText ? chText + ' ' : '') + prettyPow(ACTS[to].gate.text) : to === 0 ? 'Grow RNA strands long enough and gather vesicles until a self-copying strand ends up inside one: the spark of life.' : '';
  return (
    <AnimatePresence>
      {tr && (
        <motion.div className="overlay" style={{ background: 'rgba(3,5,7,0.96)', backdropFilter: 'none', zIndex: 90 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.8 } }} transition={{ duration: 0.8 }}>
          <canvas ref={canvas} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
          <div className="scan-sweep" style={{ background: MOODS[Math.min(tr.to, 8)]?.accent ?? '#00e5ff' }} />
          <div className="cine-body">
            <div className={'cine-scroll' + (introMore ? ' more' : '')} ref={introRef}>
            <motion.div className="label" style={{ letterSpacing: '0.3em', textTransform: 'uppercase', fontSize: 12 }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4, duration: 0.9 }}>
              {win ? 'The end of the main path' : tr.challenge ? `Challenge · Act ${ROMAN[to]}` : to >= 8 ? 'Finale' : to === 0 ? 'Prologue · Act 0' : `Act ${ROMAN[to]}`}
            </motion.div>
            <motion.h1
              className="cinematic-title"
              style={{ fontSize: 'clamp(34px, min(7vw, 8vh), 72px)', fontWeight: 700, letterSpacing: '0.04em', margin: '8px 0 8px', lineHeight: 1.02, color: MOODS[Math.min(tr.to, 8)]?.accent }}
              initial={{ opacity: 0, y: 12, filter: 'blur(8px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{ delay: 0.7, duration: 1.2 }}
            >
              {title}
            </motion.h1>
            <motion.p style={{ color: 'var(--text-2)', fontSize: 17, fontStyle: 'italic', margin: 0 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.3, duration: 1 }}>
              {quote}
            </motion.p>
            {!win && to >= 1 && <DeepTime to={to} />}
            {intro && (
              <motion.p style={{ color: 'var(--text-2)', fontSize: 13.5, marginTop: 14, lineHeight: 1.6 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.8, duration: 1 }}>
                {intro}
              </motion.p>
            )}
            {goal && (
              <motion.div className="card" style={{ padding: '12px 16px', marginTop: 18, textAlign: 'left', display: 'flex', gap: 10 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2.2, duration: 1 }}>
                <span style={{ color: 'var(--accent)', fontWeight: 650, whiteSpace: 'nowrap' }}>Goal</span>
                <span className="muted" style={{ fontSize: 13.5 }}>{goal}</span>
              </motion.div>
            )}
            </div>
            <motion.div className="cine-cta" initial={{ opacity: 0 }} animate={{ opacity: ready ? 1 : 0 }} transition={{ duration: 0.6 }}>
              {introMore && (
                <button className="more-hint" onClick={() => introRef.current?.scrollBy({ top: introRef.current.clientHeight * 0.7, behavior: 'smooth' })}>
                  Scroll for more <span>▾</span>
                </button>
              )}
              <button className="btn primary lg" disabled={!ready} onClick={() => set({ transition: null })}>
                {to === 0 ? 'Begin' : 'Continue'}
              </button>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
