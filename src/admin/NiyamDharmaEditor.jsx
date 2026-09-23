// src/admin/NiyamDharmaEditor.jsx
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 42 — admin editor for the Niyam Dharma Agna list: the daily-observance
// checkboxes (Tulsi Kanthi, Mala Jaap, Nitya Pooja, Ghar Sabha…) shown on every
// contact. Lives on the Areas & Mandals screen because that is where the admin
// already curates the app's vocabulary, and is gated on its own permission
// (manage_niyam_dharma) so it need not hand out the email/template power.
//
// Mirrors CallOutcomesTab, and for the same storage reasons:
//
//   • `key` is the literal string written into individuals.niyamDharma[].
//     Nothing stores a label, so editing the key of a niyam that contacts
//     already carry would orphan those rows. New rows let you set it (it
//     auto-fills from the label); saved rows show it read-only with a live count
//     of how many contacts hold it. The label stays editable — that is the
//     "change the spelling" the user asked for.
//
//   • Removing a niyam does NOT touch contacts already marked with it — the key
//     simply stops matching a checkbox. `enabled:false` is the softer option:
//     it hides the niyam from the form and dashboard while keeping the history.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, ChevronUp, ChevronDown, RotateCcw, AlertTriangle, Users, Sparkles } from 'lucide-react';
import { collection, getCountFromServer, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { DEFAULT_NIYAM_DHARMAS, normalizeNiyams, NIYAM_KEY_RE } from '../lib/niyamDharma';
import { saveSettings, describeSettingsError } from '../services/settingsService';
import { useSettings } from '../hooks/useSettings';
import { useAuth } from '../hooks/usePermissions';
import { useToast } from '../contexts/ToastContext';
import RequirePermission from '../components/RequirePermission';
import SettingsRulesBanner from '../components/admin-tools/SettingsRulesBanner';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input, Label } from '../components/ui/Input';
import Modal from '../components/ui/Modal';
import { cn } from '../lib/cn';

/** "Wears Tulsi Kanthi" → "wearsTulsiKanthi". Empty when the label has no Latin
 *  letters/digits at all (a purely Devanagari label) — the save step fills a
 *  fallback so the key is never blank. */
function slugifyKey(label) {
  const words = String(label || '').trim().split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (!words.length) return '';
  return words.map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())).join('');
}

function NiyamDharmaEditorInner() {
  const { settings, loading, readDenied } = useSettings('niyamDharma');
  const { volunteer } = useAuth();
  const { showToast } = useToast();

  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [usage, setUsage] = useState({});          // niyam key → contact count
  const [confirmDelete, setConfirmDelete] = useState(null);

  const saved = useMemo(() => normalizeNiyams(settings?.niyams), [settings?.niyams]);

  // Seed once — re-seeding on every snapshot would wipe an in-progress edit the
  // moment the admin's own save echoes back.
  useEffect(() => {
    if (!loading && !draft) setDraft(saved.map((n) => ({ ...n, _saved: true })));
  }, [loading, draft, saved]);

  // How many contacts currently carry each saved niyam. One array-contains
  // aggregation per niyam — getCountFromServer bills a single read for up to
  // 1000 docs, so this is ~4 reads on open, not a collection scan.
  useEffect(() => {
    let cancelled = false;
    if (!saved.length) return undefined;
    Promise.all(
      saved.map(async (n) => {
        try {
          const snap = await getCountFromServer(
            query(collection(db, 'individuals'), where('niyamDharma', 'array-contains', n.key)),
          );
          return [n.key, snap.data().count];
        } catch {
          return [n.key, null]; // count is a nicety; never block the editor
        }
      }),
    ).then((pairs) => { if (!cancelled) setUsage(Object.fromEntries(pairs)); });
    return () => { cancelled = true; };
  }, [saved.map((n) => n.key).join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = useMemo(() => {
    if (!draft) return false;
    const strip = (l) => l.map(({ key, label, enabled }) => ({ key, label, enabled: enabled !== false }));
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
    setDraft((d) => [...d, { key: '', label: '', enabled: true, _saved: false }]);
  }

  function removeRow(idx) {
    setDraft((d) => d.filter((_, i) => i !== idx));
    setConfirmDelete(null);
  }

  async function handleSave() {
    // Fill a fallback key for any new row whose label had no Latin characters,
    // so a Devanagari-only niyam still gets a stable identifier.
    const usedKeys = new Set();
    let fallbackN = 1;
    const cleaned = draft.map((r) => {
      let key = String(r.key || '').trim();
      if (!key) {
        do { key = `niyam${fallbackN++}`; } while (usedKeys.has(key) || draft.some((o) => o.key === key));
      }
      usedKeys.add(key);
      return { key, label: String(r.label || '').trim(), enabled: r.enabled !== false };
    });

    if (cleaned.length === 0) {
      showToast({ type: 'error', message: 'Add at least one niyam, or reset to the defaults.' });
      return;
    }
    const blankLabel = cleaned.find((r) => !r.label);
    if (blankLabel) {
      showToast({ type: 'error', message: 'Every niyam needs a label. Fill in the highlighted row or remove it.' });
      return;
    }
    const badKey = cleaned.find((r) => !NIYAM_KEY_RE.test(r.key));
    if (badKey) {
      showToast({ type: 'error', message: `The key "${badKey.key}" can only use letters, numbers and underscores.` });
      return;
    }
    const seen = new Set();
    const dupe = cleaned.find((r) => (seen.has(r.key) ? true : (seen.add(r.key), false)));
    if (dupe) {
      showToast({ type: 'error', message: `The key "${dupe.key}" is used twice. Keys must be unique.` });
      return;
    }

    setSaving(true);
    try {
      await saveSettings('niyamDharma', { niyams: cleaned }, volunteer?.id);
      setDraft(null); // re-seed from what actually landed
      showToast({ type: 'success', message: 'Niyam Dharma list saved. It updates on every contact immediately.' });
    } catch (err) {
      showToast({ type: 'error', message: describeSettingsError(err, readDenied) });
    } finally {
      setSaving(false);
    }
  }

  if (loading || !draft) return <p className="text-sm text-slate-400">Loading niyam list…</p>;

  const enabledCount = draft.filter((r) => r.enabled !== false && String(r.label || '').trim()).length;

  return (
    <div className="space-y-4">
      <SettingsRulesBanner show={readDenied} />

      <div>
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
          <Sparkles className="h-4 w-4 text-amber-500" /> Niyam Dharma Agna
        </h3>
        <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
          The daily observances shown as checkboxes on every contact — what each person keeps up (Tulsi Kanthi,
          Mala Jaap, Nitya Pooja, Ghar Sabha…). Re-spell a label freely; the key underneath is what is stored on
          the contact, so it is locked once saved. Turn a niyam <strong>off</strong> to hide it from the form and
          dashboard without losing the contacts already marked with it. Contacts carry these in the CSV export and
          the admin dashboard shows how many keep each one.
        </p>
        <p className="mt-1 text-[11px] text-slate-400">{enabledCount} shown on the contact form.</p>
      </div>

      {/* ── Rows ──────────────────────────────────────────────────────────── */}
      <div className="space-y-2">
        {draft.map((row, idx) => {
          const count = usage[row.key];
          const isNew = !row._saved;
          const blankNew = isNew && !String(row.label || '').trim();
          return (
            <Card key={`${row.key}-${idx}`} className={cn('p-3', blankNew && 'border-amber-200 bg-amber-50/40', row.enabled === false && 'opacity-60')}>
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

                <div className="min-w-0 flex-1 space-y-2.5">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label required>Label (shown to volunteers)</Label>
                      <Input
                        value={row.label}
                        onChange={(e) => patchRow(idx, isNew ? { label: e.target.value, key: slugifyKey(e.target.value) } : { label: e.target.value })}
                        placeholder="e.g. Wears Tulsi Kanthi"
                      />
                    </div>
                    <div>
                      <Label>Stored key</Label>
                      {isNew ? (
                        <Input
                          value={row.key}
                          onChange={(e) => patchRow(idx, { key: e.target.value })}
                          placeholder="auto from label"
                          className="font-mono text-[12px]"
                        />
                      ) : (
                        <div className="flex h-9 items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 px-2.5">
                          <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-slate-600">{row.key}</code>
                          {typeof count === 'number' && (
                            <span className="flex shrink-0 items-center gap-1 text-[11px] text-slate-400">
                              <Users className="h-3 w-3" /> {count}
                            </span>
                          )}
                        </div>
                      )}
                      <p className="mt-1 text-[11px] text-slate-400">
                        {isNew ? 'Set once — this is written to every contact who keeps it.' : 'Locked: contacts carry this. Edit the label instead.'}
                      </p>
                    </div>
                  </div>

                  <label className="flex w-fit items-center gap-2 text-xs font-medium text-slate-600">
                    <input
                      type="checkbox"
                      checked={row.enabled !== false}
                      onChange={(e) => patchRow(idx, { enabled: e.target.checked })}
                      className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    Shown on the contact form
                  </label>
                </div>

                <button
                  type="button"
                  onClick={() => (row._saved && usage[row.key] ? setConfirmDelete({ idx, row }) : removeRow(idx))}
                  aria-label="Remove niyam"
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
          <Plus className="h-3.5 w-3.5" /> Add niyam
        </Button>
        <Button
          variant="ghost" size="sm"
          onClick={() => setDraft(DEFAULT_NIYAM_DHARMAS.map((n) => ({ ...n, _saved: saved.some((s) => s.key === n.key) })))}
        >
          <RotateCcw className="h-3.5 w-3.5" /> Reset to defaults
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="accent" onClick={handleSave} disabled={saving || !dirty}>
          {saving ? 'Saving…' : 'Save niyam list'}
        </Button>
        {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
      </div>

      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title="Remove this niyam?"
        size="sm"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          <div className="text-sm text-slate-600">
            <p>
              <strong>{usage[confirmDelete?.row?.key]}</strong> contact
              {usage[confirmDelete?.row?.key] === 1 ? '' : 's'} currently keep
              “{confirmDelete?.row?.label}”.
            </p>
            <p className="mt-2">
              Removing it leaves those contacts untouched — they keep the record, but it disappears from the form
              and dashboard. If you only want to hide it for now, turn it <strong>off</strong> instead of removing it.
            </p>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Keep it</Button>
          <Button variant="danger" onClick={() => removeRow(confirmDelete.idx)}>Remove niyam</Button>
        </div>
      </Modal>
    </div>
  );
}

export default function NiyamDharmaEditor() {
  return (
    <RequirePermission
      permission="manage_niyam_dharma"
      fallback={<p className="text-sm text-slate-500">You don&apos;t have permission to edit the Niyam Dharma list.</p>}
    >
      <NiyamDharmaEditorInner />
    </RequirePermission>
  );
}
