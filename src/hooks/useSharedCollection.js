// src/hooks/useSharedCollection.js
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 24 — the React face of src/lib/sharedQuery.js.
//
// Give it a list of query specs and it returns their rows merged and de-duplicated
// by document id. The list matters for one case in particular: a UNION scope
// ("everyone in my areas, PLUS everyone in my mandals") cannot be one Firestore
// query — only a single `in` clause is allowed per query — so it is two listeners
// whose results overlap wherever a person is in both. Merging by id is what makes
// that look like one list.
//
// Pass `specs: null` (or an empty array) for "this scope matches nothing" — the
// hook settles on an empty, non-loading result WITHOUT opening a listener, which
// is how a NONE-scoped volunteer costs zero reads.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from 'react';
import { subscribeShared } from '../lib/sharedQuery';

/**
 * @param {Array<{key:string, build:() => import('firebase/firestore').Query, source?:string}>|null} specs
 * @returns {{ rows: any[], loading: boolean, error: Error|null, fromCache: boolean }}
 */
export function useSharedCollection(specs) {
  const list = useMemo(() => (specs || []).filter((s) => s && s.key && s.build), [specs]);
  // The identity of `specs` changes on every render at most call sites; the KEYS
  // are what decide whether we are watching the same thing, so they drive the
  // effect and the array itself is read through a ref.
  const keysKey = list.map((s) => s.key).join('|');
  const listRef = useRef(list);
  listRef.current = list;

  const [state, setState] = useState(() => ({
    rows: [], loading: list.length > 0, error: null, fromCache: true,
  }));

  useEffect(() => {
    const specsNow = listRef.current;
    if (!specsNow.length) {
      setState({ rows: [], loading: false, error: null, fromCache: false });
      return undefined;
    }

    // One slot per spec. Each shared store reports into its slot; the slots are
    // then flattened, so a slow second listener never blanks the first one's rows.
    const slots = specsNow.map(() => ({ rows: [], loading: true, error: null, fromCache: true }));

    const publish = () => {
      if (slots.length === 1) {
        setState({ ...slots[0] });
        return;
      }
      const byId = new Map();
      slots.forEach((slot) => slot.rows.forEach((row) => { if (!byId.has(row.id)) byId.set(row.id, row); }));
      setState({
        rows: [...byId.values()],
        // Show rows as soon as ANY listener has them; a UNION's two halves rarely
        // arrive together and waiting for both just makes the page feel slower.
        loading: slots.every((s) => s.loading),
        error: slots.find((s) => s.error)?.error || null,
        fromCache: slots.every((s) => s.fromCache),
      });
    };

    const unsubs = specsNow.map((spec, i) => subscribeShared(
      spec.key,
      spec.build,
      (payload) => { slots[i] = payload; publish(); },
      spec.source,
    ));

    return () => unsubs.forEach((fn) => fn());
  }, [keysKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return state;
}
