// src/components/households/HouseholdForm.jsx — Attio redesign: uses the
// shared Input/Select/Label/Button primitives instead of raw elements.
import { useState } from "react";
import { AreaSelect, LevelSelect } from "../AreaMandalSelect";
import { Input, Textarea, Label, FieldError } from "../ui/Input";
import { Button } from "../ui/Button";

// SIMPLIFIED: household form only asks Address, Area, Level, Total Family
// Members, Remark. Mandal moved to the individual level (see
// IndividualForm.jsx). Sampark Karyakarta name/number retired from the
// form (untouched on existing docs since updateDoc only writes given keys).
const emptyForm = { address: "", area: "", level: "", totalFamilyMembers: "", remark: "" };

export default function HouseholdForm({ household, onSubmit, onCancel }) {
  const isEdit = Boolean(household);
  const [form, setForm] = useState(() =>
    isEdit
      ? {
          address: household.address || "", area: household.area || "", level: household.level || "",
          totalFamilyMembers: household.totalFamilyMembers ?? "", remark: household.remark || "",
        }
      : emptyForm
  );
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const update = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

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
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="accent" disabled={saving}>{saving ? "Saving\u2026" : isEdit ? "Save changes" : "Add household"}</Button>
      </div>
    </form>
  );
}
