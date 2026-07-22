// src/pages/ContactsPage.jsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Home, Pencil, Trash2, Upload, Eye, X, ChevronLeft, ChevronRight } from "lucide-react";
import { useAllContacts } from "../hooks/useAllContacts";
import { useHouseholds } from "../hooks/useHouseholds";
import { useAreasAndMandals } from "../hooks/useAreasAndMandals";
import { useAuth } from "../hooks/usePermissions";
import IndividualForm from "../components/individuals/IndividualForm";
import AddToHousehold from "../components/individuals/AddToHousehold";
import ImportContactsWizard from "../components/import-export/ImportContactsWizard";
import Modal from "../components/ui/Modal";
import RequirePermission from "../components/RequirePermission";
import ExportButtons from "../components/import-export/ExportButtons";
import { formatDate } from "../lib/dateHelpers";
import { statusColorClasses } from "../lib/callingStatuses";
import { Button } from "../components/ui/Button";
import { Input, Select } from "../components/ui/Input";
import { Avatar } from "../components/ui/Avatar";
import { Badge } from "../components/ui/Badge";

const PAGE_SIZE = 20;

function isThisMonth(dateStr) {
  if (!dateStr) return false;
  const now = new Date();
  const parts = String(dateStr).split("-");
  if (parts.length < 2) return false;
  const month = parseInt(parts[1], 10) - 1;
  return month === now.getMonth();
}

function Pagination({ currentPage, totalPages, onPageChange }) {
  if (totalPages <= 1) return null;
  const getPages = () => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    if (currentPage <= 4) return [1, 2, 3, 4, 5, "…", totalPages];
    if (currentPage >= totalPages - 3) return [1, "…", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
    return [1, "…", currentPage - 1, currentPage, currentPage + 1, "…", totalPages];
  };
  return (
    <div className="mt-5 flex items-center justify-center gap-1">
      <button onClick={() => onPageChange(currentPage - 1)} disabled={currentPage === 1}
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40">
        <ChevronLeft className="h-4 w-4" />
      </button>
      {getPages().map((p, i) =>
        p === "…" ? (
          <span key={`e${i}`} className="flex h-8 w-8 items-center justify-center text-sm text-slate-400">…</span>
        ) : (
          <button key={p} onClick={() => onPageChange(p)}
            className={`flex h-8 w-8 items-center justify-center rounded-lg border text-sm font-medium transition ${p === currentPage ? "border-orange-500 bg-orange-500 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
            {p}
          </button>
        )
      )}
      <button onClick={() => onPageChange(currentPage + 1)} disabled={currentPage === totalPages}
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40">
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

export default function ContactsPage() {
  // Load ALL contacts (no pageSize) so filters, search, and select-all work across the full dataset
  const { contacts, loading, createContact, updateContact, deleteContact, bulkDeleteContacts, serverTotal, serverUngrouped, isViewAll } = useAllContacts();
  const { households } = useHouseholds();
  const { areas, mandals } = useAreasAndMandals();
  const { permissions } = useAuth();
  const [search, setSearch] = useState("");
  const [mandalFilter, setMandalFilter] = useState("");
  const [areaFilter, setAreaFilter] = useState("");
  const [householdFilter, setHouseholdFilter] = useState("");
  const [birthdayMonth, setBirthdayMonth] = useState(false);
  const [anniversaryMonth, setAnniversaryMonth] = useState(false);
  const [missingPhotos, setMissingPhotos] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [formModal, setFormModal] = useState({ open: false, contact: null });
  const [attachModal, setAttachModal] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [selected, setSelected] = useState(new Set());

  const canDelete = permissions.includes("delete_contacts");

  const householdAddresses = useMemo(() => {
    const map = {};
    for (const h of households) map[h.id] = h.address;
    return map;
  }, [households]);

  const filtered = useMemo(() => {
    let rows = contacts.map(c => ({
      ...c,
      displayAddress: c.householdId ? householdAddresses[c.householdId] : c.address
    }));
    if (mandalFilter) rows = rows.filter((c) => c.mandal === mandalFilter);
    if (areaFilter) rows = rows.filter((c) => c.area === areaFilter);
    if (householdFilter === "with") rows = rows.filter((c) => c.householdId);
    if (householdFilter === "without") rows = rows.filter((c) => !c.householdId);
    if (birthdayMonth) rows = rows.filter((c) => isThisMonth(c.dob));
    if (anniversaryMonth) rows = rows.filter((c) => isThisMonth(c.anniversary));
    if (missingPhotos) rows = rows.filter((c) => c.photoPending === true);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((c) => c.name?.toLowerCase().includes(q) || c.mobile?.includes(q) || c.displayAddress?.toLowerCase().includes(q));
    }
    return rows;
  }, [contacts, search, mandalFilter, areaFilter, householdFilter, birthdayMonth, anniversaryMonth, missingPhotos, householdAddresses]);

  // Reset to page 1 on any filter change
  useEffect(() => { setCurrentPage(1); }, [mandalFilter, areaFilter, householdFilter, birthdayMonth, anniversaryMonth, missingPhotos, search]);

  // Drop selections that no longer appear in the filtered list
  useEffect(() => {
    const filteredIds = new Set(filtered.map((c) => c.id));
    setSelected((prev) => new Set([...prev].filter((id) => filteredIds.has(id))));
  }, [filtered]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageContacts = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const selectedContacts = useMemo(() => filtered.filter((c) => selected.has(c.id)), [filtered, selected]);

  const allFilteredSelected = selected.size === filtered.length && filtered.length > 0;
  const someSelected = selected.size > 0 && selected.size < filtered.length;

  function toggleOne(id) {
    setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  function toggleAllFiltered() {
    // Selects/deselects ALL filtered contacts — not just the current page
    setSelected((prev) => (allFilteredSelected ? new Set() : new Set(filtered.map((c) => c.id))));
  }

  async function handleFormSubmit(data) {
    if (formModal.contact) return updateContact(formModal.contact.id, data);
    const id = await createContact(data);
    return Boolean(id);
  }

  async function handleConfirmDelete() {
    if (!confirmDelete) return;
    await deleteContact(confirmDelete.id);
    setConfirmDelete(null);
  }

  async function handleBulkDelete() {
    setBulkDeleting(true);
    const ok = await bulkDeleteContacts([...selected]);
    setBulkDeleting(false);
    if (ok) { setSelected(new Set()); setBulkDeleteOpen(false); }
  }

  const hasActiveFilters = Boolean(search || mandalFilter || areaFilter || householdFilter || birthdayMonth || anniversaryMonth || missingPhotos);
  const totalCount = serverTotal ?? contacts.length;

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 tracking-tight">All Contacts</h1>
          <p className="text-sm text-slate-400">
            {hasActiveFilters ? (
              <><span className="text-orange-600">{filtered.length} match filters</span> of {totalCount} total</>
            ) : (
              <>{totalCount} {isViewAll ? "total" : "in your area"}{serverUngrouped ? <> · <span className="text-orange-500">{serverUngrouped} not yet grouped</span></> : null}</>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButtons rows={selected.size > 0 ? selectedContacts : filtered} label="contacts" />
          <RequirePermission permission="edit_contacts">
            <Button variant="secondary" onClick={() => setImportOpen(true)}><Upload className="h-3.5 w-3.5" /> Import</Button>
          </RequirePermission>
          <RequirePermission permission="edit_contacts">
            <Button variant="accent" onClick={() => setFormModal({ open: true, contact: null })}><Plus className="h-3.5 w-3.5" /> Add contact</Button>
          </RequirePermission>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or mobile…" className="w-56" />
        <Select value={mandalFilter} onChange={(e) => setMandalFilter(e.target.value)} className="w-40">
          <option value="">All Mandals</option>
          {mandals.map((m) => <option key={m.code || m.name} value={m.name}>{m.name}</option>)}
        </Select>
        <Select value={areaFilter} onChange={(e) => setAreaFilter(e.target.value)} className="w-40">
          <option value="">All Areas</option>
          {areas.map((a) => <option key={a.code || a.name} value={a.name}>{a.name}</option>)}
        </Select>
        <Select value={householdFilter} onChange={(e) => setHouseholdFilter(e.target.value)} className="w-44">
          <option value="">All contacts</option>
          <option value="with">In a household</option>
          <option value="without">Not grouped yet</option>
        </Select>
        {hasActiveFilters && (
          <button onClick={() => { setSearch(""); setMandalFilter(""); setAreaFilter(""); setHouseholdFilter(""); setBirthdayMonth(false); setAnniversaryMonth(false); setMissingPhotos(false); }}
            className="text-xs text-orange-600 hover:underline">Clear all</button>
        )}
      </div>

      {/* Birthday / Anniversary / Missing photos toggles */}
      <div className="mb-4 flex flex-wrap gap-2">
        <button onClick={() => setBirthdayMonth((v) => !v)}
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${birthdayMonth ? "border-orange-400 bg-orange-50 text-orange-700" : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"}`}>
          🎂 Birthdays this month
          {birthdayMonth && <X className="h-3 w-3" onClick={(e) => { e.stopPropagation(); setBirthdayMonth(false); }} />}
        </button>
        <button onClick={() => setAnniversaryMonth((v) => !v)}
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${anniversaryMonth ? "border-pink-400 bg-pink-50 text-pink-700" : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"}`}>
          💍 Anniversaries this month
          {anniversaryMonth && <X className="h-3 w-3" onClick={(e) => { e.stopPropagation(); setAnniversaryMonth(false); }} />}
        </button>
        <button onClick={() => setMissingPhotos((v) => !v)}
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${missingPhotos ? "border-violet-400 bg-violet-50 text-violet-700" : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"}`}>
          📷 Missing photos
          {missingPhotos && <X className="h-3 w-3" onClick={(e) => { e.stopPropagation(); setMissingPhotos(false); }} />}
        </button>
      </div>

      {/* Selection bar */}
      {selected.size > 0 && (
        <div className="mb-3 flex items-center justify-between rounded-lg border border-orange-200 bg-orange-50 px-4 py-2.5">
          <div className="flex items-center gap-3">
            <p className="text-sm font-medium text-orange-800">{selected.size} selected</p>
            {!allFilteredSelected && (
              <button className="text-xs text-orange-600 underline" onClick={toggleAllFiltered}>
                Select all {filtered.length}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
            {canDelete && (
              <Button variant="danger" size="sm" onClick={() => setBulkDeleteOpen(true)}>
                <Trash2 className="h-3.5 w-3.5" /> Delete {selected.size}
              </Button>
            )}
            <ExportButtons rows={selectedContacts} label={`${selected.size}-contacts`} />
          </div>
        </div>
      )}

      {/* Contact list */}
      {loading ? (
        <div className="space-y-1">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-slate-100" />)}</div>
      ) : filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 py-16 text-center text-slate-400">No contacts match your filters.</p>
      ) : (
        <div className="rounded-lg border border-slate-100">
          <RequirePermission permission="edit_contacts">
            <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/60 px-3 py-2">
              <input
                type="checkbox"
                checked={allFilteredSelected}
                ref={(el) => { if (el) el.indeterminate = someSelected; }}
                onChange={toggleAllFiltered}
                className="h-4 w-4 rounded accent-orange-600"
              />
              <span className="text-xs font-medium text-slate-500">
                {selected.size > 0
                  ? `${selected.size} of ${filtered.length} selected`
                  : `Select all ${filtered.length} contacts`}
              </span>
            </div>
          </RequirePermission>
          <div className="divide-y divide-slate-50">
            {pageContacts.map((c) => (
              <div key={c.id} className={`flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50/70 ${c._pending ? "opacity-60" : ""}`}>
                <RequirePermission permission="edit_contacts">
                  <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleOne(c.id)} className="h-4 w-4 shrink-0 rounded accent-orange-600" />
                </RequirePermission>
                <Avatar src={c.profilePhotoURL} name={c.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">{c.name}</p>
                  <p className="truncate text-xs text-slate-400">
                    {c.displayAddress ? c.displayAddress : (c.mobile || "No mobile")}
                    {c.mandal ? ` · ${c.mandal}` : ""}{c.area ? ` · ${c.area}` : ""}{c.dob ? ` · Born ${formatDate(c.dob)}` : ""}
                  </p>
                </div>
                {!c.householdId && <Badge tone="yellow">Not grouped</Badge>}
                {c.status && <Badge className={statusColorClasses(c.status)}>{c.status}</Badge>}
                <div className="flex shrink-0 gap-0.5">
                  <Link to={`/contacts/${c.id}`}>
                    <Button variant="ghost" size="icon" aria-label="View profile"><Eye className="h-3.5 w-3.5" /></Button>
                  </Link>
                  <RequirePermission permission="edit_contacts">
                    <Button variant="ghost" size="icon" onClick={() => setAttachModal(c)} aria-label="Add to household"><Home className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => setFormModal({ open: true, contact: c })} aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></Button>
                  </RequirePermission>
                  <RequirePermission permission="delete_contacts">
                    <Button variant="ghost" size="icon" onClick={() => setConfirmDelete(c)} aria-label="Delete" className="hover:bg-rose-50 hover:text-rose-500"><Trash2 className="h-3.5 w-3.5" /></Button>
                  </RequirePermission>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />

      {/* Edit / Add modal */}
      <Modal open={formModal.open} onClose={() => setFormModal({ open: false, contact: null })} title={formModal.contact ? "Edit contact" : "Add contact"}>
        <IndividualForm individual={formModal.contact} onSubmit={handleFormSubmit} onCancel={() => setFormModal({ open: false, contact: null })} />
      </Modal>

      {/* Attach to household */}
      <Modal open={Boolean(attachModal)} onClose={() => setAttachModal(null)} title={`Add ${attachModal?.name || ""} to a household`}>
        {attachModal && <AddToHousehold contact={attachModal} onDone={() => setAttachModal(null)} onCancel={() => setAttachModal(null)} />}
      </Modal>

      {/* Import */}
      <ImportContactsWizard open={importOpen} onClose={() => setImportOpen(false)} mode="standalone" />

      {/* Delete single */}
      <Modal open={Boolean(confirmDelete)} onClose={() => setConfirmDelete(null)} title="Delete this contact?" size="sm">
        <p className="text-sm text-slate-500">This permanently removes <span className="font-medium text-slate-700">{confirmDelete?.name}</span>. This cannot be undone.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button variant="dangerSolid" onClick={handleConfirmDelete}>Delete permanently</Button>
        </div>
      </Modal>

      {/* Bulk delete — admin only (canDelete gate) */}
      <Modal open={bulkDeleteOpen} onClose={() => setBulkDeleteOpen(false)} title={`Delete ${selected.size} contacts?`} size="sm">
        <p className="text-sm text-slate-500">
          This will <span className="font-semibold text-rose-600">permanently delete</span> all {selected.size} selected contact{selected.size !== 1 ? "s" : ""}. There is no way to recover them.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setBulkDeleteOpen(false)}>Cancel</Button>
          <Button variant="dangerSolid" onClick={handleBulkDelete} disabled={bulkDeleting}>
            {bulkDeleting ? "Deleting…" : `Delete ${selected.size} permanently`}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
