// src/components/reminders/RemindersDashboard.jsx
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 22 — rebuilt as a day-by-day board.
//
// WHAT THIS SCREEN IS FOR: it is a to-do list for today, not a report. The old
// version was two flat lists ("This Week", "This Month") sorted by MM-DD, which
// answered "who has a birthday in September" — a question nobody was asking —
// while burying the only urgent thing, whose birthday is TODAY, somewhere in the
// middle of thirty rows.
//
// So the list is grouped by DAY with relative headers (Today / Tomorrow /
// weekday / date), today's cards are visually promoted, and the three counts at
// the top are the range filter rather than decoration.
//
// SCOPE. The list is the volunteer's own area × mandal — see reminderService and
// lib/scope. That is enforced in the query, not here; this screen's job is to say
// out loud whose list it is, so "why can't I see so-and-so's birthday" has a
// visible answer instead of looking like missing data. An admin (unrestricted)
// sees everyone and gets Area / Mandal pickers to narrow down by hand.
//
// SORTING NOTE: entries are ordered by DAYS-UNTIL, never by the MM-DD string. In
// December a lexicographic sort puts 01-05 before 12-25, i.e. it claims next
// January comes before this Christmas.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Phone, Cake, Heart, MessageCircle, User, Info, Search, X, CalendarHeart, PartyPopper,
  CalendarPlus, Copy, Check, CalendarDays, RefreshCw,
} from 'lucide-react';
import { getReminders } from '../../services/reminderService';
import { getMyCalendarFeed } from '../../services/calendarService';
import {
  getGoogleCalendarStatus, startGoogleCalendarAuth, syncMyGoogleCalendar, disconnectGoogleCalendar,
} from '../../services/googleCalendarService';
import { logActivity } from '../../lib/activityLog';
import { useAuth } from '../../hooks/usePermissions';
import { useSettings } from '../../hooks/useSettings';
import { useVolunteerIdentity } from '../../hooks/useVolunteerIdentity';
import { useToast } from '../../contexts/ToastContext';
import { confirmDialog } from '../ui/ConfirmHost';
import {
  buildWhatsAppUrl,
  buildTelUrl,
  normalizePhone,
  DEFAULT_BIRTHDAY_TEMPLATE,
  DEFAULT_ANNIVERSARY_TEMPLATE,
} from '../../lib/whatsapp';
import { describeScope } from '../../lib/scope';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Select } from '../ui/Input';
import { VolunteerBadge, VolunteerRing } from '../ui/VolunteerBadge';
import { cn } from '../../lib/cn';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Midnight today, so every comparison is a whole number of days. */
function startOfToday() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

/**
 * The next calendar date an MM-DD falls on, and how many days away it is.
 * Returns null for an unusable value rather than guessing, so a malformed
 * dobMonthDay drops out of the board instead of landing on today.
 */
function nextOccurrence(monthDay) {
  const [m, d] = String(monthDay || '').split('-').map(Number);
  if (!m || !d || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const today = startOfToday();
  let date = new Date(today.getFullYear(), m - 1, d);
  if (date < today) date = new Date(today.getFullYear() + 1, m - 1, d);
  return { date, days: Math.round((date - today) / 86400000) };
}

/** Years between a stored YYYY-MM-DD and a target year, or null if unusable. */
function yearsBetween(dateStr, targetYear) {
  const year = Number(String(dateStr || '').slice(0, 4));
  if (!year) return null;
  const n = targetYear - year;
  return n > 0 && n < 130 ? n : null;
}

/** "Today" / "Tomorrow" / "Friday" / "Sat, 20 Sep" — nearest first. */
function dayLabel(days, date) {
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days < 7) return WEEKDAYS[date.getDay()];
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

const RANGES = [
  { days: 0, label: 'Today', icon: PartyPopper },
  { days: 7, label: 'Next 7 days', icon: CalendarHeart },
  { days: 30, label: 'Next 30 days', icon: CalendarHeart },
];

const TYPES = [
  { key: 'all', label: 'All' },
  { key: 'dob', label: 'Birthdays', icon: Cake },
  { key: 'anniversary', label: 'Anniversaries', icon: Heart },
];

// Written out literally, both of them, because Tailwind 3 only keeps classes it
// can see as complete strings in the source.
const STYLE = {
  dob: {
    spine: 'bg-gradient-to-b from-amber-400 to-orange-500',
    chip: 'border-amber-200 bg-amber-50 text-amber-800',
    icon: 'text-amber-600',
  },
  anniversary: {
    spine: 'bg-gradient-to-b from-rose-400 to-pink-500',
    chip: 'border-rose-200 bg-rose-50 text-rose-800',
    icon: 'text-rose-600',
  },
};

function Chip({ className, children }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium', className)}>
      {children}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function ReminderCard({ entry, volunteerId, volunteerName, templates, sevak }) {
  const { individual, type, monthDay, days, date } = entry;
  const isBirthday = type === 'dob';
  const Icon = isBirthday ? Cake : Heart;
  const style = STYLE[isBirthday ? 'dob' : 'anniversary'];
  const today = days === 0;

  const phone = normalizePhone(individual.mobile);
  const telUrl = buildTelUrl(individual.mobile);

  const year = date.getFullYear();
  const age = isBirthday ? yearsBetween(individual.dob, year) : null;
  const years = isBirthday ? null : yearsBetween(individual.anniversary, year);

  const waUrl = buildWhatsAppUrl({
    mobile: individual.mobile,
    template: isBirthday
      ? (templates?.birthdayTemplate || DEFAULT_BIRTHDAY_TEMPLATE)
      : (templates?.anniversaryTemplate || DEFAULT_ANNIVERSARY_TEMPLATE),
    contact: individual,
    extra: { volunteerName, age, years },
  });

  async function log(action, via) {
    await logActivity({
      volunteerId,
      individualId: individual.id,
      action,
      details: `${isBirthday ? 'Birthday' : 'Anniversary'} reminder ${via} (${monthDay})`,
    });
  }

  return (
    <article
      className={cn(
        'relative overflow-hidden rounded-xl border bg-white transition-shadow hover:shadow-sm',
        today ? 'border-orange-200 ring-1 ring-orange-100' : 'border-slate-100',
        sevak && !today && 'border-indigo-200',
      )}
    >
      {/* Colour spine: birthday vs anniversary readable at a glance, in the
          peripheral vision, without reading the label. */}
      <span className={cn('absolute inset-y-0 left-0 w-1', style.spine)} aria-hidden="true" />

      <div className="pl-4 pr-3 py-3">
        <div className="flex items-start gap-3">
          <Link to={`/contacts/${individual.id}`} className="group flex min-w-0 flex-1 items-start gap-3">
            <VolunteerRing active={Boolean(sevak)}>
              <Avatar src={individual.profilePhotoURL} name={individual.name} size="md" />
            </VolunteerRing>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="truncate text-sm font-semibold text-slate-900 group-hover:text-orange-700">
                  {individual.name || 'Unnamed'}
                </p>
                <VolunteerBadge volunteer={sevak} />
              </div>

              <p className={cn('mt-0.5 flex items-center gap-1 text-xs font-medium', style.icon)}>
                <Icon className="h-3.5 w-3.5 shrink-0" />
                {age ? `Turning ${age}` : null}
                {years ? `${years} years together` : null}
                {!age && !years ? (isBirthday ? 'Birthday' : 'Anniversary') : null}
              </p>

              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                {today && (
                  <Chip className="border-orange-600 bg-orange-600 text-white">
                    <PartyPopper className="h-3 w-3" /> Today
                  </Chip>
                )}
                <Chip className={style.chip}>
                  {date.getDate()} {MONTHS[date.getMonth()]}
                </Chip>
                {individual.mandal && (
                  <Chip className="border-slate-200 bg-slate-50 text-slate-600">{individual.mandal}</Chip>
                )}
                {entry.area && (
                  <Chip className="border-slate-200 bg-slate-50 text-slate-600">{entry.area}</Chip>
                )}
              </div>
            </div>
          </Link>
        </div>

        {/* Actions: a full-width row of three on a phone, so each is a
            comfortable thumb target; they stay full-width in the grid too
            because the card is already narrow at every breakpoint. */}
        <div className="mt-3 flex items-center gap-1.5 border-t border-slate-100 pt-2.5">
          <Link to={`/contacts/${individual.id}`} className="flex-1">
            <Button variant="secondary" size="sm" className="w-full">
              <User className="h-3.5 w-3.5" /> Profile
            </Button>
          </Link>
          {telUrl ? (
            <a href={telUrl} onClick={() => log('call_initiated', 'call')} className="flex-1">
              <Button variant="accent" size="sm" className="w-full">
                <Phone className="h-3.5 w-3.5" /> Call
              </Button>
            </a>
          ) : null}
          {waUrl ? (
            <a
              href={waUrl}
              target="_blank"
              rel="noreferrer"
              onClick={() => log('whatsapp_sent', 'WhatsApp')}
              className="flex-1"
            >
              <Button variant="secondary" size="sm" className="w-full border-[#128C7E]/30 text-[#0e7469] hover:bg-emerald-50">
                <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
              </Button>
            </a>
          ) : null}
          {!phone && <span className="flex-1 text-center text-[11px] text-slate-400">No mobile saved</span>}
        </div>
      </div>
    </article>
  );
}

function StatTile({ active, label, count, Icon, onClick }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex-1 rounded-xl border px-3 py-2.5 text-left transition-colors',
        active
          ? 'border-orange-300 bg-orange-50/70 ring-1 ring-orange-100'
          : 'border-slate-100 bg-white hover:border-slate-200 hover:bg-slate-50',
      )}
    >
      <span className={cn('flex items-center gap-1.5 text-[11px] font-medium', active ? 'text-orange-700' : 'text-slate-500')}>
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{label}</span>
      </span>
      <span className={cn('mt-0.5 block text-xl font-semibold tabular-nums', active ? 'text-orange-900' : 'text-slate-900')}>
        {count}
      </span>
    </button>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-slate-100 bg-white p-3">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-slate-100" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="h-3.5 w-2/3 animate-pulse rounded bg-slate-100" />
          <div className="h-3 w-1/3 animate-pulse rounded bg-slate-100" />
          <div className="h-4 w-1/2 animate-pulse rounded-full bg-slate-100" />
        </div>
      </div>
      <div className="mt-3 h-7 animate-pulse rounded bg-slate-50" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function RemindersDashboard() {
  const { volunteer, permissions, scope } = useAuth();
  const { settings: templates } = useSettings('messageTemplate');
  const { identify } = useVolunteerIdentity();
  const { showToast } = useToast();

  const [raw, setRaw] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const [range, setRange] = useState(30);
  const [type, setType] = useState('all');
  const [search, setSearch] = useState('');
  const [areaFilter, setAreaFilter] = useState('');
  const [mandalFilter, setMandalFilter] = useState('');

  // PHASE 35 — the volunteer's own subscribable calendar link. Fetched on demand
  // (minting the link is a write), then shown inline with copy + instructions.
  const [calOpen, setCalOpen] = useState(false);
  const [calFeed, setCalFeed] = useState(null);
  const [calLoading, setCalLoading] = useState(false);
  const [calCopied, setCalCopied] = useState(false);

  // PHASE 37 — the optional per-user Google Calendar push. Status is fetched only
  // when the calendar panel is opened, so a volunteer who never opens it costs no
  // extra reads. Null until fetched; { configured, enabled, connected, email, ... }.
  const [gcal, setGcal] = useState(null);
  const [gcalBusy, setGcalBusy] = useState(false);

  async function openCalendar() {
    setCalOpen(true);
    // Cheap status read, only the first time the panel opens. Silent on failure —
    // the ICS link below still works and is the primary path.
    if (!gcal) getGoogleCalendarStatus().then(setGcal).catch(() => {});
    if (calFeed || calLoading) return;
    setCalLoading(true);
    try {
      const res = await getMyCalendarFeed({ rotate: false });
      setCalFeed(res);
    } catch (err) {
      const code = String(err?.code || '');
      const msg = code.includes('not-found') || code.includes('internal') || code.includes('unavailable')
        ? 'Calendar sync isn’t switched on yet — ask an admin to deploy it.'
        : (err?.message || 'Could not get your calendar link.');
      showToast({ type: 'error', message: msg });
      setCalOpen(false);
    } finally {
      setCalLoading(false);
    }
  }

  async function copyCalendar() {
    if (!calFeed?.url) return;
    try {
      await navigator.clipboard.writeText(calFeed.url);
      setCalCopied(true);
      setTimeout(() => setCalCopied(false), 2000);
    } catch {
      showToast({ type: 'info', message: 'Couldn’t copy automatically — select the link and copy it.' });
    }
  }

  async function connectGoogle() {
    setGcalBusy(true);
    try {
      const { url } = await startGoogleCalendarAuth();
      window.open(url, '_blank', 'noopener');
      showToast({ type: 'info', message: 'Finish signing in on the Google tab, then come back and press “Sync now”.' });
    } catch (err) {
      showToast({ type: 'error', message: err?.message || 'Could not start Google sign-in.' });
    } finally {
      setGcalBusy(false);
    }
  }

  async function syncGoogle() {
    setGcalBusy(true);
    try {
      const res = await syncMyGoogleCalendar();
      if (res?.skipped === 'not-connected') {
        showToast({ type: 'info', message: 'Not connected yet — press Connect and finish the Google sign-in first.' });
      } else if (res?.skipped === 'not-configured') {
        showToast({ type: 'info', message: 'Google Calendar sync isn’t switched on yet.' });
      } else if (res?.ok) {
        showToast({
          type: 'success',
          message: `Synced ${res.upserted} event${res.upserted === 1 ? '' : 's'} to your Google Calendar${res.capped ? ` (first ${res.maxPerSync} — the rest are in the subscribe link above)` : ''}.`,
        });
      }
      getGoogleCalendarStatus().then(setGcal).catch(() => {}); // refresh connected/lastSync
    } catch (err) {
      showToast({ type: 'error', message: err?.message || 'Sync failed.' });
    } finally {
      setGcalBusy(false);
    }
  }

  async function disconnectGoogle() {
    const ok = await confirmDialog({
      title: 'Disconnect Google Calendar?',
      message: 'Events already added stay in your calendar; future changes just stop syncing.',
      confirmText: 'Disconnect',
      tone: 'danger',
    });
    if (!ok) return;
    setGcalBusy(true);
    try {
      await disconnectGoogleCalendar();
      showToast({ type: 'info', message: 'Google Calendar disconnected.' });
      getGoogleCalendarStatus().then(setGcal).catch(() => {});
    } catch (err) {
      showToast({ type: 'error', message: err?.message || 'Could not disconnect.' });
    } finally {
      setGcalBusy(false);
    }
  }

  useEffect(() => {
    if (!volunteer) return;
    let alive = true;
    setLoading(true);
    setFailed(false);
    getReminders({ volunteer, permissions, scope })
      .then((res) => { if (alive) setRaw(res.entries || []); })
      .catch((err) => {
        console.error('[reminders] load failed', err);
        if (alive) { setRaw([]); setFailed(true); }
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [volunteer, permissions, scope]);

  // Decorate once with the day arithmetic, drop anything unparseable, and order
  // by days-until so December's list doesn't put next January first.
  const entries = useMemo(() => raw
    .map((e) => {
      const occ = nextOccurrence(e.monthDay);
      return occ ? { ...e, days: occ.days, date: occ.date } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.days - b.days || (a.individual.name || '').localeCompare(b.individual.name || '')),
  [raw]);

  const counts = useMemo(() => ({
    0: entries.filter((e) => e.days === 0).length,
    7: entries.filter((e) => e.days <= 7).length,
    30: entries.length,
  }), [entries]);

  // The pickers only earn their space when there is more than one thing to pick
  // — a scoped karyakarta with a single area shouldn't be asked to choose it.
  const areaOptions = useMemo(
    () => [...new Set(entries.map((e) => e.area).filter(Boolean))].sort(),
    [entries],
  );
  const mandalOptions = useMemo(
    () => [...new Set(entries.map((e) => e.individual.mandal).filter(Boolean))].sort(),
    [entries],
  );

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (e.days > range) return false;
      if (type !== 'all' && e.type !== type) return false;
      if (areaFilter && e.area !== areaFilter) return false;
      if (mandalFilter && e.individual.mandal !== mandalFilter) return false;
      if (term) {
        const hay = `${e.individual.name || ''} ${e.individual.mobile || ''} ${e.individual.mandal || ''} ${e.area || ''}`;
        if (!hay.toLowerCase().includes(term)) return false;
      }
      return true;
    });
  }, [entries, range, type, areaFilter, mandalFilter, search]);

  // One group per calendar day, nearest first. Grouping on `days` rather than
  // the MM-DD keeps the year boundary correct for free.
  const groups = useMemo(() => {
    const map = new Map();
    for (const e of visible) {
      if (!map.has(e.days)) map.set(e.days, []);
      map.get(e.days).push(e);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [visible]);

  const filtered = Boolean(search.trim() || areaFilter || mandalFilter || type !== 'all');
  const scopeText = scope?.unrestricted ? 'All areas and mandals' : describeScope(scope);

  const rowProps = { volunteerId: volunteer?.id, volunteerName: volunteer?.name, templates };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">Reminders</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-slate-500">
            Birthdays and anniversaries in
            <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[12px] font-medium text-slate-700">
              {scopeText}
            </span>
          </p>
        </div>
        {!(scope?.empty && !scope?.unrestricted) && (
          <Button variant="secondary" size="sm" onClick={openCalendar} disabled={calLoading} className="shrink-0">
            <CalendarPlus className="h-3.5 w-3.5" />
            {calLoading ? 'Getting link…' : 'Add to Calendar'}
          </Button>
        )}
      </div>

      {/* The volunteer's own subscribable feed — every name in their scope as a
          yearly all-day event, kept in sync by their calendar app itself. */}
      {calOpen && calFeed && (
        <div className="mb-5 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
              <CalendarPlus className="h-4 w-4 text-slate-400" /> Your birthday &amp; anniversary calendar
            </p>
            <button
              onClick={() => setCalOpen(false)}
              aria-label="Close"
              className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {calFeed.empty ? (
            <p className="mt-1 text-xs text-amber-700">
              No dates are saved in your scope yet — the calendar will fill in as birthdays are added.
            </p>
          ) : (
            <p className="mt-1 text-xs text-slate-500">
              Add this private link once and every birthday and anniversary in your list appears in Google or Apple
              Calendar, updating itself from then on.
            </p>
          )}
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              readOnly
              value={calFeed.url}
              onFocus={(e) => e.target.select()}
              className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-600"
              aria-label="Your calendar subscription URL"
            />
            <Button variant="secondary" size="sm" onClick={copyCalendar} className="shrink-0">
              {calCopied ? <><Check className="h-3.5 w-3.5" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy link</>}
            </Button>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
            Google Calendar → Other calendars → From URL. Apple Calendar → File → New Calendar Subscription. Keep
            the link private — it shows your whole list.
          </p>

          {/* PHASE 37 — the optional push: shown only once an admin has set up and
              enabled the OAuth client. Writes editable events into the volunteer's
              own calendar, updated in place so a corrected date never duplicates. */}
          {gcal?.configured && gcal?.enabled && (
            <div className="mt-3 border-t border-slate-200 pt-3">
              <p className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                <CalendarDays className="h-4 w-4 text-slate-400" /> Or push straight into Google Calendar
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Connect your Google account once, then press Sync to write these birthdays in as editable events.
                Fixing a date and syncing again updates the same event — it never adds a duplicate.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {gcal.connected ? (
                  <>
                    <Button variant="accent" size="sm" onClick={syncGoogle} disabled={gcalBusy}>
                      <RefreshCw className={cn('h-3.5 w-3.5', gcalBusy && 'animate-spin')} />
                      {gcalBusy ? 'Working…' : 'Sync now'}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={disconnectGoogle} disabled={gcalBusy}>Disconnect</Button>
                    <span className="text-[11px] text-slate-400">
                      {gcal.email ? `Connected as ${gcal.email}` : 'Connected'}
                      {gcal.lastSyncAt ? ` · last synced ${new Date(gcal.lastSyncAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}` : ''}
                    </span>
                  </>
                ) : (
                  <>
                    <Button variant="secondary" size="sm" onClick={connectGoogle} disabled={gcalBusy}>
                      <CalendarDays className="h-3.5 w-3.5" /> {gcalBusy ? 'Opening…' : 'Connect Google Calendar'}
                    </Button>
                    <span className="text-[11px] text-slate-400">Opens Google in a new tab. Come back and press Sync.</span>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {scope?.empty && !scope?.unrestricted && (
        <div className="mb-5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            No areas or mandals are assigned to your login yet, so there is nothing to remind you about.
            Ask an admin to set your area and mandal in <strong>Admin → Volunteers</strong>.
          </p>
        </div>
      )}

      {failed && (
        <div className="mb-5 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Couldn't load reminders. Check your connection and reload the page.</p>
        </div>
      )}

      {/* ── Counts, doubling as the range filter ─────────────────────────── */}
      <div className="mb-3 flex gap-2">
        {RANGES.map((r) => (
          <StatTile
            key={r.days}
            active={range === r.days}
            label={r.label}
            count={counts[r.days]}
            Icon={r.icon}
            onClick={() => setRange(r.days)}
          />
        ))}
      </div>

      {/* ── Type segments + search + pickers ─────────────────────────────── */}
      <div className="mb-5 space-y-2">
        <div className="flex gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {TYPES.map((t) => (
            <button
              key={t.key}
              onClick={() => setType(t.key)}
              className={cn(
                'flex shrink-0 flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors',
                type === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
              )}
            >
              {t.icon && <t.icon className="h-3.5 w-3.5" />}
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, mobile, mandal…"
              className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-8 text-sm text-slate-900 placeholder:text-slate-400 focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-200"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {/* Two-up on a phone (sm:contents hands them back to the flex row
              above from sm up). Stacked, these two dropdowns cost 88px of
              vertical space before the first birthday card — side by side they
              cost 44px and both labels still read in full at 167px. */}
          <div className="grid grid-cols-2 gap-2 sm:contents">
            {areaOptions.length > 1 && (
              <Select value={areaFilter} onChange={(e) => setAreaFilter(e.target.value)} className="min-w-0 sm:w-44">
                <option value="">All areas</option>
                {areaOptions.map((a) => <option key={a} value={a}>{a}</option>)}
              </Select>
            )}
            {mandalOptions.length > 1 && (
              <Select value={mandalFilter} onChange={(e) => setMandalFilter(e.target.value)} className="min-w-0 sm:w-44">
                <option value="">All mandals</option>
                {mandalOptions.map((m) => <option key={m} value={m}>{m}</option>)}
              </Select>
            )}
          </div>
        </div>
      </div>

      {/* ── Board ────────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3].map((i) => <SkeletonCard key={i} />)}
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 px-6 py-12 text-center">
          <CalendarHeart className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-3 text-sm font-medium text-slate-700">
            {filtered ? 'Nothing matches those filters' : `Nothing due in the ${range === 0 ? 'next day' : `next ${range} days`}`}
          </p>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-slate-400">
            {filtered
              ? 'Try clearing the search or picking a wider range.'
              : `This covers ${scopeText.toLowerCase()}. Birthdays only appear for contacts whose date of birth has been filled in.`}
          </p>
          {filtered && (
            <Button
              variant="secondary"
              size="sm"
              className="mt-3"
              onClick={() => { setSearch(''); setAreaFilter(''); setMandalFilter(''); setType('all'); }}
            >
              Clear filters
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map(([days, list]) => (
            <section key={days}>
              <div className="mb-2 flex items-center gap-2">
                <h2 className={cn(
                  'text-[13px] font-semibold uppercase tracking-wider',
                  days === 0 ? 'text-orange-700' : 'text-slate-500',
                )}>
                  {dayLabel(days, list[0].date)}
                </h2>
                <span className="rounded-full bg-slate-100 px-1.5 text-[11px] font-medium tabular-nums text-slate-500">
                  {list.length}
                </span>
                <span className="h-px flex-1 bg-slate-100" />
                {days > 1 && (
                  <span className="text-[11px] tabular-nums text-slate-400">in {days} days</span>
                )}
              </div>
              <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                {list.map((e) => (
                  <ReminderCard
                    key={`${e.individual.id}-${e.type}`}
                    entry={e}
                    sevak={identify(e.individual)}
                    {...rowProps}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
