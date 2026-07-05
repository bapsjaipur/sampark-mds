// src/components/ui/Avatar.jsx — circular micro-avatar with initials fallback.
import { User } from 'lucide-react';
import { cn } from '../../lib/cn';

const SIZE_CLASSES = { sm: 'h-6 w-6 text-[10px]', md: 'h-9 w-9 text-xs', lg: 'h-12 w-12 text-sm' };

function initials(name) {
  if (!name) return '';
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('');
}

export function Avatar({ src, name, size = 'md', className }) {
  const sizeClass = SIZE_CLASSES[size] || SIZE_CLASSES.md;
  return (
    <div className={cn('shrink-0 overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200 flex items-center justify-center text-slate-500 font-medium', sizeClass, className)}>
      {src ? (
        <img src={src} alt={name || 'Avatar'} className="h-full w-full object-cover" />
      ) : name ? (
        <span>{initials(name)}</span>
      ) : (
        <User className="h-1/2 w-1/2 text-slate-300" />
      )}
    </div>
  );
}

export default Avatar;
