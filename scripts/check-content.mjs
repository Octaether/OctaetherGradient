// Build gate: every content entry must cite a source and carry an evidence
// level, and every card a piece of content points at must exist.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cards = JSON.parse(fs.readFileSync(path.join(root, 'src/content/cards.json'), 'utf8'));
const errors = [];
const have = new Set();
const EV = new Set(['Established', 'Likely', 'Contested', 'Convenience']);
for (const c of cards) {
  if (have.has(c.id)) errors.push(`duplicate card ${c.id}`);
  have.add(c.id);
  if (!c.source || !c.source.trim()) errors.push(`card ${c.id}: missing source`);
  if (!EV.has(c.evidence)) errors.push(`card ${c.id}: missing or bad evidence level`);
  if (!c.body || c.body.split(/(?<=[.!?])\s/).length > 5) errors.push(`card ${c.id}: body must be 2–4 sentences`);
}
const refs = new Set();
const actDir = path.join(root, 'src/content/acts');
for (const f of fs.readdirSync(actDir)) {
  const txt = fs.readFileSync(path.join(actDir, f), 'utf8');
  const act = JSON.parse(txt);
  for (const m of txt.matchAll(/"card":\s*"([^"]+)"/g)) refs.add(m[1]);
  for (const s of act.network.species) if (s.kind !== 'cofactor' && !s.card && s.kind !== 'boundary') errors.push(`${f}: species ${s.id} has no card`);
  for (const r of act.network.reactions) if (!r.card) errors.push(`${f}: reaction ${r.id} has no card (source)`);
  for (const a of act.adaptations) if (!a.card && !a.target) errors.push(`${f}: adaptation ${a.id} has neither card nor target`);
}
for (const f of ['src/sim/act0.ts', 'src/sim/finale.ts', 'src/sim/game.ts', 'src/sim/world.ts']) {
  const t = fs.readFileSync(path.join(root, f), 'utf8');
  for (const m of t.matchAll(/card:\s*'([^']+)'/g)) refs.add(m[1]);
}
for (const r of refs) if (!have.has(r)) errors.push(`missing card: ${r}`);
if (errors.length) {
  console.error('Content check failed:\n  ' + errors.join('\n  '));
  process.exit(1);
}
console.log(`Content OK: ${cards.length} cards, ${refs.size} referenced, all sourced.`);
