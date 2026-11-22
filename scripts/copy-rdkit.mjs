// Copies the RDKit.js engine (7 MB of WebAssembly) from node_modules into public/,
// so it is served next to the page without living in the repository.
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = root + 'node_modules/@rdkit/rdkit/dist/';
const out = root + 'public/rdkit/';
mkdirSync(out, { recursive: true });
for (const f of ['RDKit_minimal.js', 'RDKit_minimal.wasm']) {
  if (!existsSync(out + f)) copyFileSync(src + f, out + f);
}
