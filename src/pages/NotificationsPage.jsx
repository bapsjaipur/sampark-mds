// src/pages/NotificationsPage.jsx
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 48 — the full notification inbox, the heavier half the bell deliberately
// does not carry (NotificationBell.jsx keeps only the live unread listener).
//
// Two parts:
//   • The inbox — every item, seen and unread, newest first, PAGED through
//     fetchInbox (a one-shot getDocs per page, metered), so opening this screen is
//     one bounded read and never a second standing listener on top of the bell's.
//     Click opens an item's in-app link and marks it seen; a row can be dismissed;
//     "Mark all read" clears the lot.
//   • The send composer — rendered ONLY for someone who holds send_notifications,
//     so a volunteer who can't send never mounts the roster/roles/areas listeners
//     the composer needs. The audience is a union of Everyone / Areas / Mandals /
//     Roles / named volunteers; "Check recipients" resolves the blast radius
//     WITHOUT writing (previewBulkNotification) so the sender confirms "this reaches
//     N people" before committing. The right to send is decided server-side from
//     the dynamic permission — this screen only offers the controls.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell, BellRing, Megaphone, CalendarClock, UserCheck, Cake, ClipboardList,
  Check, X, Loader2, Send, Search, Trash2, Users, Eye, ChevronDown, ChevronUp,
} from 'lucide-react';
import { useAuth } from '../hooks/usePermissions';
import { useToast } from '../contexts/ToastContext';
import { useAreasAndMandals } from '../hooks/useAreasAndMandals';
import { useRoles } from '../hooks/useRoles';
import { useVolunteers } from '../hooks/useVolunteers';
import {
  fetchInbox, markSeen, markAllSeen, dismiss,
  sendBulkNotification, previewBulkNotification, sendTestToSelf,
} from '../services/notificationService';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input, Textarea, Label } from '../components/ui/Input';
import ChipMultiSelect from '../components/ui/ChipMultiSelect';
import { cn } from '../lib/cn';

const PAGE_SIZE = 25;

/** Firestore Timestamp | number | Date | null → Date | null. */
function toJsDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  if (value instanceof Date) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "just now / 5m / 3h / 2d / 12 Aug" — same compact scale the bell uses. */
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

// Icon + tint per notification type. An unknown/legacy type falls back to the
// generic bell rather than rendering icon-less.
const TYPE_META = {
  batch_assigned: { Icon: ClipboardList, tint: 'bg-sky-50 text-sky-600' },
  sabha_reminder: { Icon: CalendarClock, tint: 'bg-violet-50 text-violet-600' },
  attendance_marked: { Icon: UserCheck, tint: 'bg-emerald-50 text-emerald-600' },
  birthday: { Icon: Cake, tint: 'bg-pink-50 text-pink-600' },
  bulk_alert: { Icon: Megaphone, tint: 'bg-orange-50 text-orange-600' },
};
function metaFor(type) {
  return TYPE_META[type] || { Icon: Bell, tint: 'bg-slate-100 text-slate-500' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Send composer — mounted only for send_notifications holders.
// ─────────────────────────────────────────────────────────────────────────────
function SendAlertComposer() {
  const { showToast } = useToast();
  const { areas, mandals } = useAreasAndMandals();
  const { roles } = useRoles();
  const { volunteers } = useVolunteers();

  const [open, setOpen] = useState(false);
  const [everyone, setEveryone] = useState(false);
  const [areaSel, setAreaSel] = useState([]);
  const [mandalSel, setMandalSel] = useState([]);
  const [roleSel, setRoleSel] = useState([]);
  const [volSel, setVolSel] = useState([]);
  const [volQuery, setVolQuery] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [preview, setPreview] = useState(null); // { count, sample } | null
  const [previewing, setPreviewing] = useState(false);
  const [sending, setSending] = useState(false);

  const areaOptions = useMemo(() => areas.map((a) => a.name).filter(Boolean), [areas]);
  const mandalOptions = useMemo(() => mandals.map((m) => m.name).filter(Boolean), [mandals]);
  const roleOptions = useMemo(
    () => roles.map((r) => ({ value: r.id, label: r.name || r.id })),
    [roles],
  );

  const volById = useMemo(() => {
    const m = new Map();
    for (const v of volunteers) m.set(v.id, v);
    return m;
  }, [volunteers]);

  // Volunteer search only kicks in at 2+ chars, and never lists more than a
  // handful — this is a picker for a few named people, not a roster browser.
  const volMatches = useMemo(() => {
    const q = volQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    return volunteers
      .filter((v) => {
        if (volSel.includes(v.id)) return false;
        const hay = `${v.name || ''} ${v.mobile || v.mobileNumber || ''}`.toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 6);
  }, [volQuery, volunteers, volSel]);

  const hasAudience = everyone
    || areaSel.length > 0 || mandalSel.length > 0 || roleSel.length > 0 || volSel.length > 0;
  const canSend = title.trim().length > 0 && hasAudience;

  // Any change to the audience invalidates a shown count — never let a stale
  // "reaches 40 people" sit above a since-widened selection.
  const resetPreview = () => setPreview(null);

  const buildAudience = useCallback(() => ({
    everyone,
    areas: areaSel,
    mandals: mandalSel,
    roleIds: roleSel,
    volunteerIds: volSel,
  }), [everyone, areaSel, mandalSel, roleSel, volSel]);

  async function onPreview() {
    if (!hasAudience) return;
    setPreviewing(true);
    try {
      const res = await previewBulkNotification(buildAudience());
      setPreview({ count: res?.count || 0, sample: res?.sample || [] });
    } catch (err) {
      showToast({ type: 'error', message: err?.message || 'Could not resolve recipients.' });
    } finally {
      setPreviewing(false);
    }
  }

  function clearForm() {
    setEveryone(false); setAreaSel([]); setMandalSel([]); setRoleSel([]);
    setVolSel([]); setVolQuery(''); setTitle(''); setBody(''); setPreview(null);
  }

  async function onSend() {
    if (!canSend) return;
    setSending(true);
    try {
      const res = await sendBulkNotification({ audience: buildAudience(), title: title.trim(), body: body.trim() });
      const n = res?.written ?? res?.count ?? 0;
      showToast({ type: 'success', message: `Alert sent to ${n} ${n === 1 ? 'person' : 'people'}.` });
      clearForm();
    } catch (err) {
      showToast({ type: 'error', message: err?.message || 'Could not send the alert.' });
    } finally {
      setSending(false);
    }
  }

  async function onTestSelf() {
    if (!title.trim()) { showToast({ type: 'info', message: 'Add a title first.' }); return; }
    setSending(true);
    try {
      await sendTestToSelf({ audience: buildAudience(), title: title.trim(), body: body.trim() });
      showToast({ type: 'success', message: 'Test sent to you — check your bell.' });
    } catch (err) {
      showToast({ type: 'error', message: err?.message || 'Could not send the test.' });
    } finally {
      setSending(false);
    }
  }

  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Megaphone className="h-4 w-4 text-orange-600" /> Send an alert
        </span>
        {open ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
      </button>

      {open && (
        <div className="space-y-4 border-t border-slate-100 px-4 py-4">
          {/* Audience ────────────────────────────────────────────────────── */}
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-[13px] font-medium text-slate-700">
              <input
                type="checkbox"
                checked={everyone}
                onChange={(e) => { setEveryone(e.target.checked); resetPreview(); }}
                className="h-4 w-4 rounded border-slate-300 text-orange-600 focus:ring-orange-500"
              />
              Everyone — send to every volunteer
            </label>

            <div className={cn('space-y-3', everyone && 'pointer-events-none opacity-40')}>
              <div>
                <Label>Areas</Label>
                <ChipMultiSelect
                  options={areaOptions} value={areaSel}
                  onChange={(v) => { setAreaSel(v); resetPreview(); }}
                  allLabel="areas" emptyLabel="No areas yet"
                />
              </div>
              <div>
                <Label>Mandals</Label>
                <ChipMultiSelect
                  options={mandalOptions} value={mandalSel}
                  onChange={(v) => { setMandalSel(v); resetPreview(); }}
                  allLabel="mandals" emptyLabel="No mandals yet"
                />
              </div>
              <div>
                <Label>Roles</Label>
                <ChipMultiSelect
                  options={roleOptions} value={roleSel}
                  onChange={(v) => { setRoleSel(v); resetPreview(); }}
                  allLabel="roles" emptyLabel="No roles yet"
                />
              </div>

              {/* Named volunteers */}
              <div>
                <Label>Specific volunteers</Label>
                {volSel.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {volSel.map((id) => (
                      <span key={id} className="inline-flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-2.5 py-1 text-[12px] font-medium text-orange-700">
                        {volById.get(id)?.name || id}
                        <button
                          type="button"
                          onClick={() => { setVolSel((prev) => prev.filter((x) => x !== id)); resetPreview(); }}
                          className="text-orange-400 hover:text-orange-700"
                          aria-label="Remove"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={volQuery}
                    onChange={(e) => setVolQuery(e.target.value)}
                    placeholder="Search a name to add…"
                    className="pl-8"
                  />
                </div>
                {volMatches.length > 0 && (
                  <div className="mt-1 overflow-hidden rounded-lg border border-slate-200">
                    {volMatches.map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => { setVolSel((prev) => [...prev, v.id]); setVolQuery(''); resetPreview(); }}
                        className="flex w-full items-center gap-2 border-b border-slate-50 px-3 py-2 text-left text-[13px] text-slate-700 last:border-0 hover:bg-slate-50"
                      >
                        <Users className="h-3.5 w-3.5 text-slate-400" />
                        {v.name || v.id}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Message ─────────────────────────────────────────────────────── */}
          <div className="space-y-3 border-t border-slate-100 pt-4">
            <div>
              <Label required>Title</Label>
              <Input
                value={title} maxLength={120}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Gather at the mandir at 6pm"
              />
            </div>
            <div>
              <Label>Message</Label>
              <Textarea
                value={body} rows={3} maxLength={500}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Optional detail — where, when, what to bring…"
              />
            </div>
          </div>

          {/* Recipient count + actions ───────────────────────────────────── */}
          {preview && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-[13px] text-slate-700">
              {preview.count === 0
                ? 'That audience resolves to nobody — widen the selection.'
                : (
                  <>
                    Reaches <strong>{preview.count}</strong> {preview.count === 1 ? 'person' : 'people'}
                    {preview.sample.length > 0 && (
                      <span className="text-slate-500">: {preview.sample.join(', ')}{preview.count > preview.sample.length ? ', …' : ''}</span>
                    )}
                  </>
                )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="accent" onClick={onSend} disabled={!canSend || sending}>
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Send alert
            </Button>
            <Button variant="secondary" onClick={onPreview} disabled={!hasAudience || previewing || sending}>
              {previewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
              Check recipients
            </Button>
            <Button variant="ghost" onClick={onTestSelf} disabled={sending}>
              <BellRing className="h-3.5 w-3.5" /> Test to myself
            </Button>
          </div>
          <p className="text-[11px] leading-relaxed text-slate-400">
            A test goes only to your own bell, so you can see exactly what a recipient will see
            before alerting anyone. “Check recipients” resolves the count without sending.
          </p>
        </div>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The page.
// ─────────────────────────────────────────────────────────────────────────────
export default function NotificationsPage() {
  const { authUser, hasPermission } = useAuth();
  const uid = authUser?.uid || null;
  const navigate = useNavigate();
  const canSend = hasPermission('send_notifications');

  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  // First page on mount / uid change.
  useEffect(() => {
    let alive = true;
    if (!uid) { setItems([]); setDone(true); setLoading(false); return undefined; }
    setLoading(true);
    fetchInbox(uid, { pageSize: PAGE_SIZE }).then((res) => {
      if (!alive) return;
      setItems(res.items); setCursor(res.cursor); setDone(res.done); setLoading(false);
    }).catch(() => { if (alive) { setItems([]); setDone(true); setLoading(false); } });
    return () => { alive = false; };
  }, [uid]);

  const loadMore = useCallback(async () => {
    if (!uid || done || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetchInbox(uid, { pageSize: PAGE_SIZE, cursor });
      setItems((prev) => [...prev, ...res.items]);
      setCursor(res.cursor); setDone(res.done);
    } finally {
      setLoadingMore(false);
    }
  }, [uid, cursor, done, loadingMore]);

  const unreadCount = useMemo(() => items.filter((i) => !i.seen).length, [items]);

  const onOpen = useCallback((item) => {
    if (!item.seen) {
      setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, seen: true } : x)));
      markSeen(uid, item.id).catch(() => {});
    }
    if (item.link) navigate(item.link);
  }, [uid, navigate]);

  const onDismiss = useCallback((item) => {
    setItems((prev) => prev.filter((x) => x.id !== item.id));
    dismiss(uid, item.id).catch(() => {});
  }, [uid]);

  const onMarkAll = useCallback(async () => {
    const unread = items.filter((i) => !i.seen);
    if (!unread.length) return;
    setItems((prev) => prev.map((x) => ({ ...x, seen: true })));
    try { await markAllSeen(uid, unread); } catch { /* a reload will restore truth */ }
  }, [uid, items]);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
          <BellRing className="h-5 w-5 text-orange-600" /> Notifications
        </h1>
        {unreadCount > 0 && (
          <Button variant="ghost" size="sm" onClick={onMarkAll}>
            <Check className="h-3.5 w-3.5" /> Mark all read
          </Button>
        )}
      </div>

      {canSend && <SendAlertComposer />}

      <Card className="overflow-hidden">
        {loading ? (
          <p className="px-4 py-10 text-center text-sm text-slate-400">Loading…</p>
        ) : items.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-slate-100">
              <Bell className="h-5 w-5 text-slate-400" />
            </div>
            <p className="text-sm font-medium text-slate-700">No notifications yet</p>
            <p className="mt-1 text-[13px] text-slate-400">New alerts, batches and sabha reminders will show up here.</p>
          </div>
        ) : (
          <ul>
            {items.map((item) => {
              const { Icon, tint } = metaFor(item.type);
              return (
                <li key={item.id} className="flex items-start gap-3 border-b border-slate-50 px-4 py-3 last:border-0">
                  <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full', tint)}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <button
                    type="button"
                    onClick={() => onOpen(item)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="flex items-center gap-2">
                      {!item.seen && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-orange-500" />}
                      <span className={cn('text-[14px]', item.seen ? 'font-medium text-slate-700' : 'font-semibold text-slate-900')}>
                        {item.title || 'Notification'}
                      </span>
                    </span>
                    {item.body && <span className="mt-0.5 block text-[13px] leading-snug text-slate-500">{item.body}</span>}
                    <span className="mt-1 flex items-center gap-2 text-[11px] text-slate-400">
                      {timeAgo(item.createdAt)}
                      {item.sentBy?.name && <span>· from {item.sentBy.name}</span>}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDismiss(item)}
                    className="shrink-0 rounded-md p-1 text-slate-300 transition-colors hover:bg-slate-100 hover:text-slate-500"
                    aria-label="Dismiss"
                    title="Dismiss"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {!loading && !done && items.length > 0 && (
          <div className="border-t border-slate-100 p-3 text-center">
            <Button variant="secondary" size="sm" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</> : 'Load more'}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
