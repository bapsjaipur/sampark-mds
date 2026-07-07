// src/pages/PadhramaniPage.jsx — 6.1–6.9 Padhramani (home visit) tracking
import { useEffect, useMemo, useState } from "react";
import {
  collection, addDoc, updateDoc, doc, getDocs,
  serverTimestamp, query, orderBy, where,
} from "firebase/firestore";
import { Plus, CheckCircle2, XCircle, Clock, Home, BarChart2, Download, Bell } from "lucide-react";
import { db } from "../lib/firebase";
import { usePadhramani } from "../hooks/usePadhramani";
import { useAreasAndMandals } from "../hooks/useAreasAndMandals";
import { useAuth } from "../hooks/usePermissions";
import { Button } from "../components/ui/Button";
import { Input, Select } from "../components/ui/Input";
import { Badge } from "../components/ui/Badge";
import Modal from "../components/ui/Modal";
import { useToast } from "../contexts/ToastContext";

// ── constants ──────────────────────────────────────────────────────────────────
const OUTCOMES = {
  scheduled: { label: "Scheduled", color: "bg-blue-50 text-blue-700 border-blue-200" },
  completed: { label: "Completed", color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  not_home:  { label: "Not home",  color: "bg-amber-50 text-amber-700 border-amber-200" },
  rescheduled: { label: "Rescheduled", color: "bg-purple-50 text-purple-700 border-purple-200" },
  cancelled: { label: "Cancelled", color: "bg-slate-100 text-slate-500 border-slate-200" },
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
  return diff >= 0 && diff <= 3 * 24 * 60 * 60 * 1000; // within 3 days
}

function overdue(str, status) {
  if (!str || status !== "scheduled") return false;
  return new Date(str).getTime() < Date.now();
}

// ── Schedule visit modal (6.2) ─────────────────────────────────────────────────
function ScheduleVisitModal({ onClose }) {
  const { volunteer } = useAuth();
  const { showToast } = useToast();
  const [households, setHouseholds] = useState([]);
  const [volunteers, setVolunteers] = useState([]);
  const [form, setForm] = useState({
    householdId: "",
    householdAddress: "",
    scheduledDate: "",
    assignedVolunteerId: volunteer?.id || "",
    assignedVolunteerName: volunteer?.name || "",
    area: "",
    mandal: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      getDocs(query(collection(db, "households"), orderBy("address"))),
      getDocs(collection(db, "volunteers")),
    ]).then(([hhSnap, volSnap]) => {
      setHouseholds(hhSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setVolunteers(volSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
  }, []);

  function handleHouseholdPick(id) {
    const hh = households.find((h) => h.id === id);
    setForm((f) => ({
      ...f,
      householdId: id,
      householdAddress: hh?.address || "",
      area: hh?.area || f.area,
    }));
  }

  function handleVolunteerPick(id) {
    const v = volunteers.find((x) => x.id === id);
    setForm((f) => ({ ...f, assignedVolunteerId: id, assignedVolunteerName: v?.name || "" }));
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
        area: form.area || null,
        mandal: form.mandal || null,
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

  return (
    <Modal open onClose={onClose} title="Schedule Padhramani visit">
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Household</label>
          <select
            value={form.householdId}
            onChange={(e) => handleHouseholdPick(e.target.value)}
            className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-300"
          >
            <option value="">Pick a household…</option>
            {households.map((h) => (
              <option key={h.id} value={h.id}>{h.address}{h.area ? ` — ${h.area}` : ""}</option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Scheduled date</label>
            <Input type="date" value={form.scheduledDate} onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Assigned volunteer</label>
            <select
              value={form.assignedVolunteerId}
              onChange={(e) => handleVolunteerPick(e.target.value)}
              className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-300"
            >
              <option value="">Unassigned</option>
              {volunteers.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Notes</label>
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            rows={2}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-slate-300"
            placeholder="Optional notes…"
          />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="accent" onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Schedule visit"}</Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Outcome modal (6.3) ────────────────────────────────────────────────────────
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
        // 6.3 — create a new scheduled visit when rescheduling
        await addDoc(collection(db, "padhramani"), {
          householdId: visit.householdId,
          householdAddress: visit.householdAddress,
          scheduledDate: rescheduleDate,
          assignedVolunteerId: visit.assignedVolunteerId || null,
          assignedVolunteerName: visit.assignedVolunteerName || null,
          area: visit.area || null,
          mandal: visit.mandal || null,
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
              <button
                key={key}
                onClick={() => setStatus(key)}
                className={`rounded-lg border px-3 py-2 text-left text-xs font-medium transition ${status === key ? o.color + " ring-2 ring-offset-1 ring-current" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
              >
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
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-slate-300"
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="accent" onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Summary stats (6.6) ────────────────────────────────────────────────────────
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

// ── CSV export (6.8) ───────────────────────────────────────────────────────────
function exportCSV(rows) {
  const headers = ["Household", "Area", "Scheduled Date", "Volunteer", "Status", "Notes"];
  const lines = rows.map((r) => [
    r.householdAddress || "",
    r.area || "",
    r.scheduledDate || "",
    r.assignedVolunteerName || "",
    r.status || "",
    (r.notes || "").replace(/"/g, '""'),
  ].map((v) => `"${v}"`).join(","));
  const csv = [headers.join(","), ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `padhramani-${Date.now()}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function PadhramaniPage() {
  const { visits, loading } = usePadhramani();
  const { areas, mandals } = useAreasAndMandals();
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [outcomeVisit, setOutcomeVisit] = useState(null);
  const [areaFilter, setAreaFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [volunteerFilter, setVolunteerFilter] = useState("");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("visits"); // 'visits' | 'by-household' | 'by-volunteer'

  // 6.7 filters
  const filtered = useMemo(() => {
    let rows = visits;
    if (areaFilter) rows = rows.filter((v) => v.area === areaFilter);
    if (statusFilter) rows = rows.filter((v) => v.status === statusFilter);
    if (volunteerFilter) rows = rows.filter((v) => v.assignedVolunteerName === volunteerFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((v) =>
        v.householdAddress?.toLowerCase().includes(q) ||
        v.assignedVolunteerName?.toLowerCase().includes(q) ||
        v.notes?.toLowerCase().includes(q)
      );
    }
    return rows;
  }, [visits, areaFilter, statusFilter, volunteerFilter, search]);

  // 6.9 — due-soon count for the bell indicator
  const dueSoonCount = useMemo(
    () => visits.filter((v) => v.status === "scheduled" && dueSoon(v.scheduledDate)).length,
    [visits]
  );

  // unique volunteers for filter
  const volunteerNames = useMemo(() => {
    const names = new Set(visits.map((v) => v.assignedVolunteerName).filter(Boolean));
    return [...names].sort();
  }, [visits]);

  // 6.4 — group by household for the household history tab
  const byHousehold = useMemo(() => {
    const map = {};
    filtered.forEach((v) => {
      if (!map[v.householdId]) map[v.householdId] = { address: v.householdAddress, area: v.area, visits: [] };
      map[v.householdId].visits.push(v);
    });
    return Object.entries(map).sort((a, b) => (a[1].address || "").localeCompare(b[1].address || ""));
  }, [filtered]);

  // 6.5 — group by volunteer for the volunteer history tab
  const byVolunteer = useMemo(() => {
    const map = {};
    filtered.forEach((v) => {
      const key = v.assignedVolunteerName || "Unassigned";
      if (!map[key]) map[key] = [];
      map[key].push(v);
    });
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

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
          <Button variant="secondary" onClick={() => exportCSV(filtered)}><Download className="h-3.5 w-3.5" /> Export</Button>
          <Button variant="accent" onClick={() => setScheduleOpen(true)}><Plus className="h-3.5 w-3.5" /> Schedule visit</Button>
        </div>
      </div>

      {/* Summary (6.6) */}
      <SummaryCards visits={visits} />

      {/* Filters (6.7) */}
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

      {/* Tab bar */}
      <div className="mb-4 flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 w-fit">
        {[
          { key: "visits", label: "All visits" },
          { key: "by-household", label: "By household" },
          { key: "by-volunteer", label: "By volunteer" },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${tab === t.key ? "bg-white shadow-sm text-slate-900" : "text-slate-500 hover:text-slate-700"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100" />)}</div>
      ) : filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 py-16 text-center text-slate-400">No visits match your filters.</p>
      ) : tab === "visits" ? (
        // ── All visits list ─────────────────────────────────────────────────────
        <div className="rounded-lg border border-slate-100 divide-y divide-slate-50">
          {filtered.map((v) => (
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
                  {overdue(v.scheduledDate, v.status) && (
                    <span className="text-xs font-medium text-rose-600">Overdue</span>
                  )}
                  {dueSoon(v.scheduledDate) && v.status === "scheduled" && (
                    <span className="text-xs font-medium text-amber-600">Due soon</span>
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  {formatDate(v.scheduledDate)}{v.area ? ` · ${v.area}` : ""}{v.assignedVolunteerName ? ` · ${v.assignedVolunteerName}` : ""}
                  {v.notes ? ` · ${v.notes}` : ""}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setOutcomeVisit(v)}>Update</Button>
            </div>
          ))}
        </div>
      ) : tab === "by-household" ? (
        // ── 6.4 By household ───────────────────────────────────────────────────
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
                {hh.visits.map((v) => (
                  <div key={v.id} className="flex items-center gap-2 text-xs text-slate-600">
                    <OutcomeBadge status={v.status} />
                    <span>{formatDate(v.scheduledDate)}</span>
                    {v.assignedVolunteerName && <span>· {v.assignedVolunteerName}</span>}
                    {v.notes && <span className="text-slate-400 truncate">· {v.notes}</span>}
                    <button onClick={() => setOutcomeVisit(v)} className="ml-auto text-slate-400 hover:text-slate-600 hover:underline">Update</button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        // ── 6.5 By volunteer ───────────────────────────────────────────────────
        <div className="space-y-3">
          {byVolunteer.map(([name, vVisits]) => (
            <div key={name} className="rounded-lg border border-slate-100 p-4">
              <div className="flex items-center gap-2 mb-2">
                <p className="text-sm font-medium text-slate-900">{name}</p>
                <span className="ml-auto text-xs text-slate-400">{vVisits.length} visit(s)</span>
                <span className="text-xs text-emerald-600">{vVisits.filter((v) => v.status === "completed").length} completed</span>
              </div>
              <div className="space-y-1.5">
                {vVisits.map((v) => (
                  <div key={v.id} className="flex items-center gap-2 text-xs text-slate-600">
                    <OutcomeBadge status={v.status} />
                    <span>{v.householdAddress || "?"}</span>
                    <span className="text-slate-400">{formatDate(v.scheduledDate)}</span>
                    <button onClick={() => setOutcomeVisit(v)} className="ml-auto text-slate-400 hover:text-slate-600 hover:underline">Update</button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {scheduleOpen && <ScheduleVisitModal onClose={() => setScheduleOpen(false)} />}
      {outcomeVisit && <OutcomeModal visit={outcomeVisit} onClose={() => setOutcomeVisit(null)} />}
    </div>
  );
}
