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
import { useState, useEffect, useRef } from "react";
import { doc, collection, getDocs, query, orderBy } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { useAuth } from "../../hooks/usePermissions";
import PhotoUploader from "../photo/PhotoUploader";
import { MandalSelect, AreaSelect } from "../AreaMandalSelect";
import { useAreasAndMandals } from "../../hooks/useAreasAndMandals";
import { FULL_MEMBER_FIELDS } from "../../lib/areaMandalCodes";
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
    <div className="grid grid-cols-2 gap-4">
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
                    onChangeNumber(v.mobile || "");
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
          onChange={(e) => onChangeNumber(e.target.value)}
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
  address: "", relation: "member", isPrimary: false, profilePhotoURL: "",
  study: "", profession: "", skill: "",
  samparkKaryakartaName: "", samparkKaryakartaNumber: "",
  photoPending: false,
};

export default function IndividualForm({ individual, onSubmit, onCancel, withinHousehold = false, householdArea = "" }) {
  const isEdit = Boolean(individual);
  const { mandals } = useAreasAndMandals();
  const [form, setForm] = useState(() =>
    isEdit
      ? {
          name: individual.name || "", mobile: individual.mobile || "", dob: individual.dob || "",
          anniversary: individual.anniversary || "", mandal: individual.mandal || "", area: individual.area || "",
          address: individual.address || "", relation: individual.relation || "member",
          isPrimary: Boolean(individual.isPrimary), profilePhotoURL: individual.profilePhotoURL || "",
          study: individual.study || "", profession: individual.profession || "", skill: individual.skill || "",
          samparkKaryakartaName: individual.samparkKaryakartaName || "", samparkKaryakartaNumber: individual.samparkKaryakartaNumber || "",
          photoPending: Boolean(individual.photoPending),
        }
      : emptyForm
  );
  // Pre-generated so a photo can be uploaded before the individual doc
  // exists. Only needed when creating — on edit we already have a real id.
  const [draftId] = useState(() => (isEdit ? null : doc(collection(db, "individuals")).id));
  const photoId = isEdit ? individual.id : draftId;

  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const update = (field) => (e) => {
    const value = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  // What this Mandal asks. Falls back to "ask everything" if no Mandal is
  // selected yet, or if the selected Mandal has no `fields` config saved
  // (e.g. an older Mandal doc created before this feature existed).
  const selectedMandal = mandals.find((m) => m.name === form.mandal);
  const fieldsConfig = selectedMandal?.fields || FULL_MEMBER_FIELDS;
  const showArea = !withinHousehold && fieldsConfig.area;
  const showDob = fieldsConfig.dob;
  const showAnniversary = fieldsConfig.anniversary;
  const showRelation = fieldsConfig.relation;
  const showIsPrimary = fieldsConfig.isPrimary;
  const showStudy = fieldsConfig.study;
  const showProfession = fieldsConfig.profession;
  const showSkill = fieldsConfig.skill;
  const showPhoto = fieldsConfig.photo;
  const showSamparkKaryakarta = fieldsConfig.samparkKaryakarta;

  const validate = () => {
    const errs = {};
    if (!form.name.trim()) errs.name = "Name is required.";
    const mobileDigits = form.mobile.replace(/\D/g, "");
    if (!mobileDigits) errs.mobile = "Mobile number is required.";
    else if (mobileDigits.length !== 10) errs.mobile = "Enter exactly 10 digits, without +91.";
    if (withinHousehold && showRelation && !form.relation) errs.relation = "Select a relation.";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    const payload = {
      ...form,
      mobile: form.mobile.replace(/\D/g, ""),
      // Skipped/hidden fields shouldn't linger with stale values.
      // Inside a household, Area is never asked (the field is hidden) but the
      // member should still inherit the household's Area rather than saving
      // blank — that's the 1.1 fix. Standalone: use whatever was picked (if
      // this Mandal asks for Area at all), else blank.
      area: withinHousehold ? householdArea : showArea ? form.area : "",
      address: withinHousehold ? "" : form.address,
      dob: showDob ? form.dob : "",
      anniversary: showAnniversary ? form.anniversary : "",
      relation: withinHousehold && showRelation ? form.relation : "member",
      isPrimary: withinHousehold && showIsPrimary ? form.isPrimary : false,
      study: showStudy ? form.study : "",
      profession: showProfession ? form.profession : "",
      skill: showSkill ? form.skill : "",
      samparkKaryakartaName: showSamparkKaryakarta ? form.samparkKaryakartaName : "",
      samparkKaryakartaNumber: showSamparkKaryakarta ? form.samparkKaryakartaNumber : "",
      profilePhotoURL: showPhoto ? form.profilePhotoURL : "",
      // photoPending: true only when photo is expected but not yet uploaded
      photoPending: showPhoto && !form.profilePhotoURL ? Boolean(form.photoPending) : false,
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
        <MandalSelect value={form.mandal} onChange={update("mandal")} className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-300" />
        <p className="mt-1 text-xs text-slate-400">Choosing a Mandal decides what else gets asked below.</p>
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
          <Input value={form.address} onChange={update("address")} placeholder="e.g. 123, BAPS Street, Mansarovar" />
        </div>
      )}

      {(showDob || showAnniversary) && (
        <div className="grid grid-cols-2 gap-4">
          {showDob && <div><Label>Date of birth</Label><Input type="date" value={form.dob} onChange={update("dob")} /></div>}
          {showAnniversary && <div><Label>Anniversary</Label><Input type="date" value={form.anniversary} onChange={update("anniversary")} /></div>}
        </div>
      )}

      {showArea && (
        <div>
          <Label>Area</Label>
          <AreaSelect value={form.area} onChange={update("area")} className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-300" />
        </div>
      )}

      {(withinHousehold && (showRelation || showIsPrimary)) && (
        <div className="grid grid-cols-2 gap-4">
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
        <div className="grid grid-cols-2 gap-4">
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

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="accent" disabled={saving}>{saving ? "Saving…" : isEdit ? "Save changes" : "Add member"}</Button>
      </div>
    </form>
  );
}
