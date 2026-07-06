// src/components/ui/Badge.jsx — pastel-tint badges, Attio-style.
import { cn } from '../../lib/cn';

const TONE_CLASSES = {
  slate: 'bg-slate-100 text-slate-600',
  green: 'bg-emerald-50 text-emerald-700',
  red: 'bg-rose-50 text-rose-700',
  yellow: 'bg-amber-50 text-amber-700',
  blue: 'bg-sky-50 text-sky-700',
  purple: 'bg-purple-50 text-purple-700',
  orange: 'bg-orange-50 text-orange-700',
};

export function Badge({ tone = 'slate', className, children }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium', TONE_CLASSES[tone] || TONE_CLASSES.slate, className)}>
      {children}
    </span>
  );
}

export default Badge;
