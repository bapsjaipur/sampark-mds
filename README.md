# BAPS Jaipur MDS — Sampark & Mandir Data System

An internal web application for **BAPS Swaminarayan Sanstha, Jaipur** to run
congregation outreach (*sampark*) and coordinate volunteers (*karyakarta*):
a single directory of households and individuals, calling campaigns split into
assignable batches, event and *padhramani* scheduling, *santo* (sadhu) visit
planning, Bal Mandal tracking, reminders, and automated birthday / anniversary
reports — all behind fully dynamic, area- and mandal-scoped role permissions.

> This is a private line-of-business app. It is not intended for public
> redistribution; the code lives here for the Jaipur tech team to maintain.

---

## Tech stack

| Layer | Choice |
| --- | --- |
| UI | React 18.3, React Router 6, Tailwind CSS 3.4, lucide-react |
| Build | Vite 5.3 (ES modules) |
| Styling helpers | class-variance-authority, clsx, tailwind-merge, tailwindcss-animate |
| Data & auth | Firebase — Firestore, Auth, Storage |
| Server logic | Firebase Cloud Functions (Gen 2, Node.js 22, `us-central1`) |
| Exports | jsPDF + jspdf-autotable (PDF), SheetJS `xlsx` (Excel) |
| Images | react-easy-crop (profile-photo cropping) |
| Frontend hosting | Vercel (static SPA) |

The app targets the Firebase **Blaze** plan but is engineered to stay inside the
free quota (≈ 50k reads / 20k writes a day): admin screens never hold a permanent
full-collection listener, data is fetched on demand in `documentId() in` chunks of
30, and production enables Firestore's IndexedDB persistent cache so repeat loads
cost single-digit reads. See the long note in [`src/lib/firebase.js`](src/lib/firebase.js).

---

## Features

- **Households & Individuals** — the core directory, with profile photos, family
  grouping, and area / mandal tagging.
- **Calling flow & Batches** — split the calling pool into batches, assign them to
  volunteers (manually or **auto-assign** evenly by contact count), track per-contact
  outcomes and notes, watch progress, review notes, and recycle exhausted contacts.
- **Events & Padhramani** — schedule and record home visits and programs.
- **Santo schedule** — plan sadhu visit itineraries.
- **Bal Mandal** — children's-group dashboard and standard promotion.
- **Reminders** — birthday / anniversary dashboards, plus a subscribable calendar
  feed and per-user Google Calendar push.
- **Admin** — dashboard, 100% dynamic role editor, volunteer accounts, areas &
  mandals, and a tools panel (backup / restore, imports, settings).
- **Automated email reports** — daily, post-sabha and birthday summaries delivered
  through the Firebase *Trigger Email from Firestore* extension.
- **WhatsApp** — `wa.me` quick links everywhere, plus an optional WhatsApp Cloud API
  sender configured entirely from the admin panel.

### Routes

Public: `/`, `/login`, `/privacy`, `/terms`.

Protected (behind auth + role-route guards): `/profile`, `/calling`, `/households`,
`/households/:id`, `/contacts`, `/contacts/:id`, `/padhramani`, `/santo-schedule`,
`/my-contacts`, `/events`, `/bal-mandal`, `/bal-mandal/promotion`,
`/admin/dashboard`, `/admin/batches`, `/reminders`, `/admin/roles`,
`/admin/volunteers`, `/admin/areas-mandals`, `/admin/tools`.

---

## Project structure

```
src/
  pages/            Route-level screens (lazy-loaded in App.jsx)
  components/       Feature UI — sampark/ (batches, calling), admin/, ui/ primitives
  services/         Firestore access layer (household, contact, batch, event, …)
  hooks/            Reusable data/UI hooks
  contexts/         Auth, Toast, and other providers
  lib/              firebase.js (SDK init + cache), fsMetered.js (read/write metering), cn.js
functions/
  index.js          Cloud Functions entry — exports every callable/scheduled fn
  lib/              Shared server helpers (mailer, reportData, pdfReport, scope, …)
firestore.rules     Security rules      storage.rules   Storage rules
firestore.indexes.json
firebase.json       Firebase project config (Firestore, Storage, Functions)
dist/               Built SPA — git-ignored; Vercel rebuilds on every deploy
```

---

## Getting started

### Prerequisites
- Node.js 20+ (Vite 5 / Functions target Node 22)
- npm
- Firebase CLI (`npm i -g firebase-tools`) for backend work

### Install
```bash
npm install
```

### Environment variables
Create a `.env` in the project root with the Firebase **web** config (all
`VITE_`-prefixed so Vite exposes them to the client):

```
VITE_FIREBASE_API_KEY=…
VITE_FIREBASE_AUTH_DOMAIN=…
VITE_FIREBASE_PROJECT_ID=…
VITE_FIREBASE_STORAGE_BUCKET=…
VITE_FIREBASE_MESSAGING_SENDER_ID=…
VITE_FIREBASE_APP_ID=…
```

`.env` is git-ignored — never commit real keys.

### Develop
```bash
npm run dev       # start the Vite dev server
npm run build     # production build into dist/
npm run preview   # preview the production build locally
```

---

## Firebase / backend

Configured in [`firebase.json`](firebase.json):

- **Firestore** — rules in `firestore.rules`, indexes in `firestore.indexes.json`.
- **Storage** — rules in `storage.rules`.
- **Functions** — source in `functions/`, runtime Node.js 22.

Deploy (performed by a maintainer with Firebase access):

```bash
firebase deploy --only firestore:rules
firebase deploy --only functions
```

The scheduled email reports require the **Trigger Email from Firestore** extension
installed and pointed at the `mail` collection; until then, sends are recorded in
`emailLogs` and nothing leaves the building (see
[`functions/index.js`](functions/index.js) and `functions/lib/mailer.js`).

---

## Deployment

- **Frontend** — pushed to Vercel, which runs `npm run build` and serves the SPA.
- **Backend** — Firestore rules, indexes and Cloud Functions are deployed with the
  Firebase CLI as above.
