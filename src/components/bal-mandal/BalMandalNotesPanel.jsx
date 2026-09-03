// src/components/bal-mandal/BalMandalNotesPanel.jsx
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 30 — Notes panel for Bal Mandal contacts with edit history.
//
// All Bal Mandal volunteers (SK, Sanchalak, Nirikshak, Nirdeshak) can add and
// edit notes. Each edit appends a timestamped entry to the notes field with
// volunteer name. History is preserved as plain text, editable by all.
//
// Used on IndividualDetailPage for both Yuvak and Bal Mandal contacts.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useAuth } from '../../hooks/usePermissions';
import { useToast } from '../../contexts/ToastContext';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Textarea } from '../ui/Input';
import { MessageSquare, Save } from 'lucide-react';

export default function BalMandalNotesPanel({ individual }) {
  const { volunteer } = useAuth();
  const { showToast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const existingNotes = individual?.notes || '';
  const canEdit = volunteer?.program === 'Bal Mandal' || volunteer?.roleKey === 'admin';

  function startEdit() {
    setDraft('');
    setEditing(true);
  }

  async function saveNote() {
    if (!draft.trim()) {
      showToast({ type: 'error', message: 'Note cannot be empty' });
      return;
    }

    setSaving(true);

    try {
      const timestamp = new Date().toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

      const newEntry = `[${timestamp} - ${volunteer?.name || 'Unknown'}]\n${draft.trim()}\n`;
      const updatedNotes = existingNotes ? `${newEntry}\n${existingNotes}` : newEntry;

      await updateDoc(doc(db, 'individuals', individual.id), {
        notes: updatedNotes,
      });

      showToast({ type: 'success', message: 'Note saved' });
      setEditing(false);
      setDraft('');
    } catch (err) {
      console.error('Failed to save note:', err);
      showToast({ type: 'error', message: 'Failed to save note' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="mt-4 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-slate-400" />
          <h3 className="text-sm font-semibold text-slate-900">Notes</h3>
        </div>
        {canEdit && !editing && (
          <Button size="sm" variant="ghost" onClick={startEdit}>
            Add Note
          </Button>
        )}
      </div>

      {editing && (
        <div className="mt-3 space-y-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Write a note about this contact..."
            rows={3}
            className="text-sm"
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" onClick={saveNote} disabled={saving}>
              <Save className="mr-1.5 h-3.5 w-3.5" />
              {saving ? 'Saving...' : 'Save Note'}
            </Button>
          </div>
        </div>
      )}

      {existingNotes && (
        <div className="mt-3 max-h-64 overflow-y-auto rounded border border-slate-200 bg-slate-50 p-3">
          <pre className="whitespace-pre-wrap text-xs text-slate-700">{existingNotes}</pre>
        </div>
      )}

      {!existingNotes && !editing && (
        <p className="mt-2 text-xs text-slate-400">No notes yet</p>
      )}
    </Card>
  );
}
