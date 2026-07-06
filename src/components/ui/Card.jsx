// src/components/ui/Card.jsx
import { cn } from '../../lib/cn';

export function Card({ className, children, ...props }) {
  return <div className={cn('rounded-lg border border-slate-100 bg-white', className)} {...props}>{children}</div>;
}

export default Card;
