# Phase 15 — Full Attio-Style Visual Redesign

Every screen and component across all 14 prior phases has been restyled.
No logic changed anywhere in this pass — only markup and classNames. If
something behaves differently after this, it should be a rendering bug to
report, not an intentional functional change.

## Foundation added

- **Inter font**, loaded via Google Fonts in `index.html`, set as the
  default `sans` in `tailwind.config.js`, with `tracking-tight` applied
  globally in `index.css`.
- **`src/lib/cn.js`** — the standard shadcn/ui class-merge utility
  (`clsx` + `tailwind-merge`), used everywhere so conflicting Tailwind
  classes resolve predictably.
- **`src/components/ui/`** — hand-authored primitives in the shadcn/ui
  style (`Button`, `Input`/`Textarea`/`Select`/`Label`/`FieldError`,
  `Badge`, `Avatar`, `Card`, plus the pre-existing `Modal`). This *is* how
  shadcn/ui actually works — it's not an installed black-box package, you
  own the component source, which is what's here.
- **Lucide React icons** replace essentially every emoji used for icons
  throughout the app (nav, buttons, status indicators, etc.).
- **Left sidebar navigation** (`AppLayout.jsx`) replaces the old horizontal
  top bar — with 11 nav items across Main/Admin sections, a sidebar reads
  far better than an overflowing top bar, and matches Attio's own layout.

## Design language applied throughout

- Pure white / `bg-slate-50/50` backgrounds, 1px `border-slate-100`
  everywhere instead of heavier borders or shadows.
- Borderless list rows with `hover:bg-slate-50` instead of bordered table
  cells (see `ContactsPage`, `AuditTrailTab`).
- Pastel-tint status badges (`Badge` component) instead of solid colors.
- Circular micro-avatars (`Avatar` component, initials fallback) wherever a
  person is shown — contact lists, volunteer lists, reminders, search
  results.
- `rounded-lg` micro-radius corners, `focus:ring-1 focus:ring-slate-300`
  focus states, consistent across every input/button.

## What every file got touched

All 5 UI primitives, `Modal`, `ToastContext`, `AppLayout`, `LoginPage`,
`ErrorBoundary`, both household components + forms, both contact
components + forms, `LinkExistingContact`/`AddToHousehold`,
`GlobalSearchBar`, `EventForm`/`EventsPage`/`AttendanceMarking`,
`CallingFlowPage`/`StatusChips`, `PhotoUploader`,
`ImportContactsWizard`/`ExportButtons`, `ContactCard`/`BatchAssignment`/
`BatchesPage`, `AdminDashboardPage`, `RolesManager`/`VolunteerEditor`/
`AreasMandalsManager`, `AdminToolsPage` + all 3 tabs, `RemindersDashboard`.

## Verified before delivery

- Every `.js` file passes `node --check` (syntax valid).
- Every `.jsx` file has balanced braces.
- Every relative import path in the entire `src/` tree resolves to a real
  file — no typo'd imports into the new `ui/` primitives.

I could not run an actual browser/Vite build in this environment, so a
visual pass on your end is still the real test — if anything looks off or
throws a runtime error, send it over and I'll fix it directly.

## Setup change needed

`npm install` is required this time — new dependencies added:
`lucide-react`, `clsx`, `tailwind-merge`, `class-variance-authority`,
`tailwindcss-animate`.

## Still deferred, as agreed

Point 3 (Zod validation + Firebase App Check) — right before your testing
stage, whenever you're ready.
