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
import { useState } from 'react';
import { ArrowRightLeft, ShieldAlert } from 'lucide-react';
import { reassignContacts, clearAllBatches } from '../../services/batchService';
import { usePermissions } from '../../hooks/usePermissions';
import { PERMISSIONS } from '../../constants/permissions';
import { useToast } from '../../contexts/ToastContext';
import { Input, Label } from '../ui/Input';
import SearchableSelect from '../ui/SearchableSelect';
import UnbatchedContactsPanel from './UnbatchedContactsPanel';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

const CLEAR_PHRASE = 'DELETE ALL BATCHES';

export default function BatchAdminTools({ volunteers, areas = [], mandals = [], batchRows = null, scoped = false }) {
  const { showToast } = useToast();
  const { hasPermission } = usePermissions();
  const canAssign = hasPermission(PERMISSIONS.ASSIGN_BATCHES);
  const canGenerate = hasPermission(PERMISSIONS.GENERATE_BATCHES);

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [moving, setMoving] = useState(false);

  const [phrase, setPhrase] = useState('');
  const [clearing, setClearing] = useState(false);

  const activeVolunteers = volunteers.filter((v) => v.isActive !== false);
  const nameOf = (id) => volunteers.find((v) => v.id === id)?.name || 'that volunteer';

  async function handleReassign() {
    if (!from) return;
    const target = to ? nameOf(to) : 'nobody (they become unassigned)';
    if (!window.confirm(`Move every batch belonging to ${nameOf(from)} to ${target}?`)) return;
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

  return (
    <div className="space-y-4">
      {/* First, because it is the only one of the three that has a reason to be
          opened every week. The other two are for a volunteer leaving and for
          starting the year over. */}
      {canGenerate && (
        <UnbatchedContactsPanel areas={areas} mandals={mandals} batchRows={batchRows} scoped={scoped} />
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
