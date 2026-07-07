// src/pages/HouseholdsPage.jsx — Phase 18: two-section sort (1.3), pagination (1.4)
import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../lib/firebase";
import { Link } from "react-router-dom";
import { Plus, Trash2, Upload, Users, ChevronLeft, ChevronRight, BarChart2 } from "lucide-react";
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
  // No pageSize — load all households so stats, filters, and page-based
  // pagination work across the full dataset, not just the current page.
  const { households, loading, createHousehold, deleteHousehold, deleteHouseholdOnly } = useHouseholds();
  const { areas: allAreas, mandals } = useAreasAndMandals();
  const { showToast } = useToast();
  const { permissions, hasPermission } = useAuth();
  const canDelete = hasPermission("delete_contacts") || hasPermission("manage_users");
  const isViewAll = permissions.includes("view_all_contacts");
  const isViewAssigned = !isViewAll && (
    permissions.includes("view_assigned_contacts") || permissions.includes("edit_contacts")
  );
  const [areaFilter, setAreaFilter] = useState("");
  const [mandalFilter, setMandalFilter] = useState("");
  const [localSearch, setLocalSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [showStats, setShowStats] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
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
    const getTs = (h) => h.createdAt?.toMillis?.() ?? (h.createdAt instanceof Date ? h.createdAt.getTime() : 0);
    if (dateFrom) { const from = new Date(dateFrom).getTime(); result = result.filter((h) => getTs(h) >= from); }
    if (dateTo)   { const to = new Date(dateTo).setHours(23, 59, 59, 999);  result = result.filter((h) => getTs(h) <= to); }
    return result;
  }, [filteredByHook, mandalFilter, dateFrom, dateTo]);

  const areas = useMemo(
    () => [...new Set(allAreas.map((a) => (typeof a === "string" ? a : a.name)).filter(Boolean))].sort(),
    [allAreas]
  );

  const primaryNameByHousehold = useMemo(() => {
    const map = new Map();
    individuals.forEach((ind) => { if (ind.isPrimary || !map.has(ind.householdId)) map.set(ind.householdId, ind.name); });
    return map;
  }, [individuals]);

  // Actual member count per household from loaded individuals — used when
  // totalFamilyMembers was skipped at entry time.
  const memberCountByHousehold = useMemo(() => {
    const map = new Map();
    individuals.forEach((ind) => { if (ind.householdId) map.set(ind.householdId, (map.get(ind.householdId) || 0) + 1); });
    return map;
  }, [individuals]);

  // Area-wise breakdown across ALL loaded households (not just filtered page)
  const areaStats = useMemo(() => {
    const counts = {};
    households.forEach((h) => { const a = h.area || "Unknown"; counts[a] = (counts[a] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [households]);

  // Monthly creation counts — last 12 months
  const monthlyStats = useMemo(() => {
    const counts = {};
    households.forEach((h) => {
      const ts = h.createdAt?.toDate?.() ?? (h.createdAt instanceof Date ? h.createdAt : null);
      if (!ts) return;
      const key = `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, "0")}`;
      counts[key] = (counts[key] || 0) + 1;
    });
    return Object.entries(counts).sort().slice(-12);
  }, [households]);

  const hasActiveFilters = Boolean(areaFilter || mandalFilter || localSearch || dateFrom || dateTo);

  // Split into Recently Added (page 1, no filters) + alphabetical All Households.
  // allSection is then sliced by currentPage for client-side pagination.
  const { recentSection, allSection, totalPages } = useMemo(() => {
    if (hasActiveFilters) {
      const total = Math.ceil(filtered.length / PAGE_SIZE);
      const page = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
      return { recentSection: [], allSection: page, totalPages: total };
    }

    const byCreatedAt = [...filtered].sort((a, b) => {
      const ta = a.createdAt?.toMillis?.() ?? (a.createdAt instanceof Date ? a.createdAt.getTime() : 0);
      const tb = b.createdAt?.toMillis?.() ?? (b.createdAt instanceof Date ? b.createdAt.getTime() : 0);
      return tb - ta;
    });
    const recentIds = currentPage === 1
      ? new Set(byCreatedAt.slice(0, RECENTLY_ADDED_COUNT).map((h) => h.id))
      : new Set();

    const rest = filtered
      .filter((h) => !recentIds.has(h.id))
      .sort((a, b) => {
        const nameA = (primaryNameByHousehold.get(a.id) || a.address || "").toLowerCase();
        const nameB = (primaryNameByHousehold.get(b.id) || b.address || "").toLowerCase();
        return nameA.localeCompare(nameB);
      });

    const total = Math.ceil(rest.length / PAGE_SIZE);
    const page = rest.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
    return {
      recentSection: currentPage === 1 ? byCreatedAt.slice(0, RECENTLY_ADDED_COUNT) : [],
      allSection: page,
      totalPages: total,
    };
  }, [filtered, hasActiveFilters, primaryNameByHousehold, currentPage]);

  useEffect(() => {
    const filteredIds = new Set(filtered.map((h) => h.id));
    setSelected((prev) => new Set([...prev].filter((id) => filteredIds.has(id))));
    setCurrentPage(1);
  }, [areaFilter, mandalFilter, localSearch, dateFrom, dateTo]);

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

  async function handleBulkDeleteWithMembers() {
    setConfirmBulkDelete(false);
    const ids = [...selected];
    for (const id of ids) await deleteHousehold(id);
    setSelected(new Set());
  }

  async function handleBulkDeleteWithoutMembers() {
    setConfirmBulkDelete(false);
    const ids = [...selected];
    for (const id of ids) await deleteHouseholdOnly(id);
    setSelected(new Set());
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
            <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" /> {h.totalFamilyMembers || memberCountByHousehold.get(h.id) || 0}</span>
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
          <p className="text-sm text-slate-400">
            {loading ? "Loading…" : hasActiveFilters
              ? `${filtered.length} of ${households.length} households`
              : `${households.length} households total`}
          </p>
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

      {/* Stats overview */}
      {!loading && households.length > 0 && (
        <div className="mb-4 rounded-xl border border-slate-100 bg-slate-50">
          <button
            onClick={() => setShowStats((s) => !s)}
            className="flex w-full items-center justify-between px-4 py-2.5 text-left"
          >
            <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <BarChart2 className="h-3.5 w-3.5" /> Overview
            </span>
            <ChevronRight className={`h-4 w-4 text-slate-400 transition-transform ${showStats ? "rotate-90" : ""}`} />
          </button>
          {showStats && (
            <div className="border-t border-slate-100 px-4 pb-4 pt-3">
              {/* Area breakdown */}
              <p className="mb-2 text-xs font-medium text-slate-500">By area</p>
              <div className="flex flex-wrap gap-2 mb-4">
                {areaStats.map(([area, count]) => (
                  <button
                    key={area}
                    onClick={() => setAreaFilter(areaFilter === area ? "" : area)}
                    className={`rounded-lg border px-3 py-1.5 text-left transition ${areaFilter === area ? "border-orange-300 bg-orange-50" : "border-slate-200 bg-white hover:border-slate-300"}`}
                  >
                    <p className="text-sm font-semibold text-slate-800">{count}</p>
                    <p className="text-xs text-slate-500">{area}</p>
                  </button>
                ))}
              </div>
              {/* Monthly creation */}
              {monthlyStats.length > 0 && (
                <>
                  <p className="mb-2 text-xs font-medium text-slate-500">Added by month</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {monthlyStats.map(([key, count]) => {
                      const [yr, mo] = key.split("-");
                      const label = new Date(+yr, +mo - 1).toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
                      return (
                        <span key={key} className="text-xs text-slate-600">
                          <span className="font-medium">{label}</span>: {count}
                        </span>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

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
        {/* Date range filter */}
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-slate-500 whitespace-nowrap">Added</label>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-600 focus:outline-none focus:ring-1 focus:ring-slate-300" />
          <span className="text-xs text-slate-400">–</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-600 focus:outline-none focus:ring-1 focus:ring-slate-300" />
          {(dateFrom || dateTo) && (
            <button onClick={() => { setDateFrom(""); setDateTo(""); }}
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
            {canDelete && (
              <Button variant="ghost" size="sm" onClick={() => setConfirmBulkDelete(true)} className="text-rose-600 hover:bg-rose-50 hover:text-rose-700">
                <Trash2 className="h-3.5 w-3.5" /> Delete {selected.size}
              </Button>
            )}
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

          <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
        </>
      )}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add household">
        <HouseholdForm onSubmit={createHousehold} onCancel={() => setAddOpen(false)} />
      </Modal>

      <ImportContactsWizard open={importOpen} onClose={() => setImportOpen(false)} mode="household" />

      <Modal open={confirmBulkDelete} onClose={() => setConfirmBulkDelete(false)} title={`Delete ${selected.size} household${selected.size !== 1 ? "s" : ""}?`}>
        <p className="text-sm text-slate-600 mb-1">
          These <strong>{selected.size} household{selected.size !== 1 ? "s" : ""}</strong> contain <strong>{selectedHouseholdMembers.length} member{selectedHouseholdMembers.length !== 1 ? "s" : ""}</strong>. Choose what happens to those members:
        </p>
        <div className="mt-4 flex flex-col gap-3">
          <button
            onClick={handleBulkDeleteWithoutMembers}
            className="w-full rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-left hover:bg-amber-100 transition"
          >
            <p className="font-medium text-amber-800">Delete household only</p>
            <p className="text-xs text-amber-700 mt-0.5">
              The {selectedHouseholdMembers.length} member{selectedHouseholdMembers.length !== 1 ? "s" : ""} will be kept as standalone contacts. Your data is safe.
            </p>
          </button>
          <button
            onClick={handleBulkDeleteWithMembers}
            className="w-full rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-left hover:bg-rose-100 transition"
          >
            <p className="font-medium text-rose-700">Delete household + all members</p>
            <p className="text-xs text-rose-600 mt-0.5">
              Permanently removes the household and all {selectedHouseholdMembers.length} member{selectedHouseholdMembers.length !== 1 ? "s" : ""}. This cannot be undone.
            </p>
          </button>
          <Button variant="ghost" onClick={() => setConfirmBulkDelete(false)} className="w-full">Cancel</Button>
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

function Pagination({ currentPage, totalPages, onPageChange }) {
  if (totalPages <= 1) return null;

  const btnBase = "flex h-8 min-w-[2rem] items-center justify-center rounded-lg border px-2 text-sm font-medium transition";
  const activeCls = "border-orange-400 bg-orange-50 text-orange-700";
  const idleCls = "border-slate-200 bg-white text-slate-600 hover:border-slate-300";
  const disabledCls = "border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed";

  const getPages = () => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    if (currentPage <= 4) return [1, 2, 3, 4, 5, "…", totalPages];
    if (currentPage >= totalPages - 3) return [1, "…", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
    return [1, "…", currentPage - 1, currentPage, currentPage + 1, "…", totalPages];
  };

  return (
    <div className="mt-6 flex items-center justify-center gap-1">
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
        className={`${btnBase} ${currentPage === 1 ? disabledCls : idleCls}`}
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      {getPages().map((p, i) =>
        p === "…" ? (
          <span key={`e${i}`} className="px-1 text-slate-400">…</span>
        ) : (
          <button
            key={p}
            onClick={() => onPageChange(p)}
            className={`${btnBase} ${p === currentPage ? activeCls : idleCls}`}
          >
            {p}
          </button>
        )
      )}

      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        className={`${btnBase} ${currentPage === totalPages ? disabledCls : idleCls}`}
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
