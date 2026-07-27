// src/pages/LoginPage.jsx — Attio-style minimal auth screen.
import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { phoneToSyntheticEmail, isValidPhone } from '../lib/authHelpers';
import { Input, Label, FieldError } from '../components/ui/Input';
import { Button } from '../components/ui/Button';

const FIREBASE_ERROR_MESSAGES = {
  'auth/invalid-credential': 'Incorrect phone number or password.',
  'auth/user-not-found': 'No account found for that phone number.',
  'auth/wrong-password': 'Incorrect password.',
  'auth/too-many-requests': 'Too many attempts. Try again in a few minutes.',
  'auth/invalid-api-key': 'App isn’t configured correctly — check your .env file.',
};

export default function LoginPage() {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetMode, setResetMode] = useState(false);

  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = location.state?.from?.pathname || '/households';

  async function handleResetPassword(e) {
    e.preventDefault();
    setError(null);
    const cleanPhone = phone.replace(/\D/g, '');
    if (!isValidPhone(cleanPhone)) {
      return setError('Please enter a valid 10-digit mobile number.');
    }

    setResetting(true);
    try {
      const { getFunctions, httpsCallable } = await import('firebase/functions');
      const resetVolunteerPassword = httpsCallable(getFunctions(), 'resetVolunteerPassword');
      await resetVolunteerPassword({ phone: cleanPhone });
      setResetMode(false);
      setPassword(cleanPhone); // auto-fill password to make login easy
      setError(null);
      alert('Password has been reset to your mobile number. You can now login.');
    } catch (err) {
      if (err.message === 'Volunteer not found.') {
        setError('No account found for that phone number.');
      } else {
        setError('Failed to reset password. Please try again.');
      }
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

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50/50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-100 bg-white p-8">
        <h1 className="text-[17px] font-semibold text-slate-900 tracking-tight">BAPS Jaipur MDS</h1>
        <p className="mt-1 text-sm text-slate-400">
           {resetMode ? "Reset your password." : "Sign in with your phone number."}
        </p>

        <form onSubmit={resetMode ? handleResetPassword : handleSubmit} className="mt-6 space-y-4">
          <FieldError>{error}</FieldError>

          <div>
            <Label>Phone number</Label>
            <Input type="tel" inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit number" autoComplete="username" />
            {resetMode && <p className="mt-1.5 text-xs text-slate-400">We will set your password back to your mobile number.</p>}
          </div>

          {!resetMode && (
             <div>
               <div className="flex justify-between items-center mb-1">
                 <Label className="mb-0">Password</Label>
                 <button type="button" onClick={() => { setResetMode(true); setError(null); }} className="text-xs text-orange-600 hover:underline">Forgot?</button>
               </div>
               <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
             </div>
          )}

          <Button type="submit" variant="accent" size="lg" className="w-full" disabled={loading || resetting}>
            {resetMode
                ? (resetting ? 'Resetting...' : 'Reset Password')
                : (loading ? 'Signing in…' : 'Sign in')}
          </Button>

          {resetMode && (
             <div className="text-center mt-3">
               <button type="button" onClick={() => { setResetMode(false); setError(null); }} className="text-xs text-slate-400 hover:text-slate-600 underline">Back to login</button>
             </div>
          )}
        </form>

        <p className="mt-4 text-center text-xs text-slate-400">Don’t have an account? Ask an admin to create one for you.</p>
      </div>
    </div>
  );
}
