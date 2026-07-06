// src/components/search/GlobalSearchBar.jsx — Attio redesign.
import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { useGlobalSearch } from "../../hooks/useGlobalSearch";
import { Avatar } from "../ui/Avatar";

export default function GlobalSearchBar({ households }) {
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const navigate = useNavigate();
  const { individuals, households: matchedHouseholds, isSearching } = useGlobalSearch(term, households);

  useEffect(() => {
    const onClickOutside = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const goToHousehold = (householdId) => { setOpen(false); setTerm(""); navigate(`/households/${householdId}`); };

  return (
    <div ref={wrapRef} className="relative w-full max-w-xl">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={term}
          onChange={(e) => { setTerm(e.target.value); setOpen(true); }}
          onFocus={() => term && setOpen(true)}
          placeholder="Search by name, mobile, area, or mandal\u2026"
          className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-300"
        />
      </div>

      {open && isSearching && (
        <div className="absolute z-40 mt-1.5 w-full max-h-96 overflow-y-auto rounded-lg border border-slate-100 bg-white shadow-lg shadow-slate-900/5">
          {individuals.length === 0 && matchedHouseholds.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-slate-400">No matches yet \u2014 keep typing, or check spelling.</p>
          )}

          {individuals.length > 0 && (
            <div>
              <p className="px-3 pt-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">People</p>
              {individuals.slice(0, 8).map((i) => (
                <button key={i.id} onClick={() => goToHousehold(i.householdId)} className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-slate-50">
                  <Avatar name={i.name} size="sm" />
                  <span>
                    <span className="block text-sm font-medium text-slate-800">{i.name}</span>
                    <span className="block text-xs text-slate-400">{i.mobile || "No mobile"} \u00b7 {i.mandal || "No mandal"} \u00b7 {i.household?.area || "Unknown area"}</span>
                  </span>
                </button>
              ))}
            </div>
          )}

          {matchedHouseholds.length > 0 && (
            <div className="border-t border-slate-100">
              <p className="px-3 pt-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Households</p>
              {matchedHouseholds.slice(0, 8).map((h) => (
                <button key={h.id} onClick={() => goToHousehold(h.id)} className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-slate-50">
                  <span className="text-sm font-medium text-slate-800">{h.address}</span>
                  <span className="text-xs text-slate-400">{h.area}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
