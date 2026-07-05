// src/components/ui/Button.jsx — shadcn-style primitive, hand-authored
// source (this is how shadcn/ui actually works: you own the component
// code, it's not a black-box package).
import { forwardRef } from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/cn';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-300 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-slate-900 text-white hover:bg-slate-800',
        accent: 'bg-orange-600 text-white hover:bg-orange-700',
        secondary: 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
        ghost: 'text-slate-500 hover:bg-slate-100 hover:text-slate-700',
        danger: 'border border-rose-200 bg-white text-rose-600 hover:bg-rose-50',
        dangerSolid: 'bg-rose-600 text-white hover:bg-rose-700',
      },
      size: {
        sm: 'h-8 px-2.5 text-xs',
        md: 'h-9 px-3.5',
        lg: 'h-10 px-5',
        icon: 'h-8 w-8 p-0',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  }
);

export const Button = forwardRef(({ className, variant, size, ...props }, ref) => (
  <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
));
Button.displayName = 'Button';

export default Button;
