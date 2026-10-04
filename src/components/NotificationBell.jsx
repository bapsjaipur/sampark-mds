// src/components/NotificationBell.jsx
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 48 — the bell in the chrome. A dropdown of the newest unread items with
// an unread badge, mounted in both the desktop sidebar footer and the mobile top
// bar (src/components/AppLayout.jsx).
//
// It owns exactly one thing: the live unread listener (subscribeToMyNotifications),
// which is bounded to the newest 30 unread and metered — see the service header
// for why that stays cheap. Clicking an item marks it seen and navigates to its
// in-app link; "Mark all read" clears the badge; the footer opens the full inbox
// page. Everything heavier (paging, the send composer) lives on NotificationsPage.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Check } from 'lucide-react';
import { useAuth } from '../hooks/usePermissions';
import {
  subscribeToMyNotifications, markSeen, markAllSeen, UNREAD_LISTEN_LIMIT,
} from '../services/notificationService';
import { cn } from '../lib/cn';

/** Firestore Timestamp | number | Date | null → Date | null. */
function toJsDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  if (value instanceof Date) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Compact "just now / 5m / 3h / 2d / 12 Aug" — no dependency on a date lib. */
function timeAgo(value) {
  const d = toJsDate(value);
  if (!d) return '';
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 45) return 'just now';
  if (secs < 3600) return `${Math.round(secs / 60)}m`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h`;
  if (secs < 7 * 86400) return `${Math.round(secs / 86400)}d`;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function NotificationBell({ collapsed = false }) {
  const { authUser } = useAuth();
  const uid = authUser?.uid || null;
  const navigate = useNavigate();

  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => subscribeToMyNotifications(uid, setItems), [uid]);

  // Close on outside click or Escape — a dropdown anchored in the chrome must not
  // trap focus or linger when the user moves on.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const unread = items.length;
  const badge = unread > UNREAD_LISTEN_LIMIT ? `${UNREAD_LISTEN_LIMIT}+` : String(unread);

  const openItem = useCallback(async (item) => {
    setOpen(false);
    // Optimistic: drop it from the live list so the badge updates instantly, then
    // persist. The listener would do this on the next snapshot anyway; doing it
    // here first means no flicker between click and server round-trip.
    setItems((prev) => prev.filter((x) => x.id !== item.id));
    markSeen(uid, item.id).catch(() => {});
    if (item.link) navigate(item.link);
  }, [uid, navigate]);

  const onMarkAll = useCallback(async () => {
    const snapshot = items;
    setItems([]);
    try { await markAllSeen(uid, snapshot); } catch { /* listener will restore truth */ }
  }, [uid, items]);

  if (!uid) return null;

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={unread ? `Notifications (${badge} unread)` : 'Notifications'}
        title="Notifications"
        className={cn(
          'relative rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700',
          open && 'bg-slate-100 text-slate-700',
        )}
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className={cn(
            'absolute -right-0.5 -top-0.5 flex min-w-[16px] items-center justify-center rounded-full bg-orange-600 px-1 text-[10px] font-bold leading-4 text-white',
          )}>
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div
          className={cn(
            'absolute z-50 mt-2 w-80 max-w-[90vw] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl',
            // Anchor sensibly whether the bell sits in the mobile top bar (right)
            // or the collapsed desktop sidebar footer (left edge).
            collapsed ? 'left-0' : 'right-0',
          )}
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <p className="text-[13px] font-semibold text-slate-800">Notifications</p>
            {unread > 0 && (
              <button
                type="button"
                onClick={onMarkAll}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              >
                <Check className="h-3 w-3" /> Mark all read
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-3 py-6 text-center text-[13px] text-slate-400">You’re all caught up.</p>
            ) : (
              items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => openItem(item)}
                  className="flex w-full flex-col items-start gap-0.5 border-b border-slate-50 px-3 py-2.5 text-left transition-colors hover:bg-slate-50 last:border-0"
                >
                  <span className="flex w-full items-start justify-between gap-2">
                    <span className="text-[13px] font-semibold text-slate-800">{item.title || 'Notification'}</span>
                    <span className="shrink-0 pt-0.5 text-[11px] text-slate-400">{timeAgo(item.createdAt)}</span>
                  </span>
                  {item.body && <span className="line-clamp-2 text-[12px] leading-snug text-slate-500">{item.body}</span>}
                </button>
              ))
            )}
          </div>

          <button
            type="button"
            onClick={() => { setOpen(false); navigate('/notifications'); }}
            className="block w-full border-t border-slate-100 px-3 py-2 text-center text-[12px] font-medium text-orange-600 hover:bg-orange-50"
          >
            View all notifications
          </button>
        </div>
      )}
    </div>
  );
}
