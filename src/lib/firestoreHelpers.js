// Firestore 'in' queries are capped at 30 values, so any list-scoped query
// (assignedAreas, assignedMandals, householdIds, etc.) needs chunking.
export function chunk(arr, size = 30) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
