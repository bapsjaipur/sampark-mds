// src/lib/sharedQuery.js
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 24 — ONE LISTENER PER QUERY, FOR THE WHOLE APP.
//
// The problem this solves is arithmetic. `useHouseholds()` is called by
// ContactsPage, HouseholdsPage, HouseholdDetailPage, EventsPage and BatchesPage;
// `useAreasAndMandals()` by a dozen forms. Every mount used to open its OWN
// onSnapshot, and every listener's first snapshot bills one read per document. So
// walking Contacts → Households → Events cost three full sweeps of the same 420
// documents, and going back cost them again.
//
// Here a query is identified by a string key. The first subscriber opens the
// listener; every later subscriber gets the snapshot already in hand — instantly,
// and for nothing. When the last one leaves the listener is kept alive for a grace
// period, because navigation is the common case and a re-attach two seconds later
// would throw away a warm resume token.
//
// This is not a cache with its own staleness rules: it is exactly one onSnapshot
// shared by N components, so every subscriber still sees live updates and nobody
// has to think about invalidation.
//
// resetShared() MUST be called when the signed-in user changes. The rows in here
// were fetched under the previous user's security rules, and handing them to the
// next person who signs in on the same device would be a real leak.
// ─────────────────────────────────────────────────────────────────────────────
import { onSnapshot } from 'firebase/firestore';
import { meterSnapshot } from './usageMeter';

/** How long a listener with no subscribers is kept open, in ms. Long enough to
 *  cover navigation and a modal open/close; short enough that a page nobody is
 *  looking at stops streaming. */
const GRACE_MS = 5 * 60 * 1000;

/** key → { unsub, teardown, subs:Set, rows, error, loading, fromCache, source } */
const stores = new Map();

function emit(store) {
  const payload = {
    rows: store.rows,
    loading: store.loading,
    error: store.error,
    fromCache: store.fromCache,
  };
  store.subs.forEach((fn) => {
    try { fn(payload); } catch (err) { console.error('[sharedQuery] subscriber threw', err); }
  });
}

function open(key, buildQuery, source) {
  const store = {
    subs: new Set(),
    rows: [],
    loading: true,
    error: null,
    fromCache: true,
    teardown: null,
    source: source || key,
    unsub: () => {},
  };
  stores.set(key, store);

  store.unsub = onSnapshot(
    buildQuery(),
    (snap) => {
      // Billed here, once, no matter how many components are watching — which is
      // the whole point of the file.
      meterSnapshot(snap, store.source);
      store.rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      store.loading = false;
      store.error = null;
      store.fromCache = Boolean(snap.metadata?.fromCache);
      emit(store);
    },
    (err) => {
      store.loading = false;
      store.error = err;
      emit(store);
    },
  );

  return store;
}

/**
 * subscribeShared(key, buildQuery, listener, source) → unsubscribe
 *
 * `key` must encode everything about the query, including the scope values it was
 * built from — two volunteers with different areas must not share a store.
 * `buildQuery` is called at most once per key and must be side-effect free.
 * `listener` is called immediately with whatever is already known (so a second
 * subscriber paints on the same frame) and then on every snapshot.
 */
export function subscribeShared(key, buildQuery, listener, source) {
  let store = stores.get(key);
  if (store) {
    // Reclaimed before the grace period expired: the listener is still warm and
    // this subscriber costs nothing at all.
    if (store.teardown) { clearTimeout(store.teardown); store.teardown = null; }
  } else {
    store = open(key, buildQuery, source);
  }

  store.subs.add(listener);
  listener({ rows: store.rows, loading: store.loading, error: store.error, fromCache: store.fromCache });

  return () => {
    store.subs.delete(listener);
    if (store.subs.size > 0 || store.teardown) return;
    store.teardown = setTimeout(() => {
      if (store.subs.size > 0) { store.teardown = null; return; }
      store.unsub();
      stores.delete(key);
    }, GRACE_MS);
  };
}

/** Close every shared listener and forget every row. Call on sign-in/sign-out. */
export function resetShared() {
  stores.forEach((store) => {
    if (store.teardown) clearTimeout(store.teardown);
    store.unsub();
    store.rows = [];
    store.loading = true;
    store.error = null;
    emit(store);
  });
  stores.clear();
}

/** Diagnostics for the usage dashboard: what is currently streaming, and how big. */
export function sharedStores() {
  return [...stores.entries()].map(([key, s]) => ({
    key,
    source: s.source,
    docs: s.rows.length,
    watchers: s.subs.size,
    idle: Boolean(s.teardown),
  }));
}
