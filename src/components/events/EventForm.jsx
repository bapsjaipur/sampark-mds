// src/components/events/EventForm.jsx — Attio redesign.
import { useState } from 'react';
import { AreaSelect, MandalSelect } from '../AreaMandalSelect';
import { Input, Label, FieldError } from '../ui/Input';
import { Button } from '../ui/Button';

const emptyForm = { title: '', date: '', time: '', durationMinutes: 120, speaker: '', mandal: '', area: '' };
const selectClass = "h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-300";

export default function EventForm({ event, areas = [], onSubmit, onCancel }) {
  const isEdit = Boolean(event);
  const [form, setForm] = useState(() =>
    isEdit
      ? { title: event.title || '', date: event.date || '', time: event.time || '', durationMinutes: event.durationMinutes || 120, speaker: event.speaker || '', mandal: event.mandal || '', area: event.area || '' }
      : emptyForm
  );
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const update = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

  function validate() {
    const errs = {};
    if (!form.title.trim()) errs.title = 'Title is required.';
    if (!form.date) errs.date = 'Date is required.';
    if (!form.time) errs.time = 'Time is required.';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    const ok = await onSubmit({ ...form, durationMinutes: Number(form.durationMinutes) || 120 });
    setSaving(false);
    if (ok !== false) onCancel();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label required>Title</Label>
        <Input value={form.title} onChange={update('title')} error={errors.title} placeholder="e.g. Weekly Yuvak Sabha" />
        <FieldError>{errors.title}</FieldError>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div><Label required>Date</Label><Input type="date" value={form.date} onChange={update('date')} error={errors.date} /><FieldError>{errors.date}</FieldError></div>
        <div><Label required>Time</Label><Input type="time" value={form.time} onChange={update('time')} error={errors.time} /><FieldError>{errors.time}</FieldError></div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div><Label>Duration (minutes)</Label><Input type="number" min="15" step="15" value={form.durationMinutes} onChange={update('durationMinutes')} /></div>
        <div><Label>Speaker</Label><Input value={form.speaker} onChange={update('speaker')} placeholder="Optional" /></div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div><Label>Mandal (leave blank for all)</Label><MandalSelect value={form.mandal} onChange={update('mandal')} className={selectClass} allowBlank /></div>
        <div><Label>Area (leave blank for all)</Label><AreaSelect value={form.area} onChange={update('area')} className={selectClass} allowBlank /></div>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="accent" disabled={saving}>{saving ? 'Saving\u2026' : isEdit ? 'Save changes' : 'Create event'}</Button>
      </div>
    </form>
  );
}
