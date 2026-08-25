// src/lib/whatsapp.js
// ─────────────────────────────────────────────────────────────────────────────
// Phase 20 — WhatsApp deep links with a configurable message template.
//
// MDS's calling screen already had a WhatsApp button, but it opened an EMPTY
// chat: `https://wa.me/91${digits}` with no ?text. The volunteer then had to
// type the invitation by hand, 40 times a session. Sevak Call did not have that
// problem — Code.gs had encodeWA_() and prefilled the message.
//
// Two pieces are ported here:
//   1. encodeWhatsAppText() — the selective encoder. encodeURIComponent() turns
//      an emoji into %F0%9F%99%8F, which several WhatsApp builds render as the
//      literal escape text instead of the glyph. The legacy encoder therefore
//      passes anything above U+007F through untouched and only escapes the
//      ASCII characters that would break a query string. Also correct for
//      Gujarati/Hindi text, which is why it matters here.
//   2. A {{placeholder}} template, editable by an admin at
//      settings/messageTemplate rather than hardcoded in the component.
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_WA_TEMPLATE =
  'Jai Swaminarayan {{name}} 🙏\n\n' +
  'This is {{volunteer}} from BAPS Jaipur. We are inviting you to the upcoming ' +
  'satsang sabha at our {{mandal}} mandal.\n\n' +
  'Would you be able to join us? 🌸';

// Used by the morning birthday/anniversary digest (functions/emailJobs.js) to
// build a one-tap WhatsApp link next to each name, and by the reminders screen.
// Separate from DEFAULT_WA_TEMPLATE because a sampark invitation and a birthday
// wish are not interchangeable — sending the invite text as a birthday message
// is exactly the mistake the legacy single-template setup invited.
export const DEFAULT_BIRTHDAY_TEMPLATE =
  'Jai Swaminarayan {{firstName}} 🙏\n\n' +
  'Wishing you a very happy birthday! May Bapa bless you with good health, ' +
  'happiness and satsang always. 🎂🌸\n\n' +
  '- BAPS Jaipur';

export const DEFAULT_ANNIVERSARY_TEMPLATE =
  'Jai Swaminarayan {{firstName}} 🙏\n\n' +
  'Wishing you both a very happy wedding anniversary! May Bapa keep your ' +
  'family blessed and united in satsang. 💐\n\n' +
  '- BAPS Jaipur';

// Characters encodeURIComponent() itself leaves alone. Kept explicit so the
// intent is readable rather than implied by a double negative.
const WA_SAFE_ASCII = /[A-Za-z0-9\-_.!~*'()]/;

/**
 * encodeWhatsAppText(text)
 *
 * Percent-encodes ONLY the ASCII characters that would break a URL query
 * string. Everything above U+007F — emoji, Devanagari, Gujarati — is emitted
 * raw. Surrogate pairs survive because both halves are >127 and are passed
 * through individually, reassembling into the original pair.
 */
export function encodeWhatsAppText(text) {
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

/**
 * normalizePhone(mobile) → bare 10-digit Indian number, or '' if unusable.
 *
 * Handles the four shapes that actually appear in the imported sheet data:
 * '9876543210', '+91 98765 43210', '09876543210', '919876543210'.
 */
export function normalizePhone(mobile) {
  let digits = String(mobile == null ? '' : mobile).replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return digits.length === 10 ? digits : '';
}

export const TEMPLATE_PLACEHOLDERS = [
  { token: '{{name}}', description: 'Contact’s full name' },
  { token: '{{firstName}}', description: 'Contact’s first name only' },
  { token: '{{mandal}}', description: 'Contact’s mandal' },
  { token: '{{area}}', description: 'Contact’s area' },
  { token: '{{volunteer}}', description: 'Your name (the signed-in volunteer)' },
  { token: '{{event}}', description: 'Upcoming event title, if one is passed in' },
  { token: '{{date}}', description: 'Upcoming event date, if one is passed in' },
  { token: '{{age}}', description: 'Age they are turning (birthday messages only)' },
  { token: '{{years}}', description: 'Years married (anniversary messages only)' },
];

/**
 * fillTemplate(template, contact, extra)
 *
 * Unknown placeholders are left verbatim so a typo is visible to the volunteer
 * before they send, rather than silently becoming an empty string. Known
 * placeholders with no value collapse to '' and the surrounding whitespace is
 * tidied, so "at our  mandal" does not appear when mandal is blank.
 */
export function fillTemplate(template, contact = {}, extra = {}) {
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
      Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match)
    // Collapse the runs of spaces / stray connectors left behind by empty values.
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * buildWhatsAppUrl({ mobile, template, contact, extra })
 *
 * Returns null when the number can't be normalised — callers should disable the
 * button rather than open wa.me with a broken number, which shows an unhelpful
 * "phone number shared via link is not on WhatsApp" page.
 */
export function buildWhatsAppUrl({ mobile, template, contact = {}, extra = {} }) {
  const digits = normalizePhone(mobile);
  if (!digits) return null;
  const body = fillTemplate(template || DEFAULT_WA_TEMPLATE, contact, extra);
  if (!body) return `https://wa.me/91${digits}`;
  return `https://wa.me/91${digits}?text=${encodeWhatsAppText(body)}`;
}

/** tel: link with the same normalisation, so Call and WhatsApp never disagree. */
export function buildTelUrl(mobile) {
  const digits = normalizePhone(mobile);
  return digits ? `tel:+91${digits}` : null;
}
