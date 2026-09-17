// src/components/volunteers/PasswordApprovals.jsx
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 41 — "only approve request goes to upper level Head to approve there
// password was set."
//
// The volunteer types the password they want; somebody above them says yes. This
// is the yes.
//
// WHY THIS IS A CALLABLE AND NOT A LISTENER. The panel it replaces opened
// onSnapshot(collection(db, 'passwordResets')) and had to be hidden from anyone
// without manage_users, because the rules require manage_users to read that
// collection — so every scoped Moderator or Sanchalak, the very people who are
// now supposed to approve their own karyakartas, would have been served a
// guaranteed permission-denied. Rather than widen the rules (which would let a
// mandal head list who in the whole city is locked out), the three operations are
// callables: the server decides who outranks whom and returns only the rows this
// caller may act on. No firestore.rules change, and no client-side rank check
// that a determined browser could edit around.
//
// THE PASSWORD IS NEVER RETURNED. listPasswordRequests strips the ciphertext and
// there is no endpoint that reveals it. The approver confirms WHO asked, not WHAT
// they chose — which is the entire improvement over Phase 22, where the admin
// invented the password and therefore knew it.
//
// WHICH MEANS THE ONE THING THE APPROVER MUST DO IS RECOGNISE THE PERSON. A row
// here only proves that somebody typed this mobile number into the login screen.
// If that somebody was not the volunteer, approving hands them the account. The
// copy says so in those words, because it is the only check left and it is a
// human one.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { ShieldAlert, KeyRound, Loader2, Clock } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';

const call = (name) => httpsCallable(getFunctions(), name);

/** epoch ms → "5m ago". Mirrors formatLastLogin in VolunteerEditor. */
function ago(millis) {
  if (!millis) return null;
  const mins = Math.floor((Date.now() - millis) / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/** epoch ms → "in 7h", or null once it is past. */
function until(millis) {
  if (!millis) return null;
  const mins = Math.floor((millis - Date.now()) / 60000);
  if (mins <= 0) return null;
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h`;
}

/**
 * One fetch, shared. Both screens that show approvals call this — ProfilePage
 * (which also needs `mine`, the caller's own pending request) and
 * VolunteerEditor — and one callable answers both questions, so asking costs a
 * single round trip rather than one per screen.
 *
 * Not a listener on purpose. A live query on passwordResets would need the rules
 * widened, and a collection that holds at most one row per volunteer and changes
 * a handful of times a month does not repay a permanent subscription.
 */
export function usePasswordApprovals({ enabled = true } = {}) {
  const { showToast } = useToast();
  const [requests, setRequests] = useState([]);
  const [mine, setMine] = useState(null);
  const [canApproveAll, setCanApproveAll] = useState(false);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const refresh = useCallback(async () => {
    if (!enabled) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await call('listPasswordRequests')();
      setRequests(res?.data?.requests || []);
      setMine(res?.data?.mine || null);
      setCanApproveAll(Boolean(res?.data?.canApproveAll));
      setError(null);
    } catch (err) {
      // Deliberately not surfaced by default — see `showErrors` below. A
      // not-yet-deployed callable arrives as functions/internal (the missing
      // function 404s the CORS preflight, which the SDK reports as a network
      // failure), so this branch is reached on a normal day and must not put a
      // red box on the profile screen of every volunteer who has nothing
      // waiting for them.
      console.error('[listPasswordRequests]', err?.code, err?.message);
      setRequests([]);
      setMine(null);
      setError(err?.message || 'Could not load password requests.');
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => { refresh(); }, [refresh]);

  const approve = useCallback(async (req) => {
    setBusyId(req.id);
    try {
      await call('approvePasswordRequest')({ requestId: req.id });
      showToast({
        type: 'success',
        message: `${req.volunteerName || 'They'} can now sign in with the password they chose.`,
      });
      await refresh();
    } catch (err) {
      showToast({ type: 'error', message: err?.message || 'Could not approve that request.' });
    } finally {
      setBusyId(null);
    }
  }, [refresh, showToast]);

  const deny = useCallback(async (req, reason) => {
    setBusyId(req.id);
    try {
      await call('denyPasswordRequest')({ requestId: req.id, reason: reason || '' });
      showToast({ type: 'success', message: 'Request denied. Their old password still works.' });
      await refresh();
    } catch (err) {
      showToast({ type: 'error', message: err?.message || 'Could not deny that request.' });
    } finally {
      setBusyId(null);
    }
  }, [refresh, showToast]);

  return { requests, mine, canApproveAll, loading, error, busyId, refresh, approve, deny };
}

function RequestRow({ req, api, knownName, onSetManually }) {
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState('');
  const busy = api.busyId === req.id;
  const name = knownName || req.volunteerName || 'Unknown volunteer';
  const left = until(req.expiresAt);

  // A Phase 22 row carries no password, so there is nothing for this screen to
  // approve. Say that plainly instead of offering a button that throws.
  const legacy = !req.hasChoice;

  return (
    <div className="px-3 py-2.5 sm:px-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-slate-900">{name}</div>
          <div className="text-xs text-slate-500">
            {req.mobile}
            {req.requestedAt ? ` · asked ${ago(req.requestedAt)}` : ''}
            {req.requestCount > 1 ? ` · ${req.requestCount} tries` : ''}
            {left ? ` · expires in ${left}` : ''}
          </div>
          {legacy && (
            <div className="mt-0.5 text-xs text-amber-700">
              Older request — no password attached. Ask them to press “Forgot password” again and
              type the one they want.
            </div>
          )}
        </div>

        {!legacy && !denying && (
          <div className="flex shrink-0 gap-2">
            <Button variant="accent" size="sm" disabled={busy} onClick={() => api.approve(req)}>
              {busy
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Approving…</>
                : <><KeyRound className="h-3.5 w-3.5" /> Approve</>}
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setDenying(true)}>Deny</Button>
          </div>
        )}

        {legacy && onSetManually && (
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => onSetManually(req)}>
            Set one for them
          </Button>
        )}
        {legacy && !onSetManually && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setDenying(true)}>Clear</Button>
        )}
      </div>

      {denying && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why? (optional — they won't see it, it goes in the audit trail)"
            className="h-8 min-w-0 flex-1 text-xs"
          />
          <Button variant="danger" size="sm" disabled={busy} onClick={() => api.deny(req, reason)}>
            {busy ? 'Saving…' : 'Confirm deny'}
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setDenying(false); setReason(''); }}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * The card. Renders NOTHING when there is nothing waiting, which is what lets it
 * sit on ProfilePage — the one screen every volunteer can open — without turning
 * into furniture for the 95% of people who will never see a row in it.
 *
 * `api` comes from usePasswordApprovals() in the parent: hooks can't be called
 * conditionally, and ProfilePage needs `mine` from the same fetch, so the parent
 * owns the call and passes it down.
 */
export default function PasswordApprovals({
  api,
  volunteers = [],
  onSetManually = null,
  showErrors = false,
  className = '',
}) {
  const nameFor = (id) => volunteers.find((v) => v.id === id)?.name || null;

  if (api.loading && api.requests.length === 0) return null;
  if (api.requests.length === 0) {
    if (!showErrors || !api.error) return null;
    return (
      <div className={`mb-5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500 sm:px-4 ${className}`}>
        Password requests could not be loaded ({api.error}). Nobody is locked out because of it —
        requests are still being recorded.
      </div>
    );
  }

  return (
    <div className={`mb-5 rounded-lg border border-amber-200 bg-amber-50/60 ${className}`}>
      <div className="flex items-center gap-2 border-b border-amber-200 px-3 py-2 sm:px-4">
        <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600" />
        <span className="text-[13px] font-semibold text-amber-900">
          Passwords waiting for your approval
          <span className="ml-1.5 rounded-full bg-amber-200 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900">
            {api.requests.length}
          </span>
        </span>
        <button
          type="button"
          onClick={api.refresh}
          disabled={api.loading}
          className="ml-auto text-xs font-medium text-amber-800 hover:underline disabled:opacity-50"
        >
          {api.loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <p className="px-3 pt-2.5 text-xs text-amber-800 sm:px-4">
        Each of these people has chosen a new password for themselves. You don’t see what they
        chose — approving just switches it on.{' '}
        <strong>Check with them first, by phone or in person.</strong> A request only proves
        somebody typed this number into the login screen, so approving one nobody asked for would
        hand over the account.
      </p>

      <div className="mt-1.5 divide-y divide-amber-200/70">
        {api.requests.map((req) => (
          <RequestRow
            key={req.id}
            req={req}
            api={api}
            knownName={nameFor(req.volunteerId)}
            onSetManually={onSetManually}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * The requester's own side of it, for ProfilePage: "you asked, it's waiting".
 * Driven by `mine` from the same fetch, so it costs nothing extra.
 */
export function MyPasswordRequestNotice({ mine }) {
  if (!mine) return null;
  return (
    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
      <p className="flex items-center gap-1.5 font-semibold">
        <Clock className="h-3.5 w-3.5 shrink-0" />
        {mine.expired ? 'That password choice has expired' : 'Waiting for approval'}
      </p>
      <p className="mt-1 leading-relaxed">
        {mine.expired
          ? 'Nobody approved it within a day, so it has lapsed. Choose a new password below and ask again.'
          : 'You chose a new password ' + (ago(mine.requestedAt) || 'just now')
            + '. Keep signing in with your current one until your sanchalak or the karyalay approves it.'}
      </p>
    </div>
  );
}
