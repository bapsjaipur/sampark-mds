// src/pages/ProfilePage.jsx
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 39 — the two credential fields are now ADMIN-APPROVED REQUESTS.
//
// This screen used to let a volunteer rewrite both halves of their own login:
// the mobile number (which IS the username — Auth signs in on the synthetic
// <mobile>@baps-jaipur-mds.local address) and the password. Both are one-way
// doors for the person holding the phone. A single mistyped digit in the mobile
// field left the account reachable only on a number nobody knows, and there is no
// self-service recovery in this app — no real email address to send a reset to.
//
// So the shape is the same one Phase 22 built for the forgotten-password flow:
// the volunteer ASKS, an admin who can recognise them says yes, and until then
// nothing about the credential moves.
//
//   Mobile   → updateVolunteerAccount({ requestedMobile }) writes
//              volunteers/{id}.mobileChangeRequest. Admin → Volunteers shows it
//              with Approve / Decline.
//   Password → requestPasswordReset({ phone }), the callable that already exists
//              and is already deployed. Admin → Volunteers already lists these.
//
// WHAT IS STILL SELF-SERVICE: name and profile photo. Neither is a credential,
// and the photo is on the short whitelist a volunteer may write to their own
// document in firestore.rules — which is why handlePhotoUpload writes direct.
//
// HONEST LIMIT ON THE PASSWORD HALF. Firebase Auth has no server-side switch that
// forbids a signed-in user from calling updatePassword(); their ID token is
// genuinely theirs. Removing the form removes the way anyone here would actually
// do it, and routes the real need — "I forgot mine" — through the admin. It is
// not a cryptographic block, and it is not claimed as one.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { LogOut, Lock, ShieldCheck, Clock, X } from 'lucide-react';
import { auth, db } from '../lib/firebase';
import { signOut } from 'firebase/auth';
import { doc, updateDoc } from 'firebase/firestore';
import { useAuth } from '../hooks/usePermissions';
import { useToast } from '../contexts/ToastContext';
import { Input, Label } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import PhotoUploader from '../components/photo/PhotoUploader';

export default function ProfilePage() {
  const { volunteer, role } = useAuth();
  const { showToast } = useToast();

  const [name, setName] = useState('');
  const [photoURL, setPhotoURL] = useState('');
  const [saving, setSaving] = useState(false);

  // The number-change request: closed until asked for, so the field reads as
  // settled rather than as an invitation to edit.
  const [askingMobile, setAskingMobile] = useState(false);
  const [wantedMobile, setWantedMobile] = useState('');
  const [mobileBusy, setMobileBusy] = useState(false);

  const [pwdBusy, setPwdBusy] = useState(false);
  const [pwdAsked, setPwdAsked] = useState(false);

  const pending = volunteer?.mobileChangeRequest?.status === 'pending'
    ? volunteer.mobileChangeRequest
    : null;

  useEffect(() => {
    if (volunteer) {
      setName(volunteer.name || '');
      setPhotoURL(volunteer.profilePhotoURL || '');
    }
  }, [volunteer]);

  async function handlePhotoUpload(url) {
    try {
      await updateDoc(doc(db, 'volunteers', volunteer.id), { profilePhotoURL: url });
      setPhotoURL(url);
      showToast({ type: 'success', message: 'Photo updated.' });
    } catch (err) {
      showToast({ type: 'error', message: 'Failed to save photo in database.' });
    }
  }

  function callable(fnName) {
    return httpsCallable(getFunctions(), fnName);
  }

  async function handleSave(e) {
    e.preventDefault();
    const clean = name.trim();
    if (!clean) return showToast({ type: 'error', message: 'Name is required.' });
    if (clean === volunteer.name) return showToast({ type: 'success', message: 'No changes made.' });

    setSaving(true);
    try {
      // Deliberately does NOT send `mobile` — see the header note. An old deployed
      // function ignores an absent field, so this is safe before the redeploy too.
      await callable('updateVolunteerAccount')({ volunteerId: volunteer.id, name: clean });
      showToast({ type: 'success', message: 'Profile updated.' });
    } catch (err) {
      console.error(err);
      showToast({ type: 'error', message: err.message || "Couldn't save changes." });
    } finally {
      setSaving(false);
    }
  }

  async function submitMobileRequest(e) {
    e.preventDefault();
    const digits = wantedMobile.replace(/\D/g, '');
    if (digits.length !== 10) {
      return showToast({ type: 'error', message: 'Enter a 10-digit mobile number.' });
    }
    setMobileBusy(true);
    try {
      await callable('updateVolunteerAccount')({ volunteerId: volunteer.id, requestedMobile: digits });
      setAskingMobile(false);
      setWantedMobile('');
      showToast({
        type: 'success',
        message: 'Request sent. Keep signing in with your current number until an admin approves it.',
      });
    } catch (err) {
      showToast({ type: 'error', message: err.message || 'Could not send the request.' });
    } finally {
      setMobileBusy(false);
    }
  }

  async function withdrawMobileRequest() {
    setMobileBusy(true);
    try {
      await callable('updateVolunteerAccount')({ volunteerId: volunteer.id, requestedMobile: null });
      showToast({ type: 'success', message: 'Request withdrawn.' });
    } catch (err) {
      showToast({ type: 'error', message: err.message || 'Could not withdraw the request.' });
    } finally {
      setMobileBusy(false);
    }
  }

  async function requestPasswordChange() {
    setPwdBusy(true);
    try {
      // The callable that the login screen's "Forgot?" uses. It records the ask
      // and changes nothing — see functions/resetVolunteerPassword.js.
      await callable('requestPasswordReset')({ phone: volunteer.mobile });
      setPwdAsked(true);
      showToast({ type: 'success', message: 'An admin has been asked to set a new password for you.' });
    } catch (err) {
      showToast({ type: 'error', message: err.message || 'Could not send the request.' });
    } finally {
      setPwdBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-8 space-y-6 sm:px-6 sm:py-12">
      <h1 className="mb-8 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">My Profile</h1>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        {/* Photo Uploader Header */}
        <div className="bg-slate-50/50 p-6 flex flex-col items-center border-b border-slate-100 space-y-4">
          <PhotoUploader
            individualId={volunteer?.id}
            currentPhotoURL={photoURL}
            onUploaded={handlePhotoUpload}
          />
          <div className="text-center">
            <p className="font-semibold text-slate-900 text-lg">{volunteer?.name}</p>
            <p className="text-xs text-slate-400 font-medium mt-0.5">Role: <span className="font-semibold text-slate-700">{role?.name || 'Karyakarta'}</span></p>
          </div>
          {/* Says out loud where the photo goes, because the whole point of setting
              one is that other people see it. */}
          <p className="text-[11px] text-slate-400">
            Your photo appears next to your name in the menu and at the top of the app.
          </p>
          <div className="flex flex-wrap gap-2 text-xs font-semibold justify-center">
            {volunteer?.assignedAreas?.map(a => <span key={a} className="rounded-full bg-orange-50 px-2.5 py-0.5 text-orange-700">{a}</span>)}
            {volunteer?.assignedMandals?.map(m => <span key={m} className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-indigo-700">{m}</span>)}
          </div>
        </div>

        {/* Profile Form */}
        <form onSubmit={handleSave} className="p-6 space-y-5">
          <div>
            <Label required>Full Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} />
          </div>

          {/* ── Mobile: shown, not editable ───────────────────────────────── */}
          <div>
            <Label>
              <span className="inline-flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5 text-slate-400" /> Mobile Number
                <span className="text-slate-400 font-normal">(your login ID)</span>
              </span>
            </Label>
            <div className="mt-1 flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
              <span className="text-sm font-medium tabular-nums text-slate-700">
                {volunteer?.mobile || '—'}
              </span>
              {!pending && !askingMobile && (
                <button
                  type="button"
                  onClick={() => setAskingMobile(true)}
                  className="shrink-0 text-xs font-semibold text-orange-600 hover:text-orange-700"
                >
                  Request a change
                </button>
              )}
            </div>

            {pending ? (
              <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
                <p className="flex items-center gap-1.5 font-semibold">
                  <Clock className="h-3.5 w-3.5 shrink-0" />
                  Waiting for admin approval
                </p>
                <p className="mt-1 leading-relaxed">
                  You asked to change your login number to{' '}
                  <strong className="tabular-nums">{pending.mobile}</strong>. Until an admin approves it,
                  keep signing in with <strong className="tabular-nums">{volunteer?.mobile}</strong>.
                </p>
                <button
                  type="button"
                  onClick={withdrawMobileRequest}
                  disabled={mobileBusy}
                  className="mt-1.5 inline-flex items-center gap-1 font-semibold text-amber-900 underline disabled:opacity-50"
                >
                  <X className="h-3 w-3" /> {mobileBusy ? 'Working…' : 'Withdraw the request'}
                </button>
              </div>
            ) : askingMobile ? (
              <div className="mt-2 space-y-2 rounded-lg border border-slate-200 bg-white p-3">
                <Label>New mobile number</Label>
                <Input
                  value={wantedMobile}
                  onChange={e => setWantedMobile(e.target.value)}
                  inputMode="numeric"
                  maxLength={10}
                  placeholder="10 digits"
                  autoFocus
                />
                <p className="text-[11px] leading-snug text-slate-500">
                  Nothing changes yet. An admin has to approve it, because this number is what you
                  sign in with — a wrong digit would lock you out and only an admin could let you
                  back in.
                </p>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="accent" disabled={mobileBusy} onClick={submitMobileRequest}>
                    {mobileBusy ? 'Sending…' : 'Send request'}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={mobileBusy}
                    onClick={() => { setAskingMobile(false); setWantedMobile(''); }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <p className="mt-1.5 text-xs text-slate-400">
                Only an admin can change this — it is your login, not just a contact number.
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4">
            <Button type="button" variant="ghost" className="text-red-500 hover:bg-red-50 hover:text-red-700" onClick={() => signOut(auth)}>
              <LogOut className="mr-2 h-4 w-4" /> Sign Out
            </Button>
            <Button type="submit" variant="accent" disabled={saving}>
              {saving ? 'Saving...' : 'Save Profile'}
            </Button>
          </div>
        </form>
      </div>

      {/* ── Password: request, don't set ─────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
          <ShieldCheck className="h-4 w-4 text-slate-400" /> Password
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Your password is set by an admin. Ask for a new one and someone with admin access will
          set it and pass it to you directly — in person or by phone, never over a message.
        </p>
        {pwdAsked ? (
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-800">
            Request sent. Your current password keeps working until the new one is set.
          </div>
        ) : (
          <Button variant="secondary" className="mt-4" disabled={pwdBusy} onClick={requestPasswordChange}>
            {pwdBusy ? 'Sending…' : 'Request a new password'}
          </Button>
        )}
      </div>
    </div>
  );
}
