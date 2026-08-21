// src/admin/AreaTable.jsx
import { useState } from 'react';
import { collection, addDoc, doc, updateDoc, writeBatch } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Trash2, Plus, ChevronDown, ChevronUp } from 'lucide-react';
import { DEFAULT_AREAS } from '../lib/areaMandalCodes';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';

// Suggests "GN" from "Govind Nagar", "TR" from "Tonk Road", "OC" from "Old City".
// Only used until the admin edits the code box themselves.
function suggestCode(name) {
  const words = name.trim().split(/\s+/).filter((w) => /[a-z0-9]/i.test(w));
  if (!words.length) return '';
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words.slice(0, 3).map((w) => w[0]).join('').toUpperCase();
}

export function AreaTable({ areas, onUpdateName, onDelete }) {
  // Always expand areas that have sub-areas, plus any the user manually clicked.
  const [manualExpanded, setManualExpanded] = useState(new Set());
  const [newName, setNewName] = useState('');
  const [newCode, setNewCode] = useState('');
  const [codeTouched, setCodeTouched] = useState(false);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [seeding, setSeeding] = useState(false);

  // Derive final expanded state
  const isExpanded = (area) => {
    // If user clicked it manually, respect that state over default
    if (manualExpanded.has(area.id)) return true;
    if (manualExpanded.has(`closed-${area.id}`)) return false;

    // Otherwise default open if it has sub-areas
    return (area.subAreas?.length > 0);
  };

  const toggleExpand = (area) => {
    const next = new Set(manualExpanded);
    if (isExpanded(area)) {
      // Force closed
      next.delete(area.id);
      next.add(`closed-${area.id}`);
    } else {
      // Force opened
      next.delete(`closed-${area.id}`);
      next.add(area.id);
    }
    setManualExpanded(next);
  };

  function handleNameChange(value) {
    setNewName(value);
    if (!codeTouched) setNewCode(suggestCode(value));
  }

  async function handleAddArea() {
    const name = newName.trim();
    const code = newCode.trim().toUpperCase();
    if (!name || !code) { setError('Area name and code are both required.'); return; }
    if (areas.some((a) => (a.name || '').toLowerCase() === name.toLowerCase())) {
      setError(`"${name}" already exists.`); return;
    }
    if (areas.some((a) => (a.code || '').toUpperCase() === code)) {
      setError(`Code "${code}" is already used by another area.`); return;
    }
    setError(null);
    setAdding(true);
    try {
      await addDoc(collection(db, 'areas'), { name, code, subAreas: [] });
      setNewName(''); setNewCode(''); setCodeTouched(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setAdding(false);
    }
  }

  async function handleSeedDefaults() {
    setSeeding(true);
    try {
      const batch = writeBatch(db);
      DEFAULT_AREAS.forEach((a) => batch.set(doc(collection(db, 'areas')), { ...a, subAreas: [] }));
      await batch.commit();
    } catch (err) {
      setError(err.message);
    } finally {
      setSeeding(false);
    }
  }

  async function addSubArea(area, name, code) {
    if (!name.trim() || !code.trim()) return;
    const current = area.subAreas || [];
    await updateDoc(doc(db, 'areas', area.id), {
      subAreas: [...current, { name: name.trim(), code: code.trim().toUpperCase() }]
    });
  }

  async function removeSubArea(area, subArea) {
    if (!window.confirm(`Delete sub-area ${subArea.name}?`)) return;
    const current = area.subAreas || [];
    await updateDoc(doc(db, 'areas', area.id), {
      subAreas: current.filter(s => s.name !== subArea.name || s.code !== subArea.code)
    });
  }

  async function updateSubArea(area, oldSa, newName, newCode) {
    if (!newName.trim() || !newCode.trim()) return;
    // Don't update if exactly the same
    if (newName.trim() === oldSa.name && newCode.trim().toUpperCase() === oldSa.code) return;

    const current = area.subAreas || [];
    const newArr = current.map(s => {
      // Find the specific item updating and swap its values in-place to preserve order
      if (s.name === oldSa.name && s.code === oldSa.code) {
        return { name: newName.trim(), code: newCode.trim().toUpperCase() };
      }
      return s;
    });

    await updateDoc(doc(db, 'areas', area.id), {
      subAreas: newArr
    });
  }

  return (
    <Card className="p-4">
      <h2 className="mb-1 text-sm font-semibold text-slate-900">Areas</h2>
      <p className="mb-3 text-xs text-slate-400">
        Add a new area below. Expand any area with the arrow to manage its sub-areas.
      </p>

      {error && (
        <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>
      )}

      {/* Add new area */}
      <div className="mb-3 flex flex-wrap gap-2">
        <Input
          value={newName}
          onChange={(e) => handleNameChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAddArea()}
          placeholder="New area name"
          className="flex-1 min-w-[160px]"
        />
        <Input
          value={newCode}
          onChange={(e) => { setCodeTouched(true); setNewCode(e.target.value); }}
          onKeyDown={(e) => e.key === 'Enter' && handleAddArea()}
          placeholder="Code"
          className="w-24 uppercase"
        />
        <Button variant="accent" onClick={handleAddArea} disabled={adding}>
          {adding ? 'Adding…' : 'Add area'}
        </Button>
      </div>

      {areas.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 py-6 text-center">
          <p className="mb-2 text-sm text-slate-400">No areas yet.</p>
          <Button variant="primary" size="sm" onClick={handleSeedDefaults} disabled={seeding}>
            {seeding ? 'Seeding…' : `Seed ${DEFAULT_AREAS.length} default areas`}
          </Button>
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {areas.map((r) => (
            <div key={r.id}>
              <div className="flex items-center gap-2 py-2">
                <input defaultValue={r.name} onBlur={(e) => onUpdateName(r, e.target.value)} className="flex-1 rounded border border-transparent px-1.5 py-1 text-sm hover:border-slate-200 focus:border-slate-300 focus:outline-none" />
                <input defaultValue={r.code} onBlur={(e) => onUpdateName(r, r.name, e.target.value.toUpperCase())} className="w-16 rounded border border-transparent px-1.5 py-1 text-sm uppercase hover:border-slate-200" />
                <Button variant="ghost" size="sm" onClick={() => toggleExpand(r)}>
                  {isExpanded(r) ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onDelete(r)} className="text-rose-500"><Trash2 className="h-4 w-4" /></Button>
              </div>
              {isExpanded(r) && (
                <div className="pl-6 pb-2 space-y-1">
                  <p className="text-xs font-semibold text-slate-500">Sub-areas</p>
                  {(r.subAreas || []).map((sa, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm text-slate-600">
                      <input defaultValue={sa.name} onBlur={(e) => updateSubArea(r, sa, e.target.value, sa.code)} className="rounded border border-transparent px-1 py-0.5 text-xs hover:border-slate-200" />
                      <input defaultValue={sa.code} onBlur={(e) => updateSubArea(r, sa, sa.name, e.target.value.toUpperCase())} className="w-12 rounded border border-transparent px-1 py-0.5 text-xs uppercase hover:border-slate-200" />
                      <button onClick={() => removeSubArea(r, sa)} className="text-rose-400 hover:text-rose-600"><Trash2 className="h-3 w-3" /></button>
                    </div>
                  ))}
                  <div className="flex gap-1">
                    <Input id={`new-sa-n-${r.id}`} placeholder="Name" className="h-7 text-xs" />
                    <Input id={`new-sa-c-${r.id}`} placeholder="Code" className="h-7 w-16 text-xs" />
                    <Button size="sm" onClick={() => {
                      addSubArea(r, document.getElementById(`new-sa-n-${r.id}`).value, document.getElementById(`new-sa-c-${r.id}`).value);
                      document.getElementById(`new-sa-n-${r.id}`).value = '';
                      document.getElementById(`new-sa-c-${r.id}`).value = '';
                    }}><Plus className="h-3 w-3" /></Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
