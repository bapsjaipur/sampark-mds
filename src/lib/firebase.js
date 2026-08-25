// src/lib/firebase.js
// CANONICAL location. Phase 2's admin components originally imported from
// '../firebase' — updated to '../lib/firebase' at merge time to match this
// Phase 3 location, since Phase 3 has the most files depending on the path.

import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 24 — THE SINGLE BIGGEST READ SAVING IN THE APP.
//
// This project runs on the Spark plan: 50,000 document reads a day. One visit to
// the Contacts page as an admin subscribes to ~3,100 individuals and ~420
// households, so fourteen visits would spend the entire day's allowance. With an
// IndexedDB cache the numbers change completely: the second and every later
// listener on the same query is served locally (billed: nothing), and when the
// listener reconnects Firestore sends a resume token so only the documents that
// CHANGED since last time are downloaded. A reload after the first load of the
// day typically costs single-digit reads instead of thousands.
//
// It is enabled in PRODUCTION ONLY, deliberately. The previous comment here
// recorded why it was switched off: Vite HMR re-imports this module while the old
// IndexedDB handles are still open, and Firestore throws "INTERNAL ASSERTION
// FAILED: Unexpected state" once that state is torn. That only happens under the
// dev server, so dev keeps the in-memory default and production — which never
// hot-reloads — gets the cache. `import.meta.env.PROD` is inlined at build time,
// so the dev branch is not even shipped.
//
// persistentMultipleTabManager: without it, opening the app in a second tab
// leaves that tab with no cache at all (single-tab is the default and the first
// tab holds the lease), which is exactly the person who keeps Contacts open in
// one tab and Calling in another.
// ─────────────────────────────────────────────────────────────────────────────
function initDb() {
  if (!import.meta.env.PROD) return getFirestore(app);
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch (err) {
    // Already initialised (a duplicate module instance), or IndexedDB is
    // unavailable — private browsing, a locked profile, an old WebView. Falling
    // back costs reads but keeps the app working, which is the right trade.
    console.warn('[firebase] Persistent cache unavailable; falling back to memory cache.', err?.message || err);
    return getFirestore(app);
  }
}

export const db = initDb();
export const storage = getStorage(app);
export const auth = getAuth(app);
export default app;
