// src/pages/SantoSchedulePage.jsx — Section 8 (8.2 + 8.3)
// Personal Padhramani schedule for Santo volunteers.
//   8.2 — Queries padhramaniEvents where santoRefs array-contains current uid.
//          Shows past and upcoming sections; each event card is expandable with
//          household status (Santos can mark households as visited).
//   8.3 — Dashboard at the top: today's visit, next upcoming date, this-month
//          count, all-time totals.
//
// NOTE: The query uses `where("santoRefs", "array-contains", uid)` with
// client-side sort (no orderBy) to avoid requiring a Firestore composite index.
// Once event volume grows, you can add the index and add orderBy("scheduledDate","desc").
import { useEffect, useMemo, useState } from "react";
import {
  collection, query, where, onSnapshot, updateDoc, doc, serverTimestamp,
} from "firebase/firestore";
import { CalendarDays, HeartHandshake, Home, TrendingUp } from "lucide-react";
import { db } from "../lib/firebase";
import { useAuth } from "../hooks/usePermissions";
import { useToast } from "../contexts/ToastContext";
import { EventCard } from "./PadhramaniPage";

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function thisMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function fmtDate(str) {
  if (!str) return "—";
  const d = new Date(str + "T00:00:00");
  return isNaN(d) ? str : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function StatCard({ label, value, sub, icon: Icon, highlight }) {
  return (
    <div className={`flex-1 min-w-[140px] rounded-xl border p-4 shadow-sm ${highlight ? "border-orange-200 bg-orange-50" : "border-slate-100 bg-white"}`}>
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 rounded-lg p-2 ${highlight ? "bg-orange-500" : "bg-slate-100"}`}>
          <Icon className={`h-4 w-4 ${highlight ? "text-white" : "text-slate-500"}`} />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
          <p className={`mt-0.5 text-lg font-bold ${highlight ? "text-orange-700" : "text-slate-900"}`}>{value}</p>
          {sub && <p className="mt-0.5 text-xs text-slate-400 truncate">{sub}</p>}
        </div>
      </div>
    </div>
  );
}

export default function SantoSchedulePage() {
  const { volunteer: currentUser } = useAuth();
  const { showToast } = useToast();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser?.id) return;
    // array-contains query — no composite index needed (no orderBy)
    const q = query(
      collection(db, "padhramaniEvents"),
      where("santoRefs", "array-contains", currentUser.id)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        // Sort descending client-side (newest first for overall list)
        rows.sort((a, b) => (b.scheduledDate || "").localeCompare(a.scheduledDate || ""));
        setEvents(rows);
        setLoading(false);
      },
      (err) => { console.error("SantoSchedulePage:", err.message); setLoading(false); }
    );
    return unsub;
  }, [currentUser?.id]);

  const today = todayStr();
  const monthPrefix = thisMonthStr();

  // Upcoming = today + future, sorted ascending
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

  const todaysEvent = upcoming.find((e) => e.scheduledDate === today);
  const futureEvents = upcoming.filter((e) => e.scheduledDate > today);
  const nextEvent = futureEvents[0] ?? null;

  const thisMonthCount = useMemo(
    () => events.filter((e) => (e.scheduledDate || "").startsWith(monthPrefix)).length,
    [events, monthPrefix]
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

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900 tracking-tight">My Schedule</h1>
        <p className="text-sm text-slate-400">
          {events.length} event{events.length !== 1 ? "s" : ""} assigned ·{" "}
          {totalVisited} of {totalHouseholds} households visited
        </p>
      </div>

      {/* 8.3 — Dashboard overview */}
      {!loading && (
        <div className="mb-8 flex flex-wrap gap-3">
          <StatCard
            label="Today"
            icon={CalendarDays}
            highlight={Boolean(todaysEvent)}
            value={
              todaysEvent
                ? `${(todaysEvent.households || []).length} household${(todaysEvent.households || []).length !== 1 ? "s" : ""}`
                : "No visit"
            }
            sub={todaysEvent ? (todaysEvent.area || todaysEvent.name || "—") : "Rest day"}
          />
          <StatCard
            label="Next Visit"
            icon={HeartHandshake}
            value={nextEvent ? fmtDate(nextEvent.scheduledDate) : "—"}
            sub={nextEvent ? (nextEvent.area || nextEvent.name || "") : "Nothing scheduled"}
          />
          <StatCard
            label="This Month"
            icon={TrendingUp}
            value={`${thisMonthCount} event${thisMonthCount !== 1 ? "s" : ""}`}
            sub={`${thisMonthCount ? Math.round((totalVisited / Math.max(totalHouseholds, 1)) * 100) : 0}% completion`}
          />
          <StatCard
            label="All Time"
            icon={Home}
            value={`${totalVisited} visited`}
            sub={`of ${totalHouseholds} total`}
          />
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      ) : events.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 py-20 text-center">
          <HeartHandshake className="mx-auto mb-3 h-8 w-8 text-slate-300" />
          <p className="font-medium text-slate-500">No Padhramani events assigned yet</p>
          <p className="mt-1 text-sm text-slate-400">
            You will appear here once an admin schedules a Padhramani and adds you as Santo.
          </p>
        </div>
      ) : (
        <>
          {/* Today's event — shown first, prominently */}
          {todaysEvent && (
            <section className="mb-6">
              <div className="mb-3 flex items-center gap-2">
                <span className="rounded-full bg-orange-500 px-2.5 py-0.5 text-xs font-semibold text-white">
                  Today
                </span>
              </div>
              <EventCard
                event={todaysEvent}
                isAdmin={false}
                currentUserId={currentUser?.id}
                onEdit={() => {}}
                onDelete={() => {}}
                onUpdateHouseholdStatus={(i, s) => handleUpdateHouseholdStatus(todaysEvent, i, s)}
              />
            </section>
          )}

          {/* Upcoming (future only, not today) */}
          {futureEvents.length > 0 && (
            <section className="mb-8">
              <div className="mb-3 flex items-center gap-2">
                <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
                  Upcoming
                </span>
                <span className="text-xs text-slate-400">
                  {futureEvents.length} event{futureEvents.length !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="space-y-2">
                {futureEvents.map((ev) => (
                  <EventCard
                    key={ev.id}
                    event={ev}
                    isAdmin={false}
                    currentUserId={currentUser?.id}
                    onEdit={() => {}}
                    onDelete={() => {}}
                    onUpdateHouseholdStatus={(i, s) => handleUpdateHouseholdStatus(ev, i, s)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Past */}
          {past.length > 0 && (
            <section>
              <div className="mb-3 flex items-center gap-2">
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                  Past
                </span>
                <span className="text-xs text-slate-400">
                  {past.length} event{past.length !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="space-y-2">
                {past.map((ev) => (
                  <EventCard
                    key={ev.id}
                    event={ev}
                    isAdmin={false}
                    currentUserId={currentUser?.id}
                    onEdit={() => {}}
                    onDelete={() => {}}
                    onUpdateHouseholdStatus={(i, s) => handleUpdateHouseholdStatus(ev, i, s)}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
