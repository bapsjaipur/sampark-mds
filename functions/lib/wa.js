/**
 * functions/lib/wa.js
 * ─────────────────────────────────────────────────────────────────────────────
 * CommonJS port of the three functions from src/lib/whatsapp.js that the
 * birthday digest needs: normalizePhone, encodeWhatsAppText, fillTemplate.
 *
 * Duplicated rather than imported: `firebase deploy` only uploads the functions/
 * directory, so anything under src/ is simply absent at runtime — and src/ is
 * ESM while this codebase is CommonJS. KEEP IN SYNC with src/lib/whatsapp.js;
 * the encoder in particular is subtle (see the comment there).
 * ─────────────────────────────────────────────────────────────────────────────
 */

const DEFAULT_BIRTHDAY_TEMPLATE =
  'Jai Swaminarayan {{firstName}} \u{1F64F}\n\n'
  + 'Wishing you a very happy birthday! May Bapa bless you with good health, '
  + 'happiness and satsang always. \u{1F382}\u{1F338}\n\n'
  + '- BAPS Jaipur';

const DEFAULT_ANNIVERSARY_TEMPLATE =
  'Jai Swaminarayan {{firstName}} \u{1F64F}\n\n'
  + 'Wishing you both a very happy wedding anniversary! May Bapa keep your '
  + 'family blessed and united in satsang. \u{1F490}\n\n'
  + '- BAPS Jaipur';

const WA_SAFE_ASCII = /[A-Za-z0-9\-_.!~*'()]/;

function encodeWhatsAppText(text) {
  const s = String(text == null ? '' : text);
  let out = '';
  for (const unit of s.split('')) {
    const code = unit.charCodeAt(0);
    if (code > 127) out += unit;
    else if (WA_SAFE_ASCII.test(unit)) out += unit;
    else out += encodeURIComponent(unit);
  }
  return out;
}

function normalizePhone(mobile) {
  let digits = String(mobile == null ? '' : mobile).replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return digits.length === 10 ? digits : '';
}

function fillTemplate(template, contact = {}, extra = {}) {
  const name = String(contact.name || '').trim();
  const values = {
    name: name || 'ji',
    firstName: name.split(/\s+/)[0] || 'ji',
    mandal: String(contact.mandal || '').trim(),
    area: String(contact.area || '').trim(),
    volunteer: String(extra.volunteerName || '').trim(),
    event: String(extra.eventTitle || '').trim(),
    date: String(extra.eventDate || '').trim(),
    age: extra.age == null ? '' : String(extra.age),
    years: extra.years == null ? '' : String(extra.years),
  };

  return String(template || '')
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) =>
      (Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match))
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildWhatsAppUrl({ mobile, template, contact = {}, extra = {} }) {
  const digits = normalizePhone(mobile);
  if (!digits) return null;
  const body = fillTemplate(template || '', contact, extra);
  if (!body) return `https://wa.me/91${digits}`;
  return `https://wa.me/91${digits}?text=${encodeWhatsAppText(body)}`;
}

module.exports = {
  DEFAULT_BIRTHDAY_TEMPLATE,
  DEFAULT_ANNIVERSARY_TEMPLATE,
  encodeWhatsAppText,
  normalizePhone,
  fillTemplate,
  buildWhatsAppUrl,
};
