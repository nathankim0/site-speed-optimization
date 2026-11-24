#!/usr/bin/env node
// lh-compare.mjs: run Lighthouse several times on one or two URLs, alternating A/B,
// and report per-metric medians, min/max, and (for two URLs) the median difference
// with a bootstrap 95% confidence interval.
// Requires Node 20+ and a local Chrome/Chromium. Lighthouse is called through `npx`;
// nothing is installed into the project.

import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const HELP = `Usage: node lh-compare.mjs <urlA> [urlB] [options]

Options:
  --runs <n>          runs per URL (default 7; use an odd number)
  --preset <p>        mobile | desktop (default mobile)
  --slow              force the slow profile: 150ms RTT, 1.6Mbps down,
                      750Kbps up, 4x CPU (same as Lighthouse's mobile default,
                      but pinned so a Lighthouse upgrade cannot change it)
  --method <m>        simulate | devtools (default simulate). devtools applies
                      real throttling in the browser; slower, closer to a recording
  --out <dir>         where raw Lighthouse JSON is saved (default ./lh-results)
  --lighthouse <spec> npm spec to run (default: lighthouse, or lighthouse@12 on Node < 22.19)
  --chrome-flags <f>  default "--headless=new"
  --json              print JSON instead of tables
  -h, --help          show this help

Examples:
  node lh-compare.mjs https://example.com --runs 5
  node lh-compare.mjs https://old.example.com/p/1 https://new.example.com/p/1 --runs 9 --slow
  node lh-compare.mjs http://localhost:3000 --preset desktop --json > lh.json

Every run starts with an empty cache (Lighthouse clears storage, including
service workers, unless told otherwise).`;

const METRICS = [
  // key, label, audit id, unit, smallest difference worth calling a change
  ['lcp', 'LCP', 'largest-contentful-paint', 'ms', 10],
  ['fcp', 'FCP', 'first-contentful-paint', 'ms', 10],
  ['tbt', 'TBT', 'total-blocking-time', 'ms', 10],
  ['cls', 'CLS', 'cumulative-layout-shift', '', 0.01],
  ['si', 'Speed Index', 'speed-index', 'ms', 10],
  ['ttfb', 'TTFB (server)', 'server-response-time', 'ms', 10],
  ['bytes', 'Total transfer', null, 'KB', 1],
  ['jsBytes', 'JS transfer', null, 'KB', 1],
  ['jsReqs', 'JS requests', null, '', 1],
  ['reqs', 'All requests', null, '', 1],
];

function parseArgs(argv) {
  const o = { urls: [], runs: 7, preset: 'mobile', slow: false, method: 'simulate', out: 'lh-results',
    lighthouse: null, chromeFlags: '--headless=new', json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const need = () => { if (i + 1 >= argv.length) fail(`${a} needs a value`); return argv[++i]; };
    if (a === '-h' || a === '--help') { console.log(HELP); process.exit(0); }
    else if (a === '--runs') o.runs = Number(need());
    else if (a === '--preset') o.preset = need();
    else if (a === '--slow') o.slow = true;
    else if (a === '--method') o.method = need();
    else if (a === '--out') o.out = need();
    else if (a === '--lighthouse') o.lighthouse = need();
    else if (a === '--chrome-flags') o.chromeFlags = need();
    else if (a === '--json') o.json = true;
    else if (a.startsWith('-')) fail(`unknown option ${a} (see --help)`);
    else o.urls.push(a);
  }
  if (o.urls.length < 1 || o.urls.length > 2) fail('give one or two URLs (see --help)');
  for (const u of o.urls) if (!/^https?:\/\//.test(u)) fail(`URL must start with http:// or https://: ${u}`);
  if (!Number.isInteger(o.runs) || o.runs < 1) fail('--runs must be a positive integer');
  if (!['mobile', 'desktop'].includes(o.preset)) fail('--preset must be mobile or desktop');
  if (!['simulate', 'devtools'].includes(o.method)) fail('--method must be simulate or devtools');
  if (!o.lighthouse) {
    const [maj, min] = process.versions.node.split('.').map(Number);
    // Lighthouse 13 needs Node 22.19+; Lighthouse 12 still runs on Node 18.20+.
    o.lighthouse = maj > 22 || (maj === 22 && min >= 19) ? 'lighthouse' : 'lighthouse@12';
  }
  return o;
}

function fail(msg) { console.error(`error: ${msg}`); process.exit(2); }

function lighthouseArgs(o, url, outFile) {
  const args = ['--yes', o.lighthouse, url, '--quiet', '--output=json', `--output-path=${outFile}`,
    '--only-categories=performance', `--chrome-flags=${o.chromeFlags}`, `--throttling-method=${o.method}`];
  if (o.preset === 'desktop') args.push('--preset=desktop');
  if (o.slow) {
    if (o.preset === 'desktop') args.push('--form-factor=mobile', '--screenEmulation.mobile=true',
      '--screenEmulation.width=412', '--screenEmulation.height=823', '--screenEmulation.deviceScaleFactor=1.75');
    args.push(
      // used by --throttling-method=simulate
      '--throttling.rttMs=150', '--throttling.throughputKbps=1638.4', '--throttling.cpuSlowdownMultiplier=4',
      // used by --throttling-method=devtools
      '--throttling.requestLatencyMs=562.5', '--throttling.downloadThroughputKbps=1474.56',
      '--throttling.uploadThroughputKbps=675',
    );
  }
  return args;
}

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => resolve({ err, stdout, stderr }));
  });
}

// On Windows, npx is a .cmd file and needs a shell, which would split URLs at "&".
// Run npm's npx-cli.js with node directly instead, so arguments pass through untouched.
function npxCommand() {
  if (process.platform !== 'win32') return { cmd: 'npx', prefix: [] };
  const cli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
  return { cmd: process.execPath, prefix: [cli] };
}

function extract(lhr) {
  const a = lhr.audits ?? {};
  const items = a['resource-summary']?.details?.items ?? [];
  const byType = Object.fromEntries(items.map((it) => [it.resourceType, it]));
  const m = {};
  for (const [key, , id] of METRICS) if (id) m[key] = a[id]?.numericValue ?? null;
  const tbw = a['total-byte-weight']?.numericValue;
  m.bytes = byType.total ? byType.total.transferSize / 1024 : tbw != null ? tbw / 1024 : null;
  m.jsBytes = byType.script ? byType.script.transferSize / 1024 : null;
  m.jsReqs = byType.script?.requestCount ?? null;
  m.reqs = byType.total?.requestCount ?? null;
  return m;
}

const median = (xs) => {
  const s = [...xs].sort((x, y) => x - y);
  const n = s.length;
  return n === 0 ? null : n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};

// Seeded PRNG so the same data gives the same interval.
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Bootstrap 95% CI for median(B) - median(A).
function bootstrapDiff(a, b, iters = 5000) {
  if (a.length < 2 || b.length < 2) return null;
  const rnd = mulberry32(42);
  const pick = (xs) => Array.from(xs, () => xs[Math.floor(rnd() * xs.length)]);
  const diffs = [];
  for (let i = 0; i < iters; i++) diffs.push(median(pick(b)) - median(pick(a)));
  diffs.sort((x, y) => x - y);
  return [diffs[Math.floor(iters * 0.025)], diffs[Math.floor(iters * 0.975)]];
}

const fmt = (v, unit) => {
  if (v === null || v === undefined || Number.isNaN(v)) return '-';
  if (unit === '') return Math.abs(v) < 1 && v !== 0 ? v.toFixed(3) : String(Math.round(v * 1000) / 1000);
  return String(Math.round(v));
};

function table(rows) {
  const w = rows[0].map((_, c) => Math.max(...rows.map((r) => String(r[c]).length)));
  return rows.map((r) => r.map((cell, c) => String(cell).padEnd(w[c])).join('  ')).join('\n');
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const npx = npxCommand();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.resolve(o.out, stamp);
  await mkdir(outDir, { recursive: true });

  const labels = o.urls.length === 2 ? ['A', 'B'] : ['A'];
  const results = Object.fromEntries(labels.map((l) => [l, []]));
  let version = null;
  const errors = [];

  for (let r = 1; r <= o.runs; r++) {
    // Alternate the order each round (A,B then B,A) so slow drift in the network
    // or machine does not always favor the same URL.
    const order = r % 2 ? labels : [...labels].reverse();
    for (const l of order) {
      const url = o.urls[labels.indexOf(l)];
      const file = path.join(outDir, `${l}-run${r}.json`);
      process.stderr.write(`run ${r}/${o.runs} ${l} ${url} ... `);
      const { err, stderr } = await run(npx.cmd, [...npx.prefix, ...lighthouseArgs(o, url, file)]);
      let lhr = null;
      try { lhr = JSON.parse(await readFile(file, 'utf8')); } catch { /* handled below */ }
      if (err || !lhr || lhr.runtimeError) {
        const why = lhr?.runtimeError?.message || (stderr || String(err?.message || '')).trim().split('\n').slice(-3).join(' ');
        process.stderr.write('failed\n');
        errors.push({ label: l, run: r, error: why });
        continue;
      }
      version = lhr.lighthouseVersion;
      results[l].push(extract(lhr));
      process.stderr.write(`LCP ${Math.round(lhr.audits['largest-contentful-paint']?.numericValue ?? 0)}ms\n`);
    }
  }

  for (const l of labels) {
    if (results[l].length === 0) {
      const hint = errors.find((e) => e.label === l)?.error || 'unknown error';
      fail(`all runs failed for ${l}. Last error: ${hint}\n` +
        'Check: Chrome/Chromium installed (or set CHROME_PATH), the URL is reachable, and npx can download lighthouse.');
    }
  }

  const summary = {};
  for (const [key, label, , unit, minEffect] of METRICS) {
    const s = { label, unit };
    for (const l of labels) {
      const xs = results[l].map((m) => m[key]).filter((v) => v !== null && v !== undefined);
      s[l] = { median: median(xs), min: xs.length ? Math.min(...xs) : null, max: xs.length ? Math.max(...xs) : null, n: xs.length };
    }
    if (labels.length === 2 && s.A.median !== null && s.B.median !== null) {
      const xa = results.A.map((m) => m[key]).filter((v) => v !== null);
      const xb = results.B.map((m) => m[key]).filter((v) => v !== null);
      s.diff = s.B.median - s.A.median;
      s.ci95 = bootstrapDiff(xa, xb);
      // A change counts only when the interval excludes 0 AND the difference is big enough
      // to matter (sub-millisecond simulated differences are noise, not wins).
      const floor = Math.max(Math.abs(s.A.median) * 0.01, minEffect);
      s.enoughRuns = Math.min(xa.length, xb.length) >= 5;
      s.significant = Boolean(s.ci95 && s.enoughRuns && (s.ci95[0] > 0 || s.ci95[1] < 0) && Math.abs(s.diff) >= floor);
    }
    summary[key] = s;
  }

  const settings = { preset: o.preset, slow: o.slow, method: o.method, runs: o.runs, lighthouse: version };
  const report = { urls: Object.fromEntries(labels.map((l, i) => [l, o.urls[i]])), settings, summary, errors, rawDir: outDir };
  await writeFile(path.join(outDir, 'summary.json'), JSON.stringify(report, null, 2));

  if (o.json) { console.log(JSON.stringify(report, null, 2)); return; }

  console.log(`\nLighthouse ${version} · preset ${o.preset}${o.slow ? ' · slow profile' : ''} · ${o.method} · ${o.runs} runs`);
  labels.forEach((l, i) => console.log(`${l}: ${o.urls[i]}`));
  const head = ['metric', ...labels.flatMap((l) => [`${l} median`, `${l} min-max`])];
  if (labels.length === 2) head.push('B-A', '95% CI', 'verdict');
  const rows = [head];
  for (const [key] of METRICS) {
    const s = summary[key];
    const unit = s.unit ? ` ${s.unit}` : '';
    const row = [s.label + unit];
    for (const l of labels) row.push(fmt(s[l].median, s.unit), `${fmt(s[l].min, s.unit)}-${fmt(s[l].max, s.unit)}`);
    if (labels.length === 2) {
      row.push(s.diff === undefined ? '-' : (s.diff > 0 ? '+' : '') + fmt(s.diff, s.unit));
      row.push(s.ci95 ? `[${fmt(s.ci95[0], s.unit)}, ${fmt(s.ci95[1], s.unit)}]` : '-');
      row.push(s.diff === undefined ? '-' : !s.enoughRuns ? 'too few runs' : !s.significant ? 'no clear change' : s.diff < 0 ? 'B lower' : 'B higher');
    }
    rows.push(row);
  }
  console.log('\n' + table(rows));
  if (labels.length === 2) console.log('\nLower is better for every metric above. "no clear change" = the 95% interval includes 0, or the gap is smaller than both 1% of A and 10ms / 1KB / 0.01 CLS / 1 request.');
  if (labels.length === 2) console.log('With 10 metrics, one may differ by chance; judge by the primary metric you chose before measuring.');
  if (labels.length === 2 && o.runs < 5) console.log('Verdicts need at least 5 runs per URL; 7 to 11 is better.');
  if (errors.length) console.log(`\n${errors.length} run(s) failed; see --json for details.`);
  console.log(`\nRaw reports: ${outDir}`);
}

main().catch((e) => fail(e.stack || String(e)));
