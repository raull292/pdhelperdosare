#!/usr/bin/env node
/**
 * Sync penal-code data from the B-Zone wiki into penal-code.json.
 *
 * Fetches the wiki page, parses every article heading (e.g. "3.12 Jaf"),
 * extracts the objective sanction fields (fine, penalty points, sentence
 * range, life flag) and writes penal-code.json at the repo root. The app
 * merges this file over its built-in data at load time.
 *
 * Safety: only confidently-parsed fields are emitted; the script aborts
 * (exit 1, no file written) if the page shape looks wrong, so a wiki
 * redesign can never push garbage into the app.
 *
 * Renumbering guard: the app merges BY ARTICLE NUMBER and keeps its own
 * names, descriptions and combo rules. If the wiki moves an article to a
 * different number (or replaces one), publishing the new values would glue
 * them onto the wrong article. The script detects that against the
 * previous penal-code.json and refuses to write until index.html has been
 * updated; then run it once with --accept-renumber to record the new
 * numbering.
 *
 * Usage: node scripts/sync-penal-code.mjs [local.html] [--accept-renumber]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = 'https://b-zone-gta-v.github.io/B-Zone-GTA-V-Wiki/server/rules/penal_code.html';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'penal-code.json');

const args = process.argv.slice(2);
const ACCEPT_RENUMBER = args.includes('--accept-renumber');
const localFile = args.find(a => !a.startsWith('--'));

let html;
if (localFile) {
  html = readFileSync(localFile, 'utf8');
} else {
  const res = await fetch(SOURCE, { headers: { 'user-agent': 'pdhelper-sync' } });
  if (!res.ok) { console.error('fetch failed:', res.status); process.exit(1); }
  html = await res.text();
}

// --- html -> structured text (headings marked, lists as "- " lines) ---
let text = html.slice(html.indexOf('VPContent'));
text = text
  .replace(/<h([1-6])[^>]*>/g, '\n@@H$1@@ ')
  .replace(/<\/h[1-6]>/g, '\n')
  .replace(/<li[^>]*>/g, '\n- ')
  .replace(/<\/p>|<br[^>]*>/g, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/[ \t]+/g, ' ')
  .replace(/\n\s*/g, '\n');

// --- split into articles by numbered H3/H4 headings ---
const lines = text.split('\n');
const arts = []; // {id, name, cap, body}
let cap = null, curArt = null;
for (const line of lines) {
  const h2 = line.match(/^@@H2@@\s*CAP\.?\s*(\d+)/i);
  if (h2) { cap = +h2[1]; curArt = null; continue; }
  if (line.startsWith('@@H2@@')) { cap = null; curArt = null; continue; } // e.g. "Definiții Generale"
  const h = line.match(/^@@H[34]@@\s*(\d+(?:\.\d+)+)\s+(.+?)\s*(?:\u200B.*)?$/); // \u200B = VitePress' zero-width header anchor
  if (h) {
    // numbered headings outside a "CAP. N" chapter (0.1 Complicitatea ...) are definitions, not articles
    curArt = cap === null ? null : { id: h[1], name: h[2].trim(), cap, body: '' };
    if (curArt) arts.push(curArt);
    continue;
  }
  // an un-numbered H4 is a sub-section of the current article (e.g. 4.20 "Nivel HIGH"): keep its text
  if (line.startsWith('@@H4@@') && curArt) { curArt.body += line.replace('@@H4@@', '') + '\n'; continue; }
  if (line.startsWith('@@H')) { curArt = null; continue; }
  if (curArt) curArt.body += line + '\n';
}
if (arts.length < 55) { console.error('too few articles parsed:', arts.length); process.exit(1); }

// --- field extractors ---
const num = (s) => parseInt(String(s).replace(/[^\d]/g, ''), 10);
const fmtMoney = (n) => n.toLocaleString('de-DE') + '$'; // 3.000$ style
function parseFine(body) {
  const m = body.match(/Amend[ăa] (?:contraven[țt]ional[ăa]|penal[ăa]):?\s*([\d.]+)\s*\$(?:\s*-\s*([\d.]+)\s*\$)?/i);
  if (!m) return undefined;
  // interval: "15.000–150.000$" (fără $ la primul număr — formatul aplicației)
  return m[2] ? num(m[1]).toLocaleString('de-DE') + '\u2013' + fmtMoney(num(m[2])) : fmtMoney(num(m[1]));
}
function parsePoints(body) {
  const m = body.match(/Puncte penalizare:?\s*(\d+)/i);
  return m ? +m[1] : undefined;
}
function parseSentence(body) {
  const life = body.match(/Sentin[țt][ăa]:?\s*([\d.]+)\s*(?:de\s*)?luni\s*-\s*[îi]nchisoare pe via/i);
  if (life) return { s: [num(life[1]), 600], life: true };
  const m = body.match(/Sentin[țt][ăa]:?\s*([\d.]+)\s*-\s*([\d.]+)\s*(?:de\s*)?luni/i);
  if (m) return { s: [num(m[1]), num(m[2])] };
  return {};
}
const hasLife = (body) => /[îi]nchisoare pe via[țt][ăa]/i.test(body);

// --- build output entries keyed to the app's article ids ---
const out = [];
const push = (id, fields) => {
  const clean = {};
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) clean[k] = v;
  if (Object.keys(clean).length) out.push({ id, ...clean });
};

for (const a of arts) {
  const b = a.body;
  if (a.id === '1.1') {
    // format vechi: "Sub dublul ...: 3.000$ și 3 puncte" / "Peste dublul ...: 7.000$"
    const sub = b.match(/Sub dublul[^:]*:\s*([\d.]+)\s*\$\s*[șs]i\s*(\d+)\s*puncte/i);
    const peste = b.match(/Peste dublul[^:]*:\s*([\d.]+)\s*\$/i);
    if (sub || peste) {
      if (sub) push('1.1a', { f: fmtMoney(num(sub[1])), pct: +sub[2] });
      if (peste) push('1.1b', { f: fmtMoney(num(peste[1])) });
      continue;
    }
    // format nou (sep. 2026): două sub-liste, "...până la dublul..." apoi "...peste dublul...",
    // fiecare cu rândurile ei "Amendă contravențională" / "Puncte penalizare"
    const cut = b.search(/peste dublul/i);
    if (cut > -1) {
      const lo = b.slice(0, cut), hi = b.slice(cut);
      push('1.1a', { f: parseFine(lo), pct: parsePoints(lo) });
      push('1.1b', { f: parseFine(hi), pct: parsePoints(hi) });
    }
    continue;
  }
  if (a.id === '2.3') {
    const split = b.search(/Pentru o concentra[țt]ie/i);
    const first = split > -1 ? b.slice(0, split) : b;
    const second = split > -1 ? b.slice(split) : '';
    push('2.3', { f: parseFine(first), ...parseSentence(first) });
    if (second) push('2.3b', { f: parseFine(second) });
    continue;
  }
  if (/^5\.[2345]$/.test(a.id)) {
    // tiered articles: one entry per "- TIP N (...): ..." line
    for (const line of b.split('\n')) {
      const t = line.match(/^-\s*TIP\s*(I{1,3}|IV)\s*\([^)]*\)\s*:?\s*(.*)/i);
      if (!t) continue;
      const tier = t[1].toUpperCase(), rest = t[2];
      const fm = rest.match(/amend[ăa]\s*([\d.]+)\s*\$/i);
      const sm = rest.match(/sentin[țt][ăa]\s*([\d.]+)\s*-\s*([\d.]+)\s*(?:de\s*)?luni/i);
      if (!fm && !sm) continue; // e.g. the "legal amount" tier
      push(a.id + '-' + tier, {
        f: fm ? fmtMoney(num(fm[1])) : undefined,
        s: sm ? [num(sm[1]), num(sm[2])] : undefined,
      });
    }
    continue;
  }
  const sent = parseSentence(b);
  push(a.id, {
    name: a.name, cap: a.cap,
    f: parseFine(b),
    pct: parsePoints(b),
    s: sent.s,
    life: sent.life || (hasLife(b) && !sent.s ? true : undefined),
  });
}

// --- sanity gates: refuse to publish a suspicious parse ---
const byId = Object.fromEntries(out.map(o => [o.id, o]));
const mustHave = ['1.1a', '1.1b', '1.2', '2.3', '3.12.3', '5.4-IV', '7.8', '8.11'];
for (const id of mustHave) if (!byId[id]) { console.error('missing expected article:', id); process.exit(1); }
if (!byId['1.1a'].f || !byId['1.1b'].f) { console.error('speed-limit fines not parsed (1.1)'); process.exit(1); }
for (const o of out) {
  if (o.s && !(o.s[0] > 0 && o.s[1] >= o.s[0] && o.s[1] <= 600)) { console.error('bad sentence', o.id, o.s); process.exit(1); }
  if (o.pct !== undefined && !(o.pct >= 1 && o.pct <= 9)) { console.error('bad points', o.id, o.pct); process.exit(1); }
}
if (out.length < 60) { console.error('too few sanction entries:', out.length); process.exit(1); }

let prev = null;
if (existsSync(OUT)) { try { prev = JSON.parse(readFileSync(OUT, 'utf8')); } catch { /* rewrite */ } }

// --- renumbering guard (see the header) ---
// A name is reduced to the 4-letter stems of its significant words; two names
// are "the same article" when most of those stems coincide.
const stems = (name) => new Set(String(name).toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').split(' ')
  .filter(w => w.length >= 4).map(w => w.slice(0, 4)));
const sim = (a, b) => {
  const A = stems(a), B = stems(b);
  if (!A.size || !B.size) return a === b ? 1 : 0;
  let common = 0; for (const s of A) if (B.has(s)) common++;
  return common / Math.min(A.size, B.size);
};
const sanctions = (o) => JSON.stringify([o.f, o.pct, o.s, o.life]);
if (prev && Array.isArray(prev.articles)) {
  const named = out.filter(o => o.name);
  const problems = [];
  for (const p of prev.articles) {
    const now = byId[p.id];
    if (!p.name || !now || !now.name || now.name === p.name) continue;
    const same = sim(p.name, now.name);
    if (same >= 0.5) continue; // just reworded
    const movedTo = named.find(o => o.id !== p.id && sim(p.name, o.name) >= 0.75);
    if (movedTo) problems.push(p.id + ' "' + p.name + '" s-a mutat la ' + movedTo.id + '; ' + p.id + ' este acum "' + now.name + '"');
    else if (same === 0 && sanctions(p) !== sanctions(now)) problems.push(p.id + ' "' + p.name + '" a fost înlocuit cu "' + now.name + '"');
  }
  if (problems.length) {
    const msg = 'WIKI-UL A RENUMEROTAT / ÎNLOCUIT ARTICOLE (' + problems.length + '):\n  - ' + problems.join('\n  - ');
    if (!ACCEPT_RENUMBER) {
      console.error(msg + '\n\nNu am scris nimic. Aplicația leagă valorile de numărul articolului, deci întâi trebuie'
        + '\nactualizat index.html (nume, descrieri, reguli combo) la noua numerotare, apoi rulat o dată:'
        + '\n  node scripts/sync-penal-code.mjs --accept-renumber'
        + '\n(sau "Run workflow" cu opțiunea accept_renumber bifată).');
      process.exit(1);
    }
    console.log(msg + '\n--accept-renumber: noua numerotare este înregistrată.');
  }
}

// --- write only when the DATA changed (syncedAt alone never triggers a commit) ---
const payload = { source: SOURCE, syncedAt: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC', articles: out };
if (prev && JSON.stringify(prev.articles) === JSON.stringify(out)) { console.log('no changes (' + out.length + ' entries)'); process.exit(0); }
writeFileSync(OUT, JSON.stringify(payload, null, 1) + '\n');
console.log('penal-code.json updated:', out.length, 'entries');
