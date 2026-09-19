// src/pages/HomePage.jsx — public landing screen.
//
// Until now the first thing an unauthenticated visitor saw was the sign-in form
// itself: RequireAuth bounced "/" straight to /login. This is the screen that now
// sits in front of it — brand, a one-line statement of what the portal is, and a
// single Sign In call to action. Signed-in visitors never see it; RootGate in
// App.jsx sends them on to their role's home instead.
//
// It deliberately reuses the sign-in screen's visual language — the cream field,
// the Jaipur mandir line art pinned to the foot of the viewport, the same wordmark
// — so the two read as one product rather than a landing page bolted onto an app.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Button } from '../components/ui/Button';

/**
 * The BAPS mark, from public/baps-logo.svg — same treatment as the sign-in
 * screen: rendered optimistically and dropped on error, since the file is placed
 * by hand and a missing one must leave the wordmark standing rather than a broken
 * image icon.
 */
function Brand() {
  const [logoOk, setLogoOk] = useState(true);
  return (
    <div className="flex items-center gap-2.5">
      {logoOk && (
        <img
          src="/baps-logo.svg"
          alt=""
          className="h-9 w-9 shrink-0 object-contain"
          onError={() => setLogoOk(false)}
        />
      )}
      <span className="text-[15px] font-semibold tracking-tight text-slate-900">
        BAPS <span className="font-normal text-slate-500">JAIPUR MDS</span>
      </span>
    </div>
  );
}

export default function HomePage() {
  const navigate = useNavigate();

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-cream-100 px-4">
      {/* Same mandir line art as the sign-in screen — see LoginPage.jsx for the
          geometry behind the vw height. Decoration, behind everything, and never
          in the pointer or tab path. */}
      <div
        aria-hidden="true"
        className="lineart-jaipur pointer-events-none absolute inset-x-0 bottom-0 h-[52.8vw] max-h-[80vh]"
      />

      <header className="relative z-10 flex shrink-0 items-center justify-between gap-3 pt-7">
        <Brand />
        <Button variant="secondary" size="md" onClick={() => navigate('/login')}>
          Sign in
        </Button>
      </header>

      <main className="relative z-10 flex flex-1 items-center justify-center py-10">
        <div className="w-full max-w-xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">
            Mandir Devotee Sampark · Jaipur
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
            BAPS Jaipur MDS Portal
          </h1>
          <p className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-slate-500">
            One place for Jaipur&apos;s karyakartas to coordinate devotee sampark —
            households and contacts, sabha attendance, calling lists and seva across
            every mandal.
          </p>

          <div className="mt-8 flex flex-col items-center gap-3">
            <Button
              variant="accent"
              size="lg"
              className="w-full max-w-xs"
              onClick={() => navigate('/login')}
            >
              Sign In <ArrowRight className="h-4 w-4" />
            </Button>
            <p className="text-xs text-slate-400">
              For authorized karyakartas only. Ask an admin to create your account.
            </p>
          </div>
        </div>
      </main>

      <footer className="relative z-10 flex flex-col items-center gap-2 pb-5 text-center text-[11px] text-slate-400 sm:flex-row sm:justify-between">
        <span>© {new Date().getFullYear()} BAPS Swaminarayan Sanstha, Jaipur. All Rights Reserved.</span>
        <span className="flex items-center gap-3">
          <Link to="/privacy" className="hover:text-slate-600">Privacy</Link>
          <Link to="/terms" className="hover:text-slate-600">Terms</Link>
        </span>
      </footer>
    </div>
  );
}
