// src/components/events/EventForm.jsx — Attio redesign.
// PHASE 29 — Sabha Duration + Speaker fields for both Yuvak and Bal Mandal events.
// Speaker has autocomplete searching volunteers, but also accepts free text.
//
// PHASE 31 — a scoped creator (Super Moderator) now sees the WHOLE mandal list
// with the ones outside their territory greyed out, rather than a list cut down
// to theirs. Two reasons: a head over both Bal and Sishu Mandal must plainly see
// both of theirs offered, and a truncated list looks like a broken dropdown
// rather than an enforced boundary. The speaker autocomplete is narrowed the
// same way — a mandal head searching "Ramesh" wants their own karyakartas, not
// every Ramesh in Jaipur.
import { useState, useMemo, useEffect } from 'react';
import { MandalSelect } from '../AreaMandalSelect';
import ChipMultiSelect from '../ui/ChipMultiSelect';
import { Input, Label, FieldError } from '../ui/Input';
import { Button } from '../ui/Button';
import { useVolunteers } from '../../hooks/useVolunteers';
import { useAuth } from '../../hooks/usePermissions';
import { useAreasAndMandals } from '../../hooks/useAreasAndMandals';
import { filterVolunteersByScope, eventAreas } from '../../lib/scope';

const emptyForm = { title: '', date: '', time: '', durationMinutes: '', speaker: '', mandal: '', areas: [] };
const selectClass = "h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-300";

export default function EventForm({ event, onSubmit, onCancel, allowedMandals = null }) {
  const isEdit = Boolean(event);
  const { volunteers } = useVolunteers();
  const { scope } = useAuth();
  const { mandals, areas: areaDefs } = useAreasAndMandals();
  // An ARRAY means the mandal axis binds this creator — including an empty one,
  // which is a Super Moderator with no mandals assigned yet. Treating empty as
  // "unrestricted" (the length > 0 test alone) would hand exactly that person the
  // whole city's mandal list, so the two cases are kept apart.
  const mandalRestricted = Array.isArray(allowedMandals);
  const noMandalAssigned = mandalRestricted && allowedMandals.length === 0;
  const mustChooseAssignedMandal = mandalRestricted && allowedMandals.length > 0;
  // Bal Mandal is the sabha created most often, so it is the default whenever it
  // is within reach. A scoped creator who does NOT hold Bal Mandal still gets a
  // real default — their first assigned mandal — rather than a blank they have
  // to notice and fix before the form will submit.
  const defaultMandal = useMemo(() => {
    const pool = mustChooseAssignedMandal
      ? allowedMandals
      : (mandals || []).map((m) => m.name).filter(Boolean);
    const bal = pool.find((name) => (name || '').toLowerCase() === 'bal mandal');
    if (bal) return bal;
    return mustChooseAssignedMandal ? (pool[0] || '') : '';
  }, [allowedMandals, mustChooseAssignedMandal, mandals]);
  const [form, setForm] = useState(() =>
    isEdit
      ? { title: event.title || '', date: event.date || '', time: event.time || '', durationMinutes: event.durationMinutes || '', speaker: event.speaker || '', mandal: event.mandal || '', areas: eventAreas(event) }
      : { ...emptyForm }
  );
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [showSpeakerSuggestions, setShowSpeakerSuggestions] = useState(false);
  const [mandalTouched, setMandalTouched] = useState(false);

  // Preselect the default mandal for a new event once the reference list loads,
  // unless the user has already picked one.
  useEffect(() => {
    if (isEdit || mandalTouched) return;
    if (defaultMandal && !form.mandal) {
      setForm((prev) => ({ ...prev, mandal: defaultMandal }));
    }
  }, [isEdit, mandalTouched, defaultMandal, form.mandal]);

  const update = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

  // Area options come from the reference collection (the same source AreaSelect
  // drew on), plus any area an edited event already lists that has since been
  // renamed out of it — so opening an old event never silently drops one.
  const areaNames = useMemo(() => {
    const names = (areaDefs || []).map((a) => a.name || a).filter(Boolean);
    return [...new Set([...names, ...form.areas])];
  }, [areaDefs, form.areas]);
  const cityWide = form.areas.length === 0;

  // Speaker autocomplete draws only on volunteers inside the creator's scope.
  // Unrestricted admins keep the full roster.
  const speakerPool = useMemo(
    () => filterVolunteersByScope(volunteers, scope),
    [volunteers, scope],
  );

  const speakerSuggestions = useMemo(() => {
    if (!form.speaker.trim()) return [];
    const q = form.speaker.toLowerCase();
    return speakerPool
      .filter((v) => (v.name || '').toLowerCase().includes(q))
      .slice(0, 8);
  }, [speakerPool, form.speaker]);

  function validate() {
    const errs = {};
    if (!form.title.trim()) errs.title = 'Title is required.';
    if (!form.date) errs.date = 'Date is required.';
    if (!form.time) errs.time = 'Time is required.';
    if (mustChooseAssignedMandal && !form.mandal) errs.mandal = 'Choose one of your assigned mandals.';
    // Also catches an edit that would move an event OUT of the creator's
    // territory — the greyed-out option can't be picked, but an event already
    // saved under another mandal would otherwise be re-saved there.
    else if (mustChooseAssignedMandal && !allowedMandals.includes(form.mandal)) {
      errs.mandal = `${form.mandal} isn't assigned to you.`;
    }
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
        <div>
          <Label required={mustChooseAssignedMandal}>{mandalRestricted ? 'Mandal' : 'Mandal (leave blank for all)'}</Label>
          <MandalSelect
            value={form.mandal}
            onChange={(e) => { setMandalTouched(true); update('mandal')(e); }}
            className={selectClass}
            allowBlank={!mustChooseAssignedMandal}
            allowed={allowedMandals}
          />
          {mustChooseAssignedMandal && (
            <p className="mt-1 text-xs text-slate-400">
              {allowedMandals.length > 1
                ? `You can create sabhas for ${allowedMandals.join(' and ')}. The rest are greyed out.`
                : `Only ${allowedMandals[0]} is assigned to you. The rest are greyed out.`}
            </p>
          )}
          {noMandalAssigned && (
            <p className="mt-1 text-xs text-amber-600">
              No mandal is assigned to you yet, so there is nothing to file this sabha under.
              Ask an admin to set your assigned mandals.
            </p>
          )}
          <FieldError>{errors.mandal}</FieldError>
        </div>
      </div>
      <div>
        <Label>Areas (leave empty for a city-wide sabha)</Label>
        <ChipMultiSelect
          options={areaNames}
          value={form.areas}
          onChange={(next) => setForm((prev) => ({ ...prev, areas: next }))}
          emptyLabel="No areas defined yet."
        />
        <p className="mt-1 text-xs text-slate-400">
          {cityWide
            ? 'City-wide — this sabha counts for every area.'
            : form.areas.length > 1
              ? `Joint sabha across ${form.areas.join(' + ')} — attendance is marked once and counts for each area.`
              : `Files this sabha under ${form.areas[0]}.`}
        </p>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="accent" disabled={saving}>{saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create event'}</Button>
      </div>
    </form>
  );
}
