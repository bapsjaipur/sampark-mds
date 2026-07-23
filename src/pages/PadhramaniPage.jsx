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
  Home, CalendarDays, Users, GripVertical, X, MapPin, Route,
  FileDown, FileText,
} from "lucide-react";
import { exportPadhramaniDayPdf, exportBlankFormPdf, exportCampaignPdf } from "../lib/pdfExports";
import { db } from "../lib/firebase";
import { useAuth } from "../hooks/usePermissions";
import { useAreasAndMandals } from "../hooks/useAreasAndMandals";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import Modal from "../components/ui/Modal";
import { useToast } from "../contexts/ToastContext";
import RequirePermission from "../components/RequirePermission";
import CampaignSummary from "../components/admin-tools/CampaignSummary";

// ── Constants ──────────────────────────────────────────────────────────────────

export const HH_STATUSES = {
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

function getCampaignOptions() {
  return ['Uncategorized'];
}

// 7.4 — Nearest-neighbor TSP heuristic for "Suggest order"
function geoDistSq(a, b) {
  const dlat = a.lat - b.lat;
  const dlng = a.lng - b.lng;
  return dlat * dlat + dlng * dlng;
}

function nearestNeighborSort(items) {
  const withLoc = items.filter((h) => h.location?.lat && h.location?.lng);
  const noLoc = items.filter((h) => !h.location?.lat || !h.location?.lng);
  if (withLoc.length < 2) return items;
  const remaining = [...withLoc];
  const result = [remaining.splice(0, 1)[0]];
  while (remaining.length > 0) {
    const last = result[result.length - 1];
    let bestIdx = 0;
    let bestDist = Infinity;
    remaining.forEach((h, i) => {
      const d = geoDistSq(last.location, h.location);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    });
    result.push(remaining.splice(bestIdx, 1)[0]);
  }
  return [...result, ...noLoc];
}

// 7.3 — Build Google Maps directions URL from an ordered list of locations
function buildMapsRouteUrl(households) {
  const locs = households.map((h) => h.location).filter((l) => l?.lat && l?.lng);
  if (locs.length === 0) return null;
  if (locs.length === 1) return `https://www.google.com/maps?q=${locs[0].lat},${locs[0].lng}`;
  const origin = locs[0];
  const dest = locs[locs.length - 1];
  const waypoints = locs.slice(1, -1).slice(0, 8); // Maps URL supports up to 8 waypoints
  let url = `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${dest.lat},${dest.lng}`;
  if (waypoints.length > 0) {
    url += `&waypoints=${waypoints.map((l) => `${l.lat},${l.lng}`).join("|")}`;
  }
  return url;
}

async function loadVolunteersAndRoles() {  const [volSnap, roleSnap] = await Promise.all([
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

function HouseholdPicker({ selected, setSelected, allHouseholds, primaryNames, excludeIds, excludeLoading }) {
  const [search, setSearch] = useState("");
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);

  const selectedIds = useMemo(() => new Set(selected.map((h) => h.householdId)), [selected]);

  // DIAGNOSTIC LOG (TEMPORARY)
  useEffect(() => {
    console.log("[Picker debug] excludeIds size:", excludeIds?.size);
  }, [excludeIds]);

  const results = useMemo(() => allHouseholds.filter((h) => {
    if (selectedIds.has(h.id)) return false;
    if (excludeIds?.has(h.id)) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      h.address?.toLowerCase().includes(q) ||
      h.area?.toLowerCase().includes(q) ||
      primaryNames[h.id]?.toLowerCase().includes(q)
    );
  }), [allHouseholds, selectedIds, excludeIds, search, primaryNames]);

  function add(hh) {
    setSelected((prev) => [
      ...prev,
      {
        householdId: hh.id,
        address: hh.address || "",
        area: hh.area || "",
        primaryName: primaryNames[hh.id] || "",
        status: "pending",
        location: hh.location || null, // 7.3/7.4 — stored for map view and route sorting
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
              {search.trim() ? "No matches" : allHouseholds.length === 0 ? "No households found" : "All available households added"}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col min-w-0">
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-xs font-semibold text-slate-600">
            Visit order
            {selected.length > 0 && (
              <span className="ml-1 font-normal text-slate-400">{selected.length} · drag to reorder</span>
            )}
          </p>
          {selected.length >= 2 && (
            <button
              type="button"
              onClick={() => setSelected(nearestNeighborSort(selected.map((hh) => {
                const data = allHouseholds.find((h) => h.id === hh.householdId);
                return { ...hh, location: hh.location ?? data?.location ?? null };
              })))}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600 transition hover:bg-orange-50 hover:border-orange-300 hover:text-orange-700"
              title="Sort by nearest-neighbor route"
            >
              <Route className="h-3 w-3" /> Suggest order
            </button>
          )}
        </div>
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
        {/* 7.3 — Map link when at least one household has a geocoded location */}
        {(() => {
          const url = buildMapsRouteUrl(selected);
          return url ? (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 hover:underline"
            >
              <MapPin className="h-3 w-3" /> View route on Google Maps
            </a>
          ) : null;
        })()}
      </div>
    </div>
  );
}

// ── ScheduleEventModal (create & full edit for admin) ──────────────────────────

function ScheduleEventModal({ onClose, editEvent = null, prefillHouseholdId = null, options = [] }) {
  const { volunteer: currentUser, hasPermission } = useAuth();
  const isAdmin = hasPermission("manage_users") || hasPermission("view_all_contacts");

  const finalOptions = options.length > 0 ? options : getCampaignOptions();

  const { showToast } = useToast();
  const { areas } = useAreasAndMandals();
  const [step, setStep] = useState(1);
  const [nonSanto, setNonSanto] = useState([]);
  const [santo, setSanto] = useState([]);
  const [allHouseholds, setAllHouseholds] = useState([]);
  const [primaryNames, setPrimaryNames] = useState({});
  const [excludeIds, setExcludeIds] = useState(new Set());
  const [excludeLoading, setExcludeLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const isEdit = Boolean(editEvent);

  const [form, setForm] = useState(() => {
    if (editEvent) return {
      name: editEvent.name || "",
      campaign: editEvent.campaign || "General / Other",
      scheduledDate: editEvent.scheduledDate || "",
      area: editEvent.area || "",
      assignedVolunteerId: editEvent.assignedVolunteerId || "",
      assignedVolunteerName: editEvent.assignedVolunteerName || "",
      secondVolunteerId: editEvent.secondVolunteerId || "",
      secondVolunteerName: editEvent.secondVolunteerName || "",
      santo2Id: editEvent.santo2Id || "",
      santo2Name: editEvent.santo2Name || "",
      notes: editEvent.notes || "",
    };

    // Auto-select the current non-admin volunteer as Karyakarta if applicable
    return {
      name: "",
      campaign: getCampaignOptions()[0], // Default to current season
      scheduledDate: "",
      area: (currentUser?.assignedAreas || [])[0] || "",
      assignedVolunteerId: isAdmin ? "" : currentUser?.id || "",
      assignedVolunteerName: isAdmin ? "" : currentUser?.name || "",
      secondVolunteerId: "",
      secondVolunteerName: "",
      santo2Id: "",
      santo2Name: "",
      notes: "",
    };
  });

  const [selected, setSelected] = useState(
    editEvent?.households ? [...editEvent.households] : []
  );

  useEffect(() => {
    Promise.all([
      loadVolunteersAndRoles(),
      getDocs(query(collection(db, "households"), orderBy("address"))),
      getDocs(collection(db, "individuals")),
      getDocs(collection(db, "padhramaniEvents")),
    ]).then(([vols, hhSnap, indSnap, evSnap]) => {
      setNonSanto(vols.nonSanto);
      setSanto(vols.santo);
      let hhs = hhSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

      if (!isAdmin && currentUser?.assignedAreas?.length > 0) {
        hhs = hhs.filter(hh => currentUser.assignedAreas.includes(hh.area));
      }

      setAllHouseholds(hhs);
      const names = {};
      indSnap.docs.forEach((d) => {
        const ind = d.data();
        if (!ind.householdId) return;
        if (ind.isPrimary || !names[ind.householdId]) names[ind.householdId] = ind.name;
      });
      setPrimaryNames(names);

      // Exclude households already scheduled on any OTHER Padhramani event —
      // once assigned to one day's visit, it's not offered for another.
      const used = new Set();
      console.log("[Padhramani debug] Total events fetched:", evSnap.size);
      evSnap.docs.forEach((d) => {
        const data = d.data();
        const hhList = data.households || data.Households || [];
        if (isEdit && d.id === editEvent.id) return;
        hhList.forEach((hh) => {
          if (!hh) return;
          // In some versions, Firebase might store refs, strings, or objects
          const hid = typeof hh === "string" ? hh : (hh.householdId || hh.id || hh.toString());
          if (hid && typeof hid === "string" && hid.length > 5) {
             used.add(hid);
          }
        });
      });
      console.log(`[Padhramani debug] Excluded ${used.size} unique households.`);
      if (used.size > 0) {
        const sampleIds = [...used].slice(0, 3);
        const sampleAddrs = hhs.filter(h => sampleIds.includes(h.id)).map(h => h.address);
        console.log(`[Padhramani debug] Sample excluded addresses:`, sampleAddrs);
      }
      setExcludeIds(used);
      setExcludeLoading(false);

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
        campaign: form.campaign || "General / Other",
        scheduledDate: form.scheduledDate,
        area: form.area || null,
        assignedVolunteerId: form.assignedVolunteerId || null,
        assignedVolunteerName: form.assignedVolunteerName || null,
        secondVolunteerId: form.secondVolunteerId || null,
        secondVolunteerName: form.secondVolunteerName || null,
        santo2Id: form.santo2Id || null,
        santo2Name: form.santo2Name || null,
        // santoRefs — array-contains index used by SantoSchedulePage to query
        // "my schedule" without a composite index on multiple individual fields.
        santoRefs: [form.secondVolunteerId, form.santo2Id].filter(Boolean),
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Event name (optional)</label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={`e.g. ${form.area || "Area"} Padhramani`}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Campaign / Season</label>
              <select
                value={form.campaign}
                onChange={(e) => setForm({ ...form, campaign: e.target.value })}
                className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-300"
              >
                {finalOptions.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>
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
          {isAdmin ? (
            <VolunteerDropdown
              label="Karyakarta (Volunteer)"
              value={form.assignedVolunteerId}
              onChange={(id) => pickVol(nonSanto, "assignedVolunteerId", "assignedVolunteerName", id)}
              volunteers={nonSanto}
            />
          ) : (
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Karyakarta</label>
              <div className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm text-slate-700 font-medium">
                {form.assignedVolunteerName || "Self"}
              </div>
            </div>
          )}

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
            excludeIds={excludeIds}
            excludeLoading={excludeLoading}
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
  const { volunteer: currentUser, hasPermission } = useAuth();
  const isAdmin = hasPermission("manage_users") || hasPermission("view_all_contacts");

  const { showToast } = useToast();
  const [allHouseholds, setAllHouseholds] = useState([]);
  const [primaryNames, setPrimaryNames] = useState({});
  const [excludeIds, setExcludeIds] = useState(new Set());
  const [excludeLoading, setExcludeLoading] = useState(true);
  const [selected, setSelected] = useState([...(event.households || [])]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      getDocs(query(collection(db, "households"), orderBy("address"))),
      getDocs(collection(db, "individuals")),
      getDocs(collection(db, "padhramaniEvents")),
    ]).then(([hhSnap, indSnap, evSnap]) => {
      let hhs = hhSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

      if (!isAdmin && currentUser?.assignedAreas?.length > 0) {
        hhs = hhs.filter(hh => currentUser.assignedAreas.includes(hh.area));
      }

      setAllHouseholds(hhs);
      const names = {};
      indSnap.docs.forEach((d) => {
        const ind = d.data();
        if (!ind.householdId) return;
        if (ind.isPrimary || !names[ind.householdId]) names[ind.householdId] = ind.name;
      });
      setPrimaryNames(names);

      const used = new Set();
      evSnap.docs.forEach((d) => {
        if (d.id === event.id) return;
        const data = d.data();
        const hhList = data.households || data.Households || [];
        hhList.forEach((hh) => {
          const hid = typeof hh === "string" ? hh : (hh.householdId || hh.id);
          if (hid) used.add(hid);
        });
      });
      console.log("[EditHouseholds debug] events found:", evSnap.docs.length, "| households excluded:", used.size);
      setExcludeIds(used);
      setExcludeLoading(false);
    });
  }, [event.id]);

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
        excludeIds={excludeIds}
        excludeLoading={excludeLoading}
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

export function EventCard({ event, isAdmin, currentUserId, onEdit, onDelete, onUpdateHouseholdStatus }) {
  const [expanded, setExpanded] = useState(false);
  const [printing, setPrinting] = useState(false);

  async function handlePrint() {
    setPrinting(true);
    try { await exportPadhramaniDayPdf(event); } finally { setPrinting(false); }
  }
  const hhs = event.households || [];
  const visited = hhs.filter((h) => h.status === "completed").length;
  const isAssignedKaryakarta = event.assignedVolunteerId === currentUserId;
  // Santo volunteers can update household visit status but cannot edit/delete the event
  const isSantoOnEvent =
    event.santoRefs?.includes(currentUserId) ||
    event.secondVolunteerId === currentUserId ||
    event.santo2Id === currentUserId;
  const canUpdateStatus = isAdmin || isAssignedKaryakarta || isSantoOnEvent;
  const canEditEvent = isAdmin || isAssignedKaryakarta;

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
                        {hh.location?.lat && (
                          <MapPin className="ml-1 inline h-3 w-3 text-emerald-400" />
                        )}
                      </p>
                      {hh.primaryName && hh.address && (
                        <p className="truncate text-xs text-slate-400">
                          {hh.address}{hh.area ? ` · ${hh.area}` : ""}
                        </p>
                      )}
                    </div>
                    {canUpdateStatus ? (
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

          {/* Footer: route link + print button, then edit controls */}
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2">
            {(() => {
              const url = buildMapsRouteUrl(hhs);
              return url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:underline"
                >
                  <MapPin className="h-3.5 w-3.5" /> View route on Google Maps
                </a>
              ) : <span />;
            })()}
            <button
              type="button"
              onClick={handlePrint}
              disabled={printing}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              <FileDown className="h-3.5 w-3.5" />
              {printing ? "Generating…" : "Print schedule"}
            </button>
          </div>

          {canEditEvent && (
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
  const [dbCampaigns, setDbCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCampaign, setSelectedCampaign] = useState(() => {
    return localStorage.getItem('mds_last_padhramani_campaign') || null;
  });
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [editEvent, setEditEvent] = useState(null);
  const [editHouseholdsEvent, setEditHouseholdsEvent] = useState(null);

  const isAdmin = hasPermission("manage_users") || hasPermission("view_all_contacts");

  useEffect(() => {
    const unsubEvents = onSnapshot(
      query(collection(db, "padhramaniEvents"), orderBy("scheduledDate", "desc")),
      (snap) => {
        let allDocs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

        // 1. Filter out events if not Admin (Admin sees all)
        if (!isAdmin && currentUser?.id) {
          allDocs = allDocs.filter(
            (ev) =>
              ev.assignedVolunteerId === currentUser.id ||
              ev.secondVolunteerId === currentUser.id ||
              ev.santo2Id === currentUser.id ||
              (ev.santoRefs && ev.santoRefs.includes(currentUser.id))
          );
        }

        setEvents(allDocs);
        setLoading(false);
      },
      (err) => {
        console.error("padhramaniEvents:", err.message);
        setLoading(false);
      }
    );

    const unsubCampaigns = onSnapshot(collection(db, "campaigns"), (snap) => {
      setDbCampaigns(snap.docs.map(d => d.data().name));
    });

    return () => { unsubEvents(); unsubCampaigns(); };
  }, [isAdmin, currentUser?.id]);

  // Determine available campaign options dynamically to avoid losing older ones
  const campaignOptions = useMemo(() => {
    const existingCampaigns = events.map(e => e.campaign).filter(Boolean);
    const unionSet = new Set([...dbCampaigns, ...existingCampaigns]);

    // Convert to array and sort descending (so newest year/alphabetical stays top)
    const sorted = [...unionSet].sort((a, b) => b.localeCompare(a));

    // Always append "Uncategorized" at the very end
    return [...sorted, 'Uncategorized'];
  }, [events, dbCampaigns]);

  // Persist campaign selection on change, and auto-select a smart default on load
  useEffect(() => {
    if (selectedCampaign && campaignOptions.includes(selectedCampaign)) {
      localStorage.setItem('mds_last_padhramani_campaign', selectedCampaign);
    } else if (!selectedCampaign && campaignOptions.length > 0) {
      // If nothing matches or loaded for first time, pick the first valid campaign
      // (which is the top sorted one), unless there are none, then Uncategorized.
      const smartDefault = campaignOptions[0] !== 'Uncategorized' ? campaignOptions[0] : 'Uncategorized';
      setSelectedCampaign(smartDefault);
    }
  }, [selectedCampaign, campaignOptions]);

  // Filter events based on selected campaign
  const filteredEvents = useMemo(() => {
    if (selectedCampaign === 'Uncategorized') {
      return events.filter(e => !e.campaign);
    }
    return events.filter(e => (e.campaign || "General / Other") === selectedCampaign);
  }, [events, selectedCampaign]);

  const today = todayStr();
  const upcoming = useMemo(
    () =>
      filteredEvents
        .filter((e) => (e.scheduledDate || "") >= today)
        .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate)),
    [filteredEvents, today]
  );
  const past = useMemo(
    () => filteredEvents.filter((e) => (e.scheduledDate || "") < today),
    [filteredEvents, today]
  );

  const totalHouseholds = useMemo(
    () => filteredEvents.reduce((n, e) => n + (e.households?.length || 0), 0),
    [filteredEvents]
  );
  const totalVisited = useMemo(
    () =>
      filteredEvents.reduce(
        (n, e) => n + (e.households || []).filter((h) => h.status === "completed").length,
        0
      ),
    [filteredEvents]
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

  const exportCSV = async () => {
    // 1. Fetch all members once for efficient lookup
    const indSnap = await getDocs(collection(db, "individuals"));
    const allIndividuals = indSnap.docs.map(d => ({id: d.id, ...d.data()}));

    // Create map for householdId -> individualList
    const membersByHH = {};
    allIndividuals.forEach(ind => {
        if (!ind.householdId) return;
        if (!membersByHH[ind.householdId]) membersByHH[ind.householdId] = [];
        membersByHH[ind.householdId].push(ind);
    });

    const rows = [];
    filteredEvents.forEach((ev) => {
      (ev.households || []).forEach((hh) => {
        const hhMembers = membersByHH[hh.householdId] || [];
        const memberDetails = hhMembers.map(m => `${m.name} (${m.relation || "Member"}) - ${m.mobile || ""}`).join(", ");

        rows.push(
          [
            ev.scheduledDate || "", ev.name || "", ev.area || "",
            ev.assignedVolunteerName || "",
            ev.secondVolunteerName || "",
            ev.santo2Name || "",
            hh.primaryName || hh.address || "",
            hh.address || "", hh.area || "",
            HH_STATUSES[hh.status || "pending"]?.label || "Pending",
            memberDetails
          ]
            .map((v) => `"${String(v).replace(/"/g, '""')}"`)
            .join(",")
        );
      });
    });
    const header = ["Date","Event","Area","Karyakarta","Santo 1","Santo 2","Household","Address","HH Area","Status", "Family Members (Details)"];
    downloadCSV([header.join(","), ...rows].join("\n"), `padhramani-${today}-${selectedCampaign.replace(/\s+/g, '-')}.csv`);
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 tracking-tight">Padhramani</h1>
          <p className="text-sm text-slate-400">
            {filteredEvents.length} event{filteredEvents.length !== 1 ? "s" : ""} ·{" "}
            {totalHouseholds} households · {totalVisited} visited
          </p>
        </div>
        <div className="flex gap-2">
          <select
            value={selectedCampaign}
            onChange={(e) => setSelectedCampaign(e.target.value)}
            className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-300"
          >
            {campaignOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <Button variant="secondary" onClick={() => exportBlankFormPdf()}>
            <FileText className="h-3.5 w-3.5" /> Blank form
          </Button>
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
      <CampaignSummary events={filteredEvents} />
      <AreaStats events={filteredEvents} />

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
        <ScheduleEventModal options={campaignOptions} onClose={() => setScheduleOpen(false)} />
      )}
      {editEvent && (
        <ScheduleEventModal options={campaignOptions} editEvent={editEvent} onClose={() => setEditEvent(null)} />
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
