# Phase 5 — Vercel Deployment Checklist

## vercel.json
```json
{
  "buildCommand": "vite build",
  "outputDirectory": "dist",
  "framework": "vite",
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```
(The rewrite is needed so client-side routes like `/households/123` don't 404 on refresh.)

## Environment Variables (set in Vercel Project Settings → Environment Variables)

| Variable | Used by | Notes |
|---|---|---|
| `VITE_FIREBASE_API_KEY` | React app | From Firebase Console → Project Settings |
| `VITE_FIREBASE_AUTH_DOMAIN` | React app | |
| `VITE_FIREBASE_PROJECT_ID` | React app | |
| `VITE_FIREBASE_STORAGE_BUCKET` | React app | |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | React app | |
| `VITE_FIREBASE_APP_ID` | React app | |

## Firebase Cloud Function config (NOT set in Vercel — set via Firebase)
```
firebase functions:secrets:set GAS_WEBAPP_URL
# paste the Admin Master GAS Web App /exec URL when prompted
```
Cloud Functions deploy separately from Vercel:
```
firebase deploy --only functions
```

## Firestore indexes (deploy alongside functions)
```
firebase deploy --only firestore:indexes
```
Make sure `firestore.indexes.json` includes the composite indexes from the
Phase 1 schema doc (`individuals`: mandal+dobMonthDay, mandal+anniversaryMonthDay).

## Pre-launch checklist
- [ ] Firestore security rules deployed (`firebase deploy --only firestore:rules`)
- [ ] All `VITE_FIREBASE_*` env vars set in Vercel for Production **and** Preview environments
- [ ] `GAS_WEBAPP_URL` secret set in Firebase Functions config
- [ ] At least one `roles` doc with `manage_users` + `run_gas_sync` permissions exists, and one `volunteers` doc points to it (so you have an initial admin login)
- [ ] Firebase Storage CORS configured to allow uploads from your Vercel domain
