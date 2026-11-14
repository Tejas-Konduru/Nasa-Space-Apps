# Other telescopes panel (Aladin Lite)

Adds a panel that shows the patch of sky you're looking at in SPHEREx, as seen by **other telescopes**,
with labels for known objects. It uses Aladin Lite, the free sky viewer from the Strasbourg astronomical
data centre (CDS) that the challenge brief recommends.

| Survey | What it shows |
|---|---|
| **2MASS** (default) | Sharp near-infrared images from ~2000 |
| **DSS** | Visible-light photos from the 1950s–90s: the longest time gap, best for showing motion |
| **unWISE** | Mid-infrared images from 2010–2024, best for brown dwarfs |

| Labels | What they add |
|---|---|
| **Names** (SIMBAD) | What each object is: star, galaxy, variable, brown dwarf… |
| **Gaia** (DR3) | Precise positions, distances and motion |
| **CatWISE** (2020) | Infrared sources, including brown dwarfs Gaia can't see |

The white square marks the SPHEREx cutout. Gaia and CatWISE labels switch off for fields larger than
about 50′ (too many rows); SIMBAD names always work.

## Install (2 minutes)

From the root of the `planet-x` repo, with the add-on unpacked there:

```bash
node scripts/setup-aladin.mjs            # adds the files' wiring, runs the tests, checks the CDN
```

Or, if you unpacked the add-on somewhere else:

```bash
node /path/to/aladin-addon/scripts/setup-aladin.mjs /path/to/planet-x
```

The script is safe to run more than once. It edits three shared files, each edit tagged `aladin`:

- `app/index.html`: loads `css/aladin.css`, adds `<aside id="aladin-panel">`, a help-sheet line and a credit line.
- `app/js/main.js`: loads `./aladin/index.js` like the other optional modules and mounts it after the Field view.
- `app/ARCHITECTURE.md`: a short section describing the module.

Other commands:

```bash
node scripts/setup-aladin.mjs --check                     # what's installed, tests, CDN reachable?
node scripts/setup-aladin.mjs --dry-run                   # show changes without writing
node scripts/setup-aladin.mjs --uninstall [--remove-files]
node tests/aladin.test.mjs                                # unit tests only
```

## Try it

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

- **Panel on its own:** http://localhost:8000/app/dev/aladin.html (buttons for the five challenge targets)
- **In the app, Barnard's Star, panel open:** http://localhost:8000/app/?ra=269.4463&dec=4.7682&size=300&aladin=1
- **WISE 0855 in unWISE with CatWISE labels:** http://localhost:8000/app/?ra=133.7599&dec=-7.2422&size=300&aladin=1&survey=unwise&cats=simbad,catwise

The button **Other telescopes** sits bottom-left in the Sky view and bottom-right in the Field view. The panel
is hidden in Compare. It follows whatever field is open (Field view, examples, deep links) and every go-to in
the Sky view.

## Deep-link options

Added to the app's existing `?ra=&dec=&size=` links:

| Parameter | Effect |
|---|---|
| `aladin=1` | Open the panel on load |
| `survey=dss` / `2mass` / `unwise` | Pick the survey |
| `cats=simbad,gaia,catwise` | Pick the label layers (default `simbad`) |

## Demo idea

Open Barnard's Star, then switch the panel to **DSS**. The star sits visibly away from the centre of the
white square: that's ~70 years of motion, next to the ~10″ your Field view measures between SPHEREx passes.

## How it works

- `app/js/aladin/index.js` exports `mountAladin(el, store)` (same contract as the other modules). It listens to
  `store.field`, the `flyto` event and `store.view`, and never touches DOM outside its own element except `#announce`.
- The Aladin Lite v3 library (`https://aladin.cds.unistra.fr/AladinLite/api/v3/latest/aladin.js`) is loaded
  **only when the panel is first opened**. If the CDN is blocked (the claude.ai artifact sandbox, offline), the
  panel says so with a "Try again" button and the rest of the app is unaffected. Override the URL with
  `globalThis.PLANETX_ALADIN_SRC` if you need to self-host it.
- `app/js/aladin/geom.js` holds the survey and catalogue lists and the pure maths (field of view, cutout outline,
  links). Add a survey by adding a line to `SURVEYS` with its CDS HiPS ID.

## Troubleshooting

| Symptom | Fix |
|---|---|
| No **Other telescopes** button | Run `node scripts/setup-aladin.mjs --check`; look for ✗ lines. Hard-refresh the page. |
| "Could not reach the Aladin Lite server" | The browser can't reach `aladin.cds.unistra.fr` (network, firewall, ad blocker, sandbox). Click Try again once it can. |
| Grey or blank image | The survey tiles are still loading, or that survey doesn't cover the spot; try another survey. |
| Gaia / CatWISE buttons greyed out | The field is larger than ~50′. Pick a smaller field size. |
| Setup says "anchor not found" | `main.js` or `index.html` changed shape. Add the two lines from "Install" by hand: see the `PATCHES` list in `scripts/setup-aladin.mjs` for the exact text. |

Credits: Aladin Lite (CDS, Strasbourg; Boch & Fernique 2014, Baumann et al. 2022). DSS, 2MASS and unWISE via CDS HiPS.
SIMBAD and VizieR (CDS). Gaia DR3: ESA/Gaia/DPAC. CatWISE2020: Marocco et al. 2021.
