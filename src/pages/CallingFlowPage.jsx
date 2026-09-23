// src/pages/CallingFlowPage.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Phase 20 — rebuilt mobile-first.
//
// What was wrong with the previous version on a phone (verified at 375x667):
//   • `max-w-md px-6 py-6` in normal document flow meant the primary actions
//     (Call / WhatsApp / Save & Next) sat ~700px down the page. Every contact
//     required scrolling down to act, then scrolling back up to read the name.
//   • Seven variable-width status pills wrapped into four ragged rows with
//     ~30px tap targets, placing "Interested" next to "Not Interested".
//   • The WhatsApp link opened an empty chat — no prefilled message.
//   • No way to go back one contact after a mis-tap; `next()` was one-way.
//   • Tapping Call recorded nothing, so callCount never moved (the same bug the
//     legacy app has, where two rival updateContact() definitions mean the
//     Call_Count column either increments or is lock-protected, never both).
//
// The new shape is a three-band app screen, not a document:
//   [ sticky header ]  progress + prev + search + follow-up filters
//   [ scroll body   ]  contact card, status grid, note
//   [ sticky footer ]  Call | WhatsApp  /  Skip | Save & Next   ← thumb zone
//
// 100dvh (not 100vh) so mobile browser chrome collapsing doesn't clip the
// footer, and the footer carries safe-area padding for notched devices.
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 27 — the band under the header. Once the sabha a batch was calling for
// has its register marked, the same 40 contacts split into "came as promised",
// "said yes but didn't come" and "came anyway", and three of those become
// walkable queues on the machinery the two follow-up chips already use. See
// src/services/roundService.js for why the join needed two new fields.
//
// PHASE 29 — undoing a mis-tap. StatusChips already let you untick the outcome
// you had selected, but nothing could write that untick back: handleSaveAndNext
// refused an empty status, so once "Not Interested" was saved it was saved for
// good — the contact stayed in the done count, in the dashboard's called total,
// and out of the generator's reach. Two ways out now, deliberately different:
//   • "Undo" on the last-status box clears the outcome and STAYS on the contact,
//     because the volunteer who mis-tapped almost always wants to mark the right
//     one immediately.
//   • unticking the chips turns Save & Next into Clear & Next, which clears and
//     moves on, for the volunteer who realises the whole entry was wrong.
// The call count gets the same treatment: one stray tap on Call used to be
// permanent. Both are two-tap, because a one-tap undo next to a real outcome on a
// phone is just a second way to lose it.
// PHASE 39 — two views of one queue. See src/components/calling/BatchContactList.
// The card is for calling; the list is for everything a karyakarta needs to know
// AROUND the calling ("how many left?", "who in this mandal?", "did I mark that
// one wrong?"). Both read the same in-memory `contacts`, so the toggle costs
// nothing — no route, no listener, no read.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Phone, MessageCircle, MapPin, FileText, Search, X, ChevronLeft,
  Repeat, PhoneOff, Home, History, Check, SkipForward, Pencil, ExternalLink,
  CalendarCheck, Clock, Undo2, RotateCcw, AlertCircle, List,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useMyBatchQueue } from '../hooks/useMyBatchQueue';
import { useRoundReview } from '../hooks/useRoundReview';
import { useAuth } from '../hooks/usePermissions';
import { useToast } from '../contexts/ToastContext';
import { useSettings } from '../hooks/useSettings';
import { useCallOutcomes } from '../hooks/useCallOutcomes';
import { updateContactField, incrementCallCount, saveContact } from '../services/contactService';
import {
  ROUND_GROUPS, ROUND_GROUP_MAP, ROUND_TONE_CLASSES, shortEventDate,
} from '../services/roundService';
import { buildWhatsAppUrl, buildTelUrl, normalizePhone } from '../lib/whatsapp';
import StatusChips from '../components/calling/StatusChips';
import BatchContactList from '../components/calling/BatchContactList';
import AttendanceHistoryPanel from '../components/events/AttendanceHistoryPanel';
import IndividualForm from '../components/individuals/IndividualForm';
import RequirePermission from '../components/RequirePermission';
import Modal from '../components/ui/Modal';
import { Avatar } from '../components/ui/Avatar';
import { Textarea } from '../components/ui/Input';
import { cn } from '../lib/cn';

export default function CallingFlowPage() {
  const { volunteer } = useAuth();
  const { showToast } = useToast();
  const { contacts, current, currentIdx, next, jumpTo, isDone, resumed, loading, batches, error } = useMyBatchQueue();
  const { settings: templateSettings } = useSettings('messageTemplate');
  // Live outcome vocabulary — an admin renaming or adding an outcome under
  // Admin Tools → Call Outcomes must reach this screen without a redeploy.
  const { outcomes, followUpGroups, colorClasses: statusColorClasses, emoji, label: statusLabel } = useCallOutcomes();
  // What happened at the sabha these contacts were called for. Costs one read
  // for the event plus one register listener, and only after the sabha is over.
  const round = useRoundReview({ batches, contacts });

  const [status, setStatus] = useState('');
  const [reference, setReference] = useState('');
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  // PHASE 39 — 'card' (call one person) or 'list' (see the whole batch). Held in
  // component state rather than the URL or localStorage on purpose: the card is
  // where the work happens, so every fresh open should land there and the list
  // should be a deliberate glance, not a mode you can get stuck in.
  const [viewMode, setViewMode] = useState('card');
  const [followUpFilter, setFollowUpFilter] = useState(null);
  // Kept separate from followUpFilter rather than folded into it: one is a set of
  // status strings, the other a set of contact ids, and only one can be on.
  const [roundFilter, setRoundFilter] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  // Two-tap arming for the two undo actions. Kept as separate flags rather than
  // one "armed" string so arming the outcome undo can never fire the call-count
  // one, and both are cleared the moment the contact changes.
  const [armClear, setArmClear] = useState(false);
  const [armCall, setArmCall] = useState(false);
  const [undoing, setUndoing] = useState(false);
  // Say once, quietly, that the screen did not start at contact #1. Without it the
  // first reaction to landing on name 37 is "where did the first 36 go?".
  const [resumeNote, setResumeNote] = useState(true);
  const bodyRef = useRef(null);

  useEffect(() => {
    setStatus(current?.status || '');
    setReference(current?.reference || '');
    setArmClear(false);
    setArmCall(false);
    // Advancing to a new contact must reset the scroll position, otherwise the
    // volunteer lands mid-card on the note field of the previous person.
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [current?.id]);

  // The whole assignment, regardless of any filter. Only two things care: the
  // "no batch assigned" empty state and the end-of-batch congratulations.
  const batchTotal = contacts.length;

  // The outcome as Firestore currently holds it, versus what the chips show. When
  // the second is empty and the first is not, the volunteer has unticked a saved
  // outcome — which is a clear, not a no-op, and the footer says so.
  const savedStatus = current?.status || '';
  const isClearing = Boolean(savedStatus) && !status;
  const canSubmit = Boolean(status) || isClearing;

  const followUpCounts = useMemo(() => ({
    callBack: contacts.filter((c) => followUpGroups.callBack.includes(c.status)).length,
    noAnswer: contacts.filter((c) => followUpGroups.noAnswer.includes(c.status)).length,
  }), [contacts, followUpGroups]);

  const doneCount = useMemo(() => contacts.filter((c) => c.status).length, [contacts]);

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return contacts
      .map((c, idx) => ({ ...c, _idx: idx }))
      .filter((c) => c.name?.toLowerCase().includes(q) || (c.mobile || '').includes(q))
      .slice(0, 8);
  }, [search, contacts]);

  const telUrl = current ? buildTelUrl(current.mobile) : null;
  const waUrl = current
    ? buildWhatsAppUrl({
        mobile: current.mobile,
        template: templateSettings?.whatsappTemplate,
        contact: current,
        extra: { volunteerName: volunteer?.name },
      })
    : null;

  /**
   * PHASE 27 — this contact's verdict from the sabha just gone, if there is one.
   *
   * The genuinely new fact is the CROSS of the two things the app already knew:
   * what they promised on the phone and whether the seat was filled. Neither
   * alone tells the karyekar what to open the call with; together they do, which
   * is why this sits directly above the outcome buttons rather than with the
   * identity chips.
   */
  const roundRow = useMemo(() => {
    if (!round.ready || !current) return null;
    for (const g of ROUND_GROUPS) {
      const hit = (round.groups?.[g.key] || []).find((c) => c.id === current.id);
      if (hit) return { ...hit, group: g };
    }
    return null;
  }, [round.ready, round.groups, current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * PHASE 46 — the same verdict as roundRow, but for EVERY contact, keyed by id,
   * so the LIST view can show who came and who said yes and didn't right next to
   * each name — the "status list of who was present, and who said I will come but
   * didn't" a karyekar wants after the sabha.
   *
   * Built from round.groups (the full classification), NOT round.pending (the
   * shrinking work list), so it reflects who actually attended rather than who is
   * left to call back. Only once the register is marked (round.ready): before
   * that every row would merely echo its call outcome, which is a different fact
   * and already on the card. Free — it re-reads the in-memory groups, no query.
   */
  const roundById = useMemo(() => {
    if (!round.ready || !round.groups) return null;
    const m = new Map();
    for (const g of ROUND_GROUPS) {
      const chip = (ROUND_TONE_CLASSES[g.tone] || ROUND_TONE_CLASSES.slate).chip;
      for (const c of round.groups[g.key] || []) {
        m.set(c.id, { emoji: g.emoji, short: g.short, chip, attended: c._attended });
      }
    }
    return m;
  }, [round.ready, round.groups]);

  /**
   * The queue currently being walked, whichever kind it is.
   *
   * Both filters resolve down to a set of contact ids so goToNext() has one code
   * path. The status queues are recomputed from live status on every render, so
   * they still shrink as outcomes are saved; the round queues come out of
   * useRoundReview already narrowed to the contacts that still need a call.
   */
  const activeQueue = useMemo(() => {
    if (roundFilter) {
      const rows = round.pending?.[roundFilter] || [];
      return {
        kind: 'round',
        ids: new Set(rows.map((c) => c.id)),
        label: ROUND_GROUP_MAP[roundFilter]?.short || 'this list',
      };
    }
    if (followUpFilter) {
      const statuses = followUpGroups[followUpFilter] || [];
      return {
        kind: 'followUp',
        ids: new Set(contacts.filter((c) => statuses.includes(c.status)).map((c) => c.id)),
        label: followUpFilter === 'callBack' ? 'Call Back' : 'No Answer',
      };
    }
    return null;
  }, [roundFilter, followUpFilter, round.pending, followUpGroups, contacts]);

  /**
   * PHASE 38 — the filtered list, and the counters that must agree with it.
   *
   * `currentIdx` stays an index into the FULL contacts array: search jumps carry
   * full-array indices and the saved resume cursor is resolved against it too.
   * Everything the volunteer reads is derived from the queue instead, because a
   * filter that says "Call Back" while the header still counts to 84 is the bug
   * being fixed — with a 40–100 name batch you cannot hold "which of these is
   * still mine" in your head.
   */
  const queueContacts = useMemo(
    () => (activeQueue ? contacts.filter((c) => activeQueue.ids.has(c.id)) : contacts),
    [contacts, activeQueue],
  );

  const total = queueContacts.length;

  const position = useMemo(() => {
    if (!activeQueue) return Math.min(currentIdx + 1, total);
    let seen = 0;
    for (let i = 0; i <= currentIdx && i < contacts.length; i += 1) {
      if (activeQueue.ids.has(contacts[i].id)) seen += 1;
    }
    // The current contact drops out of the set the instant its outcome saves, so
    // `seen` can come back one short. Either way this is which stop of the
    // filtered walk we are on, which is all the header claims.
    return Math.min(Math.max(seen, 1), Math.max(total, 1));
  }, [activeQueue, contacts, currentIdx, total]);

  const progressPct = total ? Math.round(((isDone ? total : position - 1) / total) * 100) : 0;

  // The list view measures the batch, not the walk: there is no "current" row to
  // be N-th of, and "31 of 84 done" is the number a karyakarta splitting the
  // calling across a morning and an evening actually wants.
  const donePct = batchTotal ? Math.round((doneCount / batchTotal) * 100) : 0;

  /**
   * The nearest EARLIER contact still inside the queue, or null when there is
   * none — which doubles as the Back button's disabled state. Back used to step
   * to `contacts[currentIdx - 1]` unconditionally, so it escaped an active filter
   * one name at a time while the chip still claimed to be on.
   */
  const prevIdx = useMemo(() => {
    for (let i = Math.min(currentIdx, contacts.length) - 1; i >= 0; i -= 1) {
      if (!activeQueue || activeQueue.ids.has(contacts[i].id)) return i;
    }
    return null;
  }, [activeQueue, contacts, currentIdx]);

  function clearQueue() {
    setFollowUpFilter(null);
    setRoundFilter(null);
  }

  function enterFollowUpMode(group) {
    const statuses = followUpGroups[group];
    const idx = contacts.findIndex((c) => statuses.includes(c.status));
    if (idx === -1) { showToast({ type: 'info', message: 'Nothing in this follow-up queue right now.' }); return; }
    setRoundFilter(null);
    setFollowUpFilter(group);
    jumpTo(idx);
  }

  /** PHASE 27 — walk one of the after-the-sabha groups. */
  function enterRoundQueue(key) {
    const ids = new Set((round.pending?.[key] || []).map((c) => c.id));
    const idx = contacts.findIndex((c) => ids.has(c.id));
    if (idx === -1) {
      showToast({ type: 'info', message: 'Everyone in this list has already been called back.' });
      return;
    }
    setFollowUpFilter(null);
    setRoundFilter(key);
    jumpTo(idx);
  }

  function goToNext() {
    setResumeNote(false);
    if (activeQueue) {
      const nextIdx = contacts.findIndex((c, idx) => idx > currentIdx && activeQueue.ids.has(c.id));
      if (nextIdx === -1) {
        showToast({ type: 'success', message: `${activeQueue.label} — all done!` });
        clearQueue();
        next();
        return;
      }
      jumpTo(nextIdx);
      return;
    }
    next();
  }

  function goToPrev() {
    setResumeNote(false);
    if (prevIdx !== null) jumpTo(prevIdx);
  }

  async function handleSaveAndNext() {
    if (!current) return;
    // An empty selection is only meaningful when there IS a saved outcome to
    // clear. With nothing saved it is just an unanswered question.
    if (!status && !savedStatus) { showToast({ type: 'error', message: 'Please select a status first.' }); return; }
    setSaving(true);
    try {
      await updateContactField({
        individualId: current.id, field: 'status', value: status,
        volunteerId: volunteer?.id,
        action: status ? 'status_changed' : 'status_reset',
        details: status ? `Status set to ${status}` : `Cleared “${savedStatus}” — marked by mistake`,
      });
      if (reference.trim() !== (current.reference || '')) {
        await updateContactField({
          individualId: current.id, field: 'reference', value: reference.trim(),
          volunteerId: volunteer?.id, action: 'reference_updated', details: reference.trim(),
        });
      }
      showToast({
        type: 'success',
        message: status ? `Saved: ${status}` : 'Outcome cleared — this contact is open again.',
      });
      goToNext();
    } catch (err) {
      showToast({ type: 'error', message: `Couldn't save — ${err.message}` });
      // Deliberately do NOT advance on failure. The previous version advanced
      // regardless with a message claiming it would "retry automatically once
      // you're back online" — there is no retry queue, so that silently lost
      // the entry and moved on.
    } finally {
      setSaving(false);
    }
  }

  /**
   * PHASE 29 — clear the saved outcome and stay put.
   *
   * The note is left alone on purpose. Whoever taps this is fixing the wrong
   * button, not retracting what they were told, and "said he'd come after exams"
   * is worth more than the outcome that was mistyped over it.
   */
  async function handleUndoOutcome() {
    if (!current || undoing) return;
    if (!armClear) { setArmClear(true); return; }
    setUndoing(true);
    try {
      await updateContactField({
        individualId: current.id, field: 'status', value: '',
        volunteerId: volunteer?.id, action: 'status_reset',
        details: `Cleared “${savedStatus}” — marked by mistake`,
      });
      setStatus('');
      showToast({ type: 'success', message: 'Outcome cleared. Mark the right one below.' });
    } catch (err) {
      showToast({ type: 'error', message: `Couldn’t clear it — ${err.message}` });
    } finally {
      setUndoing(false);
      setArmClear(false);
    }
  }

  /** One stray tap on Call used to be permanent. The logged call itself stays in
   *  the audit trail; this only corrects the counter on the contact. */
  async function handleUndoCall() {
    if (!current || undoing) return;
    if (!armCall) { setArmCall(true); return; }
    const next = Math.max(0, (current.callCount || 0) - 1);
    setUndoing(true);
    try {
      await updateContactField({
        individualId: current.id, field: 'callCount', value: next,
        volunteerId: volunteer?.id, action: 'call_count_corrected',
        details: `Call count corrected from ${current.callCount || 0} to ${next}`,
      });
      showToast({ type: 'success', message: next ? `Call count is now ${next}.` : 'Call count cleared.' });
    } catch (err) {
      showToast({ type: 'error', message: `Couldn’t correct it — ${err.message}` });
    } finally {
      setUndoing(false);
      setArmCall(false);
    }
  }

  // Fired on the Call tap. Does not await and does not block the tel: navigation
  // — a failed count must never stop the volunteer from placing the call.
  //
  // Takes the contact explicitly so the list view's per-row Call button goes down
  // this same path: a bare tel: link there would place real calls that never
  // reached callCount or the activity trail, and the karyakarta who preferred the
  // list would have looked idle in every report.
  function handleCallTap(contact) {
    const target = contact || current;
    if (!target) return;
    incrementCallCount({
      individualId: target.id,
      currentCount: target.callCount,
      volunteerId: volunteer?.id,
    }).catch(() => {});
  }

  // Correcting a wrong number or a misspelled name is the single most common
  // thing a karyekar needs mid-call, and sending them to the Contacts screen for
  // it loses their place in the queue. useMyBatchQueue subscribes per-document,
  // so the card re-renders with the new values as soon as this commits.
  async function handleEditSave(payload) {
    const ok = await saveContact({ individualId: current.id, data: payload, volunteerId: volunteer?.id });
    showToast(ok
      ? { type: 'success', message: 'Contact updated.' }
      : { type: 'error', message: 'Couldn’t save changes. Check your permissions.' });
    return ok;
  }

  // ── Loading / empty ────────────────────────────────────────────────────────
  if (loading) {
    return <div className="px-6 py-16 text-center text-sm text-slate-400">Loading your batch…</div>;
  }

  // A denied read is NOT the same as an empty queue. Surfacing it means an
  // assigned volunteer who still sees nothing knows it is a permission problem,
  // not a missing assignment — the reason "My Calling" looked empty for some
  // roles. (Usual cause: a role with edit_contacts but no view_* permission;
  // canReadBatches now also accepts edit_contacts once the rules are deployed.)
  //
  // PHASE 39 — but only when there is nothing to show. useMyBatchQueue sets this
  // for a denied read on ANY single contact document as well as on the batch query,
  // so one unreadable contact out of forty used to replace the entire calling
  // screen with this page and end the karyakarta's evening. If the queue has names
  // in it, they get the queue and a banner (below) instead.
  if (error && batchTotal === 0) {
    return (
      <div className="mx-auto max-w-md px-6 py-16 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100">
          <Phone className="h-6 w-6 text-amber-600" />
        </div>
        <p className="font-medium text-slate-700">Couldn’t load your batch</p>
        <p className="mt-1 text-sm text-slate-400">
          Your role may be missing a read permission, so the batch assigned to you can’t be shown.
          Ask an admin to check your role on the Roles screen.
        </p>
      </div>
    );
  }

  if (batchTotal === 0) {
    return (
      <div className="mx-auto max-w-md px-6 py-16 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100">
          <Phone className="h-6 w-6 text-slate-400" />
        </div>
        <p className="font-medium text-slate-700">No batch assigned to you yet</p>
        <p className="mt-1 text-sm text-slate-400">
          Ask an admin to assign you a batch from the Batches screen. It will appear here automatically.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-lg flex-col bg-white md:min-h-0 md:py-6">
      {/* ── Sticky header ────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 shrink-0 border-b border-slate-100 bg-white/95 backdrop-blur">
        <div className="flex items-center gap-2 px-3 pt-2.5">
          {/* Back steps the card cursor, which in list view only nudges the "here"
              marker — a control that appears to do nothing. Rows are the way to
              move there, so this stands down. */}
          {viewMode === 'card' && (
            <button
              onClick={goToPrev}
              disabled={prevIdx === null}
              aria-label="Previous contact"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 disabled:opacity-30 enabled:hover:bg-slate-100 enabled:hover:text-slate-600"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-[13px] font-semibold text-slate-900">
                {viewMode === 'list'
                  ? `${doneCount} of ${batchTotal} done`
                  : isDone ? 'Complete' : `${position} of ${total}`}
              </p>
              {/* With a filter on, the batch-wide done count would contradict the
                  count beside it. Name the list being walked instead — that is the
                  question "3 of 12" leaves open. */}
              <p className="min-w-0 truncate text-[11px] text-slate-400">
                {activeQueue ? activeQueue.label : viewMode === 'list' ? 'Your list' : `${doneCount} done`}
              </p>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-orange-500 transition-all"
                style={{ width: `${viewMode === 'list' ? donePct : progressPct}%` }}
              />
            </div>
          </div>

          {/* PHASE 39 — the whole batch, or the one contact. Same data either way. */}
          <button
            onClick={() => setViewMode((m) => (m === 'list' ? 'card' : 'list'))}
            aria-pressed={viewMode === 'list'}
            aria-label={viewMode === 'list' ? 'Back to calling' : 'See my whole list'}
            title={viewMode === 'list' ? 'Back to calling' : 'See my whole list'}
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
              viewMode === 'list'
                ? 'bg-orange-100 text-orange-700'
                : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600',
            )}
          >
            <List className="h-5 w-5" />
          </button>

          <button
            onClick={() => { setSearchOpen((o) => !o); if (searchOpen) setSearch(''); }}
            aria-label={searchOpen ? 'Close search' : 'Search your list'}
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
              searchOpen ? 'bg-slate-100 text-slate-700' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600',
            )}
          >
            {searchOpen ? <X className="h-5 w-5" /> : <Search className="h-5 w-5" />}
          </button>
        </div>

        {searchOpen && (
          <div className="px-3 pt-2">
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name or mobile…"
              inputMode="search"
              className="h-11 w-full rounded-lg border border-slate-200 px-3 text-[15px] outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
            />
            {searchResults.length > 0 && (
              <div className="mt-1 max-h-56 overflow-y-auto rounded-lg border border-slate-100 shadow-sm">
                {searchResults.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => { jumpTo(c._idx); setSearch(''); setSearchOpen(false); clearQueue(); }}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-slate-50"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-800">{c.name}</span>
                    <span className="text-xs text-slate-400">{c.mobile}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* PHASE 39 — a partial read, said out loud rather than hidden. Some of the
            batch is here and callable; a name that could not be read is simply not
            in the list, and without this line its absence is indistinguishable from
            never having been assigned. */}
        {error && (
          <div className="flex items-start gap-1.5 border-t border-amber-100 bg-amber-50/70 px-3 py-1.5 text-[11px] text-amber-800">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1">
              Some contacts in your batch couldn’t be loaded and are not shown below. Everything
              here is safe to call — tell an admin so they can check your role.
            </span>
          </div>
        )}

        {/* Resumed, not restarted. Dismissible, and gone the moment they move.
            PHASE 39 — now it also says how far in they are and offers the list,
            because the volunteer who calls ten in the morning and the rest at night
            comes back asking "how many did I do?", not "where is the cursor?". */}
        {resumed && resumeNote && !isDone && (
          <div className="flex items-center gap-1.5 border-t border-amber-100 bg-amber-50/70 px-3 py-1.5 text-[11px] text-amber-800">
            <RotateCcw className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              Picked up where you left off — {doneCount} of {batchTotal} done.
            </span>
            <button
              onClick={() => { setViewMode('list'); setResumeNote(false); }}
              className="shrink-0 rounded px-1.5 py-0.5 font-semibold underline decoration-amber-300 underline-offset-2 hover:bg-amber-100"
            >
              See all
            </button>
            <button
              onClick={() => setResumeNote(false)}
              aria-label="Dismiss"
              className="shrink-0 rounded p-0.5 hover:bg-amber-100"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        {/* Follow-up filters — horizontally scrollable so they never wrap */}
        <div className="flex gap-2 overflow-x-auto px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <FollowUpChip
            active={followUpFilter === 'callBack'}
            icon={Repeat}
            label="Call Back"
            count={followUpCounts.callBack}
            activeClass="border-amber-300 bg-amber-50 text-amber-700"
            onClick={() => (followUpFilter === 'callBack' ? setFollowUpFilter(null) : enterFollowUpMode('callBack'))}
          />
          <FollowUpChip
            active={followUpFilter === 'noAnswer'}
            icon={PhoneOff}
            label="No Answer"
            count={followUpCounts.noAnswer}
            activeClass="border-sky-300 bg-sky-50 text-sky-700"
            onClick={() => (followUpFilter === 'noAnswer' ? setFollowUpFilter(null) : enterFollowUpMode('noAnswer'))}
          />
          {activeQueue && (
            <button
              onClick={clearQueue}
              className="flex h-9 shrink-0 items-center gap-1 rounded-full border border-slate-200 px-3 text-xs font-medium text-slate-500"
            >
              <X className="h-3.5 w-3.5" /> Clear
            </button>
          )}
        </div>

        {/* ── After the sabha ────────────────────────────────────────────────
            Only appears once the register for the sabha these contacts were
            called for has actually been marked. `round.ready` is false while it
            is empty, and that guard is load-bearing: an unmarked sabha and a
            sabha nobody attended look identical in the data, and showing the
            groups anyway would tell this volunteer that all 38 of their
            contacts skipped it. */}
        {round.ready && round.summary && (
          <div className="border-t border-slate-100 bg-slate-50/70 px-3 py-2">
            <div className="flex items-baseline justify-between gap-2">
              <p className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <CalendarCheck className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                <span className="truncate">
                  After {round.event?.title || 'the sabha'}
                  {round.event?.date ? ` · ${shortEventDate(round.event.date)}` : ''}
                </span>
              </p>
              <p className="shrink-0 text-[11px] tabular-nums text-slate-400">
                {round.summary.attended}/{round.summary.called} came
              </p>
            </div>

            <div className="mt-1.5 flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {ROUND_GROUPS.map((g) => {
                const total = round.counts?.[g.key] || 0;
                if (!total) return null;
                const left = round.pendingCounts?.[g.key] ?? total;
                const tone = ROUND_TONE_CLASSES[g.tone] || ROUND_TONE_CLASSES.slate;
                const on = roundFilter === g.key;
                // The two non-queue groups are counts, not work: eighteen
                // thank-you calls would eat the evening that belongs to the six
                // who said yes and did not come.
                if (!g.queue) {
                  return (
                    <span
                      key={g.key}
                      title={g.hint}
                      className={cn('flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium', tone.chip)}
                    >
                      <span className={cn('h-1.5 w-1.5 rounded-full', tone.dot)} />
                      {g.short}
                      <span className="text-[11px] font-semibold tabular-nums opacity-70">{total}</span>
                    </span>
                  );
                }
                return (
                  <button
                    key={g.key}
                    onClick={() => (on ? clearQueue() : enterRoundQueue(g.key))}
                    aria-pressed={on}
                    title={g.hint}
                    className={cn(
                      'flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition',
                      on ? tone.active : tone.chip,
                      left === 0 && !on && 'opacity-55',
                    )}
                  >
                    <span className={cn('h-1.5 w-1.5 rounded-full', tone.dot)} />
                    {g.short}
                    <span className="rounded-full bg-white/70 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">
                      {/* "2 of 6" once some have been called back; a bare count
                          before that, so the common case stays quiet. */}
                      {left === total ? total : `${left}/${total}`}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* The sabha is over but nobody has marked the register — say so, rather
            than showing nothing and leaving the volunteer to wonder. */}
        {!round.ready && round.eventOver && round.event && round.attendanceLoaded && (
          <div className="flex items-center gap-1.5 border-t border-slate-100 bg-slate-50/70 px-3 py-1.5 text-[11px] text-slate-400">
            <Clock className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              Attendance for {round.event.title || 'the sabha'} isn’t marked yet — the follow-up lists
              appear here as soon as it is.
            </span>
          </div>
        )}
      </header>

      {/* ── Scroll body ──────────────────────────────────────────────────── */}
      {viewMode === 'list' ? (
        <BatchContactList
          contacts={queueContacts}
          allContacts={contacts}
          currentIdx={currentIdx}
          // The post-sabha verdict per contact (present / said yes, didn't come).
          // Null until the register is marked, so the list stays a plain calling
          // list before the sabha and becomes an attendance status list after it.
          roundById={roundById}
          // Picking a row is a decision to CALL that person, so it drops straight
          // back into the card — the list is a way in, not a second place to work.
          onPick={(idx) => { jumpTo(idx); setResumeNote(false); setViewMode('card'); }}
          onCall={handleCallTap}
          label={statusLabel}
          emoji={emoji}
          statusClasses={statusColorClasses}
          filterLabel={activeQueue?.label || null}
        />
      ) : isDone || !current ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
          <div className="text-5xl">🎉</div>
          <p className="mt-4 text-lg font-semibold text-slate-900">All done!</p>
          <p className="mt-1 text-sm text-slate-500">
            You went through all {batchTotal} assigned contacts. Great work, Sevak!
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <button
              onClick={() => setViewMode('list')}
              className="rounded-lg bg-orange-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-orange-700"
            >
              See my whole list
            </button>
            <button
              onClick={() => { clearQueue(); jumpTo(0); }}
              className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Start again from the top
            </button>
          </div>
        </div>
      ) : (
        <>
          <div ref={bodyRef} className="flex-1 overflow-y-auto px-4 py-4">
            {/* Contact identity — photo, name, and the two things you can do to
                the record itself (open the full profile, edit it inline) */}
            <div className="flex items-start gap-3">
              <Avatar
                src={current.profilePhotoURL}
                name={current.name}
                size="xl"
                className="ring-2 ring-slate-100"
              />
              <div className="min-w-0 flex-1">
                <p className="text-[22px] font-semibold leading-tight tracking-tight text-slate-900">
                  {current.name || 'Unnamed contact'}
                </p>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <Link
                    to={`/contacts/${current.id}`}
                    // Tell the profile where it was opened from, so its Back comes
                    // straight here instead of to the all-contacts list — which is
                    // a browse-everything screen this karyakarta was never heading
                    // for. The saved cursor then reopens on this same contact.
                    state={{ from: '/calling', fromLabel: 'My Calling' }}
                    className="inline-flex h-7 items-center gap-1 rounded-lg border border-slate-200 px-2 text-[11px] font-medium text-slate-500 hover:bg-slate-50"
                  >
                    <ExternalLink className="h-3 w-3" /> Profile
                  </Link>
                  <RequirePermission permission="edit_contacts">
                    <button
                      onClick={() => setEditOpen(true)}
                      className="inline-flex h-7 items-center gap-1 rounded-lg border border-slate-200 px-2 text-[11px] font-medium text-slate-500 hover:bg-slate-50"
                    >
                      <Pencil className="h-3 w-3" /> Edit
                    </button>
                  </RequirePermission>
                </div>
              </div>
            </div>

            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {current.mandal && (
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                  <MapPin className="h-3 w-3" /> {current.mandal}
                </span>
              )}
              {current.area && (
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                  {current.area}
                </span>
              )}
              {current.callCount > 0 && (
                // Tappable, because a stray tap on the big green Call button used
                // to be permanent. Reads as a plain chip until it is armed.
                <button
                  onClick={handleUndoCall}
                  disabled={undoing}
                  title="Tapped Call by mistake? Tap twice to take one off the count."
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition',
                    armCall
                      ? 'bg-rose-600 text-white'
                      : 'bg-slate-100 text-slate-500 hover:bg-slate-200',
                  )}
                >
                  {armCall
                    ? <><RotateCcw className="h-3 w-3" /> Tap again — make it {Math.max(0, current.callCount - 1)}</>
                    : <><History className="h-3 w-3" /> {current.callCount} call{current.callCount === 1 ? '' : 's'}</>}
                </button>
              )}
              {current.householdId && (
                <Link
                  to={`/households/${current.householdId}`}
                  state={{ from: '/calling', fromLabel: 'My Calling' }}
                  className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-50"
                >
                  <Home className="h-3 w-3" /> Household
                </Link>
              )}
              {/* "Did they come to the last sabha?" is the opener most karyekars
                  want, so it sits with the other identity chips. */}
              <AttendanceHistoryPanel individualId={current.id} individual={current} variant="compact" />
            </div>

            {/* Number, large and tappable on its own */}
            {normalizePhone(current.mobile) ? (
              <a href={telUrl} className="mt-3 block text-[19px] font-medium tracking-tight text-slate-800 underline decoration-slate-200 underline-offset-4">
                +91 {normalizePhone(current.mobile).replace(/(\d{5})(\d{5})/, '$1 $2')}
              </a>
            ) : (
              <p className="mt-3 text-[15px] text-rose-600">No usable mobile number on record</p>
            )}

            {current.status && (
              <div className={cn('mt-3 rounded-lg border px-3 py-2 text-xs', statusColorClasses(current.status))}>
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    Last status: <strong>{emoji(current.status) ? `${emoji(current.status)} ` : ''}{current.status}</strong>
                  </span>
                  {/* Marked the wrong one? This is the way back. Two taps, and it
                      stays on this contact so the right outcome can go in now. */}
                  <button
                    onClick={handleUndoOutcome}
                    disabled={undoing}
                    className={cn(
                      'flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition',
                      armClear
                        ? 'border-rose-300 bg-rose-600 text-white'
                        : 'border-slate-200 bg-white/80 hover:bg-white',
                    )}
                  >
                    <Undo2 className="h-3 w-3" />
                    {undoing ? 'Clearing…' : armClear ? 'Tap again to clear' : 'Undo'}
                  </button>
                </div>
                {current.reference && (
                  <div className="mt-1 flex items-start gap-1">
                    <FileText className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>{current.reference}</span>
                  </div>
                )}
                {armClear && (
                  <p className="mt-1.5 text-[11px] opacity-80">
                    Clears the outcome only — your note stays, and the call is still in the trail.
                  </p>
                )}
              </div>
            )}

            {/* What happened at the sabha, and what to do about it. `_said` is
                only printed once the round is frozen — before that it is the
                same string as "Last status" directly above. */}
            {roundRow && (
              <div className={cn(
                'mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-relaxed',
                (ROUND_TONE_CLASSES[roundRow.group.tone] || ROUND_TONE_CLASSES.slate).chip,
              )}>
                <span className="shrink-0">{roundRow.group.emoji}</span>
                <span className="min-w-0">
                  <strong>{roundRow.group.label}</strong> at {round.event?.title || 'the sabha'}
                  {round.event?.date ? ` (${shortEventDate(round.event.date)})` : ''}
                  {roundRow._frozen && roundRow._said ? ` — said “${roundRow._said}”` : ''}. {roundRow.group.hint}
                </span>
              </div>
            )}

            <div className="mt-5">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Outcome</p>
                {/* PHASE 39 — the un-select has always worked (StatusChips toggles
                    on re-tap); nothing ever SAID so, and the explanation below only
                    appears once you have already guessed. Shown only while something
                    is selected, which is the only moment it is true. */}
                {status && (
                  <p className="text-[11px] text-slate-400">Tap the same one again to un-select</p>
                )}
              </div>
              <StatusChips value={status} onChange={setStatus} size="lg" outcomes={outcomes} />
              {/* Said once, where the mistake happens. Without it, unticking looks
                  like it did nothing — the footer changed, but that is 400px away
                  on a phone. */}
              {isClearing && (
                <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] leading-snug text-amber-800">
                  <Undo2 className="mt-0.5 h-3 w-3 shrink-0" />
                  Nothing selected — <strong>Clear &amp; Next</strong> will remove “{savedStatus}” and leave this
                  contact open for a later call. Tap an outcome instead to change it.
                </p>
              )}
            </div>

            <div className="mt-4">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Reference / notes</p>
              <Textarea
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Anything worth remembering for next time…"
                rows={3}
                className="text-[15px]"
              />
            </div>
          </div>

          {/* ── Sticky action bar — everything reachable with one thumb ───── */}
          <footer className="sticky bottom-0 z-20 shrink-0 space-y-2 border-t border-slate-100 bg-white px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5">
            <div className="flex gap-2">
              <ActionLink
                href={telUrl}
                onClick={() => handleCallTap(current)}
                className="bg-emerald-600 hover:bg-emerald-700"
                icon={Phone}
                label="Call"
              />
              <ActionLink
                href={waUrl}
                external
                className="bg-[#128C7E] hover:bg-[#0e7469]"
                icon={MessageCircle}
                label="WhatsApp"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={goToNext}
                className="flex h-12 w-24 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-slate-200 text-[13px] font-medium text-slate-500 hover:bg-slate-50 active:scale-[0.98]"
              >
                <SkipForward className="h-4 w-4" /> Skip
              </button>
              <button
                onClick={handleSaveAndNext}
                disabled={saving || !canSubmit}
                className={cn(
                  'flex h-12 flex-1 items-center justify-center gap-2 rounded-xl text-[15px] font-semibold text-white transition active:scale-[0.98]',
                  !canSubmit || saving
                    ? 'bg-slate-300'
                    : isClearing
                      ? 'bg-amber-600 hover:bg-amber-700'
                      : 'bg-orange-600 hover:bg-orange-700',
                )}
              >
                {saving
                  ? 'Saving…'
                  : isClearing
                    ? <><Undo2 className="h-5 w-5" /> Clear &amp; Next</>
                    : <><Check className="h-5 w-5" /> Save &amp; Next</>}
              </button>
            </div>
          </footer>
        </>
      )}

      {current && (
        <Modal open={editOpen} onClose={() => setEditOpen(false)} title={`Edit ${current.name || 'contact'}`} size="lg">
          <IndividualForm
            individual={current}
            onSubmit={handleEditSave}
            onCancel={() => setEditOpen(false)}
            withinHousehold={Boolean(current.householdId)}
            householdArea={current.area || ''}
          />
        </Modal>
      )}
    </div>
  );
}

function FollowUpChip({ active, icon: Icon, label, count, activeClass, onClick }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition',
        active ? activeClass : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50',
      )}
    >
      <Icon className="h-3.5 w-3.5" /> {label}
      <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-semibold', active ? 'bg-white/70' : 'bg-slate-100 text-slate-500')}>
        {count}
      </span>
    </button>
  );
}

// Renders as an <a> when the URL is usable and a disabled <button> when it is
// not — an <a href={null}> silently becomes a same-page link, which on this
// screen looked like the Call button simply doing nothing.
function ActionLink({ href, onClick, external, className, icon: Icon, label }) {
  if (!href) {
    return (
      <button
        disabled
        className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-slate-200 text-[15px] font-semibold text-slate-400"
      >
        <Icon className="h-5 w-5" /> {label}
      </button>
    );
  }
  return (
    <a
      href={href}
      onClick={onClick}
      {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
      className={cn(
        'flex h-12 flex-1 items-center justify-center gap-2 rounded-xl text-[15px] font-semibold text-white transition active:scale-[0.98]',
        className,
      )}
    >
      <Icon className="h-5 w-5" /> {label}
    </a>
  );
}
