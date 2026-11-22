import { useState } from 'react';
import { AVOGADRO_ML } from '../../sim/act0';
import { useGame, variantName, nameKey, type DrawerTab } from '../store';
import { LINEAGE, guildColor } from '../theme';
import { ACTS } from '../../content';
import { send } from '../simClient';
import { audio } from '../audio/engine';
import { fmt, Decimal, roman } from '../../sim/num';
import { POOL } from '../theme';
import type { ShopItem, Snapshot, WorldTraitItem } from '../../sim/snapshot';
import { Num } from './Num';
import { AlertBanner, TutorialCard } from './Overlays';
import { IconBiomass, IconBlock, IconCell, IconDna, IconInfo, IconLeaf, IconVariation, IconVirus, IconBolt } from './Icons';

export function Panel() {
  const snap = useGame((s) => s.snap)!;
  if (snap.act === 0) return <WorldDrawer />;
  if (snap.act >= 8) return <FinaleDrawer />;
  return <ActDrawer />;
}

function Tabs({ tabs, current }: { tabs: { id: DrawerTab; label: string; count?: number }[]; current: DrawerTab }) {
  const set = useGame((s) => s.set);
  return (
    <div className="dtabs">
      {tabs.map((t) => (
        <button
          key={t.id}
          className={'dtab' + (current === t.id ? ' on' : '')}
          onClick={() => {
            audio.click();
            set({ tab: t.id });
          }}
        >
          {t.label}
          {t.count ? <span className="count">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

function ActDrawer() {
  const snap = useGame((s) => s.snap)!;
  const tab = useGame((s) => s.tab);
  const tabs: { id: DrawerTab; label: string; count?: number }[] = [
    { id: 'evolve', label: 'Evolve', count: snap.shop.filter((s) => s.state === 'available' && s.affordable).length || undefined },
    { id: 'expand', label: 'Expand', count: snap.niches.filter((n) => n.affordable).length || undefined },
  ];
  if (snap.world) tabs.splice(1, 0, { id: 'community', label: 'Community', count: snap.worldTraits.filter((t) => t.state === 'available' && t.affordable).length || undefined });
  if (snap.chores.length) tabs.push({ id: 'control', label: 'Control', count: snap.chores.some((c) => !c.automated) ? 1 : undefined });
  const current = tabs.find((t) => t.id === tab) ? tab : 'evolve';
  return (
    <aside className="drawer">
      <TutorialCard />
      <AlertBanner />
      <Tabs tabs={tabs} current={current} />
      <div className="dbody">
        {current === 'evolve' && <Evolve />}
        {current === 'community' && <Community />}
        {current === 'expand' && <Expand />}
        {current === 'control' && <Control />}
      </div>
    </aside>
  );
}

const KIND_LABEL: Record<string, string> = {
  point: 'Tune an enzyme',
  dup: 'Copy and specialise a gene',
  gene: 'New gene',
  regulator: 'New regulation',
  stage: 'Major step',
  defence: 'Defence',
  tier: 'Genome upgrade',
};

function kindIcon(kind: string) {
  const c = kind === 'point' || kind === 'dup' ? 'var(--accent)' : kind === 'defence' ? 'var(--oxygen)' : kind === 'stage' ? 'var(--light)' : 'var(--violet)';
  const st = { color: c };
  if (kind === 'defence') return <span style={st}><IconVirus size={17} /></span>;
  if (kind === 'stage') return <span style={st}><IconCell size={17} /></span>;
  if (kind === 'regulator') return <span style={st}><IconLeaf size={17} /></span>;
  if (kind === 'point' || kind === 'dup') return <span style={st}><IconBolt size={16} /></span>;
  return <span style={st}><IconDna size={17} /></span>;
}

function hintFor(it: ShopItem, snap: Snapshot): { cls: string; text: string; tip: string } {
  if (it.rejected > 0) return { cls: 'bad', text: 'Failed before', tip: `Selection removed it before: in your cell it lowered growth (s ${(it.rejectedS * 100).toFixed(1)}%). Fix the bottleneck first.` };
  const er = snap.genome?.errorRatio ?? 0;
  if (snap.act === 1 && it.id === 'a1-fid' && er > 0.85) return { cls: 'good', text: 'Fixes error threshold', tip: 'Your genome is at or past the error threshold: more accurate copying lets a longer genome work.' };
  if (snap.act === 1 && /Genome \+\d+/.test(it.local) && er > 0.7) return { cls: 'warn', text: 'Lengthens genome', tip: 'Adds genome length. Past the error threshold most copies break and replication stalls: evolve Wobble discrimination alongside it.' };
  if (it.kind !== 'point' && it.kind !== 'dup') return { cls: 'new', text: 'New ability', tip: 'Released into the gene pool, cells pick it up over time; carriers win only if it really helps them grow. Its enzymes may start sloppy; tune them afterwards.' };
  const cell = snap.cell;
  if (!it.target || !cell) return { cls: '', text: '', tip: '' };
  if (!cell.present.includes(it.target)) return { cls: '', text: 'Not present yet', tip: '' };
  const c = cell.control[it.target] ?? 0;
  if (cell.bottleneck === it.target) return { cls: 'good', text: 'Bottleneck', tip: 'This enzyme limits growth more than any other right now (highest control coefficient).' };
  if (c > 0.1) return { cls: 'good', text: 'Helps now', tip: `This enzyme has a real share of control over growth (${c.toFixed(2)}).` };
  if (c < 0.03) return { cls: '', text: 'Not limiting', tip: 'Speeding this enzyme up barely changes growth right now; selection may reject it.' };
  return { cls: 'warn', text: 'Small effect', tip: `Control coefficient ${c.toFixed(2)}.` };
}

/**
 * One card for every upgrade in the game (Act 0 builds, gene releases,
 * finale traits): name with level dashes, the effect, then price, the
 * science link and the action.
 */
export function UpgradeCard({
  name,
  sub,
  icon,
  level,
  levels,
  text,
  detail,
  status,
  price,
  chip,
  card,
  action,
  done,
  hl,
  onEnter,
  onLeave,
}: {
  name: string;
  sub?: React.ReactNode;
  icon?: React.ReactNode;
  level: number;
  levels: number;
  text: React.ReactNode;
  detail?: React.ReactNode;
  status?: React.ReactNode;
  price?: React.ReactNode;
  chip?: React.ReactNode;
  card?: string;
  action?: { label: string; disabled: boolean; onClick: () => void; title?: string };
  done: string;
  hl?: boolean;
  onEnter?: () => void;
  onLeave?: () => void;
}) {
  const set = useGame((s) => s.set);
  const finished = level >= levels;
  return (
    <div className={'ocard' + (hl ? ' hl' : '')} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <div className="head">
        {icon && <div className="ico">{icon}</div>}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="name">{name}</div>
          {sub && <div className="faint" style={{ fontSize: 11 }}>{sub}</div>}
        </div>
        {levels > 1 && (
          <span className="levels" title={`${level} of ${levels} levels`}>
            {Array.from({ length: levels }, (_, i) => (
              <i key={i} className={i < level ? 'on' : ''} />
            ))}
          </span>
        )}
      </div>
      <div className="eff">{text}</div>
      {detail && <div className="mol">{detail}</div>}
      {status}
      <div className="foot">
        {chip}
        {finished ? <span className="chip good">{done}</span> : price}
        <span style={{ flex: 1 }} />
        {card && (
          <button className="btn ghost sm" style={{ width: 28, padding: 0 }} title="The science" onClick={() => set({ cardOpen: card })}>
            <IconInfo size={14} />
          </button>
        )}
        {!finished && action && (
          <button className="btn primary sm" disabled={action.disabled} title={action.title} onClick={action.onClick}>
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}

/** A trait in Acts I–VII: release it into the gene pool. */
export function OptionCard({ it }: { it: ShopItem }) {
  const snap = useGame((s) => s.snap)!;
  const set = useGame((s) => s.set);
  const highlight = useGame((s) => s.highlight);
  const act = ACTS[snap.act];
  const hint = hintFor(it, snap);
  const partial = it.share > 0.0005 && it.share < 0.97;
  // are the cells carrying it winning? s = growth advantage over the commonest species
  const carriers = snap.lineages.filter((l) => l.muts.some((m) => m.id.startsWith(it.id + '#')));
  const sBest = carriers.length ? Math.max(...carriers.map((l) => l.s)) : 0;
  const losing = carriers.length > 0 && sBest < -0.0005;
  return (
    <UpgradeCard
      name={it.name}
      icon={kindIcon(it.kind)}
      sub={
        <>
          {KIND_LABEL[it.kind] ?? it.kind}
          {(it.len ?? 0) > 0 && <span title="Genome length it adds"> · +{it.len} {snap.act === 1 ? 'nt' : it.len === 1 ? 'gene' : 'genes'}</span>}
          <span title="How fast the commonest species picks it up from the gene pool, per minute (shorter genes travel faster)."> · spreads {((it.uptake ?? 0) * 100).toFixed((it.uptake ?? 0) < 0.1 ? 1 : 0)}%/min</span>
        </>
      }
      level={it.level}
      levels={it.levels}
      text={it.local}
      detail={it.molecular}
      status={
        partial && (
          <div style={{ fontSize: 11.5, marginTop: 8, color: losing ? 'var(--danger)' : sBest > 0.0005 ? 'var(--accent)' : 'var(--text-3)' }} title="Share of your cells carrying it, and how they grow compared with the commonest species">
            In {(it.share * 100).toFixed(it.share < 0.1 ? 1 : 0)}% of cells ·{' '}
            {losing ? `losing out (${Math.abs(sBest * 100).toFixed(1)}% slower)` : sBest > 0.0005 ? `spreading (${(sBest * 100).toFixed(1)}% faster)` : 'holding steady, no edge right now'}
          </div>
        )
      }
      chip={
        hint.text && (
          <span className={'chip ' + hint.cls} title={hint.tip}>
            {hint.text}
          </span>
        )
      }
      price={
        <>
          <span className={'price' + (snap.variation < it.cost ? ' short' : '')} title="Variation" style={{ ['--cc' as string]: 'var(--cur-v)' } as React.CSSProperties}>
            <IconVariation size={14} />
            {fmt(it.cost, 1)}
          </span>
          {it.block > 0 && (
            <span className={'price' + (snap.block < it.block ? ' short' : '')} title={act.blockName} style={{ ['--cc' as string]: 'var(--accent)' } as React.CSSProperties}>
              <IconBlock size={14} color="var(--accent)" />
              {fmt(it.block, 0)}
            </span>
          )}
        </>
      }
      card={it.card}
      done="Released"
      action={{
        label: it.level > 0 ? `Release ${roman(it.level + 1)}` : 'Release',
        disabled: !it.affordable,
        title: 'Release into the gene pool: every species can pick it up; selection decides who keeps it',
        onClick: () => {
          audio.chime('buy');
          send({ type: 'release', id: it.id });
        },
      }}
      hl={highlight === it.target || highlight === it.id}
      onEnter={() => it.target && set({ highlight: it.target })}
      onLeave={() => set({ highlight: null })}
    />
  );
}

const GENE_COL: Record<string, string> = { core: 'var(--rna)', gene: 'var(--accent)', regulator: 'var(--amber)', dup: 'var(--nad)', tier: 'var(--dna)', defence: 'var(--danger)', stage: 'var(--violet)' };

/**
 * The genome of the species you are viewing, gene by gene: width is length.
 * Dashed ghosts are pooled genes it has not picked up; lines mark its limits.
 */
function GenomeMeter() {
  const snap = useGame((s) => s.snap)!;
  const g = snap.genome;
  if (!g) return null;
  const unit = g.unit === 'nt' ? 'nt' : 'genes';
  const genes = g.genes ?? [];
  const missingGenes = g.missing ?? [];
  const used = genes.reduce((n, x) => n + x.len, 0);
  const extra = missingGenes.reduce((n, x) => n + x.len, 0);
  const limits = [{ v: g.copyCap, label: snap.act === 1 ? 'error threshold' : 'copy limit' }, ...(Number.isFinite(g.energyCap) ? [{ v: g.energyCap, label: 'energy per gene' }] : [])];
  const scale = Math.max(used + extra, ...limits.map((l) => l.v)) * 1.08;
  const over = limits.some((l) => used > l.v);
  const x = (v: number) => (v / scale) * 100 + '%';
  let at = 0;
  return (
    <div className="genome">
      <div className="cas-h">
        <span className="micro">Genome · {g.species}</span>
        <span className="faint" style={{ fontSize: 11 }}>{g.tier}</span>
      </div>
      <div className="gm-lab">
        <span>{snap.act === 1 ? 'Length vs error threshold' : 'Genes vs limits'}</span>
        <b style={{ color: over ? 'var(--danger)' : 'var(--text)' }}>
          {Math.round(used)}
          {extra > 0 && <span className="faint"> +{Math.round(extra)} in pool</span>} / {Math.round(Math.min(...limits.map((l) => l.v)))} {unit}
        </b>
      </div>
      <div className="gm-genes">
        {genes.map((gn) => {
          const left = at;
          at += gn.len;
          return <i key={gn.id} title={`${gn.name}: ${gn.len} ${unit}`} style={{ left: x(left), width: `calc(${x(gn.len)} - 1px)`, background: GENE_COL[gn.kind] ?? 'var(--text-3)' }} />;
        })}
        {missingGenes.map((gn) => {
          const left = at;
          at += gn.len;
          return <i key={'m' + gn.id} className="ghost" title={`In the pool, not carried yet: ${gn.name} (${gn.len} ${unit})`} style={{ left: x(left), width: `calc(${x(gn.len)} - 1px)`, borderColor: GENE_COL[gn.kind] ?? 'var(--text-3)' }} />;
        })}
        {limits.map((l) => (
          <em key={l.label} style={{ left: x(l.v) }} title={`${l.label}: ${Math.round(l.v)} ${unit}`} />
        ))}
      </div>
      <div className="gm-ticks">
        {tickLabels(limits, scale).map((l) => (
          <span key={l.label} style={{ left: x(l.v), transform: l.v / scale > 0.72 ? 'translateX(-100%)' : 'translateX(-50%)' }}>{l.label}</span>
        ))}
      </div>
      {snap.world?.partner && (
        <div title="Each gene moved to the nucleus shrinks the partner's genome and makes it more dependent on its host">
          <div className="gm-lab" style={{ marginTop: 6 }}>
            <span>Partner genome</span>
            <b>
              {snap.world.partner.partnerGenes} genes <span className="faint">· {Math.round(snap.world.partner.dependence * 100)}% moved</span>
            </b>
          </div>
          <div className="gm-genes">
            <i style={{ left: 0, width: `calc(${(snap.world.partner.partnerGenes / 1600) * 100}% - 1px)`, background: 'var(--oxygen)' }} />
            <i className="ghost" style={{ left: `${(snap.world.partner.partnerGenes / 1600) * 100}%`, width: `calc(${(1 - snap.world.partner.partnerGenes / 1600) * 100}% - 1px)`, borderColor: 'var(--oxygen)' }} />
          </div>
        </div>
      )}
      <div className="gm-note">
        {snap.act === 1 ? (
          <>
            <span style={{ color: g.load > 0.7 ? 'var(--danger)' : 'var(--text-3)' }}>{Math.round(g.load * 100)}% of copies come out broken.</span> Every gene adds letters; past the threshold most copies break. Not every species needs every gene.
          </>
        ) : (
          'Every gene costs copying and energy. Past a limit, carrying more genes slows a species down, so the leanest set that does the job wins.'
        )}
      </div>
    </div>
  );
}

/** Limit labels under the genome bar; limits that sit close together share one label. */
function tickLabels(limits: { v: number; label: string }[], scale: number) {
  const out: { v: number; label: string }[] = [];
  for (const l of [...limits].sort((a, b) => a.v - b.v)) {
    const prev = out[out.length - 1];
    if (prev && (l.v - prev.v) / scale < 0.22) prev.label += ' · ' + l.label;
    else out.push({ ...l });
  }
  return out;
}

/** What is in the shared gene pool, and how far each gene has spread. */
function GenePool() {
  const snap = useGame((s) => s.snap)!;
  const pool = snap.pool ?? [];
  return (
    <div className="cassette">
      <div className="cas-h">
        <span className="micro">Gene pool</span>
        <span className="faint" style={{ fontSize: 11 }}>{pool.length ? `${pool.length} released` : 'empty'}</span>
      </div>
      <div className="faint" style={{ fontSize: 11.5, lineHeight: 1.5, marginBottom: pool.length ? 8 : 0 }}>
        {snap.transferHow || 'Released genes spread through the population.'} Release a trait below: species pick it up at their own rate, and selection decides who keeps it.
        {ACTS[snap.act]?.transfer?.card && (
          <button className="lnk" style={{ marginLeft: 6 }} onClick={() => useGame.getState().set({ cardOpen: ACTS[snap.act].transfer!.card! })}>
            The science
          </button>
        )}
      </div>
      {pool.map((e) => (
        <div key={e.id} className="pool-row" title={`Carried by ${(e.share * 100).toFixed(1)}% of cells · the commonest species picks it up at ${(e.uptake * 100).toFixed(1)}% per minute`}>
          <span className="nm">
            {e.name}
            {e.level > 1 ? ` ×${e.level}` : ''}
          </span>
          <div className="gm-bar">
            <i style={{ width: Math.max(1.5, e.share * 100) + '%', background: 'var(--accent)' }} />
          </div>
          <span className="num">{(e.share * 100).toFixed(e.share < 0.1 ? 1 : 0)}%</span>
        </div>
      ))}
    </div>
  );
}

/** Which species you are looking at: the genome above and the pathway map follow it. */
function TargetBar() {
  const snap = useGame((s) => s.snap)!;
  const names = useGame((s) => s.names);
  const rename = useGame((s) => s.rename);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const target = snap.lineages.find((l) => l.id === snap.viewed) ?? snap.lineages.find((l) => l.id === snap.dominant) ?? snap.lineages[0];
  if (!target) return null;
  const nm = variantName(names, snap.act, target);
  const col = LINEAGE[target.color % LINEAGE.length];
  const key = nameKey(snap.act, target.tag, target.id);
  const list = [...snap.lineages].sort((a, b) => b.freq - a.freq).slice(0, 8);
  return (
    <div className="target">
      <div className="target-row">
        <span className="micro faint">Viewing</span>
        <button className="target-pick" onClick={() => setOpen(!open)} title="Choose which species to look at: its genome and its pathway">
          <span className="sw" style={{ background: col, color: col }} />
          <span className="nm">{nm}</span>
          <span className="num faint">{(target.freq * 100).toFixed(target.freq < 0.1 ? 1 : 0)}%</span>
          <span className="faint">▾</span>
        </button>
        <button className="btn ghost sm" style={{ width: 28, padding: 0 }} title="Rename this variant" onClick={() => setEditing(nm)}>
          ✎
        </button>
      </div>
      {editing !== null && (
        <form
          className="target-rename"
          onSubmit={(e) => {
            e.preventDefault();
            rename(key, editing);
            setEditing(null);
          }}
        >
          <input type="text" autoFocus value={editing} maxLength={40} onChange={(e) => setEditing(e.target.value)} onBlur={() => { rename(key, editing); setEditing(null); }} />
        </form>
      )}
      {open && (
        <div className="target-menu">
          {list.map((l) => (
            <button
              key={l.id}
              className={'target-opt' + (l.id === target.id ? ' on' : '')}
              onClick={() => {
                send({ type: 'select', lineage: l.id });
                send({ type: 'view', lineage: l.id });
                setOpen(false);
              }}
            >
              <span className="sw" style={{ background: LINEAGE[l.color % LINEAGE.length], color: LINEAGE[l.color % LINEAGE.length] }} />
              <span className="nm">{variantName(names, snap.act, l)}</span>
              <span className="num faint">{(l.freq * 100).toFixed(l.freq < 0.1 ? 1 : 0)}%</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Evolve() {
  const snap = useGame((s) => s.snap)!;
  const items = snap.shop;
  const spreading = items.filter((it) => it.state === 'sweeping');
  const avail = items.filter((it) => it.state === 'available' && !spreading.includes(it));
  const locked = items.filter((it) => it.state === 'locked');
  const owned = items.filter((it) => it.state === 'owned');
  return (
    <>
      <TargetBar />
      <GenomeMeter />
      <GenePool />
      {spreading.length > 0 && (
        <>
          <div className="dhead">
            <h4>Spreading now</h4>
          </div>
          {spreading.map((it) => (
            <OptionCard key={it.id} it={it} />
          ))}
        </>
      )}
      <div className="dhead">
        <h4>Available</h4>
        <span className="faint" style={{ fontSize: 11.5 }}>
          +{fmt(snap.vIncome, 2)} <IconVariation size={11} /> per second
        </span>
      </div>
      {avail.length === 0 && <div className="faint" style={{ fontSize: 12.5, padding: '6px 2px' }}>Nothing new right now. Keep growing; new options appear as your cells change.</div>}
      {avail.map((it) => (
        <OptionCard key={it.id} it={it} />
      ))}
      {locked.length > 0 && (
        <details style={{ marginTop: 14 }}>
          <summary className="label" style={{ cursor: 'pointer', fontSize: 12 }}>
            Coming later · {locked.length}
          </summary>
          {locked.map((it) => (
            <div key={it.id} className="ocard locked" style={{ padding: '9px 11px' }}>
              <div className="name" style={{ fontSize: 12.5 }}>{it.name}</div>
              <div className="mol">Needs: {it.needs.join(' · ')}</div>
            </div>
          ))}
        </details>
      )}
      {owned.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary className="label" style={{ cursor: 'pointer', fontSize: 12 }}>
            Already in your cells · {owned.length}
          </summary>
          {owned.map((it) => (
            <div key={it.id} style={{ fontSize: 12.5, padding: '5px 4px', display: 'flex', justifyContent: 'space-between' }} className="muted">
              {it.name}
              <span className="faint">✓</span>
            </div>
          ))}
        </details>
      )}
      {snap.policiesUnlocked && (
        <div className="card" style={{ padding: 12, marginTop: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>Auto-evolve</div>
            <div className="faint" style={{ fontSize: 12 }}>Buys the cheapest option on the bottleneck for you. A convenience, not biology.</div>
          </div>
          <button className={'toggle' + (snap.policies.enabled ? ' on' : '')} onClick={() => send({ type: 'policies', policies: { ...snap.policies, enabled: !snap.policies.enabled, skipStructural: true, rule: 'control' } })} />
        </div>
      )}
    </>
  );
}

/** The community: every species you raised, and traits that found, move or improve them. */
function Community() {
  const snap = useGame((s) => s.snap)!;
  const set = useGame((s) => s.set);
  const w = snap.world;
  const items = snap.worldTraits;
  const open = items.filter((t) => t.state !== 'locked');
  const locked = items.filter((t) => t.state === 'locked');
  const guilds = Array.from(new Set(open.map((t) => t.guild)));
  const colorOf = (id: string) => {
    const g = w?.guilds.find((x) => x.id === id);
    return g ? guildColor(g) : 'var(--text-3)';
  };
  return (
    <>
      <div className="faint" style={{ fontSize: 12.5, lineHeight: 1.5, margin: '0 2px 10px' }}>
        Every species you raise lives on in the World and comes back in later acts. Found new specialists, move species to safety and improve them with Variation.
      </div>
      {w && (
        <div className="comm-sum">
          {w.guilds.map((g) => (
            <div key={g.id} className={'wrow' + (g.alive ? '' : ' lost') + (g.danger ? ' danger' : '')} title={`${g.sci}. Eats: ${g.eats}. Makes: ${g.makes}.`}>
              <i style={{ background: guildColor(g) }} />
              <span className="nm">{g.name}</span>
              <span className="wbar">
                <b style={{ width: `${Math.min(100, g.B * 80)}%`, background: guildColor(g) }} />
              </span>
              <span className={'st ' + g.status.replace(' ', '-')}>{g.danger ? 'O₂!' : g.status}</span>
            </div>
          ))}
          <button className="btn ghost sm" style={{ marginTop: 6 }} onClick={() => set({ screen: 'world' })}>
            Open the World screen →
          </button>
        </div>
      )}
      {open.length === 0 && <div className="faint" style={{ fontSize: 12.5, padding: '6px 2px' }}>Nothing to do for the community right now.</div>}
      {guilds.map((gid) => (
        <div key={gid}>
          <div className="comm-guild">
            <i style={{ background: colorOf(gid) }} />
            {open.find((t) => t.guild === gid)?.guildName}
          </div>
          {open
            .filter((t) => t.guild === gid)
            .map((t) => (
              <WorldTraitCard key={t.id} t={t} color={colorOf(gid)} />
            ))}
        </div>
      ))}
      {locked.length > 0 && (
        <details style={{ marginTop: 14 }}>
          <summary className="label" style={{ cursor: 'pointer', fontSize: 12 }}>
            Coming later · {locked.length}
          </summary>
          {locked.map((t) => (
            <div key={t.id} className="ocard locked" style={{ padding: '9px 11px' }}>
              <div className="name" style={{ fontSize: 12.5 }}>{t.name}</div>
              <div className="mol">Needs: {t.needs.join(' · ')}</div>
            </div>
          ))}
        </details>
      )}
    </>
  );
}

function WorldTraitCard({ t, color }: { t: WorldTraitItem; color: string }) {
  const snap = useGame((s) => s.snap)!;
  const verb = t.cost === 0 ? 'Choose' : t.founds ? 'Found' : t.relocate !== undefined ? 'Move' : 'Evolve';
  const done = t.cost === 0 ? 'Chosen' : t.founds ? 'Founded' : t.relocate !== undefined ? 'Moved' : 'Evolved';
  return (
    <UpgradeCard
      name={t.name}
      icon={<span style={{ width: 10, height: 10, borderRadius: '50%', background: color, display: 'inline-block' }} />}
      sub={t.founds ? 'A new species' : t.relocate !== undefined ? 'Move to another layer' : 'Community trait'}
      level={t.level}
      levels={t.levels}
      text={t.text}
      detail={t.science}
      price={
        t.cost > 0 ? (
          <span className={'price' + (snap.variation < t.cost ? ' short' : '')} title="Variation" style={{ ['--cc' as string]: 'var(--cur-v)' } as React.CSSProperties}>
            <IconVariation size={14} />
            {fmt(t.cost, 1)}
          </span>
        ) : (
          <span className="chip">Free choice</span>
        )
      }
      card={t.card}
      done={done}
      action={{
        label: t.levels > 1 && t.level > 0 ? `${verb} ${roman(t.level + 1)}` : verb,
        disabled: !t.affordable,
        onClick: () => {
          audio.chime('buy');
          send({ type: 'worldBuy', id: t.id });
        },
      }}
    />
  );
}

function Expand() {
  const snap = useGame((s) => s.snap)!;
  const act = ACTS[snap.act];
  return (
    <>
      <div className="faint" style={{ fontSize: 12.5, lineHeight: 1.5, margin: '0 2px 12px' }}>
        Spend <b style={{ color: 'var(--cur-b)' }}>Biomass</b> to colonise new ground. More room and food means more {act.unit[1]}, and more {act.unit[1]} make more Variation.
      </div>
      {snap.niches.map((n) => (
        <div key={n.id} className="ocard">
          <div className="head">
            <div className="ico">
              <IconBiomass size={17} />
            </div>
            <div style={{ flex: 1 }}>
              <div className="name">{n.name}</div>
              <div className="faint" style={{ fontSize: 11 }}>
                Level {n.level} of {n.levels}
              </div>
            </div>
          </div>
          <div className="eff">{n.text}</div>
          <div className="foot">
            <span className="chip good">Room ×{n.capacity}</span>
            <span style={{ flex: 1 }} />
            <span className={'price' + (n.affordable ? '' : ' short')}>
              <IconBiomass size={14} />
              <Num value={n.cost} />
            </span>
            <button
              className="btn primary sm"
              disabled={!n.affordable}
              onClick={() => {
                audio.chime('buy');
                send({ type: 'niche', id: n.id });
              }}
            >
              {n.level >= n.levels ? 'Full' : 'Expand'}
            </button>
          </div>
        </div>
      ))}
      <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>
        You make <span className="num">{fmt(new Decimal(snap.bIncome))}</span> Biomass per second.
      </div>
    </>
  );
}

function Control() {
  const snap = useGame((s) => s.snap)!;
  const act = ACTS[snap.act];
  return (
    <>
      <div className="faint" style={{ fontSize: 12.5, lineHeight: 1.5, margin: '0 2px 12px' }}>
        Some jobs you do by hand at first. Later a regulatory gene can take them over: in real cells, automation is regulation.
      </div>
      {snap.chores.map((ch) => {
        const reg = act.adaptations.find((a) => a.id === ch.automatedBy);
        return (
          <div key={ch.id} className="ocard">
            <div className="name">{ch.name}</div>
            <div className="eff">{ch.text}</div>
            {ch.automated ? (
              <div className="chip good" style={{ marginTop: 10 }}>
                Handled by {reg?.name}
              </div>
            ) : (
              <div style={{ marginTop: 10 }}>
                {ch.control === 'toggle' && (
                  <div className="seg">
                    {ch.options.map((o) => (
                      <button
                        key={o.id}
                        className={o.chosen ? 'on' : ''}
                        onClick={() => {
                          audio.click();
                          send({ type: 'chore', id: ch.id, value: o.id });
                        }}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                )}
                {ch.control === 'slider' && (
                  <>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.02}
                      value={ch.value as number}
                      style={{ ['--fill' as string]: (ch.value as number) * 100 + '%' }}
                      onChange={(e) => send({ type: 'chore', id: ch.id, value: Number(e.target.value) })}
                    />
                    <div className="faint" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5 }}>
                      <span>Keep it all</span>
                      <span className="num">{Math.round((ch.value as number) * 100)}%</span>
                      <span>Share it all</span>
                    </div>
                  </>
                )}
                {ch.control === 'choice' &&
                  ch.options.map((o) => (
                    <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderTop: '1px solid var(--line)' }}>
                      <span style={{ fontSize: 12.5, flex: 1, color: o.chosen ? 'var(--text-3)' : 'var(--text)' }}>{o.label}</span>
                      {o.chosen ? (
                        <span className="chip good">Protein ✓</span>
                      ) : (
                        <>
                          <span className="price" style={{ fontSize: 12 }}>
                            <IconBlock size={13} color={POOL[act.blockPool]} />
                            {o.cost}
                          </span>
                          <button
                            className="btn sm primary"
                            disabled={!o.affordable}
                            onClick={() => {
                              audio.chime('buy');
                              send({ type: 'chore', id: ch.id, value: o.id });
                            }}
                          >
                            Assign
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                {reg && <div className="faint" style={{ fontSize: 12, marginTop: 9 }}>To automate this, evolve <b className="muted">{reg.name}</b>.</div>}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

function WorldDrawer() {
  const snap = useGame((s) => s.snap)!;
  const set = useGame((s) => s.set);
  const a = snap.act0!;
  const AV = AVOGADRO_ML;
  const ups = a.upgrades.filter((u) => u.visible);
  const cost = (c: { org: number; nu: number; fa: number }) => (
    <>
      {c.org > 0 && (
        <span className={'price' + (a.org < c.org ? ' short' : '')}>
          <IconBlock size={13} color="var(--carbon)" />
          {fmt(c.org * AV)}
        </span>
      )}
      {c.nu > 0 && (
        <span className={'price' + (a.nu < c.nu ? ' short' : '')}>
          <IconBlock size={13} color="var(--rna)" />
          {fmt(c.nu * AV)}
        </span>
      )}
      {c.fa > 0 && (
        <span className={'price' + (a.fa < c.fa ? ' short' : '')}>
          <IconBlock size={13} color="var(--lipid)" />
          {fmt(c.fa * AV)}
        </span>
      )}
    </>
  );
  const groups: [string, string, string][] = [
    ['vent', 'At the hydrothermal vent', 'Makes organics and fatty acids'],
    ['pond', 'In the shallow pond', 'Makes nucleotides; cycles join them into RNA'],
    ['both', 'Everywhere', ''],
  ];
  return (
    <aside className="drawer">
      <TutorialCard />
      <div className="dtabs">
        <button className="dtab on">Shape the world</button>
      </div>
      <div className="dbody">
        <div className="faint" style={{ fontSize: 12.5, lineHeight: 1.5, margin: '0 2px 12px' }}>
          Nothing can copy itself yet. Spend raw molecules to change the world: minerals that speed reactions, and pools that cycle on their own.
        </div>
        {groups.map(([site, title, sub]) => {
          const list = ups.filter((u) => u.site === site);
          if (!list.length) return null;
          return (
            <div key={site}>
              <div className="dhead">
                <h4>{title}</h4>
                <span className="faint" style={{ fontSize: 11 }}>{sub}</span>
              </div>
              {list.map((u) => (
                <UpgradeCard
                  key={u.id}
                  name={u.name}
                  level={u.level}
                  levels={u.levels}
                  text={u.text}
                  price={cost(u.cost)}
                  card={u.card}
                  done="Built"
                  action={{
                    label: 'Build',
                    disabled: !u.affordable,
                    onClick: () => {
                      audio.chime('buy');
                      send({ type: 'act0', action: 'buy', id: u.id });
                    },
                  }}
                  onEnter={() => set({ highlight: 'site:' + u.site })}
                  onLeave={() => set({ highlight: null })}
                />
              ))}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

/** The finale's species are the ones you kept alive; each missing one weakens a feedback. */
function Roster() {
  const snap = useGame((s) => s.snap)!;
  const roster = snap.finale?.roster;
  if (!roster) return null;
  const w = snap.world;
  return (
    <div className="card" style={{ padding: '10px 12px', marginBottom: 10 }}>
      <div className="dhead" style={{ margin: 0 }}>
        <h4>Your species</h4>
        <span className="faint" style={{ fontSize: 11.5 }}>
          {roster.filter((r) => r.alive).length} of {roster.length}
        </span>
      </div>
      {roster.map((r) => {
        const g = w?.guilds.find((x) => x.id === r.id);
        return (
          <div key={r.id} className={'wrow' + (r.alive ? '' : ' lost')} title={r.alive ? r.role : `Missing: ${r.role}. ${r.cost}`}>
            <i style={{ background: g ? guildColor(g) : 'var(--text-3)' }} />
            <span className="nm">{r.name}</span>
            <span className="faint" style={{ fontSize: 10.5, gridColumn: 'span 2', textAlign: 'right', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {r.alive ? r.role : 'missing: ' + r.cost}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function FinaleDrawer() {
  const snap = useGame((s) => s.snap)!;
  const f = snap.finale!;
  const guilds: [string, string, string][] = [
    ['producers', 'Producers', 'var(--nitrogen)'],
    ['consumers', 'Consumers', 'var(--atp)'],
    ['microbes', 'Microbes', 'var(--nad)'],
    ['viruses', 'Viruses', 'var(--oxygen)'],
  ];
  return (
    <aside className="drawer">
      <TutorialCard />
      <div className="dtabs">
        <button className="dtab on">Traits</button>
      </div>
      <div className="dbody">
        <div className="faint" style={{ fontSize: 12.5, lineHeight: 1.5, margin: '0 2px 8px' }}>
          Each trait adds a feedback that pulls the planet back toward balance. A more diverse biosphere earns more Variation.
        </div>
        <Roster />
        {guilds.map(([g, name, color]) => (
          <div key={g}>
            <div className="dhead">
              <h4 style={{ color }}>{name}</h4>
            </div>
            {f.traits
              .filter((t) => t.guild === g)
              .map((t) => (
                <UpgradeCard
                  key={t.id}
                  name={t.name}
                  level={t.level}
                  levels={t.levels}
                  text={t.text}
                  price={
                    <span className={'price' + (f.variation < t.cost ? ' short' : '')}>
                      <IconVariation size={14} />
                      {fmt(t.cost, 0)}
                    </span>
                  }
                  card={t.card}
                  done="Evolved"
                  action={{
                    label: 'Evolve',
                    disabled: !t.affordable,
                    onClick: () => {
                      audio.chime('buy');
                      send({ type: 'finaleBuy', id: t.id });
                    },
                  }}
                />
              ))}
          </div>
        ))}
        {f.won && (
          <>
            <div className="dhead" style={{ marginTop: 22 }}>
              <h4 style={{ color: 'var(--light)' }}>Challenge seeds</h4>
            </div>
            {f.challenges.map((c) => (
              <div key={c.id} className={'ocard' + (f.challenge === c.id ? ' hl' : '')}>
                <div className="name">{c.name}</div>
                <div className="eff">{c.text}</div>
                <div className="foot">
                  <span className="faint num" style={{ fontSize: 12 }}>best {Math.floor(c.best)} s</span>
                  <span style={{ flex: 1 }} />
                  <button className="btn sm" onClick={() => send({ type: 'challenge', id: f.challenge === c.id ? null : c.id })}>
                    {f.challenge === c.id ? 'Stop' : 'Start'}
                  </button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </aside>
  );
}
