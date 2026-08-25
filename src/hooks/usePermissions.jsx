// src/hooks/usePermissions.jsx
// CANONICAL auth/permissions hook — merges Phase 2's context-based provider
// (one shared listener, clean DI everywhere via a hook) with Phase 4's
// onSnapshot-based live updates (permissions update immediately if an admin
// changes a role, instead of only on next login).
//
// Exposes BOTH names — usePermissions() (Phase 2 callers) and useAuth()
// (Phase 3/4 callers) — as aliases of the same context, so nothing else in
// the merged codebase needs to be renamed.
//
// ASSUMPTION (carried from Phase 2 & 4, and matches firestore.rules):
// volunteers/{id} doc ID === Firebase Auth uid. If your volunteer docs are
// keyed differently, this hook and firestore.rules both need to change from
// a direct doc() lookup to a query — rules can't run queries, so keying by
// uid at volunteer-creation time is strongly preferred over changing this.
//
// PHASE 21 — MULTIPLE ROLES PER VOLUNTEER.
// `volunteers/{uid}.roleRefs[]` is the new field; the old single `roleRef`
// string is still read as a fallback so nothing has to be migrated before this
// ships. Permissions are the UNION of every role's array — the same way a
// person who is both an Area Moderator and a caller holds both sets. Scope is
// the WIDEST of the roles' scopeKinds (see lib/scope.js for why).
//
// The roles collection is read as ONE collection listener rather than N doc
// listeners: it holds a handful of documents, `allow read: if isSignedIn()`
// already covers list, and a fixed single listener means adding a second role
// to a volunteer doesn't churn subscriptions mid-session.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { collection, doc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { resolveScope, SCOPE_KINDS } from '../lib/scope';
import { DEFAULT_ROLE_RANK } from '../constants/roleTemplates';
import { expandLegacyPermissions, isLegacyRole } from '../constants/permissions';
import { resetShared } from '../lib/sharedQuery';
import { getUsage, meterSnapshot, meterWrites } from '../lib/usageMeter';

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 24 — THE HEARTBEAT.
//
// `lastSeenAt` is what the Volunteers screen's "online now" dot reads. It used to
// be stamped every 3 minutes, unconditionally: 20 writes an hour, ~160 per person
// per day, and a phone left on the Contacts tab overnight kept spending them
// against a 20,000/day allowance shared by everyone.
//
// Two changes. The interval is 10 minutes, which is still well inside any sensible
// "seen recently" window. And it does not fire while the tab is hidden — a
// backgrounded tab is not somebody being present, which was the thing being
// measured. Together that is ~50 writes a day instead of ~160.
//
// The same write also carries this device's read/write tally, so the usage
// dashboard can add up the whole team without a single write of its own.
// ─────────────────────────────────────────────────────────────────────────────
const HEARTBEAT_MS = 10 * 60 * 1000;

const PermissionsContext = createContext(null);

/** roleRefs[] is authoritative; roleRef is the pre-Phase-21 single-role field. */
export function volunteerRoleIds(volunteer) {
  const many = Array.isArray(volunteer?.roleRefs) ? volunteer.roleRefs.filter(Boolean) : [];
  if (many.length) return Array.from(new Set(many));
  return volunteer?.roleRef ? [volunteer.roleRef] : [];
}

const emptyState = {
  loading: true,
  authUser: null,
  user: null, // alias of authUser, for Phase 4 callers expecting `user`
  volunteer: null,
  role: null,
  roles: [],
  roleIds: [],
  roleRank: 0,
  permissions: [],
  assignedAreas: [],
  assignedMandals: [],
  error: null,
};

/**
 * Merge a volunteer + the roles collection into the flat shape every caller
 * already expects. Pure, so the two listeners can each call it without caring
 * which of them fired last.
 */
function derive(volunteer, rolesById) {
  const roleIds = volunteerRoleIds(volunteer);
  const roles = roleIds.map((id) => rolesById[id]).filter(Boolean);

  const permissions = Array.from(
    new Set(roles.flatMap((r) => {
      const own = Array.isArray(r.permissions) ? r.permissions : [];
      // A role saved before Phase 21 keeps what its old broad permissions used
      // to include — see IMPLIED_PERMISSIONS. Any save on the Roles tab writes
      // the expanded list down and turns this off for that role.
      return isLegacyRole(r) ? expandLegacyPermissions(own) : own;
    }))
  );

  // The "primary" role — highest rank — is what badges and nav shaping use when
  // they need a single answer. Ties keep the first listed, so the order an admin
  // put the roles in is respected.
  const rank = (r) => (Number.isFinite(r?.rank) ? r.rank : DEFAULT_ROLE_RANK);
  const role = roles.reduce((best, r) => (best && rank(best) >= rank(r) ? best : r), null);

  return {
    roleIds,
    roles,
    role,
    roleRank: role ? rank(role) : 0,
    permissions,
    // 'role-not-found' means the volunteer points at a role document that has
    // been deleted. Reported only when NONE of their roles resolved — losing one
    // of three roles should not blank the session.
    missingRoles: roleIds.length > 0 && roles.length === 0,
  };
}

export function PermissionsProvider({ children }) {
  const [state, setState] = useState(emptyState);

  useEffect(() => {
    let unsubVolunteer = () => {};
    let unsubRoles = () => {};
    let heartbeatInterval = null;
    let autoLogoutTimer = null;

    // Latest value from each listener. Either can fire first, and the roles
    // listener keeps firing when an admin edits a role, so both are kept here
    // and re-merged on every event.
    let latestVolunteer = null;
    let latestRolesById = null; // null = roles not loaded yet

    // Reset inactivity timer on mouse/keyboard events
    const resetInactivityTimer = () => {
      if (autoLogoutTimer) clearTimeout(autoLogoutTimer);
      // 12 hours = 12 * 60 * 60 * 1000 = 43200000 ms
      autoLogoutTimer = setTimeout(() => {
        if (auth.currentUser) {
          signOut(auth).catch(() => {});
        }
      }, 43200000);
    };

    const setupActivityListeners = () => {
      window.addEventListener('mousemove', resetInactivityTimer);
      window.addEventListener('keypress', resetInactivityTimer);
      window.addEventListener('click', resetInactivityTimer);
      window.addEventListener('scroll', resetInactivityTimer);
      resetInactivityTimer();
    };

    const cleanupActivityListeners = () => {
      window.removeEventListener('mousemove', resetInactivityTimer);
      window.removeEventListener('keypress', resetInactivityTimer);
      window.removeEventListener('click', resetInactivityTimer);
      window.removeEventListener('scroll', resetInactivityTimer);
      if (autoLogoutTimer) clearTimeout(autoLogoutTimer);
    };

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      unsubVolunteer();
      unsubRoles();
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      cleanupActivityListeners();
      latestVolunteer = null;
      latestRolesById = null;
      // Every shared listener holds documents fetched under the PREVIOUS user's
      // security rules. Handing those to whoever signs in next on the same device
      // would be a real leak, so the stores are dropped here — before any of the
      // hooks that read them can mount for the new session.
      resetShared();

      if (!user) {
        setState({ ...emptyState, loading: false });
        return;
      }

      setupActivityListeners();

      setState((s) => ({ ...s, loading: true, authUser: user, user, error: null }));

      let stampedLogin = false;

      const publish = () => {
        // Wait for both listeners before publishing, otherwise the first paint
        // is a volunteer with zero permissions and every gated screen flashes
        // its "no access" state before correcting itself.
        if (!latestVolunteer || !latestRolesById) return;
        const d = derive(latestVolunteer, latestRolesById);
        setState({
          loading: false,
          authUser: user,
          user,
          volunteer: latestVolunteer,
          role: d.role,
          roles: d.roles,
          roleIds: d.roleIds,
          roleRank: d.roleRank,
          permissions: d.permissions,
          assignedAreas: Array.isArray(latestVolunteer.assignedAreas) ? latestVolunteer.assignedAreas : [],
          assignedMandals: Array.isArray(latestVolunteer.assignedMandals) ? latestVolunteer.assignedMandals : [],
          error: d.missingRoles ? 'role-not-found' : null,
        });
      };

      // The heartbeat. See the note at the top of the file for the arithmetic.
      // `usage` rides along on a write that was happening anyway, which is how the
      // usage dashboard can report the whole team's spend for free.
      const beat = () => {
        if (!auth.currentUser) return;
        if (typeof document !== 'undefined' && document.hidden) return;
        const u = getUsage();
        updateDoc(doc(db, 'volunteers', user.uid), {
          lastSeenAt: serverTimestamp(),
          usage: {
            day: u.day,
            reads: u.reads,
            writes: u.writes,
            deletes: u.deletes,
            at: Date.now(),
          },
        }).then(() => meterWrites(1, 'heartbeat')).catch(() => {});
      };
      heartbeatInterval = setInterval(beat, HEARTBEAT_MS);

      unsubRoles = onSnapshot(
        collection(db, 'roles'),
        (snap) => {
          meterSnapshot(snap, 'roles');
          const map = {};
          snap.forEach((d) => { map[d.id] = { id: d.id, ...d.data() }; });
          latestRolesById = map;
          publish();
        },
        (err) => setState((s) => ({ ...s, loading: false, error: err?.message || 'role-lookup-error' }))
      );

      unsubVolunteer = onSnapshot(
        doc(db, 'volunteers', user.uid),
        (vSnap) => {
          meterSnapshot(vSnap, 'my volunteer doc');
          if (!stampedLogin) {
            stampedLogin = true;
            const u = getUsage();
            updateDoc(doc(db, 'volunteers', user.uid), {
              lastLoginAt: serverTimestamp(),
              lastSeenAt: serverTimestamp(),
              usage: { day: u.day, reads: u.reads, writes: u.writes, deletes: u.deletes, at: Date.now() },
            }).then(() => meterWrites(1, 'login stamp')).catch(() => {});
          }

          if (!vSnap.exists()) {
            setState({ ...emptyState, loading: false, authUser: user, user, error: 'no-volunteer-doc' });
            return;
          }

          const volunteer = { id: vSnap.id, ...vSnap.data() };

          // If the account was deactivated by an admin, log them out immediately
          if (volunteer.isActive === false) {
            signOut(auth).catch(() => {});
            setState({ ...emptyState, loading: false, error: 'account-disabled' });
            return;
          }

          latestVolunteer = volunteer;

          if (volunteerRoleIds(volunteer).length === 0) {
            // No role at all — publish immediately rather than waiting on the
            // roles listener, since it can never change this outcome.
            setState({
              ...emptyState,
              loading: false,
              authUser: user,
              user,
              volunteer,
              assignedAreas: Array.isArray(volunteer.assignedAreas) ? volunteer.assignedAreas : [],
              assignedMandals: Array.isArray(volunteer.assignedMandals) ? volunteer.assignedMandals : [],
              error: null,
            });
            return;
          }

          publish();
        },
        (err) => setState((s) => ({ ...s, loading: false, error: err?.message || 'volunteer-lookup-error' }))
      );
    });

    return () => {
      unsubAuth();
      unsubVolunteer();
      unsubRoles();
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      cleanupActivityListeners();
    };
  }, []);

  const hasPermission = useCallback((permission) => state.permissions.includes(permission), [state.permissions]);
  const hasAnyPermission = useCallback(
    (permissionList = []) => permissionList.some((p) => state.permissions.includes(p)),
    [state.permissions]
  );
  const hasAllPermissions = useCallback(
    (permissionList = []) => permissionList.every((p) => state.permissions.includes(p)),
    [state.permissions]
  );

  // The resolved area × mandal territory. Recomputed only when its inputs move,
  // because it is passed into useMemo dependency arrays all over the app and an
  // identity change on every render would re-filter every list.
  const scope = useMemo(
    () => resolveScope({
      roles: state.roles,
      volunteer: state.volunteer,
      permissions: state.permissions,
    }),
    [state.roles, state.volunteer, state.permissions]
  );

  const value = {
    ...state,
    scope,
    scopeKind: scope.kind,
    isScoped: !scope.unrestricted && scope.kind !== SCOPE_KINDS.NONE,
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
  };

  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
}

// Alias — Phase 3's App.jsx used <AuthProvider>. Both names now point to the
// same provider so no call sites needed renaming at merge time.
export const AuthProvider = PermissionsProvider;

export function usePermissions() {
  const ctx = useContext(PermissionsContext);
  if (!ctx) throw new Error('usePermissions() must be used inside a <PermissionsProvider>');
  return ctx;
}

// Alias — Phase 3/4 components call useAuth().
export const useAuth = usePermissions;
