#!/usr/bin/env node
// parity.mjs: compare SEO-relevant responses of two servers path by path.
// Use it while moving traffic from an old stack to a new one: the old server is the spec.
// No dependencies. Node 20+ (uses global fetch).
//
// Parsing limits (regex, not a full HTML parser):
// - only the first <title> and the first matching <meta>/<link> per name are read
// - tags built by client-side JavaScript are invisible; this compares server HTML only
// - attribute values must be quoted with " or '; unquoted values are ignored
// - HTML comments and <script>/<style> bodies are stripped before matching meta tags,
//   but CDATA and unusual markup can still confuse it
// - JSON-LD that fails JSON.parse is reported as "invalid"

import { readFile } from 'node:fs/promises';

const HELP = `Usage: node parity.mjs --a <origin> --b <origin> --paths <file> [options]

Requests every path on both origins without following redirects and compares:
status, Location, <title>, meta description, canonical, robots,
og:title / og:description / og:image, twitter:card, hreflang count,
JSON-LD @type list, and HTML size (warns above 2MB, Googlebot's HTML limit).

Options:
  --a <origin>         old server, e.g. https://old.example.com
  --b <origin>         new server, e.g. https://new.example.com
  --paths <file>       one path per line (lines starting with # are ignored)
  --ua <name|string>   googlebot | bingbot | browser | any custom string (default browser)
  --header "K: V"      extra request header for both servers (repeatable)
  --concurrency <n>    parallel paths (default 4)
  --json               print JSON
  -h, --help           show this help

Exit code: 0 when every path matches, 1 when any path differs, 2 on bad input.
Absolute Location and canonical URLs are compared after replacing each server's
own origin with "<origin>", so https://old.example.com/x equals https://new.example.com/x.`;

const UAS = {
  browser: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  googlebot: 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  bingbot: 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
};
const TWO_MB = 2 * 1024 * 1024;

function fail(msg) { console.error(`error: ${msg}`); process.exit(2); }

function parseArgs(argv) {
  const o = { a: null, b: null, paths: null, ua: 'browser', headers: {}, concurrency: 4, json: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const need = () => { if (i + 1 >= argv.length) fail(`${k} needs a value`); return argv[++i]; };
    if (k === '-h' || k === '--help') { console.log(HELP); process.exit(0); }
    else if (k === '--a') o.a = need();
    else if (k === '--b') o.b = need();
    else if (k === '--paths') o.paths = need();
    else if (k === '--ua') o.ua = need();
    else if (k === '--concurrency') o.concurrency = Number(need());
    else if (k === '--json') o.json = true;
    else if (k === '--header') {
      const h = need(); const i2 = h.indexOf(':');
      if (i2 < 1) fail(`--header must look like "Name: value": ${h}`);
      o.headers[h.slice(0, i2).trim()] = h.slice(i2 + 1).trim();
    } else fail(`unknown argument ${k} (see --help)`);
  }
  if (!o.a || !o.b || !o.paths) fail('--a, --b and --paths are required (see --help)');
  for (const u of [o.a, o.b]) {
    try { const x = new URL(u); if (!/^https?:$/.test(x.protocol)) throw 0; } catch { fail(`not an http(s) origin: ${u}`); }
  }
  o.a = o.a.replace(/\/+$/, ''); o.b = o.b.replace(/\/+$/, '');
  if (!Number.isInteger(o.concurrency) || o.concurrency < 1) fail('--concurrency must be a positive integer');
  o.uaString = UAS[o.ua.toLowerCase()] ?? o.ua;
  return o;
}

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/\s+/g, ' ').trim();

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    out[m[1].toLowerCase()] = decode(m[3] ?? m[4] ?? '');
  }
  return out;
}

function extract(html) {
  const jsonLdBlocks = [...html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  // Strip comments, scripts and styles so commented-out or inline-JS tags are not matched.
  const clean = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '');
  const head = clean.match(/<head\b[\s\S]*?<\/head>/i)?.[0] ?? clean;
  const metas = [...head.matchAll(/<meta\b[^>]*>/gi)].map((m) => attrs(m[0]));
  const links = [...head.matchAll(/<link\b[^>]*>/gi)].map((m) => attrs(m[0]));
  const meta = (key) => metas.find((a) => (a.name ?? a.property ?? '').toLowerCase() === key)?.content ?? null;
  const relHas = (a, r) => (a.rel ?? '').toLowerCase().split(/\s+/).includes(r);

  const types = [];
  for (const block of jsonLdBlocks) {
    try {
      const walk = (n) => {
        if (Array.isArray(n)) return n.forEach(walk);
        if (n && typeof n === 'object') {
          if (n['@type']) types.push(...[].concat(n['@type']).map(String));
          if (n['@graph']) walk(n['@graph']);
        }
      };
      walk(JSON.parse(block));
    } catch { types.push('invalid'); }
  }
  const title = clean.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return {
    title: title === undefined ? null : decode(title),
    description: meta('description'),
    canonical: links.find((a) => relHas(a, 'canonical'))?.href ?? null,
    robots: meta('robots'),
    'og:title': meta('og:title'),
    'og:description': meta('og:description'),
    'og:image': meta('og:image'),
    'twitter:card': meta('twitter:card'),
    hreflang: links.filter((a) => relHas(a, 'alternate') && a.hreflang).length,
    jsonld: [...new Set(types)].sort().join(', ') || null,
  };
}

async function probe(origin, path, o) {
  const url = origin + (path.startsWith('/') ? path : `/${path}`);
  try {
    const res = await fetch(url, { redirect: 'manual', headers: { 'user-agent': o.uaString, accept: 'text/html,*/*', ...o.headers } });
    const buf = Buffer.from(await res.arrayBuffer());
    const type = res.headers.get('content-type') ?? '';
    const r = { status: res.status, location: res.headers.get('location'), bytes: buf.length, type };
    if (/html/i.test(type) || (!type && buf.length)) Object.assign(r, extract(buf.toString('utf8')));
    return r;
  } catch (e) {
    return { error: `${e.cause?.code ?? ''} ${e.message}`.trim() };
  }
}

// Make absolute URLs on a server's own origin comparable across servers.
const norm = (v, origin) => (typeof v === 'string' ? v.split(origin).join('<origin>') : v);

const FIELDS = ['status', 'location', 'title', 'description', 'canonical', 'robots',
  'og:title', 'og:description', 'og:image', 'twitter:card', 'hreflang', 'jsonld'];

function compare(path, A, B, o) {
  const diffs = [];
  if (A.error || B.error) {
    diffs.push({ field: 'error', a: A.error ?? 'ok', b: B.error ?? 'ok' });
    return diffs;
  }
  for (const f of FIELDS) {
    const a = norm(A[f] ?? null, o.a); const b = norm(B[f] ?? null, o.b);
    if (String(a) !== String(b)) diffs.push({ field: f, a, b });
  }
  return diffs;
}

async function pool(items, n, fn) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

const cut = (v, n = 60) => { const s = v === null || v === undefined ? '(none)' : String(v); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

async function main() {
  const o = parseArgs(process.argv.slice(2));
  let text;
  try { text = await readFile(o.paths, 'utf8'); } catch (e) { fail(`cannot read --paths file: ${e.message}`); }
  const paths = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (!paths.length) fail('the --paths file has no paths');

  const results = await pool(paths, o.concurrency, async (p) => {
    const [A, B] = await Promise.all([probe(o.a, p, o), probe(o.b, p, o)]);
    const diffs = compare(p, A, B, o);
    const warnings = [];
    for (const [side, r] of [['a', A], ['b', B]]) {
      if (r.bytes > TWO_MB) warnings.push(`${side}: HTML is ${(r.bytes / 1048576).toFixed(2)}MB, over Googlebot's 2MB limit`);
    }
    return { path: p, a: A, b: B, diffs, warnings };
  });

  const differing = results.filter((r) => r.diffs.length);
  const warned = results.filter((r) => r.warnings.length);

  if (o.json) {
    console.log(JSON.stringify({ a: o.a, b: o.b, ua: o.ua, checked: results.length, differing: differing.length, results }, null, 2));
  } else {
    console.log(`A: ${o.a}\nB: ${o.b}\nUA: ${o.ua}\nChecked ${results.length} path(s): ${differing.length} differ, ${results.length - differing.length} match.`);
    if (differing.length) {
      const rows = [['path', 'field', 'A', 'B']];
      for (const r of differing) for (const d of r.diffs) rows.push([cut(r.path, 40), d.field, cut(d.a), cut(d.b)]);
      const w = rows[0].map((_, c) => Math.max(...rows.map((x) => String(x[c]).length)));
      console.log('\n' + rows.map((x) => x.map((c, i) => String(c).padEnd(w[i])).join('  ')).join('\n'));
    }
    if (warned.length) {
      console.log('\nWarnings:');
      for (const r of warned) for (const w of r.warnings) console.log(`  ${r.path}: ${w}`);
    }
  }
  process.exit(differing.length ? 1 : 0);
}

main().catch((e) => fail(e.stack || String(e)));
