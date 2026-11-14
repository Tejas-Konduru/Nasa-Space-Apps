// "Other telescopes" panel: an Aladin Lite (CDS) viewer showing the current patch of sky in DSS, 2MASS or unWISE,
// with optional catalogue labels (SIMBAD names, Gaia DR3, CatWISE2020) and the SPHEREx cutout outlined.
//
// Contract (see app/ARCHITECTURE.md): mountAladin(el, store) only reads `store`; it follows
//   - store 'field'  {ra, dec, sizeArcsec}  (Field view, deep links, examples)
//   - event 'flyto'  {ra, dec}              (Sky view go-to / candidate picks)
//   - store 'view'                          (hidden in Compare)
// The library is loaded lazily from the CDS CDN the first time the panel opens, so the app boots
// unchanged when the CDN is unreachable (e.g. inside the claude.ai artifact sandbox).
import { SURVEYS, CATALOGS, MAX_CATALOG_RADIUS_DEG, surveyById, catalogById, fovDeg, catalogRadiusDeg,
  footprint, isTarget, aladinUrl, describe, parseParams, DEFAULT_SIZE_ARCSEC } from './geom.js';

export const ALADIN_SRC = 'https://aladin.cds.unistra.fr/AladinLite/api/v3/latest/aladin.js';
const LOAD_TIMEOUT_MS = 20000;

let loading = null;
/** Load Aladin Lite v3 once and wait for its WebAssembly to initialise. Resolves to the global `A`. */
export function loadAladin(src = globalThis.PLANETX_ALADIN_SRC || ALADIN_SRC) {
  const ready = globalThis.A && typeof globalThis.A.aladin === 'function';
  if (ready) return Promise.resolve(globalThis.A.init).then(() => globalThis.A);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true; s.charset = 'utf-8';
    const timer = setTimeout(() => reject(new Error('Aladin Lite took too long to load')), LOAD_TIMEOUT_MS);
    s.onload = () => {
      const A = globalThis.A;
      if (!A || typeof A.aladin !== 'function') { clearTimeout(timer); reject(new Error('Aladin Lite loaded but did not start')); return; }
      Promise.resolve(A.init).then(() => { clearTimeout(timer); resolve(A); }, e => { clearTimeout(timer); reject(e); });
    };
    s.onerror = () => { clearTimeout(timer); reject(new Error('Could not reach the Aladin Lite server')); };
    document.head.appendChild(s);
  }).catch(err => { loading = null; throw err; });
  return loading;
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function mountAladin(el, store, opts = {}) {
  const deep = parseParams(opts.search ?? (typeof location !== 'undefined' ? location.search : ''));
  const st = {
    open: false,
    survey: deep.survey || '2mass',
    cats: new Set(deep.cats || ['simbad']),
    target: null,       // {ra, dec, sizeArcsec}
    viewer: null, A: null,
    status: 'idle',     // idle | loading | ready | error
    error: '',
  };

  el.classList.add('al');
  el.innerHTML = `
    <button type="button" class="al-toggle glass" aria-expanded="false" aria-controls="al-box" title="See this patch of sky through other telescopes">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12"/></svg>
      <span>Other telescopes</span>
    </button>
    <div class="al-box glass" id="al-box" role="region" aria-label="Other telescopes" hidden>
      <div class="al-head">
        <b>Other telescopes</b>
        <a class="al-ext" data-ref="ext" target="_blank" rel="noopener" title="Open this view in the full Aladin Lite site">Open in Aladin ↗</a>
        <button type="button" class="icon ghost" data-ref="close" aria-label="Close other telescopes">✕</button>
      </div>
      <div class="seg al-surveys" role="group" aria-label="Survey">
        ${SURVEYS.map(s => `<button type="button" data-survey="${s.id}" aria-pressed="false" title="${esc(s.note)}">${esc(s.label)}</button>`).join('')}
      </div>
      <p class="al-note" data-ref="note"></p>
      <div class="al-view">
        <div class="al-aladin" data-ref="aladin"></div>
        <div class="al-msg" data-ref="msg" hidden></div>
      </div>
      <div class="al-cats" role="group" aria-label="Catalogue labels">
        <span>Labels</span>
        ${CATALOGS.map(c => `<button type="button" data-cat="${c.id}" aria-pressed="false" title="${esc(c.note)}">${esc(c.label)}</button>`).join('')}
      </div>
      <p class="al-pos" data-ref="pos" aria-live="off"></p>
    </div>`;
  const $ = r => el.querySelector(`[data-ref="${r}"]`);
  const toggle = el.querySelector('.al-toggle'), box = el.querySelector('.al-box');

  const announce = msg => { const a = document.getElementById('announce'); if (a) a.textContent = msg; };

  function message(text, retry = false) {
    const m = $('msg');
    m.hidden = !text;
    m.innerHTML = text ? `<span>${esc(text)}</span>${retry ? '<button type="button" data-ref="retry">Try again</button>' : ''}` : '';
    if (retry) m.querySelector('[data-ref="retry"]').addEventListener('click', () => ensureViewer());
  }

  function paintControls() {
    el.querySelectorAll('[data-survey]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.survey === st.survey)));
    const tooWide = isTarget(st.target) && catalogRadiusDeg(st.target.sizeArcsec) > MAX_CATALOG_RADIUS_DEG;
    el.querySelectorAll('[data-cat]').forEach(b => {
      const big = tooWide && b.dataset.cat !== 'simbad';
      b.setAttribute('aria-pressed', String(st.cats.has(b.dataset.cat) && !big));
      b.disabled = big;
      b.title = big ? 'Field too large for this catalogue; pick a smaller field of view' : catalogById(b.dataset.cat).note;
    });
    $('note').textContent = surveyById(st.survey).note;
    $('pos').textContent = describe(st.target);
    const ext = $('ext');
    if (isTarget(st.target)) { ext.href = aladinUrl(st.target, st.survey); ext.removeAttribute('aria-disabled'); }
    else { ext.removeAttribute('href'); ext.setAttribute('aria-disabled', 'true'); }
  }

  function setSurvey(A, viewer, id) {
    const hips = surveyById(id).hips;
    if (typeof viewer.setImageSurvey === 'function') viewer.setImageSurvey(hips);
    else if (typeof viewer.setBaseImageLayer === 'function') viewer.setBaseImageLayer(hips);
  }

  function drawOverlays() {
    const { viewer, A, target } = st;
    if (!viewer || !A || !isTarget(target)) return;
    if (typeof viewer.removeLayers === 'function') viewer.removeLayers();
    // SPHEREx cutout outline
    try {
      const ov = A.graphicOverlay({ color: '#ffffff', lineWidth: 1.5, name: 'SPHEREx cutout' });
      viewer.addOverlay(ov);
      ov.add(A.polygon(footprint(target.ra, target.dec, target.sizeArcsec || DEFAULT_SIZE_ARCSEC)));
    } catch (e) { console.warn('[planet-x] aladin: outline failed', e); }
    // catalogue labels
    const r = catalogRadiusDeg(target.sizeArcsec);
    const where = `${target.ra} ${target.dec}`;
    for (const id of st.cats) {
      const c = catalogById(id); if (!c) continue;
      if (c.vizier && r > MAX_CATALOG_RADIUS_DEG) continue;
      const style = { name: c.label, color: c.color, sourceSize: 12, shape: 'circle', onClick: 'showPopup' };
      try {
        const cat = c.vizier ? A.catalogFromVizieR(c.vizier, where, r, style) : A.catalogFromSimbad(where, r, style);
        viewer.addCatalog(cat);
      } catch (e) { console.warn(`[planet-x] aladin: ${c.label} catalogue failed`, e); }
    }
  }

  function sync() {
    paintControls();
    const { viewer, target } = st;
    if (!viewer) return;
    if (!isTarget(target)) { message('Open a field or go to a position to compare it here.'); return; }
    message('');
    viewer.gotoRaDec(target.ra, target.dec);
    const f = fovDeg(target.sizeArcsec);
    if (typeof viewer.setFoV === 'function') viewer.setFoV(f); else if (typeof viewer.setFov === 'function') viewer.setFov(f);
    drawOverlays();
  }

  async function ensureViewer() {
    if (st.viewer || st.status === 'loading') { sync(); return; }
    st.status = 'loading'; message('Loading Aladin Lite…');
    try {
      const A = await loadAladin();
      const t = isTarget(st.target) ? st.target : { ra: 0, dec: 0, sizeArcsec: DEFAULT_SIZE_ARCSEC };
      st.A = A;
      st.viewer = A.aladin($('aladin'), {
        survey: surveyById(st.survey).hips,
        target: `${t.ra} ${t.dec}`,
        fov: fovDeg(t.sizeArcsec),
        cooFrame: 'ICRSd',
        showReticle: true,
        showZoomControl: true,
        showFullscreenControl: true,
        showLayersControl: false,
        showGotoControl: false,
        showFrame: false,
        showCooGridControl: false,
        showProjectionControl: false,
        showSettingsControl: false,
        showShareControl: false,
        showSimbadPointerControl: false,
        showContextMenu: false,
      });
      st.status = 'ready';
      sync();
      announce('Other telescopes viewer ready');
    } catch (err) {
      st.status = 'error'; st.error = err && err.message ? err.message : String(err);
      console.warn('[planet-x] aladin:', err);
      message(`${st.error}. The rest of the app still works.`, true);
    }
  }

  function setOpen(open) {
    st.open = open;
    box.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    el.dataset.open = String(open);
    if (open) { paintControls(); ensureViewer(); }
  }

  function setTarget(t) {
    if (!isTarget(t)) return;
    const next = { ra: +t.ra, dec: +t.dec, sizeArcsec: Number.isFinite(+t.sizeArcsec) && +t.sizeArcsec > 0 ? +t.sizeArcsec : (st.target?.sizeArcsec || DEFAULT_SIZE_ARCSEC) };
    const same = st.target && Math.abs(st.target.ra - next.ra) < 1e-6 && Math.abs(st.target.dec - next.dec) < 1e-6 && st.target.sizeArcsec === next.sizeArcsec;
    st.target = next;
    if (!same && st.open) sync(); else paintControls();
  }

  // UI events
  toggle.addEventListener('click', () => setOpen(!st.open));
  $('close').addEventListener('click', () => { setOpen(false); toggle.focus(); });
  box.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); toggle.focus(); } });
  el.querySelectorAll('[data-survey]').forEach(b => b.addEventListener('click', () => {
    st.survey = b.dataset.survey; paintControls();
    if (st.viewer) setSurvey(st.A, st.viewer, st.survey);
    announce(`Showing ${surveyById(st.survey).label}`);
  }));
  el.querySelectorAll('[data-cat]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.cat; st.cats.has(id) ? st.cats.delete(id) : st.cats.add(id);
    paintControls(); drawOverlays();
  }));

  // App state
  const onView = v => { el.dataset.view = v; el.hidden = v === 'compare'; };
  store.on('view', onView); onView(store.get('view'));
  store.on('field', f => setTarget(f));
  store.listen('flyto', p => setTarget({ ra: p.ra, dec: p.dec }));
  if (store.get('field')) setTarget(store.get('field'));

  paintControls();
  if (deep.open) setOpen(true);

  const api = { open: () => setOpen(true), close: () => setOpen(false), setSurvey: id => el.querySelector(`[data-survey="${id}"]`)?.click(), state: () => ({ ...st, cats: [...st.cats], viewer: !!st.viewer, A: !!st.A }) };
  if (typeof window !== 'undefined') window.__aladinPanel = api;
  return api;
}
