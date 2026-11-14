// node tests/aladin.test.mjs — pure helpers of the Aladin panel plus a check that it is wired into the app.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SURVEYS, CATALOGS, fovDeg, catalogRadiusDeg, footprint, normRa, isTarget, aladinUrl, describe, parseParams, surveyById, MAX_CATALOG_RADIUS_DEG } from '../app/js/aladin/geom.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let n = 0; const t = (name, fn) => { fn(); n++; };

t('surveys: DSS, 2MASS, unWISE with HiPS ids', () => {
  assert.deepEqual(SURVEYS.map(s => s.id).sort(), ['2mass', 'dss', 'unwise']);
  for (const s of SURVEYS) assert.match(s.hips, /^P\//);
  assert.equal(surveyById('nope').id, SURVEYS[0].id);
});

t('catalogues: SIMBAD plus VizieR tables', () => {
  assert.equal(CATALOGS.find(c => c.id === 'gaia').vizier, 'I/355/gaiadr3');
  assert.equal(CATALOGS.find(c => c.id === 'catwise').vizier, 'II/365/catwise');
  assert.equal(CATALOGS.find(c => c.id === 'simbad').vizier, undefined);
});

t('fov: padded, in degrees, clamped', () => {
  assert.ok(Math.abs(fovDeg(300) - 300 * 1.6 / 3600) < 1e-12);
  assert.equal(fovDeg(1), 1 / 60);
  assert.equal(fovDeg(1e9), 10);
  assert.equal(fovDeg(undefined), fovDeg(300));
  assert.equal(fovDeg(-5), fovDeg(300));
});

t('catalogue radius covers the corners; 1° field is over the limit', () => {
  assert.ok(Math.abs(catalogRadiusDeg(3600) - Math.SQRT1_2) < 1e-12);
  assert.ok(catalogRadiusDeg(300) < MAX_CATALOG_RADIUS_DEG);
  assert.ok(catalogRadiusDeg(3600) > MAX_CATALOG_RADIUS_DEG);
});

t('footprint: square around the centre, RA stretched by 1/cos(dec), wraps at 0h', () => {
  const f = footprint(10, 60, 3600);
  assert.equal(f.length, 4);
  const ras = f.map(p => p[0]), decs = f.map(p => p[1]);
  assert.ok(Math.abs(Math.max(...decs) - 60.5) < 1e-9 && Math.abs(Math.min(...decs) - 59.5) < 1e-9);
  assert.ok(Math.abs((Math.max(...ras) - Math.min(...ras)) - 1 / Math.cos(Math.PI / 3)) < 1e-9);
  const w = footprint(0.01, 0, 360);
  assert.ok(w.every(p => p[0] >= 0 && p[0] < 360));
  assert.ok(w.some(p => p[0] > 359));
  assert.ok(footprint(0, 89.99, 3600).every(p => p[1] <= 90));
});

t('normRa / isTarget', () => {
  assert.equal(normRa(-10), 350); assert.equal(normRa(370), 10);
  assert.ok(isTarget({ ra: 1, dec: 2 }));
  assert.ok(!isTarget({ ra: 1, dec: 95 })); assert.ok(!isTarget(null)); assert.ok(!isTarget({ ra: NaN, dec: 0 }));
});

t('links and labels', () => {
  const u = new URL(aladinUrl({ ra: 269.4463, dec: 4.7682, sizeArcsec: 300 }, 'dss'));
  assert.equal(u.hostname, 'aladin.cds.unistra.fr');
  assert.equal(u.searchParams.get('survey'), 'P/DSS2/color');
  assert.equal(u.searchParams.get('target'), '269.44630 4.76820');
  assert.match(describe({ ra: 269.4463, dec: 4.7682, sizeArcsec: 300 }), /^RA 269\.4463°, Dec \+4\.7682° · 8′ view$/);
  assert.match(describe({ ra: 133.76, dec: -7.24, sizeArcsec: 3600 }), /Dec -7\.2400° · 1\.6° view/);
  assert.equal(describe(null), 'No position yet');
});

t('deep-link params', () => {
  assert.deepEqual(parseParams('?aladin=1&survey=DSS&cats=gaia,bogus,simbad'), { open: true, survey: 'dss', cats: ['gaia', 'simbad'] });
  assert.deepEqual(parseParams('?ra=1&dec=2'), { open: false });
  assert.deepEqual(parseParams('?aladin=0&survey=hubble'), { open: false });
});

t('wired into the app (run node scripts/setup-aladin.mjs if this fails)', () => {
  const html = readFileSync(join(ROOT, 'app/index.html'), 'utf8');
  const main = readFileSync(join(ROOT, 'app/js/main.js'), 'utf8');
  assert.ok(html.includes('href="css/aladin.css"'), 'index.html loads css/aladin.css');
  assert.ok(html.includes('id="aladin-panel"'), 'index.html has <aside id="aladin-panel">');
  assert.ok(main.includes("load('aladin'") && main.includes("run('aladin'"), 'main.js loads and mounts the panel');
  assert.ok(main.indexOf("run('aladin'") < main.indexOf('const deep = deepLink()'), 'panel mounts before deep links set the field');
  assert.ok(existsSync(join(ROOT, 'app/css/aladin.css')));
});

console.log(`aladin: ${n}/${n} passed`);
