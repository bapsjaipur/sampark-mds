// src/components/admin-tools/CallOutcomesTab.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Admin-only editor for the outcome buttons on the calling screen.
//
// Before this, the seven outcomes were a hardcoded array in
// src/lib/callingStatuses.js — renaming one meant a code change, a build and a
// Vercel deploy, which in practice meant the wording never changed even when
// the karyekars asked for it. The list now lives at settings/callOutcomes.
//
// Two rules the UI enforces, both because of how the data is stored:
//
//   • `value` is the literal string written to individuals.status. Nothing
//     stores an outcome id, so editing the value of an outcome that contacts
//     already carry would orphan those rows. New rows let you set it; saved
//     rows show it read-only, with a live count of how many contacts hold it.
//
//   • Deleting an outcome does NOT touch the contacts already marked with it —
//     their status string simply stops matching a button, so it renders grey
//     and stays in reports. The usage count is shown on the delete confirm so
//     that is a decision, not a surprise.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react';
import {
  Plus, Trash2, ChevronUp, ChevronDown, RotateCcw, AlertTriangle, Users,
} from 'lucide-react';
import { collection, getCountFromServer, query, where } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import {
  DEFAULT_STATUS_CHIPS, COLOR_TOKENS, FOLLOW_UP_GROUPS, CALL_INTENTS,
  normalizeOutcomes, colorClassesForToken,
} from '../../lib/callingStatuses';
import { saveSettings, describeSettingsError } from '../../services/settingsService';
import { useSettings } from '../../hooks/useSettings';
import { useAuth } from '../../hooks/usePermissions';
import { useToast } from '../../contexts/ToastContext';
import RequirePermission from '../RequirePermission';
import SettingsRulesBanner from './SettingsRulesBanner';
import StatusChips from '../calling/StatusChips';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Input, Label, Select } from '../ui/Input';
import Modal from '../ui/Modal';
import { cn } from '../../lib/cn';

function CallOutcomesInner() {
  const { settings, loading, readDenied } = useSettings('callOutcomes');
  const { volunteer } = useAuth();
  const { showToast } = useToast();

  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [usage, setUsage] = useState({});          // status string → contact count
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [preview, setPreview] = useState('');

  const saved = useMemo(() => normalizeOutcomes(settings?.outcomes), [settings?.outcomes]);

  // Seed once. Re-seeding on every snapshot would wipe whatever the admin is
  // half-way through typing the moment their own save echoes back.
  useEffect(() => {
    if (!loading && !draft) setDraft(saved.map((o) => ({ ...o, _saved: true })));
  }, [loading, draft, saved]);

  // How many contacts currently hold each saved outcome. One aggregation query
  // per outcome — getCountFromServer bills a single read for up to 1000 docs,
  // so this is ~7 reads on tab open, not a full collection scan.
  useEffect(() => {
    let cancelled = false;
    if (!saved.length) return undefined;
    Promise.all(
      saved.map(async (o) => {
        try {
          const snap = await getCountFromServer(
            query(collection(db, 'individuals'), where('status', '==', o.value)),
          );
          return [o.value, snap.data().count];
        } catch {
          return [o.value, null]; // count is a nicety; never block the editor
        }
      }),
    ).then((pairs) => { if (!cancelled) setUsage(Object.fromEntries(pairs)); });
    return () => { cancelled = true; };
  }, [saved.map((o) => o.value).join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = useMemo(() => {
    if (!draft) return false;
    const strip = (l) => l.map(({ value, label, emoji, colorClass, followUp, intent }) => ({
      value, label, emoji, colorClass, followUp: followUp || null, intent: intent || null,
    }));
    return JSON.stringify(strip(draft)) !== JSON.stringify(strip(saved));
  }, [draft, saved]);

  function patchRow(idx, patch) {
    setDraft((d) => d.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  }

  function move(idx, delta) {
    setDraft((d) => {
      const next = [...d];
      const target = idx + delta;
      if (target < 0 || target >= next.length) return d;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }

  function addRow() {
    setDraft((d) => [...d, { value: '', label: '', emoji: '', colorClass: 'chip-slate', followUp: null, intent: null, _saved: false }]);
  }

  function removeRow(idx) {
    setDraft((d) => d.filter((_, i) => i !== idx));
    setConfirmDelete(null);
  }

  async function handleSave() {
    const cleaned = draft.map((r) => ({
      value: String(r.value || '').trim(),
      label: String(r.label || '').trim(),
      emoji: String(r.emoji || '').trim(),
      colorClass: r.colorClass,
      followUp: r.followUp || null,
      // Written explicitly, including the null, so normalizeOutcomes can tell
      // "the admin chose None" apart from "this document predates intent" — the
      // second case has to inherit the seeded default or the post-sabha review
      // reads every contact as unreachable. See the migration note there.
      intent: r.intent || null,
    }));

    if (cleaned.length === 0) {
      showToast({ type: 'error', message: 'Keep at least one outcome — volunteers cannot save a call without picking one.' });
      return;
    }
    // A blank value is the "no outcome selected" sentinel everywhere else in the
    // app, so an outcome carrying it would make a called contact look uncalled.
    const blank = cleaned.find((r) => !r.value);
    if (blank) {
      showToast({ type: 'error', message: 'Every outcome needs a saved value. Fill in the highlighted row or remove it.' });
      return;
    }
    const seen = new Set();
    const dupe = cleaned.find((r) => (seen.has(r.value) ? true : (seen.add(r.value), false)));
    if (dupe) {
      showToast({ type: 'error', message: `"${dupe.value}" is used twice. Values must be unique.` });
      return;
    }

    setSaving(true);
    try {
      await saveSettings('callOutcomes', { outcomes: cleaned.map((r) => ({ ...r, label: r.label || r.value })) }, volunteer?.id);
      setDraft(null); // re-seed from what actually landed
      showToast({ type: 'success', message: 'Call outcomes saved. Volunteers see the new buttons immediately.' });
    } catch (err) {
      showToast({ type: 'error', message: describeSettingsError(err, readDenied) });
    } finally {
      setSaving(false);
    }
  }

  if (loading || !draft) return <p className="text-sm text-slate-400">Loading outcomes…</p>;

  const previewOutcomes = draft
    .filter((r) => String(r.value || '').trim())
    .map((r) => ({ ...r, label: r.label || r.value }));

  return (
    <div className="space-y-5">
      <SettingsRulesBanner show={readDenied} />

      <Card className="p-4">
        <h3 className="text-sm font-semibold text-slate-900">How these are used</h3>
        <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
          These are the buttons a karyekar taps under <strong>Outcome</strong> on the calling screen. The saved value is
          written to the contact and appears in the contacts table, the admin dashboard and the nightly report, so keep the
          wording short. A “follow-up queue” puts the outcome behind one of the two filter chips at the top of the calling
          screen, so a volunteer can work through just those contacts. <strong>“Means for the sabha”</strong> is what turns
          each outcome into the after-the-sabha list — set it on every outcome that is really an answer to “will you come?”.
        </p>
      </Card>

      {/* ── Rows ──────────────────────────────────────────────────────────── */}
      <div className="space-y-3">
        {draft.map((row, idx) => {
          const count = usage[row.value];
          const isNew = !row._saved;
          return (
            <Card key={`${row.value}-${idx}`} className={cn('p-3 sm:p-4', isNew && !row.value.trim() && 'border-amber-200 bg-amber-50/40')}>
              <div className="flex items-start gap-2 sm:gap-3">
                {/* Reorder — buttons rather than drag so it works on a phone */}
                <div className="flex shrink-0 flex-col gap-1 pt-1">
                  <button
                    type="button" onClick={() => move(idx, -1)} disabled={idx === 0} aria-label="Move up"
                    className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-400 disabled:opacity-30 enabled:hover:bg-slate-50 enabled:hover:text-slate-600"
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button" onClick={() => move(idx, 1)} disabled={idx === draft.length - 1} aria-label="Move down"
                    className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-400 disabled:opacity-30 enabled:hover:bg-slate-50 enabled:hover:text-slate-600"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="min-w-0 flex-1 space-y-3">
                  <div className="grid gap-3 sm:grid-cols-[4.5rem_1fr]">
                    <div>
                      <Label>Emoji</Label>
                      <Input
                        value={row.emoji}
                        onChange={(e) => patchRow(idx, { emoji: e.target.value })}
                        maxLength={4}
                        placeholder="✅"
                        className="text-center text-base"
                      />
                    </div>
                    <div>
                      <Label required>Button label</Label>
                      <Input
                        value={row.label}
                        onChange={(e) => patchRow(idx, isNew ? { label: e.target.value, value: e.target.value } : { label: e.target.value })}
                        placeholder="e.g. Interested"
                      />
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label>Saved value</Label>
                      {isNew ? (
                        <Input
                          value={row.value}
                          onChange={(e) => patchRow(idx, { value: e.target.value })}
                          placeholder="Stored on the contact"
                        />
                      ) : (
                        <div className="flex h-9 items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 px-2.5">
                          <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-slate-600">{row.value}</code>
                          {typeof count === 'number' && (
                            <span className="flex shrink-0 items-center gap-1 text-[11px] text-slate-400">
                              <Users className="h-3 w-3" /> {count}
                            </span>
                          )}
                        </div>
                      )}
                      <p className="mt-1 text-[11px] text-slate-400">
                        {isNew
                          ? 'Set once — this exact text is written to every contact marked with it.'
                          : 'Locked: contacts already carry this text. Change the label above instead.'}
                      </p>
                    </div>
                    <div>
                      <Label>Follow-up queue</Label>
                      <Select
                        value={row.followUp || ''}
                        onChange={(e) => patchRow(idx, { followUp: e.target.value || null })}
                      >
                        <option value="">None</option>
                        {FOLLOW_UP_GROUPS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
                      </Select>
                    </div>
                    {/* PHASE 27 — what this outcome means for sabha attendance.
                        The post-sabha review crosses it against who actually
                        turned up, so it cannot be inferred from the label: an
                        outcome renamed to Gujarati still has to classify. */}
                    <div>
                      <Label>Means for the sabha</Label>
                      <Select
                        value={row.intent || ''}
                        onChange={(e) => patchRow(idx, { intent: e.target.value || null })}
                      >
                        <option value="">Nothing — not about attending</option>
                        {CALL_INTENTS.map((i) => <option key={i.key} value={i.key}>{i.label}</option>)}
                      </Select>
                      <p className="mt-1 text-[11px] text-slate-400">
                        Drives the “after the sabha” list — “said they will come” plus an empty seat is
                        the call worth making first.
                      </p>
                    </div>
                  </div>

                  <div>
                    <Label>Colour</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {COLOR_TOKENS.map((t) => (
                        <button
                          key={t.key}
                          type="button"
                          onClick={() => patchRow(idx, { colorClass: t.key })}
                          aria-label={t.label}
                          aria-pressed={row.colorClass === t.key}
                          title={t.label}
                          className={cn(
                            'h-7 w-7 rounded-full border-2 transition',
                            t.dot,
                            row.colorClass === t.key ? 'border-slate-900 scale-110' : 'border-transparent hover:scale-105',
                          )}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => (row._saved && usage[row.value] ? setConfirmDelete({ idx, row }) : removeRow(idx))}
                  aria-label="Remove outcome"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-300 hover:bg-rose-50 hover:text-rose-600"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </Card>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={addRow}>
          <Plus className="h-3.5 w-3.5" /> Add outcome
        </Button>
        <Button
          variant="ghost" size="sm"
          onClick={() => setDraft(DEFAULT_STATUS_CHIPS.map((o) => ({ ...o, _saved: saved.some((s) => s.value === o.value) })))}
        >
          <RotateCcw className="h-3.5 w-3.5" /> Reset to the original seven
        </Button>
      </div>

      {/* ── Live preview ──────────────────────────────────────────────────── */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-slate-900">Preview — mobile calling screen</h3>
        <p className="mt-0.5 mb-3 text-xs text-slate-500">
          Exactly what a karyekar will see, including unsaved edits. Tap one to check the selected state.
        </p>
        <div className="max-w-sm">
          <StatusChips value={preview} onChange={setPreview} size="lg" outcomes={previewOutcomes} />
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="accent" onClick={handleSave} disabled={saving || !dirty}>
          {saving ? 'Saving…' : 'Save outcomes'}
        </Button>
        {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
      </div>

      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title="Remove this outcome?"
        size="sm"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          <div className="text-sm text-slate-600">
            <p>
              <strong>{usage[confirmDelete?.row?.value]}</strong> contact
              {usage[confirmDelete?.row?.value] === 1 ? '' : 's'} are currently marked
              “{confirmDelete?.row?.label}”.
            </p>
            <p className="mt-2">
              Removing the button leaves those contacts untouched — they keep the status text and still appear in reports,
              but it will render grey and no volunteer can set it again.
            </p>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Keep it</Button>
          <Button variant="danger" onClick={() => removeRow(confirmDelete.idx)}>Remove button</Button>
        </div>
      </Modal>
    </div>
  );
}

export default function CallOutcomesTab() {
  return (
    <RequirePermission
      permission="manage_templates"
      fallback={<p className="text-sm text-slate-500">You don&apos;t have permission to edit the calling outcomes.</p>}
    >
      <CallOutcomesInner />
    </RequirePermission>
  );
}
