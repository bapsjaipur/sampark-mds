// src/constants/balMandalConfig.js
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 30 — Bal Mandal (children's wing) configuration constants.
//
// Standard (grade) options, hobby options, and helper functions for the children's
// program management system running alongside the existing Yuvak (youth) system.
// ─────────────────────────────────────────────────────────────────────────────

export const STANDARDS = [
  'UKG',
  'LKG',
  '1st',
  '2nd',
  '3rd',
  '4th',
  '5th',
  '6th',
  '7th',
  '8th',
];

export const HOBBIES = [
  'Sports',
  'Music',
  'Dance',
  'Drawing',
  'Reading',
  'Cricket',
  'Football',
  'Singing',
  'Cooking',
  'Technology',
  'Photography',
  'Yoga',
  'Storytelling',
  'Arts & Crafts',
  'Gaming',
];

/**
 * Auto-assign mandal based on standard.
 * LKG/UKG/1st-4th → Sishu Mandal
 * 5th-8th → Bal Mandal
 */
export function getMandalForStandard(standard) {
  if (!standard) return 'Sishu Mandal';
  if (['LKG', 'UKG', '1st', '2nd', '3rd', '4th'].includes(standard)) return 'Sishu Mandal';
  if (['5th', '6th', '7th', '8th'].includes(standard)) return 'Bal Mandal';
  return 'Sishu Mandal'; // default
}

/**
 * Promote standard by one year.
 * Returns { standard: string, transferToYuvak: boolean }
 */
export function promoteStandard(current) {
  const idx = STANDARDS.indexOf(current);
  if (idx === -1) return { standard: current, transferToYuvak: false };
  if (current === '8th') return { standard: '9th', transferToYuvak: true };
  return { standard: STANDARDS[idx + 1], transferToYuvak: false };
}

/**
 * Check if a mandal name is a Bal Mandal program.
 */
export function isBalMandalProgram(mandal) {
  if (!mandal) return false;
  const lower = mandal.toLowerCase();
  return lower.includes('bal mandal') || lower.includes('sishu mandal') || lower.includes('balika mandal');
}

/**
 * Check if a mandal name is a Yuvak program.
 */
export function isYuvakProgram(mandal) {
  if (!mandal) return false;
  const lower = mandal.toLowerCase();
  return lower.includes('kishore') || lower.includes('yuvak') || lower.includes('tarun') || lower.includes('yuvati');
}
