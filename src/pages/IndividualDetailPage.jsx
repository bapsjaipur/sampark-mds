// src/pages/IndividualDetailPage.jsx — 2.1: individual profile + lightbox photo
import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, X, Home } from "lucide-react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { formatDate } from "../lib/dateHelpers";
import { Avatar } from "../components/ui/Avatar";
import { Card } from "../components/ui/Card";

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <button onClick={onClose} className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20">
        <X className="h-5 w-5" />
      </button>
      <img
        src={src}
        alt={name}
        className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

export default function IndividualDetailPage() {
  const { id } = useParams();
  const [individual, setIndividual] = useState(null);
  const [household, setHousehold] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState(false);

  useEffect(() => {
    getDoc(doc(db, "individuals", id)).then(async (snap) => {
      if (snap.exists()) {
        const indData = { id: snap.id, ...snap.data() };
        setIndividual(indData);
        if (indData.householdId) {
          try {
            const tempHh = await getDoc(doc(db, "households", indData.householdId));
            if (tempHh.exists()) {
              setHousehold({ id: tempHh.id, ...tempHh.data() });
            }
          } catch (err) {
            console.error("Error loading household:", err);
          }
        }
      }
      setLoading(false);
    });
  }, [id]);

  if (loading) {
    return <div className="mx-auto max-w-2xl px-6 py-16"><div className="h-48 animate-pulse rounded-lg bg-slate-100" /></div>;
  }

  if (!individual) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <p className="text-slate-400">Contact not found.</p>
        <Link to="/contacts" className="mt-2 inline-block text-sm text-orange-600 hover:underline">← Back to contacts</Link>
      </div>
    );
  }

  const RELATION_LABEL = { head: "Head of household", spouse: "Spouse", member: "Family member" };

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <Link to="/contacts" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-600">
        <ArrowLeft className="h-3.5 w-3.5" /> All contacts
      </Link>

      <Card className="mt-4 p-6">
        {/* Header row */}
        <div className="flex items-start gap-5">
          <button
            onClick={() => individual.profilePhotoURL && setLightbox(true)}
            className={individual.profilePhotoURL ? "cursor-zoom-in" : "cursor-default"}
            aria-label={individual.profilePhotoURL ? "View full-size photo" : undefined}
          >
            {individual.profilePhotoURL ? (
              <img
                src={individual.profilePhotoURL}
                alt={individual.name}
                className="h-20 w-20 rounded-full object-cover ring-2 ring-slate-100 transition hover:ring-orange-300"
              />
            ) : (
              <Avatar name={individual.name} size="lg" />
            )}
          </button>

          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold text-slate-900">{individual.name}</h1>
            {individual.isPrimary && (
              <span className="mt-0.5 inline-block rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">Primary contact</span>
            )}
            <div className="mt-1 flex flex-wrap gap-2 text-sm text-slate-400">
              {individual.mandal && <span>{individual.mandal}</span>}
              {individual.area && <span>· {individual.area}</span>}
              {individual.relation && <span>· {RELATION_LABEL[individual.relation] || individual.relation}</span>}
            </div>
          </div>
        </div>

        {/* Detail fields */}
        <div className="mt-6 grid grid-cols-2 gap-x-8 gap-y-4">
          <Field label="Mobile" value={individual.mobile} />
          <Field label="Address" value={individual.householdId ? household?.address : individual.address} />
          <Field label="Date of birth" value={individual.dob ? formatDate(individual.dob) : null} />
          <Field label="Anniversary" value={individual.anniversary ? formatDate(individual.anniversary) : null} />
          <Field label="Study" value={individual.study} />
          <Field label="Profession" value={individual.profession} />
          <Field label="Skill" value={individual.skill} />
          <Field label="Sampark Karyakarta" value={individual.samparkKaryakartaName ? `${individual.samparkKaryakartaName}${individual.samparkKaryakartaNumber ? ` (${individual.samparkKaryakartaNumber})` : ""}` : null} />
        </div>

        {individual.householdId && (
          <div className="mt-6 border-t border-slate-100 pt-4">
            <Link
              to={`/households/${individual.householdId}`}
              className="inline-flex items-center gap-1.5 text-sm text-orange-600 hover:underline"
            >
              <Home className="h-3.5 w-3.5" /> View household
            </Link>
          </div>
        )}
      </Card>

      {lightbox && individual.profilePhotoURL && (
        <PhotoLightbox src={individual.profilePhotoURL} name={individual.name} onClose={() => setLightbox(false)} />
      )}
    </div>
  );
}
