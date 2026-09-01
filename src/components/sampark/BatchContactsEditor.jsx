// src/components/sampark/BatchContactsEditor.jsx
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 28 — hand-editing who is in a batch.
//
// Generation is a bulk instrument: area × mandal, fixed size, in one sweep. It is
// right for the weekly cut and useless for every exception that follows it — the
// karyakarta who asks for ten fewer this week, the contact who should be rung by
// their own cousin rather than a stranger, the person added on Sunday who belongs
// in the round already in flight. The only tools for those were delete-and-
// regenerate, which throws away the assignment and the batch number, or the
// Manual tab, which can only create. So this screen adds and removes.
//
// THE INVARIANT IT DEFENDS. A contact belongs to at most one batch — two batches
// holding the same person means two volunteers ringing them the same evening.
// Generation enforces that with skipAlreadyBatched; hand-editing can breach it
// with two clicks, so every candidate is labelled with the batch that already
// holds them and moving them out of it is the default. The commit is atomic
// (see editBatchContacts), so the contact is never in both and never in neither.
//
// READS, and why the two halves are asymmetric. The batch's OWN contacts cost
// nothing: BatchList has already fetched those documents to compute call
// progress, and passes the map down — only ids missing from it are fetched, which
// is normally none. Finding contacts to ADD is a real query over the area ×
// mandal, so it is never run on open: the admin picks a target and asks for it.
// Nothing here reads on mount, and closing without touching the Add tab is free.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, documentId, query, where } from 'firebase/firestore';
import {
  Search, Loader2, UserMinus, UserPlus, Undo2, AlertTriangle, Users, Download,
} from 'lucide-react';
import { db } from '../../lib/firebase';
// Metered: filling in a missing member document and loading add-candidates are
// both real reads, and the quota tile in Admin Tools has to see them.
import { getDocs } from '../../lib/fsMetered';
import { chunk } from '../../lib/firestoreHelpers';
import { editBatchContacts, getIndividualsForTarget, canEditBatch } from '../../services/batchService';
import { useAreasAndMandals } from '../../hooks/useAreasAndMandals';
import { useAuth } from '../../hooks/usePermissions';
import { useToast } from '../../contexts/ToastContext';
import Modal from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input, Select } from '../ui/Input';
import { Avatar } from '../ui/Avatar';
import { cn } from '../../lib/cn';

// Long candidate lists are capped rather than virtualised: an area × mandal can
// come back with 600 rows, and rendering all of them makes every keystroke in the
// search box stutter. The cap says how many it is hiding, so it can't be mistaken
// for "that's everyone".
const MAX_ROWS = 60;

const norm = (s) => String(s || '').toLowerCase();
const digits = (s) => String(s || '').replace(/\D/g, '');

/** Name-or-mobile match. The digit half only applies when the query actually has
 *  digits in it — otherwise every mobile "contains" the empty string. */
function makeMatcher(searchText) {
  const q = norm(searchText).trim();
  if (!q) return () => true;
  const dq = digits(q);
  return (c) => norm(c.name).includes(q) || (Boolean(dq) && digits(c.mobile).includes(dq));
}

/** One contact line, in both halves of the editor. */
function ContactRow({ c, badges = [], action, struck = false, picked = false }) {
  return (
    <li className={cn(
      'flex items-center gap-2.5 rounded-lg border px-2.5 py-2',
      picked ? 'border-emerald-200 bg-emerald-50/60' : struck ? 'border-rose-100 bg-rose-50/40' : 'border-slate-100',
    )}>
      <Avatar src={c.profilePhotoURL} name={c.name} size="sm" />
      <div className="min-w-0 flex-1">
        <p className={cn('truncate text-[13px] font-medium text-slate-800', struck && 'text-slate-400 line-through')}>
          {c.name || 'Unnamed contact'}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-slate-400">
          {c.mobile && <span>{c.mobile}</span>}
          {c.mandal && <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">{c.mandal}</span>}
          {badges.map((b) => (
            <span key={b.label} className={cn('rounded px-1.5 py-0.5 font-medium', b.className)} title={b.title}>
              {b.label}
            </span>
          ))}
        </p>
      </div>
      {action}
    </li>
  );
}

export default function BatchContactsEditor({ open, batch, members = {}, batches = [], onClose }) {
  const { volunteer, scope } = useAuth();
  const { showToast } = useToast();
  const { areas: areaDefs, mandals: mandalDefs } = useAreasAndMandals();

  const [tab, setTab] = useState('in');
  const [memberSearch, setMemberSearch] = useState('');
  const [addSearch, setAddSearch] = useState('');
  const [removeSet, setRemoveSet] = useState(() => new Set());
  const [addSet, setAddSet] = useState(() => new Set());
  const [detach, setDetach] = useState(true);
  const [saving, setSaving] = useState(false);

  // Member documents this screen had to fetch itself, because BatchList's map
  // didn't have them (a contact created since its last refresh, or one in a batch
  // outside the scoped set it loaded).
  const [extra, setExtra] = useState({});
  const requestedRef = useRef(new Set());

  const [candArea, setCandArea] = useState('');
  const [candMandal, setCandMandal] = useState('');
  const [candidates, setCandidates] = useState(null);  // null = never loaded
  const [candLoading, setCandLoading] = useState(false);
  const [candError, setCandError] = useState('');

  const batchId = batch?.id || null;
  const memberIds = useMemo(() => batch?.individualIds || [], [batch?.individualIds]);
  const memberKey = memberIds.join(',');

  // Every open starts clean. Keeping the previous batch's ticks would be the kind
  // of bug that removes forty of the wrong people.
  useEffect(() => {
    if (!open) return;
    setTab('in');
    setMemberSearch('');
    setAddSearch('');
    setRemoveSet(new Set());
    setAddSet(new Set());
    setDetach(true);
    setCandidates(null);
    setCandError('');
    setCandArea(batch?.area || '');
    setCandMandal(batch?.mandal || '');
  }, [open, batchId, batch?.area, batch?.mandal]);

  // Fill in only what's missing. requestedRef stops the retry loop a deleted
  // contact would otherwise cause: it never arrives, so without the ref it stays
  // "missing and un-asked-for" forever and the effect re-fires on every render.
  useEffect(() => {
    if (!open) return undefined;
    const missing = memberIds.filter((id) => !members[id] && !extra[id] && !requestedRef.current.has(id));
    if (!missing.length) return undefined;
    missing.forEach((id) => requestedRef.current.add(id));
    let cancelled = false;
    (async () => {
      try {
        const map = {};
        for (const c of chunk(missing, 30)) {
          const snap = await getDocs(query(collection(db, 'individuals'), where(documentId(), 'in', c)));
          snap.forEach((d) => { map[d.id] = { id: d.id, ...d.data() }; });
        }
        if (!cancelled) setExtra((prev) => ({ ...prev, ...map }));
      } catch {
        // Names are a nicety here; the row still renders and can still be
        // removed, so a failed lookup must not block the editor.
      }
    })();
    return () => { cancelled = true; };
  }, [open, memberKey, members, extra]); // eslint-disable-line react-hooks/exhaustive-deps

  const docFor = useCallback((id) => members[id] || extra[id] || null, [members, extra]);

  /** Which OTHER batch holds each contact — the one-batch invariant, in a Map. */
  const heldBy = useMemo(() => {
    const m = new Map();
    (batches || []).forEach((b) => {
      if (!b || b.id === batchId) return;
      (b.individualIds || []).forEach((id) => { if (!m.has(id)) m.set(id, b); });
    });
    return m;
  }, [batches, batchId]);

  const memberRows = useMemo(() => {
    const match = makeMatcher(memberSearch);
    return memberIds
      .map((id) => ({ id, ...(docFor(id) || {}), _unknown: !docFor(id) }))
      .filter(match)
      .sort((a, b) => norm(a.name).localeCompare(norm(b.name)));
  }, [memberIds, docFor, memberSearch]);

  const candRows = useMemo(() => {
    if (!candidates) return [];
    const inBatch = new Set(memberIds);
    const match = makeMatcher(addSearch);
    return candidates
      .filter((c) => !inBatch.has(c.id))
      .filter(match)
      .sort((a, b) => norm(a.name).localeCompare(norm(b.name)));
  }, [candidates, memberIds, addSearch]);

  // The batches the picked contacts have to be pulled out of. Derived from what is
  // actually ticked, so unticking a conflicted contact also drops the batch it
  // would have been moved out of.
  const conflicts = useMemo(
    () => [...addSet].map((id) => heldBy.get(id)).filter(Boolean),
    [addSet, heldBy],
  );
  const conflictBatchIds = useMemo(
    () => [...new Set(conflicts.map((b) => b.id))],
    [conflicts],
  );

  // Moving a contact OUT of another batch is a write to that batch too, and
  // firestore.rules scopes it separately — a mandal moderator cannot edit a
  // city-wide batch even to take one person out of it. Predicted here with the
  // same predicate the rules use, so the wall is visible before the save rather
  // than as a permission error that undoes the whole edit.
  const blockedSources = useMemo(() => {
    if (!detach) return [];
    const seen = new Set();
    return conflicts.filter((b) => {
      if (seen.has(b.id) || canEditBatch(b, scope)) return false;
      seen.add(b.id);
      return true;
    });
  }, [detach, conflicts, scope]);

  const pending = addSet.size + removeSet.size;
  const nextTotal = memberIds.length - removeSet.size + addSet.size;

  const areaOptions = useMemo(
    () => [...new Set((areaDefs || []).map((a) => a.name || a).filter(Boolean))].sort(),
    [areaDefs],
  );
  const mandalOptions = useMemo(
    () => (mandalDefs || []).map((m) => m.name || m).filter(Boolean),
    [mandalDefs],
  );

  const toggleIn = (setter) => (id) => setter((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleRemove = toggleIn(setRemoveSet);
  const toggleAdd = toggleIn(setAddSet);

  async function loadCandidates() {
    if (!candArea && !candMandal) {
      setCandError('Pick an area or a mandal — loading every contact in the database is not allowed.');
      return;
    }
    setCandLoading(true);
    setCandError('');
    try {
      const rows = await getIndividualsForTarget({
        areas: candArea ? [candArea] : [],
        mandals: candMandal ? [candMandal] : [],
      });
      setCandidates(rows);
      if (!rows.length) setCandError('No contacts found for that area and mandal.');
    } catch (err) {
      setCandError(err.message);
      setCandidates(null);
    } finally {
      setCandLoading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await editBatchContacts({
        batchId,
        add: [...addSet],
        remove: [...removeSet],
        detachFrom: detach ? conflictBatchIds : [],
        editedBy: volunteer?.id,
      });
      showToast({
        type: 'success',
        message: [
          res.added ? `Added ${res.added}` : '',
          res.removed ? `removed ${res.removed}` : '',
          res.detached ? `moved ${res.detached} out of another batch` : '',
        ].filter(Boolean).join(' · ') + ` — ${res.total} contact${res.total === 1 ? '' : 's'} in this batch.`,
      });
      onClose?.();
    } catch (err) {
      showToast({
        type: 'error',
        message: err?.code === 'permission-denied'
          ? 'Firestore refused the write — your role needs Assign Batches or Generate Batches, and BOTH this batch '
            + 'and any batch you are moving contacts out of must sit inside your area and mandal. Nothing was changed.'
          : err.message,
      });
    } finally {
      setSaving(false);
    }
  }

  if (!open || !batch) return null;

  const TABS = [
    { key: 'in', label: `In this batch · ${memberIds.length}` },
    { key: 'add', label: 'Add contacts' },
  ];

  return (
    <Modal open={open} onClose={onClose} title={`Edit contacts · ${batch.name || 'Batch'}`} size="lg">
      <div className="flex rounded-lg border border-slate-200 p-0.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              tab === t.key ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-700',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── The batch as it stands ──────────────────────────────────────────── */}
      {tab === 'in' && (
        <div className="mt-3.5">
          {memberIds.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">
              This batch is empty. Use <strong>Add contacts</strong> to fill it.
            </p>
          ) : (
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <Input
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                  placeholder="Find someone in this batch…"
                  className="pl-9"
                />
              </div>

              <ul className="mt-2.5 max-h-[42vh] space-y-1.5 overflow-y-auto pr-0.5">
                {memberRows.slice(0, MAX_ROWS).map((c) => {
                  const marked = removeSet.has(c.id);
                  const badges = [];
                  if (c._unknown) {
                    badges.push({
                      label: 'contact not found',
                      className: 'bg-amber-100 text-amber-700',
                      title: 'This batch references a contact that no longer exists. Removing it is safe.',
                    });
                  }
                  if (String(c.status || '').trim()) {
                    badges.push({ label: c.status, className: 'bg-emerald-50 text-emerald-700', title: 'Already called in this round' });
                  }
                  if (c.callingPool === false) {
                    badges.push({ label: 'off follow-up list', className: 'bg-slate-100 text-slate-500' });
                  }
                  return (
                    <ContactRow
                      key={c.id}
                      c={c}
                      badges={badges}
                      struck={marked}
                      action={(
                        <button
                          onClick={() => toggleRemove(c.id)}
                          className={cn(
                            'shrink-0 rounded-lg border px-2 py-1.5 text-[11px] font-medium transition-colors',
                            marked
                              ? 'border-slate-200 text-slate-500 hover:bg-slate-50'
                              : 'border-rose-200 text-rose-600 hover:bg-rose-50',
                          )}
                        >
                          {marked
                            ? <span className="flex items-center gap-1"><Undo2 className="h-3 w-3" /> Keep</span>
                            : <span className="flex items-center gap-1"><UserMinus className="h-3 w-3" /> Remove</span>}
                        </button>
                      )}
                    />
                  );
                })}
              </ul>

              {memberRows.length > MAX_ROWS && (
                <p className="mt-2 text-center text-[11px] text-slate-400">
                  Showing {MAX_ROWS} of {memberRows.length} — search to narrow the list.
                </p>
              )}
              {memberRows.length === 0 && (
                <p className="mt-2.5 rounded-lg border border-slate-100 py-6 text-center text-sm text-slate-400">
                  Nobody in this batch matches “{memberSearch}”.
                </p>
              )}

              <p className="mt-2.5 text-[11px] text-slate-400">
                Removing somebody takes them out of this volunteer’s calling queue. Their status, notes and
                attendance are untouched, and they become available for the next batch you cut.
              </p>
            </>
          )}
        </div>
      )}

      {/* ── Pulling more people in ──────────────────────────────────────────── */}
      {tab === 'add' && (
        <div className="mt-3.5">
          <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Where to look
            </p>
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <Select value={candArea} onChange={(e) => setCandArea(e.target.value)}>
                <option value="">Any area</option>
                {areaOptions.map((a) => <option key={a} value={a}>{a}</option>)}
              </Select>
              <Select value={candMandal} onChange={(e) => setCandMandal(e.target.value)}>
                <option value="">Any mandal</option>
                {mandalOptions.map((m) => <option key={m} value={m}>{m}</option>)}
              </Select>
              <Button variant="secondary" onClick={loadCandidates} disabled={candLoading}>
                {candLoading
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</>
                  : <><Download className="h-3.5 w-3.5" /> {candidates ? 'Reload' : 'Load contacts'}</>}
              </Button>
            </div>
            <p className="mt-2 text-[11px] text-slate-400">
              Defaults to this batch’s own area and mandal. Loading is a real read of every contact there,
              so it only happens when you ask.
            </p>
          </div>

          {candError && (
            <p className="mt-2.5 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> <span>{candError}</span>
            </p>
          )}

          {candidates && candRows.length > 0 && (
            <>
              <div className="relative mt-2.5">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <Input
                  value={addSearch}
                  onChange={(e) => setAddSearch(e.target.value)}
                  placeholder={`Search ${candRows.length} contacts by name or mobile…`}
                  className="pl-9"
                />
              </div>

              <ul className="mt-2.5 max-h-[38vh] space-y-1.5 overflow-y-auto pr-0.5">
                {candRows.slice(0, MAX_ROWS).map((c) => {
                  const picked = addSet.has(c.id);
                  const holder = heldBy.get(c.id);
                  const badges = [];
                  if (holder) {
                    badges.push({
                      label: `in ${holder.name || 'another batch'}`,
                      className: 'bg-violet-100 text-violet-700',
                      title: 'Already assigned to another batch — adding them here moves them across.',
                    });
                  }
                  if (digits(c.mobile).length < 10) {
                    badges.push({ label: 'no mobile', className: 'bg-rose-100 text-rose-700', title: 'The calling screen can’t ring this contact.' });
                  }
                  if (String(c.status || '').trim()) {
                    badges.push({ label: c.status, className: 'bg-emerald-50 text-emerald-700', title: 'Already called in this round' });
                  }
                  if (c.callingPool === false) {
                    badges.push({ label: 'off follow-up list', className: 'bg-slate-100 text-slate-500' });
                  }
                  return (
                    <ContactRow
                      key={c.id}
                      c={c}
                      badges={badges}
                      picked={picked}
                      action={(
                        <button
                          onClick={() => toggleAdd(c.id)}
                          className={cn(
                            'shrink-0 rounded-lg border px-2 py-1.5 text-[11px] font-medium transition-colors',
                            picked
                              ? 'border-emerald-300 bg-emerald-100 text-emerald-800'
                              : 'border-slate-200 text-slate-600 hover:bg-slate-50',
                          )}
                        >
                          {picked
                            ? <span className="flex items-center gap-1"><Undo2 className="h-3 w-3" /> Undo</span>
                            : <span className="flex items-center gap-1"><UserPlus className="h-3 w-3" /> Add</span>}
                        </button>
                      )}
                    />
                  );
                })}
              </ul>

              {candRows.length > MAX_ROWS && (
                <p className="mt-2 text-center text-[11px] text-slate-400">
                  Showing {MAX_ROWS} of {candRows.length} — search to narrow the list.
                </p>
              )}
            </>
          )}

          {candidates && candRows.length === 0 && !candError && (
            <p className="mt-2.5 rounded-lg border border-slate-100 py-6 text-center text-sm text-slate-400">
              {addSearch
                ? `No contacts match “${addSearch}”.`
                : 'Every contact there is already in this batch.'}
            </p>
          )}

          {!candidates && !candError && (
            <p className="mt-2.5 flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">
              <Users className="h-4 w-4" /> Load an area or mandal to pick contacts from.
            </p>
          )}

          {conflictBatchIds.length > 0 && (
            <label className="mt-3 flex items-start gap-2.5 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2.5 text-[11px] text-violet-900">
              <input
                type="checkbox"
                checked={detach}
                onChange={(e) => setDetach(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-violet-300 accent-violet-600"
              />
              <span>
                <strong>Move them out of their current batch</strong>
                <span className="mt-0.5 block text-violet-800">
                  {conflicts.length} of the contacts you picked already sit in{' '}
                  {conflictBatchIds.length === 1 ? 'another batch' : `${conflictBatchIds.length} other batches`}.
                  Leave this ticked unless you really want two volunteers ringing them the same evening.
                </span>
              </span>
            </label>
          )}

          {blockedSources.length > 0 && (
            <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                {blockedSources.length === 1 ? 'One of those batches' : `${blockedSources.length} of those batches`}
                {' '}({blockedSources.map((b) => b.name || 'unnamed').join(', ')}) sits outside your area and mandal,
                so the server won’t let you take anybody out of it — the whole save will be refused. Ask an admin,
                or untick the box above and accept that they will be in two batches.
              </span>
            </p>
          )}
        </div>
      )}

      {/* ── What is about to happen ─────────────────────────────────────────── */}
      <div className="mt-4 flex flex-col gap-2.5 border-t border-slate-100 pt-3.5 sm:flex-row sm:items-center">
        <p className="min-w-0 flex-1 text-[11px] text-slate-500">
          {pending === 0 ? 'No changes yet.' : (
            <>
              {addSet.size > 0 && <span className="font-medium text-emerald-700">+{addSet.size} to add</span>}
              {addSet.size > 0 && removeSet.size > 0 && ' · '}
              {removeSet.size > 0 && <span className="font-medium text-rose-700">−{removeSet.size} to remove</span>}
              {' · '}
              <span>batch will hold {nextTotal} contact{nextTotal === 1 ? '' : 's'}</span>
            </>
          )}
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || pending === 0}>
            {saving
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>
              : <>Save {pending > 0 ? `${pending} change${pending === 1 ? '' : 's'}` : 'changes'}</>}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
