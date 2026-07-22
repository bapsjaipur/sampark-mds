// src/pages/MyContactsPage.jsx
import { useEffect, useMemo, useState } from "react";
import { collection, query, where, onSnapshot, addDoc, serverTimestamp } from "firebase/firestore";
import { Phone, MessageSquare, Plus, Clock, Search, X } from "lucide-react";
import { db } from "../lib/firebase";
import { useAuth } from "../hooks/usePermissions";
import { useToast } from "../contexts/ToastContext";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Avatar } from "../components/ui/Avatar";
import { Badge } from "../components/ui/Badge";
import Modal from "../components/ui/Modal";

function formatDate(str) {
  if (!str) return "—";
  const d = new Date(str + "T00:00:00");
  return isNaN(d) ? str : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export default function MyContactsPage() {
  const { volunteer } = useAuth();
  const { showToast } = useToast();
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [logModal, setLogModal] = useState({ open: false, contact: null, action: "" });
  const [debugList, setDebugList] = useState([]);

  useEffect(() => {
    // Load a sample list of individuals to inspect their sampark numbers
    const unsubDebug = onSnapshot(collection(db, "individuals"), (snap) => {
      setDebugList(snap.docs.slice(0, 10).map(d => ({
        name: d.data().name,
        samparkNumber: d.data().samparkKaryakartaNumber,
      })));
    });
    return unsubDebug;
  }, []);

  useEffect(() => {
    if (!volunteer?.mobile) { setLoading(false); return; }

    // Query individuals where samparkKaryakartaNumber matches the user's mobile (mobile)
    const q = query(
      collection(db, "individuals"),
      where("samparkKaryakartaNumber", "==", volunteer.mobile)
    );

    return onSnapshot(q, (snap) => {
      setContacts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, (err) => {
      console.error(err);
      setLoading(false);
    });
  }, [volunteer?.mobile]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return contacts.filter(c => c.name?.toLowerCase().includes(q) || c.mobile?.includes(q));
  }, [contacts, search]);

  async function handleLogInteraction(action, note) {
    if (!logModal.contact) return;
    try {
      await addDoc(collection(db, "activity"), {
        individualId: logModal.contact.id,
        volunteerId: volunteer.id,
        action: `followup_${action}`,
        details: { note, contactName: logModal.contact.name },
        timestamp: serverTimestamp(),
      });
      showToast({ type: "success", message: "Interaction logged." });
      setLogModal({ open: false, contact: null, action: "" });
    } catch (err) {
      showToast({ type: "error", message: "Couldn't log interaction." });
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="mb-6 text-xl font-semibold text-slate-900 tracking-tight">My Contacts</h1>

      {/* Temporary Debug Block */}
      <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4 text-xs space-y-2">
        <p className="font-semibold text-blue-900">DEBUG INFO:</p>
        <p>My Logged-in Volunteer Mobile: <strong className="font-bold">"{volunteer?.mobile || "NOT SET"}"</strong></p>
        <div>
          <p className="font-semibold">Sample Contacts in Database:</p>
          <ul className="list-disc list-inside">
            {debugList.map((item, i) => (
              <li key={i}>{item.name}: <strong className="font-bold">"{item.samparkNumber || "NONE"}"</strong></li>
            ))}
          </ul>
        </div>
      </div>

      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search my contacts…"
        className="mb-4"
      />

      {loading ? (
        <div className="animate-pulse space-y-2">{Array.from({length: 4}).map((_, i) => <div key={i} className="h-16 rounded-lg bg-slate-100" />)}</div>
      ) : filtered.length === 0 ? (
        <p className="py-10 text-center text-slate-400">No contacts assigned to you yet.</p>
      ) : (
        <div className="divide-y divide-slate-100 rounded-lg border border-slate-100 bg-white">
          {filtered.map(c => (
            <div key={c.id} className="flex items-center gap-3 p-3 hover:bg-slate-50">
              <Avatar name={c.name} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900">{c.name}</p>
                <div className="flex gap-2 text-xs text-slate-400">
                  <span>{c.mobile || "No mobile"}</span>
                  {c.dob && <span>· Bday: {formatDate(c.dob)}</span>}
                </div>
              </div>
              <div className="flex gap-1">
                <a href={`tel:+91${c.mobile}`} onClick={() => setLogModal({ open: true, contact: c, action: "call" })} className="p-2 rounded-full text-slate-400 hover:bg-blue-50 hover:text-blue-600"><Phone className="h-4 w-4" /></a>
                <a href={`https://wa.me/91${c.mobile}`} target="_blank" rel="noreferrer" onClick={() => setLogModal({ open: true, contact: c, action: "whatsapp" })} className="p-2 rounded-full text-slate-400 hover:bg-emerald-50 hover:text-emerald-600"><MessageSquare className="h-4 w-4" /></a>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={logModal.open} onClose={() => setLogModal({ ...logModal, open: false })} title={`Log ${logModal.action} with ${logModal.contact?.name}`}>
        <div className="space-y-3">
          <textarea id="log-note" className="w-full rounded-lg border border-slate-200 p-2 text-sm" placeholder="Add a note (optional)..." />
          <Button variant="accent" className="w-full" onClick={() => handleLogInteraction(logModal.action, document.getElementById('log-note').value)}>Save Interaction</Button>
        </div>
      </Modal>
    </div>
  );
}
