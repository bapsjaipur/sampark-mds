// scripts/enable-bal-mandal-fields.js
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 30 — Enable standard and hobby fields for Bal/Sishu Mandal.
// Enable study and skill fields for all mandals that need them.
//
// Run once: node scripts/enable-bal-mandal-fields.js
// ─────────────────────────────────────────────────────────────────────────────

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc } from 'firebase/firestore';

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

async function enableBalMandalFields() {
  console.log('🔍 Loading mandals...');
  const mandalsRef = collection(db, 'mandals');
  const snap = await getDocs(mandalsRef);
  const mandals = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  console.log(`Found ${mandals.length} mandals\n`);

  for (const mandal of mandals) {
    const name = mandal.name || '';
    const fields = mandal.fields || {};
    const updates = {};
    let changed = false;

    // Bal Mandal and Sishu Mandal need standard and hobby
    if (name === 'Bal Mandal' || name === 'Sishu Mandal') {
      if (!fields.standard) {
        updates.standard = true;
        changed = true;
      }
      if (!fields.hobby) {
        updates.hobby = true;
        changed = true;
      }
      if (!fields.study) {
        updates.study = true;
        changed = true;
      }
      if (!fields.skill) {
        updates.skill = true;
        changed = true;
      }
    }

    // All other mandals should have study, profession, skill enabled
    // (Yuvak, Sanyukt, Haribhakt, etc.)
    if (name !== 'Bal Mandal' && name !== 'Sishu Mandal' &&
        (name.includes('Mandal') || name.includes('Haribhakt'))) {
      if (!fields.study) {
        updates.study = true;
        changed = true;
      }
      if (!fields.profession) {
        updates.profession = true;
        changed = true;
      }
      if (!fields.skill) {
        updates.skill = true;
        changed = true;
      }
    }

    if (changed) {
      const newFields = { ...fields, ...updates };
      await updateDoc(doc(db, 'mandals', mandal.id), { fields: newFields });
      console.log(`✓ Updated ${name}:`, Object.keys(updates).join(', '));
    } else {
      console.log(`  ${name}: already configured`);
    }
  }

  console.log('\n✨ Done! All mandal fields enabled.');
  process.exit(0);
}

enableBalMandalFields().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
