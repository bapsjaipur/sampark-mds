// src/lib/firebase.js
// CANONICAL location. Phase 2's admin components originally imported from
// '../firebase' — updated to '../lib/firebase' at merge time to match this
// Phase 3 location, since Phase 3 has the most files depending on the path.

import { initializeApp, getApps, getApp } from "firebase/app";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, getFirestore } from "firebase/firestore";
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

// initializeFirestore may only be called once per app. On Vite HMR the module
// re-executes while the Firebase app persists, so calling initializeFirestore
// a second time throws "INTERNAL ASSERTION FAILED: Unexpected state". We catch
// that and fall back to getFirestore() which returns the already-configured
// instance with persistence intact.
function getOrInitFirestore() {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    return getFirestore(app);
  }
}
export const db = getOrInitFirestore();
export const storage = getStorage(app);
export const auth = getAuth(app);
export default app;
