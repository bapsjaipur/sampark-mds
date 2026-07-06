// src/components/ui/Input.jsx
import { forwardRef } from 'react';
import { cn } from '../../lib/cn';

export const Input = forwardRef(({ className, error, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'h-9 w-full rounded-lg border bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 transition-colors',
      'focus:outline-none focus:ring-1 focus:ring-slate-300 focus:border-slate-300',
      error ? 'border-rose-300 focus:ring-rose-200' : 'border-slate-200',
      className
    )}
    {...props}
  />
));
Input.displayName = 'Input';

export const Textarea = forwardRef(({ className, error, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 transition-colors',
      'focus:outline-none focus:ring-1 focus:ring-slate-300 focus:border-slate-300',
      error ? 'border-rose-300 focus:ring-rose-200' : 'border-slate-200',
      className
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

export const Select = forwardRef(({ className, error, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      'h-9 w-full rounded-lg border bg-white px-2.5 text-sm text-slate-900 transition-colors',
      'focus:outline-none focus:ring-1 focus:ring-slate-300 focus:border-slate-300',
      error ? 'border-rose-300 focus:ring-rose-200' : 'border-slate-200',
      className
    )}
    {...props}
  >
    {children}
  </select>
));
Select.displayName = 'Select';

export const Label = ({ className, required, children, ...props }) => (
  <label className={cn('mb-1.5 block text-[13px] font-medium text-slate-700', className)} {...props}>
    {children} {required && <span className="text-orange-500">*</span>}
  </label>
);

export const FieldError = ({ children }) => children ? <p className="mt-1 text-xs text-rose-500">{children}</p> : null;
