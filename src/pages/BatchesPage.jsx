// src/pages/BatchesPage.jsx
// PHASE 20 — was a thin wrapper around the manual checkbox picker. Now four
// tabs covering the whole batch lifecycle from Sevak Call:
//   Batches   → the roster: assign / unassign / rename / delete / progress
//   Generate  → split an area × mandal into equal batches automatically
//   Manual    → the original hand-picked selection (kept: it is the right tool
//               for a short, deliberate list, e.g. one mandal's karyakars)
//   Tools     → hand over a volunteer's batches, or clear the roster
//
// PHASE 21 — the page used to be gated as a whole on assign_batches, which meant
// an Area Moderator either could not open it or could re-cut the entire city's
// roster. Generating and assigning are now separate permissions and separate
// tabs, so a moderator gets the roster and the admin keeps the scissors.
//
// PHASE 24 — READS. This page pulled all ~420 households purely to work out which
// area names exist, and opened its own volunteers listener. Both now come from
// shared, already-open sources: the areas collection is 17 documents and the
// roster is one listener for the whole session.
//
// PHASE 25 — the `batches` listener lives HERE rather than inside BatchList. Two
// reasons: switching tabs used to tear it down and re-open it, re-charging every
// batch document each time, and the generator's "skip contacts already in another
// batch" filter re-read the same collection a third time. One listener, three
// readers.
import { useEffect, useMemo, useState } from 'react';
import { useAreasAndMandals } from '../hooks/useAreasAndMandals';
import { useVolunteers } from '../hooks/useVolunteers';
import { usePermissions } from '../hooks/usePermissions';
import { useToast } from '../contexts/ToastContext';
import { PERMISSIONS } from '../constants/permissions';
import { describeScope, SCOPE_KINDS } from '../lib/scope';
import { subscribeToBatches } from '../services/batchService';
import BatchAssignment from '../components/sampark/BatchAssignment';
import BatchGenerator from '../components/sampark/BatchGenerator';
import BatchList from '../components/sampark/BatchList';
import BatchAdminTools from '../components/sampark/BatchAdminTools';
import { cn } from '../lib/cn';

function BatchesPageInner() {
  const { areas: areaDefs, mandals: mandalDefs } = useAreasAndMandals();
  const { volunteers } = useVolunteers();
  const { hasPermission, scope } = usePermissions();
  const { showToast } = useToast();
  const [tab, setTab] = useState('list');
  const [batches, setBatches] = useState([]);
  const [batchesLoading, setBatchesLoading] = useState(true);

  // One listener for the page. BatchList narrows it by scope for display; the
  // generator needs the UNSCOPED list, because a contact already batched by
  // another moderator must not be handed out twice.
  useEffect(() => {
    const unsub = subscribeToBatches(
      (rows) => { setBatches(rows); setBatchesLoading(false); },
      (err) => { showToast({ type: 'error', message: err.message }); setBatchesLoading(false); },
    );
    return () => unsub();
  }, [showToast]);

  const canAssign = hasPermission(PERMISSIONS.ASSIGN_BATCHES);
  const canGenerate = hasPermission(PERMISSIONS.GENERATE_BATCHES);

  // Only the areas/mandals this person actually oversees are offered for
  // generation. A Vaishali moderator handed the full 17-area list would cut
  // batches for areas they cannot then see, which looks like the tool is broken.
  const allAreas = useMemo(
    () => [...new Set((areaDefs || []).map((a) => a.name || a).filter(Boolean))].sort(),
    [areaDefs],
  );
  const allMandals = useMemo(
    () => (mandalDefs || []).map((m) => m.name || m).filter(Boolean),
    [mandalDefs],
  );

  // PHASE 31 — narrow on whatever is ASSIGNED rather than on the scope kind. The
  // old test keyed off the kind alone, so a MANDAL-scoped Super Moderator was
  // handed every area in the city even when specific areas had been assigned to
  // them. An empty list still means "no restriction on this axis" — that is what
  // a mandal head with no areas genuinely has, since their column crosses them all.
  const areas = scope?.unrestricted || !scope?.areas?.length
    ? allAreas
    : allAreas.filter((a) => scope.areas.includes(a));
  const mandals = scope?.unrestricted || !scope?.mandals?.length
    ? allMandals
    : allMandals.filter((m) => scope.mandals.includes(m));

  // Did the two lists above get narrowed? The generator says "no mandals in your
  // scope" rather than "no mandals configured" when they did — the second reads
  // as an install-level fault and sends the karyakarta chasing an admin.
  const scoped = !scope?.unrestricted
    && (areas.length !== allAreas.length || mandals.length !== allMandals.length);

  const TABS = [
    { key: 'list', label: 'Batches', show: true },
    // Shown even without generate_batches, with an explanation inside. Hiding it
    // was worse than useless: a role that lost the permission (or never had it)
    // saw three tabs and no way to tell whether the feature was missing, broken,
    // or forbidden. The tab is the answer to that question.
    { key: 'generate', label: 'Generate', show: true },
    { key: 'manual', label: 'Manual', show: canAssign },
    // PHASE 40 — was canAssign only. The tab now also holds "Contacts not in any
    // batch", which is a generate_batches tool, so an admin who may cut batches
    // but not hand them out could not reach the one thing they need weekly.
    // BatchAdminTools shows only the cards the caller's permissions cover.
    { key: 'tools', label: 'Tools', show: canAssign || canGenerate },
  ].filter((t) => t.show);

  const activeTab = TABS.some((t) => t.key === tab) ? tab : 'list';

  return (
    <>
      {/* Horizontally scrollable so four tabs never wrap on a 320px screen */}
      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-100 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'shrink-0 border-b-2 px-4 py-2 text-sm font-medium transition-colors',
              activeTab === t.key ? 'border-orange-600 text-orange-700' : 'border-transparent text-slate-500 hover:text-slate-700',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'list' && (
        <BatchList volunteers={volunteers} batches={batches} loading={batchesLoading} />
      )}
      {activeTab === 'generate' && (canGenerate
        ? <BatchGenerator areas={areas} mandals={mandals} scoped={scoped} batchRows={batches} />
        : (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <p className="font-medium">Your role can’t cut new batches.</p>
            <p className="mt-1">
              Ask an admin to tick <strong>Generate Batches (cut new batches)</strong> for your role on
              Admin → Roles. It sits under “Calling &amp; Events”, next to “Assign Batches”.
            </p>
          </div>
        ))}
      {activeTab === 'manual' && <BatchAssignment areas={areas} volunteers={volunteers} />}
      {activeTab === 'tools' && (
        <BatchAdminTools
          volunteers={volunteers}
          areas={areas}
          mandals={mandals}
          batchRows={batches}
          scoped={scoped}
        />
      )}
    </>
  );
}

export default function BatchesPage() {
  const { hasAnyPermission, scope } = usePermissions();
  // Read access to the roster is enough to open the page — the tabs inside
  // decide what can actually be done.
  const canOpen = hasAnyPermission([
    PERMISSIONS.ASSIGN_BATCHES,
    PERMISSIONS.GENERATE_BATCHES,
  ]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="mb-1 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">Batches</h1>
      <p className="mb-5 text-sm text-slate-500">
        Cut contacts into calling batches by area and mandal, then hand them to volunteers.
        {!scope?.unrestricted && scope?.kind !== SCOPE_KINDS.NONE && (
          <> You are working in <span className="font-medium text-slate-700">{describeScope(scope)}</span>.</>
        )}
      </p>
      {canOpen
        ? <BatchesPageInner />
        : <div className="text-sm text-slate-500">You don't have permission to work with batches.</div>}
    </div>
  );
}
