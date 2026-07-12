#!/usr/bin/env node
/**
 * Sync the server vehicle list from the B-Zone wiki into vehicles.json.
 *
 * The wiki page lists every vehicle as <li>Name</li> followed by an
 * expandable image preview. Only the names are collected. Vehicles whose
 * name contains the standalone tokens MAI or EMS (government faction
 * variants) are excluded — civilians can't drive those, so they only
 * add noise to the car-model autocomplete.
 *
 * Safety: aborts (exit 1, nothing written) when the page shape looks
 * wrong, so a wiki redesign can never push garbage into the app.
 * Optional argument: a local HTML file to parse instead of fetching.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = 'https://b-zone-gta-v.github.io/B-Zone-GTA-V-Wiki/server/rules/vehicles.html';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'vehicles.json');

let html;
if (process.argv[2]) {
  html = readFileSync(process.argv[2], 'utf8');
} else {
  const res = await fetch(SOURCE, { headers: { 'user-agent': 'pdhelper-sync' } });
  if (!res.ok) { console.error('fetch failed:', res.status); process.exit(1); }
  html = await res.text();
}

// only the article body (skip the nav sidebar)
const start = html.indexOf('<h1');
if (start < 0) { console.error('page shape changed: no h1'); process.exit(1); }
const body = html.slice(start);

const decode = (s) => s
  .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ').trim();

const names = [];
for (const m of body.matchAll(/<li[^>]*>([^<]{2,80})<\/li>/g)) {
  const name = decode(m[1]);
  if (!name) continue;
  if (/\b(MAI|EMS)\b/.test(name)) continue;      // vehicule de facțiune (case-sensitive)
  if (!names.includes(name)) names.push(name);
}
names.sort((a, b) => a.localeCompare(b, 'ro'));

// sanity gates
if (names.length < 150) { console.error('too few vehicles parsed:', names.length); process.exit(1); }
const mustHave = ['Pegassi SVJ', 'Annis 350z'];
for (const v of mustHave) if (!names.includes(v)) { console.error('missing expected vehicle:', v); process.exit(1); }
if (names.some(n => /\b(MAI|EMS)\b/.test(n))) { console.error('faction vehicle slipped through'); process.exit(1); }

const payload = { source: SOURCE, syncedAt: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC', vehicles: names };
if (existsSync(OUT)) {
  try {
    const prev = JSON.parse(readFileSync(OUT, 'utf8'));
    if (JSON.stringify(prev.vehicles) === JSON.stringify(names)) { console.log('no changes (' + names.length + ' vehicles)'); process.exit(0); }
  } catch { /* rewrite */ }
}
writeFileSync(OUT, JSON.stringify(payload, null, 1) + '\n');
console.log('vehicles.json updated:', names.length, 'vehicles');
