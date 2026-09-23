// src/components/individuals/IndividualForm.jsx — Attio redesign.
//
// UPDATED (per Manish's request):
// 1. Photo is asked LAST, after the other fields, and is itself now a
//    per-Mandal customizable checkbox (`fields.photo`) rather than always
//    shown — same treatment as DOB, Anniversary, etc.
// 2. Added Study, Profession, Skill as customizable per-Mandal fields
//    (previously not collected anywhere — see the "Known limitations"
//    note in 01-firestore-schema-v2.md, now resolved).
// 3. Mobile number is compulsory: exactly 10 digits, no +91/country code.
//    We strip all non-digit characters before validating, so pasting
//    "+91 98765 43210" is rejected (12 digits after stripping), not
//    silently accepted.
//
// Mandal is still asked first — it decides what else gets asked, read live
// off that Mandal's `fields` map (see AreasMandalsManager.jsx / the Mandal
// admin table) rather than anything hardcoded here.
//
// We still pre-generate the Firestore doc id up front (`draftId`) via
// `doc(collection(db,'individuals'))` regardless of whether Photo ends up
// being asked for this Mandal, so the id is stable and ready the moment the
// Photo field *is* shown (e.g. if the person switches Mandal mid-form).
import { useState, useEffect, useRef, useMemo } from "react";
import { doc, collection, getDocs, query, orderBy } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { useAuth } from "../../hooks/usePermissions";
import PhotoUploader from "../photo/PhotoUploader";
import { MandalSelect, AreaSelect, SubAreaSelect } from "../AreaMandalSelect";
import { useAreasAndMandals } from "../../hooks/useAreasAndMandals";
import { useNiyamDharma } from "../../hooks/useNiyamDharma";
import { writableMandals } from "../../lib/scope";
import { FULL_MEMBER_FIELDS, STANDARD_OPTIONS, HOBBY_OPTIONS } from "../../lib/areaMandalCodes";
import { getMandalForStandard } from "../../constants/balMandalConfig";
import { Input, Select, Label, FieldError } from "../ui/Input";
import { Button } from "../ui/Button";

// Sampark Karyakarta name input with volunteer autocomplete.
// Typing shows matching volunteers; selecting one auto-fills the mobile number.
// Free text still works — if no volunteer is chosen both fields stay editable.
function SamparkPicker({ name, number, onChangeName, onChangeNumber }) {
  const { volunteer: currentUser } = useAuth();
  const [volunteers, setVolunteers] = useState([]);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    Promise.all([
      getDocs(query(collection(db, "volunteers"), orderBy("name"))),
      getDocs(collection(db, "roles")),
    ]).then(([volSnap, roleSnap]) => {
      // Build a map of roleId → role name (lowercase) to filter out Santo role
      const rolesMap = new Map(roleSnap.docs.map((d) => [d.id, (d.data().name || "").toLowerCase()]));
      const all = volSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      // Exclude volunteers whose assigned role name contains "santo"
      const nonSanto = all.filter((v) => !rolesMap.get(v.roleRef)?.includes("santo"));
      const myAreas = currentUser?.assignedAreas || [];
      if (myAreas.length === 0) {
        setVolunteers(nonSanto);
      } else {
        setVolunteers(nonSanto.filter((v) => {
          const vAreas = v.assignedAreas || [];
          return vAreas.length === 0 || vAreas.some((a) => myAreas.includes(a));
        }));
      }
    });
  }, [currentUser?.id]);

  const filtered = volunteers.filter((v) =>
    v.name?.toLowerCase().includes(name.toLowerCase())
  );

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="relative" ref={ref}>
        <Label>Sampark Karyakarta name</Label>
        <Input
          value={name}
          onChange={(e) => { onChangeName(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Type name or pick volunteer…"
          autoComplete="off"
        />
        {open && filtered.length > 0 && (
          <ul className="absolute z-20 left-0 right-0 mt-0.5 max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg divide-y divide-slate-50">
            {filtered.slice(0, 8).map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  onMouseDown={() => {
                    onChangeName(v.name);
                    const cleanMobile = (v.mobile || "").replace(/\D/g, "");
                    onChangeNumber(cleanMobile);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-orange-50"
                >
                  <span className="font-medium text-slate-800">{v.name}</span>
                  {v.mobile && <span className="text-xs text-slate-400 ml-auto">{v.mobile}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <Label>Sampark Karyakarta number</Label>
        <Input
          value={number}
          onChange={(e) => onChangeNumber(e.target.value.replace(/\D/g, ""))}
          inputMode="numeric"
          maxLength={10}
          placeholder="10-digit mobile"
        />
      </div>
    </div>
  );
}

const RELATIONS = [
  { value: "head", label: "Head of household" },
  { value: "spouse", label: "Spouse" },
  { value: "member", label: "Family member" },
];

const emptyForm = {
  name: "", mobile: "", dob: "", anniversary: "", mandal: "", area: "",
  // subArea belongs here even though it was added later: the payload below reads
  // form.subArea, and without a key the value is `undefined`, which Firestore
  // rejects outright ("Unsupported field value: undefined") on any Mandal that
  // asks for Area.
  subArea: "",
  address: "", relation: "member", isPrimary: false, profilePhotoURL: "",
  study: "", profession: "", skill: "",
  samparkKaryakartaName: "", samparkKaryakartaNumber: "",
  photoPending: false,
  // PHASE 26 — on the follow-up calling list. New contacts default to ON: a
  // freshly-added person is precisely the one somebody should ring.
  // See services/callingPoolService.js for why absent also means on.
  callingPool: true,
  // PHASE 30 — Bal Mandal fields.
  standard: "",
  hobby: [],
  hobbyOther: "",
  // PHASE 42 — daily observances (niyam dharma agna). Array of enabled-niyam
  // keys. Always shown, not Mandal-gated — like callingPool.
  niyamDharma: [],
};

export default function IndividualForm({ individual, onSubmit, onCancel, withinHousehold = false, householdArea = "", householdAddress = "", initialValues = null }) {
  const isEdit = Boolean(individual);
  const { mandals } = useAreasAndMandals();
  const { enabled: niyamOptions } = useNiyamDharma();
  const { scope } = useAuth();

  // PHASE 31 — null for an admin (pick anything), otherwise the mandals this
  // person may actually file a contact under. The dropdown greys out the rest
  // rather than hiding them; see MandalSelect for why.
  const allowedMandals = useMemo(() => writableMandals(scope), [scope]);
  // A scoped creator starts on Bal Mandal when it is theirs — it is what they
  // add all day — falling back to whichever mandal they do hold. An admin still
  // starts blank: Mandal decides which of the fields below get asked, and
  // quietly pre-picking one for someone who can choose any is how contacts end
  // up filed in the wrong group.
  const defaultMandal = useMemo(() => {
    if (!allowedMandals || allowedMandals.length === 0) return "";
    return allowedMandals.find((n) => (n || "").toLowerCase() === "bal mandal") || allowedMandals[0];
  }, [allowedMandals]);

  const [form, setForm] = useState(() =>
    isEdit
      ? {
          name: individual.name || "", mobile: individual.mobile || "", dob: individual.dob || "",
          anniversary: individual.anniversary || "", mandal: individual.mandal || "", area: individual.area || "",
          subArea: individual.subArea || "",
          address: individual.address || "", relation: individual.relation || "member",
          isPrimary: Boolean(individual.isPrimary), profilePhotoURL: individual.profilePhotoURL || "",
          study: individual.study || "", profession: individual.profession || "", skill: individual.skill || "",
          samparkKaryakartaName: individual.samparkKaryakartaName || "", samparkKaryakartaNumber: individual.samparkKaryakartaNumber || "",
          photoPending: Boolean(individual.photoPending),
          // Absent means on — the 1000+ contacts that predate this field are all
          // on the list, which is what makes the feature migration-free.
          callingPool: individual.callingPool !== false,
          // PHASE 30 — Bal Mandal fields
          standard: individual.standard || "",
          hobby: Array.isArray(individual.hobby) ? individual.hobby : [],
          hobbyOther: individual.hobbyOther || "",
          // PHASE 42 — niyam dharma keys
          niyamDharma: Array.isArray(individual.niyamDharma) ? individual.niyamDharma : [],
        }
      // `initialValues` pre-fills a new record — e.g. the walk-in add on the
      // attendance screen seeds the sabha's own Mandal and Area, which are right
      // far more often than blank is. It wins over the scoped default for the
      // same reason: it knows the specific sabha, the default only knows the person.
      : { ...emptyForm, ...(initialValues || {}), mandal: initialValues?.mandal || defaultMandal }
  );
  // Pre-generated so a photo can be uploaded before the individual doc
  // exists. Only needed when creating — on edit we already have a real id.
  const [draftId] = useState(() => (isEdit ? null : doc(collection(db, "individuals")).id));
  const photoId = isEdit ? individual.id : draftId;

  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [mandalTouched, setMandalTouched] = useState(false);
  // Same guard as mandalTouched, for the same reason: the household's Area arrives
  // from an async getDoc, and seeding it must never overwrite a choice already made.
  const [areaTouched, setAreaTouched] = useState(false);

  // Seeds the default once, if the scope resolved after this form first rendered.
  // Guarded on `mandalTouched` so it can never fight a choice already made.
  useEffect(() => {
    if (isEdit || mandalTouched) return;
    if (defaultMandal && !form.mandal) setForm((prev) => ({ ...prev, mandal: defaultMandal }));
  }, [isEdit, mandalTouched, defaultMandal, form.mandal]);

  // Seeds the household's Area onto a member who has none of their own. The
  // household document is fetched asynchronously by the page above, so it can land
  // after this form has already rendered; without this, a member of a household
  // with an Area would still open showing an empty Area picker and saving would
  // look like it had blanked something.
  //
  // Only when the member's own Area is EMPTY. A contact who already carries an
  // Area — even one that differs from the household's — keeps it: that difference
  // is a decision somebody made, not a gap to fill.
  useEffect(() => {
    if (areaTouched || !withinHousehold || !householdArea) return;
    setForm((prev) => (prev.area ? prev : { ...prev, area: householdArea }));
  }, [areaTouched, withinHousehold, householdArea]);

  const update = (field) => (e) => {
    const value = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  // PHASE 42 — flip one niyam key on/off in the form's niyamDharma array.
  const toggleNiyam = (key) => {
    setForm((prev) => {
      const cur = Array.isArray(prev.niyamDharma) ? prev.niyamDharma : [];
      return { ...prev, niyamDharma: cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key] };
    });
  };

  // What this Mandal asks. Falls back to "ask everything" if no Mandal is
  // selected yet, or if the selected Mandal has no `fields` config saved
  // (e.g. an older Mandal doc created before this feature existed).
  const selectedMandal = mandals.find((m) => m.name === form.mandal);
  const fieldsConfig = selectedMandal?.fields || FULL_MEMBER_FIELDS;
  // PHASE 39 — AREA IS ASKED INSIDE A HOUSEHOLD TOO.
  //
  // This used to be `!withinHousehold && fieldsConfig.area`, so a contact who
  // belonged to a household simply had no Area control — the "Murli sahu" report.
  // The intent was sound (a member should follow their household rather than drift
  // away from it) but hiding the field achieved the opposite of what it looked
  // like: the value was never SHOWN, so nobody could tell whether it was set, and
  // a household with no Area of its own left every member blank and invisible to
  // batch generation, which groups by Area × Mandal.
  //
  // Now the field is always shown when the Mandal asks for one. Inside a household
  // it is SEEDED from the household and can be overridden per person — the common
  // case (a son studying in another area, a member filed under the area they
  // actually attend sabha in) that previously required editing the household and
  // moving everybody.
  const showArea = Boolean(fieldsConfig.area);
  const showDob = fieldsConfig.dob;
  const showAnniversary = fieldsConfig.anniversary;
  const showRelation = fieldsConfig.relation;
  const showIsPrimary = fieldsConfig.isPrimary;
  const showStudy = fieldsConfig.study;
  const showProfession = fieldsConfig.profession;
  const showSkill = fieldsConfig.skill;
  const showPhoto = fieldsConfig.photo;
  const showSamparkKaryakarta = fieldsConfig.samparkKaryakarta;
  // PHASE 30 — Bal Mandal fields
  const showStandard = fieldsConfig.standard;
  const showHobby = fieldsConfig.hobby;

  const validate = () => {
    const errs = {};
    if (!form.name.trim()) errs.name = "Name is required.";
    const mobileDigits = form.mobile.replace(/\D/g, "");
    if (!mobileDigits) errs.mobile = "Mobile number is required.";
    else if (mobileDigits.length !== 10) errs.mobile = "Enter exactly 10 digits, without +91.";
    // The dropdown already greys these out, but the Standard field auto-assigns a
    // Mandal (LKG → Sishu Mandal) and can land outside the writer's territory.
    // Better to say so here than to let Firestore reject the write as a
    // "permission denied" the karyakarta has no way to interpret.
    if (allowedMandals && !allowedMandals.includes(form.mandal)) {
      errs.mandal = form.mandal
        ? `${form.mandal} isn't assigned to you.`
        : "Choose one of your assigned mandals.";
    }
    if (withinHousehold && showRelation && !form.relation) errs.relation = "Select a relation.";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    // PHASE 39 — "hidden" must mean NOT ASKED, never DELETED.
    //
    // Every line below used to blank its field whenever the Mandal's `fields`
    // config had it switched off, and `profilePhotoURL` was the only exception —
    // with a comment giving the exact reason the rule is wrong: an edit made for
    // an unrelated purpose silently destroys a value nobody was shown and nobody
    // agreed to lose. A photo was singled out only because Storage cannot get it
    // back, but two of these fields are load-bearing in a way a photo is not:
    //
    //   • `area` — batch generation groups by Area × Mandal, so a blanked Area
    //     drops the contact out of every future batch for their pair.
    //   • `samparkKaryakartaNumber` — the join key My Contacts queries on, so
    //     blanking it removes the contact from their karyakarta's list.
    //
    // So on EDIT a hidden field keeps whatever is stored. On CREATE there is
    // nothing to keep and blank is still correct.
    const keep = (field) => (isEdit ? individual?.[field] || '' : '');
    const payload = {
      ...form,
      mobile: form.mobile.replace(/\D/g, ""),
      // Inside a household the member INHERITS the household's Area unless they
      // have been given one of their own — the picker above is seeded from it and
      // is free to differ. The `|| householdArea` is what stops a blank selection
      // from writing an empty Area onto a household member, which is exactly the
      // "members in a household with no Area" pile the integrity scan backfills:
      // the edit that emptied them looked like a routine phone-number fix.
      area: showArea
        ? (withinHousehold ? (form.area || householdArea || keep('area')) : form.area)
        : (withinHousehold ? (householdArea || keep('area')) : keep('area')),
      subArea: showArea ? (form.subArea || "") : keep('subArea'),
      address: withinHousehold ? "" : form.address,
      dob: showDob ? form.dob : keep('dob'),
      anniversary: showAnniversary ? form.anniversary : keep('anniversary'),
      relation: withinHousehold && showRelation ? form.relation : "member",
      isPrimary: withinHousehold && showIsPrimary ? form.isPrimary : false,
      study: showStudy ? form.study : keep('study'),
      profession: showProfession ? form.profession : keep('profession'),
      skill: showSkill ? form.skill : keep('skill'),
      samparkKaryakartaName: showSamparkKaryakarta ? form.samparkKaryakartaName : keep('samparkKaryakartaName'),
      samparkKaryakartaNumber: showSamparkKaryakarta
        ? form.samparkKaryakartaNumber.replace(/\D/g, "")
        : keep('samparkKaryakartaNumber'),
      // The original exception, now the rule — see the note above.
      profilePhotoURL: showPhoto ? form.profilePhotoURL : keep('profilePhotoURL'),
      // photoPending: true only when photo is expected but not yet uploaded
      photoPending: showPhoto && !form.profilePhotoURL ? Boolean(form.photoPending) : false,
      // Always a real boolean. Left as `undefined` Firestore would reject the
      // whole write; left off entirely the contact would read as on-the-list,
      // which is right by default but wrong the moment somebody ticks it off.
      callingPool: form.callingPool !== false,
      // PHASE 30 — Bal Mandal fields
      standard: showStandard ? form.standard : keep('standard'),
      // Not `keep()` — this one is an array, and '' would poison a field the Bal
      // Mandal screens map over.
      hobby: showHobby ? form.hobby : (isEdit ? individual?.hobby || [] : []),
      hobbyOther: showHobby ? form.hobbyOther : keep('hobbyOther'),
      // PHASE 42 — always shown (not Mandal-gated), so always taken from the
      // form. Array-safe: an '' here would poison the dashboard/CSV code that
      // maps over it, exactly like hobby above.
      niyamDharma: Array.isArray(form.niyamDharma) ? form.niyamDharma : [],
    };
    if (!isEdit) payload.id = draftId;
    const ok = await onSubmit(payload);
    setSaving(false);
    if (ok) onCancel();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label required>Mandal</Label>
        <MandalSelect
          value={form.mandal}
          onChange={(e) => { setMandalTouched(true); update("mandal")(e); }}
          allowed={allowedMandals}
          className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-300"
        />
        <p className="mt-1 text-xs text-slate-400">
          Choosing a Mandal decides what else gets asked below.
          {allowedMandals && allowedMandals.length > 0 && (
            <> You can add to {allowedMandals.join(" and ")} — the rest are greyed out.</>
          )}
        </p>
        <FieldError>{errors.mandal}</FieldError>
      </div>

      <div>
        <Label required>Full name</Label>
        <Input value={form.name} onChange={update("name")} error={errors.name} placeholder="e.g. Rajesh Patel" />
        <FieldError>{errors.name}</FieldError>
      </div>

      <div>
        <Label required>Mobile number</Label>
        <Input value={form.mobile} onChange={update("mobile")} error={errors.mobile} placeholder="10-digit number, no +91" inputMode="numeric" maxLength={10} />
        <FieldError>{errors.mobile}</FieldError>
      </div>

      {!withinHousehold && (
        <div>
          <Label>Address</Label>
          <Input
            value={form.address}
            onChange={update("address")}
            placeholder="e.g. 123, BAPS Street, Mansarovar"
          />
        </div>
      )}

      {withinHousehold && (
        <div className="rounded-lg bg-slate-50 p-3 border border-slate-200">
           <Label className="text-slate-500">Address (Inherited from Household)</Label>
           <p className="text-sm font-medium text-slate-800">{householdAddress || 'Address not set on household'}</p>
        </div>
      )}

      {(showDob || showAnniversary) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {showDob && <div><Label>Date of birth</Label><Input type="date" value={form.dob} onChange={update("dob")} /></div>}
          {showAnniversary && <div><Label>Anniversary</Label><Input type="date" value={form.anniversary} onChange={update("anniversary")} /></div>}
        </div>
      )}

      {showArea && (
        <div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Area</Label>
              <AreaSelect
                value={form.area}
                onChange={(e) => { setAreaTouched(true); setForm((prev) => ({ ...prev, area: e.target.value, subArea: "" })); }}
                className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-300"
              />
            </div>
            <div>
              <Label>Sub-area</Label>
              <SubAreaSelect
                  areaName={form.area}
                  value={form.subArea}
                  onChange={update("subArea")}
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-300"
              />
            </div>
          </div>

          {/* Inside a household, say where the value came from and offer the way
              back. The Area is the household's until somebody changes it here, and
              an override that cannot be undone in one tap is an override people
              are right to be nervous about. */}
          {withinHousehold && (
            <p className="mt-1.5 text-xs leading-snug text-slate-400">
              {householdArea ? (
                form.area === householdArea ? (
                  <>From the household — <span className="font-medium text-slate-500">{householdArea}</span>. Change it here to file this person under a different Area.</>
                ) : (
                  <>
                    <span className="font-medium text-amber-600">Different from the household</span>
                    {' '}(<span className="font-medium text-slate-500">{householdArea}</span>). Batches and reports will use the Area set here.
                    {' '}
                    <button
                      type="button"
                      onClick={() => { setAreaTouched(true); setForm((f) => ({ ...f, area: householdArea, subArea: "" })); }}
                      className="font-medium text-orange-600 underline-offset-2 hover:underline"
                    >
                      Use the household’s
                    </button>
                  </>
                )
              ) : (
                <>This household has no Area of its own yet, so there is nothing to inherit — pick one here, or set it on the household and every member picks it up.</>
              )}
            </p>
          )}
        </div>
      )}

      {/* PHASE 39 — say WHY the Area picker is not here. A missing field with no
          explanation reads as a bug. There is now only one reason for it: this
          Mandal does not ask for Area. (A household member used to be the other
          reason — that field is shown now, seeded from the household.) */}
      {!showArea && (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-snug text-slate-500">
          <span className="font-medium text-slate-600">Area isn’t asked here.</span>{' '}
          {form.mandal ? <><span className="font-medium text-slate-600">{form.mandal}</span> doesn’t</> : 'This Mandal doesn’t'}{' '}
          have Area switched on in Admin → Areas &amp; Mandals. Turn it on there if this Mandal should ask for one.
          {withinHousehold
            ? <> Until then this contact follows the household{householdArea ? <> — <span className="font-medium text-slate-600">{householdArea}</span></> : <>, which has no Area set either</>}.</>
            : isEdit && individual?.area
              ? <> Their saved Area (<span className="font-medium text-slate-600">{individual.area}</span>) is kept as-is when you save.</>
              : null}
        </p>
      )}

      {(withinHousehold && (showRelation || showIsPrimary)) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {showRelation && (
            <div>
              <Label required>Relation</Label>
              <Select value={form.relation} onChange={update("relation")} error={errors.relation}>
                {RELATIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </Select>
              <FieldError>{errors.relation}</FieldError>
            </div>
          )}
          {showIsPrimary && (
            <div>
              <Label>Primary contact</Label>
              <label className="flex items-center gap-2 pt-1.5 text-sm text-slate-600">
                <input type="checkbox" checked={form.isPrimary} onChange={update("isPrimary")} className="h-4 w-4 rounded accent-orange-600" />
                Mark as primary
              </label>
            </div>
          )}
        </div>
      )}

      {(showStudy || showProfession) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {showStudy && <div><Label>Study</Label><Input value={form.study} onChange={update("study")} placeholder="e.g. B.Com" /></div>}
          {showProfession && <div><Label>Profession</Label><Input value={form.profession} onChange={update("profession")} placeholder="e.g. Engineer" /></div>}
        </div>
      )}

      {showSkill && (
        <div>
          <Label>Skill</Label>
          <Input value={form.skill} onChange={update("skill")} placeholder="e.g. Singing, tabla, public speaking" />
        </div>
      )}

      {showStandard && (
        <div>
          <Label>Standard</Label>
          <Select
            value={form.standard}
            onChange={(e) => {
              const newStandard = e.target.value;
              const autoMandal = getMandalForStandard(newStandard);
              // Standard drives Mandal, so it counts as touching it — otherwise
              // the scoped default would seed itself back over the auto-assignment.
              setMandalTouched(true);
              setForm((f) => ({ ...f, standard: newStandard, mandal: autoMandal }));
            }}
          >
            <option value="">Select standard…</option>
            {STANDARD_OPTIONS.map((std) => (
              <option key={std} value={std}>{std}</option>
            ))}
          </Select>
          <p className="mt-1 text-xs text-slate-400">
            LKG/UKG/1st-4th auto-assigns Sishu Mandal, 5th-8th auto-assigns Bal Mandal.
          </p>
        </div>
      )}

      {showHobby && (
        <div>
          <Label>Hobby</Label>
          <Select
            multiple
            value={form.hobby}
            onChange={(e) => {
              const options = Array.from(e.target.selectedOptions, (opt) => opt.value);
              setForm((f) => ({ ...f, hobby: options }));
            }}
            className="h-auto min-h-[120px]"
          >
            {HOBBY_OPTIONS.map((h) => (
              <option key={h} value={h}>{h}</option>
            ))}
            <option value="Other">Other</option>
          </Select>
          <p className="mt-1 text-xs text-slate-400">
            Hold Ctrl (Windows) or Cmd (Mac) to select multiple hobbies.
          </p>
          {form.hobby.includes('Other') && (
            <div className="mt-3">
              <Label>Specify other hobby</Label>
              <Input
                value={form.hobbyOther}
                onChange={(e) => setForm((f) => ({ ...f, hobbyOther: e.target.value }))}
                placeholder="e.g. Gardening, Chess…"
              />
            </div>
          )}
        </div>
      )}

      {showSamparkKaryakarta && (
        <div>
          <SamparkPicker
            name={form.samparkKaryakartaName}
            number={form.samparkKaryakartaNumber}
            onChangeName={(v) => setForm((f) => ({ ...f, samparkKaryakartaName: v }))}
            onChangeNumber={(v) => setForm((f) => ({ ...f, samparkKaryakartaNumber: v }))}
          />
          <p className="mt-1 text-xs text-slate-400">
            {form.isPrimary
              ? "As the Primary contact, this Sampark Karyakarta represents the whole household by default."
              : "This person can have their own Sampark Karyakarta, separate from the household's Primary contact."}
          </p>
        </div>
      )}

      {showPhoto && (
        <div>
          <Label>Photo</Label>
          <PhotoUploader
            individualId={photoId}
            currentPhotoURL={form.profilePhotoURL}
            onUploaded={(url) => setForm((prev) => ({ ...prev, profilePhotoURL: url, photoPending: false }))}
          />
          {!form.profilePhotoURL && (
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-slate-500">
              <input
                type="checkbox"
                checked={form.photoPending}
                onChange={(e) => setForm((f) => ({ ...f, photoPending: e.target.checked }))}
                className="h-3.5 w-3.5 rounded accent-orange-600"
              />
              Add photo later (mark as pending)
            </label>
          )}
        </div>
      )}

      {/* ── Follow-up calling ────────────────────────────────────────────
          Not gated by the Mandal's field config: every contact is either rung
          in the weekly round or not, whatever else the Mandal asks for. */}
      <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
        <Label>Follow-up calling</Label>
        <label className="mt-1 flex cursor-pointer items-start gap-2.5 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={form.callingPool !== false}
            onChange={(e) => setForm((f) => ({ ...f, callingPool: e.target.checked }))}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 accent-orange-600"
          />
          <span>
            On the follow-up calling list
            <span className="mt-0.5 block text-xs leading-snug text-slate-400">
              {form.callingPool !== false
                ? "Included when batches are generated for weekly follow-up."
                : "Won’t be pulled into weekly batches. Stays on the roster with full history, and a once-a-year sweep (Batches → Generate → “Everyone on the roster”) still reaches them."}
            </span>
          </span>
        </label>
      </div>

      {/* PHASE 42 — Niyam Dharma Agna. Always shown (not Mandal-gated); the list
          of observances is admin-editable on the Areas & Mandals screen, so this
          renders whatever is enabled there. Hidden entirely when an admin has
          turned every niyam off. */}
      {niyamOptions.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
          <Label>Niyam Dharma Agna</Label>
          <p className="mb-2 text-xs leading-snug text-slate-400">
            Daily observances this person keeps up. Tick all that apply.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {niyamOptions.map((n) => {
              const checked = Array.isArray(form.niyamDharma) && form.niyamDharma.includes(n.key);
              return (
                <label key={n.key} className="flex cursor-pointer items-center gap-2.5 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleNiyam(n.key)}
                    className="h-4 w-4 shrink-0 rounded border-slate-300 accent-orange-600"
                  />
                  {n.label}
                </label>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="accent" disabled={saving}>{saving ? "Saving…" : isEdit ? "Save changes" : "Add member"}</Button>
      </div>
    </form>
  );
}
