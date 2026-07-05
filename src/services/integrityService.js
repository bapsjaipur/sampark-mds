// src/services/integrityService.js
// Phase 14 — Data Integrity Dashboard logic. Pure functions over an
// already-loaded individuals array (same pattern as statsService.js) —
// no separate queries needed, the admin tools page already subscribes to
// the whole collection.

/** Groups individuals sharing the same 10-digit mobile number. Only phone
 * numbers matching the app's strict validation are considered — a blank
 * or malformed number isn't a "duplicate" of another blank one. */
export function findDuplicatePhones(individuals) {
  const byPhone = new Map();
  individuals.forEach((ind) => {
    const phone = ind.mobile;
    if (!phone || phone.length !== 10) return;
    if (!byPhone.has(phone)) byPhone.set(phone, []);
    byPhone.get(phone).push(ind);
  });
  return [...byPhone.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([phone, group]) => ({ phone, group }));
}

/** Flags individuals missing a valid phone number or a Mandal — the two
 * fields most load-bearing for the app's core features (calling flow needs
 * a phone; batch/reminder scoping needs a Mandal). */
export function findMissingInfo(individuals) {
  const missingPhone = individuals.filter((ind) => !ind.mobile || ind.mobile.length !== 10);
  const missingMandal = individuals.filter((ind) => !ind.mandal);
  return { missingPhone, missingMandal };
}
