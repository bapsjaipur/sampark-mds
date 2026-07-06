// src/lib/firestoreErrorMessage.js
// onSnapshot/addDoc/etc. error callbacks were all showing a hardcoded
// "Check your connection" message no matter what actually went wrong —
// including permission-denied errors, which have nothing to do with
// connectivity and were confusing to debug (see the Households "Couldn't
// load" report: the real cause was a role with no view permission
// checked, not a network issue). This gives each hook a one-line accurate
// message keyed off the real Firestore error code.
export function friendlyFirestoreError(err, thing) {
  if (err?.code === "permission-denied") {
    return `You don't have permission to view ${thing}. Ask your admin to check your role's permissions and your assigned Areas/Mandals.`;
  }
  if (err?.code === "unavailable") {
    return `Couldn't reach the server to load ${thing}. Check your connection.`;
  }
  return `Couldn't load ${thing} (${err?.code || "unknown error"}).`;
}
