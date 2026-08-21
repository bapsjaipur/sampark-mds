// src/components/households/HouseholdForm.jsx — Phase 18 + Section 7 (7.1 + 7.2)
import { useState, useRef, useEffect } from "react";
import { AreaSelect, SubAreaSelect, LevelSelect } from "../AreaMandalSelect";
import { useAreasAndMandals } from "../../hooks/useAreasAndMandals";
import { Input, Textarea, Label, FieldError } from "../ui/Input";
import { Button } from "../ui/Button";
import { loadMapsApi } from "../../hooks/useMapsLoader";
import { MapPin, Navigation, Loader2 } from "lucide-react";

const emptyForm = {
  address: "", area: "", subArea: "", level: "", totalFamilyMembers: "", remark: "",
  location: null, placeId: "",
};

export default function HouseholdForm({ household, onSubmit, onCancel }) {
  const { areas } = useAreasAndMandals();
  const isEdit = Boolean(household);
  const [form, setForm] = useState(() =>
    isEdit
      ? {
          address: household.address || "",
          area: household.area || "",
          subArea: household.subArea || "",
          level: household.level || "",
          totalFamilyMembers: household.totalFamilyMembers ?? "",
          remark: household.remark || "",
          location: household.location || null,
          placeId: household.placeId || "",
        }
      : emptyForm
  );
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [locStatus, setLocStatus] = useState(""); // "" | "loading" | "ok" | "error"
  const [mapsReady, setMapsReady] = useState(false);
  const addressRef = useRef(null);
  const autocompleteRef = useRef(null);

  // 7.1 — Google Places Autocomplete
  useEffect(() => {
    let cancelled = false;
    loadMapsApi()
      .then(() => {
        if (cancelled || !addressRef.current) return;
        setMapsReady(true);
        const ac = new window.google.maps.places.Autocomplete(addressRef.current, {
          types: ["geocode", "establishment"],
          componentRestrictions: { country: "in" },
        });
        ac.addListener("place_changed", () => {
          const place = ac.getPlace();
          if (!place.geometry) return;
          const lat = place.geometry.location.lat();
          const lng = place.geometry.location.lng();
          setForm((prev) => ({
            ...prev,
            address: place.formatted_address || addressRef.current?.value || prev.address,
            location: { lat, lng },
            placeId: place.place_id || "",
          }));
        });
        autocompleteRef.current = ac;
      })
      .catch(() => {
        // Maps API not configured — address field works as plain input
      });
    return () => {
      cancelled = true;
      if (autocompleteRef.current) {
        window.google?.maps?.event?.clearInstanceListeners(autocompleteRef.current);
      }
    };
  }, []);

  const update = (field) => (e) => {
    setForm((prev) => ({
      ...prev,
      [field]: e.target.value,
      // Clear geocoded location when address is typed manually
      ...(field === "address" ? { location: null, placeId: "" } : {}),
      // Reset subArea if area changes
      ...(field === "area" ? { subArea: "" } : {}),
    }));
  };

  // 7.2 — Browser Geolocation
  const handleCurrentLocation = () => {
    if (!navigator.geolocation) {
      setLocStatus("error");
      return;
    }
    setLocStatus("loading");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setForm((prev) => ({
          ...prev,
          location: { lat: coords.latitude, lng: coords.longitude },
          placeId: "",
        }));
        setLocStatus("ok");
      },
      () => setLocStatus("error"),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const validate = () => {
    const errs = {};
    if (!form.address.trim()) errs.address = "Address is required.";
    if (!form.area.trim()) errs.area = "Area is required.";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    setSaving(true);
    const selectedArea = areas.find(a => a.name === form.area);
    const selectedSub = selectedArea?.subAreas?.find(s => s.name === form.subArea);

    const ok = await onSubmit({
      ...form,
      subAreaCode: selectedSub?.code || "",
      totalFamilyMembers: form.totalFamilyMembers ? Number(form.totalFamilyMembers) : 0,
      location: form.location || null,
      placeId: form.placeId || null,
    });
    setSaving(false);
    if (ok) onCancel();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label required>Address</Label>
        <div className="relative">
          <Input
            ref={addressRef}
            value={form.address}
            onChange={update("address")}
            error={errors.address}
            placeholder={mapsReady ? "Start typing to search Places…" : "e.g. 12 Gandhi Nagar, Jaipur"}
          />
          {form.location && (
            <MapPin className="pointer-events-none absolute right-2.5 top-2 h-4 w-4 text-emerald-500" />
          )}
        </div>
        {form.location && (
          <p className="mt-0.5 text-[11px] text-emerald-600">
            Geocoded · {form.location.lat.toFixed(5)}, {form.location.lng.toFixed(5)}
          </p>
        )}
        {mapsReady && !form.location && (
          <p className="mt-0.5 text-[11px] text-slate-400">Type to search Places or use location button below</p>
        )}
        <FieldError>{errors.address}</FieldError>
      </div>

      {/* 7.2 — Current location */}
      <button
        type="button"
        onClick={handleCurrentLocation}
        disabled={locStatus === "loading"}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
      >
        {locStatus === "loading" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Navigation className="h-3.5 w-3.5 text-blue-500" />
        )}
        Use my current location
        {locStatus === "ok" && <span className="font-semibold text-emerald-600"> ✓</span>}
        {locStatus === "error" && <span className="text-rose-500"> (denied or unavailable)</span>}
      </button>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label required>Area</Label>
          <AreaSelect
            value={form.area}
            onChange={update("area")}
            className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-300"
          />
          <FieldError>{errors.area}</FieldError>
        </div>
        <div>
          <Label>Level</Label>
          <LevelSelect
            value={form.level}
            onChange={update("level")}
            className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-300"
          />
        </div>
      </div>

      <SubAreaSelect
        areaName={form.area}
        value={form.subArea}
        onChange={update("subArea")}
        className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-300"
      />

      <div>
        <Label>Total family members</Label>
        <Input type="number" min="0" value={form.totalFamilyMembers} onChange={update("totalFamilyMembers")} />
      </div>

      <div>
        <Label>Remark</Label>
        <Textarea value={form.remark} onChange={update("remark")} rows={2} />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="accent" disabled={saving}>
          {saving ? "Saving…" : isEdit ? "Save changes" : "Add household"}
        </Button>
      </div>
    </form>
  );
}
