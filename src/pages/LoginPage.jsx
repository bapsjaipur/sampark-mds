// src/pages/LoginPage.jsx — Attio-style minimal auth screen.
//
// PHASE 22 — "Forgot?" no longer resets anything.
//
// It used to call resetVolunteerPassword({ phone }), which set the account's
// password to the 10-digit mobile number that had just been typed into the box
// above. Every volunteer's mobile number is printed on the contact lists inside
// the app, so that made the "secret" protecting each account public: type a
// karyakarta's number, press Forgot, sign in as them. No credential required.
//
// It now files a request that an admin has to approve on Admin → Volunteers.
// Nothing about the account changes until a human with manage_users types a new
// password, and the reply is deliberately the same whether or not the number is
// registered — otherwise this screen would be a way to test which phone numbers
// belong to volunteers.
import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { Eye, EyeOff, Lock, Phone as PhoneIcon } from 'lucide-react';
import { auth } from '../lib/firebase';
import { phoneToSyntheticEmail, isValidPhone } from '../lib/authHelpers';
import { Input, FieldError } from '../components/ui/Input';
import { Button } from '../components/ui/Button';

const FIREBASE_ERROR_MESSAGES = {
  'auth/invalid-credential': 'Incorrect phone number or password.',
  'auth/user-not-found': 'No account found for that phone number.',
  'auth/wrong-password': 'Incorrect password.',
  'auth/too-many-requests': 'Too many attempts. Try again in a few minutes.',
  'auth/invalid-api-key': 'App isn’t configured correctly — check your .env file.',
};

/**
 * The BAPS mark, from public/baps-logo.svg.
 *
 * Rendered optimistically and removed on error, because the file is dropped in by
 * hand rather than imported — a missing one must leave the wordmark standing on its
 * own, not a broken-image icon on the sign-in screen.
 *
 * Stacked on a phone and inline from sm up. Not decoration: on a narrow screen the
 * brand is the only thing above the card, and a small mark beside a word left a
 * dead band of cream between it and the form. Stacked, at nearly twice the size, it
 * fills that space the way the mockup does — while on desktop the same mark belongs
 * in the top-left corner, small and out of the way.
 */
function Brand() {
  const [logoOk, setLogoOk] = useState(true);
  return (
    <div className="flex flex-col items-center gap-2 sm:flex-row sm:gap-2.5">
      {logoOk && (
        <img
          src="/baps-logo.svg"
          alt=""
          className="h-16 w-16 shrink-0 object-contain sm:h-9 sm:w-9"
          onError={() => setLogoOk(false)}
        />
      )}
      <span className="text-base font-semibold tracking-tight text-slate-900 sm:text-[15px]">
        BAPS <span className="font-normal text-slate-500">JAIPUR MDS</span>
      </span>
    </div>
  );
}

/** A field with its icon inside the box, as on the mockup. */
function IconField({ icon: Icon, children }) {
  return (
    <div className="relative">
      <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      {children}
    </div>
  );
}

export default function LoginPage() {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetMode, setResetMode] = useState(false);
  const [requestSent, setRequestSent] = useState(null);

  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = location.state?.from?.pathname || '/households';

  async function handleRequestReset(e) {
    e.preventDefault();
    setError(null);
    const cleanPhone = phone.replace(/\D/g, '');
    if (!isValidPhone(cleanPhone)) {
      return setError('Please enter a valid 10-digit mobile number.');
    }

    setResetting(true);
    try {
      const { getFunctions, httpsCallable } = await import('firebase/functions');
      const requestPasswordReset = httpsCallable(getFunctions(), 'requestPasswordReset');
      const res = await requestPasswordReset({ phone: cleanPhone });
      setRequestSent(res?.data?.message
        || 'If that number belongs to a volunteer, an admin has been asked to reset it.');
    } catch (err) {
      // One message for every failure, deliberately. The obvious special case —
      // "the function isn't deployed yet" — does NOT arrive as
      // `functions/not-found`: a missing callable 404s the CORS preflight, the
      // browser reports a network failure and the SDK turns that into
      // `functions/internal`. Verified against a project without the function
      // deployed. So branching on the code would print the wrong reason most of
      // the time, and either way the person at this screen can do exactly one
      // thing about it. No "try again", which only invites twenty more attempts.
      console.error('[requestPasswordReset]', err?.code, err?.message);
      setError('Couldn’t file the request from here. Ask an admin — or your sanchalak — '
        + 'to reset your password for you.');
    } finally {
      setResetting(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (!isValidPhone(phone)) { setError('Enter a valid 10-digit phone number.'); return; }
    if (!password) { setError('Enter your password.'); return; }

    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, phoneToSyntheticEmail(phone), password);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(FIREBASE_ERROR_MESSAGES[err.code] || 'Couldn’t sign in. Try again.');
    } finally {
      setLoading(false);
    }
  }

  function backToLogin() {
    setResetMode(false);
    setRequestSent(null);
    setError(null);
  }

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-cream-100 px-4">
      {/* ── The line art ──────────────────────────────────────────────────
          A full-width band pinned to the bottom of the viewport, behind everything.

          The height is in vw, not vh, and 52.8 is 100 ÷ (12800/6760) — the drawing's
          own aspect ratio. That makes the band exactly as tall as the mandir needs to
          be when it spans the full width, at every screen size, from one value: the
          whole complex is always visible, always edge to edge, never letterboxed and
          never cropped. Breakpoints were tried first and were worse in both
          directions — a vh height that framed the temple nicely on a phone left it a
          small vignette with its shikhars hidden behind the card on a desktop.

          max-h is the one guard: on a wide, short window (a laptop with devtools open)
          52.8vw would run off the top, so the height is clamped and `contain` refits
          the drawing smaller and centred rather than beheading it.

          aria-hidden and pointer-events-none: it is decoration, and it sits under a
          form. Colour lives in .lineart-jaipur (src/index.css) — see the note there. */}
      <div
        aria-hidden="true"
        className="lineart-jaipur pointer-events-none absolute inset-x-0 bottom-0 h-[52.8vw] max-h-[88vh]"
      />

      {/* Top-left on desktop, centred above the card on a phone — the mockup does
          both, and on a narrow screen a left-aligned mark next to a centred card
          reads as a mistake. */}
      <header className="relative z-10 flex shrink-0 justify-center pt-9 sm:justify-start sm:pt-7">
        <Brand />
      </header>

      <main className="relative z-10 flex flex-1 items-center justify-center py-7">
        <div className="w-full max-w-sm rounded-xl border border-slate-100 bg-white p-7 shadow-sm sm:p-8">
          <h1 className="text-center text-[19px] font-semibold tracking-tight text-slate-900">
            {resetMode ? 'Reset password' : 'Sign In'}
          </h1>
          <p className="mt-1 text-center text-[13px] text-slate-400">
            {resetMode ? 'Ask an admin to reset your password.' : 'Welcome to BAPS Jaipur MDS Portal'}
          </p>

          {requestSent ? (
            <div className="mt-6 space-y-4">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
                {requestSent}
              </div>
              <p className="text-xs text-slate-400">
                An admin will set a new password and pass it to you directly. Nothing about your
                account has changed yet.
              </p>
              <Button variant="secondary" size="lg" className="w-full" onClick={backToLogin}>
                Back to sign in
              </Button>
            </div>
          ) : (
            <form onSubmit={resetMode ? handleRequestReset : handleSubmit} className="mt-6 space-y-3">
              <FieldError>{error}</FieldError>

              <div>
                {/* No visible label: the icon and the placeholder carry it, as on the
                    mockup. aria-label keeps the field named for a screen reader. */}
                <IconField icon={PhoneIcon}>
                  <Input
                    type="tel"
                    inputMode="numeric"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="Phone number"
                    aria-label="Phone number"
                    autoComplete="username"
                    className="h-11 pl-9"
                  />
                </IconField>
                {resetMode && (
                  <p className="mt-2 text-xs text-slate-400">
                    We’ll let an admin know you need a new password. They will send it to you —
                    your password does not change until then.
                  </p>
                )}
              </div>

              {!resetMode && (
                <IconField icon={Lock}>
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password"
                    aria-label="Password"
                    autoComplete="current-password"
                    className="h-11 pl-9 pr-10"
                  />
                  {/* tabIndex -1 deliberately. This is the one control that must stay
                      out of the keyboard path: Tab from the password box goes to
                      Sign in, not to a visibility toggle nobody reached for. */}
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 transition-colors hover:text-slate-600"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </IconField>
              )}

              <Button type="submit" variant="accent" size="lg" className="w-full !mt-4" disabled={loading || resetting}>
                {resetMode
                  ? (resetting ? 'Sending…' : 'Request a password reset')
                  : (loading ? 'Signing in…' : 'SIGN IN')}
              </Button>

              {/* BELOW Sign in, and last in the DOM. It began beside the "Password"
                  label, which put it ahead of the password box in tab order — Tab
                  from the phone number landed on the link rather than the field.
                  Signing in is what almost everyone came to do, so the recovery
                  link goes after the button that does it, and the keyboard path is
                  phone → password → Sign in with nothing in between. Mirrors the
                  "Back to login" link below it in reset mode. */}
              {!resetMode && (
                <div className="text-center">
                  <button
                    type="button"
                    onClick={() => { setResetMode(true); setError(null); }}
                    className="text-xs font-medium text-orange-600 hover:underline"
                  >
                    Forgot Password?
                  </button>
                </div>
              )}

              {resetMode && (
                <div className="text-center">
                  <button type="button" onClick={backToLogin} className="text-xs text-slate-400 underline hover:text-slate-600">Back to login</button>
                </div>
              )}
            </form>
          )}

          {/* No self-registration in this app — accounts are created by an admin on
              the Volunteers screen. The mockup's "Register Now" is deliberately not
              reproduced: a link that cannot lead anywhere is worse than none. */}
          <p className="mt-5 border-t border-slate-100 pt-4 text-center text-xs text-slate-400">
            New to MDS? Ask an admin to create your account.
          </p>
        </div>
      </main>

      <footer className="relative z-10 pb-5 text-center text-[11px] text-slate-400">
        © {new Date().getFullYear()} BAPS Swaminarayan Sanstha, Jaipur. All Rights Reserved.
      </footer>
    </div>
  );
}
