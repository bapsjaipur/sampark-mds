// src/lib/authHelpers.js
// Firebase Auth has no native "phone + password" provider — its phone
// option is OTP-only. The standard workaround: use the email/password
// provider under the hood, with a synthetic, non-deliverable email derived
// from the phone number. Karyekars only ever see/type their phone number;
// this conversion is entirely internal.

const EMAIL_DOMAIN = 'baps-jaipur-mds.local';

/** Converts a 10-digit phone number to the synthetic email Firebase Auth stores. */
export function phoneToSyntheticEmail(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return `${digits}@${EMAIL_DOMAIN}`;
}

export function isValidPhone(phone) {
  return /^\d{10}$/.test(String(phone || '').replace(/\D/g, ''));
}
