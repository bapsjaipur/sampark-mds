// src/components/individuals/IndividualCard.jsx
import { Pencil, Trash2, Eye, PhoneOff } from "lucide-react";
import RequirePermission from "../RequirePermission";
import { formatDate } from "../../lib/dateHelpers";
import { Avatar } from "../ui/Avatar";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { useVolunteerIdentity } from "../../hooks/useVolunteerIdentity";
import { VolunteerBadge, VolunteerRing } from "../ui/VolunteerBadge";

const RELATION_LABEL = { head: "Head", spouse: "Spouse", member: "Member" };

export default function IndividualCard({ individual, onEdit, onDelete, onView, deletePermission = "delete_contacts", deleteLabel = "Delete" }) {
  // PHASE 21 — every member row in the app renders through this component, so
  // marking the sevak here covers the household page, the family-member list and
  // anything added later, in one place. The hook shares one `volunteers`
  // listener across all rows.
  const { identify } = useVolunteerIdentity();
  const sevak = identify(individual);

  return (
    <div
      className={[
        "flex items-center gap-3 rounded-lg border p-3.5",
        sevak
          ? "border-indigo-200 bg-indigo-50/40 hover:bg-indigo-50/70"
          : "border-slate-100 hover:bg-slate-50/50",
        individual._pending ? "opacity-60" : "",
      ].join(" ")}
    >
      {/* Clicking the avatar opens the viewer */}
      <button
        onClick={() => onView?.(individual)}
        className="shrink-0 rounded-full focus:outline-none focus:ring-2 focus:ring-orange-300"
        aria-label={`View ${individual.name}`}
        tabIndex={onView ? 0 : -1}
      >
        <VolunteerRing active={Boolean(sevak)}>
          <Avatar src={individual.profilePhotoURL} name={individual.name} />
        </VolunteerRing>
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-medium text-slate-900">{individual.name}</p>
          {individual.isPrimary && <Badge tone="orange">Primary</Badge>}
          {/* PHASE 26 — off the follow-up calling list. Shown because the
              alternative is a karyakarta wondering for weeks why this name never
              turns up in a batch. Absent means on, so only `false` shows a chip
              and nothing changes for the 1000+ contacts that predate the field. */}
          {individual.callingPool === false && (
            <Badge tone="slate" className="gap-1" title="Not pulled into weekly follow-up batches. Still on the roster.">
              <PhoneOff className="h-3 w-3" /> Not calling
            </Badge>
          )}
          <VolunteerBadge volunteer={sevak} />
        </div>
        <p className="truncate text-xs text-slate-400">
          {RELATION_LABEL[individual.relation] || individual.relation} &middot; {individual.mobile || "No mobile"}
          {individual.mandal ? ` · ${individual.mandal}` : ""}
          {individual.standard ? ` · ${individual.standard}` : ""}
        </p>
        {individual.dob && <p className="text-xs text-slate-400">Born {formatDate(individual.dob)}</p>}
        {individual.hobby && individual.hobby.length > 0 && (
          <p className="truncate text-xs text-slate-400">
            Hobbies: {individual.hobby.join(", ")}
          </p>
        )}
        {individual.samparkKaryakartaName && (
          <p className="truncate text-xs text-slate-400">
            SK: {individual.samparkKaryakartaName}{individual.samparkKaryakartaNumber ? ` (${individual.samparkKaryakartaNumber})` : ""}
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
        <RequirePermission permission={deletePermission}>
          <Button variant="ghost" size="icon" onClick={() => onDelete(individual)} aria-label={deleteLabel} className="hover:bg-rose-50 hover:text-rose-500">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </RequirePermission>
      </div>
    </div>
  );
}
