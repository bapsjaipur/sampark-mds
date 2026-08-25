// src/components/ui/VolunteerBadge.jsx
// ─────────────────────────────────────────────────────────────────────────────
// The visual mark for "this contact is one of our karyakartas".
//
// Indigo on purpose: orange is the app's action colour and green/amber/rose all
// already mean call-status somewhere. A sevak badge sitting in a list of call
// outcomes must not read as an outcome.
//
// Two pieces, because one is not enough on its own:
//   <VolunteerBadge/> — the label, for anywhere there is room for text.
//   <VolunteerRing/>  — a ring around the avatar, for dense rows where the badge
//                       would be the fourth thing competing for the same line.
// Used together they survive both a 375px phone row and a desktop table.
// ─────────────────────────────────────────────────────────────────────────────
import { ShieldCheck } from 'lucide-react';
import { cn } from '../../lib/cn';

export function VolunteerBadge({ volunteer, roleName, showName = false, className }) {
  if (!volunteer) return null;
  const label = roleName || 'Sevak';
  return (
    <span
      title={`${volunteer.name || 'Volunteer'} — ${label}`}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-1.5 py-0.5',
        'text-[10px] font-semibold uppercase tracking-wide text-indigo-700',
        className,
      )}
    >
      <ShieldCheck className="h-2.5 w-2.5 shrink-0" />
      {showName ? label : 'Sevak'}
    </span>
  );
}

/**
 * Wraps an <Avatar>. `active` false renders the child untouched, so call sites
 * can wrap unconditionally instead of branching their JSX.
 */
export function VolunteerRing({ active, children, className }) {
  if (!active) return children;
  return (
    <span className={cn('relative inline-flex shrink-0 rounded-full ring-2 ring-indigo-400 ring-offset-1', className)}>
      {children}
    </span>
  );
}

export default VolunteerBadge;
