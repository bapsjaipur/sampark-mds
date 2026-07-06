// src/contexts/ToastContext.jsx — Attio-style toasts: flat white cards,
// 1px border, colored left accent instead of a solid colored background.
import { createContext, useCallback, useContext, useRef, useState } from "react";
import { CheckCircle2, XCircle, Info, X } from "lucide-react";

const ToastContext = createContext(null);
let idCounter = 0;

const ICONS = { success: CheckCircle2, error: XCircle, info: Info };
const ACCENTS = { success: "border-l-emerald-500", error: "border-l-rose-500", info: "border-l-slate-400" };
const ICON_COLORS = { success: "text-emerald-500", error: "text-rose-500", info: "text-slate-400" };

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef({});

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    clearTimeout(timers.current[id]);
    delete timers.current[id];
  }, []);

  const showToast = useCallback(
    ({ type = "info", message, duration = 4000 }) => {
      const id = ++idCounter;
      setToasts((prev) => [...prev, { id, type, message }]);
      timers.current[id] = setTimeout(() => dismiss(id), duration);
      return id;
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={{ showToast, dismiss }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-80 max-w-[90vw]">
        {toasts.map((t) => {
          const Icon = ICONS[t.type] || Info;
          return (
            <div
              key={t.id}
              role="status"
              className={`flex items-start gap-2.5 rounded-lg border border-slate-100 border-l-2 ${ACCENTS[t.type]} bg-white px-3.5 py-3 text-sm text-slate-700 shadow-lg shadow-slate-900/5 animate-[toast-in_150ms_ease-out]`}
            >
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${ICON_COLORS[t.type]}`} />
              <span className="flex-1">{t.message}</span>
              <button onClick={() => dismiss(t.id)} className="text-slate-300 hover:text-slate-500">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
