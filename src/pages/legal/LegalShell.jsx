// src/pages/legal/LegalShell.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Public shell for the Privacy Policy and Terms of Service pages.
//
// These two pages are what Google's OAuth consent screen links to (Phase 37
// per-user Google Calendar push), and Google requires every EXTERNAL app in
// "Production" to publish them. They must therefore render WITHOUT a login — they
// sit OUTSIDE <RequireAuth> in App.jsx — and identify the app clearly, because a
// reviewer or a signed-out volunteer opens them straight from the consent screen.
//
// Styling mirrors LoginPage.jsx (cream background, slate text, orange accents,
// the /baps-logo.svg mark) so a visitor recognises it as the same app.
// ─────────────────────────────────────────────────────────────────────────────
import { Link } from 'react-router-dom';

export default function LegalShell({ title, updated, children }) {
  return (
    <div className="min-h-screen bg-cream-100 text-slate-700">
      <header className="border-b border-slate-200/70 bg-white/70 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-2.5 px-5 py-4">
          {/* Optimistic like LoginPage: the logo is dropped in by hand, so a missing
              file must leave the wordmark standing rather than a broken-image icon. */}
          <img
            src="/baps-logo.svg"
            alt=""
            className="h-8 w-8 shrink-0 object-contain"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
          <span className="text-[15px] font-semibold tracking-tight text-slate-900">
            BAPS <span className="font-normal text-slate-500">JAIPUR MDS</span>
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-10">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {updated && <p className="mt-1 text-sm text-slate-400">Last updated {updated}</p>}

        <div className="mt-8 space-y-8">{children}</div>

        <div className="mt-12 border-t border-slate-200 pt-6 text-sm">
          <Link to="/login" className="font-medium text-orange-600 hover:underline">
            ← Back to sign in
          </Link>
        </div>
      </main>

      <footer className="pb-8 pt-2 text-center text-[11px] text-slate-400">
        © {new Date().getFullYear()} BAPS Swaminarayan Sanstha, Jaipur. All Rights Reserved.
      </footer>
    </div>
  );
}

/** A titled block. Keeps the two legal pages readable and consistent. */
export function Section({ heading, children }) {
  return (
    <section className="space-y-3">
      {heading && <h2 className="text-base font-semibold text-slate-900">{heading}</h2>}
      <div className="space-y-3 text-[15px] leading-relaxed text-slate-600">{children}</div>
    </section>
  );
}
