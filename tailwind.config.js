/** @type {import('tailwindcss').Config} */

// ─────────────────────────────────────────────────────────────────────────────
// READ THIS BEFORE YOU TRUST A SLATE CLASS
//
// `bg-slate-50` in this project is a warm CREAM, not Tailwind's cool grey. The
// surface end of the slate ramp (50–300) has been retuned to a very light English
// beige; 400–950 are stock Tailwind, untouched.
//
// WHY IT WAS DONE THIS WAY. The app is meant to read as cream canvas → white card
// → barely-there cream fill. Getting there by hand meant editing 183 occurrences
// of bg-slate-50 / bg-slate-100 / border-slate-100 / divide-slate-* across 48
// files, and a sweep that misses even a few leaves the app half warm and half
// grey — which looks worse than either one on its own. Retuning the ramp once
// re-tints every subtle fill, pill track, card border and row divider in the
// codebase at the same instant, and any component written tomorrow with the
// ordinary Tailwind idiom lands warm without anyone having to remember this.
//
// WHY ONLY 50–300. Those shades are only ever used as SURFACES here — fills,
// hairlines, dividers, disabled states. 400–950 are the text and icon colours.
// Cool grey text on a warm ground is a normal, legible pairing (it is what most
// paper does); warming the text as well pushes the whole screen towards sepia.
//
// The scale is written out in full rather than as a partial override. Tailwind's
// `extend` does deep-merge nested colour objects, so listing 50–300 alone would
// work — but a reader who needs to know what `text-slate-600` actually is should
// not have to hold Tailwind's defaults in their head to find out.
//
// `cream` is the same family exposed under an honest name. Prefer it for anything
// new, especially page canvases: `bg-cream-100` says what it is, and it means a
// future maintainer can undo this override by rewriting the four canvases rather
// than auditing every slate class in the app.
// ─────────────────────────────────────────────────────────────────────────────

const CREAM = {
  50: '#FBF9F4',  // lightest — a hair off white, for a fill sitting on a white card
  100: '#F6F2EA', // THE PAGE CANVAS. White cards read as raised against this.
  200: '#EFE9DD', // recessed: tab-pill tracks, table headers, chips
  300: '#E3DACA', // borders and dividers that need to be seen, not felt
};

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        cream: CREAM,
        slate: {
          50: '#FAF7F1',  // warmed — was #F8FAFC
          100: '#F1ECE2', // warmed — was #F1F5F9
          200: '#E4DDD0', // warmed — was #E2E8F0
          300: '#CFC6B5', // warmed — was #CBD5E1
          400: '#94A3B8', // stock Tailwind from here down: these are text colours
          500: '#64748B',
          600: '#475569',
          700: '#334155',
          800: '#1E293B',
          900: '#0F172A',
          950: '#020617',
        },
      },
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'] },
      letterSpacing: { tight: '-0.011em' },
      borderRadius: { lg: '0.5rem' },
      keyframes: { 'toast-in': { '0%': { opacity: 0, transform: 'translateY(8px)' }, '100%': { opacity: 1, transform: 'translateY(0)' } } },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
