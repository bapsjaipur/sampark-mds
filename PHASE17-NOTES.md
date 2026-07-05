# Phase 17 — Photo-on-add, simplified Household form, Mandal-driven Member form

## 1. Photo can be added the first time a member is created
Previously `PhotoUploader` needed a real Firestore doc id (`profile-photos/{individualId}.jpg`),
so `IndividualForm` only showed it in edit mode.

Fix: `IndividualForm` now generates the future doc id up front with
`doc(collection(db, 'individuals')).id` — no network call — before the person
is saved. `PhotoUploader` uploads to that id right away. On submit, the form
passes `{ ...data, id: draftId }`; `useIndividuals.createIndividual` and
`useAllContacts.createContact` now check for a preset `id` and `setDoc` to it
instead of letting `addDoc` generate a new one, so the Storage upload and the
Firestore doc end up with the same id.

**Known trade-off:** if someone uploads a photo then closes the modal without
saving, the photo stays in Storage under an id that's never written to
Firestore. Low-cost orphan (a few hundred KB), not cleaned up automatically —
flag if this needs a cleanup job later.

## 2. Household form simplified
`HouseholdForm` now only asks Address, Area, Level, Total Family Members,
Remark. Removed: the Mandal select (Mandal now lives on the individual, see
#3) and Sampark Karyakarta name/number.

Both retired fields are untouched in the schema — `updateDoc`/`addDoc` only
write the keys handed to them, so any household that already has
`samparkKaryakartaName`/`samparkKaryakartaNumber` set keeps that data; the
form just stops asking for it going forward. `household.mandal` display on
`HouseholdDetailPage` was left as-is for the same reason (harmless if empty).

## 3. Mandal-driven, customizable Add Member form
This is the "Google Forms, but per-Mandal" feature.

**Data model** (`mandals/{id}` docs, see `src/lib/areaMandalCodes.js`):
```
{
  name: string,
  code: string,
  gender: "Male" | "Female" | "",
  fields: { dob: bool, anniversary: bool, relation: bool, isPrimary: bool, area: bool }
}
```
Name, Mobile, and Photo are always asked — they're not part of `fields`.
`MEMBER_FIELD_DEFS` in `areaMandalCodes.js` is the single source of truth for
which optional fields exist; add a new one there + in `IndividualForm.jsx`'s
render if you need another customizable question later.

Default seed data (`DEFAULT_MANDALS`) now includes **Mahila Mandal** (was
missing before) and assigns Male → Sanyukt/Yuvak/Bal (ask everything),
Female → Mahila/Yuvati/Balika (ask only Name + Mobile), Haribhakt 1/2 →
ungendered, ask everything (unchanged behavior).

**Admin UI**: `AreasMandalsManager.jsx` — Mandals got their own table
(`MandalTable`) instead of reusing the generic `CodeTable`: a Gender
dropdown per row, and a checkbox row per Mandal for each optional field,
plus "Ask everything" / "Name & mobile only" one-click presets. Editing
these live-updates via `onSnapshot`, same as the rest of that screen.

**Member form**: `IndividualForm.jsx` now asks Mandal *first*. It looks up
the selected Mandal's `fields` (via `useAreasAndMandals`) and shows/hides
DOB, Anniversary, Relation, and the Primary-contact checkbox accordingly. If
no Mandal is picked yet, or an older Mandal doc has no `fields` map, it
defaults to showing everything (safe default — never silently hides a
question nobody chose to hide).

`Area` is a special case: it's only shown when **both** (a) the form isn't
being used inside a household (added a `withinHousehold` prop, set on the
`HouseholdDetailPage` call site) and (b) the selected Mandal's `fields.area`
is on — inside a household, address always comes from the household link,
per the original request.

## Migration for existing data
Nothing destructive ran. Existing Mandal docs in Firestore won't have a
`gender` or `fields` field until an admin sets them from the new Mandal
table UI (or you re-run the seed button, which only fires when the
collection is empty). Until then, `IndividualForm` falls back to "ask
everything" for those Mandals, so no fields silently disappear.

## Follow-up tweaks (same day)
- **Photo moved to the end of the form**, after every other field, and is
  now itself a per-Mandal checkbox (`fields.photo`) instead of always
  shown — so a Mandal can be "everything except photo," etc.
- **Added Study, Profession, Skill** as three more optional, per-Mandal
  fields (plain text inputs). These were previously collected nowhere in
  the app (see the old "Known limitations" note in the schema doc) and now
  round-trip into the GAS Sheet backup like any other field once a Mandal
  has them turned on.
- **Mobile number is now required**, exactly 10 digits, no country code.
  We strip all non-digit characters before checking length, so a pasted
  "+91 98765 43210" is rejected (12 digits after stripping) rather than
  silently truncated or accepted.

## Follow-up: Sampark Karyakarta moved to the individual level
Each individual can now have their own `samparkKaryakartaName` /
`samparkKaryakartaNumber` — another per-Mandal customizable field
(`fields.samparkKaryakarta`), same pattern as Study/Profession/Skill.

- If the person is marked **Primary**, the form shows a note that their
  Sampark Karyakarta represents the whole household by default.
- Any other member can still be given their **own, different** Sampark
  Karyakarta — it's per-individual, not inherited automatically.
- `HouseholdDetailPage` now derives the household-level "Sampark:" line
  shown at the top from whichever member has `isPrimary && samparkKaryakartaName`
  set, falling back to the old `household.samparkKaryakartaName` field for
  households saved before this change (that field is otherwise retired,
  see the schema doc).
- `IndividualCard` shows a member's own Sampark Karyakarta line when set.
