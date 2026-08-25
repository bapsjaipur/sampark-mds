// src/components/admin-tools/SettingsRulesBanner.jsx
// Shown at the top of any Admin Tools tab whose settings document can't even be
// READ. Reading settings needs no permission — only a volunteers/{uid} record —
// so a denied read means the `match /settings/{docId}` block from Phase 20 isn't
// in the live ruleset yet. That is a one-command fix, but the raw Firestore
// message ("Missing or insufficient permissions.") points at roles instead, so
// admins go hunting through the Roles screen where everything already looks
// right. Saying it up front, before the person edits anything and loses their
// work to a failed save, is the point.
import { AlertTriangle } from 'lucide-react';

export default function SettingsRulesBanner({ show }) {
  if (!show) return null;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 sm:flex-row sm:items-start sm:gap-3 sm:p-4">
      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 sm:mt-0.5" />
      <div className="min-w-0 space-y-2">
        <p className="text-[13px] font-semibold text-amber-900">
          Security rules for this tab are not deployed yet
        </p>
        <p className="text-[13px] leading-relaxed text-amber-800">
          The <span className="font-medium">settings</span> collection can&apos;t be read, so anything you
          change here will fail to save. This is not a role or permission problem — reading these
          settings requires no permission at all. Someone with Firebase access needs to run this once
          from the project folder:
        </p>
        {/* break-all so the command never widens the card on a phone */}
        <code className="block break-all rounded border border-amber-200 bg-white px-2 py-1.5 text-[12px] text-slate-800">
          firebase deploy --only firestore:rules
        </code>
      </div>
    </div>
  );
}
