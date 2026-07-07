// src/pages/PadhramaniPage.jsx — 6.1–6.9 Padhramani (home visit) tracking
import { useEffect, useMemo, useState } from "react";
import {
  collection, addDoc, updateDoc, doc, getDocs, onSnapshot,
  serverTimestamp, query, orderBy, where, writeBatch,
} from "firebase/firestore";
import {
  Plus, CheckCircle2, XCircle, Clock, Home, Download, Bell, Pencil,
  GripVertical, ChevronDown, CalendarDays, X,
} from "lucide-react";
import { db } from "../lib/firebase";
import { usePadhramani } from "../hooks/usePadhramani";
import { useAreasAndMandals } from "../hooks/useAreasAndMandals";
import { useAuth } from "../hooks/usePermissions";
import { Button } from "../components/ui/Button";
import { Input, Select } from "../components/ui/Input";
import Modal from "../components/ui/Modal";
import { useToast } from "../contexts/ToastContext";

// ── constants ──────────────────────────────────────────────────────────────────
const OUTCOMES = {
  scheduled:   { label: "Scheduled",   color: "bg-blue-50 text-blue-700 border-blue-200" },
  completed:   { label: "Completed",   color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  not_home:    { label: "Not home",    color: "bg-amber-50 text-amber-700 border-amber-200" },
  rescheduled: { label: "Rescheduled", color: "bg-purple-50 text-purple-700 border-purple-200" },
  cancelled:   { label: "Cancelled",  color: "bg-slate-100 text-slate-500 border-slate-200" },
};

function OutcomeBadge({ status }) {
  const o = OUTCOMES[status] || OUTCOMES.scheduled;
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${o.color}`}>
      {o.label}
    </span>
  );
}

function formatDate(str) {
  if (!str) return "—";
  const d = new Date(str);
  return isNaN(d) ? str : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function dueSoon(str) {
  if (!str) return false;
  const d = new Date(str);
  const diff = d.getTime() - Date.now();
  return diff >= 0 && diff <= 3 * 24 * 60 * 60 * 1000;
}

function overdue(str, status) {
  if (!str || status !== "scheduled") return false;
  return new Date(str).getTime() < Date.now();
}

function volunteerLine(v) {
  const parts = [v.assignedVolunteerName, v.secondVolunteerName, v.santo2Name].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

// ── Data helpers ──────────────────────────────────────────────────────────────
async function loadVolunteersAndRoles() {
  const [volSnap, roleSnap] = await Promise.all([
    getDocs(query(collection(db, "volunteers"), orderBy("name"))),
    getDocs(collection(db, "roles")),
  ]);
  const allVolunteers = volSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const roles = roleSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const santoRoleIds = new Set(
    roles.filter((r) => r.name?.toLowerCase().includes("santo")).map((r) => r.id)
  );
  const santoVolunteers = allVolunteers.filter((v) => santoRoleIds.has(v.roleRef));
  return { allVolunteers, santoVolunteers };
}

// ── Reusable volunteer dropdown ───────────────────────────────────────────────
function VolunteerDropdown({ label, value, onChange, volunteers }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-300"
      >
        <option value="">Unassigned</option>
        {volunteers.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
      </select>
    </div>
  );
}

// ── Schedule visit modal (single visit) ───────────────────────────────────────
function ScheduleVisitModal({ onClose, prefillHouseholdId }) {
  const { volunteer: currentUser } = useAuth();
  const { showToast } = useToast();
  const [households, setHouseholds] = useState([]);
  const [allVolunteers, setAllVolunteers] = useState([]);
  const [santoVolunteers, setSantoVolunteers] = useState([]);
  const [scheduledHhIds, setScheduledHhIds] = useState(new Set());
  const [form, setForm] = useState({
    householdId: prefillHouseholdId || "",
    householdAddress: "",
    scheduledDate: "",
    assignedVolunteerId: currentUser?.id || "",
    assignedVolunteerName: currentUser?.name || "",
    secondVolunteerId: "",
    secondVolunteerName: "",
    santo2Id: "",
    santo2Name: "",
    area: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      getDocs(query(collection(db, "households"), orderBy("address"))),
      loadVolunteersAndRoles(),
      getDocs(query(collection(db, "padhramani"), where("status", "==", "scheduled"))),
    ]).then(([hhSnap, { allVolunteers: av, santoVolunteers: sv }, padSnap]) => {
      const allHh = hhSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setHouseholds(allHh);
      setAllVolunteers(av);
      setSantoVolunteers(sv);
      const scheduled = new Set(padSnap.docs.map((d) => d.data().householdId).filter(Boolean));
      setScheduledHhIds(scheduled);
      if (prefillHouseholdId) {
        const hh = allHh.find((h) => h.id === prefillHouseholdId);
        if (hh) setForm((f) => ({ ...f, householdAddress: hh.address || "", area: hh.area || "" }));
      }
    });
  }, [prefillHouseholdId]);

  function handleHouseholdPick(id) {
    const hh = households.find((h) => h.id === id);
    setForm((f) => ({ ...f, householdId: id, householdAddress: hh?.address || "", area: hh?.area || f.area }));
  }

  function pickFromList(list, idField, nameField, id) {
    const v = list.find((x) => x.id === id);
    setForm((f) => ({ ...f, [idField]: id, [nameField]: v?.name || "" }));
  }

  async function handleSave() {
    if (!form.householdId || !form.scheduledDate) {
      showToast({ type: "error", message: "Household and date are required." });
      return;
    }
    setSaving(true);
    try {
      await addDoc(collection(db, "padhramani"), {
        householdId: form.householdId,
        householdAddress: form.householdAddress,
        scheduledDate: form.scheduledDate,
        assignedVolunteerId: form.assignedVolunteerId || null,
        assignedVolunteerName: form.assignedVolunteerName || null,
        secondVolunteerId: form.secondVolunteerId || null,
        secondVolunteerName: form.secondVolunteerName || null,
        santo2Id: form.santo2Id || null,
        santo2Name: form.santo2Name || null,
        area: form.area || null,
        notes: form.notes || null,
        status: "scheduled",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      showToast({ type: "success", message: "Visit scheduled." });
      onClose();
    } catch (err) {
      showToast({ type: "error", message: err.message || "Couldn't save visit." });
    } finally {
      setSaving(false);
    }
  }

  const availableHouseholds = households.filter(
    (h) => !scheduledHhIds.has(h.id) || h.id === prefillHouseholdId
  );

  return (
    <Modal open onClose={onClose} title="Schedule Padhramani visit">
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Household</label>
          {prefillHouseholdId ? (
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              {form.householdAddress || "Loading…"}
            </p>
          ) : (
            <>
              <select
                value={form.householdId}
                onChange={(e) => handleHouseholdPick(e.target.value)}
                className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-300"
              >
                <option value="">Pick a household…</option>
                {availableHouseholds.map((h) => (
                  <option key={h.id} value={h.id}>{h.address}{h.area ? ` — ${h.area}` : ""}</option>
                ))}
              </select>
              {scheduledHhIds.size > 0 && (
                <p className="mt-1 text-xs text-slate-400">{scheduledHhIds.size} household(s) with an existing scheduled visit are hidden</p>
              )}
            </>
          )}
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Scheduled date</label>
          <Input type="date" value={form.scheduledDate} onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })} />
        </div>
        <VolunteerDropdown label="Volunteer (karyakarta)" value={form.assignedVolunteerId}
          onChange={(id) => pickFromList(allVolunteers, "assignedVolunteerId", "assignedVolunteerName", id)}
          volunteers={allVolunteers} />
        <div className="grid grid-cols-2 gap-3">
          <VolunteerDropdown label={`Santo 1${santoVolunteers.length === 0 ? " (no Santo role)" : ""}`}
            value={form.secondVolunteerId}
            onChange={(id) => pickFromList(santoVolunteers, "secondVolunteerId", "secondVolunteerName", id)}
            volunteers={santoVolunteers} />
          <VolunteerDropdown label={`Santo 2${santoVolunteers.length === 0 ? " (no Santo role)" : ""}`}
            value={form.santo2Id}
            onChange={(id) => pickFromList(santoVolunteers, "santo2Id", "santo2Name", id)}
            volunteers={santoVolunteers} />
        </div>
        {santoVolunteers.length === 0 && allVolunteers.length > 0 && (
          <p className="text-xs text-amber-600">No volunteers with a "Santo" role found. Create a role named "Santo" first.</p>
        )}
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Notes</label>
          <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
            rows={2} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-slate-300"
            placeholder="Optional notes…" />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="accent" onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Schedule visit"}</Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Edit visit modal ──────────────────────────────────────────────────────────
function EditVisitModal({ visit, allVolunteers, santoVolunteers, onClose }) {
  const { showToast } = useToast();
  const [form, setForm] = useState({
    scheduledDate: visit.scheduledDate || "",
    assignedVolunteerId: visit.assignedVolunteerId || "",
    assignedVolunteerName: visit.assignedVolunteerName || "",
    secondVolunteerId: visit.secondVolunteerId || "",
    secondVolunteerName: visit.secondVolunteerName || "",
    santo2Id: visit.santo2Id || "",
    santo2Name: visit.santo2Name || "",
    notes: visit.notes || "",
  });
  const [saving, setSaving] = useState(false);

  function pickFromList(list, idField, nameField, id) {
    const v = list.find((x) => x.id === id);
    setForm((f) => ({ ...f, [idField]: id, [nameField]: v?.name || "" }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await updateDoc(doc(db, "padhramani", visit.id), {
        scheduledDate: form.scheduledDate,
        assignedVolunteerId: form.assignedVolunteerId || null,
        assignedVolunteerName: form.assignedVolunteerName || null,
        secondVolunteerId: form.secondVolunteerId || null,
        secondVolunteerName: form.secondVolunteerName || null,
        santo2Id: form.santo2Id || null,
        santo2Name: form.santo2Name || null,
        notes: form.notes || null,
        updatedAt: serverTimestamp(),
      });
      showToast({ type: "success", message: "Visit updated." });
      onClose();
    } catch (err) {
      showToast({ type: "error", message: err.message || "Couldn't update visit." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Edit visit — ${visit.householdAddress || "household"}`} size="sm">
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Scheduled date</label>
          <Input type="date" value={form.scheduledDate} onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })} />
        </div>
        <VolunteerDropdown label="Volunteer (karyakarta)" value={form.assignedVolunteerId}
          onChange={(id) => pickFromList(allVolunteers, "assignedVolunteerId", "assignedVolunteerName", id)}
          volunteers={allVolunteers} />
        <div className="grid grid-cols-2 gap-3">
          <VolunteerDropdown label="Santo 1" value={form.secondVolunteerId}
            onChange={(id) => pickFromList(santoVolunteers, "secondVolunteerId", "secondVolunteerName", id)}
            volunteers={santoVolunteers} />
          <VolunteerDropdown label="Santo 2" value={form.santo2Id}
            onChange={(id) => pickFromList(santoVolunteers, "santo2Id", "santo2Name", id)}
            volunteers={santoVolunteers} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Notes</label>
          <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
            rows={2} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-slate-300" />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="accent" onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Outcome modal ─────────────────────────────────────────────────────────────
function OutcomeModal({ visit, onClose }) {
  const { showToast } = useToast();
  const [status, setStatus] = useState(visit.status || "scheduled");
  const [notes, setNotes] = useState(visit.notes || "");
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const updates = { status, notes, updatedAt: serverTimestamp() };
      if (status === "rescheduled" && rescheduleDate) {
        await addDoc(collection(db, "padhramani"), {
          householdId: visit.householdId,
          householdAddress: visit.householdAddress,
          scheduledDate: rescheduleDate,
          assignedVolunteerId: visit.assignedVolunteerId || null,
          assignedVolunteerName: visit.assignedVolunteerName || null,
          secondVolunteerId: visit.secondVolunteerId || null,
          secondVolunteerName: visit.secondVolunteerName || null,
          santo2Id: visit.santo2Id || null,
          santo2Name: visit.santo2Name || null,
          area: visit.area || null,
          notes: `Rescheduled from ${formatDate(visit.scheduledDate)}`,
          status: "scheduled",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      await updateDoc(doc(db, "padhramani", visit.id), updates);
      showToast({ type: "success", message: "Visit updated." });
      onClose();
    } catch (err) {
      showToast({ type: "error", message: err.message || "Couldn't update visit." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Update visit — ${visit.householdAddress || "household"}`} size="sm">
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Outcome</label>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(OUTCOMES).map(([key, o]) => (
              <button key={key} onClick={() => setStatus(key)}
                className={`rounded-lg border px-3 py-2 text-left text-xs font-medium transition ${status === key ? o.color + " ring-2 ring-offset-1 ring-current" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
        {status === "rescheduled" && (
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">New date</label>
            <Input type="date" value={rescheduleDate} onChange={(e) => setRescheduleDate(e.target.value)} />
          </div>
        )}
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Notes</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-slate-300" />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="accent" onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Create Event modal ────────────────────────────────────────────────────────
// Step 1: name, date, volunteer, santos, notes
// Step 2: search households → click to add → drag rows to reorder
function CreateEventModal({ onClose, allVolunteers, santoVolunteers }) {
  const { showToast } = useToast();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    name: "",
    scheduledDate: "",
    assignedVolunteerId: "",
    assignedVolunteerName: "",
    secondVolunteerId: "",
    secondVolunteerName: "",
    santo2Id: "",
    santo2Name: "",
    notes: "",
  });
  const [allHouseholds, setAllHouseholds] = useState([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState([]); // [{ householdId, address, area }]
  const [saving, setSaving] = useState(false);
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);

  useEffect(() => {
    getDocs(query(collection(db, "households"), orderBy("address"))).then((snap) => {
      setAllHouseholds(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
  }, []);

  function pickFromList(list, idField, nameField, id) {
    const v = list.find((x) => x.id === id);
    setForm((f) => ({ ...f, [idField]: id, [nameField]: v?.name || "" }));
  }

  const selectedIds = new Set(selected.map((h) => h.householdId));
  const searchResults = allHouseholds.filter((h) => {
    if (selectedIds.has(h.id)) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return h.address?.toLowerCase().includes(q) || h.area?.toLowerCase().includes(q);
  });

  function addHousehold(hh) {
    setSelected((prev) => [...prev, { householdId: hh.id, address: hh.address || "", area: hh.area || "" }]);
  }

  function removeHousehold(id) {
    setSelected((prev) => prev.filter((h) => h.householdId !== id));
  }

  function onDragStart(i) { setDragIdx(i); }
  function onDragOver(e, i) { e.preventDefault(); setOverIdx(i); }
  function onDrop(e, i) {
    e.preventDefault();
    if (dragIdx === null || dragIdx === i) { setDragIdx(null); setOverIdx(null); return; }
    const next = [...selected];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(i, 0, moved);
    setSelected(next);
    setDragIdx(null);
    setOverIdx(null);
  }

  async function handleSave() {
    if (!form.name.trim() || !form.scheduledDate) {
      showToast({ type: "error", message: "Event name and date are required." });
      return;
    }
    setSaving(true);
    try {
      await addDoc(collection(db, "padhramaniEvents"), {
        name: form.name.trim(),
        scheduledDate: form.scheduledDate,
        assignedVolunteerId: form.assignedVolunteerId || null,
        assignedVolunteerName: form.assignedVolunteerName || null,
        secondVolunteerId: form.secondVolunteerId || null,
        secondVolunteerName: form.secondVolunteerName || null,
        santo2Id: form.santo2Id || null,
        santo2Name: form.santo2Name || null,
        notes: form.notes || null,
        households: selected,
        status: "draft",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      showToast({ type: "success", message: `Event saved. Tap "Schedule All" on the card to create the ${selected.length} visits.` });
      onClose();
    } catch (err) {
      showToast({ type: "error", message: err.message || "Couldn't save event." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="New Padhramani Event" size="lg">
      {/* Step indicator */}
      <div className="mb-5 flex items-center gap-2">
        {[{ n: 1, label: "Event details" }, { n: 2, label: "Add households" }].map((s, i) => (
          <div key={s.n} className="flex items-center gap-2">
            {i > 0 && <div className="h-px w-6 bg-slate-200" />}
            <div className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
              step === s.n ? "bg-orange-100 text-orange-700"
              : step > s.n ? "bg-emerald-50 text-emerald-600"
              : "bg-slate-100 text-slate-400"
            }`}>
              <span>{s.n}</span>
              <span>{s.label}</span>
            </div>
          </div>
        ))}
      </div>

      {step === 1 ? (
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Event name <span className="text-rose-500">*</span></label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Koyal Nagar – 10 July" autoFocus />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Visit date <span className="text-rose-500">*</span></label>
            <Input type="date" value={form.scheduledDate} onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })} />
          </div>
          <VolunteerDropdown label="Volunteer (karyakarta)" value={form.assignedVolunteerId}
            onChange={(id) => pickFromList(allVolunteers, "assignedVolunteerId", "assignedVolunteerName", id)}
            volunteers={allVolunteers} />
          <div className="grid grid-cols-2 gap-3">
            <VolunteerDropdown label="Santo 1" value={form.secondVolunteerId}
              onChange={(id) => pickFromList(santoVolunteers, "secondVolunteerId", "secondVolunteerName", id)}
              volunteers={santoVolunteers} />
            <VolunteerDropdown label="Santo 2" value={form.santo2Id}
              onChange={(id) => pickFromList(santoVolunteers, "santo2Id", "santo2Name", id)}
              volunteers={santoVolunteers} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Notes (shared for all visits)</label>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2} placeholder="Optional…"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-slate-300" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="accent" onClick={() => setStep(2)}
              disabled={!form.name.trim() || !form.scheduledDate}>
              Next: Add Households →
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex gap-4" style={{ height: 420 }}>
            {/* Left: search and pick */}
            <div className="flex flex-1 flex-col min-w-0">
              <p className="mb-2 text-xs font-semibold text-slate-600">Search households</p>
              <Input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Address or area…" className="mb-2 shrink-0" autoFocus />
              <div className="flex-1 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-50">
                {searchResults.slice(0, 80).map((h) => (
                  <button key={h.id} type="button" onClick={() => addHousehold(h)}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-orange-50 transition-colors">
                    <Plus className="h-3.5 w-3.5 shrink-0 text-orange-400" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-slate-800">{h.address || "No address"}</p>
                      {h.area && <p className="text-xs text-slate-400">{h.area}</p>}
                    </div>
                  </button>
                ))}
                {searchResults.length === 0 && (
                  <p className="py-8 text-center text-xs text-slate-400">
                    {search.trim() ? "No matches" : allHouseholds.length === 0 ? "No households found" : "All households already added"}
                  </p>
                )}
              </div>
            </div>

            {/* Right: selected with drag reorder */}
            <div className="flex flex-1 flex-col min-w-0">
              <p className="mb-2 text-xs font-semibold text-slate-600">
                Visit order
                <span className="ml-1 font-normal text-slate-400">
                  {selected.length > 0 ? `${selected.length} added · drag to reorder` : "click households to add →"}
                </span>
              </p>
              <div className="flex-1 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-50">
                {selected.length === 0 ? (
                  <p className="py-10 text-center text-xs text-slate-400">← Pick households on the left</p>
                ) : selected.map((hh, i) => (
                  <div key={hh.householdId}
                    draggable
                    onDragStart={() => onDragStart(i)}
                    onDragOver={(e) => onDragOver(e, i)}
                    onDrop={(e) => onDrop(e, i)}
                    onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
                    className={[
                      "flex cursor-grab items-center gap-2 px-2 py-2.5 select-none active:cursor-grabbing",
                      dragIdx === i ? "opacity-40 bg-slate-50" : "",
                      overIdx === i && dragIdx !== i ? "border-t-2 border-orange-400" : "",
                    ].join(" ")}
                  >
                    <GripVertical className="h-4 w-4 shrink-0 text-slate-300" />
                    <span className="w-5 shrink-0 text-center text-xs font-semibold text-slate-400">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-slate-800">{hh.address || "—"}</p>
                      {hh.area && <p className="text-xs text-slate-400">{hh.area}</p>}
                    </div>
                    <button type="button" onClick={() => removeHousehold(hh.householdId)}
                      className="shrink-0 rounded p-0.5 text-slate-300 hover:text-rose-400 transition-colors">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
            <Button variant="ghost" onClick={() => setStep(1)}>← Back</Button>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button variant="accent" onClick={handleSave}
                disabled={saving || selected.length === 0}>
                {saving ? "Saving…" : `Save event · ${selected.length} household${selected.length !== 1 ? "s" : ""}`}
              </Button>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}

// ── Event card ────────────────────────────────────────────────────────────────
function EventCard({ event, onScheduleAll, onExport }) {
  const [expanded, setExpanded] = useState(false);
  const [scheduling, setScheduling] = useState(false);

  const vLine = [event.assignedVolunteerName, event.secondVolunteerName, event.santo2Name]
    .filter(Boolean).join(" · ");

  async function handleScheduleAll() {
    setScheduling(true);
    try { await onScheduleAll(event); }
    finally { setScheduling(false); }
  }

  const isScheduled = event.status === "scheduled";

  return (
    <div className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-lg bg-orange-50 p-2 shrink-0">
          <CalendarDays className="h-4 w-4 text-orange-500" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-slate-900">{event.name}</p>
            <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
              isScheduled ? "bg-emerald-50 border-emerald-200 text-emerald-700"
              : "bg-amber-50 border-amber-200 text-amber-700"
            }`}>
              {isScheduled ? "Scheduled" : "Draft"}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500">
            <span>{formatDate(event.scheduledDate)}</span>
            {vLine && <span className="font-medium text-slate-700">{vLine}</span>}
            <span>{event.households?.length || 0} household(s)</span>
            {event.notes && <span className="italic truncate max-w-xs">{event.notes}</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 flex-wrap justify-end">
          <Button variant="secondary" size="sm" onClick={() => onExport(event)}>
            <Download className="h-3.5 w-3.5" /> Export
          </Button>
          {!isScheduled && (
            <Button variant="accent" size="sm" onClick={handleScheduleAll} disabled={scheduling || !event.households?.length}>
              {scheduling ? "Scheduling…" : "Schedule All"}
            </Button>
          )}
          <button onClick={() => setExpanded((v) => !v)}
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 transition-colors">
            <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 rounded-lg border border-slate-100">
          {(event.households?.length ?? 0) === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">No households in this event.</p>
          ) : (
            <div className="divide-y divide-slate-50">
              {event.households.map((hh, i) => (
                <div key={hh.householdId} className="flex items-center gap-2 px-3 py-2 text-xs text-slate-600">
                  <span className="w-6 shrink-0 font-semibold text-slate-400">{i + 1}.</span>
                  <Home className="h-3 w-3 shrink-0 text-slate-300" />
                  <span className="flex-1 truncate">{hh.address || "—"}</span>
                  {hh.area && <span className="text-slate-400">{hh.area}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Summary stats ─────────────────────────────────────────────────────────────
function SummaryCards({ visits }) {
  const total = visits.length;
  const completed = visits.filter((v) => v.status === "completed").length;
  const scheduled = visits.filter((v) => v.status === "scheduled").length;
  const overdue_ = visits.filter((v) => overdue(v.scheduledDate, v.status)).length;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
      {[
        { label: "Total visits", value: total, color: "text-slate-700" },
        { label: "Completed", value: completed, color: "text-emerald-600" },
        { label: "Upcoming", value: scheduled - overdue_, color: "text-blue-600" },
        { label: "Overdue", value: overdue_, color: "text-rose-600" },
      ].map((c) => (
        <div key={c.label} className="rounded-xl border border-slate-100 bg-white p-4">
          <p className={`text-2xl font-bold ${c.color}`}>{c.value}</p>
          <p className="text-xs text-slate-400 mt-0.5">{c.label}</p>
        </div>
      ))}
    </div>
  );
}

// ── CSV export helpers ────────────────────────────────────────────────────────
function exportCSV(rows) {
  const headers = ["Household", "Area", "Scheduled Date", "Volunteer", "Santo 1", "Santo 2", "Status", "Notes"];
  const lines = rows.map((r) => [
    r.householdAddress || "", r.area || "", r.scheduledDate || "",
    r.assignedVolunteerName || "", r.secondVolunteerName || "", r.santo2Name || "",
    r.status || "", (r.notes || "").replace(/"/g, '""'),
  ].map((v) => `"${v}"`).join(","));
  downloadCSV([headers.join(","), ...lines].join("\n"), `padhramani-${Date.now()}.csv`);
}

function exportEventCSV(event) {
  const headers = ["#", "Household", "Area", "Date", "Volunteer", "Santo 1", "Santo 2", "Notes"];
  const lines = (event.households || []).map((hh, i) => [
    i + 1, hh.address || "", hh.area || "",
    event.scheduledDate || "",
    event.assignedVolunteerName || "", event.secondVolunteerName || "", event.santo2Name || "",
    (event.notes || "").replace(/"/g, '""'),
  ].map((v) => `"${v}"`).join(","));
  const safeName = (event.name || "event").replace(/[^\w\s-]/g, "").replace(/\s+/g, "-");
  downloadCSV([headers.join(","), ...lines].join("\n"), `${safeName}.csv`);
}

function downloadCSV(csv, filename) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function PadhramaniPage() {
  const { visits, loading } = usePadhramani();
  const { areas } = useAreasAndMandals();
  const { showToast } = useToast();

  const [allVolunteers, setAllVolunteers] = useState([]);
  const [santoVolunteers, setSantoVolunteers] = useState([]);
  const [events, setEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(true);

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [createEventOpen, setCreateEventOpen] = useState(false);
  const [outcomeVisit, setOutcomeVisit] = useState(null);
  const [editVisit, setEditVisit] = useState(null);

  const [areaFilter, setAreaFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [volunteerFilter, setVolunteerFilter] = useState("");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("visits");

  useEffect(() => {
    loadVolunteersAndRoles().then(({ allVolunteers: av, santoVolunteers: sv }) => {
      setAllVolunteers(av);
      setSantoVolunteers(sv);
    });
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "padhramaniEvents"), orderBy("createdAt", "desc")),
      (snap) => { setEvents(snap.docs.map((d) => ({ id: d.id, ...d.data() }))); setEventsLoading(false); },
      (err) => { console.error(err); setEventsLoading(false); }
    );
    return unsub;
  }, []);

  async function handleScheduleAll(event) {
    try {
      const batch = writeBatch(db);
      (event.households || []).forEach((hh, i) => {
        const ref = doc(collection(db, "padhramani"));
        batch.set(ref, {
          householdId: hh.householdId,
          householdAddress: hh.address,
          scheduledDate: event.scheduledDate,
          assignedVolunteerId: event.assignedVolunteerId || null,
          assignedVolunteerName: event.assignedVolunteerName || null,
          secondVolunteerId: event.secondVolunteerId || null,
          secondVolunteerName: event.secondVolunteerName || null,
          santo2Id: event.santo2Id || null,
          santo2Name: event.santo2Name || null,
          area: hh.area || null,
          notes: event.notes || null,
          sequenceNo: i + 1,
          eventId: event.id,
          status: "scheduled",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });
      batch.update(doc(db, "padhramaniEvents", event.id), {
        status: "scheduled",
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
      showToast({ type: "success", message: `${event.households?.length || 0} visits scheduled from "${event.name}".` });
    } catch (err) {
      showToast({ type: "error", message: err.message || "Couldn't schedule visits." });
    }
  }

  const filtered = useMemo(() => {
    let rows = visits;
    if (areaFilter) rows = rows.filter((v) => v.area === areaFilter);
    if (statusFilter) rows = rows.filter((v) => v.status === statusFilter);
    if (volunteerFilter) rows = rows.filter(
      (v) => v.assignedVolunteerName === volunteerFilter ||
             v.secondVolunteerName === volunteerFilter ||
             v.santo2Name === volunteerFilter
    );
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((v) =>
        v.householdAddress?.toLowerCase().includes(q) ||
        v.assignedVolunteerName?.toLowerCase().includes(q) ||
        v.secondVolunteerName?.toLowerCase().includes(q) ||
        v.santo2Name?.toLowerCase().includes(q) ||
        v.notes?.toLowerCase().includes(q)
      );
    }
    return rows;
  }, [visits, areaFilter, statusFilter, volunteerFilter, search]);

  const dueSoonCount = useMemo(
    () => visits.filter((v) => v.status === "scheduled" && dueSoon(v.scheduledDate)).length,
    [visits]
  );

  const volunteerNames = useMemo(() => {
    const names = new Set();
    visits.forEach((v) => {
      if (v.assignedVolunteerName) names.add(v.assignedVolunteerName);
      if (v.secondVolunteerName) names.add(v.secondVolunteerName);
      if (v.santo2Name) names.add(v.santo2Name);
    });
    return [...names].sort();
  }, [visits]);

  const byHousehold = useMemo(() => {
    const map = {};
    filtered.forEach((v) => {
      if (!map[v.householdId]) map[v.householdId] = { address: v.householdAddress, area: v.area, visits: [] };
      map[v.householdId].visits.push(v);
    });
    return Object.entries(map).sort((a, b) => (a[1].address || "").localeCompare(b[1].address || ""));
  }, [filtered]);

  const byVolunteer = useMemo(() => {
    const map = {};
    filtered.forEach((v) => {
      const key = v.assignedVolunteerName || "Unassigned";
      if (!map[key]) map[key] = [];
      map[key].push(v);
    });
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const TABS = [
    { key: "visits",       label: "All visits" },
    { key: "by-household", label: "By household" },
    { key: "by-volunteer", label: "By volunteer" },
    { key: "events",       label: events.length ? `Events (${events.length})` : "Events" },
  ];

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 tracking-tight flex items-center gap-2">
            Padhramani
            {dueSoonCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                <Bell className="h-3 w-3" /> {dueSoonCount} due soon
              </span>
            )}
          </h1>
          <p className="text-sm text-slate-400">{visits.length} visit record(s)</p>
        </div>
        <div className="flex gap-2">
          {tab === "events" ? (
            <Button variant="accent" onClick={() => setCreateEventOpen(true)}>
              <CalendarDays className="h-3.5 w-3.5" /> New Event
            </Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => exportCSV(filtered)}><Download className="h-3.5 w-3.5" /> Export</Button>
              <Button variant="accent" onClick={() => setScheduleOpen(true)}><Plus className="h-3.5 w-3.5" /> Schedule visit</Button>
            </>
          )}
        </div>
      </div>

      {tab !== "events" && <SummaryCards visits={visits} />}

      {/* Tab bar */}
      <div className="mb-4 flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 w-fit">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${tab === t.key ? "bg-white shadow-sm text-slate-900" : "text-slate-500 hover:text-slate-700"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Events tab ─────────────────────────────────────────────────────── */}
      {tab === "events" ? (
        <div>
          <p className="mb-4 text-sm text-slate-400">
            Create an event once with a shared date, volunteer, and santos — then add all households and set the visit order by dragging. Hit <strong>Schedule All</strong> to create visits in one go.
          </p>
          {eventsLoading ? (
            <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-100" />)}</div>
          ) : events.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-slate-200 py-16 text-center">
              <CalendarDays className="mx-auto h-8 w-8 text-slate-300 mb-3" />
              <p className="text-sm font-medium text-slate-500">No events yet</p>
              <p className="mt-1 text-xs text-slate-400">Create an event to bulk-schedule 20–30 household visits at once</p>
              <Button variant="accent" className="mt-4" onClick={() => setCreateEventOpen(true)}>
                <Plus className="h-3.5 w-3.5" /> Create first event
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {events.map((ev) => (
                <EventCard key={ev.id} event={ev}
                  onScheduleAll={handleScheduleAll}
                  onExport={exportEventCSV} />
              ))}
            </div>
          )}
        </div>

      ) : (
        /* ── Visits tabs ───────────────────────────────────────────────────── */
        <>
          <div className="mb-4 flex flex-wrap gap-3">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search household, volunteer…" className="w-52" />
            <Select value={areaFilter} onChange={(e) => setAreaFilter(e.target.value)} className="w-36">
              <option value="">All areas</option>
              {areas.map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
            </Select>
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-36">
              <option value="">All statuses</option>
              {Object.entries(OUTCOMES).map(([k, o]) => <option key={k} value={k}>{o.label}</option>)}
            </Select>
            <Select value={volunteerFilter} onChange={(e) => setVolunteerFilter(e.target.value)} className="w-40">
              <option value="">All volunteers</option>
              {volunteerNames.map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
          </div>

          {loading ? (
            <div className="space-y-2">{[1,2,3,4,5].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100" />)}</div>
          ) : filtered.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 py-16 text-center text-slate-400">No visits match your filters.</p>
          ) : tab === "visits" ? (
            <div className="rounded-lg border border-slate-100 divide-y divide-slate-50">
              {filtered.map((v) => {
                const vLine = volunteerLine(v);
                return (
                  <div key={v.id} className={`flex items-start gap-3 px-4 py-3 hover:bg-slate-50/70 ${overdue(v.scheduledDate, v.status) ? "bg-rose-50/30" : ""}`}>
                    <div className="mt-0.5">
                      {v.status === "completed" ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> :
                        v.status === "not_home" ? <XCircle className="h-4 w-4 text-amber-500" /> :
                          <Clock className="h-4 w-4 text-blue-400" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-slate-900">{v.householdAddress || "Unknown household"}</p>
                        <OutcomeBadge status={v.status} />
                        {overdue(v.scheduledDate, v.status) && <span className="text-xs font-medium text-rose-600">Overdue</span>}
                        {dueSoon(v.scheduledDate) && v.status === "scheduled" && <span className="text-xs font-medium text-amber-600">Due soon</span>}
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5 text-xs text-slate-400">
                        <span>{formatDate(v.scheduledDate)}</span>
                        {v.area && <span>{v.area}</span>}
                        {vLine && <span className="font-medium text-slate-600">{vLine}</span>}
                        {v.notes && <span className="italic truncate max-w-xs">{v.notes}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => setEditVisit(v)} title="Edit"
                        className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <Button variant="ghost" size="sm" onClick={() => setOutcomeVisit(v)}>Update</Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : tab === "by-household" ? (
            <div className="space-y-3">
              {byHousehold.map(([hhId, hh]) => (
                <div key={hhId} className="rounded-lg border border-slate-100 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Home className="h-4 w-4 text-slate-400" />
                    <p className="text-sm font-medium text-slate-900">{hh.address}</p>
                    {hh.area && <span className="text-xs text-slate-400">{hh.area}</span>}
                    <span className="ml-auto text-xs text-slate-400">{hh.visits.length} visit(s)</span>
                  </div>
                  <div className="space-y-1.5">
                    {hh.visits.map((v) => {
                      const vLine = volunteerLine(v);
                      return (
                        <div key={v.id} className="flex items-center gap-2 text-xs text-slate-600">
                          <OutcomeBadge status={v.status} />
                          <span>{formatDate(v.scheduledDate)}</span>
                          {vLine && <span className="font-medium">{vLine}</span>}
                          {v.notes && <span className="italic truncate max-w-xs text-slate-400">{v.notes}</span>}
                          <button onClick={() => setEditVisit(v)} className="p-0.5 text-slate-300 hover:text-slate-500"><Pencil className="h-3 w-3" /></button>
                          <button onClick={() => setOutcomeVisit(v)} className="ml-auto text-slate-400 hover:text-slate-600 hover:underline">Update</button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {byVolunteer.map(([name, vVisits]) => (
                <div key={name} className="rounded-lg border border-slate-100 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <p className="text-sm font-medium text-slate-900">{name}</p>
                    <span className="ml-auto text-xs text-slate-400">{vVisits.length} visit(s)</span>
                    <span className="text-xs text-emerald-600">{vVisits.filter((v) => v.status === "completed").length} completed</span>
                  </div>
                  <div className="space-y-1.5">
                    {vVisits.map((v) => {
                      const vLine = volunteerLine(v);
                      return (
                        <div key={v.id} className="flex items-center gap-2 text-xs text-slate-600">
                          <OutcomeBadge status={v.status} />
                          <span>{v.householdAddress || "?"}</span>
                          <span className="text-slate-400">{formatDate(v.scheduledDate)}</span>
                          {vLine && <span className="font-medium">{vLine}</span>}
                          {v.notes && <span className="italic truncate max-w-xs text-slate-400">{v.notes}</span>}
                          <button onClick={() => setEditVisit(v)} className="p-0.5 text-slate-300 hover:text-slate-500"><Pencil className="h-3 w-3" /></button>
                          <button onClick={() => setOutcomeVisit(v)} className="ml-auto text-slate-400 hover:text-slate-600 hover:underline">Update</button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {scheduleOpen && <ScheduleVisitModal onClose={() => setScheduleOpen(false)} />}
      {outcomeVisit && <OutcomeModal visit={outcomeVisit} onClose={() => setOutcomeVisit(null)} />}
      {editVisit && (
        <EditVisitModal visit={editVisit} allVolunteers={allVolunteers}
          santoVolunteers={santoVolunteers} onClose={() => setEditVisit(null)} />
      )}
      {createEventOpen && (
        <CreateEventModal onClose={() => setCreateEventOpen(false)}
          allVolunteers={allVolunteers} santoVolunteers={santoVolunteers} />
      )}
    </div>
  );
}

// Exported for use from HouseholdDetailPage
export function SchedulePadhramaniModal({ householdId, onClose }) {
  return <ScheduleVisitModal onClose={onClose} prefillHouseholdId={householdId} />;
}
