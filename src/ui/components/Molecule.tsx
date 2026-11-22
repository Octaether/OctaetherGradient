// 2D skeletal formulas from SMILES, drawn by RDKit.js (BSD) and restyled to the
// game's palette: hairline bonds in the text colour, heteroatoms in muted
// element colours. Lazy-loaded so the 7 MB engine costs nothing until used.
import { useEffect, useState } from 'react';

interface RDMol {
  get_svg_with_highlights(details: string): string;
  delete(): void;
}
interface RDKitModule {
  get_mol(smiles: string): RDMol | null;
}

let rdkit: Promise<RDKitModule | null> | null = null;
const cache = new Map<string, string>();

function loadRDKit(): Promise<RDKitModule | null> {
  if (rdkit) return rdkit;
  rdkit = new Promise((resolve) => {
    const base = new URL('rdkit/', document.baseURI).href;
    const s = document.createElement('script');
    s.src = base + 'RDKit_minimal.js';
    s.async = true;
    s.onload = () => {
      const init = (window as unknown as { initRDKitModule?: (o: unknown) => Promise<RDKitModule> }).initRDKitModule;
      if (!init) return resolve(null);
      init({ locateFile: () => base + 'RDKit_minimal.wasm' })
        .then(resolve)
        .catch(() => resolve(null));
    };
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
  return rdkit;
}

const PALETTE = {
  1: [0.66, 0.65, 0.62],
  6: [0.91, 0.89, 0.85],
  7: [0.55, 0.66, 0.98],
  8: [1.0, 0.52, 0.47],
  15: [0.95, 0.71, 0.27],
  16: [0.85, 0.82, 0.42],
};

export function Molecule({ smiles, color, width = 290, height = 170 }: { smiles: string; color?: string; width?: number; height?: number }) {
  const key = smiles + width + 'x' + height;
  const [svg, setSvg] = useState<string | null>(cache.get(key) ?? null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (cache.has(key)) {
      setSvg(cache.get(key)!);
      return;
    }
    let alive = true;
    loadRDKit().then((rd) => {
      if (!alive) return;
      if (!rd) return setFailed(true);
      const mol = rd.get_mol(smiles);
      if (!mol) return setFailed(true);
      const out = mol.get_svg_with_highlights(
        JSON.stringify({
          width,
          height,
          bondLineWidth: 1,
          clearBackground: false,
          backgroundColour: [0, 0, 0, 0],
          atomColourPalette: PALETTE,
          addStereoAnnotation: false,
          fixedFontSize: 13,
          padding: 0.08,
        }),
      );
      mol.delete();
      const cleaned = out.replace(/<rect[^>]*style='opacity:1.0;fill:#FFFFFF[^>]*>/g, '').replace(/font-family:sans-serif/g, 'font-family:Inter Variable,sans-serif');
      cache.set(key, cleaned);
      setSvg(cleaned);
    });
    return () => {
      alive = false;
    };
  }, [key, smiles, width, height]);
  if (failed) return <span className="faint mono" style={{ fontSize: 11, wordBreak: 'break-all' }}>{smiles}</span>;
  if (!svg)
    return (
      <span className="faint" style={{ fontSize: 11, color }}>
        drawing structure…
      </span>
    );
  return <div style={{ width, height, filter: 'drop-shadow(0 0 12px rgba(232,228,218,0.05))' }} dangerouslySetInnerHTML={{ __html: svg }} />;
}
