// src/components/AreaMandalSelect.jsx
// Fixed dropdowns backed by the areas/mandals reference collections instead
// of free-text input — this is the actual fix for "fix Mandal and Area with
// short code" (previously HouseholdForm's Area and IndividualForm's Mandal
// were plain <input> text fields, letting typos create phantom areas).
import { useMemo } from 'react';
import { useAreasAndMandals } from '../hooks/useAreasAndMandals';

/**
 * Callers pass either reference documents ({ name, code }) or bare name strings
 * — a scope's `assignedMandals` is the latter. Passing strings used to render a
 * list of blank options labelled "()", because the row was read as a document
 * and both `.name` and `.code` came back undefined.
 */
function normalizeOptions(list) {
  return (list || [])
    .map((o) => (typeof o === 'string' ? { name: o } : o))
    .filter((o) => o && o.name);
}

function optionLabel(o) {
  return o.code ? `${o.name} (${o.code})` : o.name;
}

/**
 * `allowed` greys out the areas this person may not file under — the area-axis
 * twin of MandalSelect's prop below, and it behaves identically: the full list
 * still renders (a truncated dropdown reads as a broken one rather than an
 * enforced boundary), and a value already saved outside `allowed` stays
 * selected so editing an old record can't blank its area.
 *
 * Omitted, nothing is greyed — every existing caller is unaffected.
 */
export function AreaSelect({ value, onChange, className, allowBlank = true, allowed = null }) {
  const { areas } = useAreasAndMandals();
  const allowedSet = useMemo(
    () => (Array.isArray(allowed) ? new Set(allowed) : null),
    [allowed],
  );
  return (
    <select value={value} onChange={onChange} className={className}>
      {allowBlank && <option value="">Select area</option>}
      {areas.map((a) => {
        const blocked = allowedSet ? !allowedSet.has(a.name) && a.name !== value : false;
        return (
          <option
            key={a.code || a.name}
            value={a.name}
            disabled={blocked}
            className={blocked ? 'text-slate-300' : undefined}
          >
            {a.code ? `${a.name} (${a.code})` : a.name}{blocked ? ' — not assigned to you' : ''}
          </option>
        );
      })}
    </select>
  );
}

export function SubAreaSelect({ areaName, value, onChange, className, allowBlank = true }) {
  const { areas } = useAreasAndMandals();
  const selectedArea = areas.find(a => a.name === areaName);
  const subAreas = selectedArea?.subAreas || [];

  if (subAreas.length === 0) return null;

  return (
    <select value={value} onChange={onChange} className={className}>
      {allowBlank && <option value="">Select sub-area</option>}
      {subAreas.map((sa) => (
        <option key={sa.code || sa.name} value={sa.name}>{sa.code ? `${sa.name} (${sa.code})` : sa.name}</option>
      ))}
    </select>
  );
}

/**
 * `options` REPLACES the list; `allowed` keeps the full list but greys out the
 * mandals this person may not file under.
 *
 * The second is what a scoped creator should get. Cutting the list down to their
 * one or two mandals reads as "the app only knows about two mandals" and hides
 * the fact that a boundary is being enforced at all; greying out shows both the
 * choice they have and the edge they are standing at. It also means a Super
 * Moderator over two mandals plainly sees both of theirs offered.
 *
 * A value already saved outside `allowed` still renders (editing an old event
 * shouldn't blank its mandal) — it is simply not re-selectable.
 */
export function MandalSelect({ value, onChange, className, allowBlank = true, options = null, allowed = null }) {
  const { mandals: allMandals } = useAreasAndMandals();
  const list = useMemo(() => normalizeOptions(options || allMandals), [options, allMandals]);
  const allowedSet = useMemo(
    () => (Array.isArray(allowed) ? new Set(allowed) : null),
    [allowed],
  );
  return (
    <select value={value} onChange={onChange} className={className}>
      {allowBlank && <option value="">Select Mandal</option>}
      {list.map((m) => {
        const blocked = allowedSet ? !allowedSet.has(m.name) && m.name !== value : false;
        return (
          <option
            key={m.code || m.name}
            value={m.name}
            disabled={blocked}
            className={blocked ? 'text-slate-300' : undefined}
          >
            {optionLabel(m)}{blocked ? ' — not assigned to you' : ''}
          </option>
        );
      })}
    </select>
  );
}

export function LevelSelect({ value, onChange, className, allowBlank = true }) {
  const { levels } = useAreasAndMandals();
  return (
    <select value={value} onChange={onChange} className={className}>
      {allowBlank && <option value="">Select level</option>}
      {levels.map((l) => <option key={l.code || l.name} value={l.name}>{l.name}</option>)}
    </select>
  );
}
