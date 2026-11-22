// The evolution tree: every variant of your cells as a branch. A branch splits
// off when a mutation (yours or a random one) creates a new variant; it
// thickens while that variant out-grows the rest and fades if it dies out.
// Fit it to the screen, or zoom in and scroll / drag along time.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useGame, variantName, type LineageMeta } from '../store';
import { LINEAGE, mix } from '../theme';
import { send } from '../simClient';
import { actTitle } from '../components/Chrome';

interface Node {
  id: number;
  m: LineageMeta;
  row: number;
  freq: number;
  alive: boolean;
}

function clock(s: number) {
  const m = Math.floor(s / 60);
  if (m >= 60) return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

const ZOOMS = [20, 40, 80, 160, 320]; // px per minute

export function TreeView() {
  const snap = useGame((s) => s.snap)!;
  const meta = useGame((s) => s.lineageMeta);
  const names = useGame((s) => s.names);
  const head = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 900, h: 500 });
  const [zoom, setZoom] = useState<number | null>(null); // null = fit
  const [extinct, setExtinct] = useState(true);
  const [hover, setHover] = useState<number | null>(null);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  const follow = useRef(true);
  const drag = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    // only real size changes re-layout the tree (avoids feedback loops with scrollbars)
    const measure = () => setSize((p) => (p.w === el.clientWidth && p.h === el.clientHeight ? p : { w: el.clientWidth, h: el.clientHeight }));
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  const live = useMemo(() => new Map(snap.lineages.map((l) => [l.id, l])), [snap.lineages]);
  const nm = (m: LineageMeta, id: number) => variantName(names, snap.act, { id, tag: m.tag, name: m.name });

  const nodes = useMemo(() => {
    let ids = Object.keys(meta).map(Number);
    if (!extinct) {
      // hide small dead branches unless they lead somewhere alive
      const keep = new Set<number>();
      for (const id of ids) {
        if (live.has(id) || meta[id].peak >= 0.05) {
          let cur: number | undefined = id;
          let guard = 0;
          while (cur && meta[cur] && !keep.has(cur) && guard++ < 200) {
            keep.add(cur);
            cur = meta[cur].parent;
          }
        }
      }
      ids = ids.filter((id) => keep.has(id));
    }
    const set = new Set(ids);
    const kids = new Map<number, number[]>();
    const roots: number[] = [];
    for (const id of ids) {
      const p = meta[id].parent;
      if (p && set.has(p)) {
        if (!kids.has(p)) kids.set(p, []);
        kids.get(p)!.push(id);
      } else roots.push(id);
    }
    const order: number[] = [];
    const place = (id: number, depth: number) => {
      if (depth > 80) return;
      const k = (kids.get(id) ?? []).sort((a, b) => meta[a].born - meta[b].born);
      const above = k.filter((_, i) => i % 2 === 1).reverse();
      const below = k.filter((_, i) => i % 2 === 0);
      for (const c of above) place(c, depth + 1);
      order.push(id);
      for (const c of below) place(c, depth + 1);
    };
    for (const r of roots.sort((a, b) => meta[a].born - meta[b].born)) place(r, 0);
    return order.map((id, row) => {
      const l = live.get(id);
      return { id, m: meta[id], row, freq: l?.freq ?? 0, alive: !!l } as Node;
    });
  }, [meta, live, extinct]);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const now = snap.actTime;
  const t0 = Math.min(now, ...nodes.map((n) => n.m.born));
  const spanS = Math.max(60, now - t0);
  const L = 30;
  const R = 150;
  const TOP = 20;
  const BOT = 44;
  const fitW = size.w;
  const W = zoom === null ? fitW : Math.max(fitW, L + R + (spanS / 60) * zoom);
  const fitRow = (size.h - TOP - BOT) / Math.max(1, nodes.length);
  const rowH = zoom === null ? Math.max(16, Math.min(38, fitRow)) : Math.max(22, Math.min(38, fitRow));
  const H = Math.max(size.h, TOP + BOT + rowH * nodes.length);
  const y0 = TOP + Math.max(0, (H - TOP - BOT - rowH * nodes.length) / 2);
  const x = (t: number) => L + ((t - t0) / spanS) * (W - L - R);
  const y = (row: number) => y0 + rowH * (row + 0.5);
  const labels = rowH >= 15;

  // keep "now" in view while following
  useLayoutEffect(() => {
    const el = box.current;
    if (el && follow.current) el.scrollLeft = el.scrollWidth;
  });

  const pxPerMin = (W - L - R) / (spanS / 60);
  const step = [30, 60, 120, 300, 600, 900, 1800, 3600, 7200].find((st) => (st / 60) * pxPerMin >= 90) ?? 7200;
  const ticks: number[] = [];
  for (let t = Math.ceil(t0 / step) * step; t <= now; t += step) ticks.push(t);

  const h = hover !== null ? byId.get(hover) : null;
  const parentName = h && meta[h.m.parent] ? nm(meta[h.m.parent], h.m.parent) : null;
  const zi = zoom === null ? -1 : ZOOMS.indexOf(zoom);
  const zoomBy = (d: number) => {
    follow.current = true;
    if (zoom === null) setZoom(d > 0 ? ZOOMS[Math.max(0, ZOOMS.findIndex((z) => z > pxPerMin))] ?? ZOOMS[ZOOMS.length - 1] : null);
    else {
      const ni = zi + d;
      if (ni < 0) setZoom(null);
      else setZoom(ZOOMS[Math.min(ZOOMS.length - 1, ni)]);
    }
  };

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
      <div ref={head} style={{ padding: '20px 28px 10px', maxWidth: 'min(820px, calc(100% - 330px))' }}>
        <div className="screen-title">Your cells' family tree</div>
        <div className="screen-sub" style={{ marginBottom: 10 }}>
          Every branch is a variant of your cells in {actTitle(snap.act)}. When you evolve a trait, or a lucky random mutation helps, some cells carry the change and a branch splits off. It thickens while those cells
          out-grow the rest and fades if they die out.
        </div>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', fontSize: 12, color: 'var(--text-3)' }}>
          <Key>
            <svg width="14" height="14">
              <circle cx="7" cy="7" r="4.5" fill="var(--accent)" stroke="var(--bg)" strokeWidth="1.5" />
            </svg>
            Trait you evolved
          </Key>
          <Key>
            <svg width="14" height="14">
              <circle cx="7" cy="7" r="3.5" fill="var(--bg)" stroke="var(--text-3)" strokeWidth="1.3" />
            </svg>
            Random mutation
          </Key>
          <Key>
            <svg width="28" height="14">
              <path d="M2 7h24" stroke="var(--text-2)" strokeWidth="5" strokeLinecap="round" />
            </svg>
            Thicker = more cells
          </Key>
          <Key>
            <svg width="28" height="14">
              <path d="M2 7h18" stroke="var(--text-4)" strokeWidth="1.2" />
              <path d="M20 4l5 6M25 4l-5 6" stroke="var(--text-4)" strokeWidth="1.2" />
            </svg>
            Died out
          </Key>
        </div>
      </div>
      <div className="tree-tools">
        <button className={'btn sm' + (zoom === null ? ' primary' : '')} onClick={() => { follow.current = true; setZoom(null); }}>
          Fit
        </button>
        <button className="btn sm" style={{ width: 30, padding: 0 }} onClick={() => zoomBy(-1)} title="Zoom out">
          −
        </button>
        <button className="btn sm" style={{ width: 30, padding: 0 }} onClick={() => zoomBy(1)} title="Zoom in (or ctrl + scroll)">
          +
        </button>
        <label className="target-combine" style={{ marginTop: 0, marginLeft: 8 }}>
          <button type="button" className={'toggle' + (extinct ? ' on' : '')} onClick={() => setExtinct(!extinct)} />
          Show small dead branches
        </label>
        <span className="faint" style={{ fontSize: 11, marginLeft: 'auto' }}>{zoom === null ? 'Fitted to screen' : 'Drag or scroll to move along time'}</span>
      </div>

      <div
        ref={box}
        className="tree-box"
        style={{ cursor: drag.current ? 'grabbing' : zoom === null ? 'default' : 'grab' }}
        onScroll={(e) => {
          const el = e.currentTarget;
          follow.current = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4;
        }}
        onWheel={(e) => {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            zoomBy(e.deltaY < 0 ? 1 : -1);
          }
        }}
        onPointerDown={(e) => {
          const el = box.current!;
          if ((e.target as Element).closest('[data-hit]')) return;
          drag.current = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop };
        }}
        onPointerMove={(e) => {
          const rect = box.current!.getBoundingClientRect();
          setMouse({ x: e.clientX - rect.left, y: e.clientY - rect.top });
          const d = drag.current;
          if (!d) return;
          const el = box.current!;
          el.scrollLeft = d.sl - (e.clientX - d.x);
          el.scrollTop = d.st - (e.clientY - d.y);
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerLeave={() => (drag.current = null)}
      >
        {nodes.length <= 1 && (
          <div style={{ position: 'absolute', left: 0, right: 0, top: '45%', textAlign: 'center', pointerEvents: 'none' }} className="faint">
            Only your original cells so far. Evolve a trait and you will see the first branch appear here.
          </div>
        )}
        <svg width={W} height={H} style={{ display: 'block' }}>
          <defs>
            <filter id="tglow" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur stdDeviation="6" />
            </filter>
          </defs>
          {/* time axis */}
          <line x1={L} x2={x(now)} y1={H - BOT + 12} y2={H - BOT + 12} stroke="var(--line-2)" />
          {ticks.map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={TOP - 6} y2={H - BOT + 16} stroke="var(--line)" strokeDasharray="2 5" />
              <text x={x(t)} y={H - BOT + 30} fill="var(--text-4)" fontSize={10.5} textAnchor="middle" fontFamily="var(--mono)">
                {clock(t)}
              </text>
            </g>
          ))}
          <line x1={x(now)} x2={x(now)} y1={TOP - 10} y2={H - BOT + 16} stroke="var(--accent)" strokeOpacity={0.45} />
          <text x={x(now)} y={H - BOT + 30} fill="var(--accent)" fontSize={10.5} textAnchor="middle" fontWeight={600}>
            now
          </text>
          {nodes.map((n) => {
            const col = LINEAGE[n.m.color % LINEAGE.length];
            const p = byId.get(n.m.parent);
            const xb = x(n.m.born);
            const yy = y(n.row);
            const xe = n.alive ? x(now) : x(n.m.died ?? n.m.born);
            const w = n.alive ? 1.6 + 9 * Math.sqrt(n.freq) : 1.1;
            const op = n.alive ? 1 : 0.32;
            const hl = hover === n.id;
            return (
              <g key={n.id} opacity={hover !== null && !hl && hover !== n.m.parent ? Math.min(op, 0.55) : op}>
                {p && (
                  <path
                    d={(() => {
                      const yp = y(p.row);
                      const r = Math.min(8, Math.abs(yy - yp) / 2);
                      const dir = yy > yp ? 1 : -1;
                      return `M${xb},${yp} L${xb},${yy - dir * r} Q${xb},${yy} ${xb + r},${yy}`;
                    })()}
                    fill="none"
                    stroke={col}
                    strokeOpacity={0.7}
                    strokeWidth={1.2}
                  />
                )}
                <line x1={xb} x2={Math.max(xb + 1, xe)} y1={yy} y2={yy} stroke={col} strokeWidth={w} strokeLinecap="round" strokeOpacity={n.alive ? 0.85 : 0.6} />
                {!n.alive && <path d={`M${xe - 3},${yy - 3}l6,6M${xe + 3},${yy - 3}l-6,6`} stroke={col} strokeWidth={1.2} />}
                {n.alive && n.id === snap.dominant && <circle cx={xe} cy={yy} r={6 + 18 * Math.sqrt(n.freq)} fill={col} opacity={0.28} filter="url(#tglow)" />}
                {n.alive && <circle cx={xe} cy={yy} r={3 + 9 * Math.sqrt(n.freq)} fill={mix(col, 0.3)} stroke={col} strokeWidth={1.4} />}
                {n.alive && n.id === snap.selected && <circle cx={xe} cy={yy} r={6 + 9 * Math.sqrt(n.freq)} fill="none" stroke="var(--white)" strokeWidth={1} strokeDasharray="2 3" />}
                {n.m.chance ? <circle cx={xb} cy={yy} r={3.2} fill="var(--bg)" stroke={col} strokeWidth={1.3} /> : <circle cx={xb} cy={yy} r={p ? 4.6 : 5.5} fill={col} stroke="var(--bg)" strokeWidth={1.6} />}
                {(labels || hl) && (n.alive || n.m.peak > 0.05 || hl) && (
                  <text x={xb + 9} y={yy - Math.max(5, w / 2 + 3)} fill={n.alive ? 'var(--text-2)' : 'var(--text-3)'} fontSize={11} fontWeight={n.id === snap.dominant ? 650 : 500}>
                    {nm(n.m, n.id).slice(0, 34)}
                  </text>
                )}
                {n.alive && (labels || hl) && (
                  <text x={xe + 10 + 9 * Math.sqrt(n.freq)} y={yy + 4} fill="var(--text-2)" fontSize={11} fontFamily="var(--mono)">
                    {n.freq >= 0.995 ? '100%' : (n.freq * 100).toFixed(n.freq < 0.1 ? 1 : 0) + '%'}
                  </text>
                )}
                <rect
                  data-hit
                  x={xb - 6}
                  y={yy - Math.max(7, rowH / 2)}
                  width={Math.max(14, xe - xb + 40)}
                  height={Math.max(14, rowH)}
                  fill="transparent"
                  style={{ cursor: n.alive ? 'pointer' : 'default' }}
                  onMouseEnter={() => setHover(n.id)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => {
                    if (!n.alive) return;
                    send({ type: 'select', lineage: n.id });
                    send({ type: 'view', lineage: n.id });
                  }}
                />
              </g>
            );
          })}
        </svg>
      </div>
        {h && (
          <div
            className="card"
            style={{
              position: 'absolute',
              left: (box.current?.offsetLeft ?? 0) + Math.max(8, Math.min(mouse.x + 16, size.w - 290)),
              top: (box.current?.offsetTop ?? 0) + Math.max(8, Math.min(mouse.y + 14, size.h - 210)),
              width: 270,
              padding: '11px 13px',
              pointerEvents: 'none',
              zIndex: 20,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 10, height: 10, borderRadius: 1, background: LINEAGE[h.m.color % LINEAGE.length] }} />
              <b style={{ fontSize: 13 }}>{nm(h.m, h.id)}</b>
            </div>
            <div className="faint" style={{ fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>
              {parentName ? (
                <>
                  Split from <span style={{ color: 'var(--text-2)' }}>{parentName}</span> at {clock(h.m.born)}, {h.m.chance ? 'by a random mutation that happened to help.' : 'when its cells picked up a gene from the pool.'}
                </>
              ) : (
                'The cells you started this act with.'
              )}
            </div>
            <div style={{ fontSize: 12.5, marginTop: 7 }}>
              {h.alive ? (
                <>
                  <span style={{ color: 'var(--accent)' }}>{(h.freq * 100).toFixed(h.freq < 0.1 ? 1 : 0)}% of your cells</span>
                  {h.m.peak > h.freq + 0.02 && <span className="faint"> · peak {(h.m.peak * 100).toFixed(0)}%</span>}
                </>
              ) : (
                <span className="faint">
                  Died out at {clock(h.m.died ?? 0)} · peak {(h.m.peak * 100).toFixed(h.m.peak < 0.1 ? 1 : 0)}%
                </span>
              )}
            </div>
            {h.m.muts.length > 0 && (
              <div className="faint" style={{ fontSize: 11, marginTop: 7, lineHeight: 1.5 }}>
                Carries: {h.m.muts.slice(-5).join(' · ')}
                {h.m.muts.length > 5 ? ` (+${h.m.muts.length - 5} more)` : ''}
              </div>
            )}
            {h.alive && h.id !== snap.selected && <div style={{ fontSize: 11, marginTop: 7, color: 'var(--text-3)' }}>Click to view this species: its genome and pathway.</div>}
          </div>
        )}
    </div>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{children}</span>;
}
