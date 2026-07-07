// src/lib/firebase.js
// CANONICAL location. Phase 2's admin components originally imported from
// '../firebase' — updated to '../lib/firebase' at merge time to match this
// Phase 3 location, since Phase 3 has the most files depending on the path.

import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
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

// Using getFirestore() (default config, no IndexedDB persistence) to avoid
// "INTERNAL ASSERTION FAILED: Unexpected state" errors that occur when
// persistentLocalCache's IndexedDB state becomes corrupted across Vite HMR
// reloads. Firestore's built-in network caching still keeps the app fast.
export const db = getFirestore(app);
export const storage = getStorage(app);
export const auth = getAuth(app);
export default app;
