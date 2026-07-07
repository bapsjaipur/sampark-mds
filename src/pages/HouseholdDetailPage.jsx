// src/pages/HouseholdDetailPage.jsx — Phase 18: member viewer (1.2), activity timeline (1.5), merge (1.7)
import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, Pencil, Trash2, Plus, Search, ChevronLeft, ChevronRight, X, Merge, Clock } from "lucide-react";
import { collection, query, where, orderBy, onSnapshot, getDocs, writeBatch, serverTimestamp, doc } from "firebase/firestore";
import { db } from "../lib/firebase";
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
import { Avatar } from "../components/ui/Avatar";
import { useToast } from "../contexts/ToastContext";
import { formatDate } from "../lib/dateHelpers";
import { logActivity } from "../lib/activityLog";
import { useAuth } from "../hooks/usePermissions";

// ── 1.2 Member Viewer ──────────────────────────────────────────────────────
function MemberViewer({ individuals, startIndex, onClose }) {
  const [idx, setIdx] = useState(startIndex);
  const touchStartX = useRef(null);
  const ind = individuals[idx];

  function prev() { setIdx((i) => Math.max(0, i - 1)); }
  function next() { setIdx((i) => Math.min(individuals.length - 1, i + 1)); }

  function handleTouchStart(e) { touchStartX.current = e.touches[0].clientX; }
  function handleTouchEnd(e) {
    if (touchStartX.current === null) return;
    const delta = e.changedTouches[0].clientX - touchStartX.current;
    if (delta < -50) next();
    else if (delta > 50) prev();
    touchStartX.current = null;
  }

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  if (!ind) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 backdrop-blur-sm px-4"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div className="relative w-full max-w-sm rounded-2xl bg-white shadow-2xl overflow-hidden">
        <button onClick={onClose} className="absolute right-3 top-3 z-10 rounded-full bg-white/80 p-1.5 text-slate-500 hover:bg-white hover:text-slate-900">
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-center justify-between bg-slate-50 px-4 py-2 text-xs text-slate-400">
          <span>{idx + 1} of {individuals.length}</span>
          <div className="flex gap-1">
            {individuals.map((_, i) => (
              <button key={i} onClick={() => setIdx(i)} className={`h-1.5 w-1.5 rounded-full transition-colors ${i === idx ? "bg-orange-500" : "bg-slate-300"}`} />
            ))}
          </div>
        </div>

        <div className="flex flex-col items-center gap-3 px-8 py-8">
          {ind.profilePhotoURL ? (
            <img src={ind.profilePhotoURL} alt={ind.name} className="h-28 w-28 rounded-full object-cover ring-2 ring-slate-100" />
          ) : (
            <Avatar name={ind.name} size="xl" />
          )}
          <div className="text-center">
            <p className="text-lg font-semibold text-slate-900">{ind.name}</p>
            {ind.isPrimary && <span className="mt-0.5 inline-block rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">Primary</span>}
          </div>
          <div className="w-full space-y-1.5 text-sm text-slate-600">
            {ind.mobile && <p><span className="text-slate-400">Mobile:</span> {ind.mobile}</p>}
            {ind.mandal && <p><span className="text-slate-400">Mandal:</span> {ind.mandal}</p>}
            {ind.relation && <p><span className="text-slate-400">Relation:</span> {ind.relation}</p>}
            {ind.dob && <p><span className="text-slate-400">DOB:</span> {formatDate(ind.dob)}</p>}
            {ind.anniversary && <p><span className="text-slate-400">Anniversary:</span> {formatDate(ind.anniversary)}</p>}
            {ind.study && <p><span className="text-slate-400">Study:</span> {ind.study}</p>}
            {ind.profession && <p><span className="text-slate-400">Profession:</span> {ind.profession}</p>}
            {ind.skill && <p><span className="text-slate-400">Skill:</span> {ind.skill}</p>}
            {ind.samparkKaryakartaName && <p><span className="text-slate-400">Sampark:</span> {ind.samparkKaryakartaName}{ind.samparkKaryakartaNumber ? ` (${ind.samparkKaryakartaNumber})` : ""}</p>}
          </div>
        </div>

        <div className="flex border-t border-slate-100">
          <button onClick={prev} disabled={idx === 0} className="flex flex-1 items-center justify-center gap-1.5 py-3 text-sm text-slate-500 hover:bg-slate-50 disabled:opacity-30">
            <ChevronLeft className="h-4 w-4" /> Prev
          </button>
          <div className="w-px bg-slate-100" />
          <button onClick={next} disabled={idx === individuals.length - 1} className="flex flex-1 items-center justify-center gap-1.5 py-3 text-sm text-slate-500 hover:bg-slate-50 disabled:opacity-30">
            Next <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 1.5 Activity Timeline ──────────────────────────────────────────────────
const ACTION_LABELS = {
  create_household: "Household created",
  update_household: "Household updated",
  create_individual: "Member added",
  update_individual: "Member updated",
  delete_individual: "Member removed",
  upload_photo: "Photo uploaded",
};

function ActivityTimeline({ householdId, memberIds }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ids = [householdId, ...memberIds].filter(Boolean);
    if (!ids.length) { setLoading(false); return; }

    // Query by householdId in details, plus activity directly on members
    const q = query(
      collection(db, "activity"),
      where("individualId", "in", ids.slice(0, 10)),
      orderBy("timestamp", "desc")
    );
    const unsub = onSnapshot(q, (snap) => {
      setEntries(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, [householdId, memberIds.join(",")]);

  if (loading) return <div className="h-10 animate-pulse rounded bg-slate-100" />;
  if (!entries.length) return <p className="text-sm text-slate-400">No activity recorded yet.</p>;

  return (
    <div className="space-y-2">
      {entries.slice(0, 20).map((e) => {
        const ts = e.timestamp?.toDate?.();
        return (
          <div key={e.id} className="flex items-start gap-3 text-sm">
            <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
            <div className="min-w-0 flex-1">
              <p className="text-slate-700">{ACTION_LABELS[e.action] || e.action}</p>
              <p className="text-xs text-slate-400">{ts ? ts.toLocaleString() : "—"}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── 1.7 Merge Households ──────────────────────────────────────────────────
function MergeHouseholdModal({ sourceHousehold, onClose }) {
  const [search, setSearch] = useState("");
  const [allHouseholds, setAllHouseholds] = useState([]);
  const [merging, setMerging] = useState(false);
  const { showToast } = useToast();
  const { volunteer } = useAuth();

  useEffect(() => {
    getDocs(collection(db, "households")).then((snap) =>
      setAllHouseholds(snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((h) => h.id !== sourceHousehold.id))
    );
  }, [sourceHousehold.id]);

  const candidates = allHouseholds.filter((h) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return h.address?.toLowerCase().includes(q) || h.area?.toLowerCase().includes(q);
  });

  async function handleMerge(target) {
    if (!window.confirm(`Move all members from "${sourceHousehold.address || "this household"}" into "${target.address || target.id}"? The source household will be deleted.`)) return;
    setMerging(true);
    try {
      const membersSnap = await getDocs(query(collection(db, "individuals"), where("householdId", "==", sourceHousehold.id)));
      const batch = writeBatch(db);
      membersSnap.forEach((d) => {
        batch.update(d.ref, { householdId: target.id, updatedAt: serverTimestamp() });
      });
      batch.delete(doc(db, "households", sourceHousehold.id));
      await batch.commit();
      logActivity({ volunteerId: volunteer?.id, action: "merge_household", details: { from: sourceHousehold.id, into: target.id, moved: membersSnap.size } });
      showToast({ type: "success", message: `${membersSnap.size} member(s) moved. Household deleted.` });
      onClose(target.id);
    } catch (err) {
      console.error(err);
      showToast({ type: "error", message: "Merge failed. Nothing was changed." });
    } finally {
      setMerging(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">Search for the household to merge into. All members will be moved there and this household will be deleted.</p>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by address or area…"
        className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-slate-300"
        autoFocus
      />
      <div className="max-h-64 overflow-y-auto space-y-1">
        {candidates.slice(0, 30).map((h) => (
          <div key={h.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm hover:border-slate-200 hover:bg-slate-50">
            <div>
              <p className="font-medium text-slate-800">{h.address || "Unnamed"}</p>
              <p className="text-xs text-slate-400">{h.area}</p>
            </div>
            <Button variant="accent" size="sm" onClick={() => handleMerge(h)} disabled={merging}>
              {merging ? "Merging…" : "Merge here"}
            </Button>
          </div>
        ))}
        {candidates.length === 0 && <p className="py-4 text-center text-sm text-slate-400">No households found.</p>}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────
export default function HouseholdDetailPage() {
  const { householdId } = useParams();
  const navigate = useNavigate();
  const { households, updateHousehold, deleteHousehold } = useHouseholds();
  const { individuals, loading, createIndividual, updateIndividual, deleteIndividual } = useIndividuals(householdId);
  const { showToast } = useToast();

  const household = households.find((h) => h.id === householdId);
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
  const [viewerIndex, setViewerIndex] = useState(null); // 1.2
  const [mergeOpen, setMergeOpen] = useState(false); // 1.7
  const [showActivity, setShowActivity] = useState(false); // 1.5

  if (!household) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16 text-center">
        <p className="text-slate-400">Household not found, or still loading…</p>
        <Link to="/households" className="mt-2 inline-block text-sm text-orange-600 hover:underline">← Back to households</Link>
      </div>
    );
  }

  // Propagate new area to all members whose area was blank or matched the old area
  async function syncMemberAreas(newArea, oldArea) {
    if (!newArea) return;
    const toUpdate = individuals.filter((m) => !m.area || m.area === oldArea);
    if (!toUpdate.length) return;
    const batch = writeBatch(db);
    toUpdate.forEach((m) => batch.update(doc(db, "individuals", m.id), { area: newArea, updatedAt: serverTimestamp() }));
    await batch.commit();
  }

  const handleHouseholdUpdate = async (data) => {
    const oldArea = household.area || "";
    const ok = await updateHousehold(household.id, data);
    if (ok && data.area && data.area !== oldArea) {
      await syncMemberAreas(data.area, oldArea);
    }
    return ok;
  };

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
          <p className="text-sm text-slate-400">{household.area}{household.mandal ? ` · ${household.mandal}` : ""}</p>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-500">
            {household.level && <span>Level: {household.level}</span>}
            <span>{household.totalFamilyMembers || 0} family members</span>
            {householdSamparkName && <span>Sampark: {householdSamparkName}{householdSamparkNumber ? ` (${householdSamparkNumber})` : ""}</span>}
          </div>
          {household.remark && <p className="mt-3 text-sm text-slate-400 italic">"{household.remark}"</p>}
        </div>
        <RequirePermission permission="edit_contacts">
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => setEditHouseholdOpen(true)}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
            <Button variant="secondary" size="sm" onClick={() => setMergeOpen(true)}><Merge className="h-3.5 w-3.5" /> Merge</Button>
            <Button variant="danger" size="sm" onClick={() => setConfirmDeleteHousehold(true)}><Trash2 className="h-3.5 w-3.5" /> Delete</Button>
          </div>
        </RequirePermission>
      </Card>

      <div className="mt-8 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-slate-900">Family members</h2>
        <div className="flex items-center gap-2">
          {/* Show fix button when household has an area but some members don't */}
          {household.area && individuals.some((m) => !m.area) && (
            <RequirePermission permission="edit_contacts">
              <Button
                variant="secondary"
                size="sm"
                onClick={async () => {
                  await syncMemberAreas(household.area, "");
                  showToast({ type: "success", message: "Area applied to all members." });
                }}
              >
                Fix missing area
              </Button>
            </RequirePermission>
          )}
          <RequirePermission permission="edit_contacts">
            <Button variant="accent" size="sm" onClick={() => setAddChoiceOpen(true)}><Plus className="h-3.5 w-3.5" /> Add member</Button>
          </RequirePermission>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-lg bg-slate-100" />)
        ) : individuals.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 py-10 text-center text-slate-400">No family members added yet.</p>
        ) : (
          individuals.map((ind, i) => (
            <IndividualCard
              key={ind.id}
              individual={ind}
              onView={() => setViewerIndex(i)}
              onEdit={(x) => setMemberModal({ open: true, individual: x })}
              onDelete={setConfirmDelete}
            />
          ))
        )}
      </div>

      {!loading && individuals.length > 0 && (
        <div className="mt-3 flex justify-center">
          <button onClick={() => setViewerIndex(0)} className="text-xs text-slate-400 hover:text-orange-600">
            View members full screen →
          </button>
        </div>
      )}

      {/* 1.5 — Activity */}
      <div className="mt-8">
        <button
          onClick={() => setShowActivity((v) => !v)}
          className="flex items-center gap-1.5 text-[15px] font-semibold text-slate-900 hover:text-orange-700"
        >
          <Clock className="h-4 w-4" />
          Activity
          <span className="ml-1 text-xs font-normal text-slate-400">{showActivity ? "▲" : "▼"}</span>
        </button>
        {showActivity && (
          <div className="mt-3">
            <ActivityTimeline
              householdId={householdId}
              memberIds={individuals.map((i) => i.id)}
            />
          </div>
        )}
      </div>

      {/* 1.2 — Member Viewer */}
      {viewerIndex !== null && (
        <MemberViewer
          individuals={individuals}
          startIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
        />
      )}

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
        <HouseholdForm household={household} onSubmit={handleHouseholdUpdate} onCancel={() => setEditHouseholdOpen(false)} />
      </Modal>

      {/* 1.7 Merge */}
      <Modal open={mergeOpen} onClose={() => setMergeOpen(false)} title="Merge into another household">
        <MergeHouseholdModal
          sourceHousehold={household}
          onClose={(targetId) => {
            setMergeOpen(false);
            if (targetId) navigate(`/households/${targetId}`);
          }}
        />
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
          <Button variant="dangerSolid" onClick={handleDeleteHousehold} disabled={deletingHousehold}>{deletingHousehold ? 'Deleting…' : 'Delete household'}</Button>
        </div>
      </Modal>
    </div>
  );
}
