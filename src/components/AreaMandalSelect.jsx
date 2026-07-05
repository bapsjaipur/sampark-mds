// src/components/AreaMandalSelect.jsx
// Fixed dropdowns backed by the areas/mandals reference collections instead
// of free-text input — this is the actual fix for "fix Mandal and Area with
// short code" (previously HouseholdForm's Area and IndividualForm's Mandal
// were plain <input> text fields, letting typos create phantom areas).
import { useAreasAndMandals } from '../hooks/useAreasAndMandals';

export function AreaSelect({ value, onChange, className, allowBlank = true }) {
  const { areas } = useAreasAndMandals();
  return (
    <select value={value} onChange={onChange} className={className}>
      {allowBlank && <option value="">Select area</option>}
      {areas.map((a) => <option key={a.code || a.name} value={a.name}>{a.name} ({a.code})</option>)}
    </select>
  );
}

export function MandalSelect({ value, onChange, className, allowBlank = true }) {
  const { mandals } = useAreasAndMandals();
  return (
    <select value={value} onChange={onChange} className={className}>
      {allowBlank && <option value="">Select Mandal</option>}
      {mandals.map((m) => <option key={m.code || m.name} value={m.name}>{m.name} ({m.code})</option>)}
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
