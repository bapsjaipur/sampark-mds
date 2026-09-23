// src/components/events/SabhaScheduleForm.jsx
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 33 — the recurrence rule editor. "that things of recurring which mandal
// and area it will created by Mandal Head Super Moderator."
//
// PHASE 34 — a recurring sabha can now span SEVERAL areas, or none.
//
// "there should be also all area recurring sabha, and multiple area combine
//  sabha option of selecting two areas one time."
//
// So the single Area dropdown became a multi-select, matching EventForm:
//
//   • pick two or more areas → ONE joint recurring sabha. It generates a single
//     event each week whose attendance is marked once and counts for every area
//     it lists (occurrenceKeys in sabhaSchedule.js is what lets the grid credit
//     that one event to each area's row).
//   • pick none → a CITY-WIDE recurring sabha, one weekly event for the whole
//     city that counts for every area.
//
// Mandal stays single and required — a sabha is still one mandal's gathering,
// and the generated events must each carry a mandal for firestore.rules to admit
// them. An AREA-RESTRICTED creator (Area Moderator / Karyakarta) still can't make
// a city-wide rule: the events it would generate carry area=null, which the
// rules refuse unless the mandal matches, so validate() makes them pick at least
// one of their own areas. Areas outside their territory are shown greyed, never
// dropped — the same choice AreaSelect made — so the boundary reads as enforced
// rather than as a broken list.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from 'react';
import { MandalSelect, SubAreaSelect } from '../AreaMandalSelect';
import ChipMultiSelect from '../ui/ChipMultiSelect';
import { Input, Label, FieldError, Select } from '../ui/Input';
import { Button } from '../ui/Button';
import { useAreasAndMandals } from '../../hooks/useAreasAndMandals';
import { eventAreas } from '../../lib/scope';
import { WEEKDAYS, INTERVALS, toDateStr } from '../../lib/sabhaSchedule';

const selectClass = 'h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-300';

export default function SabhaScheduleForm({
  schedule, onSubmit, onCancel, allowedMandals = null, allowedAreas = null,
}) {
  const isEdit = Boolean(schedule);
  const mandalRestricted = Array.isArray(allowedMandals);
  const areaRestricted = Array.isArray(allowedAreas);
  const { areas: areaDefs } = useAreasAndMandals();

  const defaultMandal = useMemo(() => {
    if (!mandalRestricted) return '';
    const bal = allowedMandals.find((m) => (m || '').toLowerCase() === 'bal mandal');
    return bal || allowedMandals[0] || '';
  }, [mandalRestricted, allowedMandals]);

  const [form, setForm] = useState(() => (isEdit ? {
    title: schedule.title || '',
    areas: eventAreas(schedule),
    mandal: schedule.mandal || '',
    subArea: schedule.subArea || '',
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
    // An area-restricted creator with exactly one area gets it pre-selected;
    // with several they pick, and an unrestricted creator starts city-wide
    // (empty) until they choose.
    areas: areaRestricted && allowedAreas.length === 1 ? [allowedAreas[0]] : [],
    mandal: defaultMandal,
    subArea: '',
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

  // Every defined area, plus any the edited schedule already lists that has
  // since been renamed away — so opening an old rule never silently drops one.
  // Areas outside an area-restricted creator's territory render greyed rather
  // than being removed (ChipMultiSelect's disabled option), the same choice
  // AreaSelect made, so the boundary can't be mistaken for a broken list.
  const areaOptions = useMemo(() => {
    const names = (areaDefs || []).map((a) => a.name || a).filter(Boolean);
    return [...new Set([...names, ...form.areas])].map((name) => ({
      value: name,
      label: name,
      disabled: areaRestricted && !allowedAreas.includes(name),
    }));
  }, [areaDefs, form.areas, areaRestricted, allowedAreas]);

  const cityWide = form.areas.length === 0;
  const areaLabelText = form.areas.length ? form.areas.join(' + ') : 'All areas';
  // PHASE 43 — a sub-area only applies when the recurring sabha is filed under
  // exactly ONE area that actually has sub-areas; hidden otherwise. Every event
  // this schedule generates then carries the sub-area too (eventFromSchedule).
  const singleArea = form.areas.length === 1 ? form.areas[0] : '';
  const singleAreaHasSubs = useMemo(() => {
    if (!singleArea) return false;
    const def = (areaDefs || []).find((a) => (a.name || a) === singleArea);
    return Array.isArray(def?.subAreas) && def.subAreas.length > 0;
  }, [areaDefs, singleArea]);

  function validate() {
    const errs = {};
    // City-wide (no areas) is fine for an unrestricted creator; an area-scoped
    // one must name at least one of their areas, because the events this rule
    // generates would otherwise carry area=null, which the rules refuse from
    // them.
    if (areaRestricted && form.areas.length === 0) {
      errs.areas = 'Pick at least one of your areas — an area-restricted schedule can’t be city-wide.';
    } else if (areaRestricted && form.areas.some((a) => !allowedAreas.includes(a))) {
      errs.areas = 'One or more of these areas aren’t assigned to you.';
    }
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
      areas: form.areas,
      mandal: form.mandal,
      // Only persist a sub-area when the single filed area offers one; never let
      // a value left over from a previous area selection slip through.
      subArea: singleAreaHasSubs ? (form.subArea || '') : '',
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

      <div>
        <Label required={areaRestricted}>
          {areaRestricted ? 'Areas' : 'Areas (leave empty for a city-wide sabha)'}
        </Label>
        <ChipMultiSelect
          options={areaOptions}
          value={form.areas}
          onChange={(next) => setForm((p) => ({
            ...p,
            areas: next,
            // Drop the sub-area on any switch to city-wide, a joint sabha, or a
            // different single area.
            subArea: (next.length === 1 && p.areas.length === 1 && next[0] === p.areas[0]) ? p.subArea : '',
          }))}
          emptyLabel="No areas defined yet."
        />
        <p className="mt-1 text-xs text-slate-400">
          {cityWide
            ? 'City-wide — one recurring sabha for the whole city, counted for every area.'
            : form.areas.length > 1
              ? `Joint sabha across ${areaLabelText} — one sabha each time, attendance marked once and counted for each area.`
              : `Files this recurring sabha under ${form.areas[0]}.`}
        </p>
        <FieldError>{errors.areas}</FieldError>
      </div>

      {/* PHASE 43 — sub-area for a recurring sabha held in one sector of an area.
          Shown only when the single chosen area has sub-areas. */}
      {singleAreaHasSubs && (
        <div>
          <Label>Sub-area (optional)</Label>
          <SubAreaSelect
            areaName={singleArea}
            value={form.subArea}
            onChange={update('subArea')}
            className={selectClass}
          />
          <p className="mt-1 text-xs text-slate-400">
            If this recurring sabha is held in a specific sub-area of {singleArea}, pick it — every generated sabha inherits it.
          </p>
        </div>
      )}

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
        <Input value={form.title} onChange={update('title')} placeholder={`${form.mandal || 'Sabha'} — ${areaLabelText}`} />
        <p className="mt-1 text-xs text-slate-400">
          Left blank, each generated sabha is titled “{form.mandal || 'Sabha'} — {areaLabelText}”.
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
