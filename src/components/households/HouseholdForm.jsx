// src/components/households/HouseholdForm.jsx — Phase 18: duplicate detection (1.6)
import { useState } from "react";
import { getDocs, collection, query, where } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { Link } from "react-router-dom";
import { AreaSelect, LevelSelect } from "../AreaMandalSelect";
import { Input, Textarea, Label, FieldError } from "../ui/Input";
import { Button } from "../ui/Button";

const emptyForm = { address: "", area: "", level: "", totalFamilyMembers: "", remark: "" };

function normalizeAddress(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9ऀ-ॿ]/g, " ").replace(/\s+/g, " ").trim();
}

function similarity(a, b) {
  const na = normalizeAddress(a);
  const nb = normalizeAddress(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const wordsA = new Set(na.split(" ").filter((w) => w.length > 2));
  const wordsB = new Set(nb.split(" ").filter((w) => w.length > 2));
  if (!wordsA.size || !wordsB.size) return 0;
  const shared = [...wordsA].filter((w) => wordsB.has(w)).length;
  return shared / Math.max(wordsA.size, wordsB.size);
}

export default function HouseholdForm({ household, onSubmit, onCancel }) {
  const isEdit = Boolean(household);
  const [form, setForm] = useState(() =>
    isEdit
      ? { address: household.address || "", area: household.area || "", level: household.level || "", totalFamilyMembers: household.totalFamilyMembers ?? "", remark: household.remark || "" }
      : emptyForm
  );
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [duplicates, setDuplicates] = useState([]);
  const [dupChecked, setDupChecked] = useState(false);

  const update = (field) => (e) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
    setDuplicates([]);
    setDupChecked(false);
  };

  const validate = () => {
    const errs = {};
    if (!form.address.trim()) errs.address = "Address is required.";
    if (!form.area.trim()) errs.area = "Area is required.";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    // 1.6 — On first submit (create only), check for similar address+area.
    if (!isEdit && !dupChecked) {
      setSaving(true);
      try {
        const snap = await getDocs(query(collection(db, "households"), where("area", "==", form.area.trim())));
        const found = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((h) => similarity(h.address, form.address) >= 0.5);
        setDupChecked(true);
        if (found.length > 0) {
          setDuplicates(found);
          setSaving(false);
          return; // pause and show warning; user submits again to confirm
        }
      } catch {
        // If the check fails, proceed with the save (don't block forever).
      }
      setSaving(false);
    }

    setSaving(true);
    const ok = await onSubmit({ ...form, totalFamilyMembers: form.totalFamilyMembers ? Number(form.totalFamilyMembers) : 0 });
    setSaving(false);
    if (ok) onCancel();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label required>Address</Label>
        <Textarea value={form.address} onChange={update("address")} rows={2} error={errors.address} />
        <FieldError>{errors.address}</FieldError>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label required>Area</Label>
          <AreaSelect value={form.area} onChange={update("area")} className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-300" />
          <FieldError>{errors.area}</FieldError>
        </div>
        <div>
          <Label>Level</Label>
          <LevelSelect value={form.level} onChange={update("level")} className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-300" />
        </div>
      </div>
      <div>
        <Label>Total family members</Label>
        <Input type="number" min="0" value={form.totalFamilyMembers} onChange={update("totalFamilyMembers")} />
      </div>
      <div>
        <Label>Remark</Label>
        <Textarea value={form.remark} onChange={update("remark")} rows={2} />
      </div>

      {duplicates.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
          <p className="font-medium text-amber-800">Possible duplicate household{duplicates.length > 1 ? "s" : ""} found in {form.area}:</p>
          <ul className="mt-1.5 space-y-1">
            {duplicates.map((h) => (
              <li key={h.id}>
                <Link to={`/households/${h.id}`} target="_blank" rel="noreferrer" className="text-amber-700 underline hover:text-amber-900">
                  {h.address}
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-amber-700">If this is a different household, click "Add household" again to save anyway.</p>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="accent" disabled={saving}>
          {saving ? "Checking…" : isEdit ? "Save changes" : dupChecked && duplicates.length > 0 ? "Add anyway" : "Add household"}
        </Button>
      </div>
    </form>
  );
}
