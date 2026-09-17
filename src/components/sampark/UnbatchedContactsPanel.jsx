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
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from 'react';
import { UserPlus, Loader2, ScanSearch, CalendarCheck, CheckCircle2, AlertTriangle } from 'lucide-react';
import { generateBatches, previewBatchGeneration } from '../../services/batchService';
import { subscribeToEvents, pickUpcomingEvent } from '../../services/eventService';
import { useAuth } from '../../hooks/usePermissions';
import { useToast } from '../../contexts/ToastContext';
import { Label, Select } from '../ui/Input';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

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
  const hasTarget = areas.length > 0 || mandals.length > 0;

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
    mandals,
    batchSize: 40,
    onlyUncalled: false,
    skipAlreadyBatched: true,
    requirePhone: true,
    onlyCallingPool: true,
    topUpExisting: true,
    batchRows,
    eventId: eventId || null,
  }), [areas, mandals, batchRows, eventId]);

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
        This finds them and puts them into the batches already being called — a new batch is only
        cut for whoever doesn’t fit. Nothing already assigned is renumbered or moved.
        {scoped && <> Limited to the areas and mandals assigned to you.</>}
      </p>

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
          {scanning ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking…</> : <><ScanSearch className="h-3.5 w-3.5" /> Check for new contacts</>}
        </Button>
        {scan && unbatched > 0 && (
          <Button variant="accent" onClick={handleApply} disabled={applying}>
            {applying ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Adding…</> : <>Add {unbatched} to batches</>}
          </Button>
        )}
      </div>

      {!hasTarget && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          No areas or mandals are assigned to you, so there is nothing to scan.
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
