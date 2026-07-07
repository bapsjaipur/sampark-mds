// src/pages/ContactsPage.jsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Home, Pencil, Trash2, Upload, Eye, MapPin, X } from "lucide-react";
import { writeBatch, doc, serverTimestamp } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAllContacts } from "../hooks/useAllContacts";
import { useAreasAndMandals } from "../hooks/useAreasAndMandals";
import { bulkDeleteIndividuals } from "../services/bulkService";
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
import { useToast } from "../contexts/ToastContext";

const PAGE_SIZE = 20;

function isThisMonth(dateStr) {
  if (!dateStr) return false;
  const now = new Date();
  const parts = String(dateStr).split("-");
  if (parts.length < 2) return false;
  const month = parseInt(parts[1], 10) - 1;
  return month === now.getMonth();
}

export default function ContactsPage() {
  const { contacts, loading, hasMore, loadMore, createContact, updateContact, deleteContact, serverTotal, serverUngrouped, isViewAll, isViewAssigned } = useAllContacts({ pageSize: PAGE_SIZE });
  const { areas, mandals } = useAreasAndMandals();
  const { showToast } = useToast();
  const [search, setSearch] = useState("");
  const [mandalFilter, setMandalFilter] = useState("");
  const [areaFilter, setAreaFilter] = useState("");
  const [householdFilter, setHouseholdFilter] = useState("");
  const [birthdayMonth, setBirthdayMonth] = useState(false);
  const [anniversaryMonth, setAnniversaryMonth] = useState(false);
  const [formModal, setFormModal] = useState({ open: false, contact: null });
  const [attachModal, setAttachModal] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [assignAreaModal, setAssignAreaModal] = useState(false);
  const [assigningArea, setAssigningArea] = useState("");
  const [assigningBusy, setAssigningBusy] = useState(false);

  const filtered = useMemo(() => {
    let rows = contacts;
    if (mandalFilter) rows = rows.filter((c) => c.mandal === mandalFilter);
    if (areaFilter) rows = rows.filter((c) => c.area === areaFilter);
    if (householdFilter === "with") rows = rows.filter((c) => c.householdId);
    if (householdFilter === "without") rows = rows.filter((c) => !c.householdId);
    if (birthdayMonth) rows = rows.filter((c) => isThisMonth(c.dob));
    if (anniversaryMonth) rows = rows.filter((c) => isThisMonth(c.anniversary));
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((c) => c.name?.toLowerCase().includes(q) || c.mobile?.includes(q));
    }
    return rows;
  }, [contacts, search, mandalFilter, areaFilter, householdFilter, birthdayMonth, anniversaryMonth]);

  useEffect(() => {
    const filteredIds = new Set(filtered.map((c) => c.id));
    setSelected((prev) => new Set([...prev].filter((id) => filteredIds.has(id))));
  }, [filtered]);

  function toggleOne(id) {
    setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  function toggleAllFiltered() {
    setSelected((prev) => (prev.size === filtered.length ? new Set() : new Set(filtered.map((c) => c.id))));
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
    try {
      const count = await bulkDeleteIndividuals([...selected]);
      showToast({ type: "success", message: `${count} contact(s) deleted.` });
      setSelected(new Set());
      setConfirmBulkDelete(false);
    } catch (err) {
      showToast({ type: "error", message: "Bulk delete failed partway through. Check your permissions." });
    } finally {
      setBulkDeleting(false);
    }
  }

  async function handleBulkAssignArea() {
    if (!assigningArea) return;
    setAssigningBusy(true);
    try {
      const ids = [...selected];
      const CHUNK = 400;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const batch = writeBatch(db);
        ids.slice(i, i + CHUNK).forEach((id) => {
          batch.update(doc(db, "individuals", id), { area: assigningArea, updatedAt: serverTimestamp() });
        });
        await batch.commit();
      }
      showToast({ type: "success", message: `Area updated for ${ids.length} contact(s).` });
      setSelected(new Set());
      setAssignAreaModal(false);
      setAssigningArea("");
    } catch {
      showToast({ type: "error", message: "Area assignment failed. Check your permissions." });
    } finally {
      setAssigningBusy(false);
    }
  }

  const hasActiveFilters = Boolean(search || mandalFilter || areaFilter || householdFilter || birthdayMonth || anniversaryMonth);

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 tracking-tight">All Contacts</h1>
          <p className="text-sm text-slate-400">
            {serverTotal !== null
              ? <>{serverTotal} {isViewAll ? "total" : "in your area"}</>
              : <>{contacts.length}{hasMore ? "+" : ""} loaded</>
            }
            {hasActiveFilters
              ? <> &middot; <span className="text-orange-600">{filtered.length} match filters</span></>
              : serverUngrouped !== null
                ? <> &middot; <span className="text-orange-500">{serverUngrouped} not yet grouped</span></>
                : !hasMore && contacts.some((c) => !c.householdId)
                  ? <> &middot; {contacts.filter((c) => !c.householdId).length} not yet grouped</>
                  : null
            }
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButtons rows={filtered} label="contacts" />
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
      </div>

      {/* 2.4 — Birthday / Anniversary this-month toggles */}
      <div className="mb-4 flex flex-wrap gap-2">
        <button
          onClick={() => setBirthdayMonth((v) => !v)}
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${birthdayMonth ? "border-orange-400 bg-orange-50 text-orange-700" : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"}`}
        >
          🎂 Birthdays this month
          {birthdayMonth && <X className="h-3 w-3" onClick={(e) => { e.stopPropagation(); setBirthdayMonth(false); }} />}
        </button>
        <button
          onClick={() => setAnniversaryMonth((v) => !v)}
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${anniversaryMonth ? "border-pink-400 bg-pink-50 text-pink-700" : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"}`}
        >
          💍 Anniversaries this month
          {anniversaryMonth && <X className="h-3 w-3" onClick={(e) => { e.stopPropagation(); setAnniversaryMonth(false); }} />}
        </button>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="mb-3 flex items-center justify-between rounded-lg border border-orange-200 bg-orange-50 px-4 py-2.5">
          <p className="text-sm font-medium text-orange-800">{selected.size} selected</p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
            <RequirePermission permission="edit_contacts">
              <Button variant="secondary" size="sm" onClick={() => setAssignAreaModal(true)}><MapPin className="h-3.5 w-3.5" /> Assign area</Button>
            </RequirePermission>
            <RequirePermission permission="bulk_delete_contacts">
              <Button variant="dangerSolid" size="sm" onClick={() => setConfirmBulkDelete(true)}><Trash2 className="h-3.5 w-3.5" /> Delete {selected.size}</Button>
            </RequirePermission>
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
              <input type="checkbox" checked={selected.size === filtered.length && filtered.length > 0} onChange={toggleAllFiltered} className="h-4 w-4 rounded accent-orange-600" />
              <span className="text-xs font-medium text-slate-500">Select all {filtered.length} filtered</span>
            </div>
          </RequirePermission>
          <div className="divide-y divide-slate-50">
            {filtered.map((c) => (
              <div key={c.id} className={`flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50/70 ${c._pending ? "opacity-60" : ""}`}>
                <RequirePermission permission="edit_contacts">
                  <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleOne(c.id)} className="h-4 w-4 shrink-0 rounded accent-orange-600" />
                </RequirePermission>
                <Avatar src={c.profilePhotoURL} name={c.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">{c.name}</p>
                  <p className="truncate text-xs text-slate-400">
                    {c.mobile || "No mobile"}{c.mandal ? ` · ${c.mandal}` : ""}{c.area ? ` · ${c.area}` : ""}{c.dob ? ` · Born ${formatDate(c.dob)}` : ""}
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

      {!loading && hasMore && (
        <div className="mt-5 flex flex-col items-center gap-1">
          <Button variant="secondary" onClick={loadMore}>Load more contacts</Button>
          {hasActiveFilters && (
            <p className="text-xs text-slate-400">Filters apply to loaded contacts only — load more to widen the search.</p>
          )}
        </div>
      )}

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
        <p className="text-sm text-slate-500">This permanently removes <span className="font-medium text-slate-700">{confirmDelete?.name}</span>. This can't be undone.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button variant="dangerSolid" onClick={handleConfirmDelete}>Delete</Button>
        </div>
      </Modal>

      {/* Bulk delete */}
      <Modal open={confirmBulkDelete} onClose={() => setConfirmBulkDelete(false)} title={`Delete ${selected.size} contacts?`} size="sm">
        <p className="text-sm text-slate-500">This permanently deletes all {selected.size} selected contacts. This can't be undone.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmBulkDelete(false)}>Cancel</Button>
          <Button variant="dangerSolid" onClick={handleBulkDelete} disabled={bulkDeleting}>{bulkDeleting ? "Deleting…" : `Delete ${selected.size}`}</Button>
        </div>
      </Modal>

      {/* 2.5 — Bulk assign area */}
      <Modal open={assignAreaModal} onClose={() => { setAssignAreaModal(false); setAssigningArea(""); }} title={`Assign area to ${selected.size} contact(s)`} size="sm">
        <p className="mb-3 text-sm text-slate-500">All selected contacts will be moved to this area.</p>
        <Select value={assigningArea} onChange={(e) => setAssigningArea(e.target.value)} className="w-full">
          <option value="">Pick an area…</option>
          {areas.map((a) => <option key={a.code || a.name} value={a.name}>{a.name}</option>)}
        </Select>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => { setAssignAreaModal(false); setAssigningArea(""); }}>Cancel</Button>
          <Button variant="accent" onClick={handleBulkAssignArea} disabled={!assigningArea || assigningBusy}>
            {assigningBusy ? "Saving…" : `Assign to ${selected.size}`}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
