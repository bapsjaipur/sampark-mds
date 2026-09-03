// src/components/bal-mandal/VCFExportPanel.jsx
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 30 — VCF export with prefix/suffix options for Bal Mandal contacts.
//
// Allows Nirdeshak, Sanchalak, SK to export their scope's contacts as VCF with
// configurable name prefix/suffix showing Area, Sub-Area, or Mandal. Also
// available for Yuvak contacts.
//
// Example formats:
// - Prefix: [Sanganer] Rahul Patel
// - Suffix: Rahul Patel [Bal Mandal]
// - Both: [Sanganer] Rahul Patel [Bal Mandal]
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { Download } from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Label, Select } from '../ui/Input';
import Modal from '../ui/Modal';

function buildVCard(contact, prefixText, suffixText) {
  const displayName = [
    prefixText || '',
    contact.name,
    suffixText || '',
  ].filter(Boolean).join(' ').trim();

  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${displayName}`,
    `N:${contact.name};;;;`,
  ];

  if (contact.mobile) {
    lines.push(`TEL;TYPE=CELL:${contact.mobile}`);
  }

  if (contact.address) {
    lines.push(`ADR;TYPE=HOME:;;${contact.address};;;;`);
  }

  if (contact.area) {
    lines.push(`ORG:${contact.area}`);
  }

  lines.push('END:VCARD');
  return lines.join('\r\n');
}

export default function VCFExportPanel({ contacts = [], label = 'contacts' }) {
  const [open, setOpen] = useState(false);
  const [prefixOption, setPrefixOption] = useState('none');
  const [suffixOption, setSuffixOption] = useState('none');
  const [exporting, setExporting] = useState(false);

  function generateVCF() {
    if (contacts.length === 0) return;

    setExporting(true);

    const vcards = contacts.map(contact => {
      let prefix = '';
      let suffix = '';

      // Build prefix
      if (prefixOption === 'area' && contact.area) {
        prefix = `[${contact.area}]`;
      } else if (prefixOption === 'subArea' && contact.subArea) {
        prefix = `[${contact.subArea}]`;
      } else if (prefixOption === 'mandal' && contact.mandal) {
        prefix = `[${contact.mandal}]`;
      }

      // Build suffix
      if (suffixOption === 'area' && contact.area) {
        suffix = `[${contact.area}]`;
      } else if (suffixOption === 'subArea' && contact.subArea) {
        suffix = `[${contact.subArea}]`;
      } else if (suffixOption === 'mandal' && contact.mandal) {
        suffix = `[${contact.mandal}]`;
      }

      return buildVCard(contact, prefix, suffix);
    });

    const blob = new Blob([vcards.join('\r\n\r\n')], { type: 'text/vcard;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${label}-${Date.now()}.vcf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setExporting(false);
    setOpen(false);
  }

  return (
    <>
      <Button
        variant="secondary"
        onClick={() => setOpen(true)}
        disabled={contacts.length === 0}
      >
        <Download className="mr-1.5 h-3.5 w-3.5" />
        Export VCF ({contacts.length})
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title="Export VCF Contacts">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Export {contacts.length} contacts as VCF file with customizable name format. Imported contacts will show with prefix/suffix in your phone's address book.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Name Prefix</Label>
              <Select value={prefixOption} onChange={(e) => setPrefixOption(e.target.value)}>
                <option value="none">None</option>
                <option value="area">Area</option>
                <option value="subArea">Sub-Area</option>
                <option value="mandal">Mandal</option>
              </Select>
              <p className="mt-1 text-xs text-slate-400">
                Example: {prefixOption !== 'none' ? `[${prefixOption === 'area' ? 'Sanganer' : prefixOption === 'subArea' ? 'Sector-9' : 'Bal Mandal'}] ` : ''}Rahul Patel
              </p>
            </div>

            <div>
              <Label>Name Suffix</Label>
              <Select value={suffixOption} onChange={(e) => setSuffixOption(e.target.value)}>
                <option value="none">None</option>
                <option value="area">Area</option>
                <option value="subArea">Sub-Area</option>
                <option value="mandal">Mandal</option>
              </Select>
              <p className="mt-1 text-xs text-slate-400">
                Example: Rahul Patel{suffixOption !== 'none' ? ` [${suffixOption === 'area' ? 'Sanganer' : suffixOption === 'subArea' ? 'Sector-9' : 'Bal Mandal'}]` : ''}
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-medium text-slate-700">Preview</p>
            <p className="mt-1 text-sm text-slate-900">
              {prefixOption !== 'none' && `[${prefixOption === 'area' ? 'Area' : prefixOption === 'subArea' ? 'Sub-Area' : 'Mandal'}] `}
              Contact Name
              {suffixOption !== 'none' && ` [${suffixOption === 'area' ? 'Area' : suffixOption === 'subArea' ? 'Sub-Area' : 'Mandal'}]`}
            </p>
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={exporting}>
              Cancel
            </Button>
            <Button variant="primary" onClick={generateVCF} disabled={exporting}>
              {exporting ? 'Generating...' : `Generate VCF`}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
