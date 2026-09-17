// src/components/admin-tools/MergeDuplicatesPanel.jsx
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 41 — THE DUPLICATES TAB, REBUILT AROUND MERGE INSTEAD OF DELETE.
//
// What was here before listed everyone sharing a phone number and gave one
// button per row: "Delete this one". Two things were wrong with that, and the
// second is the one that cost real data:
//
//   1. A shared number is normally a FAMILY. Four people on one handset were
//      presented as four duplicates, so the screen read as "delete three of
//      these four people".
//   2. Even for a true duplicate, delete is the wrong verb. It throws away the
//      sabha attendance, the batch seat, the call count and the notes attached
//      to the copy being removed.
//
// So the screen now answers a different question. findLikelyDuplicates() splits
// the old single list into people who are probably the same human (name folded,
// compared, scored) and households that merely share a handset, and the primary
// action is a merge that carries the history across — see mergeService.js for
// what moves and why each thing moves the way it does.
//
// NOTHING HAPPENS WITHOUT A PREVIEW. Merge is irreversible: the duplicate
// document is deleted at the end of it. So "Review merge" runs the same queries
// the merge itself will run and reports exactly what will move — how many sabha
// marks, which batches, how many logins, which empty fields get filled and from
// where — before the button that does it appears. The preview costs a handful of
// reads; the merge it prevents costs a person's history.
//
// AND NOTHING IS PRE-SELECTED ABOVE ITS EVIDENCE. `possible` matches — a similar
// name on a different number — are collapsed behind a toggle, because a screen
// that opens with sixty speculative suggestions trains the operator to click
// through them.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  PartyPopper, Merge, Loader2, ShieldQuestion, Users, ChevronDown, ChevronRight, Phone,
} from 'lucide-react';
import { findLikelyDuplicates } from '../../services/integrityService';
import { mergeContacts, previewMerge, dismissDuplicatePair } from '../../services/mergeService';
import { useAuth } from '../../hooks/usePermissions';
import { useToast } from '../../contexts/ToastContext';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { cn } from '../../lib/cn';

const CONFIDENCE = {
  certain: { label: 'Almost certainly the same person', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  likely: { label: 'Likely the same person', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  possible: { label: 'Worth a look', cls: 'bg-slate-50 text-slate-600 border-slate-200' },
};

const FIELD_LABELS = {
  mobile: 'Mobile', area: 'Area', subArea: 'Sub-area', mandal: 'Mandal', address: 'Address',
  dob: 'Date of birth', anniversary: 'Anniversary', study: 'Study', standard: 'Standard',
  profession: 'Profession', skill: 'Skill', reference: 'Notes', callCount: 'Call count',
  hobby: 'Hobbies', householdId: 'Household', profilePhotoURL: 'Photo', status: 'Call outcome',
  samparkKaryakartaName: 'Sampark Karyakarta', samparkKaryakartaNumber: 'Karyakarta number',
};
const labelFor = (k) => FIELD_LABELS[k] || k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());

function summarise(v) {
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'string' && v.length > 60) return `${v.slice(0, 60)}…`;
  return String(v);
}

// Which record should survive by default. Completeness first — the fuller record
// is the one other people have been reading — then age, because the older id is
// the one more likely to be referenced from somewhere this merge cannot see.
// A record with a volunteer login attached always wins: that link is the single
// hardest thing to reconstruct by hand if the wrong one is kept.
function defaultPrimary(members) {
  const score = (m) => {
    let s = Object.entries(m).filter(([k, v]) => !k.startsWith('_') && v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)).length;
    if (m.volunteerId) s += 25;
    if (m.householdId) s += 3;
    if (m.profilePhotoURL) s += 2;
    return s;
  };
  return [...members].sort((a, b) => {
    const d = score(b) - score(a);
    if (d) return d;
    return (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0);
  })[0];
}

function MemberRow({ ind, isPrimary, onPick }) {
  const bits = [
    ind.mobile || 'no number',
    ind.mandal || 'no mandal',
    ind.area || 'no area',
    ind.callCount ? `${ind.callCount} call${ind.callCount === 1 ? '' : 's'}` : null,
    ind.volunteerId ? 'has a login' : null,
  ].filter(Boolean);
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 transition-colors',
        isPrimary ? 'border-emerald-300 bg-emerald-50/60' : 'border-slate-200 bg-white hover:border-slate-300',
      )}
    >
      <input type="radio" checked={isPrimary} onChange={onPick} className="mt-1 h-3.5 w-3.5 accent-emerald-600" />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-medium text-slate-900">{ind.name || 'Unnamed'}</span>
          <span className={cn('text-[11px] font-medium', isPrimary ? 'text-emerald-700' : 'text-slate-400')}>
            {isPrimary ? 'Keep this record' : 'Fold into the kept one'}
          </span>
        </span>
        <span className="mt-0.5 block text-xs text-slate-500">{bits.join(' · ')}</span>
      </span>
      <Link
        to={ind.householdId ? `/households/${ind.householdId}` : `/contacts/${ind.id}`}
        target="_blank"
        onClick={(e) => e.stopPropagation()}
        className="shrink-0 text-xs font-medium text-orange-600 hover:underline"
      >
        Open
      </Link>
    </label>
  );
}

function MergeGroupCard({ group, volunteerId }) {
  const { showToast } = useToast();
  const [primaryId, setPrimaryId] = useState(() => defaultPrimary(group.members).id);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(null);   // 'preview' | 'merge' | 'dismiss'

  const primary = group.members.find((m) => m.id === primaryId) || group.members[0];
  const losers = group.members.filter((m) => m.id !== primary.id);
  const meta = CONFIDENCE[group.confidence] || CONFIDENCE.possible;

  async function handlePreview() {
    setBusy('preview');
    try {
      setPreview(await previewMerge({ primary, duplicates: losers }));
    } catch (err) {
      showToast({ type: 'error', message: err?.message || "Couldn't read the history for these records." });
    } finally {
      setBusy(null);
    }
  }

  async function handleMerge() {
    setBusy('merge');
    try {
      const res = await mergeContacts({ primary, duplicates: losers, mergedBy: volunteerId });
      showToast({
        type: 'success',
        message: `Merged into ${primary.name}. ${res.attendanceMoved} sabha mark${res.attendanceMoved === 1 ? '' : 's'} carried over`
          + `${res.batchesUpdated ? `, ${res.batchesUpdated} batch${res.batchesUpdated === 1 ? '' : 'es'} updated` : ''}`
          + `${res.volunteerLinks ? `, ${res.volunteerLinks} login re-linked` : ''}.`,
      });
      // No local state to clear — useAllContacts is a live listener, so the
      // deleted records disappear and this whole card unmounts on its own.
    } catch (err) {
      showToast({
        type: 'error',
        message: err?.code === 'permission-denied'
          ? 'Your role can’t do this merge — it needs Edit Contacts and Delete Contacts, and both records must be inside your area/mandal.'
          : err?.message || 'The merge failed. Nothing was deleted — run the scan again to see how far it got.',
      });
    } finally {
      setBusy(null);
    }
  }

  async function handleDismiss() {
    setBusy('dismiss');
    try {
      // Every pair in the group, not just the ones touching the primary —
      // a partial dismissal leaves an edge behind and the group re-forms on the
      // next scan looking like the button did nothing.
      for (let i = 0; i < group.members.length; i += 1) {
        for (let j = i + 1; j < group.members.length; j += 1) {
          await dismissDuplicatePair(group.members[i], group.members[j]);
        }
      }
      showToast({ type: 'success', message: 'Marked as different people — they won’t be suggested again.' });
    } catch (err) {
      showToast({ type: 'error', message: err?.message || "Couldn't save that." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="p-4">
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <span className={cn('rounded-full border px-2 py-0.5 text-[11px] font-medium', meta.cls)}>{meta.label}</span>
        <span className="text-xs text-slate-400">{group.reason}</span>
      </div>

      <div className="space-y-1.5">
        {group.members.map((m) => (
          <MemberRow
            key={m.id}
            ind={m}
            isPrimary={m.id === primary.id}
            onPick={() => { setPrimaryId(m.id); setPreview(null); }}
          />
        ))}
      </div>

      {/* ── The preview. Same queries as the merge, so the numbers are the ones
             that will actually happen, not an estimate. ───────────────────── */}
      {preview && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-xs">
          <p className="font-medium text-slate-800">
            Merging {losers.length} record{losers.length === 1 ? '' : 's'} into {primary.name}:
          </p>
          <ul className="mt-1.5 space-y-1 text-slate-600">
            <li>
              <strong className="tabular-nums">{preview.attendanceMoved}</strong> sabha attendance mark
              {preview.attendanceMoved === 1 ? '' : 's'} moved onto the kept record
              {preview.attendanceAlreadyHeld > 0 && (
                <span className="text-slate-400">
                  {' '}({preview.attendanceAlreadyHeld} already recorded on it — left as they are)
                </span>
              )}
            </li>
            <li>
              {preview.batches.length === 0
                ? 'Not in any calling batch'
                : <>In <strong>{preview.batches.length}</strong> batch{preview.batches.length === 1 ? '' : 'es'} — the kept record takes the seat: <span className="text-slate-500">{preview.batches.map((b) => b.name).join(', ')}</span></>}
            </li>
            {preview.volunteerLinks > 0 && (
              <li>
                <strong>{preview.volunteerLinks}</strong> volunteer login re-pointed at the kept record
              </li>
            )}
            {preview.filled.length > 0 ? (
              <li>
                Empty fields filled in from the duplicate:{' '}
                {preview.filled.map((f) => (
                  <span key={f.field} className="mr-1.5 inline-block rounded bg-white px-1.5 py-0.5 text-[11px] text-slate-600 ring-1 ring-slate-200">
                    {labelFor(f.field)}: {summarise(f.value)}
                  </span>
                ))}
              </li>
            ) : (
              <li className="text-slate-400">No empty fields to fill — the kept record already has everything.</li>
            )}
          </ul>
          <p className="mt-2 border-t border-slate-200 pt-2 text-[11px] text-slate-400">
            About {preview.writes} writes. The duplicate record is deleted at the end — this cannot be undone.
            The audit trail keeps its old rows and the kept record remembers what it was merged from.
          </p>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {!preview ? (
          <Button variant="accent" size="sm" onClick={handlePreview} disabled={busy !== null}>
            {busy === 'preview'
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking…</>
              : <><Merge className="h-3.5 w-3.5" /> Review merge</>}
          </Button>
        ) : (
          <>
            <Button variant="accent" size="sm" onClick={handleMerge} disabled={busy !== null}>
              {busy === 'merge'
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Merging…</>
                : <>Merge into {primary.name}</>}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setPreview(null)} disabled={busy !== null}>Cancel</Button>
          </>
        )}
        <Button variant="secondary" size="sm" onClick={handleDismiss} disabled={busy !== null} className="ml-auto">
          {busy === 'dismiss' ? 'Saving…' : 'Not duplicates'}
        </Button>
      </div>
    </Card>
  );
}

export default function MergeDuplicatesPanel({ contacts }) {
  const { volunteer } = useAuth();
  const [showPossible, setShowPossible] = useState(false);
  const [showFamilies, setShowFamilies] = useState(false);

  const { groups, families } = useMemo(() => findLikelyDuplicates(contacts), [contacts]);

  const strong = groups.filter((g) => g.confidence !== 'possible');
  const weak = groups.filter((g) => g.confidence === 'possible');
  const shown = showPossible ? [...strong, ...weak] : strong;

  return (
    <div className="space-y-3">
      {shown.length === 0 && strong.length === 0 && (
        <p className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-slate-200 py-10 text-sm text-slate-400">
          <PartyPopper className="h-4 w-4" /> No duplicate records found.
        </p>
      )}

      {shown.map((g) => <MergeGroupCard key={g.id} group={g} volunteerId={volunteer?.id} />)}

      {/* ── Suggestions that need a human eye, kept out of the way until asked
             for. Opening a screen with sixty maybes is how a screen stops being
             read. ──────────────────────────────────────────────────────────── */}
      {weak.length > 0 && !showPossible && (
        <button
          onClick={() => setShowPossible(true)}
          className="flex w-full items-center gap-2 rounded-lg border border-dashed border-slate-200 px-3 py-2.5 text-left text-xs text-slate-500 hover:border-slate-300 hover:text-slate-700"
        >
          <ShieldQuestion className="h-4 w-4 shrink-0 text-slate-400" />
          <span>
            <strong>{weak.length}</strong> more with similar names on different numbers.
            Usually different people — check before merging.
          </span>
          <ChevronRight className="ml-auto h-4 w-4 shrink-0" />
        </button>
      )}

      {/* ── Families. Listed, never actionable: nothing here is a fault. ───── */}
      {families.length > 0 && (
        <div className="rounded-lg border border-slate-200">
          <button
            onClick={() => setShowFamilies((v) => !v)}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs text-slate-500 hover:text-slate-700"
          >
            <Users className="h-4 w-4 shrink-0 text-slate-400" />
            <span>
              <strong>{families.length}</strong> phone number{families.length === 1 ? '' : 's'} shared by
              several people with different names — families on one handset, not duplicates.
            </span>
            {showFamilies ? <ChevronDown className="ml-auto h-4 w-4 shrink-0" /> : <ChevronRight className="ml-auto h-4 w-4 shrink-0" />}
          </button>
          {showFamilies && (
            <div className="space-y-2 border-t border-slate-100 p-3">
              <p className="text-[11px] leading-snug text-slate-400">
                Nothing to fix here — it is listed so a number typed into the wrong record is easy to
                spot. Every one of these people is called separately; only the handset is shared.
              </p>
              {families.slice(0, 40).map((f) => (
                <div key={f.phone} className="rounded-lg bg-slate-50 px-3 py-2">
                  <p className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
                    <Phone className="h-3 w-3" /> {f.phone}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-700">
                    {f.group.map((m) => m.name || 'Unnamed').join(' · ')}
                  </p>
                </div>
              ))}
              {families.length > 40 && (
                <p className="text-xs text-slate-400">+{families.length - 40} more…</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
