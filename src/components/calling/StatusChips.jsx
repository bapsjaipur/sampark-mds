// src/components/calling/StatusChips.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Two renderings of the same vocabulary:
//
//   size="sm"  (default) — the original inline pill row. Still used anywhere a
//                          status picker sits inside a dense desktop form.
//   size="lg"            — a 2-up grid of 56px targets for the mobile calling
//                          screen. The pill row failed badly on a phone: seven
//                          variable-width pills wrapped into four ragged rows,
//                          "Interested" and "Not Interested" landed adjacent at
//                          ~30px tall, and mis-taps recorded the opposite of
//                          what the volunteer meant. A fixed grid makes every
//                          target the same size and puts the two opposites in
//                          different columns.
//
// The vocabulary itself is now admin-editable (settings/callOutcomes). Pass an
// `outcomes` array to render a specific list — the admin editor's live preview
// does this so it can show unsaved edits. Omit it and the live configured list
// is used.
// ─────────────────────────────────────────────────────────────────────────────
import { Check } from 'lucide-react';
import { colorClassesForToken } from '../../lib/callingStatuses';
import { useCallOutcomes } from '../../hooks/useCallOutcomes';
import { cn } from '../../lib/cn';

export default function StatusChips({ value, onChange, size = 'sm', outcomes: outcomesProp }) {
  const { outcomes: liveOutcomes } = useCallOutcomes();
  const chips = outcomesProp || liveOutcomes;

  if (chips.length === 0) {
    return <p className="text-xs text-slate-400">No outcomes configured. An admin can add them under Admin Tools → Call Outcomes.</p>;
  }

  if (size === 'lg') {
    return (
      <div className="grid grid-cols-2 gap-2">
        {chips.map((chip) => {
          const selected = value === chip.value;
          return (
            <button
              key={chip.value}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(selected ? '' : chip.value)}
              className={cn(
                // min-h rather than h — "Already Volunteer" wraps to two lines
                // on a 320px-wide screen and must not clip.
                'relative flex min-h-[56px] items-center gap-2 rounded-xl border px-3 py-2 text-left text-[13px] font-medium leading-tight transition active:scale-[0.98]',
                selected
                  ? cn(colorClassesForToken(chip.colorClass), 'ring-2 ring-offset-1 ring-current')
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
              )}
            >
              {chip.emoji && <span className="text-lg leading-none">{chip.emoji}</span>}
              <span className="flex-1">{chip.label}</span>
              {selected && <Check className="h-4 w-4 shrink-0" />}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((chip) => {
        const selected = value === chip.value;
        return (
          <button
            key={chip.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(selected ? '' : chip.value)}
            className={cn(
              'rounded-full border px-3 py-1.5 text-sm font-medium transition',
              selected ? colorClassesForToken(chip.colorClass) : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
            )}
          >
            {chip.emoji} {chip.label}
          </button>
        );
      })}
    </div>
  );
}
