// src/components/ui/ChipMultiSelect.jsx
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 21. Picking areas and mandals happens in four places now (batch
// generation, volunteer assignment, reminders, reports) and every one of them
// needs the same thing: choose several from a short fixed list, on a phone.
//
// Deliberately NOT a <select multiple>. On mobile Safari and Chrome that
// renders as a tiny scrolling box where ctrl-click is the only way to add a
// second value — there is no ctrl key on a phone, so the control is effectively
// single-select for the people who use this app most. Toggle chips have no
// hidden interaction: what you tap is what changes.
//
// An option may be a bare string, `{ value, label }`, or `{ value, label,
// disabled }`. A disabled option is greyed and inert but STILL RENDERS — the
// area-scope gate (Phase 34, SabhaScheduleForm) shows every area with the ones
// outside the creator's territory greyed out, the same choice AreaSelect makes,
// so a truncated list can't be mistaken for an enforced boundary. A value that
// is already selected but has since become disabled stays visible and selected.
// ─────────────────────────────────────────────────────────────────────────────
import { Check } from 'lucide-react';
import { cn } from '../../lib/cn';

export default function ChipMultiSelect({
  options = [],
  value = [],
  onChange,
  disabled = false,
  emptyLabel = 'Nothing to choose from',
  allLabel = null,        // when set, shows a "select all / clear" shortcut
  className,
}) {
  const selected = Array.isArray(value) ? value : [];
  const isDisabledOpt = (o) => typeof o === 'object' && o !== null && o.disabled === true;
  // "Select all" and its allSelected test only ever concern the choosable
  // options — a greyed area can't be filed under, so it is never swept in.
  const selectable = options.filter((o) => !isDisabledOpt(o)).map((o) => (typeof o === 'string' ? o : o.value));
  const allSelected = selectable.length > 0 && selectable.every((v) => selected.includes(v));

  const toggle = (v, optDisabled) => {
    if (disabled || optDisabled) return;
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  };

  if (!options.length) {
    return <p className={cn('text-xs text-slate-400', className)}>{emptyLabel}</p>;
  }

  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {allLabel && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(allSelected ? selected.filter((v) => !selectable.includes(v)) : [...new Set([...selected, ...selectable])])}
          className={cn(
            'inline-flex min-h-[32px] items-center rounded-full border px-2.5 text-[12px] font-medium transition-colors',
            'border-dashed border-slate-300 text-slate-500 hover:border-slate-400 hover:text-slate-700',
            disabled && 'cursor-not-allowed opacity-50',
          )}
        >
          {allSelected ? `Clear ${allLabel}` : `All ${allLabel}`}
        </button>
      )}
      {options.map((opt) => {
        const v = typeof opt === 'string' ? opt : opt.value;
        const label = typeof opt === 'string' ? opt : (opt.label || opt.value);
        const optDisabled = isDisabledOpt(opt);
        const on = selected.includes(v);
        return (
          <button
            key={v}
            type="button"
            disabled={disabled || optDisabled}
            aria-pressed={on}
            onClick={() => toggle(v, optDisabled)}
            className={cn(
              // min-h 32 keeps the tap target usable without making a 17-chip
              // area list three screens tall.
              'inline-flex min-h-[32px] items-center gap-1 rounded-full border px-2.5 text-[12px] font-medium transition-colors',
              on
                ? 'border-orange-200 bg-orange-50 text-orange-700'
                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50',
              (disabled || optDisabled) && 'cursor-not-allowed opacity-50',
            )}
          >
            {on && <Check className="h-3 w-3 shrink-0" />}
            {label}
          </button>
        );
      })}
    </div>
  );
}
