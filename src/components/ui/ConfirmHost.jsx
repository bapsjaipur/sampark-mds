// src/components/ui/ConfirmHost.jsx
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 44 — A REAL CONFIRMATION DIALOG, EVERYWHERE.
//
// The app had ~27 destructive actions guarded by window.confirm(): a grey OS
// alert with an app-icon the user's browser chose, two buttons the app can't
// style, and no way to tell "Delete role" apart from "Rename campaign". This
// replaces every one of them with a single styled dialog that matches Modal.jsx
// and the toast system.
//
// WHY IMPERATIVE, NOT A HOOK. window.confirm() is called from inside event
// handlers, not at a component's top level, so a useConfirm() hook would force
// every one of the 27 call sites to also hoist a hook to the component top and
// thread the result down. An imperative confirmDialog() that returns a Promise
// keeps each edit a one-liner:
//
//     if (!window.confirm("Delete role?")) return;              // before
//     if (!(await confirmDialog({ title: "Delete role?",        // after
//           tone: "danger", confirmText: "Delete" }))) return;
//
// A single <ConfirmHost/> mounted in App registers the opener; confirmDialog()
// resolves true/false when a button is pressed. If the host somehow isn't
// mounted we fall back to the native confirm so the action still works.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "../../lib/cn";

let openFn = null; // set by the mounted <ConfirmHost/>

/**
 * Ask the user to confirm an action. Returns a Promise<boolean>.
 *
 * @param {object}  o
 * @param {string}  o.title        headline (e.g. "Delete this role?")
 * @param {string} [o.message]     supporting line(s); \n is honoured
 * @param {string} [o.confirmText] primary button label (default "Confirm")
 * @param {string} [o.cancelText]  secondary button label (default "Cancel")
 * @param {"default"|"danger"} [o.tone] "danger" paints the primary button red
 */
export function confirmDialog(o = {}) {
  return new Promise((resolve) => {
    if (!openFn) {
      // Host not mounted — keep the action working rather than swallowing it.
      resolve(window.confirm(o.message ? `${o.title}\n\n${o.message}` : o.title || "Are you sure?"));
      return;
    }
    openFn(o, resolve);
  });
}

export default function ConfirmHost() {
  const [options, setOptions] = useState(null);
  const resolverRef = useRef(null);

  useEffect(() => {
    openFn = (o, resolve) => {
      resolverRef.current = resolve;
      setOptions(o);
    };
    return () => { openFn = null; };
  }, []);

  const close = useCallback((result) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setOptions(null);
    if (resolve) resolve(result); // resolving twice (StrictMode) is a no-op
  }, []);

  useEffect(() => {
    if (!options) return;
    const onKey = (e) => {
      if (e.key === "Escape") close(false);
      else if (e.key === "Enter") close(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [options, close]);

  if (!options) return null;

  const o = { title: "Are you sure?", confirmText: "Confirm", cancelText: "Cancel", tone: "default", ...options };
  const danger = o.tone === "danger";

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/40 px-4 backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && close(false)}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={o.title}
        className="w-full max-w-sm rounded-lg border border-slate-100 bg-white shadow-xl shadow-slate-900/5"
      >
        <div className="p-5">
          <div className="flex gap-3">
            <div className={cn("mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full", danger ? "bg-rose-50" : "bg-orange-50")}>
              <AlertTriangle className={cn("h-4 w-4", danger ? "text-rose-500" : "text-orange-500")} />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-[15px] font-semibold text-slate-900">{o.title}</h2>
              {o.message && <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-slate-500">{o.message}</p>}
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button
              onClick={() => close(false)}
              className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50"
            >
              {o.cancelText}
            </button>
            <button
              autoFocus
              onClick={() => close(true)}
              className={cn(
                "rounded-lg px-3.5 py-2 text-sm font-medium text-white transition-colors",
                danger ? "bg-rose-600 hover:bg-rose-700" : "bg-orange-600 hover:bg-orange-700",
              )}
            >
              {o.confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
