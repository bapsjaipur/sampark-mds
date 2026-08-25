// src/components/admin-tools/MessageTemplateTab.jsx
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 20 — edits the three WhatsApp message templates stored at
// settings/messageTemplate.
//
// Sevak Call kept its message text in a script constant, so changing a single
// word meant editing Apps Script and re-deploying — which in practice meant it
// never changed, and volunteers rewrote the message by hand every time. Making
// this a settings document is the point of the exercise; the preview beside each
// box exists so the {{placeholder}} syntax can be checked before it goes out
// over a few hundred chats.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react';
import { MessageSquare, Cake, Heart, RotateCcw } from 'lucide-react';
import {
  DEFAULT_WA_TEMPLATE,
  DEFAULT_BIRTHDAY_TEMPLATE,
  DEFAULT_ANNIVERSARY_TEMPLATE,
  TEMPLATE_PLACEHOLDERS,
  fillTemplate,
} from '../../lib/whatsapp';
import { saveSettings, describeSettingsError } from '../../services/settingsService';
import { useSettings } from '../../hooks/useSettings';
import { useAuth } from '../../hooks/usePermissions';
import { useToast } from '../../contexts/ToastContext';
import RequirePermission from '../RequirePermission';
import SettingsRulesBanner from './SettingsRulesBanner';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Label, Textarea } from '../ui/Input';

// A stand-in contact so the preview shows something recognisable rather than
// the literal tokens. Deliberately a full record — an empty one would hide the
// whitespace-collapsing that fillTemplate does.
const SAMPLE_CONTACT = { name: 'Rajesh Patel', mandal: 'Vaishali Nagar', area: 'Jaipur North' };
const SAMPLE_EXTRA = {
  volunteerName: 'Amit',
  eventTitle: 'Sunday Sabha',
  eventDate: 'Sun, 24 Aug',
  age: 32,
  years: 10,
};

const FIELDS = [
  {
    key: 'whatsappTemplate',
    fallback: DEFAULT_WA_TEMPLATE,
    Icon: MessageSquare,
    title: 'Sabha invitation',
    description: 'Used by the WhatsApp button on the calling screen and in the contact drawer.',
  },
  {
    key: 'birthdayTemplate',
    fallback: DEFAULT_BIRTHDAY_TEMPLATE,
    Icon: Cake,
    title: 'Birthday wish',
    description: 'Used by the reminders screen and the links in the morning birthday email.',
  },
  {
    key: 'anniversaryTemplate',
    fallback: DEFAULT_ANNIVERSARY_TEMPLATE,
    Icon: Heart,
    title: 'Anniversary wish',
    description: 'Same, for wedding anniversaries.',
  },
];

function MessageTemplateInner() {
  const { settings, loading, readDenied } = useSettings('messageTemplate');
  const { volunteer } = useAuth();
  const { showToast } = useToast();

  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);

  // Seed once. Re-seeding whenever the snapshot changes would discard what the
  // admin is mid-way through typing as soon as their own save comes back.
  useEffect(() => {
    if (settings && !draft) {
      setDraft({
        whatsappTemplate: settings.whatsappTemplate || DEFAULT_WA_TEMPLATE,
        birthdayTemplate: settings.birthdayTemplate || DEFAULT_BIRTHDAY_TEMPLATE,
        anniversaryTemplate: settings.anniversaryTemplate || DEFAULT_ANNIVERSARY_TEMPLATE,
      });
    }
  }, [settings, draft]);

  const dirty = useMemo(() => {
    if (!draft || !settings) return false;
    return FIELDS.some((f) => (draft[f.key] || '') !== (settings[f.key] || f.fallback));
  }, [draft, settings]);

  async function handleSave() {
    const empty = FIELDS.find((f) => !String(draft[f.key] || '').trim());
    if (empty) {
      showToast({ type: 'error', message: `${empty.title} cannot be empty. Use Reset to restore the default.` });
      return;
    }

    setSaving(true);
    try {
      await saveSettings('messageTemplate', {
        whatsappTemplate: draft.whatsappTemplate.trim(),
        birthdayTemplate: draft.birthdayTemplate.trim(),
        anniversaryTemplate: draft.anniversaryTemplate.trim(),
      }, volunteer?.id);
      setDraft(null); // re-seed from what was actually saved
      showToast({ type: 'success', message: 'Message templates saved.' });
    } catch (err) {
      showToast({ type: 'error', message: describeSettingsError(err, readDenied) });
    } finally {
      setSaving(false);
    }
  }

  if (loading || !draft) return <p className="text-sm text-slate-400">Loading templates…</p>;

  return (
    <div className="space-y-5">
      <SettingsRulesBanner show={readDenied} />

      <Card className="p-4">
        <h3 className="text-sm font-semibold text-slate-900">Placeholders</h3>
        <p className="mt-0.5 text-xs text-slate-500">
          These are filled in per contact when the message is sent. Anything else in double braces is left exactly as
          typed, so a misspelt token shows up in the preview instead of quietly disappearing.
        </p>
        <div className="mt-3 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
          {TEMPLATE_PLACEHOLDERS.map((p) => (
            <div key={p.token} className="flex items-baseline gap-2 text-xs">
              <code className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-orange-700">
                {p.token}
              </code>
              <span className="text-slate-500">{p.description}</span>
            </div>
          ))}
        </div>
      </Card>

      {FIELDS.map(({ key, fallback, Icon, title, description }) => (
        <Card key={key} className="p-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                <Icon className="h-4 w-4 text-slate-400" /> {title}
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">{description}</p>
            </div>
            <button
              onClick={() => setDraft((d) => ({ ...d, [key]: fallback }))}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Reset
            </button>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <div>
              <Label>Template</Label>
              <Textarea
                rows={7}
                value={draft[key]}
                onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                className="font-mono text-[13px]"
              />
            </div>
            <div>
              <Label>Preview</Label>
              {/* whitespace-pre-wrap so the blank lines the volunteer typed are
                  visible here — WhatsApp preserves them, and a template that
                  looks fine collapsed often reads as a wall of text on a phone. */}
              <div className="min-h-[7rem] whitespace-pre-wrap rounded-lg border border-emerald-100 bg-emerald-50/60 px-3 py-2 text-[13px] leading-relaxed text-slate-700">
                {fillTemplate(draft[key], SAMPLE_CONTACT, SAMPLE_EXTRA)}
              </div>
              <p className="mt-1 text-xs text-slate-400">
                Shown with a sample contact ({SAMPLE_CONTACT.name}).
              </p>
            </div>
          </div>
        </Card>
      ))}

      <div className="flex items-center gap-2">
        <Button variant="accent" onClick={handleSave} disabled={saving || !dirty}>
          {saving ? 'Saving…' : 'Save templates'}
        </Button>
        {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
      </div>
    </div>
  );
}

export default function MessageTemplateTab() {
  return (
    <RequirePermission
      permission="manage_templates"
      fallback={<p className="text-sm text-slate-500">You don&apos;t have permission to edit message templates.</p>}
    >
      <MessageTemplateInner />
    </RequirePermission>
  );
}
