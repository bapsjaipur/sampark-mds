// src/components/individuals/IndividualCard.jsx
import { Pencil, Trash2, Eye } from "lucide-react";
import RequirePermission from "../RequirePermission";
import { formatDate } from "../../lib/dateHelpers";
import { Avatar } from "../ui/Avatar";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";

const RELATION_LABEL = { head: "Head", spouse: "Spouse", member: "Member" };

export default function IndividualCard({ individual, onEdit, onDelete, onView }) {
  return (
    <div className={`flex items-center gap-3 rounded-lg border border-slate-100 p-3.5 hover:bg-slate-50/50 ${individual._pending ? "opacity-60" : ""}`}>
      {/* Clicking the avatar opens the viewer */}
      <button
        onClick={() => onView?.(individual)}
        className="shrink-0 rounded-full focus:outline-none focus:ring-2 focus:ring-orange-300"
        aria-label={`View ${individual.name}`}
        tabIndex={onView ? 0 : -1}
      >
        <Avatar src={individual.profilePhotoURL} name={individual.name} />
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-slate-900">{individual.name}</p>
          {individual.isPrimary && <Badge tone="orange">Primary</Badge>}
        </div>
        <p className="truncate text-xs text-slate-400">
          {RELATION_LABEL[individual.relation] || individual.relation} &middot; {individual.mobile || "No mobile"}
          {individual.mandal ? ` · ${individual.mandal}` : ""}
        </p>
        {individual.dob && <p className="text-xs text-slate-400">Born {formatDate(individual.dob)}</p>}
        {individual.samparkKaryakartaName && (
          <p className="truncate text-xs text-slate-400">
            Sampark: {individual.samparkKaryakartaName}{individual.samparkKaryakartaNumber ? ` (${individual.samparkKaryakartaNumber})` : ""}
          </p>
        )}
      </div>

      <div className="flex shrink-0 gap-1">
        {onView && (
          <Button variant="ghost" size="icon" onClick={() => onView(individual)} aria-label="View profile">
            <Eye className="h-3.5 w-3.5" />
          </Button>
        )}
        <RequirePermission permission="edit_contacts">
          <Button variant="ghost" size="icon" onClick={() => onEdit(individual)} aria-label="Edit">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </RequirePermission>
        <RequirePermission permission="delete_contacts">
          <Button variant="ghost" size="icon" onClick={() => onDelete(individual)} aria-label="Delete" className="hover:bg-rose-50 hover:text-rose-500">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </RequirePermission>
      </div>
    </div>
  );
}
