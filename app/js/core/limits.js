// Limits the client shares with the data server. The server (server/lib/field.mjs SIZE_MIN/SIZE_MAX/SIZE_DEFAULT)
// refuses a field request outside 40–600″ and builds a grid of 8–98 px at 6.15″/px; everything on the client that
// takes a field size (the ?size= deep link in main.js, the data module's liveSize, the Field view's Live request box)
// goes through these so the limits cannot drift apart again (issues.md ISS-24). tests/data.test.mjs checks the two copies agree.
export const FIELD_SIZE_MIN = 40, FIELD_SIZE_MAX = 600, FIELD_SIZE_DEFAULT = 120;

/** Round and clamp a requested field size (arcsec) into the accepted range; anything that is not a number becomes the default. */
export const clampFieldSize = s => Number.isFinite(s) ? Math.min(FIELD_SIZE_MAX, Math.max(FIELD_SIZE_MIN, Math.round(s))) : FIELD_SIZE_DEFAULT;
