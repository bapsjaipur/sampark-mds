// src/components/bal-mandal/ObserverAttendancePanel.jsx
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 30 — Observer attendance tracking for Bal Mandal events.
//
// Nirikshak (Inspector) and Sant (Saint) volunteers can be marked as observers
// at Bal Mandal events. Their attendance is recorded separately from regular
// member attendance and shown in a dedicated section on the event dashboard.
//
// Any Bal Mandal volunteer can mark observers. Observers themselves can mark
// their own attendance.
//
// PHASE 32 — THE OBSERVER LIST WAS ALWAYS EMPTY.
//
// The panel looked for observers with
// `where('roleKey','in',['nirikshak','sant'])`. Two things were wrong with that
// and either alone was fatal: volunteer documents carry no `roleKey` at all
// (role identity lives on the role document), and the sant preset's key is
// 'santo', not 'sant'. The query matched nothing, `observers.length === 0`, and
// the component returned null — so the section simply never appeared and looked
// like "no observers are assigned yet".
//
// It now joins the two shared listeners the app already keeps open — volunteers
// and roles — through isObserverRole(). That is not just a fix: it removes a
// getDocs on every event page, so the panel is now free.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useMemo } from 'react';
import { collection, getDocs, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useAuth } from '../../hooks/usePermissions';
import { useVolunteers } from '../../hooks/useVolunteers';
import { useRoles, rolesOfVolunteer } from '../../hooks/useRoles';
import { isObserverRole } from '../../lib/roleView';
import { useToast } from '../../contexts/ToastContext';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Eye } from 'lucide-react';

export default function ObserverAttendancePanel({ event }) {
  const { volunteer, hasPermission } = useAuth();
  const { volunteers } = useVolunteers();
  const { rolesById } = useRoles();
  const { showToast } = useToast();
  const [attendedIds, setAttendedIds] = useState(new Set());
  const [loading, setLoading] = useState(true);

  // manage_attendance is the permission that means "may mark someone present";
  // manage_users covers the admin who is not on the Bal Mandal roster.
  const canMark = hasPermission('manage_attendance')
    && (volunteer?.program === 'Bal Mandal' || hasPermission('manage_users'));
  const isBalMandalEvent = event?.mandal === 'Bal Mandal' || event?.mandal === 'Sishu Mandal';

  // Derived from listeners that are already open elsewhere in the app, so this
  // costs no reads of its own.
  const observers = useMemo(() => {
    if (!isBalMandalEvent) return [];
    return (volunteers || [])
      .filter((v) => v?.isActive !== false && v?.program === 'Bal Mandal')
      .map((v) => {
        const role = rolesOfVolunteer(v, rolesById).find(isObserverRole);
        return role ? { ...v, roleName: role.name || 'Observer' } : null;
      })
      .filter(Boolean)
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [volunteers, rolesById, isBalMandalEvent]);

  useEffect(() => {
    if (!event?.id || !isBalMandalEvent) {
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const attendanceRef = collection(db, 'events', event.id, 'observerAttendance');
        const attendanceSnap = await getDocs(attendanceRef);
        if (cancelled) return;
        setAttendedIds(new Set(attendanceSnap.docs.map((d) => d.id)));
      } catch (err) {
        console.error('Failed to load observer attendance:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [event?.id, isBalMandalEvent]);

  async function toggleAttendance(observerId) {
    if (!canMark) return;

    const isPresent = attendedIds.has(observerId);
    const observerRef = doc(db, 'events', event.id, 'observerAttendance', observerId);

    try {
      if (isPresent) {
        await deleteDoc(observerRef);
        setAttendedIds(prev => {
          const next = new Set(prev);
          next.delete(observerId);
          return next;
        });
      } else {
        await setDoc(observerRef, {
          volunteerId: observerId,
          markedAt: new Date(),
          markedBy: volunteer?.id || '',
        });
        setAttendedIds(prev => new Set(prev).add(observerId));
      }
    } catch (err) {
      console.error('Failed to toggle attendance:', err);
      showToast({ type: 'error', message: 'Failed to update attendance' });
    }
  }

  if (!isBalMandalEvent || loading || observers.length === 0) {
    return null;
  }

  const presentCount = attendedIds.size;

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-slate-400" />
          <h3 className="text-sm font-semibold text-slate-900">Observers</h3>
          <Badge tone="slate">{presentCount} / {observers.length}</Badge>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {observers.map(obs => {
          const isPresent = attendedIds.has(obs.id);
          return (
            <button
              key={obs.id}
              onClick={() => toggleAttendance(obs.id)}
              disabled={!canMark}
              className={`flex items-center justify-between rounded-lg border p-2.5 text-left transition ${
                isPresent
                  ? 'border-emerald-200 bg-emerald-50'
                  : 'border-slate-200 bg-white hover:bg-slate-50'
              } ${!canMark ? 'cursor-default' : 'cursor-pointer'}`}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900">{obs.name}</p>
                <p className="truncate text-xs text-slate-500">
                  {obs.roleName} · {obs.assignedAreas?.join(', ') || 'No area'}
                </p>
              </div>
              {isPresent && (
                <div className="ml-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500">
                  <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </Card>
  );
}
