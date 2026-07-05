// src/components/admin-tools/SyncDashboardTab.jsx — Attio redesign.
import { useEffect, useState } from 'react';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Play, CheckCircle2, AlertTriangle } from 'lucide-react';
import { db } from '../../lib/firebase';
import { useToast } from '../../contexts/ToastContext';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

function formatTimestamp(ts) {
  if (!ts) return '\u2014';
  const date = ts.toDate ? ts.toDate() : new Date(ts);
  return date.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function SyncDashboardTab() {
  const { showToast } = useToast();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'syncLogs'), orderBy('ranAt', 'desc'), limit(20));
    return onSnapshot(q, (snap) => { setLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() }))); setLoading(false); });
  }, []);

  async function handleTrigger() {
    setRunning(true);
    try {
      const functions = getFunctions();
      const syncFn = httpsCallable(functions, 'syncFirestoreToGAS');
      const result = await syncFn();
      const { inserted, skipped, errors } = result.data || {};
      showToast({ type: errors?.length ? 'error' : 'success', message: errors?.length ? `Sync finished with ${errors.length} error(s) \u2014 see log below.` : `Sync complete: ${inserted} inserted, ${skipped} skipped.` });
    } catch (err) {
      showToast({ type: 'error', message: err.message || 'Sync failed to run.' });
    } finally {
      setRunning(false);
    }
  }

  const lastRun = logs[0];

  return (
    <div>
      <Card className="mb-6 p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-700">Firestore \u2192 Google Sheets backup sync</p>
            <p className="text-xs text-slate-400">Runs automatically every day at 3 AM. Trigger it manually any time.</p>
          </div>
          <Button variant="accent" onClick={handleTrigger} disabled={running}><Play className="h-3.5 w-3.5" /> {running ? 'Running\u2026' : 'Trigger Export Now'}</Button>
        </div>

        {lastRun && (
          <div className="mt-4 flex items-center gap-4 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
            <span>Last run: {formatTimestamp(lastRun.ranAt)}</span>
            <span className="flex items-center gap-1 text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" /> {lastRun.inserted} inserted</span>
            <span>\u2014 {lastRun.skipped} skipped</span>
            {lastRun.errors?.length > 0 && <span className="flex items-center gap-1 text-rose-600"><AlertTriangle className="h-3.5 w-3.5" /> {lastRun.errors.length} error(s)</span>}
          </div>
        )}
      </Card>

      <p className="mb-2 text-sm font-medium text-slate-700">Sync history</p>
      {loading ? (
        <p className="text-sm text-slate-400">Loading\u2026</p>
      ) : logs.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">No sync runs yet.</p>
      ) : (
        <div className="space-y-2">
          {logs.map((log) => (
            <Card key={log.id} className="p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-700">{formatTimestamp(log.ranAt)}</span>
                <span className={`flex items-center gap-1 ${log.errors?.length > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                  {log.errors?.length > 0 ? <><AlertTriangle className="h-3.5 w-3.5" /> {log.errors.length} error(s)</> : <><CheckCircle2 className="h-3.5 w-3.5" /> Success</>}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-400">{log.totalMandals} Mandal(s) \u00b7 {log.totalRows} rows processed \u00b7 {log.inserted} inserted \u00b7 {log.skipped} skipped</p>
              {log.errors?.length > 0 && <ul className="mt-2 list-disc pl-4 text-xs text-rose-500">{log.errors.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}</ul>}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
