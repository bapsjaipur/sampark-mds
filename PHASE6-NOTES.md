# Phase 6 — Events/Sabha + Attendance + Offline Support

## New collections

### `events/{eventId}`
```
{
  title: string,
  date: string,          // "YYYY-MM-DD"
  time: string,           // "HH:MM", 24-hour
  durationMinutes: number,
  speaker: string,
  mandal: string | null,  // null = open to all Mandals
  area: string | null,    // null = open to all areas
  createdBy: string,
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

### `attendance/{eventId}_{individualId}`
```
{
  eventId: string,
  individualId: string,
  status: "present",
  markedBy: string,   // volunteerId
  markedAt: Timestamp
}
```

## Why attendance is its own collection, not a column

The legacy `index__1_.html` app tracks attendance by **dynamically adding a
new spreadsheet column for every event** (e.g. a column named after the
Sabha), then writing `"Present"` into that column for each attendee's row.
That's a workable pattern in a spreadsheet, but it doesn't translate to
Firestore — "add a new field to every document, forever, once per event"
doesn't scale in a document database, and would make `individuals` documents
grow without bound.

Instead: a normal long-format `attendance` collection, one doc per
person-per-event. Doc ID is deterministic (`${eventId}_${individualId}`),
which makes marking present idempotent (marking twice doesn't duplicate) and
makes "unmark" a simple delete. This also makes both directions of query
cheap: "who attended event X" (`where('eventId', '==', X)`) and "this
person's attendance history" (`where('individualId', '==', id)`), which the
column-per-event approach couldn't do at all without scanning every column.

## Attendance window

Ported exactly from the legacy `checkAttendanceWindow()`: marking opens 30
minutes before an event's start time and stays open until 30 minutes after
it ends (`start + durationMinutes`). See `src/lib/attendanceWindow.js`.

**This window is enforced client-side only**, matching the legacy app's own
behavior (it also only ever disabled UI, not a server-side check).
`firestore.rules` gates attendance writes by `edit_contacts` permission, not
by the time window — adding that would mean every single check-in write
reads the parent `events` doc and does time-math inside a security rule.
Doable, but adds `get()` cost to a high-frequency write (every attendance
mark). Flagged as a deliberate trade-off; revisit if abuse becomes a real
problem (e.g. people marking attendance for events days away).

## New permission

`manage_events` — gates creating/editing/deleting events. Marking
attendance itself uses the existing `edit_contacts` permission (any
karyekar running the calling flow at a Sabha needs to check people in, not
just the event's organizer).

## Offline support (Phase 10, bundled in here since it was nearly free)

`src/lib/firebase.js` now initializes Firestore with `persistentLocalCache`
+ `persistentMultipleTabManager`. This gives most of the legacy app's
"queue actions while offline, sync on reconnect" behavior for free — reads
serve from the local cache instantly, and writes queue locally and flush
automatically when connectivity returns. No hand-rolled offline queue was
needed. One caveat: this is a *client* cache, not a guarantee — if a device
is offline long enough that its local queue never flushes (app uninstalled,
storage cleared), those writes are lost, same as the legacy app's own
`localStorage`-based queue would have been.

## Still to come (per the agreed build order)

- Phase 7: Calling flow (volunteer's daily batch workflow)
- Phase 8: Admin stats dashboard
- Phase 9: Moderator screen
