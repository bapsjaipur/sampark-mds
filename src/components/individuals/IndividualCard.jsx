// src/components/individuals/IndividualCard.jsx — Attio redesign.
import { Pencil, Trash2 } from "lucide-react";
import RequirePermission from "../RequirePermission";
import { formatDate } from "../../lib/dateHelpers";
import { Avatar } from "../ui/Avatar";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";

const RELATION_LABEL = { head: "Head", spouse: "Spouse", member: "Member" };

export default function IndividualCard({ individual, onEdit, onDelete }) {
  return (
    <div className={`flex items-center gap-3 rounded-lg border border-slate-100 p-3.5 hover:bg-slate-50/50 ${individual._pending ? "opacity-60" : ""}`}>
      <Avatar src={individual.profilePhotoURL} name={individual.name} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-slate-900">{individual.name}</p>
          {individual.isPrimary && <Badge tone="orange">Primary</Badge>}
        </div>
        <p className="truncate text-xs text-slate-400">
          {RELATION_LABEL[individual.relation] || individual.relation} \u00b7 {individual.mobile || "No mobile"}
          {individual.mandal ? ` \u00b7 ${individual.mandal}` : ""}
        </p>
        {individual.dob && <p className="text-xs text-slate-400">Born {formatDate(individual.dob)}</p>}
        {individual.samparkKaryakartaName && (
          <p className="truncate text-xs text-slate-400">
            Sampark: {individual.samparkKaryakartaName}{individual.samparkKaryakartaNumber ? ` (${individual.samparkKaryakartaNumber})` : ""}
          </p>
        )}
      </div>
      <RequirePermission permission="edit_contacts">
        <div className="flex shrink-0 gap-1">
          <Button variant="ghost" size="icon" onClick={() => onEdit(individual)} aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></Button>
          <Button variant="ghost" size="icon" onClick={() => onDelete(individual)} aria-label="Delete" className="hover:bg-rose-50 hover:text-rose-500"><Trash2 className="h-3.5 w-3.5" /></Button>
        </div>
      </RequirePermission>
    </div>
  );
}
