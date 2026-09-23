// src/components/sampark/BatchAdminTools.jsx
// PHASE 20 — the two bulk operations from Sevak Call's admin panel:
//   reassignContacts()  — move every batch from one volunteer to another
//   clearAllBatches()   — wipe the batch roster
//
// The legacy versions were both a single button behind a browser confirm(). The
// clear-all is guarded here by a typed phrase instead: it deletes every
// assignment in the system, and a mis-tap on a phone should not be able to do
// that. reassignContacts additionally supports unassigning (target = nobody),
// which the sheet version could not do — it required a target name and silently
// did nothing when left blank.
// PHASE 40 — and a third tool, the one used weekly rather than twice a year:
// UnbatchedContactsPanel, "who isn't in a batch". It answers the question that
// used to force a full re-Generate every time a few contacts were added mid-week.
// It carries its own permission gate (generate_batches) because the other two
// tools here are assign_batches — cutting batches and handing them out are
// deliberately separate permissions, and this tab now shows whichever of the
// three you are actually allowed to use.
import { useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, CalendarClock, ShieldAlert } from 'lucide-react';
import { reassignContacts, clearAllBatches, repointBatches } from '../../services/batchService';
import { getRecentEventsForReports, pickUpcomingEvent } from '../../services/eventService';
import { eventInScope } from '../../lib/scope';
import { usePermissions } from '../../hooks/usePermissions';
import { PERMISSIONS } from '../../constants/permissions';
import { useToast } from '../../contexts/ToastContext';
import { confirmDialog } from '../ui/ConfirmHost';
import { Input, Label } from '../ui/Input';
import SearchableSelect from '../ui/SearchableSelect';
import UnbatchedContactsPanel from './UnbatchedContactsPanel';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

const CLEAR_PHRASE = 'DELETE ALL BATCHES';

// One-line "2026-09-14 — Sunday Sabha (Vaishali Nagar)" label for a sabha picker.
function eventLabel(e) {
  if (!e) return '';
  const scope = e.mandal || e.area || (Array.isArray(e.areas) && e.areas[0]) || '';
  return `${e.date || '????'} — ${e.title || 'Sabha'}${scope ? ` (${scope})` : ''}`;
}

export default function BatchAdminTools({ volunteers, areas = [], mandals = [], batchRows = null, scoped = false }) {
  const { showToast } = useToast();
  const { hasPermission, scope } = usePermissions();
  const canAssign = hasPermission(PERMISSIONS.ASSIGN_BATCHES);
  const canGenerate = hasPermission(PERMISSIONS.GENERATE_BATCHES);

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [moving, setMoving] = useState(false);

  const [phrase, setPhrase] = useState('');
  const [clearing, setClearing] = useState(false);

  // PHASE 41 — re-point the whole roster at a new sabha. The sabha menu is a
  // capped one-time read (not a listener): this card is opened once a week, and
  // the reports/generation that read events are the heavy jobs, not this pick.
  const [events, setEvents] = useState([]);
  const [targetEventId, setTargetEventId] = useState('');
  const [repointing, setRepointing] = useState(false);

  useEffect(() => {
    getRecentEventsForReports(40)
      .then((rows) => setEvents(rows))
      .catch((err) => console.warn('[BatchAdminTools] sabhas unavailable:', err.message));
  }, []);

  const allBatches = batchRows || [];

  // PHASE 43 — a scoped volunteer only re-points at their own mandal's/area's
  // sabhas, matching the Events tab and the other Batches pickers. Admins (GLOBAL
  // / unrestricted) keep the full list.
  const visibleEvents = useMemo(() => events.filter((e) => eventInScope(scope, e)), [events, scope]);
  const targetEvent = visibleEvents.find((e) => e.id === targetEventId) || null;

  // Default to the nearest sabha in scope that hasn't finished yet — the recurring
  // one the scheduler just materialised — so the common "roll forward to next
  // week" case is one click. Falls back to the newest if all are past. Guarded so
  // a later snapshot can't drag a hand-picked sabha back to the default.
  useEffect(() => {
    if (!visibleEvents.length) return;
    const upcoming = pickUpcomingEvent(visibleEvents);
    setTargetEventId((cur) => cur || upcoming?.id || visibleEvents[0]?.id || '');
  }, [visibleEvents]);

  // What are the batches aimed at right now? Summarise so the admin sees what
  // they are moving away from before they move it.
  const currentTarget = useMemo(() => {
    if (!allBatches.length) return null;
    const dates = new Set(allBatches.map((b) => b.eventDate || b.eventId || '∅'));
    if (dates.size === 1) {
      const one = allBatches[0];
      return { count: allBatches.length, label: one.eventDate || one.eventId || 'no sabha set', mixed: false };
    }
    return { count: allBatches.length, label: `${dates.size} different sabhas`, mixed: true };
  }, [allBatches]);

  const activeVolunteers = volunteers.filter((v) => v.isActive !== false);
  const nameOf = (id) => volunteers.find((v) => v.id === id)?.name || 'that volunteer';

  async function handleReassign() {
    if (!from) return;
    const target = to ? nameOf(to) : 'nobody (they become unassigned)';
    const ok = await confirmDialog({
      title: `Move every batch belonging to ${nameOf(from)} to ${target}?`,
      confirmText: 'Move batches',
    });
    if (!ok) return;
    setMoving(true);
    try {
      const res = await reassignContacts({ fromVolunteerId: from, toVolunteerId: to || null });
      if (res.moved === 0) {
        showToast({ type: 'info', message: `${nameOf(from)} has no batches assigned.` });
      } else {
        showToast({
          type: 'success',
          message: `Moved ${res.moved} batch${res.moved === 1 ? '' : 'es'} (${res.contacts} contacts).`,
        });
        setFrom(''); setTo('');
      }
    } catch (err) {
      showToast({ type: 'error', message: err.message });
    } finally {
      setMoving(false);
    }
  }

  async function handleClearAll() {
    if (phrase !== CLEAR_PHRASE) return;
    setClearing(true);
    try {
      const res = await clearAllBatches();
      showToast({ type: 'success', message: `Deleted ${res.deleted} batch${res.deleted === 1 ? '' : 'es'}.` });
      setPhrase('');
    } catch (err) {
      showToast({ type: 'error', message: err.message });
    } finally {
      setClearing(false);
    }
  }

  async function handleRepoint() {
    if (!targetEvent || !allBatches.length) return;
    const ok = await confirmDialog({
      title: `Point all ${allBatches.length} batch${allBatches.length === 1 ? '' : 'es'} at “${eventLabel(targetEvent)}”?`,
      message: 'The same batches, the same people in them and who they are assigned to all stay exactly as they are — only the sabha they are calling for changes. Call statuses are untouched. You can re-point again at any time.',
      confirmText: 'Re-point batches',
    });
    if (!ok) return;
    setRepointing(true);
    try {
      const res = await repointBatches({
        batchIds: allBatches.map((b) => b.id),
        eventId: targetEvent.id,
        eventDate: targetEvent.date || null,
      });
      showToast({
        type: 'success',
        message: `Re-pointed ${res.updated} batch${res.updated === 1 ? '' : 'es'} to ${targetEvent.date || 'the selected sabha'}.`,
      });
    } catch (err) {
      showToast({ type: 'error', message: err.message });
    } finally {
      setRepointing(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* First, because it is the only one of the three that has a reason to be
          opened every week. The other two are for a volunteer leaving and for
          starting the year over. */}
      {canGenerate && (
        <UnbatchedContactsPanel areas={areas} mandals={mandals} batchRows={batchRows} scoped={scoped} />
      )}

      {/* PHASE 41 — roll the SAME roster forward onto the next sabha. Generate once,
          then every week just re-point rather than re-cutting (which would reshuffle
          who calls whom and drop call statuses). Defaults to the upcoming recurring
          sabha; pick another to override. */}
      {canAssign && allBatches.length > 0 && (
      <Card className="p-4">
        <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-slate-900">
          <CalendarClock className="h-4 w-4 text-slate-400" /> Point batches at the next sabha
        </h3>
        <p className="mb-3 text-xs text-slate-500">
          Keeps the exact same batches, the people in them and who they’re assigned to — only the sabha
          they’re calling for changes. Use this to reuse last round’s clubbing for the upcoming event
          instead of cutting fresh batches. Call statuses are left untouched.
        </p>
        {currentTarget && (
          <p className="mb-3 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
            {currentTarget.mixed
              ? <>Your <strong>{currentTarget.count}</strong> batches currently point at <strong>{currentTarget.label}</strong>.</>
              : <><strong>{currentTarget.count}</strong> batch{currentTarget.count === 1 ? '' : 'es'} currently calling for <strong>{currentTarget.label}</strong>.</>}
          </p>
        )}
        <Label>Point them at</Label>
        {visibleEvents.length > 0 ? (
          <SearchableSelect
            value={targetEventId}
            onChange={setTargetEventId}
            placeholder="Choose a sabha"
            searchPlaceholder="Search sabhas…"
            options={visibleEvents.map((e) => ({ value: e.id, label: eventLabel(e) }))}
          />
        ) : (
          <p className="text-xs text-slate-400">No sabhas found. Create one on the Events screen first.</p>
        )}
        <Button
          variant="primary"
          className="mt-3 w-full sm:w-auto"
          onClick={handleRepoint}
          disabled={!targetEventId || repointing}
        >
          {repointing ? 'Re-pointing…' : `Re-point ${allBatches.length} batch${allBatches.length === 1 ? '' : 'es'}`}
        </Button>
      </Card>
      )}

      {canAssign && (
      <Card className="p-4">
        <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-slate-900">
          <ArrowRightLeft className="h-4 w-4 text-slate-400" /> Hand over a volunteer's batches
        </h3>
        <p className="mb-4 text-xs text-slate-500">
          For when someone is travelling or steps back. Contact statuses and notes are untouched — only who
          the batch belongs to changes.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>From</Label>
            <SearchableSelect
              value={from}
              onChange={setFrom}
              placeholder="Select a volunteer"
              searchPlaceholder="Search volunteers…"
              options={volunteers.map((v) => ({
                value: v.id,
                label: `${v.name}${v.isActive === false ? ' (disabled)' : ''}`,
              }))}
            />
          </div>
          <div>
            <Label>To</Label>
            <SearchableSelect
              value={to}
              onChange={setTo}
              emptyOption={{ label: 'Nobody — leave unassigned' }}
              searchPlaceholder="Search volunteers…"
              options={activeVolunteers.filter((v) => v.id !== from).map((v) => ({ value: v.id, label: v.name }))}
            />
          </div>
        </div>

        <Button variant="primary" className="mt-4 w-full sm:w-auto" onClick={handleReassign} disabled={!from || moving}>
          {moving ? 'Moving…' : 'Move batches'}
        </Button>
      </Card>
      )}

      {canAssign && (
      <Card className="border-rose-200 p-4">
        <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-rose-700">
          <ShieldAlert className="h-4 w-4" /> Delete every batch
        </h3>
        <p className="mb-3 text-xs text-slate-500">
          Removes the whole batch roster so a new calling round can be generated from scratch. Contact
          statuses, references and call counts are <strong>not</strong> affected — but every volunteer's
          queue empties immediately. Cannot be undone.
        </p>
        <Label>Type <code className="rounded bg-slate-100 px-1 py-0.5 text-[11px]">{CLEAR_PHRASE}</code> to enable</Label>
        <Input value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder={CLEAR_PHRASE} />
        <Button
          variant="dangerSolid"
          className="mt-3 w-full sm:w-auto"
          onClick={handleClearAll}
          disabled={phrase !== CLEAR_PHRASE || clearing}
        >
          {clearing ? 'Deleting…' : 'Delete all batches'}
        </Button>
      </Card>
      )}
    </div>
  );
}
