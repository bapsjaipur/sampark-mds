// src/pages/CallingFlowPage.jsx — Attio redesign.
import { useEffect, useMemo, useState } from 'react';
import { Phone, MessageCircle, MapPin, FileText } from 'lucide-react';
import { useMyBatchQueue } from '../hooks/useMyBatchQueue';
import { useAuth } from '../hooks/usePermissions';
import { useToast } from '../contexts/ToastContext';
import { updateContactField } from '../services/contactService';
import { FOLLOW_UP_STATUS_GROUPS, statusColorClasses } from '../lib/callingStatuses';
import StatusChips from '../components/calling/StatusChips';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';

export default function CallingFlowPage() {
  const { volunteer } = useAuth();
  const { showToast } = useToast();
  const { contacts, current, currentIdx, next, jumpTo, isDone, loading } = useMyBatchQueue();

  const [status, setStatus] = useState('');
  const [reference, setReference] = useState('');
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [followUpFilter, setFollowUpFilter] = useState(null);

  useEffect(() => {
    setStatus(current?.status || '');
    setReference(current?.reference || '');
  }, [current?.id]);

  const progressPct = contacts.length ? Math.round((currentIdx / contacts.length) * 100) : 0;

  const followUpCounts = useMemo(() => {
    const callBack = contacts.filter((c) => FOLLOW_UP_STATUS_GROUPS.callBack.includes(c.status)).length;
    const noAnswer = contacts.filter((c) => FOLLOW_UP_STATUS_GROUPS.noAnswer.includes(c.status)).length;
    return { callBack, noAnswer };
  }, [contacts]);

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return contacts.map((c, idx) => ({ ...c, _idx: idx })).filter((c) => c.name?.toLowerCase().includes(q) || c.mobile?.includes(q)).slice(0, 8);
  }, [search, contacts]);

  function enterFollowUpMode(group) {
    const statuses = FOLLOW_UP_STATUS_GROUPS[group];
    const idx = contacts.findIndex((c) => statuses.includes(c.status));
    if (idx === -1) { showToast({ type: 'info', message: 'Nothing in this follow-up queue right now.' }); return; }
    setFollowUpFilter(group);
    jumpTo(idx);
  }

  function exitFollowUpMode() { setFollowUpFilter(null); }

  async function handleSaveAndNext() {
    if (!status) { showToast({ type: 'error', message: 'Please select a status first.' }); return; }
    if (!current) return;
    setSaving(true);
    try {
      await updateContactField({ individualId: current.id, field: 'status', value: status, volunteerId: volunteer?.id, action: 'status_changed', details: `Status set to ${status}` });
      if (reference.trim() !== (current.reference || '')) {
        await updateContactField({ individualId: current.id, field: 'reference', value: reference.trim(), volunteerId: volunteer?.id, action: 'reference_updated', details: reference.trim() });
      }
      showToast({ type: 'success', message: `Saved: ${status}` });
      goToNext();
    } catch (err) {
      showToast({ type: 'error', message: 'Couldn’t save — it’ll retry automatically once you’re back online.' });
      goToNext();
    } finally {
      setSaving(false);
    }
  }

  function goToNext() {
    if (followUpFilter) {
      const statuses = FOLLOW_UP_STATUS_GROUPS[followUpFilter];
      const nextIdx = contacts.findIndex((c, idx) => idx > currentIdx && statuses.includes(c.status));
      if (nextIdx === -1) { showToast({ type: 'success', message: 'Follow-up queue cleared!' }); setFollowUpFilter(null); next(); return; }
      jumpTo(nextIdx);
      return;
    }
    next();
  }

  if (loading) return <div className="mx-auto max-w-md px-6 py-16 text-center text-sm text-slate-400">Loading your batch…</div>;

  if (contacts.length === 0) {
    return (
      <div className="mx-auto max-w-md px-6 py-16 text-center">
        <p className="text-slate-500">No batch assigned to you yet.</p>
        <p className="mt-1 text-sm text-slate-400">Ask an admin to assign you a batch from the Volunteers screen.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-6 py-6">
      <div className="mb-4">
        <div className="h-1 w-full overflow-hidden rounded-full bg-slate-100">
          <div className="h-full bg-orange-500 transition-all" style={{ width: `${progressPct}%` }} />
        </div>
        <p className="mt-1 text-center text-xs text-slate-400">{contacts.length ? `${Math.min(currentIdx + 1, contacts.length)} / ${contacts.length}` : '—'}</p>
      </div>

      <div className="relative mb-4">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search your list…" />
        {searchResults.length > 0 && (
          <div className="absolute z-10 mt-1 w-full rounded-lg border border-slate-100 bg-white shadow-lg">
            {searchResults.map((c) => (
              <button key={c.id} onClick={() => { jumpTo(c._idx); setSearch(''); setFollowUpFilter(null); }} className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50">
                {c.name} <span className="text-xs text-slate-400">{c.mobile}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mb-4 flex gap-2">
        <button onClick={() => (followUpFilter === 'callBack' ? exitFollowUpMode() : enterFollowUpMode('callBack'))} className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium ${followUpFilter === 'callBack' ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-slate-200 text-slate-500'}`}>
          🕒 Call Back Later ({followUpCounts.callBack})
        </button>
        <button onClick={() => (followUpFilter === 'noAnswer' ? exitFollowUpMode() : enterFollowUpMode('noAnswer'))} className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium ${followUpFilter === 'noAnswer' ? 'border-sky-300 bg-sky-50 text-sky-700' : 'border-slate-200 text-slate-500'}`}>
          📵 No Answer ({followUpCounts.noAnswer})
        </button>
      </div>

      {isDone || !current ? (
        <Card className="p-8 text-center">
          <div className="text-4xl">🎉</div>
          <p className="mt-3 text-lg font-semibold text-slate-900">All done!</p>
          <p className="mt-1 text-sm text-slate-400">You’ve gone through all {contacts.length} assigned contacts. Great work, Sevak!</p>
        </Card>
      ) : (
        <Card className="p-5 space-y-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Contact</p>
            <p className="text-xl font-semibold text-slate-900 tracking-tight">{current.name}</p>
          </div>

          <div className="flex items-center gap-2 text-lg font-medium text-slate-800"><Phone className="h-4 w-4 text-slate-400" /> {current.mobile || 'No mobile'}</div>

          {current.mandal && <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600"><MapPin className="h-3 w-3" /> {current.mandal}</span>}

          {current.status && (
            <div className={`rounded-lg border px-3 py-2 text-xs ${statusColorClasses(current.status)}`}>
              Last status: <strong>{current.status}</strong>
              {current.reference && <div className="mt-1 flex items-center gap-1"><FileText className="h-3 w-3" /> {current.reference}</div>}
            </div>
          )}

          <div className="flex gap-2">
            <a href={`tel:+91${(current.mobile || '').replace(/\D/g, '')}`} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 py-2.5 text-sm font-medium text-white hover:bg-emerald-700">
              <Phone className="h-3.5 w-3.5" /> Call
            </a>
            <a href={`https://wa.me/91${(current.mobile || '').replace(/\D/g, '')}`} target="_blank" rel="noreferrer" className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-slate-800 py-2.5 text-sm font-medium text-white hover:bg-slate-900">
              <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
            </a>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-slate-500">Status</p>
            <StatusChips value={status} onChange={setStatus} />
          </div>

          <div>
            <p className="mb-1 text-xs font-medium text-slate-500">Reference / notes</p>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional note…" />
          </div>

          <div className="flex gap-2 pt-2">
            <Button variant="secondary" onClick={goToNext}>Skip</Button>
            <Button variant="accent" className="flex-1" onClick={handleSaveAndNext} disabled={saving || !status}>
              {saving ? 'Saving…' : 'Save & Next →'}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
