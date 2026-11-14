#!/usr/bin/env node
// Installs the "Other telescopes" (Aladin Lite) panel into the Planet X app. No npm dependencies, Node >= 18.
//
//   node scripts/setup-aladin.mjs            install (idempotent: safe to run again)
//   node scripts/setup-aladin.mjs --check    report what is installed and test the CDN, change nothing
//   node scripts/setup-aladin.mjs --dry-run  show what install would change
//   node scripts/setup-aladin.mjs --uninstall [--remove-files]
//   node <addon>/scripts/setup-aladin.mjs <path/to/planet-x>   install from an unpacked add-on folder into a repo
//
// Every edit to a shared file is tagged with "aladin" markers so --uninstall can take it out cleanly.
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, rmSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const flag = f => args.includes(f);
const MODE = flag('--uninstall') ? 'uninstall' : flag('--check') ? 'check' : 'install';
const DRY = flag('--dry-run');
const ADDON = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(args.find(a => !a.startsWith('--')) || process.cwd());
const CDN = 'https://aladin.cds.unistra.fr/AladinLite/api/v3/latest/aladin.js';

const FILES = [
  'app/js/aladin/index.js',
  'app/js/aladin/geom.js',
  'app/css/aladin.css',
  'app/dev/aladin.html',
  'tests/aladin.test.mjs',
  'scripts/setup-aladin.mjs',
  'docs/ALADIN.md',
];

const c = { g: s => `\x1b[32m${s}\x1b[0m`, y: s => `\x1b[33m${s}\x1b[0m`, r: s => `\x1b[31m${s}\x1b[0m`, d: s => `\x1b[2m${s}\x1b[0m`, b: s => `\x1b[1m${s}\x1b[0m` };
const ok = m => console.log(`  ${c.g('✓')} ${m}`);
const warn = m => console.log(`  ${c.y('!')} ${m}`);
const fail = m => { console.log(`  ${c.r('✗')} ${m}`); process.exitCode = 1; };
const step = m => console.log(`\n${c.b(m)}`);

// ---------- patches: each has an id, a test for "already applied", an apply and a remove ----------
const P = (file) => join(REPO, file);

const PATCHES = [
  {
    file: 'app/index.html', id: 'stylesheet',
    has: s => s.includes('href="css/aladin.css"'),
    apply: s => {
      const line = '<link rel="stylesheet" href="css/aladin.css"> <!-- aladin -->';
      const anchor = s.match(/<link rel="stylesheet" href="css\/candidates\.css">\s*\n/);
      return anchor ? s.replace(anchor[0], anchor[0] + line + '\n') : s.replace('</head>', line + '\n</head>');
    },
    remove: s => s.replace(/^.*href="css\/aladin\.css".*\n/m, ''),
  },
  {
    file: 'app/index.html', id: 'mount point',
    has: s => s.includes('id="aladin-panel"'),
    apply: s => {
      const block = '<!-- aladin:begin — "Other telescopes" panel: filled by app/js/aladin -->\n<aside class="hud" id="aladin-panel" aria-label="Other telescopes"></aside>\n<!-- aladin:end -->\n\n';
      for (const a of ['<!-- full-screen views -->', '<div id="toast"', '</body>']) if (s.includes(a)) return s.replace(a, block + a);
      throw new Error('no place for the mount point in app/index.html');
    },
    remove: s => s.replace(/<!-- aladin:begin[\s\S]*?<!-- aladin:end -->\n*/, ''),
  },
  {
    file: 'app/index.html', id: 'help sheet entry',
    has: s => s.includes('<!-- aladin-help -->'),
    apply: s => {
      const li = '      <li><b>Other telescopes</b>: the same patch of sky in DSS, 2MASS or unWISE, with object labels from SIMBAD, Gaia and CatWISE. <!-- aladin-help --></li>\n';
      const m = s.match(/^.*<b>Movers panel<\/b>.*\n/m);
      return m ? s.replace(m[0], m[0] + li) : s; // optional: skip if the help sheet changed
    },
    remove: s => s.replace(/^.*<!-- aladin-help -->.*\n/m, ''),
  },
  {
    file: 'app/index.html', id: 'credit',
    has: s => s.includes('<!-- aladin-credit -->'),
    apply: s => {
      const p = '    <p class="credit">Other telescopes: Aladin Lite (CDS, Strasbourg); DSS, 2MASS and unWISE via CDS HiPS; labels from SIMBAD, Gaia DR3 (ESA/Gaia/DPAC) and CatWISE2020 via VizieR. <!-- aladin-credit --></p>\n';
      const m = s.match(/^.*<p class="credit">.*\n/m);
      return m ? s.replace(m[0], m[0] + p) : s;
    },
    remove: s => s.replace(/^.*<!-- aladin-credit -->.*\n/m, ''),
  },
  {
    file: 'app/js/main.js', id: 'module load',
    has: s => s.includes("load('aladin'"),
    apply: s => {
      const line = "const pAladin = load('aladin', './aladin/index.js', 'mountAladin', async () => {}); // aladin: optional, never blocks boot\n";
      const m = s.match(/^const pField = load\(.*\n/m);
      if (!m) throw new Error("app/js/main.js: could not find the `const pField = load(` line");
      return s.replace(m[0], m[0] + line);
    },
    remove: s => s.replace(/^const pAladin = load\('aladin'.*\n/m, ''),
  },
  {
    file: 'app/js/main.js', id: 'module mount',
    has: s => s.includes("run('aladin'"),
    apply: s => {
      const line = "await run('aladin', await pAladin, async () => {}, $('aladin-panel'), store); // aladin\n";
      const m = s.match(/^await run\('field'.*\n/m);
      if (!m) throw new Error("app/js/main.js: could not find the `await run('field'` line");
      return s.replace(m[0], m[0] + line);
    },
    remove: s => s.replace(/^await run\('aladin'.*\n/m, ''),
  },
  {
    file: 'app/ARCHITECTURE.md', id: 'architecture note',
    optional: true,
    has: s => s.includes('<!-- aladin:doc -->'),
    apply: s => s.replace(/\s*$/, '\n') + `
<!-- aladin:doc -->
## Other telescopes panel (aladin)

\`app/js/aladin/index.js\` exports \`mountAladin(el, store)\`, mounted into \`<aside id="aladin-panel">\` after the field view.
It follows \`store.field\` and \`flyto\`, hides itself in Compare, and lazy-loads Aladin Lite v3 from the CDS CDN the first
time it is opened (so a blocked CDN never affects boot). Surveys and catalogues are listed in \`app/js/aladin/geom.js\`.
Deep link: \`?aladin=1[&survey=dss|2mass|unwise][&cats=simbad,gaia,catwise]\`. Dev page: \`app/dev/aladin.html\`.
Test: \`node tests/aladin.test.mjs\`. Installed and removed by \`node scripts/setup-aladin.mjs [--uninstall]\`.
<!-- /aladin:doc -->
`,
    remove: s => s.replace(/\n*<!-- aladin:doc -->[\s\S]*?<!-- \/aladin:doc -->\n?/, '\n'),
  },
];

// ---------- helpers ----------
function isRepo(dir) { return existsSync(join(dir, 'app/index.html')) && existsSync(join(dir, 'app/js/main.js')) && existsSync(join(dir, 'app/js/core/store.js')); }

function copyFiles() {
  if (resolve(ADDON) === resolve(REPO)) { ok('add-on files are already in this repo'); return; }
  for (const f of FILES) {
    const src = join(ADDON, f), dst = join(REPO, f);
    if (!existsSync(src)) { warn(`missing in add-on: ${f}`); continue; }
    if (DRY) { console.log(`  ${c.d('would copy')} ${f}`); continue; }
    mkdirSync(dirname(dst), { recursive: true }); copyFileSync(src, dst); ok(`copied ${f}`);
  }
}

function applyPatches(mode) {
  const byFile = new Map();
  for (const p of PATCHES) { if (!byFile.has(p.file)) byFile.set(p.file, []); byFile.get(p.file).push(p); }
  for (const [file, list] of byFile) {
    const path = P(file);
    if (!existsSync(path)) { (list.every(p => p.optional) ? warn : fail)(`${file} not found`); continue; }
    let s = readFileSync(path, 'utf8'); const before = s;
    for (const p of list) {
      try {
        if (mode === 'install') {
          if (p.has(s)) { ok(`${file}: ${p.id} already in place`); continue; }
          const next = p.apply(s);
          if (next === s || !p.has(next)) { warn(`${file}: ${p.id} skipped (anchor not found; add it by hand, see docs/ALADIN.md)`); continue; }
          s = next; ok(`${file}: added ${p.id}`);
        } else {
          if (!p.has(s)) continue;
          s = p.remove(s); p.has(s) ? fail(`${file}: could not remove ${p.id}`) : ok(`${file}: removed ${p.id}`);
        }
      } catch (e) { fail(`${file}: ${p.id}: ${e.message}`); }
    }
    if (s !== before) { if (DRY) console.log(`  ${c.d('would write')} ${file}`); else writeFileSync(path, s); }
  }
}

function checkPatches() {
  for (const p of PATCHES) {
    const path = P(p.file);
    if (!existsSync(path)) { (p.optional ? warn : fail)(`${p.file} not found`); continue; }
    const has = p.has(readFileSync(path, 'utf8'));
    has ? ok(`${p.file}: ${p.id}`) : (p.optional || /help|credit/.test(p.id) ? warn : fail)(`${p.file}: ${p.id} not installed`);
  }
  for (const f of FILES) existsSync(P(f)) ? ok(f) : fail(`${f} missing`);
}

async function checkCdn() {
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(CDN, { method: 'GET', signal: ctl.signal }); clearTimeout(t);
    r.ok ? ok(`Aladin Lite CDN reachable (HTTP ${r.status})`) : warn(`Aladin Lite CDN answered HTTP ${r.status}: the panel will show "Try again" until it is reachable from the browser`);
  } catch (e) { warn(`could not reach the Aladin Lite CDN from here (${e.name === 'AbortError' ? 'timeout' : e.message}). Browsers on a normal network usually can; the app still boots without it.`); }
}

function runUnitTests() {
  const t = P('tests/aladin.test.mjs'); if (!existsSync(t)) { warn('tests/aladin.test.mjs not found'); return; }
  const r = spawnSync(process.execPath, [t], { cwd: REPO, encoding: 'utf8' });
  const last = (r.stdout || '').trim().split('\n').pop();
  r.status === 0 ? ok(`unit tests: ${last}`) : fail(`unit tests failed:\n${r.stdout}${r.stderr}`);
}

// ---------- main ----------
console.log(c.b(`Planet X · Other telescopes (Aladin Lite) · ${MODE}${DRY ? ' (dry run)' : ''}`));
console.log(c.d(`repo: ${REPO}`));
const major = +process.versions.node.split('.')[0];
if (major < 18) { fail(`Node ${process.versions.node}: need Node 18 or newer`); process.exit(1); }
if (!isRepo(REPO)) {
  fail(`${REPO} does not look like the planet-x repo (expected app/index.html, app/js/main.js, app/js/core/store.js).`);
  console.log(`  Run it from the repo root, or pass the path: node ${relative(process.cwd(), join(ADDON, 'scripts/setup-aladin.mjs'))} /path/to/planet-x`);
  process.exit(1);
}

if (MODE === 'check') {
  step('Files and edits'); checkPatches();
  step('Tests'); runUnitTests();
  step('Network'); await checkCdn();
} else if (MODE === 'uninstall') {
  step('Removing edits'); applyPatches('uninstall');
  if (flag('--remove-files')) {
    step('Removing files');
    for (const f of FILES) if (existsSync(P(f))) { if (DRY) console.log(`  ${c.d('would delete')} ${f}`); else { rmSync(P(f)); ok(`deleted ${f}`); } }
    const dir = P('app/js/aladin'); if (!DRY && existsSync(dir) && !readdirSync(dir).length) rmSync(dir, { recursive: true });
  } else console.log(c.d('\n  Files kept. Add --remove-files to delete them too.'));
} else {
  step('Files'); copyFiles();
  step('Wiring into the app'); applyPatches('install');
  if (!DRY) { step('Tests'); runUnitTests(); step('Network'); await checkCdn(); }
  console.log(`\n${c.b('Next')}
  1. Serve the repo:   ${c.d('python3 -m http.server 8000 --bind 127.0.0.1')}
  2. Panel on its own: ${c.d('http://localhost:8000/app/dev/aladin.html')}
  3. In the app:       ${c.d("http://localhost:8000/app/?ra=269.4463&dec=4.7682&size=300&aladin=1")}
  4. Commit:           ${c.d('git add app/js/aladin app/css/aladin.css app/dev/aladin.html tests/aladin.test.mjs scripts/setup-aladin.mjs docs/ALADIN.md app/index.html app/js/main.js app/ARCHITECTURE.md')}`);
}
console.log(process.exitCode ? c.r('\nFinished with problems (see ✗ above).') : c.g('\nDone.'));
