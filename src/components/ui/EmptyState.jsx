// src/components/ui/EmptyState.jsx
// PHASE 44 — one shared empty-state block, so "nothing here yet" looks the same
// everywhere instead of each list inventing its own (or, worse, rendering blank).
// Matches the dashed-border card HouseholdsPage already used.
import { cn } from "../../lib/cn";

export default function EmptyState({ icon: Icon, title, message, action, className }) {
  return (
    <div className={cn("rounded-lg border border-dashed border-slate-200 px-6 py-16 text-center", className)}>
      {Icon && (
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-slate-100">
          <Icon className="h-5 w-5 text-slate-400" />
        </div>
      )}
      {title && <p className="font-medium text-slate-600">{title}</p>}
      {message && <p className="mx-auto mt-1 max-w-sm text-sm text-slate-400">{message}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
