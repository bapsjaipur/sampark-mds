// src/pages/HouseholdsPage.jsx — Phase 18: two-section sort (1.3), pagination (1.4)
import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../lib/firebase";
import { Link } from "react-router-dom";
import { Plus, Upload, Users } from "lucide-react";
import { useHouseholds, useFilteredHouseholds } from "../hooks/useHouseholds";
import { useAuth } from "../hooks/usePermissions";
import { useAreasAndMandals } from "../hooks/useAreasAndMandals";
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
const RECENTLY_ADDED_COUNT = 6;

export default function HouseholdsPage() {
  const { households, loading, hasMore, loadMore, createHousehold } = useHouseholds({ pageSize: PAGE_SIZE });
  const { areas: allAreas, mandals } = useAreasAndMandals();
  const { showToast } = useToast();
  const { permissions } = useAuth();
  const isViewAll = permissions.includes("view_all_contacts");
  const isViewAssigned = !isViewAll && (
    permissions.includes("view_assigned_contacts") || permissions.includes("edit_contacts")
  );
  const [areaFilter, setAreaFilter] = useState("");
  const [mandalFilter, setMandalFilter] = useState("");
  const [localSearch, setLocalSearch] = useState("");
  const [createdAfter, setCreatedAfter] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [individuals, setIndividuals] = useState([]);
  const [selected, setSelected] = useState(new Set());

  // For admins (view_all_contacts): query all individuals.
  // For scoped roles: Firestore denies an unfiltered collection query, so we
  // scope to the household IDs already loaded by useHouseholds (which is
  // already area-filtered). This ensures primary names show for all roles.
  const householdIdsKey = households.map((h) => h.id).join(",");
  useEffect(() => {
    if (isViewAll) {
      return onSnapshot(
        collection(db, "individuals"),
        (snap) => setIndividuals(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      );
    }
    const ids = households.map((h) => h.id);
    if (!ids.length) { setIndividuals([]); return; }
    const batches = [];
    for (let i = 0; i < ids.length; i += 30) batches.push(ids.slice(i, i + 30));
    const resultsMap = new Map();
    const unsubs = batches.map((batch) =>
      onSnapshot(
        query(collection(db, "individuals"), where("householdId", "in", batch)),
        (snap) => {
          snap.docs.forEach((d) => resultsMap.set(d.id, { id: d.id, ...d.data() }));
          setIndividuals([...resultsMap.values()]);
        }
      )
    );
    return () => unsubs.forEach((u) => u());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isViewAll, isViewAssigned, householdIdsKey]);

  const filteredByHook = useFilteredHouseholds(households, { area: areaFilter, searchTerm: localSearch });
  const filtered = useMemo(() => {
    let result = mandalFilter ? filteredByHook.filter((h) => h.mandal === mandalFilter) : filteredByHook;
    if (createdAfter) {
      const cutoff = new Date(createdAfter).getTime();
      result = result.filter((h) => {
        const ts = h.createdAt?.toMillis?.() ?? (h.createdAt instanceof Date ? h.createdAt.getTime() : 0);
        return ts >= cutoff;
      });
    }
    return result;
  }, [filteredByHook, mandalFilter, createdAfter]);

  const areas = useMemo(
    () => [...new Set(allAreas.map((a) => (typeof a === "string" ? a : a.name)).filter(Boolean))].sort(),
    [allAreas]
  );

  const primaryNameByHousehold = useMemo(() => {
    const map = new Map();
    individuals.forEach((ind) => { if (ind.isPrimary || !map.has(ind.householdId)) map.set(ind.householdId, ind.name); });
    return map;
  }, [individuals]);

  const hasActiveFilters = Boolean(areaFilter || mandalFilter || localSearch || createdAfter);

  // 1.3 — split into Recently Added + All Households (alpha) when no filters.
  const { recentSection, allSection } = useMemo(() => {
    if (hasActiveFilters) return { recentSection: [], allSection: filtered };

    const byCreatedAt = [...filtered].sort((a, b) => {
      const ta = a.createdAt?.toMillis?.() ?? (a.createdAt instanceof Date ? a.createdAt.getTime() : 0);
      const tb = b.createdAt?.toMillis?.() ?? (b.createdAt instanceof Date ? b.createdAt.getTime() : 0);
      return tb - ta;
    });
    const recentIds = new Set(byCreatedAt.slice(0, RECENTLY_ADDED_COUNT).map((h) => h.id));

    const rest = filtered
      .filter((h) => !recentIds.has(h.id))
      .sort((a, b) => {
        const nameA = (primaryNameByHousehold.get(a.id) || a.address || "").toLowerCase();
        const nameB = (primaryNameByHousehold.get(b.id) || b.address || "").toLowerCase();
        return nameA.localeCompare(nameB);
      });

    return { recentSection: byCreatedAt.slice(0, RECENTLY_ADDED_COUNT), allSection: rest };
  }, [filtered, hasActiveFilters, primaryNameByHousehold]);

  useEffect(() => {
    const filteredIds = new Set(filtered.map((h) => h.id));
    setSelected((prev) => new Set([...prev].filter((id) => filteredIds.has(id))));
  }, [filtered]);

  // Members of selected households — exported when user clicks Export Selected
  const selectedHouseholdMembers = useMemo(
    () => individuals.filter((ind) => selected.has(ind.householdId)),
    [individuals, selected]
  );

  function toggleOne(id) {
    setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  function toggleAllFiltered() {
    setSelected((prev) => (prev.size === filtered.length ? new Set() : new Set(filtered.map((h) => h.id))));
  }


  function HouseholdCard({ h }) {
    return (
      <Card className={`relative p-4 transition hover:border-slate-200 hover:shadow-sm ${h._pending ? "opacity-60" : ""}`}>
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
          <p className="text-sm text-slate-400">{h.area}{h.mandal ? ` · ${h.mandal}` : ""}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-400">
            <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" /> {h.totalFamilyMembers || 0}</span>
            {h.level && <span>· {h.level}</span>}
            {h.createdAt && (() => {
              const d = h.createdAt?.toDate?.() ?? (h.createdAt instanceof Date ? h.createdAt : null);
              return d ? <span>· Added {d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span> : null;
            })()}
          </div>
        </Link>
      </Card>
    );
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
          placeholder="Filter this list…"
          className="h-9 w-48 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-600 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-300"
        />
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-slate-500 whitespace-nowrap">Added after</label>
          <input
            type="date"
            value={createdAfter}
            onChange={(e) => setCreatedAfter(e.target.value)}
            className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-600 focus:outline-none focus:ring-1 focus:ring-slate-300"
          />
          {createdAfter && (
            <button onClick={() => setCreatedAfter("")}
              className="rounded p-0.5 text-sm leading-none text-slate-400 hover:text-slate-700">✕</button>
          )}
        </div>
      </div>

      {selected.size > 0 && (
        <div className="mb-3 flex items-center justify-between rounded-lg border border-orange-200 bg-orange-50 px-4 py-2.5">
          <p className="text-sm font-medium text-orange-800">{selected.size} household{selected.size !== 1 ? "s" : ""} selected ({selectedHouseholdMembers.length} member{selectedHouseholdMembers.length !== 1 ? "s" : ""})</p>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
            <ExportButtons rows={selectedHouseholdMembers} label={`${selected.size}-households`} />
          </div>
        </div>
      )}

      {loading ? (
        <ListSkeleton />
      ) : filtered.length === 0 ? (
        <EmptyState hasFilters={hasActiveFilters} />
      ) : (
        <>
          <RequirePermission permission="edit_contacts">
            <div className="mb-2 flex items-center gap-3 px-1">
              <input type="checkbox" checked={selected.size === filtered.length && filtered.length > 0} onChange={toggleAllFiltered} className="h-4 w-4 rounded accent-orange-600" />
              <span className="text-xs font-medium text-slate-500">Select all {filtered.length} filtered</span>
            </div>
          </RequirePermission>

          {!hasActiveFilters && recentSection.length > 0 && (
            <div className="mb-6">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Recently Added</p>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {recentSection.map((h) => <HouseholdCard key={h.id} h={h} />)}
              </div>
            </div>
          )}

          {allSection.length > 0 && (
            <div>
              {!hasActiveFilters && recentSection.length > 0 && (
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">All Households</p>
              )}
              <div className="grid gap-2.5 sm:grid-cols-2">
                {allSection.map((h) => <HouseholdCard key={h.id} h={h} />)}
              </div>
            </div>
          )}

          {hasMore && (
            <div className="mt-5 flex flex-col items-center gap-1">
              <Button variant="secondary" onClick={loadMore}>Load more households</Button>
              {hasActiveFilters && (
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
