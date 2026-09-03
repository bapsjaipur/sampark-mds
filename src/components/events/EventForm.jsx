// src/components/events/EventForm.jsx — Attio redesign.
// PHASE 29 — Sabha Duration + Speaker fields for both Yuvak and Bal Mandal events.
// Speaker has autocomplete searching all volunteers (not just Bal Mandal), but also accepts free text.
import { useState, useMemo } from 'react';
import { AreaSelect, MandalSelect } from '../AreaMandalSelect';
import { Input, Label, FieldError } from '../ui/Input';
import { Button } from '../ui/Button';
import { useVolunteers } from '../../hooks/useVolunteers';

const emptyForm = { title: '', date: '', time: '', durationMinutes: '', speaker: '', mandal: '', area: '' };
const selectClass = "h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-300";

export default function EventForm({ event, areas = [], onSubmit, onCancel }) {
  const isEdit = Boolean(event);
  const { volunteers } = useVolunteers();
  const [form, setForm] = useState(() =>
    isEdit
      ? { title: event.title || '', date: event.date || '', time: event.time || '', durationMinutes: event.durationMinutes || '', speaker: event.speaker || '', mandal: event.mandal || '', area: event.area || '' }
      : emptyForm
  );
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [showSpeakerSuggestions, setShowSpeakerSuggestions] = useState(false);

  const update = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

  // Filter all volunteers for speaker autocomplete, matching typed text
  const speakerSuggestions = useMemo(() => {
    if (!form.speaker.trim()) return [];
    const q = form.speaker.toLowerCase();
    return volunteers
      .filter((v) => (v.name || '').toLowerCase().includes(q))
      .slice(0, 8);
  }, [volunteers, form.speaker]);

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
    const ok = await onSubmit({
      ...form,
      durationMinutes: form.durationMinutes ? Number(form.durationMinutes) : null
    });
    setSaving(false);
    if (ok !== false) onCancel();
  }

  function selectSpeaker(name) {
    setForm((prev) => ({ ...prev, speaker: name }));
    setShowSpeakerSuggestions(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label required>Title</Label>
        <Input value={form.title} onChange={update('title')} error={errors.title} placeholder="e.g. Weekly Yuvak Sabha" />
        <FieldError>{errors.title}</FieldError>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><Label required>Date</Label><Input type="date" value={form.date} onChange={update('date')} error={errors.date} /><FieldError>{errors.date}</FieldError></div>
        <div><Label required>Time</Label><Input type="time" value={form.time} onChange={update('time')} error={errors.time} /><FieldError>{errors.time}</FieldError></div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><Label>Duration (minutes)</Label><Input type="number" min="15" step="15" value={form.durationMinutes} onChange={update('durationMinutes')} placeholder="Optional" /></div>
        <div className="relative">
          <Label>Speaker</Label>
          <Input
            value={form.speaker}
            onChange={update('speaker')}
            onFocus={() => setShowSpeakerSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSpeakerSuggestions(false), 200)}
            placeholder="Type name or select below"
          />
          {showSpeakerSuggestions && speakerSuggestions.length > 0 && (
            <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
              {speakerSuggestions.map((v) => (
                <li key={v.id}>
                  <button
                    type="button"
                    onClick={() => selectSpeaker(v.name)}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                  >
                    <span className="font-medium text-slate-700">{v.name}</span>
                    {v.mobile && <span className="ml-2 text-xs text-slate-400">{v.mobile}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><Label>Mandal (leave blank for all)</Label><MandalSelect value={form.mandal} onChange={update('mandal')} className={selectClass} allowBlank /></div>
        <div><Label>Area (leave blank for all)</Label><AreaSelect value={form.area} onChange={update('area')} className={selectClass} allowBlank /></div>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="accent" disabled={saving}>{saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create event'}</Button>
      </div>
    </form>
  );
}
