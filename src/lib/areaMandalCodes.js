// src/lib/areaMandalCodes.js
// Short-code tables, ported verbatim from your real Areas/Mandal sheets
// (BAPS_All_Sampark_Web_Automation_Testing.xlsx). Seeded into Firestore's
// `areas`/`mandals` collections by 04-seed-areas-mandals.js — this file is
// the fallback/reference copy used by the seed script and as a client-side
// default if those collections haven't loaded yet.

export const DEFAULT_AREAS = [
  { name: 'Sector -9', code: 'C9' },
  { name: 'Chitrakoot Mix', code: 'CM' },
  { name: 'Panchyawala', code: 'PW' },
  { name: 'Vaishali Nagar', code: 'VN' },
  { name: 'Govind Nagar', code: 'GN' },
  { name: 'Sanjay Nagar', code: 'SN' },
  { name: 'Moti Nagar', code: 'MN' },
  { name: 'Sanganer', code: 'SG' },
  { name: 'Amer', code: 'AMR' },
  { name: 'Jhotwara', code: 'JW' },
  { name: 'Mansarovar', code: 'MS' },
  { name: 'Bindayaka', code: 'BND' },
  { name: 'Jagdishpuri', code: 'JPD' },
  { name: 'Old City', code: 'OC' },
  { name: 'Girnar Colony + Mahadev nagar', code: 'GM' },
  { name: 'Tonk Road', code: 'TR' },
  { name: 'Other', code: 'OTH' },
];

// MEMBER_FIELD_DEFS: the optional fields that a Mandal can choose to ask
// (or skip) when adding a member under it. Name and Mobile number are the
// only two always asked for every Mandal — they're the minimum needed to
// identify a person and aren't part of this customizable set. Everything
// below, including Photo, is toggled per-Mandal from the Areas & Mandals
// admin screen, the same way you'd pick which questions appear on a
// Google Form.
export const MEMBER_FIELD_DEFS = [
  { key: 'photo', label: 'Photo' },
  { key: 'dob', label: 'Date of birth' },
  { key: 'anniversary', label: 'Anniversary' },
  { key: 'relation', label: 'Relation to household head' },
  { key: 'isPrimary', label: 'Primary contact toggle' },
  { key: 'area', label: 'Area (for contacts without a household)' },
  { key: 'study', label: 'Study' },
  { key: 'profession', label: 'Profession' },
  { key: 'skill', label: 'Skill' },
  { key: 'samparkKaryakarta', label: 'Sampark Karyakarta (name & number)' },
];

// Two starter presets used only for seeding defaults / as a fallback when a
// Mandal doc has no `fields` map yet. Admins can flip any of these per
// Mandal afterwards — nothing here is hardcoded into the form logic itself.
export const FULL_MEMBER_FIELDS = { photo: true, dob: true, anniversary: true, relation: true, isPrimary: true, area: true, study: true, profession: true, skill: true, samparkKaryakarta: true };
export const MINIMAL_MEMBER_FIELDS = { photo: false, dob: false, anniversary: false, relation: false, isPrimary: false, area: false, study: false, profession: false, skill: false, samparkKaryakarta: false };

// Per your Male/Female Mandal split: Sanyukt, Yuvak, Bal ask everything;
// Mahila, Yuvati, Balika ask only Name + Mobile (address comes from the
// linked household). Haribhakt 1/2 aren't gendered in your structure, so
// they default to asking everything, same as before this change.
export const DEFAULT_MANDALS = [
  { name: 'Sanyukt Mandal', code: 'SM', gender: 'Male', fields: FULL_MEMBER_FIELDS },
  { name: 'Yuvak Mandal', code: 'YM', gender: 'Male', fields: FULL_MEMBER_FIELDS },
  { name: 'Bal Mandal', code: 'BM', gender: 'Male', fields: FULL_MEMBER_FIELDS },
  { name: 'Mahila Mandal', code: 'MM', gender: 'Female', fields: MINIMAL_MEMBER_FIELDS },
  { name: 'Yuvati Mandal', code: 'YTM', gender: 'Female', fields: MINIMAL_MEMBER_FIELDS },
  { name: 'Balika Mandal', code: 'BLM', gender: 'Female', fields: MINIMAL_MEMBER_FIELDS },
  { name: 'Haribhakt 1', code: 'HB1', gender: '', fields: FULL_MEMBER_FIELDS },
  { name: 'Haribhakt 2', code: 'HB2', gender: '', fields: FULL_MEMBER_FIELDS },
];

export const DEFAULT_LEVELS = [
  { name: '\u0917\u0941\u0928\u092d\u093e\u0935\u0940 - Gunbhavi', code: 'GB' },
  { name: 'Regular', code: 'REG' },
  { name: 'Active', code: 'ACT' },
];

/** Builds the legacy-style composite code: {seq}-{AreaCode}-{MandalCode}-{last4Phone} */
export function buildLegacyStyleCode(seq, areaCode, mandalCode, phone) {
  const last4 = String(phone || '').replace(/\D/g, '').slice(-4) || 'XXXX';
  return `${seq}-${areaCode || 'XX'}-${mandalCode || 'XX'}-${last4}`;
}
