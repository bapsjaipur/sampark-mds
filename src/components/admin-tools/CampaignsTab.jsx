// src/components/admin-tools/CampaignsTab.jsx
import { useState, useEffect } from 'react';
import { collection, doc, onSnapshot, setDoc, deleteDoc, getDocs, query, where, writeBatch, serverTimestamp } from 'firebase/firestore';
import { Plus, Trash2, Pencil, X, Check } from 'lucide-react';
import { db } from '../../lib/firebase';
import { useAuth } from '../../hooks/usePermissions';
import { useToast } from '../../contexts/ToastContext';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';

export default function CampaignsTab() {
  const [campaigns, setCampaigns] = useState([]);
  const [newCampaign, setNewCampaign] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [processing, setProcessing] = useState(false);
  const { hasPermission } = useAuth();
  const { showToast } = useToast();

  useEffect(() => {
    return onSnapshot(collection(db, 'campaigns'), (snap) => {
      setCampaigns(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.name.localeCompare(b.name)));
    });
  }, []);

  async function handleAdd(e) {
    e.preventDefault();
    if (!hasPermission('manage_users')) return;
    const name = newCampaign.trim();
    if (!name) return;

    if (campaigns.some(c => c.name.toLowerCase() === name.toLowerCase())) {
       showToast({ type: 'warning', message: 'Campaign already exists.' });
       return;
    }

    try {
      await setDoc(doc(db, 'campaigns', name.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()), {
        name,
        isActive: true,
      });
      setNewCampaign('');
      showToast({ type: 'success', message: 'Campaign added.' });
    } catch (err) {
      showToast({ type: 'error', message: "Couldn't add campaign." });
    }
  }

  async function handleRename(campaign) {
    const newName = editName.trim();
    if (!newName || newName.toLowerCase() === campaign.name.toLowerCase()) {
      setEditingId(null);
      return;
    }

    if (campaigns.some(c => c.id !== campaign.id && c.name.toLowerCase() === newName.toLowerCase())) {
      showToast({ type: 'warning', message: 'Another campaign with this name already exists.' });
      return;
    }

    if (!window.confirm(`Rename "${campaign.name}" to "${newName}"? All events associated with it will also be updated.`)) return;

    setProcessing(true);
    try {
      // 1. Update events
      const eventsSnap = await getDocs(query(collection(db, 'padhramaniEvents'), where('campaign', '==', campaign.name)));
      let batch = writeBatch(db);
      let count = 0;

      eventsSnap.docs.forEach((d) => {
        batch.update(d.ref, { campaign: newName, updatedAt: serverTimestamp() });
        count++;
        if (count % 400 === 0) {
          batch.commit();
          batch = writeBatch(db);
        }
      });
      if (count % 400 !== 0) await batch.commit();

      // 2. Rename campaign document (since ID is string based, we need to create new and delete old, or just update the name field if we keep the same ID. Updating the name field is safer).
      await setDoc(doc(db, 'campaigns', campaign.id), { name: newName }, { merge: true });

      showToast({ type: 'success', message: `Campaign renamed. ${count} events updated.` });
      setEditingId(null);
    } catch (err) {
      console.error(err);
      showToast({ type: 'error', message: "Couldn't rename campaign." });
    } finally {
      setProcessing(false);
    }
  }

  async function handleDelete(campaign) {
    if (!window.confirm(`Delete campaign "${campaign.name}"? All associated events will be moved to 'Uncategorized'.`)) return;
    setProcessing(true);
    try {
      // 1. Move events to uncategorized (by deleting 'campaign' field or setting to "")
      const eventsSnap = await getDocs(query(collection(db, 'padhramaniEvents'), where('campaign', '==', campaign.name)));
      let batch = writeBatch(db);
      let count = 0;

      eventsSnap.docs.forEach((d) => {
        batch.update(d.ref, { campaign: "", updatedAt: serverTimestamp() });
        count++;
        if (count % 400 === 0) {
          batch.commit();
          batch = writeBatch(db);
        }
      });
      if (count % 400 !== 0) await batch.commit();

      // 2. Delete campaign doc
      await deleteDoc(doc(db, 'campaigns', campaign.id));

      showToast({ type: 'success', message: `Campaign removed. ${count} events moved to Uncategorized.` });
    } catch (err) {
      console.error(err);
      showToast({ type: 'error', message: "Couldn't remove campaign." });
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-100 bg-white p-6 shadow-sm">
        <h2 className="mb-1 text-lg font-semibold text-slate-900">Manage Padhramani Campaigns</h2>
        <p className="mb-4 text-sm text-slate-500">
          Campaign options appear in the Padhramani tab. You can rename a campaign or delete it entirely. Deleting a campaign will move all its scheduled events back to "Uncategorized".
        </p>

        <form onSubmit={handleAdd} className="mb-6 flex items-center gap-2 max-w-sm">
          <Input
            value={newCampaign}
            disabled={processing}
            onChange={(e) => setNewCampaign(e.target.value)}
            placeholder="e.g. Jholi 2026"
          />
          <Button variant="accent" type="submit" disabled={!newCampaign.trim() || processing}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        </form>

        <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {campaigns.length === 0 ? (
            <p className="p-4 text-sm text-slate-500 text-center">No custom campaigns added. The default ones will be shown.</p>
          ) : (
            campaigns.map(c => (
              <div key={c.id} className="flex items-center justify-between p-3 hover:bg-slate-50">
                {editingId === c.id ? (
                  <div className="flex flex-1 items-center gap-2 mr-2">
                    <Input autoFocus value={editName} onChange={(e) => setEditName(e.target.value)} className="h-8" disabled={processing} />
                  </div>
                ) : (
                  <span className="font-medium text-slate-800">{c.name}</span>
                )}

                <div className="flex items-center gap-1">
                  {editingId === c.id ? (
                    <>
                      <button onClick={() => setEditingId(null)} disabled={processing} className="rounded p-1.5 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4"/></button>
                      <button onClick={() => handleRename(c)} disabled={processing} className="rounded p-1.5 text-emerald-500 hover:bg-emerald-50"><Check className="h-4 w-4"/></button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => { setEditingId(c.id); setEditName(c.name); }} disabled={processing} className="rounded p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-500 transition-colors"><Pencil className="h-4 w-4" /></button>
                      <button onClick={() => handleDelete(c)} disabled={processing} className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-500 transition-colors"><Trash2 className="h-4 w-4" /></button>
                    </>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
