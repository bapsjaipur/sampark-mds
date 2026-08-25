// src/lib/pdfText.js
// ---------------------------------------------------------------------------
// One string sanitiser for every jsPDF export in the app.
//
// jsPDF's built-in Helvetica is WinAnsi/CP1252 only - it has no glyph for
// anything above U+00FF, and a Devanagari name would come out as blank boxes.
// So every string that reaches pdf.text() goes through toLatin() first.
//
// The naive version of that - strip everything above 0xFF - quietly wrecked the
// app's OWN copy, because this codebase is written with typographic punctuation.
// An em-dash is U+2014, so "Sabha - Mandal" printed as "Sabha ? Mandal" and the
// "- none assigned -" bucket label printed as "? none assigned ?". Those are our
// own strings, not user data, and every one of them has a perfectly good CP1252
// equivalent. Transliterating first reserves the '?' fallback for what it is
// actually there for: a real name this font cannot draw.
//
// The patterns below contain the punctuation characters themselves rather than
// \u escapes, so each one needs its comment to stay legible in a diff. If this
// file ever stops being read as UTF-8, the ranges are the first thing to check.
// ---------------------------------------------------------------------------

/** Applied in order, before the CP1252 strip. Every replacement is <= 0xFF. */
const TRANSLITERATIONS = [
  // Hyphen, figure/en/em dash, horizontal bar, minus sign.
  [/[‐-―−]/g, '-'],
  // Curly single quotes, single low quote, prime.
  [/[‘’‚‛′]/g, "'"],
  // Curly double quotes, low/high double quote, double prime.
  [/[“”„‟″]/g, '"'],
  [/…/g, '...'],
  // Bullets -> middle dot, which IS in CP1252 (0xB7).
  [/[•⁃●]/g, '·'],
  [/[‹›]/g, '>'],
  // No-break space and the thin/hair/figure space family -> plain space.
  [/[  -​  　]/g, ' '],
];

/**
 * Make a string safe for jsPDF's built-in Helvetica.
 * Anything still outside CP1252 after transliteration becomes '?'.
 */
export function toLatin(value) {
  let out = String(value ?? '');
  for (const [pattern, replacement] of TRANSLITERATIONS) out = out.replace(pattern, replacement);
  return out.replace(/[^\x00-\xFF]/g, '?');
}
