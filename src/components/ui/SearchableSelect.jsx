// src/components/ui/SearchableSelect.jsx
// ─────────────────────────────────────────────────────────────────────────────
// PHASE B — a single-select combobox with a type-to-filter box.
//
// The native <select> the batch tools used is fine for eight volunteers and a
// scroll-hunt at eighty: it has no search, and on a phone it opens a full-screen
// wheel you spin by hand. This is the same control with a filter box on top, so
// "assign to Rahul" is three keystrokes rather than a scan of the whole roster.
// Written for the assign dropdown, which the volunteer list will outgrow first,
// but generic — every volunteer picker in the batch tools now uses it.
//
// Deliberately NOT a library and NOT <select multiple>: the app already hand-rolls
// its multi-select for the same phone reasons (see ChipMultiSelect). One more
// control that matches the house input style is cheaper than a dependency.
//
// Two call forms:
//   options={[{ value, label }]}                          — a flat list
//   groups={[{ label, options: [{ value, label }] }]}     — labelled sections,
//     which is what the assign dropdown needs to keep "volunteers whose own
//     area/mandal covers this batch" above everyone else.
//
// `emptyOption={{ label }}` makes value '' a real, re-selectable choice ("Any
// volunteer", "Nobody — leave unassigned"). Without it, '' is just "nothing
// chosen yet" and shows `placeholder` greyed out — which is what the assign
// dropdown wants, since picking someone immediately fires the assignment.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, Check, X } from 'lucide-react';
import { cn } from '../../lib/cn';

export default function SearchableSelect({
  value = '',
  onChange,
  options = null,
  groups = null,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  emptyOption = null,
  disabled = false,
  className,
  // Below this many options the filter box is clutter, so a short list behaves
  // like a plain menu. 22 volunteers (the BatchList note) is above it; the
  // area/mandal filters, usually a handful, stay search-free.
  searchThreshold = 8,
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const rootRef = useRef(null);
  const inputRef = useRef(null);

  // Normalise both call forms to one grouped shape internally.
  const normalizedGroups = useMemo(() => {
    if (Array.isArray(groups)) return groups.filter((g) => (g.options || []).length);
    return [{ label: null, options: options || [] }];
  }, [groups, options]);

  const flat = useMemo(() => normalizedGroups.flatMap((g) => g.options), [normalizedGroups]);
  const selected = flat.find((o) => o.value === value) || null;
  const showSearch = flat.length > searchThreshold;

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return normalizedGroups;
    return normalizedGroups
      .map((g) => ({ ...g, options: g.options.filter((o) => (o.label || '').toLowerCase().includes(term)) }))
      .filter((g) => g.options.length);
  }, [q, normalizedGroups]);

  const matchCount = useMemo(() => filtered.reduce((n, g) => n + g.options.length, 0), [filtered]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Focus the filter when the menu opens; forget the last query when it closes.
  useEffect(() => {
    if (open && showSearch) inputRef.current?.focus();
    if (!open) setQ('');
  }, [open, showSearch]);

  const choose = (v) => { onChange?.(v); setOpen(false); };

  const buttonLabel = selected ? selected.label : (emptyOption ? emptyOption.label : placeholder);
  const isPlaceholder = !selected && !emptyOption;

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2.5 text-sm transition-colors',
          'focus:outline-none focus:ring-1 focus:ring-slate-300 focus:border-slate-300',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        <span className={cn('truncate', isPlaceholder ? 'text-slate-400' : 'text-slate-900')}>{buttonLabel}</span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-[13rem] rounded-lg border border-slate-200 bg-white shadow-lg">
          {showSearch && (
            <div className="relative border-b border-slate-100 p-2">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && matchCount > 0) {
                    e.preventDefault();
                    const first = filtered[0]?.options[0];
                    if (first) choose(first.value);
                  }
                }}
                placeholder={searchPlaceholder}
                className="h-8 w-full rounded-md border border-slate-200 bg-white pl-8 pr-7 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-300 focus:outline-none focus:ring-1 focus:ring-slate-300"
              />
              {q && (
                <button
                  type="button"
                  onClick={() => { setQ(''); inputRef.current?.focus(); }}
                  aria-label="Clear search"
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          )}

          <div className="max-h-60 overflow-y-auto py-1">
            {/* The "" choice sits above the list and only when not searching — a
                search is a hunt for a name, and "Any volunteer" is never it. */}
            {emptyOption && !q && (
              <button
                type="button"
                onClick={() => choose('')}
                className={cn(
                  'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50',
                  !value ? 'font-medium text-slate-900' : 'text-slate-500',
                )}
              >
                <span className="truncate">{emptyOption.label}</span>
                {!value && <Check className="h-3.5 w-3.5 shrink-0 text-orange-600" />}
              </button>
            )}

            {matchCount === 0 ? (
              <p className="px-3 py-3 text-center text-xs text-slate-400">
                {flat.length === 0 ? 'Nothing to choose from.' : `No match for “${q}”.`}
              </p>
            ) : (
              filtered.map((g, gi) => (
                <div key={g.label || `g${gi}`}>
                  {g.label && (
                    <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{g.label}</p>
                  )}
                  {g.options.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => choose(o.value)}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50',
                        o.value === value ? 'font-medium text-slate-900' : 'text-slate-700',
                      )}
                    >
                      <span className="truncate">{o.label}</span>
                      {o.value === value && <Check className="h-3.5 w-3.5 shrink-0 text-orange-600" />}
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
