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
import { useState } from "react";
import { doc, collection } from "firebase/firestore";
import { db } from "../../lib/firebase";
import PhotoUploader from "../photo/PhotoUploader";
import { MandalSelect, AreaSelect } from "../AreaMandalSelect";
import { useAreasAndMandals } from "../../hooks/useAreasAndMandals";
import { FULL_MEMBER_FIELDS } from "../../lib/areaMandalCodes";
import { Input, Select, Label, FieldError } from "../ui/Input";
import { Button } from "../ui/Button";

const RELATIONS = [
  { value: "head", label: "Head of household" },
  { value: "spouse", label: "Spouse" },
  { value: "member", label: "Family member" },
];

const emptyForm = {
  name: "", mobile: "", dob: "", anniversary: "", mandal: "", area: "",
  relation: "member", isPrimary: false, profilePhotoURL: "",
  study: "", profession: "", skill: "",
  samparkKaryakartaName: "", samparkKaryakartaNumber: "",
};

export default function IndividualForm({ individual, onSubmit, onCancel, withinHousehold = false }) {
  const isEdit = Boolean(individual);
  const { mandals } = useAreasAndMandals();
  const [form, setForm] = useState(() =>
    isEdit
      ? {
          name: individual.name || "", mobile: individual.mobile || "", dob: individual.dob || "",
          anniversary: individual.anniversary || "", mandal: individual.mandal || "", area: individual.area || "",
          relation: individual.relation || "member",
          isPrimary: Boolean(individual.isPrimary), profilePhotoURL: individual.profilePhotoURL || "",
          study: individual.study || "", profession: individual.profession || "", skill: individual.skill || "",
          samparkKaryakartaName: individual.samparkKaryakartaName || "", samparkKaryakartaNumber: individual.samparkKaryakartaNumber || "",
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
    if (showRelation && !form.relation) errs.relation = "Select a relation.";
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
      // Skipped fields shouldn't linger with stale/default values.
      area: showArea ? form.area : "",
      dob: showDob ? form.dob : "",
      anniversary: showAnniversary ? form.anniversary : "",
      relation: showRelation ? form.relation : "member",
      isPrimary: showIsPrimary ? form.isPrimary : false,
      study: showStudy ? form.study : "",
      profession: showProfession ? form.profession : "",
      skill: showSkill ? form.skill : "",
      samparkKaryakartaName: showSamparkKaryakarta ? form.samparkKaryakartaName : "",
      samparkKaryakartaNumber: showSamparkKaryakarta ? form.samparkKaryakartaNumber : "",
      profilePhotoURL: showPhoto ? form.profilePhotoURL : "",
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

      {(showRelation || showIsPrimary) && (
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
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Sampark Karyakarta name</Label><Input value={form.samparkKaryakartaName} onChange={update("samparkKaryakartaName")} /></div>
            <div><Label>Sampark Karyakarta number</Label><Input value={form.samparkKaryakartaNumber} onChange={update("samparkKaryakartaNumber")} inputMode="numeric" maxLength={10} /></div>
          </div>
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
          <PhotoUploader individualId={photoId} currentPhotoURL={form.profilePhotoURL} onUploaded={(url) => setForm((prev) => ({ ...prev, profilePhotoURL: url }))} />
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="accent" disabled={saving}>{saving ? "Saving\u2026" : isEdit ? "Save changes" : "Add member"}</Button>
      </div>
    </form>
  );
}
