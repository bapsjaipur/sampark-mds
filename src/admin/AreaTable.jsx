// src/admin/AreaTable.jsx
import { useState, useMemo } from 'react';
import { doc, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Trash2, Plus, ChevronDown, ChevronUp } from 'lucide-react';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';

export function AreaTable({ areas, onUpdateName, onDelete }) {
  // Always expand areas that have sub-areas, plus any the user manually clicked.
  const [manualExpanded, setManualExpanded] = useState(new Set());

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
  );
}
