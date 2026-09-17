// src/services/integrityService.js
// Phase 14 — Data Integrity Dashboard logic. Pure functions over an
// already-loaded individuals array (same pattern as statsService.js) —
// no separate queries needed, the admin tools page already subscribes to
// the whole collection.
//
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 41 — DUPLICATES: "SAME NUMBER" IS NOT "SAME PERSON".
//
// findDuplicatePhones() below groups on the mobile number and nothing else. That
// was fine as a first pass and wrong as a definition, because in this data a
// shared number is the NORMAL case: a father, his wife and two sons on one
// handset is one family, four contacts, four real people. The old Duplicates tab
// presented that family as a duplicate group whose only affordance was "Delete
// this one" — so the honest reading of that screen was "delete three of these
// four people", and at least one person read it that way.
//
// What the operator actually has is TWO different problems wearing one label:
//
//   A FAMILY   same number, different names        → not a fault at all; listed
//                                                    separately, no delete button
//   A DUPLICATE the same human entered twice, usually
//               with the spelling drifting between
//               the two ("Murli Sahu" / "Murlidhar Shahu")
//                                                  → merge, keeping every trace
//
// Telling them apart needs a name comparison, and a name comparison here cannot
// be string equality. These names are Indic names written in Latin script by
// different people at different times, so the same person legitimately appears
// as Suresh/Sursh/Suresh Bhai/Shri Suresh, and the surname may be absent, first,
// or last. So: normalise honorifics away, fold the transliteration choices that
// carry no meaning (ph↔f, v↔w, sh↔s, doubled letters, e↔i, o↔u), sort the
// remaining tokens so word order stops mattering, and compare with an edit
// distance whose tolerance grows with the length of the name.
//
// Every result carries a CONFIDENCE, and nothing merges itself:
//   certain   same number AND the names fold to the same string (or within one
//             edit) — the ordinary "entered twice" case
//   likely    same number and a close name, or an exact name match on two
//             different numbers (one of them is usually stale)
//   possible  a close name on two different numbers — offered for a human to
//             look at, never pre-selected
//
// COST. Pure CPU over the contacts array that is already in memory; no reads. An
// all-pairs comparison of 3,000 contacts would be 4.5M edit distances, so the
// pairs are blocked by shared folded token first (two names that share no token
// at all are never compared) and over-large blocks are skipped — a surname block
// of 400 is not evidence of anything anyway.
// ─────────────────────────────────────────────────────────────────────────────

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

/** Members that belong to a household but have a blank `area` — the exact
 * set the 1.1 backfill (`backfillMemberAreas`) targets. Standalone contacts
 * (no `householdId`) are excluded: they have nowhere to inherit an area
 * from, so a blank area on them isn't a fixable inconsistency here. */
export function findMissingAreaInHousehold(individuals) {
  return individuals.filter((ind) => ind.householdId && (!ind.area || !String(ind.area).trim()));
}

// ─── Name normalisation ──────────────────────────────────────────────────────

// Dropped entirely: they are titles, not names, and they appear on one copy of a
// contact and not the other. "Pu"/"Pujya"/"Swami"/"Sant" show up on sadhu names
// in this data the same way "Shri" shows up on everyone else's.
const HONORIFICS = new Set([
  'shri', 'shree', 'sri', 'sree', 'smt', 'shrimati', 'shrmt',
  'kum', 'kumari', 'mr', 'mrs', 'ms', 'dr', 'prof',
  'pu', 'pujya', 'param', 'swami', 'sant', 'br', 'brahmachari', 'sadhu',
]);

// Stripped from the END of a token only, and only these four. They are suffixes
// of address rather than of name — "Sureshbhai" and "Suresh" are one person,
// written by two people. `kumar` is NOT in this list even though it behaves the
// same way in speech: it is also a given name on its own, and folding it would
// quietly merge "Manish Kumar" into "Manish".
const SUFFIX_RE = /(bhai|bhaiya|behn|ben|ji)$/;

/**
 * Folds the transliteration choices that carry no meaning in Latin-script Indic
 * names, so two spellings of one name land on one string. Aggressive by design:
 * its output is never shown to anyone, only compared.
 */
function foldToken(raw) {
  let t = raw;
  t = t.replace(/ph/g, 'f');            // Phulchand ↔ Fulchand
  t = t.replace(/[wv]/g, 'v');          // Vishal ↔ Wishal
  t = t.replace(/chh|ch/g, 'c');
  t = t.replace(/sh|s/g, 's');          // Sahu ↔ Shahu
  t = t.replace(/kh|k|q/g, 'k');
  t = t.replace(/gh|g/g, 'g');
  t = t.replace(/th|t/g, 't');
  t = t.replace(/dh|d/g, 'd');
  t = t.replace(/bh|b/g, 'b');
  t = t.replace(/jh|j|z/g, 'j');
  // Five Latin vowels collapse onto three, which is roughly the distinction the
  // source scripts actually make: Ramesh/Ramish, Mohan/Muhan, Gita/Geeta.
  t = t.replace(/aa|a/g, 'a');
  t = t.replace(/ee|ie|i|y|e/g, 'i');
  t = t.replace(/oo|ou|u|o/g, 'u');
  t = t.replace(/(.)\1+/g, '$1');       // Krishnna → Krishna
  return t;
}

/**
 * A name → its comparison key plus the folded tokens that key was built from.
 * Tokens are SORTED, so "Sahu Murli" and "Murli Sahu" produce the same key, and
 * joined without a separator, so "Murlisahu" does too.
 */
export function nameKey(name) {
  const tokens = String(name || '')
    .toLowerCase()
    .replace(/[^a-z\s]+/g, ' ')          // punctuation, digits, any stray script
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => !HONORIFICS.has(t))
    .map((t) => t.replace(SUFFIX_RE, '') || t)
    .map(foldToken)
    .filter(Boolean);
  return { key: [...tokens].sort().join(''), tokens };
}

/** Levenshtein, abandoned as soon as it is certain to exceed `max`. */
function editDistance(a, b, max) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = new Array(b.length + 1);
  const cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    cur[0] = i;
    let best = cur[0];
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    for (let j = 0; j <= b.length; j += 1) prev[j] = cur[j];
  }
  return prev[b.length];
}

/** How far two folded keys may drift and still be the same name. A one-letter
 *  difference means something quite different in "Om" than in "Ghanshyambhai". */
function tolerance(len) {
  if (len <= 5) return 1;
  if (len <= 9) return 2;
  return 3;
}

const RANK = { certain: 3, likely: 2, possible: 1 };

/**
 * Compares two contacts and returns { confidence, reason } or null.
 * Deliberately conservative: a disagreement that only a human can settle comes
 * back as `possible`, and a contradiction (two different dates of birth) comes
 * back as null however well the names match.
 */
function scorePair(a, b) {
  const ka = a._key;
  const kb = b._key;
  if (!ka.key || !kb.key) return null;

  const samePhone = Boolean(a.mobile) && a.mobile.length === 10 && a.mobile === b.mobile;
  const bothPhones = Boolean(a.mobile) && Boolean(b.mobile) && a.mobile.length === 10 && b.mobile.length === 10;

  // A stated, different date of birth is the one field in this data that is
  // never a spelling variant. Two Sureshes born on different days are two people
  // no matter how the names fold.
  if (a.dob && b.dob && a.dob !== b.dob) return null;

  const dist = editDistance(ka.key, kb.key, tolerance(Math.max(ka.key.length, kb.key.length)));
  const exact = dist === 0;
  const close = dist <= tolerance(Math.max(ka.key.length, kb.key.length));

  // "Murli" vs "Murli Sahu" — one record got the surname, the other didn't. The
  // edit distance between them is large (a whole token) but they are not far
  // apart as names, so a token-containment test catches what distance misses.
  const setA = new Set(ka.tokens);
  const setB = new Set(kb.tokens);
  const small = setA.size <= setB.size ? setA : setB;
  const large = small === setA ? setB : setA;
  const subset = small.size > 0 && [...small].every((t) => large.has(t)) && small.size < large.size;

  if (!exact && !close && !subset) return null;

  let confidence;
  let reason;
  if (samePhone) {
    if (exact) { confidence = 'certain'; reason = 'Same number, same name'; }
    else if (subset && !close) { confidence = 'certain'; reason = 'Same number, one name is missing a part'; }
    else if (dist <= 1) { confidence = 'certain'; reason = 'Same number, name differs by one letter'; }
    else { confidence = 'likely'; reason = 'Same number, name spelled differently'; }
  } else if (exact && bothPhones) {
    confidence = 'likely'; reason = 'Same name, two different numbers';
  } else if (exact) {
    confidence = 'likely'; reason = 'Same name, one has no number';
  } else if (subset && !close) {
    confidence = 'possible'; reason = 'One name is missing a part';
  } else {
    confidence = 'possible'; reason = 'Similar name, different number';
  }

  // Same roof, or the same household pointer, is corroboration; so is an equal
  // date of birth. Neither promotes a `possible` on its own to `certain` —
  // one step, so the top rung always needs the phone number behind it.
  const corroborated = (a.householdId && a.householdId === b.householdId)
    || (a.dob && a.dob === b.dob);
  if (corroborated && confidence === 'possible') {
    confidence = 'likely';
    reason += ' · same household';
  }

  // The other direction: nothing about them lines up except an approximate name.
  // Two different areas is a genuine argument that these are two people.
  if (confidence === 'possible' && a.area && b.area && a.area !== b.area) return null;

  return { confidence, reason };
}

// A folded token shared by more people than this is a surname, not a lead.
// Comparing inside such a block costs more than the block can possibly be worth.
const MAX_BLOCK = 120;

/**
 * The replacement for findDuplicatePhones as the Duplicates tab's data source.
 *
 * @param {Array} individuals   every contact already in memory
 * @returns {{ groups: Array, families: Array, compared: number }}
 *   groups   [{ id, confidence, reason, members[] }]  — ranked, strongest first
 *   families [{ phone, group[] }]                      — one number, several people
 *   compared how many pairs were actually scored (shown in the UI as a sanity
 *            check that blocking didn't quietly skip the whole dataset)
 */
export function findLikelyDuplicates(individuals) {
  const rows = (individuals || []).map((ind) => ({ ...ind, _key: nameKey(ind.name) }));

  // Dismissals live on the contact itself (`mergeIgnore: [otherId]`) and are
  // written on ONE side only — the lexicographically smaller id — so saying "not
  // a duplicate" costs one write instead of two. Both directions are checked.
  const ignored = new Set();
  rows.forEach((r) => {
    (r.mergeIgnore || []).forEach((other) => {
      ignored.add(r.id < other ? `${r.id}|${other}` : `${other}|${r.id}`);
    });
  });
  const isIgnored = (a, b) => ignored.has(a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`);

  // ── Blocking. A pair is only ever scored if it shares a folded name token or
  //    a phone number, which is the cheap necessary condition for every rule in
  //    scorePair().
  const blocks = new Map();
  const push = (k, row) => {
    if (!k) return;
    if (!blocks.has(k)) blocks.set(k, []);
    blocks.get(k).push(row);
  };
  rows.forEach((r) => {
    new Set(r._key.tokens).forEach((t) => push(`t:${t}`, r));
    if (r.mobile && r.mobile.length === 10) push(`p:${r.mobile}`, r);
  });

  const pairs = new Map();          // "a|b" → { a, b, confidence, reason }
  let compared = 0;
  blocks.forEach((block) => {
    if (block.length < 2 || block.length > MAX_BLOCK) return;
    for (let i = 0; i < block.length; i += 1) {
      for (let j = i + 1; j < block.length; j += 1) {
        const a = block[i];
        const b = block[j];
        if (a.id === b.id) continue;
        const pk = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
        if (pairs.has(pk)) continue;
        if (isIgnored(a, b)) { pairs.set(pk, null); continue; }
        compared += 1;
        const verdict = scorePair(a, b);
        pairs.set(pk, verdict ? { a, b, ...verdict } : null);
      }
    }
  });

  // ── Union–find, so A≈B and B≈C come out as one group of three rather than two
  //    overlapping pairs the operator has to merge twice.
  const parent = new Map();
  const find = (x) => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r);
    let c = x;
    while (parent.get(c) !== c) { const n = parent.get(c); parent.set(c, r); c = n; }
    return r;
  };
  const union = (x, y) => { const rx = find(x); const ry = find(y); if (rx !== ry) parent.set(rx, ry); };
  rows.forEach((r) => parent.set(r.id, r.id));

  const live = [...pairs.values()].filter(Boolean);
  live.forEach((p) => union(p.a.id, p.b.id));

  const byRoot = new Map();
  live.forEach((p) => {
    const root = find(p.a.id);
    if (!byRoot.has(root)) byRoot.set(root, { ids: new Set(), pairs: [] });
    const g = byRoot.get(root);
    g.ids.add(p.a.id); g.ids.add(p.b.id); g.pairs.push(p);
  });

  const rowById = new Map(rows.map((r) => [r.id, r]));
  const groups = [...byRoot.entries()].map(([root, g]) => {
    // The WEAKEST link sets the group's confidence. A group is a claim about all
    // of its members at once, and it is only as strong as its shakiest edge.
    const weakest = g.pairs.reduce((lo, p) => (RANK[p.confidence] < RANK[lo.confidence] ? p : lo), g.pairs[0]);
    const members = [...g.ids].map((id) => rowById.get(id)).filter(Boolean);
    return {
      id: root,
      confidence: weakest.confidence,
      reason: weakest.reason,
      members: members.sort((x, y) => String(x.name || '').localeCompare(String(y.name || ''))),
    };
  });

  groups.sort((x, y) => RANK[y.confidence] - RANK[x.confidence]
    || y.members.length - x.members.length
    || String(x.members[0]?.name || '').localeCompare(String(y.members[0]?.name || '')));

  // ── Families: one number, several people, and the names say they are not the
  //    same person. Shown so the number can be verified, never with a delete.
  const grouped = new Set();
  groups.forEach((g) => g.members.forEach((m) => grouped.add(m.id)));
  const families = findDuplicatePhones(rows)
    .map(({ phone, group }) => ({ phone, group: group.filter((m) => !grouped.has(m.id)) }))
    .filter(({ group }) => group.length > 1);

  return { groups, families, compared };
}
