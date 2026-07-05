// src/lib/firebase.js
// CANONICAL location. Phase 2's admin components originally imported from
// '../firebase' — updated to '../lib/firebase' at merge time to match this
// Phase 3 location, since Phase 3 has the most files depending on the path.

import { initializeApp, getApps, getApp } from "firebase/app";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";
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

// Phase 10 (Offline support): persistentLocalCache gives the app most of the
// legacy HTML app's "queue actions while offline, sync when back online"
// behavior for free — reads come from the local cache instantly, and writes
// queue locally and flush automatically on reconnect, no hand-rolled queue
// needed. persistentMultipleTabManager lets it work across multiple open
// tabs instead of erroring in all but the first one.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
export const storage = getStorage(app);
export const auth = getAuth(app);
export default app;
