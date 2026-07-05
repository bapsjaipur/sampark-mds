// src/pages/BatchesPage.jsx — Attio redesign.
import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useHouseholds } from '../hooks/useHouseholds';
import BatchAssignment from '../components/sampark/BatchAssignment';
import RequirePermission from '../components/RequirePermission';

function useVolunteersList() {
  const [volunteers, setVolunteers] = useState([]);
  useEffect(() => onSnapshot(collection(db, 'volunteers'), (snap) => setVolunteers(snap.docs.map((d) => ({ id: d.id, ...d.data() })))), []);
  return volunteers;
}

function BatchesPageInner() {
  const { households } = useHouseholds();
  const volunteers = useVolunteersList();
  const areas = [...new Set(households.map((h) => h.area).filter(Boolean))].sort();
  return <BatchAssignment areas={areas} volunteers={volunteers} />;
}

export default function BatchesPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-6 text-xl font-semibold text-slate-900 tracking-tight">Batches</h1>
      <RequirePermission permission="assign_batches" fallback={<div className="text-sm text-slate-500">You don't have permission to assign batches.</div>}>
        <BatchesPageInner />
      </RequirePermission>
    </div>
  );
}
