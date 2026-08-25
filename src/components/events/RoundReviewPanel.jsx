// src/components/events/RoundReviewPanel.jsx
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 27 — the admin half of the post-sabha review: did the calling work?
//
// The rest of EventDashboard answers "how many came". This answers the only
// question that tells you whether the week's phone calls were worth making:
// of the people who SAID they would come, how many actually did — and which
// karyekar's list they were on.
//
// It also owns the one write in the whole feature: "Close round & start
// follow-up" freezes each called contact's outcome and attendance onto
// individuals.lastRound and blanks their status, so the follow-up calls that
// come next are not mistaken for last week's invite calls. See roundService for
// why the snapshot exists at all.
//
// READS. One query — batches where eventId == this sabha, a single-field
// equality match, so no composite index and typically under 20 documents. It
// runs when the Dashboard tab is opened for a sabha that has already happened,
// not on page load, and never on a karyekar's phone. Contacts and attendance
// are already in hand from EventsPage, so nothing per-contact is fetched.
//
// THE UNTAGGED FALLBACK. Batches cut before this feature carry no eventId, so
// the first query comes back empty for them. Rather than showing nothing, the
// panel then offers the batches that are still assigned and match the sabha's
// mandal — clearly labelled as a guess, opt-in with one tap, and never used for
// the write until the admin has agreed to it.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react';
import {
  Target, Loader2, Lock, AlertTriangle, CheckCircle2, PhoneCall, Info, Users,
} from 'lucide-react';
import { collection, query, where } from 'firebase/firestore';
// PHASE 24 — metered, so the admin dashboard's share of the read budget shows
// up on the usage panel instead of being guessed at.
import { getDocs } from '../../lib/fsMetered';
import { db } from '../../lib/firebase';
import {
  ROUND_GROUPS, ROUND_TONE_CLASSES, classifyRound, summarizeRound, closeRound, describeRoundError,
} from '../../services/roundService';
import { useCallOutcomes } from '../../hooks/useCallOutcomes';
import { useVolunteers } from '../../hooks/useVolunteers';
import { useAuth } from '../../hooks/usePermissions';
import { useToast } from '../../contexts/ToastContext';
import RequirePermission from '../RequirePermission';
import { Button } from '../ui/Button';
import Modal from '../ui/Modal';
import { cn } from '../../lib/cn';

/** One of the five buckets, as a bar. Same visual grammar as BarList above it. */
function GroupBar({ group, count, total }) {
  const tone = ROUND_TONE_CLASSES[group.tone] || ROUND_TONE_CLASSES.slate;
  const pct = total ? Math.round((count / total) * 100) : 0;
  return (
    <li className="flex items-center gap-2.5">
      <span className="flex w-32 shrink-0 items-center gap-1.5 sm:w-40" title={group.hint}>
        <span className={cn('h-2 w-2 shrink-0 rounded-full', tone.dot)} />
        <span className="min-w-0 truncate text-xs text-slate-600">{group.short}</span>
      </span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
        <div className={cn('h-full rounded-full transition-all', tone.dot)} style={{ width: `${Math.max(pct, count ? 2 : 0)}%` }} />
      </div>
      <span className="w-14 shrink-0 text-right text-xs font-semibold text-slate-700">
        {count} <span className="font-normal text-slate-400">{pct}%</span>
      </span>
    </li>
  );
}

function ConversionTile({ label, value, sub, tone = 'slate' }) {
  const TONES = {
    slate: 'text-slate-900',
    emerald: 'text-emerald-600',
    rose: 'text-rose-600',
    violet: 'text-violet-600',
  };
  return (
    <div className="rounded-xl border border-slate-100 bg-white p-3">
      <p className={cn('text-xl font-bold leading-none tracking-tight sm:text-2xl', TONES[tone])}>{value}</p>
      <p className="mt-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}

export default function RoundReviewPanel({ event, rows = [], individuals = [] }) {
  // Built here rather than taken as a prop: a `new Set()` default would be a new
  // object on every render and every memo below it would recompute.
  const attendedIds = useMemo(() => new Set(rows.map((r) => r.id).filter(Boolean)), [rows]);

  const { intent, loading: outcomesLoading } = useCallOutcomes();
  const { volunteers } = useVolunteers();
  const { volunteer, permissions } = useAuth();
  const { showToast } = useToast();

  const [batches, setBatches] = useState(null);   // null = still loading
  const [denied, setDenied] = useState(false);
  const [useUntagged, setUseUntagged] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [clearStatuses, setClearStatuses] = useState(true);
  const [closing, setClosing] = useState(false);
  const [progress, setProgress] = useState(null);

  // ── The round's batches ───────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    if (!event?.id) { setBatches(null); return undefined; }
    setBatches(null);
    setDenied(false);
    setUseUntagged(false);
    (async () => {
      try {
        const tagged = await getDocs(query(collection(db, 'batches'), where('eventId', '==', event.id)));
        if (cancelled) return;
        if (!tagged.empty) {
          setBatches(tagged.docs.map((d) => ({ id: d.id, ...d.data(), _tagged: true })));
          return;
        }
        // Nothing tagged. Read the collection once (~20 documents) so the panel
        // can offer the untagged batches instead of just going blank.
        const all = await getDocs(collection(db, 'batches'));
        if (cancelled) return;
        setBatches(all.docs
          .map((d) => ({ id: d.id, ...d.data(), _tagged: false }))
          .filter((b) => !b.eventId && b.assignedVolunteerId)
          .filter((b) => !event.mandal || !b.mandal || b.mandal === event.mandal));
      } catch (err) {
        // A bonus panel, never the page's reason to exist — but "you can't read
        // batches" and "no batches exist" must not print the same sentence.
        if (cancelled) return;
        setDenied(err?.code === 'permission-denied');
        setBatches([]);
      }
    })();
    return () => { cancelled = true; };
  }, [event?.id, event?.mandal]);

  const tagged = useMemo(() => (batches || []).filter((b) => b._tagged), [batches]);
  const untagged = useMemo(() => (batches || []).filter((b) => !b._tagged), [batches]);
  // Memoised so the classification below it is not rebuilt on every render.
  const active = useMemo(
    () => (tagged.length ? tagged : (useUntagged ? untagged : [])),
    [tagged, untagged, useUntagged],
  );

  // contactId → the karyekar who was asked to ring them. First batch wins, same
  // as the calling screen: a contact in two batches is called once.
  const volunteerByContact = useMemo(() => {
    const m = new Map();
    active.forEach((b) => {
      (b.individualIds || []).forEach((id) => { if (!m.has(id)) m.set(id, b.assignedVolunteerId || null); });
    });
    return m;
  }, [active]);

  const roundContacts = useMemo(() => {
    if (!volunteerByContact.size) return [];
    return individuals.filter((c) => c && volunteerByContact.has(c.id));
  }, [individuals, volunteerByContact]);

  const review = useMemo(() => (
    roundContacts.length
      ? classifyRound({ contacts: roundContacts, attendedIds, intent, eventId: event?.id })
      : null
  ), [roundContacts, attendedIds, intent, event?.id]);

  const summary = useMemo(() => (review ? summarizeRound(review) : null), [review]);

  /** Per-karyekar conversion, tallied off the same classification so the columns
   *  always add up to the panel above them. */
  const byVolunteer = useMemo(() => {
    if (!review) return [];
    const names = new Map(volunteers.map((v) => [v.id, v.name || v.mobile || 'Unnamed']));
    const rows = new Map();
    const bump = (id, field) => {
      const key = id || '_none';
      if (!rows.has(key)) {
        rows.set(key, { id: key, name: id ? (names.get(id) || 'Removed volunteer') : 'Not assigned', called: 0, promised: 0, kept: 0, attended: 0 });
      }
      rows.get(key)[field] += 1;
    };
    ROUND_GROUPS.forEach((g) => {
      (review.groups[g.key] || []).forEach((c) => {
        const vId = volunteerByContact.get(c.id);
        bump(vId, 'called');
        if (g.key === 'kept' || g.key === 'brokePromise') bump(vId, 'promised');
        if (g.key === 'kept' || g.key === 'cameAnyway') bump(vId, 'attended');
        if (g.key === 'kept') bump(vId, 'kept');
      });
    });
    return [...rows.values()]
      .map((r) => ({ ...r, pct: r.promised ? Math.round((r.kept / r.promised) * 100) : null }))
      .sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1) || b.called - a.called);
  }, [review, volunteerByContact, volunteers]);

  const registerEmpty = attendedIds.size === 0;
  // Every contact already carries a snapshot for THIS sabha, so the round is
  // closed. Re-running would overwrite it with the statuses that were just
  // blanked, which is why the button turns off rather than staying available.
  const alreadyClosed = Boolean(review && review.called > 0 && review.snapshotted === review.called);
  const canClose = permissions.includes('edit_contacts');

  async function handleClose() {
    setClosing(true);
    setProgress({ done: 0, total: roundContacts.length });
    try {
      const res = await closeRound({
        event,
        contacts: roundContacts,
        attendedIds,
        closedBy: volunteer?.id,
        clearStatuses,
        onProgress: setProgress,
      });
      showToast({
        type: 'success',
        message: `Round closed — ${res.closed} contact${res.closed === 1 ? '' : 's'} frozen `
          + `(${res.attended} came, ${res.absent} didn’t). Follow-up lists are live on every karyekar’s calling screen.`,
      });
      setConfirmOpen(false);
    } catch (err) {
      showToast({ type: 'error', message: describeRoundError(err) });
    } finally {
      setClosing(false);
      setProgress(null);
    }
  }

  // ── Nothing to review ─────────────────────────────────────────────────────
  if (batches === null || outcomesLoading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-slate-100 p-4 text-xs text-slate-400">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Looking for the calling round…
      </div>
    );
  }

  if (!tagged.length && !untagged.length) {
    return (
      <div className="rounded-xl border border-slate-100 p-4 sm:p-5">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          <Target className="h-3.5 w-3.5" /> Calling round
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
          {denied
            ? 'Your role can’t read the batches collection, so the calling round can’t be matched to this sabha. Ask an admin for the “View Batches” permission.'
            : (
              <>
                No batches are tagged to this sabha, so there is nothing to compare the attendance against. When you
                generate batches under <strong>Batches → Generate</strong>, pick the sabha in{' '}
                <em>“Calling for which sabha”</em> — after that this panel shows who promised to come and who actually
                did, and the karyekars get the follow-up lists automatically.
              </>
            )}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-100 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            <Target className="h-3.5 w-3.5" /> Did the calling work?
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            {active.length
              ? `${active.length} batch${active.length === 1 ? '' : 'es'} · ${roundContacts.length} contact${roundContacts.length === 1 ? '' : 's'} rung before this sabha`
              : 'Pick the batches to review below.'}
          </p>
        </div>
        {alreadyClosed && (
          <span className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700">
            <Lock className="h-3 w-3" /> Round closed — numbers are final
          </span>
        )}
      </div>

      {/* ── The untagged guess ───────────────────────────────────────────── */}
      {!tagged.length && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
          <p className="flex items-start gap-1.5 text-xs leading-relaxed text-amber-800">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              These batches were cut before sabhas could be tagged, so this is a best guess:{' '}
              <strong>{untagged.length} assigned batch{untagged.length === 1 ? '' : 'es'}</strong>
              {event?.mandal ? ` in ${event.mandal}` : ''}. Check they really were the calls for this sabha before you
              close the round.
            </span>
          </p>
          {!useUntagged && (
            <Button variant="secondary" size="sm" className="mt-2" onClick={() => setUseUntagged(true)}>
              <PhoneCall className="h-3.5 w-3.5" /> Review these batches
            </Button>
          )}
        </div>
      )}

      {registerEmpty && (
        <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-xs leading-relaxed text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Nobody is marked present for this sabha yet. Until attendance is in, every contact would read as absent —
            mark the register on the <strong>Attendance</strong> tab first.
          </span>
        </p>
      )}

      {/* ── Conversion ───────────────────────────────────────────────────── */}
      {review && summary && !registerEmpty && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <ConversionTile label="Rung" value={summary.called} sub="contacts in this round" />
            <ConversionTile label="Said yes" value={summary.promised} sub="promised to come" tone="emerald" />
            <ConversionTile
              label="Promise kept"
              value={summary.promiseKept === null ? '—' : `${summary.promiseKept}%`}
              sub={`${review.counts.kept} of ${summary.promised} came`}
              tone={summary.promiseKept !== null && summary.promiseKept >= 70 ? 'emerald' : 'rose'}
            />
            <ConversionTile
              label="Came anyway"
              value={review.counts.cameAnyway}
              sub="turned up without a yes"
              tone="violet"
            />
          </div>

          <ul className="mt-4 space-y-2">
            {ROUND_GROUPS.map((g) => (
              <GroupBar key={g.key} group={g} count={review.counts[g.key]} total={summary.called} />
            ))}
          </ul>

          {/* ── Per karyekar ──────────────────────────────────────────────── */}
          {byVolunteer.length > 1 && (
            <div className="mt-5">
              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <Users className="h-3.5 w-3.5" /> By karyekar
              </p>
              <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
                <table className="w-full min-w-[26rem] text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wider text-slate-400">
                      <th className="py-1.5 pr-2 font-semibold">Karyekar</th>
                      <th className="py-1.5 px-2 text-right font-semibold">Rung</th>
                      <th className="py-1.5 px-2 text-right font-semibold">Said yes</th>
                      <th className="py-1.5 px-2 text-right font-semibold">Came</th>
                      <th className="py-1.5 pl-2 text-right font-semibold">Kept</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byVolunteer.map((r) => (
                      <tr key={r.id} className="border-b border-slate-50 last:border-0">
                        <td className="max-w-[10rem] truncate py-1.5 pr-2 text-slate-700" title={r.name}>{r.name}</td>
                        <td className="py-1.5 px-2 text-right text-slate-500">{r.called}</td>
                        <td className="py-1.5 px-2 text-right text-slate-500">{r.promised}</td>
                        <td className="py-1.5 px-2 text-right text-slate-500">{r.attended}</td>
                        <td className={cn(
                          'py-1.5 pl-2 text-right font-semibold',
                          r.pct === null ? 'text-slate-300' : r.pct >= 70 ? 'text-emerald-600' : 'text-slate-700',
                        )}>
                          {r.pct === null ? '—' : `${r.pct}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-1.5 text-[11px] text-slate-400">
                “Kept” is of the people that karyekar got a yes from — the fair measure, since a list of contacts who
                never answer cannot be converted no matter who rings it.
              </p>
            </div>
          )}
        </>
      )}

      {/* ── Close the round ──────────────────────────────────────────────── */}
      {active.length > 0 && (
        <div className="mt-5 border-t border-slate-100 pt-4">
          {alreadyClosed ? (
            <p className="flex items-start gap-1.5 text-xs leading-relaxed text-slate-500">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
              <span>
                This round is frozen onto all {review.called} contacts, so the numbers above will not move again. The
                follow-up lists are on every karyekar’s calling screen and empty themselves as the calls get made.
              </span>
            </p>
          ) : (
            <RequirePermission
              permission="edit_contacts"
              fallback={<p className="text-xs text-slate-400">Closing a round edits every contact in it, so it needs the Edit Contacts permission.</p>}
            >
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="accent"
                  onClick={() => setConfirmOpen(true)}
                  disabled={registerEmpty || !roundContacts.length}
                >
                  <Lock className="h-4 w-4" /> Close round &amp; start follow-up
                </Button>
                <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-slate-400">
                  Freezes what each contact said and whether they came, then clears their outcome so next week&apos;s
                  calls start clean. Until you do, these numbers keep moving as karyekars log follow-up calls.
                </p>
              </div>
            </RequirePermission>
          )}
        </div>
      )}

      <Modal open={confirmOpen} onClose={() => !closing && setConfirmOpen(false)} title="Close this calling round?" size="md">
        <div className="space-y-3 text-sm text-slate-600">
          <p>
            <strong>{roundContacts.length}</strong> contact{roundContacts.length === 1 ? '' : 's'} rung for{' '}
            <strong>{event?.title || 'this sabha'}</strong>. For each one this saves what they said and whether they
            came, so the report above stops changing.
          </p>
          <ul className="space-y-1 rounded-lg border border-slate-100 bg-slate-50/60 p-3 text-xs">
            <li>🟢 {review?.counts.kept || 0} said yes and came</li>
            <li>🔴 {review?.counts.brokePromise || 0} said yes and didn’t — the karyekars get these as a call list</li>
            <li>🎉 {review?.counts.cameAnyway || 0} came without saying yes</li>
            <li>🟡 {review?.counts.unreached || 0} were never reached</li>
          </ul>
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-100 p-3">
            <input
              type="checkbox"
              checked={clearStatuses}
              onChange={(e) => setClearStatuses(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-orange-600 focus:ring-orange-500"
            />
            <span className="text-xs leading-relaxed text-slate-600">
              <strong className="text-slate-800">Clear the outcomes for next week</strong> — recommended. The frozen copy
              keeps the evidence, and the calling screen starts blank so a follow-up call is not confused with last
              week&apos;s invite. Untick to leave every status exactly as it is.
            </span>
          </label>
          <p className="text-[11px] leading-relaxed text-slate-400">
            This writes {roundContacts.length * 2} documents ({roundContacts.length} contact updates and the same number
            of audit rows). It cannot be undone from the app — the outcomes live on inside each contact&apos;s{' '}
            <em>lastRound</em> and in the audit trail.
          </p>
          {progress && (
            <div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-orange-500 transition-all"
                  style={{ width: `${Math.round((progress.done / Math.max(progress.total, 1)) * 100)}%` }}
                />
              </div>
              <p className="mt-1 text-[11px] text-slate-400">{progress.done} of {progress.total} closed…</p>
            </div>
          )}
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={closing}>Not yet</Button>
          <Button variant="accent" onClick={handleClose} disabled={closing || !canClose}>
            {closing ? <><Loader2 className="h-4 w-4 animate-spin" /> Closing…</> : <>Close the round</>}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
