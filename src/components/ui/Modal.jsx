// src/components/ui/Modal.jsx — Attio-style: minimal chrome, 1px borders,
// no heavy shadows, generous whitespace.
import { useEffect, useRef } from "react";
import { X } from "lucide-react";

export default function Modal({ open, onClose, title, children, size = "md" }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const widths = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl" };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 backdrop-blur-[2px] sm:items-center sm:px-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      {/* PHASE 49 — mobile bottom-sheet. On a phone this anchors to the bottom
          edge (thumb reach, and the soft keyboard no longer hides the fields),
          with rounded top corners, near-full height, and safe-area padding so the
          primary action clears a notched device's home bar. `sm:` restores the
          original centred dialog on tablet/desktop, unchanged. */}
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`flex max-h-[92dvh] w-full flex-col rounded-t-2xl border border-slate-100 bg-white shadow-xl shadow-slate-900/5 focus:outline-none sm:max-h-[90vh] sm:rounded-lg ${widths[size]}`}
      >
        <div className="flex shrink-0 items-center justify-between rounded-t-2xl border-b border-slate-100 bg-white px-5 py-3.5 sm:rounded-t-lg">
          <h2 className="text-[15px] font-semibold text-slate-900">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 flex h-9 w-9 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:pb-5">{children}</div>
      </div>
    </div>
  );
}
