// src/pages/AdminToolsPage.jsx — Attio redesign.
import { useState } from 'react';
import RequirePermission from '../components/RequirePermission';
import DataIntegrityTab from '../components/admin-tools/DataIntegrityTab';
import AuditTrailTab from '../components/admin-tools/AuditTrailTab';
import SyncDashboardTab from '../components/admin-tools/SyncDashboardTab';
import BackupRestoreTab from '../components/admin-tools/BackupRestoreTab';
import FollowUpTrackingTab from '../components/admin-tools/FollowUpTrackingTab';

const TABS = [
  { key: 'integrity', label: 'Data Integrity', Component: DataIntegrityTab },
  { key: 'audit', label: 'Audit Trail', Component: AuditTrailTab },
  { key: 'sync', label: 'Sync Dashboard', Component: SyncDashboardTab },
  { key: 'backup', label: 'Backup & Restore', Component: BackupRestoreTab },
  { key: 'followup', label: 'Follow-up Tracking', Component: FollowUpTrackingTab },
];

function AdminToolsInner() {
  const [active, setActive] = useState('integrity');
  const ActiveComponent = TABS.find((t) => t.key === active)?.Component;

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="mb-6 text-xl font-semibold text-slate-900 tracking-tight">Admin Tools</h1>
      <div className="mb-6 flex gap-1 border-b border-slate-100">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setActive(t.key)} className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${active === t.key ? 'border-orange-600 text-orange-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            {t.label}
          </button>
        ))}
      </div>
      {ActiveComponent && <ActiveComponent />}
    </div>
  );
}

export default function AdminToolsPage() {
  return (
    <RequirePermission anyOf={['view_all_contacts', 'manage_users', 'run_gas_sync']} fallback={<div className="p-6 text-sm text-slate-500">You don't have permission to view admin tools.</div>}>
      <AdminToolsInner />
    </RequirePermission>
  );
}
