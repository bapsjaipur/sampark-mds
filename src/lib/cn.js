// src/lib/cn.js — standard shadcn/ui utility: merges Tailwind classes,
// letting later classes safely override earlier conflicting ones.
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
