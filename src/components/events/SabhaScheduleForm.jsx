// src/components/events/SabhaScheduleForm.jsx
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 33 — the recurrence rule editor. "that things of recurring which mandal
// and area it will created by Mandal Head Super Moderator."
//
// Area and mandal are BOTH required here, unlike EventForm where either may be
// left blank for "all". A schedule with a blank area is a rule that cannot be
// tracked — the whole point of the grid is one row per area saying whether that
// area's sabha happened, and a row covering "everywhere" answers nothing. It
// would also generate one shared event for the entire city, so eighteen areas
// would fight over a single attendance sheet.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from 'react';
import { AreaSelect, MandalSelect } from '../AreaMandalSelect';
import { Input, Label, FieldError, Select } from '../ui/Input';
import { Button } from '../ui/Button';
import { WEEKDAYS, INTERVALS, toDateStr } from '../../lib/sabhaSchedule';

const selectClass = 'h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-300';

export default function SabhaScheduleForm({
  schedule, onSubmit, onCancel, allowedMandals = null, allowedAreas = null,
}) {
  const isEdit = Boolean(schedule);
  const mandalRestricted = Array.isArray(allowedMandals);
  const areaRestricted = Array.isArray(allowedAreas);

  const defaultMandal = useMemo(() => {
    if (!mandalRestricted) return '';
    const bal = allowedMandals.find((m) => (m || '').toLowerCase() === 'bal mandal');
    return bal || allowedMandals[0] || '';
  }, [mandalRestricted, allowedMandals]);

  const [form, setForm] = useState(() => (isEdit ? {
    title: schedule.title || '',
    area: schedule.area || '',
    mandal: schedule.mandal || '',
    dayOfWeek: String(schedule.dayOfWeek ?? 0),
    time: schedule.time || '',
    intervalWeeks: String(schedule.intervalWeeks || 1),
    durationMinutes: schedule.durationMinutes || '',
    speaker: schedule.speaker || '',
    startDate: schedule.startDate || toDateStr(new Date()),
    endDate: schedule.endDate || '',
    active: schedule.active !== false,
  } : {
    title: '',
    area: areaRestricted && allowedAreas.length === 1 ? allowedAreas[0] : '',
    mandal: defaultMandal,
    dayOfWeek: '0',
    time: '',
    intervalWeeks: '1',
    durationMinutes: '',
    speaker: '',
    startDate: toDateStr(new Date()),
    endDate: '',
    active: true,
  }));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const update = (field) => (e) => setForm((p) => ({ ...p, [field]: e.target.value }));

  function validate() {
    const errs = {};
    if (!form.area) errs.area = 'Pick the area this sabha runs in.';
    else if (areaRestricted && !allowedAreas.includes(form.area)) errs.area = `${form.area} isn’t assigned to you.`;
    if (!form.mandal) errs.mandal = 'Pick the mandal.';
    else if (mandalRestricted && !allowedMandals.includes(form.mandal)) errs.mandal = `${form.mandal} isn’t assigned to you.`;
    if (!form.time) errs.time = 'Time is required — it goes on every sabha this creates.';
    if (!form.startDate) errs.startDate = 'Start date is required.';
    if (form.endDate && form.endDate < form.startDate) errs.endDate = 'End date is before the start date.';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    const ok = await onSubmit({
      title: form.title.trim(),
      area: form.area,
      mandal: form.mandal,
      dayOfWeek: Number(form.dayOfWeek),
      time: form.time,
      intervalWeeks: Number(form.intervalWeeks) || 1,
      durationMinutes: form.durationMinutes ? Number(form.durationMinutes) : 120,
      speaker: form.speaker.trim(),
      startDate: form.startDate,
      endDate: form.endDate || null,
      active: form.active !== false,
    });
    setSaving(false);
    if (ok !== false) onCancel();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label required>Area</Label>
          <AreaSelect value={form.area} onChange={update('area')} className={selectClass} allowBlank allowed={allowedAreas} />
          <FieldError>{errors.area}</FieldError>
        </div>
        <div>
          <Label required>Mandal</Label>
          <MandalSelect
            value={form.mandal}
            onChange={update('mandal')}
            className={selectClass}
            allowBlank
            allowed={allowedMandals}
          />
          <FieldError>{errors.mandal}</FieldError>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label required>Day</Label>
          <Select value={form.dayOfWeek} onChange={update('dayOfWeek')}>
            {WEEKDAYS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </Select>
        </div>
        <div>
          <Label required>Time</Label>
          <Input type="time" value={form.time} onChange={update('time')} error={errors.time} />
          <FieldError>{errors.time}</FieldError>
        </div>
        <div>
          <Label>Repeats</Label>
          <Select value={form.intervalWeeks} onChange={update('intervalWeeks')}>
            {INTERVALS.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
          </Select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label required>Starts from</Label>
          <Input type="date" value={form.startDate} onChange={update('startDate')} error={errors.startDate} />
          <FieldError>{errors.startDate}</FieldError>
        </div>
        <div>
          <Label>Stops after (optional)</Label>
          <Input type="date" value={form.endDate} onChange={update('endDate')} error={errors.endDate} />
          <FieldError>{errors.endDate}</FieldError>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label>Duration (minutes)</Label>
          <Input type="number" min="15" step="15" value={form.durationMinutes} onChange={update('durationMinutes')} placeholder="120" />
        </div>
        <div>
          <Label>Usual speaker (optional)</Label>
          <Input value={form.speaker} onChange={update('speaker')} placeholder="Left blank on each sabha if empty" />
        </div>
      </div>

      <div>
        <Label>Sabha title (optional)</Label>
        <Input value={form.title} onChange={update('title')} placeholder={`${form.mandal || 'Sabha'} — ${form.area || 'Area'}`} />
        <p className="mt-1 text-xs text-slate-400">
          Left blank, each generated sabha is titled “{form.mandal || 'Sabha'} — {form.area || 'Area'}”.
          Every one can still be renamed individually afterwards.
        </p>
      </div>

      <label className="flex items-start gap-2 rounded-lg border border-slate-100 bg-slate-50/60 p-3">
        <input
          type="checkbox"
          checked={form.active !== false}
          onChange={(e) => setForm((p) => ({ ...p, active: e.target.checked }))}
          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-orange-500 focus:ring-orange-300"
        />
        <span className="text-[13px] text-slate-600">
          <span className="font-medium text-slate-700">Active</span>
          <span className="block text-xs text-slate-400">
            Paused schedules stop creating new sabhas but keep their track record on the grid.
            Use this over a holiday break instead of deleting.
          </span>
        </span>
      </label>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="accent" disabled={saving}>
          {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create schedule'}
        </Button>
      </div>
    </form>
  );
}
