import { useEffect, useRef, useState } from 'react';

/** A DPR-aware canvas with a requestAnimationFrame loop. */
export function useCanvas(draw: (ctx: CanvasRenderingContext2D, w: number, h: number, t: number, dt: number) => void, deps: unknown[] = []) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const dpr = Math.min(1.5, devicePixelRatio || 1);
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (w < 2 || h < 2) {
        raf = requestAnimationFrame(loop);
        return;
      }
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawRef.current(ctx, w, h, now / 1000, dt);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

/** Enter or leave browser fullscreen: more room without shrinking the text. */
export function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  else void document.documentElement.requestFullscreen?.().catch(() => {});
}

/**
 * True while a scrollable element has content below what is visible, so the
 * UI can say "more below". Re-checks on scroll, on resize and after renders.
 */
export function useMoreBelow(ref: { current: HTMLElement | null }, dep?: unknown) {
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) {
      setMore(false);
      return;
    }
    const check = () => setMore(el.scrollTop + el.clientHeight < el.scrollHeight - 4);
    check();
    el.addEventListener('scroll', check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(el);
    for (const c of Array.from(el.children)) ro.observe(c);
    const id = setInterval(check, 800); // content that grows or animates in
    return () => {
      el.removeEventListener('scroll', check);
      ro.disconnect();
      clearInterval(id);
    };
  }, [ref, dep]);
  return more;
}

/** True while the page is fullscreen. */
export function useFullscreen() {
  const [full, setFull] = useState(() => !!document.fullscreenElement);
  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  return full;
}

/** Deterministic pseudo-random from an integer seed. */
export function hash01(n: number) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Phones in portrait get their own layout: bottom tabs, and the drawer as a sheet. */
const MOBILE_MQ = '(max-width: 760px)';
export const isMobile = () => typeof matchMedia !== 'undefined' && matchMedia(MOBILE_MQ).matches;
export function useMobile() {
  const [m, setM] = useState(isMobile);
  useEffect(() => {
    const q = matchMedia(MOBILE_MQ);
    const on = () => setM(q.matches);
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, []);
  return m;
}

/** Phones either way round: legends start folded so the scene has the room. */
export const isCompact = () => typeof matchMedia !== 'undefined' && matchMedia('(max-width: 760px), (max-height: 500px)').matches;
