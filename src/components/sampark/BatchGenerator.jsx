// src/components/sampark/BatchGenerator.jsx
// PHASE 20 — the "generate batches for an area" tool from Sevak Call's admin
// screen. Replaces hand-ticking 40 checkboxes per volunteer.
//
// PHASE 21 — area × mandal. The old version cut one area into equal batches
// regardless of mandal, so a batch could contain Yuvak, Mahila and Bal members
// together. That batch cannot be handed to anybody: the Yuvak karyakarta has no
// business calling the Mahila Mandal. Now the default is one set of batches per
// (area × mandal) pair, and the preview shows the grid before anything is
// written — the earlier preview deliberately ignored the "already batched"
// filter and therefore over-promised on every run after the first.
// PHASE 27 — the sabha the round is calling for. `batches` recorded who was
// called but never what they were being invited to, so "the people I rang for
// last Sunday" was not a question the database could answer. One dropdown here
// stamps eventId on every batch in the run and the whole post-sabha review
// follows from it.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Wand2, Info, Grid3x3, PhoneCall, Users, RotateCcw, Loader2, CalendarCheck, UserPlus } from 'lucide-react';
import { generateBatches, previewBatchGeneration, resetCallStatuses, GROUP_BY } from '../../services/batchService';
import { subscribeToEvents, pickUpcomingEvent } from '../../services/eventService';
import { eventInScope } from '../../lib/scope';
import { useAuth } from '../../hooks/usePermissions';
import { useSettings } from '../../hooks/useSettings';
import { PERMISSIONS } from '../../constants/permissions';
import { useToast } from '../../contexts/ToastContext';
import { confirmDialog } from '../ui/ConfirmHost';
import { Input, Label, Select } from '../ui/Input';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import ChipMultiSelect from '../ui/ChipMultiSelect';
import { cn } from '../../lib/cn';

const GROUP_OPTIONS = [
  { value: GROUP_BY.PAIR, label: 'Area × Mandal', help: 'One set of batches for each area-and-mandal pair. Each batch goes to the karyakarta of exactly that mandal in that area.' },
  { value: GROUP_BY.AREA, label: 'Area only', help: 'One set per area, all mandals mixed together. Use for door-to-door sampark where the caller covers a locality.' },
  { value: GROUP_BY.MANDAL, label: 'Mandal only', help: 'One set per mandal across the whole city. Use when a mandal head is calling their own members directly.' },
];

// PHASE 26 — the first decision, and the one this whole feature exists for:
//
//   "only follow up selected contacts approx 400+ out of 1000+ because there is
//    only 10-12 volunteers have to call … and i 1000+ contacts when require to
//    call once in a year then also can generate batch of all contacts."
//
// Two options, not a checkbox, because a ticked box called "only the calling
// list" reads as a filter you might have forgotten to untick. These are two
// different jobs — the weekly round and the yearly sweep — and naming them both
// is what makes the yearly one discoverable at all.
const WHO_OPTIONS = [
  {
    value: true,
    label: 'Follow-up list only',
    icon: PhoneCall,
    help: 'The weekly round. Skips the contacts that have been taken off the follow-up calling list — usually the ones who come once a year.',
  },
  {
    value: false,
    label: 'Everyone on the roster',
    icon: Users,
    help: 'The once-a-year sweep. Includes everyone, even contacts taken off the follow-up calling list. Nothing about them changes — they are simply batched this time.',
  },
];

/**
 * @param {string[]} areas    areas this person may batch — already scope-filtered
 * @param {string[]} mandals  ditto for mandals
 * @param {boolean}  scoped   true when the lists above were narrowed by the
 *   viewer's role. Without it an area head with no mandals in scope is told "No
 *   mandals configured", i.e. that the install has none — which sends them to an
 *   admin to fix a problem that does not exist.
 * @param {Array}    batchRows  the live `batches` list BatchesPage is already
 *   subscribed to, so the "already batched" filter costs no extra reads.
 */
export default function BatchGenerator({ areas = [], mandals = [], scoped = false, batchRows = null }) {
  const { volunteer, hasPermission, scope } = useAuth();
  const { showToast } = useToast();
  // Clearing outcomes writes to `individuals`, which firestore.rules gates on
  // edit_contacts — a role can be allowed to cut batches without being allowed
  // to edit the contacts in them, so this is checked separately from the tab.
  const canResetStatuses = hasPermission(PERMISSIONS.EDIT_CONTACTS);

  const [selectedAreas, setSelectedAreas] = useState([]);
  const [selectedMandals, setSelectedMandals] = useState([]);
  const [groupBy, setGroupBy] = useState(GROUP_BY.PAIR);
  // PHASE 43 — starts from the admin-set default (settings/app.defaultBatchSize,
  // 25 out of the box) instead of a hardcoded 40, so the whole app cuts and tops
  // up to one size. Seeded once so an admin can still type a different size for a
  // single run without it being yanked back by the settings snapshot.
  const { settings: appSettings } = useSettings('app');
  const [batchSize, setBatchSize] = useState(25);
  const sizeSeeded = useRef(false);
  useEffect(() => {
    if (sizeSeeded.current || !appSettings) return;
    sizeSeeded.current = true;
    const s = Number(appSettings.defaultBatchSize);
    if (Number.isFinite(s) && s > 0) setBatchSize(s);
  }, [appSettings]);
  const [onlyUncalled, setOnlyUncalled] = useState(true);
  const [skipAlreadyBatched, setSkipAlreadyBatched] = useState(true);
  const [requirePhone, setRequirePhone] = useState(true);
  // PHASE 39 — the answer to "a new family joined the mandal on Tuesday".
  // ON by default. In week one there are no batches to grow so nothing changes;
  // from week two the only situation it alters is the one that was broken — the
  // mid-week arrival who used to become a stray batch of two that nobody assigned.
  const [topUpExisting, setTopUpExisting] = useState(true);
  // Defaults to the follow-up list: that is what "generate batches" means 51
  // weeks out of 52, and defaulting to the sweep would quietly hand every
  // volunteer two and a half times their usual load.
  const [onlyCallingPool, setOnlyCallingPool] = useState(true);
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [resetting, setResetting] = useState(false);
  const [resetProgress, setResetProgress] = useState(null);
  // Bumped after a reset so the preview re-reads. Without it the summary would
  // still claim 209 are already called seconds after they were cleared, which
  // reads as the reset having silently failed.
  const [refreshKey, setRefreshKey] = useState(0);

  // ── Which sabha ───────────────────────────────────────────────────────────
  // One listener on `events` (a few dozen small documents, and only while this
  // tab is open). It exists purely to label the round; nothing about the split
  // depends on it, so a failed read degrades to "no sabha picked".
  const [events, setEvents] = useState([]);
  const [eventId, setEventId] = useState('');
  const seededEvent = useRef(false);

  useEffect(() => subscribeToEvents(setEvents), []);

  // PHASE 43 — a mandal- or area-scoped volunteer only sees their own sabhas in
  // this picker, the same as they do on the Events tab. Without it a Yuvak Mandal
  // karyekarta was offered every other mandal's sabha to point a batch at. Admins
  // (GLOBAL / unrestricted scope) still see all of them: eventInScope returns true
  // for them on every event.
  const visibleEvents = useMemo(() => events.filter((e) => eventInScope(scope, e)), [events, scope]);

  // Sabhas still to happen, soonest first — you cut batches to invite people to
  // something, so a past sabha in this list is only ever a mis-tap. Past ones
  // stay reachable in the second optgroup for the case where the round is being
  // recorded after the fact.
  const { upcoming, past } = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const dated = visibleEvents.filter((e) => e.date);
    return {
      upcoming: dated.filter((e) => e.date >= today).sort((a, b) => String(a.date).localeCompare(String(b.date))),
      past: dated.filter((e) => e.date < today).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 12),
    };
  }, [visibleEvents]);

  // Seeded once, then left alone: re-seeding on every events snapshot would drag
  // the admin's choice back to the default the moment somebody edits an event.
  useEffect(() => {
    if (seededEvent.current || !visibleEvents.length) return;
    seededEvent.current = true;
    const next = pickUpcomingEvent(visibleEvents) || upcoming[0] || null;
    if (next) setEventId(next.id);
  }, [visibleEvents, upcoming]);

  const selectedEvent = useMemo(
    () => visibleEvents.find((e) => e.id === eventId) || null,
    [visibleEvents, eventId],
  );

  const hasTarget = selectedAreas.length > 0 || selectedMandals.length > 0;

  // Stable primitives so the effect doesn't re-fire on every render just because
  // the arrays are new objects with the same contents.
  const areaKey = selectedAreas.join('|');
  const mandalKey = selectedMandals.join('|');

  useEffect(() => {
    setResult(null);
    if (!hasTarget) { setPreview(null); return; }
    let cancelled = false;
    setPreviewing(true);
    // Runs the real selection + grouping, writes nothing. Same helpers as
    // generateBatches, so the numbers below are the numbers you will get.
    previewBatchGeneration({
      areas: selectedAreas,
      mandals: selectedMandals,
      groupBy,
      batchSize: Number(batchSize),
      onlyUncalled,
      skipAlreadyBatched,
      requirePhone,
      onlyCallingPool,
      batchRows,
      topUpExisting,
      eventId: eventId || null,
    })
      .then((res) => { if (!cancelled) setPreview(res); })
      .catch((err) => !cancelled && showToast({ type: 'error', message: err.message }))
      .finally(() => !cancelled && setPreviewing(false));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areaKey, mandalKey, groupBy, batchSize, onlyUncalled, skipAlreadyBatched, requirePhone, onlyCallingPool, topUpExisting, eventId, hasTarget, refreshKey]);

  // ── Start a new round ─────────────────────────────────────────────────────
  // Clears the outcome on everyone the preview just counted as already called,
  // so next week's cut can reach them again. Nothing else about them changes.
  async function handleReset() {
    const ids = preview?.resettableIds || [];
    if (!ids.length) return;
    const go = await confirmDialog({
      title: `Clear the call outcome on ${ids.length} contact(s)?`,
      message:
        'Use this to start a new calling round. It blanks the outcome and the remark so the next batch can include them again.\n\n'
        + 'Kept: every logged call, every sabha attendance, the whole contact record. Only the outcome column is cleared, and every clearance is written to the audit trail.\n\n'
        + 'This cannot be undone.',
      confirmText: 'Clear outcomes',
      tone: 'danger',
    });
    if (!go) return;

    setResetting(true);
    setResetProgress({ done: 0, total: ids.length });
    try {
      const res = await resetCallStatuses({
        individualIds: ids,
        resetBy: volunteer?.id,
        note: 'Cleared for a new calling round from Batches → Generate',
        onProgress: setResetProgress,
      });
      showToast({ type: 'success', message: `Cleared ${res.reset} outcome${res.reset === 1 ? '' : 's'}. Ready for a new round.` });
      setResult(null);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      showToast({
        type: 'error',
        message: err?.code === 'permission-denied'
          ? 'Firestore refused the clear — your role needs Edit Contacts to change a contact.'
          : err.message,
      });
    } finally {
      setResetting(false);
      setResetProgress(null);
    }
  }

  async function handleGenerate() {
    if (!hasTarget) return;
    setRunning(true);
    setResult(null);
    try {
      const res = await generateBatches({
        areas: selectedAreas,
        mandals: selectedMandals,
        groupBy,
        batchSize: Number(batchSize),
        onlyUncalled,
        skipAlreadyBatched,
        requirePhone,
        onlyCallingPool,
        createdBy: volunteer?.id,
        batchRows,
        topUpExisting,
        eventId: eventId || null,
        eventDate: selectedEvent?.date || null,
      });
      setResult(res);
      const grew = res.toppedUpContacts || 0;
      if (res.created === 0 && grew === 0) {
        showToast({ type: 'info', message: 'Nothing to batch — every eligible contact is already covered.' });
      } else {
        // Says both halves. Reporting only `created` made a run that put two new
        // families onto an existing list look like it had done nothing at all.
        const parts = [];
        if (res.created) parts.push(`Created ${res.created} batch${res.created === 1 ? '' : 'es'}`);
        if (grew) parts.push(`added ${grew} contact${grew === 1 ? '' : 's'} to ${res.toppedUp.length} existing batch${res.toppedUp.length === 1 ? '' : 'es'}`);
        showToast({ type: 'success', message: `${parts.join(' and ')}.` });
      }
    } catch (err) {
      showToast({ type: 'error', message: err.message });
    } finally {
      setRunning(false);
    }
  }

  const activeGroup = useMemo(
    () => GROUP_OPTIONS.find((g) => g.value === groupBy) || GROUP_OPTIONS[0],
    [groupBy],
  );

  const activeWho = WHO_OPTIONS.find((w) => w.value === onlyCallingPool) || WHO_OPTIONS[0];

  return (
    <Card className="p-4">
      <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-slate-900">
        <Wand2 className="h-4 w-4 text-orange-600" /> Generate batches
      </h3>
      <p className="mb-4 text-xs text-slate-500">
        Cuts contacts into equal, unassigned batches. Pick at least one area or one mandal —
        leaving the other side empty means “all of them”. Assign the batches on the Batches list.
        {scoped && ' You are only offered the areas and mandals your role covers.'}
      </p>

      {/* ── Who to call ────────────────────────────────────────────────────
          First, because it is the biggest number on the page: the same area can
          yield 400 contacts or 1,000 depending on this one answer. */}
      <div className="mb-4 rounded-xl border border-orange-100 bg-orange-50/40 p-3">
        <Label>Who to call</Label>
        <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
          {WHO_OPTIONS.map((w) => {
            const Icon = w.icon;
            const on = onlyCallingPool === w.value;
            return (
              <button
                key={String(w.value)}
                type="button"
                onClick={() => setOnlyCallingPool(w.value)}
                aria-pressed={on}
                className={cn(
                  'flex min-h-[42px] items-center gap-2 rounded-lg border px-3 py-2 text-left text-[12px] font-medium transition-colors',
                  on
                    ? 'border-orange-300 bg-white text-orange-700 shadow-sm'
                    : 'border-slate-200 bg-white/60 text-slate-600 hover:bg-white',
                )}
              >
                <Icon className={cn('h-4 w-4 shrink-0', on ? 'text-orange-600' : 'text-slate-400')} />
                <span className="flex-1">{w.label}</span>
                {on && <span className="text-[10px] font-semibold uppercase tracking-wide text-orange-500">Selected</span>}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-[11px] leading-snug text-slate-500">{activeWho.help}</p>
        {/* The count only exists once a target is picked, and only matters when
            it is non-zero — otherwise the two options are identical and saying so
            twice is noise. */}
        {preview && preview.offCallList > 0 && (
          <p className="mt-1 text-[11px] font-medium text-orange-700">
            {onlyCallingPool
              ? `${preview.offCallList} of the ${preview.candidates} matched contacts are off the follow-up list and will be skipped.`
              : `Including ${preview.offCallList} contacts that are off the follow-up list.`}
          </p>
        )}
      </div>

      {/* ── Which sabha ────────────────────────────────────────────────────
          Second, because it costs one tap and unlocks the whole after-the-sabha
          half of the week. Nothing about the split depends on it, so it sits
          outside the filter block — this is a label on the round, not a filter
          on the contacts. */}
      <div className="mb-4 rounded-xl border border-sky-100 bg-sky-50/40 p-3">
        <Label>
          <span className="inline-flex items-center gap-1.5">
            <CalendarCheck className="h-3.5 w-3.5 text-sky-600" /> Calling for which sabha
          </span>
        </Label>
        <Select
          className="mt-1.5"
          value={eventId}
          onChange={(e) => setEventId(e.target.value)}
        >
          <option value="">Not for a particular sabha</option>
          {upcoming.length > 0 && (
            <optgroup label="Coming up">
              {upcoming.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.date} — {e.title || 'Sabha'}{e.mandal ? ` (${e.mandal})` : ''}
                </option>
              ))}
            </optgroup>
          )}
          {past.length > 0 && (
            <optgroup label="Already happened">
              {past.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.date} — {e.title || 'Sabha'}{e.mandal ? ` (${e.mandal})` : ''}
                </option>
              ))}
            </optgroup>
          )}
        </Select>
        <p className="mt-1.5 text-[11px] leading-snug text-slate-500">
          {selectedEvent ? (
            <>
              After this sabha is marked present, every volunteer sees their called contacts split
              into <strong>came as promised</strong>, <strong>said yes but didn’t come</strong> and{' '}
              <strong>came anyway</strong> — so the follow-up calls write themselves.
            </>
          ) : visibleEvents.length === 0 ? (
            'No sabhas created yet. Add one on the Events tab and the after-the-sabha follow-up list turns itself on.'
          ) : (
            'Optional, but worth one tap: without a sabha the app has to guess which one these calls were about, and the after-the-sabha follow-up list falls back to the most recent past sabha in the same mandal.'
          )}
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <Label>Areas</Label>
          <p className="mb-1.5 text-[11px] text-slate-400">
            Leave empty for every area{scoped ? ' in your scope' : ''}. Area comes from the household address.
          </p>
          <ChipMultiSelect
            options={areas}
            value={selectedAreas}
            onChange={setSelectedAreas}
            allLabel="areas"
            emptyLabel={scoped
              ? 'No areas in your scope — your role is limited to mandals. Pick a mandal instead.'
              : 'No areas found — add households first.'}
          />
        </div>

        <div>
          <Label>Mandals</Label>
          <p className="mb-1.5 text-[11px] text-slate-400">
            Leave empty for every mandal{scoped ? ' in your scope' : ''}. Mandal comes from the individual, not the household.
          </p>
          <ChipMultiSelect
            options={mandals}
            value={selectedMandals}
            onChange={setSelectedMandals}
            allLabel="mandals"
            emptyLabel={scoped
              ? 'No mandals in your scope — your role is limited to areas. Pick an area instead.'
              : 'No mandals configured.'}
          />
        </div>

        <div>
          <Label>Split batches by</Label>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {GROUP_OPTIONS.map((g) => (
              <button
                key={g.value}
                type="button"
                onClick={() => setGroupBy(g.value)}
                className={cn(
                  'inline-flex min-h-[34px] items-center rounded-lg border px-3 text-[12px] font-medium transition-colors',
                  groupBy === g.value
                    ? 'border-orange-200 bg-orange-50 text-orange-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
                )}
              >
                {g.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-slate-500">{activeGroup.help}</p>
        </div>

        <div className="sm:w-48">
          <Label>Contacts per batch</Label>
          <Input
            type="number" min={1} max={500} inputMode="numeric"
            value={batchSize}
            onChange={(e) => setBatchSize(e.target.value)}
          />
        </div>
      </div>

      <div className="mt-3 space-y-1.5">
        <label className="flex min-h-[40px] items-center gap-2.5 text-[13px] text-slate-700">
          <input type="checkbox" checked={onlyUncalled} onChange={(e) => setOnlyUncalled(e.target.checked)} className="h-4 w-4 rounded border-slate-300 accent-orange-600" />
          Only contacts with no status yet
        </label>
        <label className="flex min-h-[40px] items-center gap-2.5 text-[13px] text-slate-700">
          <input type="checkbox" checked={skipAlreadyBatched} onChange={(e) => setSkipAlreadyBatched(e.target.checked)} className="h-4 w-4 rounded border-slate-300 accent-orange-600" />
          Skip contacts already in another batch
        </label>
        <label className="flex min-h-[40px] items-center gap-2.5 text-[13px] text-slate-700">
          <input type="checkbox" checked={requirePhone} onChange={(e) => setRequirePhone(e.target.checked)} className="h-4 w-4 rounded border-slate-300 accent-orange-600" />
          Skip contacts without a 10-digit mobile
        </label>
        {/* PHASE 39. Disabled with the filter above it because it has nothing to
            act on without it: "already in another batch" is what identifies a new
            arrival, and with it off a contact could be appended to a batch they
            are already in. */}
        <label className={cn(
          'flex min-h-[40px] items-center gap-2.5 text-[13px]',
          skipAlreadyBatched ? 'text-slate-700' : 'cursor-not-allowed text-slate-400',
        )}>
          <input
            type="checkbox"
            checked={topUpExisting && skipAlreadyBatched}
            disabled={!skipAlreadyBatched}
            onChange={(e) => setTopUpExisting(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 accent-orange-600 disabled:opacity-50"
          />
          Add new contacts to an existing batch when there is room
        </label>
      </div>
      <p className="mt-1 pl-7 text-[11px] leading-snug text-slate-400">
        Someone added to a mandal after the batches were cut joins a list a karyakarta is already
        calling, instead of becoming a batch of one that nobody notices. Only batches for the same
        sabha and the same mandal, and never past {batchSize}.
      </p>

      {previewing && <p className="mt-3 text-xs text-slate-400">Working out the split…</p>}

      {preview && !previewing && (
        <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50/60 p-3 text-xs text-slate-600">
          <p>
            <strong>{preview.candidates}</strong> contacts matched ·{' '}
            <strong>{preview.eligible}</strong> eligible after filters ·{' '}
            <strong>{preview.totalBatches}</strong> new batch{preview.totalBatches === 1 ? '' : 'es'} of {batchSize}
            {preview.topUpContacts > 0 && (
              <> · <strong>{preview.topUpContacts}</strong> joining a batch that already exists</>
            )}
          </p>
          <p className="mt-1 text-slate-500">
            Skipping {preview.skipped.noPhone} without a mobile, {preview.skipped.alreadyBatched} already
            batched, {preview.skipped.alreadyCalled} already called
            {preview.skipped.notInPool > 0 && `, ${preview.skipped.notInPool} off the follow-up list`}.
          </p>

          {/* ── Which existing batches grow ────────────────────────────────
              Named one by one rather than totalled, because the thing an admin
              needs to be able to check is that the two new families are going onto
              a list somebody is already holding — and which list that is. Silently
              growing an assigned batch would be worse than the bug it fixes. */}
          {preview.topUp?.length > 0 && (
            <div className="mt-2.5 rounded-lg border border-sky-200 bg-sky-50/70 p-2.5">
              <p className="mb-1.5 flex items-center gap-1 font-medium text-sky-900">
                <UserPlus className="h-3.5 w-3.5" /> Joining batches that already exist
              </p>
              <ul className="divide-y divide-sky-200/60 rounded-md border border-sky-200/70 bg-white">
                {preview.topUp.map((t) => (
                  <li key={t.batchId} className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                    <span className="min-w-0 truncate text-slate-700">
                      {t.batchName}
                      <span className="text-slate-400">
                        {t.assignedVolunteerId ? ' · assigned' : ' · not yet assigned'}
                      </span>
                    </span>
                    <span className="shrink-0 whitespace-nowrap tabular-nums text-slate-500">
                      +{t.add} <span className="text-slate-400">({t.was} → {t.now})</span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-[11px] leading-snug text-sky-800">
                The karyakarta holding an assigned batch will see the extra names on their list the
                next time they open it. Nothing already called is touched.
              </p>
            </div>
          )}

          {/* ── Start a new round ──────────────────────────────────────────
              Sits under the number it acts on. An outcome has no date on it, so
              "already called" means "ever called" until something clears it —
              which is exactly the thing an admin comes to this line looking for
              and, before this, could not find anywhere. */}
          {preview.resettableIds?.length > 0 && (
            <div className="mt-2.5 rounded-lg border border-amber-200 bg-amber-50/70 p-2.5">
              <p className="text-amber-900">
                <strong className="tabular-nums">{preview.resettableIds.length}</strong> of them still
                carry an outcome from a previous round
                {onlyUncalled
                  ? ' — that is why they are being skipped.'
                  : ' and will be re-called carrying it.'}
              </p>
              {canResetStatuses ? (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-2"
                    onClick={handleReset}
                    disabled={resetting || running}
                  >
                    {resetting
                      ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Clearing…</>
                      : <><RotateCcw className="h-3.5 w-3.5" /> Start a new round — clear {preview.resettableIds.length} outcome{preview.resettableIds.length === 1 ? '' : 's'}</>}
                  </Button>
                  <p className="mt-1.5 text-[11px] leading-snug text-amber-800">
                    Blanks the outcome and remark only. Logged calls, sabha attendance and the
                    contact record are all kept, and every clearance goes to the audit trail.
                    {onlyCallingPool
                      ? ' Limited to the follow-up list, matching “Who to call” above.'
                      : ' Covers everyone on the roster, matching “Who to call” above.'}
                  </p>
                  {resetProgress && (
                    <p className="mt-1 text-[11px] tabular-nums text-amber-800">
                      {resetProgress.done} of {resetProgress.total} cleared
                    </p>
                  )}
                </>
              ) : (
                <p className="mt-1 text-[11px] leading-snug text-amber-800">
                  Clearing outcomes needs the <strong>Edit Contacts</strong> permission — ask an admin,
                  or untick “Only contacts with no status yet” to re-cut them as they are.
                </p>
              )}
            </div>
          )}

          {preview.groups.length > 0 && (
            <div className="mt-2.5">
              <p className="mb-1.5 flex items-center gap-1 font-medium text-slate-700">
                <Grid3x3 className="h-3.5 w-3.5" /> What will be created
              </p>
              {/* Scrolls rather than wrapping: 17 areas × 8 mandals is 136 rows
                  in the worst case, and an un-capped list would push the
                  Generate button off the bottom of a phone screen. */}
              <ul className="max-h-52 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-100 bg-white">
                {preview.groups.map((g) => (
                  <li key={g.key} className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                    <span className="truncate text-slate-700">{g.label}</span>
                    <span className="shrink-0 whitespace-nowrap text-slate-500">
                      {g.batches} × {batchSize}
                      <span className="text-slate-400"> ({g.contacts})</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {preview.eligible === 0 && (
            <p className="mt-2 flex items-start gap-1 text-amber-700">
              <Info className="mt-0.5 h-3 w-3 shrink-0" />
              Nothing left to batch with these filters.
              {preview.skipped.notInPool > 0
                ? ` All ${preview.skipped.notInPool} of them are off the follow-up list — switch “Who to call” to “Everyone on the roster” for a full sweep.`
                : preview.resettableIds?.length > 0
                  ? ' They have all been called already — use “Start a new round” above to clear last round’s outcomes, or untick “Only contacts with no status yet” to re-cut them as they are.'
                  : ' Untick “only contacts with no status yet” to re-cut contacts that have already been called.'}
            </p>
          )}
        </div>
      )}

      <Button variant="accent" className="mt-4 w-full sm:w-auto" onClick={handleGenerate} disabled={!hasTarget || running || preview?.eligible === 0}>
        {running ? 'Generating…' : 'Generate batches'}
      </Button>
      {!hasTarget && (
        <p className="mt-1.5 text-[11px] text-slate-400">Pick at least one area or one mandal.</p>
      )}

      {result && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-800">
          <p className="font-medium">Created {result.created} batch{result.created === 1 ? '' : 'es'} covering {result.eligible} contacts.</p>
          {result.toppedUpContacts > 0 && (
            <p className="mt-1 text-emerald-700">
              {result.toppedUpContacts} of them joined {result.toppedUp.length} batch{result.toppedUp.length === 1 ? '' : 'es'} that
              already existed: {result.toppedUp.map((t) => `${t.batchName} (+${t.add})`).join(', ')}.
            </p>
          )}
          {result.created > 0 && selectedEvent && (
            <p className="mt-1 text-emerald-700">
              Tagged to <strong>{selectedEvent.title || 'Sabha'}</strong> on {selectedEvent.date}. Mark
              attendance for it and the follow-up lists appear on every volunteer’s calling screen.
            </p>
          )}
          <p className="mt-1 text-emerald-700">
            Skipped: {result.skipped.noPhone} without a mobile, {result.skipped.alreadyBatched} already batched, {result.skipped.alreadyCalled} already called
            {result.skipped.notInPool > 0 && `, ${result.skipped.notInPool} off the follow-up list`}.
            {result.remainder > 0 && ` The last batch has ${result.remainder} contacts.`}
          </p>
        </div>
      )}
    </Card>
  );
}
