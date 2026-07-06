// src/pages/HouseholdDetailPage.jsx — Attio redesign.
import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, Pencil, Trash2, Plus, Search } from "lucide-react";
import { useHouseholds } from "../hooks/useHouseholds";
import { useIndividuals } from "../hooks/useIndividuals";
import IndividualCard from "../components/individuals/IndividualCard";
import IndividualForm from "../components/individuals/IndividualForm";
import LinkExistingContact from "../components/individuals/LinkExistingContact";
import HouseholdForm from "../components/households/HouseholdForm";
import Modal from "../components/ui/Modal";
import RequirePermission from "../components/RequirePermission";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";

export default function HouseholdDetailPage() {
  const { householdId } = useParams();
  const navigate = useNavigate();
  const { households, updateHousehold, deleteHousehold } = useHouseholds();
  const { individuals, loading, createIndividual, updateIndividual, deleteIndividual } = useIndividuals(householdId);

  const household = households.find((h) => h.id === householdId);
  // Sampark Karyakarta now lives on the individual, not the household (see
  // IndividualForm.jsx). The Primary member's Sampark represents the whole
  // household by default; `household.samparkKaryakartaName` is only read as
  // a fallback for older households saved before this change.
  const primaryMember = individuals.find((i) => i.isPrimary && i.samparkKaryakartaName);
  const householdSamparkName = primaryMember?.samparkKaryakartaName || household?.samparkKaryakartaName;
  const householdSamparkNumber = primaryMember?.samparkKaryakartaNumber || household?.samparkKaryakartaNumber;

  const [editHouseholdOpen, setEditHouseholdOpen] = useState(false);
  const [addChoiceOpen, setAddChoiceOpen] = useState(false);
  const [memberModal, setMemberModal] = useState({ open: false, individual: null });
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmDeleteHousehold, setConfirmDeleteHousehold] = useState(false);
  const [deletingHousehold, setDeletingHousehold] = useState(false);

  if (!household) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16 text-center">
        <p className="text-slate-400">Household not found, or still loading\u2026</p>
        <Link to="/households" className="mt-2 inline-block text-sm text-orange-600 hover:underline">\u2190 Back to households</Link>
      </div>
    );
  }

  const handleMemberSubmit = async (data) => {
    if (memberModal.individual) return updateIndividual(memberModal.individual.id, data);
    const id = await createIndividual(data);
    return Boolean(id);
  };

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return;
    await deleteIndividual(confirmDelete.id);
    setConfirmDelete(null);
  };

  const handleDeleteHousehold = async () => {
    setDeletingHousehold(true);
    const ok = await deleteHousehold(household.id);
    setDeletingHousehold(false);
    if (ok) navigate('/households');
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <Link to="/households" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-600">
        <ArrowLeft className="h-3.5 w-3.5" /> All households
      </Link>

      <Card className="mt-3 flex flex-wrap items-start justify-between gap-4 p-6">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 tracking-tight">{household.address}</h1>
          <p className="text-sm text-slate-400">{household.area}{household.mandal ? ` \u00b7 ${household.mandal}` : ""}</p>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-500">
            {household.level && <span>Level: {household.level}</span>}
            <span>{household.totalFamilyMembers || 0} family members</span>
            {householdSamparkName && <span>Sampark: {householdSamparkName}{householdSamparkNumber ? ` (${householdSamparkNumber})` : ""}</span>}
          </div>
          {household.remark && <p className="mt-3 text-sm text-slate-400 italic">"{household.remark}"</p>}
        </div>
        <RequirePermission permission="edit_contacts">
          <div className="flex shrink-0 gap-2">
            <Button variant="secondary" size="sm" onClick={() => setEditHouseholdOpen(true)}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
            <Button variant="danger" size="sm" onClick={() => setConfirmDeleteHousehold(true)}><Trash2 className="h-3.5 w-3.5" /> Delete</Button>
          </div>
        </RequirePermission>
      </Card>

      <div className="mt-8 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-slate-900">Family members</h2>
        <RequirePermission permission="edit_contacts">
          <Button variant="accent" size="sm" onClick={() => setAddChoiceOpen(true)}><Plus className="h-3.5 w-3.5" /> Add member</Button>
        </RequirePermission>
      </div>

      <div className="mt-4 space-y-2">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-lg bg-slate-100" />)
        ) : individuals.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 py-10 text-center text-slate-400">No family members added yet.</p>
        ) : (
          individuals.map((i) => (
            <IndividualCard key={i.id} individual={i} onEdit={(ind) => setMemberModal({ open: true, individual: ind })} onDelete={setConfirmDelete} />
          ))
        )}
      </div>

      <Modal open={addChoiceOpen} onClose={() => setAddChoiceOpen(false)} title="Add family member" size="sm">
        <div className="space-y-3">
          <button onClick={() => { setAddChoiceOpen(false); setMemberModal({ open: true, individual: null }); }} className="w-full rounded-lg border border-slate-200 p-4 text-left hover:border-slate-300 hover:bg-slate-50">
            <p className="flex items-center gap-2 font-medium text-slate-900"><Plus className="h-4 w-4 text-slate-400" /> Add a new person</p>
            <p className="mt-0.5 text-xs text-slate-400">Someone not already in the system.</p>
          </button>
          <button onClick={() => { setAddChoiceOpen(false); setLinkModalOpen(true); }} className="w-full rounded-lg border border-slate-200 p-4 text-left hover:border-slate-300 hover:bg-slate-50">
            <p className="flex items-center gap-2 font-medium text-slate-900"><Search className="h-4 w-4 text-slate-400" /> Link an existing contact</p>
            <p className="mt-0.5 text-xs text-slate-400">Search by name or phone and move them into this household.</p>
          </button>
        </div>
      </Modal>

      <Modal open={memberModal.open} onClose={() => setMemberModal({ open: false, individual: null })} title={memberModal.individual ? "Edit member" : "Add family member"}>
        <IndividualForm individual={memberModal.individual} onSubmit={handleMemberSubmit} onCancel={() => setMemberModal({ open: false, individual: null })} withinHousehold householdArea={household.area || ""} />
      </Modal>

      <Modal open={linkModalOpen} onClose={() => setLinkModalOpen(false)} title="Link an existing contact">
        <LinkExistingContact currentHouseholdId={household.id} onLinked={() => setLinkModalOpen(false)} onCancel={() => setLinkModalOpen(false)} />
      </Modal>

      <Modal open={editHouseholdOpen} onClose={() => setEditHouseholdOpen(false)} title="Edit household">
        <HouseholdForm household={household} onSubmit={(data) => updateHousehold(household.id, data)} onCancel={() => setEditHouseholdOpen(false)} />
      </Modal>

      <Modal open={Boolean(confirmDelete)} onClose={() => setConfirmDelete(null)} title="Remove family member?" size="sm">
        <p className="text-sm text-slate-500">This removes <span className="font-medium text-slate-700">{confirmDelete?.name}</span> from this household. This can't be undone.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button variant="dangerSolid" onClick={handleConfirmDelete}>Remove</Button>
        </div>
      </Modal>

      <Modal open={confirmDeleteHousehold} onClose={() => setConfirmDeleteHousehold(false)} title="Delete this household?" size="sm">
        <p className="text-sm text-slate-500">
          This permanently deletes this household{individuals.length > 0 ? <> and all <span className="font-medium text-slate-700">{individuals.length}</span> member(s) in it</> : ''}. This can't be undone.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDeleteHousehold(false)}>Cancel</Button>
          <Button variant="dangerSolid" onClick={handleDeleteHousehold} disabled={deletingHousehold}>{deletingHousehold ? 'Deleting\u2026' : 'Delete household'}</Button>
        </div>
      </Modal>
    </div>
  );
}
