// src/components/calling/StatusChips.jsx — Attio redesign.
import { STATUS_CHIPS, statusColorClasses } from '../../lib/callingStatuses';
import { cn } from '../../lib/cn';

export default function StatusChips({ value, onChange }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {STATUS_CHIPS.map((chip) => {
        const selected = value === chip.value;
        return (
          <button
            key={chip.value}
            type="button"
            onClick={() => onChange(selected ? '' : chip.value)}
            className={cn(
              'rounded-full border px-3 py-1.5 text-sm font-medium transition',
              selected ? statusColorClasses(chip.value) : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
            )}
          >
            {chip.emoji} {chip.label}
          </button>
        );
      })}
    </div>
  );
}
