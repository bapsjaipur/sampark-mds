// src/pages/IndividualDetailPage.jsx — individual profile.
//
// Live (onSnapshot) rather than a one-shot getDoc: the Edit button writes to the
// same document, and the sabha-attendance panel below is live too, so a
// one-shot read would leave the header showing stale values right after a save.
//
// PHASE 38 — TWO things this page got wrong, both reported as "loopholes".
//
//  1. It read individuals/{id} with NO scope check, and firestore.rules permits
//     that read: canReadIndividual() takes no data argument, so only WRITES are
//     scoped server-side. Any signed-in volunteer holding a contact id — from a
//     stale link, a bookmark, or a guess — saw the whole profile: mobile, date of
//     birth, profession, attendance history. The area/mandal boundary that the
//     Contacts list has always applied simply stopped at the list. It is applied
//     here now, at the point the record is actually read.
//
//  2. "All contacts" was a hardcoded link to /contacts. A Sampark Karyakarta who
//     arrived from My Calling was sent to a browse-everything list instead of back
//     to the queue they were working. Callers now pass `state.from`, so Back
//     returns where you came from.
//
// The client guard is the honest fix for the screen, not for the database: a
// determined reader can still fetch the document until firestore.rules scopes
// `individuals` read the way it already scopes write. That change is a separate,
// deploy-gated step — see the note in firestore.rules.
import { useState, useEffect } from "react";
import { useParams, useLocation, Link } from "react-router-dom";
import { ArrowLeft, X, Home, Pencil, Phone, MessageCircle, ShieldAlert } from "lucide-react";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { db } from "../lib/firebase";
import { formatDate } from "../lib/dateHelpers";
import { buildTelUrl, buildWhatsAppUrl, normalizePhone } from "../lib/whatsapp";
import { saveContact } from "../services/contactService";
import { useAuth } from "../hooks/usePermissions";
import { matchesScope } from "../lib/scope";
import { useToast } from "../contexts/ToastContext";
import { useCallOutcomes } from "../hooks/useCallOutcomes";
import { useSettings } from "../hooks/useSettings";
import { useVolunteerIdentity } from "../hooks/useVolunteerIdentity";
import { VolunteerBadge, VolunteerRing } from "../components/ui/VolunteerBadge";
import RequirePermission from "../components/RequirePermission";
import IndividualForm from "../components/individuals/IndividualForm";
import AttendanceHistoryPanel from "../components/events/AttendanceHistoryPanel";
import BalMandalNotesPanel from "../components/bal-mandal/BalMandalNotesPanel";
import Modal from "../components/ui/Modal";
import { Avatar } from "../components/ui/Avatar";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { cn } from "../lib/cn";

function Field({ label, value }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm text-slate-800">{value}</p>
    </div>
  );
}

function PhotoLightbox({ src, name, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <button onClick={onClose} className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20">
        <X className="h-5 w-5" />
      </button>
      <img
        src={src}
        alt={name}
        className="max-h-[90vh] max-w-full rounded-lg object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

export default function IndividualDetailPage() {
  const { id } = useParams();
  const location = useLocation();
  const { volunteer, scope } = useAuth();
  const { showToast } = useToast();
  const { colorClasses, emoji } = useCallOutcomes();
  const { settings: templateSettings } = useSettings("messageTemplate");
  const { identify } = useVolunteerIdentity();
  const [individual, setIndividual] = useState(null);
  const [household, setHousehold] = useState(null);
  // Settled, not "truthy": an out-of-area household is a permission-denied read
  // that leaves `household` null for good. Waiting on the value itself would then
  // wait forever, and the scope check below would never run.
  const [householdSettled, setHouseholdSettled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  // Where Back goes. Whoever linked here says so; /contacts is the fallback for
  // the pages that link plainly (and for a bookmarked or shared URL).
  const backTo = location.state?.from || "/contacts";
  const backLabel = location.state?.fromLabel || "All contacts";

  useEffect(() => {
    setLoading(true);
    return onSnapshot(
      doc(db, "individuals", id),
      (snap) => {
        setIndividual(snap.exists() ? { id: snap.id, ...snap.data() } : null);
        setLoading(false);
      },
      (err) => { console.error("Error loading contact:", err); setLoading(false); },
    );
  }, [id]);

  // Separate effect keyed on householdId only, so an unrelated edit (a phone
  // number, a status) doesn't refetch the household document.
  useEffect(() => {
    if (!individual?.householdId) { setHousehold(null); setHouseholdSettled(true); return; }
    setHouseholdSettled(false);
    getDoc(doc(db, "households", individual.householdId))
      .then((snap) => setHousehold(snap.exists() ? { id: snap.id, ...snap.data() } : null))
      .catch((err) => console.error("Error loading household:", err))
      .finally(() => setHouseholdSettled(true));
  }, [individual?.householdId]);

  async function handleSave(payload) {
    const ok = await saveContact({ individualId: id, data: payload, volunteerId: volunteer?.id });
    showToast(ok
      ? { type: "success", message: `${payload.name || "Contact"} updated.` }
      : { type: "error", message: "Couldn’t save changes. Check your permissions and try again." });
    return ok;
  }

  if (loading) {
    return <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-16"><div className="h-48 animate-pulse rounded-lg bg-slate-100" /></div>;
  }

  if (!individual) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 text-center sm:px-6 sm:py-16">
        <p className="text-slate-400">Contact not found.</p>
        <Link to={backTo} className="mt-2 inline-block text-sm text-orange-600 hover:underline">← {backLabel}</Link>
      </div>
    );
  }

  /**
   * The scope check. A contact's area is their own field when they have one and
   * the parent household's otherwise — individualScopeArea's rule, inlined here
   * because this page holds one household rather than a map of them.
   *
   * A household member with no denormalised area cannot be judged until that
   * household has been fetched, so the skeleton stays up until it settles. That
   * wait is bounded: the fetch resolves or rejects, and either way it settles.
   */
  const scopeArea = individual.area || household?.area || null;
  if (!scopeArea && individual.householdId && !householdSettled) {
    return <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-16"><div className="h-48 animate-pulse rounded-lg bg-slate-100" /></div>;
  }

  if (!matchesScope(scope, { area: scopeArea, mandal: individual.mandal || null })) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 text-center sm:px-6 sm:py-16">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
          <ShieldAlert className="h-5 w-5 text-slate-400" />
        </div>
        <p className="font-medium text-slate-700">This contact isn’t in your list</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-slate-400">
          Your role covers certain areas and mandals, and this person isn’t in them.
          Ask an admin if they should be assigned to you.
        </p>
        <Link to={backTo} className="mt-3 inline-block text-sm text-orange-600 hover:underline">← {backLabel}</Link>
      </div>
    );
  }

  const RELATION_LABEL = { head: "Head of household", spouse: "Spouse", member: "Family member" };
  const sevak = identify(individual);
  const phone = normalizePhone(individual.mobile);
  const waUrl = buildWhatsAppUrl({
    mobile: individual.mobile,
    template: templateSettings?.whatsappTemplate,
    contact: individual,
    extra: { volunteerName: volunteer?.name },
  });

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-8">
      <Link to={backTo} className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-600">
        <ArrowLeft className="h-3.5 w-3.5" /> {backLabel}
      </Link>

      <Card className={cn("mt-4 p-4 sm:p-6", sevak && "border-indigo-200 bg-indigo-50/40")}>
        {/* Header row — stacks the name under the photo on a narrow phone */}
        <div className="flex items-start gap-4 sm:gap-5">
          <button
            onClick={() => individual.profilePhotoURL && setLightbox(true)}
            className={cn("shrink-0", individual.profilePhotoURL ? "cursor-zoom-in" : "cursor-default")}
            aria-label={individual.profilePhotoURL ? "View full-size photo" : undefined}
          >
            <VolunteerRing active={Boolean(sevak)}>
              {individual.profilePhotoURL ? (
                <img
                  src={individual.profilePhotoURL}
                  alt={individual.name}
                  className="h-16 w-16 rounded-full object-cover ring-2 ring-slate-100 transition hover:ring-orange-300 sm:h-20 sm:w-20"
                />
              ) : (
                <Avatar name={individual.name} size="lg" />
              )}
            </VolunteerRing>
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <h1 className="text-lg font-semibold text-slate-900 sm:text-xl">{individual.name}</h1>
              <RequirePermission permission="edit_contacts">
                <Button variant="secondary" size="sm" onClick={() => setEditOpen(true)} className="shrink-0">
                  <Pencil className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Edit</span>
                </Button>
              </RequirePermission>
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <VolunteerBadge volunteer={sevak} />
              {individual.isPrimary && (
                <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">Primary contact</span>
              )}
              {individual.status && (
                <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", colorClasses(individual.status))}>
                  {emoji(individual.status) && `${emoji(individual.status)} `}{individual.status}
                </span>
              )}
              {individual.photoPending && !individual.profilePhotoURL && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">Photo pending</span>
              )}
            </div>

            <div className="mt-1.5 flex flex-wrap gap-x-2 text-sm text-slate-400">
              {individual.mandal && <span>{individual.mandal}</span>}
              {individual.area && <span>· {individual.area}</span>}
              {individual.subArea && <span>· {individual.subArea}</span>}
              {individual.relation && <span>· {RELATION_LABEL[individual.relation] || individual.relation}</span>}
            </div>

            {/* PHASE 21 — this contact also has a login. Showing what they are
                responsible for turns "is a sevak" into something actionable.
                PHASE 39 — and now it is a round trip: the volunteer editor links
                out to this profile, so this links back to the login. A karyakarta
                exists in both collections and every question about them used to
                mean finding them twice, by hand, in two different tabs. */}
            {sevak && (
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <p className="text-xs text-indigo-700">
                  Karyakarta login · {sevak.assignedAreas?.length ? sevak.assignedAreas.join(", ") : "no areas assigned"}
                  {sevak.assignedMandals?.length ? ` · ${sevak.assignedMandals.join(", ")}` : ""}
                </p>
                <RequirePermission permission="manage_users">
                  <Link
                    to={`/admin/volunteers?v=${sevak.id}`}
                    className="text-xs font-medium text-indigo-600 underline-offset-2 hover:underline"
                  >
                    Manage login →
                  </Link>
                </RequirePermission>
              </div>
            )}
          </div>
        </div>

        {/* Call / WhatsApp — full-width targets on a phone */}
        {phone && (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <a
              href={buildTelUrl(individual.mobile)}
              className="flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              <Phone className="h-4 w-4" /> Call {phone.replace(/(\d{5})(\d{5})/, "$1 $2")}
            </a>
            {waUrl && (
              <a
                href={waUrl}
                target="_blank"
                rel="noreferrer"
                className="flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-[#128C7E] text-sm font-semibold text-white hover:bg-[#0e7469]"
              >
                <MessageCircle className="h-4 w-4" /> WhatsApp
              </a>
            )}
          </div>
        )}

        {/* Detail fields — one column on a phone, two from sm up */}
        <div className="mt-6 grid gap-x-8 gap-y-4 sm:grid-cols-2">
          <Field label="Mobile" value={individual.mobile} />
          <Field label="Address" value={individual.householdId ? household?.address : individual.address} />
          <Field label="Date of birth" value={individual.dob ? formatDate(individual.dob) : null} />
          <Field label="Anniversary" value={individual.anniversary ? formatDate(individual.anniversary) : null} />
          <Field label="Standard" value={individual.standard} />
          <Field label="Hobbies" value={individual.hobby && individual.hobby.length > 0 ? individual.hobby.join(", ") : null} />
          <Field label="Study" value={individual.study} />
          <Field label="Profession" value={individual.profession} />
          <Field label="Skill" value={individual.skill} />
          <Field label="Sampark Karyakarta" value={individual.samparkKaryakartaName ? `${individual.samparkKaryakartaName}${individual.samparkKaryakartaNumber ? ` (${individual.samparkKaryakartaNumber})` : ""}` : null} />
          <Field label="Reference / notes" value={individual.reference} />
        </div>

        {individual.householdId && (
          <div className="mt-6 border-t border-slate-100 pt-4">
            <Link
              to={`/households/${individual.householdId}`}
              // Carry the trail forward: the household's own Back then returns to
              // this profile instead of dumping the karyakarta on the Households
              // tab, which is where the reported "back button" complaint started.
              // `fromState` is this page's OWN trail, handed back so returning here
              // still knows the way to My Calling.
              state={{
                from: `/contacts/${individual.id}`,
                fromLabel: individual.name || 'this contact',
                fromState: location.state || null,
              }}
              className="inline-flex items-center gap-1.5 text-sm text-orange-600 hover:underline"
            >
              <Home className="h-3.5 w-3.5" /> View household
            </Link>
          </div>
        )}
      </Card>

      {/* Sabha attendance history */}
      <Card className="mt-4 p-4 sm:p-6">
        <AttendanceHistoryPanel individualId={id} individual={individual} variant="full" />
      </Card>

      {/* Bal Mandal notes */}
      {(individual.mandal === 'Bal Mandal' || individual.mandal === 'Sishu Mandal') && (
        <Card className="mt-4 p-4 sm:p-6">
          <BalMandalNotesPanel individual={individual} />
        </Card>
      )}

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title={`Edit ${individual.name || "contact"}`} size="lg">
        <IndividualForm
          individual={individual}
          onSubmit={handleSave}
          onCancel={() => setEditOpen(false)}
          // A contact that belongs to a household inherits its Area and Address,
          // exactly as it does when added from the household screen — otherwise
          // editing here would let the two records drift apart.
          withinHousehold={Boolean(individual.householdId)}
          householdArea={household?.area || individual.area || ""}
          householdAddress={household?.address || ""}
        />
      </Modal>

      {lightbox && individual.profilePhotoURL && (
        <PhotoLightbox src={individual.profilePhotoURL} name={individual.name} onClose={() => setLightbox(false)} />
      )}
    </div>
  );
}
