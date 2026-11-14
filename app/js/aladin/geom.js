// Pure helpers for the Aladin Lite panel (no DOM), importable from Node for tests.

/** Other telescopes the panel can show. `hips` is the CDS HiPS survey ID passed to Aladin Lite. */
export const SURVEYS = [
  { id: '2mass',  hips: 'P/2MASS/color',              label: '2MASS',  note: 'Sharp near-infrared images from ~2000' },
  { id: 'dss',    hips: 'P/DSS2/color',               label: 'DSS',    note: 'Visible-light photos from the 1950s–90s' },
  { id: 'unwise', hips: 'P/unWISE/color-W2-W1W2-W1',  label: 'unWISE', note: 'Mid-infrared images from 2010–2024, best for brown dwarfs' },
];

/** Catalogue label layers. `vizier` is the VizieR table ID; SIMBAD has its own loader. */
export const CATALOGS = [
  { id: 'simbad',  label: 'Names',   note: 'SIMBAD: what each object is', color: '#ffffff' },
  { id: 'gaia',    label: 'Gaia',    note: 'Gaia DR3: precise positions and motion', vizier: 'I/355/gaiadr3', color: '#bbbbbb' },
  { id: 'catwise', label: 'CatWISE', note: 'CatWISE2020: infrared sources, incl. brown dwarfs', vizier: 'II/365/catwise', color: '#888888' },
];

export const DEFAULT_SIZE_ARCSEC = 300;
/** Catalogue cones bigger than this are skipped: Gaia/CatWISE return too many rows to be useful or fast. */
export const MAX_CATALOG_RADIUS_DEG = 0.3;

export const surveyById = id => SURVEYS.find(s => s.id === id) || SURVEYS[0];
export const catalogById = id => CATALOGS.find(c => c.id === id) || null;

export function normRa(ra) { const r = ra % 360; return r < 0 ? r + 360 : r; }

/** Aladin field of view (degrees) for a SPHEREx cutout of `sizeArcsec`, with some margin around it. */
export function fovDeg(sizeArcsec = DEFAULT_SIZE_ARCSEC, pad = 1.6) {
  const s = Number.isFinite(sizeArcsec) && sizeArcsec > 0 ? sizeArcsec : DEFAULT_SIZE_ARCSEC;
  return Math.min(10, Math.max(1 / 60, (s * pad) / 3600));
}

/** Radius (degrees) of the catalogue cone: covers the cutout's corners. */
export function catalogRadiusDeg(sizeArcsec = DEFAULT_SIZE_ARCSEC) {
  const s = Number.isFinite(sizeArcsec) && sizeArcsec > 0 ? sizeArcsec : DEFAULT_SIZE_ARCSEC;
  return (s / 3600) * Math.SQRT1_2;
}

/** Corners [[ra, dec], …] of the square SPHEREx cutout, for drawing its outline. Small-field approximation. */
export function footprint(ra, dec, sizeArcsec = DEFAULT_SIZE_ARCSEC) {
  const h = (sizeArcsec / 3600) / 2;
  const cosd = Math.max(0.01, Math.cos((dec * Math.PI) / 180));
  const dRa = h / cosd;
  const clampDec = d => Math.max(-90, Math.min(90, d));
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => [normRa(ra + sx * dRa), clampDec(dec + sy * h)]);
}

/** Valid sky target? */
export function isTarget(t) {
  return !!t && Number.isFinite(t.ra) && Number.isFinite(t.dec) && t.dec >= -90 && t.dec <= 90;
}

/** Link to the same view in the full Aladin Lite site. */
export function aladinUrl(t, surveyId) {
  const u = new URL('https://aladin.cds.unistra.fr/AladinLite/');
  u.searchParams.set('target', `${normRa(t.ra).toFixed(5)} ${t.dec.toFixed(5)}`);
  u.searchParams.set('fov', fovDeg(t.sizeArcsec).toFixed(4));
  u.searchParams.set('survey', surveyById(surveyId).hips);
  return u.toString();
}

/** Readable position, e.g. "RA 269.4463°, Dec +4.7682° · 8′ view". */
export function describe(t) {
  if (!isTarget(t)) return 'No position yet';
  const f = fovDeg(t.sizeArcsec) * 60;
  const view = f >= 60 ? `${+(f / 60).toFixed(1)}°` : `${+f.toFixed(f < 10 ? 1 : 0)}′`;
  return `RA ${normRa(t.ra).toFixed(4)}°, Dec ${t.dec >= 0 ? '+' : ''}${t.dec.toFixed(4)}° · ${view} view`;
}

/** Deep-link options: ?aladin=1 opens the panel, &survey=dss|2mass|unwise picks the survey, &cats=simbad,gaia. */
export function parseParams(search = '') {
  const q = new URLSearchParams(search);
  const out = { open: /^(1|true|yes|open)$/i.test(q.get('aladin') || '') };
  const s = (q.get('survey') || '').toLowerCase();
  if (SURVEYS.some(x => x.id === s)) out.survey = s;
  if (q.has('cats')) out.cats = (q.get('cats') || '').split(',').map(x => x.trim().toLowerCase()).filter(x => CATALOGS.some(c => c.id === x));
  return out;
}
