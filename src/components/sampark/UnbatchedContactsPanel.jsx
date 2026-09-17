// src/components/sampark/UnbatchedContactsPanel.jsx
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 40 — "WHO ISN'T IN A BATCH?", ANSWERED WITHOUT RE-CUTTING ANYTHING.
//
// THE PROBLEM. Contacts arrive all week — a new Yuvak on Tuesday, two families
// after Sunday's sabha. The batch roster was cut on Saturday and knows nothing
// about them, so they are in no batch, on nobody's calling list, and invisible:
// every screen shows a healthy roster of eleven full batches and no screen says
// "and four people who belong to none of them".
//
// The only cure was to run Generate again, which is a heavy, scary operation
// (pick areas, pick mandals, pick a size, watch it re-number the roster) to do
// something small. So it did not get run, and the four people did not get rung.
//
// WHAT THIS IS. A scan and a single button, in Batches → Tools:
//
//   Scan  → who, in your scope, is on the follow-up list and in no batch at all,
//           grouped by Area × Mandal, with the exact batches they would join.
//   Apply → they join a batch somebody is ALREADY calling this week, if one has
//           room; only the overflow becomes a new batch.
//
// It is not a new algorithm. It is generateBatches() with onlyUncalled:false and
// topUpExisting:true — the same planTopUps() the generator uses, the same four
// safety tests (same sabha, no contradiction of area/mandal, room, not stale).
// Running this can therefore never produce something Generate would not have.
//
// WHY IT IS STILL A BUTTON AND NOT A CRON. Two reasons, and the second is the
// one that matters. First: a karyakarta's list growing by three names while they
// are halfway through calling it is a surprise, and a surprise nobody authorised
// is indistinguishable from a bug. Second: the write is real — up to one write per
// touched batch plus one per overflow batch — and an unattended job that tops up
// on every contact import is exactly how a daily write budget disappears. So
// somebody with Generate Batches looks at the number and presses the button.
//
// READS. The scan is previewBatchGeneration(), which writes nothing and reads
// contacts for the selected areas/mandals — the same query the Generate tab runs
// on every keystroke. `batchRows` comes from the page's existing onSnapshot, so
// the batch half is free. Nothing runs until Scan is pressed.
//
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 42 — ONE MANDAL AT A TIME, AND IT PICKS THE RIGHT ROUND BY ITSELF.
//
// It used to scan every mandal in scope at once. Three things were wrong with
// that, and all three are the same mistake in different clothes:
//
//   • THE ROUNDS ARE NOT IN STEP. Yuvak Mandal's roster is cut on Saturday for
//     Sunday's sabha; Bal Mandal's a week later for a different one. One `eventId`
//     therefore fits at most one of them, and every contact in the other mandal
//     failed the "same sabha" test in planTopUps and became a BRAND-NEW batch —
//     precisely the outcome this panel exists to prevent.
//   • THE READS. One scan billed contacts for every mandal in scope, to act on
//     the handful in one of them.
//   • THE NUMBER MEANT NOTHING. "23 contacts in no batch" across four mandals is
//     not a number anybody can act on; "6 in Yuvak Mandal" is.
//
// So the mandal is now chosen, the list of mandals is DERIVED FROM THE BATCHES
// THAT EXIST (not from the mandal master list), it defaults to whichever mandal
// had a batch cut most recently, and picking one seeds the sabha from that
// mandal's own newest batch. The default case is now a single press with nothing
// to configure — which is what "join automatically" has to mean to be used.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from 'react';
import { UserPlus, Loader2, ScanSearch, CalendarCheck, CheckCircle2, AlertTriangle, Layers } from 'lucide-react';
import { generateBatches, previewBatchGeneration } from '../../services/batchService';
import { subscribeToEvents, pickUpcomingEvent } from '../../services/eventService';
import { useAuth } from '../../hooks/usePermissions';
import { useToast } from '../../contexts/ToastContext';
import { Label, Select } from '../ui/Input';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

/** Firestore Timestamp | Date | null → milliseconds, 0 when absent. */
function tsMillis(v) {
  if (!v) return 0;
  if (typeof v.toDate === 'function') return v.toDate().getTime();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

/** "14 Sep" — short enough to sit inside a dropdown option. */
function shortDate(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/**
 * @param {string[]} areas      areas this person may cut for (already scoped)
 * @param {string[]} mandals    mandals this person may cut for (already scoped)
 * @param {Array}    batchRows  the page's live `batches` snapshot
 * @param {boolean}  scoped     true when the two lists above were narrowed
 */
export default function UnbatchedContactsPanel({ areas = [], mandals = [], batchRows = null, scoped = false }) {
  const { volunteer } = useAuth();
  const { showToast } = useToast();

  const [events, setEvents] = useState([]);
  const [eventId, setEventId] = useState('');
  const seeded = useRef(false);

  // PHASE 42 — which mandal this scan is for. '' until the list below resolves.
  const [mandal, setMandal] = useState('');
  const mandalSeeded = useRef(false);
  const eventSeededFor = useRef(null);
  // The page rebuilds `mandals` on every render for a scoped caller, so the
  // memo and effects below key off its contents, not its identity.
  const mandalsKey = mandals.join('|');

  const [scan, setScan] = useState(null);      // null = never scanned
  const [scanning, setScanning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState(null);

  // A few dozen small documents, and only while the Tools tab is mounted. The
  // sabha is not decoration: planTopUps() will only append to a batch stamped with
  // the SAME eventId, so picking the wrong one silently turns every top-up into a
  // brand-new batch — the exact outcome this panel exists to avoid.
  useEffect(() => subscribeToEvents(setEvents), []);

  const { upcoming, past } = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const dated = events.filter((e) => e.date);
    return {
      upcoming: dated.filter((e) => e.date >= today).sort((a, b) => String(a.date).localeCompare(String(b.date))),
      past: dated.filter((e) => e.date < today).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 8),
    };
  }, [events]);

  // Seeded once. Re-seeding on every snapshot would drag the choice back to the
  // default the moment somebody edits an event.
  useEffect(() => {
    if (seeded.current || !events.length) return;
    seeded.current = true;
    const next = pickUpcomingEvent(events) || upcoming[0] || null;
    if (next) setEventId(next.id);
  }, [events, upcoming]);

  const selectedEvent = useMemo(() => events.find((e) => e.id === eventId) || null, [events, eventId]);

  /**
   * PHASE 42 — the mandals that actually have a roster, newest first.
   *
   * Derived from the batches rather than from the mandal master list on purpose:
   * the question this panel answers is "who is missing from the round that is
   * being called", and a mandal with no batches is not in a round. Mandals with
   * none are still offered, in their own group and last — for them the button
   * cuts a first roster rather than topping one up, which is a different (and
   * rarer) intent that shouldn't be the default.
   *
   * `lastEventId` is what makes the sabha pick itself: it is the round the newest
   * batch of that mandal was cut for, which is the only round a top-up can join.
   */
  const mandalRows = useMemo(() => {
    const inScope = (m) => !mandals.length || mandals.includes(m);
    const seen = new Map();
    (batchRows || []).forEach((b) => {
      const m = b.mandal || '';
      if (!m || !inScope(m)) return;
      const at = tsMillis(b.createdAt);
      const row = seen.get(m);
      if (!row) {
        seen.set(m, { mandal: m, batches: 1, lastAt: at, lastEventId: b.eventId || null });
        return;
      }
      row.batches += 1;
      if (at >= row.lastAt) { row.lastAt = at; row.lastEventId = b.eventId || null; }
    });
    const withBatches = [...seen.values()].sort((a, b) => b.lastAt - a.lastAt);
    const without = mandals
      .filter((m) => !seen.has(m))
      .sort()
      .map((m) => ({ mandal: m, batches: 0, lastAt: 0, lastEventId: null }));
    return { withBatches, without };
    // `mandals` is rebuilt by the page on every render when the caller is scoped,
    // so the key is the string — otherwise this recomputes forever and the effects
    // below fire on renders where nothing actually changed.
  }, [batchRows, mandalsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedMandalRow = useMemo(
    () => [...mandalRows.withBatches, ...mandalRows.without].find((r) => r.mandal === mandal) || null,
    [mandalRows, mandal],
  );

  // Seeded once, to the mandal whose batches were cut most recently — the round
  // somebody is calling right now. Guarded so a later snapshot (a batch renamed,
  // a batch deleted) can never drag the choice back off what was picked.
  useEffect(() => {
    if (mandalSeeded.current) return;
    const first = mandalRows.withBatches[0] || mandalRows.without[0];
    if (!first) return;
    mandalSeeded.current = true;
    setMandal(first.mandal);
  }, [mandalRows]);

  // Choosing a mandal moves the sabha to that mandal's newest batch. planTopUps
  // only appends to a batch stamped with the SAME eventId, so this is the one
  // value that makes "add them to the batches already being called" true rather
  // than "cut them a new batch of their own".
  //
  // ONCE PER MANDAL, tracked by name rather than by a boolean: re-running it on
  // every `batches` snapshot would silently undo a sabha somebody chose by hand,
  // and the snapshot fires on every assign, rename and top-up. A deleted sabha
  // leaves the current choice alone rather than blanking it.
  useEffect(() => {
    if (!mandal || !events.length || eventSeededFor.current === mandal) return;
    const row = mandalRows.withBatches.find((r) => r.mandal === mandal);
    if (!row) return;                       // list hasn't resolved yet — try again
    eventSeededFor.current = mandal;
    if (!row.lastEventId || !events.some((e) => e.id === row.lastEventId)) return;
    setEventId(row.lastEventId);
  }, [mandal, events, mandalRows]);

  // One mandal, and the areas half stays as the caller's own scope: a mandal
  // spans areas, and narrowing both axes at once would silently exclude the
  // contacts this is meant to find.
  const hasTarget = Boolean(mandal);

  // The one options object both the scan and the apply use. Keeping it in a single
  // place is the whole reason the preview can be trusted: the moment the two lists
  // of flags can drift, "4 contacts will join Batch 12" stops being a promise.
  //
  //   onlyUncalled: false   — somebody rung LAST round still carries that outcome
  //                           until the round is reset, and they are just as
  //                           unbatched as a brand-new contact. Filtering on the
  //                           outcome here would hide most of the backlog.
  //   skipAlreadyBatched    — the definition of "unbatched"; also what makes
  //                           top-up safe (see planTopUps).
  //   onlyCallingPool       — someone taken off the follow-up list is not missing
  //                           from the roster, they were removed from it.
  const options = useMemo(() => ({
    areas,
    // PHASE 42 — exactly one. See the header: a scan that spans mandals whose
    // rounds are on different sabhas turns every top-up into a new batch.
    mandals: mandal ? [mandal] : [],
    batchSize: 40,
    onlyUncalled: false,
    skipAlreadyBatched: true,
    requirePhone: true,
    onlyCallingPool: true,
    topUpExisting: true,
    batchRows,
    eventId: eventId || null,
  }), [areas, mandal, batchRows, eventId]);

  async function handleScan() {
    if (!hasTarget) return;
    setScanning(true);
    setResult(null);
    try {
      setScan(await previewBatchGeneration(options));
    } catch (err) {
      showToast({ type: 'error', message: err.message });
      setScan(null);
    } finally {
      setScanning(false);
    }
  }

  async function handleApply() {
    if (!scan || scan.eligible === 0) return;
    setApplying(true);
    try {
      const res = await generateBatches({
        ...options,
        createdBy: volunteer?.id,
        eventDate: selectedEvent?.date || null,
      });
      setResult(res);
      setScan(null);
      const grew = res.toppedUpContacts || 0;
      showToast({
        type: 'success',
        message: res.created === 0 && grew === 0
          ? 'Nothing left to add — everyone is already in a batch.'
          : [
            grew ? `${grew} joined existing batches` : null,
            res.created ? `${res.created} new batch${res.created === 1 ? '' : 'es'} created` : null,
          ].filter(Boolean).join(' · '),
      });
    } catch (err) {
      showToast({ type: 'error', message: err.message });
    } finally {
      setApplying(false);
    }
  }

  const unbatched = scan?.eligible ?? 0;
  const joining = scan?.topUpContacts ?? 0;
  const newBatches = scan?.totalBatches ?? 0;

  return (
    <Card className="p-4">
      <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-slate-900">
        <UserPlus className="h-4 w-4 text-slate-400" /> Contacts not in any batch
      </h3>
      <p className="mb-4 text-xs leading-relaxed text-slate-500">
        Everyone added since the roster was cut sits in no batch and is on nobody’s calling list.
        This finds them, <strong className="font-semibold text-slate-600">one mandal at a time</strong>,
        and puts them into the batches already being called — a new batch is only cut for whoever
        doesn’t fit. Nothing already assigned is renumbered or moved.
        {scoped && <> Limited to the areas and mandals assigned to you.</>}
      </p>

      {/* ── Which mandal ─────────────────────────────────────────────────────
          First, because it decides the sabha below it. Mandals that have a
          roster lead; the rest are offered but are not the default — for them
          this button cuts a first roster rather than topping one up. */}
      <div className="mb-3">
        <Label>Which mandal?</Label>
        <Select
          value={mandal}
          onChange={(e) => { setMandal(e.target.value); setScan(null); setResult(null); }}
        >
          <option value="">Choose a mandal…</option>
          {mandalRows.withBatches.length > 0 && (
            <optgroup label="Has batches — newest round first">
              {mandalRows.withBatches.map((r) => (
                <option key={r.mandal} value={r.mandal}>
                  {r.mandal} · {r.batches} batch{r.batches === 1 ? '' : 'es'}
                  {r.lastAt ? ` · cut ${shortDate(r.lastAt)}` : ''}
                </option>
              ))}
            </optgroup>
          )}
          {mandalRows.without.length > 0 && (
            <optgroup label="No batches cut yet">
              {mandalRows.without.map((r) => <option key={r.mandal} value={r.mandal}>{r.mandal}</option>)}
            </optgroup>
          )}
        </Select>
        {selectedMandalRow && (
          <p className="mt-1 flex items-start gap-1.5 text-[11px] leading-snug text-slate-400">
            <Layers className="mt-px h-3 w-3 shrink-0" />
            {selectedMandalRow.batches > 0 ? (
              <>
                {selectedMandalRow.mandal} has <strong className="font-semibold text-slate-500">{selectedMandalRow.batches}</strong>
                {' '}batch{selectedMandalRow.batches === 1 ? '' : 'es'}, last cut
                {' '}{selectedMandalRow.lastAt ? shortDate(selectedMandalRow.lastAt) : 'at an unknown date'} —
                the sabha below is that round’s, so new contacts join those batches instead of starting new ones.
              </>
            ) : (
              <>
                {selectedMandalRow.mandal} has no batches yet, so everyone found here becomes a new,
                unassigned batch. That is Generate’s job — use it there unless you meant to.
              </>
            )}
          </p>
        )}
      </div>

      <div className="mb-3">
        <Label>Which sabha are they being called for?</Label>
        <Select value={eventId} onChange={(e) => { setEventId(e.target.value); setScan(null); setResult(null); }}>
          <option value="">No sabha — don’t stamp a round</option>
          {upcoming.length > 0 && (
            <optgroup label="Upcoming">
              {upcoming.map((e) => <option key={e.id} value={e.id}>{e.date} · {e.title || 'Sabha'}{e.mandal ? ` · ${e.mandal}` : ''}</option>)}
            </optgroup>
          )}
          {past.length > 0 && (
            <optgroup label="Recent">
              {past.map((e) => <option key={e.id} value={e.id}>{e.date} · {e.title || 'Sabha'}{e.mandal ? ` · ${e.mandal}` : ''}</option>)}
            </optgroup>
          )}
        </Select>
        <p className="mt-1 flex items-start gap-1.5 text-[11px] leading-snug text-slate-400">
          <CalendarCheck className="mt-px h-3 w-3 shrink-0" />
          They can only join batches cut for this same sabha. Pick the round your volunteers are
          calling right now, or every one of them becomes a new batch instead.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={handleScan} disabled={!hasTarget || scanning || applying}>
          {scanning
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking…</>
            : <><ScanSearch className="h-3.5 w-3.5" /> Check {mandal || 'this mandal'} for new contacts</>}
        </Button>
        {scan && unbatched > 0 && (
          <Button variant="accent" onClick={handleApply} disabled={applying}>
            {applying ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Adding…</> : <>Add {unbatched} to batches</>}
          </Button>
        )}
      </div>

      {!hasTarget && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {mandalRows.withBatches.length === 0 && mandalRows.without.length === 0
            ? 'No mandals are assigned to you, so there is nothing to scan.'
            : 'Pick a mandal above to scan it.'}
        </p>
      )}

      {/* ── What the scan found ─────────────────────────────────────────── */}
      {scan && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
          {unbatched === 0 ? (
            <p className="flex items-center gap-1.5 text-sm text-emerald-700">
              <CheckCircle2 className="h-4 w-4" /> Everyone is already in a batch. Nothing to do.
            </p>
          ) : (
            <>
              <p className="text-sm font-medium text-slate-800">
                {unbatched} contact{unbatched === 1 ? '' : 's'} in no batch
              </p>

              {joining > 0 && (
                <div className="mt-2">
                  <p className="text-xs text-slate-500">
                    {joining} will join {scan.topUp.length} batch{scan.topUp.length === 1 ? '' : 'es'} already being called:
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {scan.topUp.map((t) => (
                      <li key={t.batchId} className="flex items-baseline justify-between gap-2 text-xs">
                        <span className="min-w-0 truncate text-slate-700">{t.batchName}</span>
                        <span className="shrink-0 tabular-nums text-slate-400">
                          {t.was} → {t.now}
                          {!t.assignedVolunteerId && <span className="ml-1 text-amber-600">· unassigned</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {newBatches > 0 && (
                <div className="mt-2 border-t border-slate-200 pt-2">
                  <p className="text-xs text-slate-500">
                    {unbatched - joining} don’t fit anywhere and need {newBatches} new batch{newBatches === 1 ? '' : 'es'}:
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {scan.groups.map((g) => (
                      <li key={g.key} className="flex items-baseline justify-between gap-2 text-xs">
                        <span className="min-w-0 truncate text-slate-700">{g.label}</span>
                        <span className="shrink-0 tabular-nums text-slate-400">{g.contacts} · {g.batches} batch{g.batches === 1 ? '' : 'es'}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-snug text-amber-700">
                    <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
                    New batches are created unassigned — hand them out on the Batches tab, or they sit
                    there uncalled, which is the same problem in a new shape.
                  </p>
                </div>
              )}

              {/* The honest small print: not every unbatched contact is reachable. */}
              {(scan.skipped?.noPhone > 0 || scan.skipped?.notInPool > 0) && (
                <p className="mt-2 border-t border-slate-200 pt-2 text-[11px] leading-snug text-slate-400">
                  Not counted:
                  {scan.skipped.noPhone > 0 && <> {scan.skipped.noPhone} with no usable mobile</>}
                  {scan.skipped.noPhone > 0 && scan.skipped.notInPool > 0 && ' ·'}
                  {scan.skipped.notInPool > 0 && <> {scan.skipped.notInPool} taken off the follow-up list</>}
                  .
                </p>
              )}
            </>
          )}
        </div>
      )}

      {result && (
        <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          Done — {result.toppedUpContacts || 0} joined existing batches, {result.created} new batch
          {result.created === 1 ? '' : 'es'} created.
        </p>
      )}
    </Card>
  );
}
