// src/pages/HouseholdsPage.jsx — Phase 16: added Mandal filter + bulk
// (cascade) delete, same pattern as ContactsPage.
import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../lib/firebase";
import { Link } from "react-router-dom";
import { Plus, Upload, Users, Trash2 } from "lucide-react";
import { useHouseholds, useFilteredHouseholds } from "../hooks/useHouseholds";
import { useAreasAndMandals } from "../hooks/useAreasAndMandals";
import { bulkDeleteHouseholdsCascade } from "../services/bulkService";
import GlobalSearchBar from "../components/search/GlobalSearchBar";
import HouseholdForm from "../components/households/HouseholdForm";
import Modal from "../components/ui/Modal";
import RequirePermission from "../components/RequirePermission";
import ImportContactsWizard from "../components/import-export/ImportContactsWizard";
import ExportButtons from "../components/import-export/ExportButtons";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Select } from "../components/ui/Input";
import { useToast } from "../contexts/ToastContext";

const PAGE_SIZE = 20;

export default function HouseholdsPage() {
  const { households, loading, hasMore, loadMore, createHousehold } = useHouseholds({ pageSize: PAGE_SIZE });
  const { areas: allAreas, mandals } = useAreasAndMandals();
  const { showToast } = useToast();
  const [areaFilter, setAreaFilter] = useState("");
  const [mandalFilter, setMandalFilter] = useState("");
  const [localSearch, setLocalSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [individuals, setIndividuals] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  useEffect(() => onSnapshot(collection(db, "individuals"), (snap) => setIndividuals(snap.docs.map((d) => ({ id: d.id, ...d.data() })))), []);

  const filteredByHook = useFilteredHouseholds(households, { area: areaFilter, searchTerm: localSearch });
  const filtered = useMemo(() => mandalFilter ? filteredByHook.filter((h) => h.mandal === mandalFilter) : filteredByHook, [filteredByHook, mandalFilter]);

  // Sourced from the reference collection (not loaded households) so the
  // filter stays complete under pagination — loaded pages may not contain
  // every area. Normalized to plain strings (useAreasAndMandals yields
  // {name} objects; DEFAULT_AREAS may be strings).
  const areas = useMemo(
    () => [...new Set(allAreas.map((a) => (typeof a === "string" ? a : a.name)).filter(Boolean))].sort(),
    [allAreas]
  );

  const primaryNameByHousehold = useMemo(() => {
    const map = new Map();
    individuals.forEach((ind) => { if (ind.isPrimary || !map.has(ind.householdId)) map.set(ind.householdId, ind.name); });
    return map;
  }, [individuals]);

  useEffect(() => {
    const filteredIds = new Set(filtered.map((h) => h.id));
    setSelected((prev) => new Set([...prev].filter((id) => filteredIds.has(id))));
  }, [filtered]);

  function toggleOne(id) {
    setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  function toggleAllFiltered() {
    setSelected((prev) => (prev.size === filtered.length ? new Set() : new Set(filtered.map((h) => h.id))));
  }

  async function handleBulkDelete() {
    setBulkDeleting(true);
    try {
      const { householdsRemoved, individualsRemoved } = await bulkDeleteHouseholdsCascade([...selected]);
      showToast({ type: "success", message: `${householdsRemoved} household(s) and ${individualsRemoved} member(s) deleted.` });
      setSelected(new Set());
      setConfirmBulkDelete(false);
    } catch (err) {
      showToast({ type: "error", message: "Bulk delete failed partway through. Check your permissions." });
    } finally {
      setBulkDeleting(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 tracking-tight">Households</h1>
          <p className="text-sm text-slate-400">{households.length}{hasMore ? "+" : ""} households loaded</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButtons rows={individuals} label="contacts" />
          <RequirePermission permission="edit_contacts">
            <Button variant="secondary" onClick={() => setImportOpen(true)}><Upload className="h-3.5 w-3.5" /> Import</Button>
          </RequirePermission>
          <RequirePermission permission="edit_contacts">
            <Button variant="accent" onClick={() => setAddOpen(true)}><Plus className="h-3.5 w-3.5" /> Add household</Button>
          </RequirePermission>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <GlobalSearchBar households={households} />
        <Select value={areaFilter} onChange={(e) => setAreaFilter(e.target.value)} className="w-44">
          <option value="">All areas</option>
          {areas.map((a) => <option key={a} value={a}>{a}</option>)}
        </Select>
        <Select value={mandalFilter} onChange={(e) => setMandalFilter(e.target.value)} className="w-44">
          <option value="">All Mandals</option>
          {mandals.map((m) => <option key={m.code || m.name} value={m.name}>{m.name}</option>)}
        </Select>
        <input
          value={localSearch}
          onChange={(e) => setLocalSearch(e.target.value)}
          placeholder="Filter this list\u2026"
          className="h-9 w-48 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-600 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-300"
        />
      </div>

      <RequirePermission permission="edit_contacts">
        {selected.size > 0 && (
          <div className="mb-3 flex items-center justify-between rounded-lg border border-orange-200 bg-orange-50 px-4 py-2.5">
            <p className="text-sm font-medium text-orange-800">{selected.size} selected</p>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
              <Button variant="dangerSolid" size="sm" onClick={() => setConfirmBulkDelete(true)}><Trash2 className="h-3.5 w-3.5" /> Delete {selected.size}</Button>
            </div>
          </div>
        )}
      </RequirePermission>

      {loading ? (
        <ListSkeleton />
      ) : filtered.length === 0 ? (
        <EmptyState hasFilters={Boolean(areaFilter || mandalFilter || localSearch)} />
      ) : (
        <>
          <RequirePermission permission="edit_contacts">
            <div className="mb-2 flex items-center gap-3 px-1">
              <input type="checkbox" checked={selected.size === filtered.length && filtered.length > 0} onChange={toggleAllFiltered} className="h-4 w-4 rounded accent-orange-600" />
              <span className="text-xs font-medium text-slate-500">Select all {filtered.length} filtered</span>
            </div>
          </RequirePermission>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {filtered.map((h) => (
              <Card key={h.id} className={`relative p-4 transition hover:border-slate-200 hover:shadow-sm ${h._pending ? "opacity-60" : ""}`}>
                <RequirePermission permission="edit_contacts">
                  <input
                    type="checkbox"
                    checked={selected.has(h.id)}
                    onChange={(e) => { e.preventDefault(); toggleOne(h.id); }}
                    className="absolute right-3 top-3 h-4 w-4 rounded accent-orange-600"
                  />
                </RequirePermission>
                <Link to={`/households/${h.id}`} className="block pr-6">
                  <p className="font-medium text-slate-900">{primaryNameByHousehold.get(h.id) || h.address || "Unnamed household"}</p>
                  <p className="text-sm text-slate-400">{h.area}{h.mandal ? ` \u00b7 ${h.mandal}` : ""}</p>
                  <div className="mt-2 flex items-center gap-3 text-xs text-slate-400">
                    <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" /> {h.totalFamilyMembers || 0}</span>
                    {h.level && <span>\u00b7 {h.level}</span>}
                  </div>
                </Link>
              </Card>
            ))}
          </div>
          {hasMore && (
            <div className="mt-5 flex flex-col items-center gap-1">
              <Button variant="secondary" onClick={loadMore}>Load more households</Button>
              {(areaFilter || mandalFilter || localSearch) && (
                <p className="text-xs text-slate-400">Filters apply to loaded households only — load more to search the rest.</p>
              )}
            </div>
          )}
        </>
      )}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add household">
        <HouseholdForm onSubmit={createHousehold} onCancel={() => setAddOpen(false)} />
      </Modal>

      <ImportContactsWizard open={importOpen} onClose={() => setImportOpen(false)} mode="household" />

      <Modal open={confirmBulkDelete} onClose={() => setConfirmBulkDelete(false)} title={`Delete ${selected.size} households?`} size="sm">
        <p className="text-sm text-slate-500">This permanently deletes all {selected.size} selected households AND every member in each of them. This can't be undone.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmBulkDelete(false)}>Cancel</Button>
          <Button variant="dangerSolid" onClick={handleBulkDelete} disabled={bulkDeleting}>{bulkDeleting ? "Deleting\u2026" : `Delete ${selected.size}`}</Button>
        </div>
      </Modal>
    </div>
  );
}

function ListSkeleton() {
  return <div className="grid gap-2.5 sm:grid-cols-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-lg bg-slate-100" />)}</div>;
}

function EmptyState({ hasFilters }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-200 py-16 text-center">
      <p className="text-slate-500">{hasFilters ? "No households match your filters." : "No households yet."}</p>
      {hasFilters && <p className="mt-1 text-sm text-slate-400">Try a different area, Mandal, or search term.</p>}
    </div>
  );
}
