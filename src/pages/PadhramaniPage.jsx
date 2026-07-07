// src/pages/PadhramaniPage.jsx — Padhramani event tracking
// Data model: padhramaniEvents/{id}
// {
//   name, scheduledDate, area,
//   assignedVolunteerId, assignedVolunteerName,  ← Karyakarta
//   secondVolunteerId, secondVolunteerName,       ← Santo 1
//   santo2Id, santo2Name,                         ← Santo 2
//   notes,
//   households: [{ householdId, address, area, primaryName, status }]
//   createdAt, updatedAt
// }
import { useEffect, useMemo, useState } from "react";
import {
  collection, addDoc, updateDoc, deleteDoc, doc, getDocs,
  onSnapshot, serverTimestamp, query, orderBy,
} from "firebase/firestore";
import {
  Plus, Download, Pencil, Trash2, ChevronDown,
  Home, CalendarDays, Users, GripVertical, X,
} from "lucide-react";
import { db } from "../lib/firebase";
import { useAuth } from "../hooks/usePermissions";
import { useAreasAndMandals } from "../hooks/useAreasAndMandals";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import Modal from "../components/ui/Modal";
import { useToast } from "../contexts/ToastContext";
import RequirePermission from "../components/RequirePermission";

// ── Constants ──────────────────────────────────────────────────────────────────

const HH_STATUSES = {
  pending:   { label: "Pending",   color: "bg-slate-100 text-slate-600 border-slate-200" },
  completed: { label: "Visited",   color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  not_home:  { label: "Not home",  color: "bg-amber-50 text-amber-700 border-amber-200" },
  cancelled: { label: "Cancelled", color: "bg-rose-50 text-rose-600 border-rose-200" },
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDate(str) {
  if (!str) return "—";
  const d = new Date(str + "T00:00:00");
  return isNaN(d) ? str : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function downloadCSV(csv, filename) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function loadVolunteersAndRoles() {
  const [volSnap, roleSnap] = await Promise.all([
    getDocs(query(collection(db, "volunteers"), orderBy("name"))),
    getDocs(collection(db, "roles")),
  ]);
  const allVols = volSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const roles = roleSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const santoIds = new Set(
    roles.filter((r) => r.name?.toLowerCase().includes("santo")).map((r) => r.id)
  );
  return {
    nonSanto: allVols.filter((v) => !santoIds.has(v.roleRef)),
    santo: allVols.filter((v) => santoIds.has(v.roleRef)),
  };
}

// ── VolunteerDropdown ──────────────────────────────────────────────────────────

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
        {volunteers.map((v) => (
          <option key={v.id} value={v.id}>{v.name}</option>
        ))}
      </select>
    </div>
  );
}

// ── AreaStats ──────────────────────────────────────────────────────────────────

function AreaStats({ events }) {
  const stats = useMemo(() => {
    const map = {};
    events.forEach((ev) => {
      const area = ev.area || "Unknown";
      if (!map[area]) map[area] = { events: 0, total: 0, visited: 0 };
      map[area].events += 1;
      (ev.households || []).forEach((hh) => {
        map[area].total += 1;
        if (hh.status === "completed") map[area].visited += 1;
      });
    });
    return Object.entries(map).sort((a, b) => b[1].total - a[1].total);
  }, [events]);

  if (stats.length === 0) return null;

  return (
    <div className="mb-6">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        Area-wise Stats
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {stats.map(([area, s]) => (
          <div key={area} className="rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
            <p className="truncate text-sm font-semibold text-slate-800">{area}</p>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-xl font-bold text-orange-500">{s.total}</span>
              <span className="text-xs text-slate-400">households</span>
            </div>
            <div className="mt-0.5 flex gap-3 text-xs">
              <span className="font-medium text-emerald-600">{s.visited} visited</span>
              <span className="text-slate-400">{s.events} event{s.events !== 1 ? "s" : ""}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── HouseholdPicker ────────────────────────────────────────────────────────────

function HouseholdPicker({ selected, setSelected, allHouseholds, primaryNames }) {
  const [search, setSearch] = useState("");
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);

  const selectedIds = new Set(selected.map((h) => h.householdId));
  const results = allHouseholds.filter((h) => {
    if (selectedIds.has(h.id)) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      h.address?.toLowerCase().includes(q) ||
      h.area?.toLowerCase().includes(q) ||
      primaryNames[h.id]?.toLowerCase().includes(q)
    );
  });

  function add(hh) {
    setSelected((prev) => [
      ...prev,
      {
        householdId: hh.id,
        address: hh.address || "",
        area: hh.area || "",
        primaryName: primaryNames[hh.id] || "",
        status: "pending",
      },
    ]);
  }

  function remove(id) {
    setSelected((prev) => prev.filter((h) => h.householdId !== id));
  }

  function onDrop(e, i) {
    e.preventDefault();
    if (dragIdx === null || dragIdx === i) { setDragIdx(null); setOverIdx(null); return; }
    const next = [...selected];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(i, 0, moved);
    setSelected(next);
    setDragIdx(null); setOverIdx(null);
  }

  return (
    <div className="flex gap-4" style={{ height: 360 }}>
      <div className="flex flex-1 flex-col min-w-0">
        <p className="mb-1.5 text-xs font-semibold text-slate-600">Search &amp; add households</p>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Name, address, area…"
          className="mb-2 shrink-0"
        />
        <div className="flex-1 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-50">
          {results.slice(0, 80).map((h) => (
            <button
              key={h.id} type="button" onClick={() => add(h)}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-orange-50 transition-colors"
            >
              <Plus className="h-3.5 w-3.5 shrink-0 text-orange-400" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-800">
                  {primaryNames[h.id] || h.address || "No address"}
                </p>
                <p className="truncate text-xs text-slate-400">
                  {h.address}{h.area ? ` · ${h.area}` : ""}
                </p>
              </div>
            </button>
          ))}
          {results.length === 0 && (
            <p className="py-8 text-center text-xs text-slate-400">
              {search.trim() ? "No matches" : allHouseholds.length === 0 ? "No households found" : "All households added"}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col min-w-0">
        <p className="mb-1.5 text-xs font-semibold text-slate-600">
          Visit order
          {selected.length > 0 && (
            <span className="ml-1 font-normal text-slate-400">{selected.length} · drag to reorder</span>
          )}
        </p>
        <div className="flex-1 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-50">
          {selected.length === 0 ? (
            <p className="py-10 text-center text-xs text-slate-400">← Pick households on the left</p>
          ) : (
            selected.map((hh, i) => (
              <div
                key={hh.householdId}
                draggable
                onDragStart={() => setDragIdx(i)}
                onDragOver={(e) => { e.preventDefault(); setOverIdx(i); }}
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
                  <p className="truncate text-sm text-slate-800">{hh.primaryName || hh.address || "—"}</p>
                  {hh.address && hh.primaryName && (
                    <p className="truncate text-xs text-slate-400">
                      {hh.address}{hh.area ? ` · ${hh.area}` : ""}
                    </p>
                  )}
                </div>
                <button
                  type="button" onClick={() => remove(hh.householdId)}
                  className="shrink-0 rounded p-0.5 text-slate-300 hover:text-rose-400 transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ── ScheduleEventModal (create & full edit for admin) ──────────────────────────

function ScheduleEventModal({ onClose, editEvent = null, prefillHouseholdId = null }) {
  const { showToast } = useToast();
  const { areas } = useAreasAndMandals();
  const [step, setStep] = useState(1);
  const [nonSanto, setNonSanto] = useState([]);
  const [santo, setSanto] = useState([]);
  const [allHouseholds, setAllHouseholds] = useState([]);
  const [primaryNames, setPrimaryNames] = useState({});
  const [saving, setSaving] = useState(false);
  const isEdit = Boolean(editEvent);

  const [form, setForm] = useState({
    name: editEvent?.name || "",
    scheduledDate: editEvent?.scheduledDate || "",
    area: editEvent?.area || "",
    assignedVolunteerId: editEvent?.assignedVolunteerId || "",
    assignedVolunteerName: editEvent?.assignedVolunteerName || "",
    secondVolunteerId: editEvent?.secondVolunteerId || "",
    secondVolunteerName: editEvent?.secondVolunteerName || "",
    santo2Id: editEvent?.santo2Id || "",
    santo2Name: editEvent?.santo2Name || "",
    notes: editEvent?.notes || "",
  });

  const [selected, setSelected] = useState(
    editEvent?.households ? [...editEvent.households] : []
  );

  useEffect(() => {
    Promise.all([
      loadVolunteersAndRoles(),
      getDocs(query(collection(db, "households"), orderBy("address"))),
      getDocs(collection(db, "individuals")),
    ]).then(([vols, hhSnap, indSnap]) => {
      setNonSanto(vols.nonSanto);
      setSanto(vols.santo);
      const hhs = hhSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setAllHouseholds(hhs);
      const names = {};
      indSnap.docs.forEach((d) => {
        const ind = d.data();
        if (!ind.householdId) return;
        if (ind.isPrimary || !names[ind.householdId]) names[ind.householdId] = ind.name;
      });
      setPrimaryNames(names);
      if (prefillHouseholdId && !isEdit) {
        const hh = hhs.find((h) => h.id === prefillHouseholdId);
        if (hh) {
          setSelected([{
            householdId: hh.id,
            address: hh.address || "",
            area: hh.area || "",
            primaryName: names[hh.id] || "",
            status: "pending",
          }]);
        }
      }
    });
  }, [prefillHouseholdId, isEdit]);

  function pickVol(list, idField, nameField, id) {
    const v = list.find((x) => x.id === id);
    setForm((f) => ({ ...f, [idField]: id, [nameField]: v?.name || "" }));
  }

  async function handleSave() {
    if (!form.scheduledDate) {
      showToast({ type: "error", message: "Date is required." });
      return;
    }
    setSaving(true);
    try {
      const autoName = form.name.trim() ||
        `${form.area || "Padhramani"} – ${formatDate(form.scheduledDate)}`;
      const payload = {
        name: autoName,
        scheduledDate: form.scheduledDate,
        area: form.area || null,
        assignedVolunteerId: form.assignedVolunteerId || null,
        assignedVolunteerName: form.assignedVolunteerName || null,
        secondVolunteerId: form.secondVolunteerId || null,
        secondVolunteerName: form.secondVolunteerName || null,
        santo2Id: form.santo2Id || null,
        santo2Name: form.santo2Name || null,
        notes: form.notes || null,
        households: selected,
        updatedAt: serverTimestamp(),
      };
      if (isEdit) {
        await updateDoc(doc(db, "padhramaniEvents", editEvent.id), payload);
        showToast({ type: "success", message: "Event updated." });
      } else {
        await addDoc(collection(db, "padhramaniEvents"), {
          ...payload,
          createdAt: serverTimestamp(),
        });
        showToast({ type: "success", message: "Padhramani scheduled." });
      }
      onClose();
    } catch (err) {
      showToast({ type: "error", message: err.message || "Couldn't save." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? "Edit Padhramani Event" : "Schedule Padhramani"}
      size="lg"
    >
      <div className="mb-5 flex items-center gap-2">
        {[{ n: 1, label: "Event details" }, { n: 2, label: "Households" }].map((s, i) => (
          <div key={s.n} className="flex items-center gap-2">
            {i > 0 && <div className="h-px w-6 bg-slate-200" />}
            <div className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
              step === s.n ? "bg-orange-100 text-orange-700"
              : step > s.n ? "bg-emerald-50 text-emerald-600"
              : "bg-slate-100 text-slate-400"
            }`}>
              <span>{s.n}</span><span>{s.label}</span>
            </div>
          </div>
        ))}
      </div>

      {step === 1 ? (
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Event name (optional)</label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder={`e.g. ${form.area || "Area"} Padhramani`}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">
                Date <span className="text-rose-500">*</span>
              </label>
              <Input
                type="date"
                value={form.scheduledDate}
                onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Area</label>
              <select
                value={form.area}
                onChange={(e) => setForm({ ...form, area: e.target.value })}
                className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-300"
              >
                <option value="">Select area…</option>
                {areas.map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
              </select>
            </div>
          </div>
          <VolunteerDropdown
            label="Karyakarta (Volunteer)"
            value={form.assignedVolunteerId}
            onChange={(id) => pickVol(nonSanto, "assignedVolunteerId", "assignedVolunteerName", id)}
            volunteers={nonSanto}
          />
          <div className="grid grid-cols-2 gap-3">
            <VolunteerDropdown
              label="Santo 1"
              value={form.secondVolunteerId}
              onChange={(id) => pickVol(santo, "secondVolunteerId", "secondVolunteerName", id)}
              volunteers={santo}
            />
            <VolunteerDropdown
              label="Santo 2"
              value={form.santo2Id}
              onChange={(id) => pickVol(santo, "santo2Id", "santo2Name", id)}
              volunteers={santo}
            />
          </div>
          {santo.length === 0 && nonSanto.length > 0 && (
            <p className="text-xs text-amber-600">
              No volunteers with a "Santo" role found — create a role named "Santo" in Admin first.
            </p>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
              placeholder="Optional…"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-slate-300"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="accent" onClick={() => setStep(2)} disabled={!form.scheduledDate}>
              Next: Add Households →
            </Button>
          </div>
        </div>
      ) : (
        <>
          <HouseholdPicker
            selected={selected}
            setSelected={setSelected}
            allHouseholds={allHouseholds}
            primaryNames={primaryNames}
          />
          <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
            <Button variant="ghost" onClick={() => setStep(1)}>← Back</Button>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button variant="accent" onClick={handleSave} disabled={saving}>
                {saving
                  ? "Saving…"
                  : isEdit
                  ? "Save changes"
                  : `Schedule · ${selected.length} household${selected.length !== 1 ? "s" : ""}`}
              </Button>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}

// ── EditHouseholdsModal (karyakarta: household list & order only) ──────────────

function EditHouseholdsModal({ event, onClose }) {
  const { showToast } = useToast();
  const [allHouseholds, setAllHouseholds] = useState([]);
  const [primaryNames, setPrimaryNames] = useState({});
  const [selected, setSelected] = useState([...(event.households || [])]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      getDocs(query(collection(db, "households"), orderBy("address"))),
      getDocs(collection(db, "individuals")),
    ]).then(([hhSnap, indSnap]) => {
      setAllHouseholds(hhSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      const names = {};
      indSnap.docs.forEach((d) => {
        const ind = d.data();
        if (!ind.householdId) return;
        if (ind.isPrimary || !names[ind.householdId]) names[ind.householdId] = ind.name;
      });
      setPrimaryNames(names);
    });
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      await updateDoc(doc(db, "padhramaniEvents", event.id), {
        households: selected,
        updatedAt: serverTimestamp(),
      });
      showToast({ type: "success", message: "Households updated." });
      onClose();
    } catch (err) {
      showToast({ type: "error", message: err.message || "Couldn't save." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Edit Households" size="lg">
      <HouseholdPicker
        selected={selected}
        setSelected={setSelected}
        allHouseholds={allHouseholds}
        primaryNames={primaryNames}
      />
      <div className="mt-4 flex justify-end gap-2 border-t border-slate-100 pt-3">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="accent" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </Modal>
  );
}

// ── EventCard ──────────────────────────────────────────────────────────────────

function EventCard({ event, isAdmin, currentUserId, onEdit, onDelete, onUpdateHouseholdStatus }) {
  const [expanded, setExpanded] = useState(false);
  const hhs = event.households || [];
  const visited = hhs.filter((h) => h.status === "completed").length;
  const isAssignedKaryakarta = event.assignedVolunteerId === currentUserId;
  const canAct = isAdmin || isAssignedKaryakarta;

  const volunteerParts = [
    event.assignedVolunteerName,
    event.secondVolunteerName,
    event.santo2Name,
  ].filter(Boolean);

  return (
    <div className="rounded-xl border border-slate-100 bg-white shadow-sm overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-start gap-3 p-4 text-left hover:bg-slate-50/70 transition-colors"
      >
        <div className="mt-0.5 rounded-lg bg-orange-50 p-2 shrink-0">
          <CalendarDays className="h-4 w-4 text-orange-500" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-slate-900">
              {event.name || formatDate(event.scheduledDate)}
            </p>
            {event.area && (
              <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">
                {event.area}
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="h-3 w-3" />{formatDate(event.scheduledDate)}
            </span>
            {volunteerParts.length > 0 && (
              <span className="inline-flex items-center gap-1 font-medium text-slate-700">
                <Users className="h-3 w-3" />{volunteerParts.join(" · ")}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Home className="h-3 w-3" />
              {hhs.length} household{hhs.length !== 1 ? "s" : ""}
              {hhs.length > 0 && (
                <span className="ml-1 font-medium text-emerald-600">· {visited} visited</span>
              )}
            </span>
          </div>
          {event.notes && (
            <p className="mt-0.5 text-xs italic text-slate-400 truncate max-w-sm">{event.notes}</p>
          )}
        </div>
        <ChevronDown className={`h-4 w-4 text-slate-400 shrink-0 mt-1 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
      </button>

      {expanded && (
        <div className="border-t border-slate-100">
          <div className="max-h-80 overflow-y-auto">
            {hhs.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-400">No households added yet.</p>
            ) : (
              <div className="divide-y divide-slate-50">
                {hhs.map((hh, i) => (
                  <div key={hh.householdId} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="w-5 shrink-0 text-center text-xs font-semibold text-slate-300">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">
                        {hh.primaryName || hh.address || "—"}
                      </p>
                      {hh.primaryName && hh.address && (
                        <p className="truncate text-xs text-slate-400">
                          {hh.address}{hh.area ? ` · ${hh.area}` : ""}
                        </p>
                      )}
                    </div>
                    {canAct ? (
                      <select
                        value={hh.status || "pending"}
                        onChange={(e) => onUpdateHouseholdStatus(i, e.target.value)}
                        className="h-7 rounded-md border border-slate-200 bg-white px-1.5 text-xs focus:outline-none shrink-0"
                      >
                        {Object.entries(HH_STATUSES).map(([k, v]) => (
                          <option key={k} value={k}>{v.label}</option>
                        ))}
                      </select>
                    ) : (
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-medium shrink-0 ${HH_STATUSES[hh.status || "pending"]?.color}`}>
                        {HH_STATUSES[hh.status || "pending"]?.label}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {canAct && (
            <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-4 py-2.5">
              <Button variant="ghost" size="sm" onClick={() => onEdit(event)}>
                <Pencil className="h-3.5 w-3.5" />
                {isAdmin ? "Edit event" : "Edit households"}
              </Button>
              {isAdmin && (
                <button
                  onClick={() => onDelete(event.id)}
                  className="rounded-md px-2.5 py-1.5 text-xs font-medium text-rose-500 hover:bg-rose-50 inline-flex items-center gap-1.5 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function PadhramaniPage() {
  const { volunteer: currentUser, hasPermission } = useAuth();
  const { showToast } = useToast();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [editEvent, setEditEvent] = useState(null);
  const [editHouseholdsEvent, setEditHouseholdsEvent] = useState(null);

  const isAdmin = hasPermission("manage_users") || hasPermission("view_all_contacts");

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "padhramaniEvents"), orderBy("scheduledDate", "desc")),
      (snap) => {
        setEvents(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (err) => {
        console.error("padhramaniEvents:", err.message);
        setLoading(false);
      }
    );
    return unsub;
  }, []);

  const today = todayStr();
  const upcoming = useMemo(
    () =>
      events
        .filter((e) => (e.scheduledDate || "") >= today)
        .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate)),
    [events, today]
  );
  const past = useMemo(
    () => events.filter((e) => (e.scheduledDate || "") < today),
    [events, today]
  );

  const totalHouseholds = useMemo(
    () => events.reduce((n, e) => n + (e.households?.length || 0), 0),
    [events]
  );
  const totalVisited = useMemo(
    () =>
      events.reduce(
        (n, e) => n + (e.households || []).filter((h) => h.status === "completed").length,
        0
      ),
    [events]
  );

  async function handleDelete(eventId) {
    if (!window.confirm("Remove this Padhramani event?")) return;
    try {
      await deleteDoc(doc(db, "padhramaniEvents", eventId));
      showToast({ type: "success", message: "Event removed." });
    } catch (err) {
      showToast({ type: "error", message: err.message || "Couldn't delete." });
    }
  }

  function handleEdit(event) {
    if (isAdmin) {
      setEditEvent(event);
    } else {
      setEditHouseholdsEvent(event);
    }
  }

  async function handleUpdateHouseholdStatus(event, hhIndex, newStatus) {
    const updated = (event.households || []).map((hh, i) =>
      i === hhIndex ? { ...hh, status: newStatus } : hh
    );
    try {
      await updateDoc(doc(db, "padhramaniEvents", event.id), {
        households: updated,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      showToast({ type: "error", message: err.message || "Couldn't update status." });
    }
  }

  function exportCSV() {
    const rows = [];
    events.forEach((ev) => {
      (ev.households || []).forEach((hh) => {
        rows.push(
          [
            ev.scheduledDate || "", ev.name || "", ev.area || "",
            ev.assignedVolunteerName || "",
            ev.secondVolunteerName || "",
            ev.santo2Name || "",
            hh.primaryName || hh.address || "",
            hh.address || "", hh.area || "",
            HH_STATUSES[hh.status || "pending"]?.label || "Pending",
          ]
            .map((v) => `"${String(v).replace(/"/g, '""')}"`)
            .join(",")
        );
      });
    });
    const header = ["Date","Event","Area","Karyakarta","Santo 1","Santo 2","Household","Address","HH Area","Status"];
    downloadCSV([header.join(","), ...rows].join("\n"), `padhramani-${today}.csv`);
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 tracking-tight">Padhramani</h1>
          <p className="text-sm text-slate-400">
            {events.length} event{events.length !== 1 ? "s" : ""} ·{" "}
            {totalHouseholds} households · {totalVisited} visited
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={exportCSV}>
            <Download className="h-3.5 w-3.5" /> Export CSV
          </Button>
          <RequirePermission permission="edit_contacts">
            <Button variant="accent" onClick={() => setScheduleOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Schedule Padhramani
            </Button>
          </RequirePermission>
        </div>
      </div>

      {/* Area-wise stats */}
      <AreaStats events={events} />

      {/* Content */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      ) : events.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 py-20 text-center">
          <CalendarDays className="mx-auto h-8 w-8 text-slate-300 mb-3" />
          <p className="font-medium text-slate-500">No Padhramani events yet</p>
          <p className="mt-1 text-sm text-slate-400">
            Click "Schedule Padhramani" to create one.
          </p>
        </div>
      ) : (
        <>
          {upcoming.length > 0 && (
            <section className="mb-8">
              <div className="mb-3 flex items-center gap-2">
                <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
                  Upcoming Padhramani
                </span>
                <span className="text-xs text-slate-400">
                  {upcoming.length} event{upcoming.length !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="space-y-2">
                {upcoming.map((ev) => (
                  <EventCard
                    key={ev.id} event={ev}
                    isAdmin={isAdmin} currentUserId={currentUser?.id}
                    onEdit={handleEdit} onDelete={handleDelete}
                    onUpdateHouseholdStatus={(i, s) => handleUpdateHouseholdStatus(ev, i, s)}
                  />
                ))}
              </div>
            </section>
          )}

          {past.length > 0 && (
            <section>
              <div className="mb-3 flex items-center gap-2">
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                  Past Padhramani
                </span>
                <span className="text-xs text-slate-400">
                  {past.length} event{past.length !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="space-y-2">
                {past.map((ev) => (
                  <EventCard
                    key={ev.id} event={ev}
                    isAdmin={isAdmin} currentUserId={currentUser?.id}
                    onEdit={handleEdit} onDelete={handleDelete}
                    onUpdateHouseholdStatus={(i, s) => handleUpdateHouseholdStatus(ev, i, s)}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {scheduleOpen && (
        <ScheduleEventModal onClose={() => setScheduleOpen(false)} />
      )}
      {editEvent && (
        <ScheduleEventModal editEvent={editEvent} onClose={() => setEditEvent(null)} />
      )}
      {editHouseholdsEvent && (
        <EditHouseholdsModal event={editHouseholdsEvent} onClose={() => setEditHouseholdsEvent(null)} />
      )}
    </div>
  );
}

// Exported for HouseholdDetailPage
export function SchedulePadhramaniModal({ householdId, onClose }) {
  return <ScheduleEventModal onClose={onClose} prefillHouseholdId={householdId} />;
}
