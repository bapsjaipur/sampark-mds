// src/pages/AdminToolsPage.jsx — Attio redesign.
import { useMemo, useState } from 'react';
import {
  ShieldCheck, ScrollText, Database, Megaphone, Mail, MessageSquareText,
  ListChecks, FileSpreadsheet, Gauge, SlidersHorizontal,
} from 'lucide-react';
import RequirePermission from '../components/RequirePermission';
import { usePermissions } from '../hooks/usePermissions';
import DataIntegrityTab from '../components/admin-tools/DataIntegrityTab';
import AuditTrailTab from '../components/admin-tools/AuditTrailTab';
import BackupRestoreTab from '../components/admin-tools/BackupRestoreTab';
import CampaignsTab from '../components/admin-tools/CampaignsTab';
import EmailAutomationTab from '../components/admin-tools/EmailAutomationTab';
import MessageTemplateTab from '../components/admin-tools/MessageTemplateTab';
import CallOutcomesTab from '../components/admin-tools/CallOutcomesTab';
import ImportHistoryTab from '../components/admin-tools/ImportHistoryTab';
import FirestoreUsageTab from '../components/admin-tools/FirestoreUsageTab';
import GeneralSettingsTab from '../components/admin-tools/GeneralSettingsTab';
import { cn } from '../lib/cn';

// `requires` is optional. The tabs that predate Phase 20 have no entry, so they
// keep behaving exactly as before — visible to anyone who clears the page gate
// below. The two new tabs declare their permission so a role that only has, say,
// view_all_contacts doesn't get a tab whose entire contents are a
// "you don't have permission" line.
//
// `Icon` and `hint` are not decoration: with nine tools on one screen the label
// alone stops being enough to find anything, and "Data Integrity" vs "Free Tier
// Usage" vs "Backup & Restore" all read as "something diagnostic" until you have
// clicked all three. The hint is the one-line answer to "what is this for".
//
// There is no "Follow-up Tracking" tab any more. It showed an all-time count of
// followup_call / followup_whatsapp actions per volunteer, which the Audit Trail
// now covers strictly better: filter Action to either follow-up type, optionally
// by volunteer and date, and you get the same events plus the contact, the time
// and the note — with CSV export.
//
// PHASE 24 — "Free Tier Usage" is last on purpose: it is the tab you open when
// something has gone wrong, not part of anybody's daily work. It is gated on
// manage_users because a karyakarta seeing everyone's read counts is neither
// useful to them nor their business.
const TABS = [
  { key: 'integrity', label: 'Data Integrity', short: 'Integrity', hint: 'Find duplicates and broken links', Icon: ShieldCheck, Component: DataIntegrityTab },
  { key: 'audit', label: 'Audit Trail', short: 'Audit', hint: 'Who changed what, and when', Icon: ScrollText, Component: AuditTrailTab },
  { key: 'backup', label: 'Backup & Restore', short: 'Backup', hint: 'Download or restore a JSON snapshot', Icon: Database, Component: BackupRestoreTab },
  { key: 'campaigns', label: 'Campaigns', short: 'Campaigns', hint: 'Padhramani and outreach drives', Icon: Megaphone, Component: CampaignsTab },
  { key: 'email', label: 'Report Emails', short: 'Emails', hint: 'Scheduled daily and sabha reports', Icon: Mail, Component: EmailAutomationTab, requires: ['send_emails'] },
  { key: 'templates', label: 'Message Templates', short: 'Templates', hint: 'WhatsApp wording for calls and wishes', Icon: MessageSquareText, Component: MessageTemplateTab, requires: ['manage_templates'] },
  { key: 'outcomes', label: 'Call Outcomes', short: 'Outcomes', hint: 'The buttons on the calling screen', Icon: ListChecks, Component: CallOutcomesTab, requires: ['manage_templates'] },
  { key: 'general', label: 'App Settings', short: 'Settings', hint: 'Attendance window and batch defaults', Icon: SlidersHorizontal, Component: GeneralSettingsTab, requires: ['manage_templates'] },
  { key: 'history', label: 'Import Sabha History', short: 'Import', hint: 'Load past attendance from a sheet', Icon: FileSpreadsheet, Component: ImportHistoryTab, requires: ['import_data'] },
  { key: 'usage', label: 'Free Tier Usage', short: 'Usage', hint: 'Daily Firestore reads and writes', Icon: Gauge, Component: FirestoreUsageTab, requires: ['manage_users'] },
];

/**
 * One tool tile. Deliberately NOT a wrapping row of text tabs: nine of those
 * wrapped onto three ragged rows where nothing lined up, and an underlined tab
 * strip that has to scroll hides whatever is off-screen — the reason this screen
 * previously felt like it had four tools in it.
 */
function ToolTile({ tool, active, onClick }) {
  const { Icon } = tool;
  return (
    <button
      onClick={onClick}
      title={tool.hint}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group flex flex-col items-start gap-1.5 rounded-xl border px-2.5 py-2.5 text-left transition-colors sm:px-3',
        active
          ? 'border-orange-300 bg-orange-50/70 ring-1 ring-orange-100'
          : 'border-slate-100 bg-white hover:border-slate-200 hover:bg-slate-50',
      )}
    >
      <span
        className={cn(
          'flex h-7 w-7 items-center justify-center rounded-lg',
          active ? 'bg-orange-600 text-white' : 'bg-slate-100 text-slate-500 group-hover:text-slate-700',
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className={cn('text-[12px] font-semibold leading-tight sm:text-[13px]', active ? 'text-orange-900' : 'text-slate-800')}>
        {/* Short label on a phone, full label from sm up — "Import Sabha
            History" on a 3-column phone grid wraps to four lines. */}
        <span className="sm:hidden">{tool.short}</span>
        <span className="hidden sm:inline">{tool.label}</span>
      </span>
      <span className="hidden text-[11px] leading-snug text-slate-400 lg:block">{tool.hint}</span>
    </button>
  );
}

function AdminToolsInner() {
  const { hasAnyPermission } = usePermissions();
  const tabs = useMemo(
    () => TABS.filter((t) => !t.requires || hasAnyPermission(t.requires)),
    [hasAnyPermission],
  );

  const [active, setActive] = useState('integrity');
  const current = tabs.find((t) => t.key === active) || tabs[0];
  const ActiveComponent = current?.Component;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">Admin Tools</h1>
        <p className="mt-1 text-sm text-slate-500">
          {tabs.length} tools, all on this screen — pick one to work in.
        </p>
      </div>

      {/* Every tool visible at once: 3 across on a phone, 5 on a desktop, so nine
          tools are three short rows or two — never a scroll strip that hides
          whichever tool you were looking for. */}
      <div className="mb-5 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5 sm:mb-6">
        {tabs.map((t) => (
          <ToolTile key={t.key} tool={t} active={current?.key === t.key} onClick={() => setActive(t.key)} />
        ))}
      </div>

      {/* Names the open tool: with the picker above being a grid of equals rather
          than a tab strip, the orange tile alone is a weak "you are here". */}
      {current && (
        <div className="mb-4 flex items-center gap-2 border-b border-slate-100 pb-3">
          <current.Icon className="h-4 w-4 shrink-0 text-orange-600" />
          <h2 className="text-[15px] font-semibold text-slate-900">{current.label}</h2>
          <span className="hidden truncate text-xs text-slate-400 sm:block">· {current.hint}</span>
        </div>
      )}

      {ActiveComponent && <ActiveComponent />}
    </div>
  );
}

export default function AdminToolsPage() {
  return (
    // `import_data` is in the gate as well as on its own tab: a role that can
    // import history but has none of the other four permissions could otherwise
    // never reach the page holding the importer.
    <RequirePermission anyOf={['view_all_contacts', 'manage_users', 'send_emails', 'manage_templates', 'import_data']} fallback={<div className="p-6 text-sm text-slate-500">You don't have permission to view admin tools.</div>}>
      <AdminToolsInner />
    </RequirePermission>
  );
}
