// scripts/create-sishu-mandal.js
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 30 — Create Sishu Mandal document in Firestore.
// Run once: node scripts/create-sishu-mandal.js
// ─────────────────────────────────────────────────────────────────────────────

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyDWEke7NWyqFaCWUvjWL6_c2jCJPTFXKRE",
  authDomain: "baps-jaipur-mds.firebaseapp.com",
  projectId: "baps-jaipur-mds",
  storageBucket: "baps-jaipur-mds.firebasestorage.app",
  messagingSenderId: "589986809048",
  appId: "1:589986809048:web:2c2ba0cd1c9513e71e7f1e"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function createSishuMandal() {
  console.log('🔍 Creating Sishu Mandal...');

  const mandalData = {
    name: 'Sishu Mandal',
    code: 'SHM',
    gender: 'Male',
    fields: {
      photo: true,
      dob: true,
      anniversary: true,
      relation: true,
      isPrimary: true,
      area: true,
      study: true,
      profession: true,
      skill: true,
      samparkKaryakarta: true,
      standard: true,
      hobby: true,
    },
  };

  try {
    const docRef = await addDoc(collection(db, 'mandals'), mandalData);
    console.log('✓ Sishu Mandal created with ID:', docRef.id);
    console.log('\n✨ Done! Sishu Mandal is now available in the dropdown.');
  } catch (error) {
    console.error('❌ Error creating Sishu Mandal:', error);
  }

  process.exit(0);
}

createSishuMandal().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
