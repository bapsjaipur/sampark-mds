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

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';

const PermissionsContext = createContext(null);

const emptyState = {
  loading: true,
  authUser: null,
  user: null, // alias of authUser, for Phase 4 callers expecting `user`
  volunteer: null,
  role: null,
  permissions: [],
  assignedAreas: [],
  assignedMandals: [],
  error: null,
};

export function PermissionsProvider({ children }) {
  const [state, setState] = useState(emptyState);

  useEffect(() => {
    let unsubVolunteer = () => {};
    let unsubRole = () => {};
    let heartbeatInterval = null;
    let autoLogoutTimer = null;

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
      unsubRole();
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      cleanupActivityListeners();

      if (!user) {
        setState({ ...emptyState, loading: false });
        return;
      }

      setupActivityListeners();

      setState((s) => ({ ...s, loading: true, authUser: user, user, error: null }));

      let stampedLogin = false;

      // Start the heartbeat!
      // Every 3 minutes, silently update lastSeenAt
      heartbeatInterval = setInterval(() => {
        if (auth.currentUser) {
           updateDoc(doc(db, 'volunteers', user.uid), { lastSeenAt: serverTimestamp() }).catch(() => {});
        }
      }, 3 * 60 * 1000);

      unsubVolunteer = onSnapshot(
        doc(db, 'volunteers', user.uid),
        (vSnap) => {
          if (!stampedLogin) {
            stampedLogin = true;
            updateDoc(doc(db, 'volunteers', user.uid), {
                lastLoginAt: serverTimestamp(),
                lastSeenAt: serverTimestamp()
            }).catch(() => {});
          }

          unsubRole();

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

          if (!volunteer.roleRef) {
            setState({
              loading: false,
              authUser: user,
              user,
              volunteer,
              role: null,
              permissions: [],
              assignedAreas: Array.isArray(volunteer.assignedAreas) ? volunteer.assignedAreas : [],
              assignedMandals: Array.isArray(volunteer.assignedMandals) ? volunteer.assignedMandals : [],
              error: null,
            });
            return;
          }

          unsubRole = onSnapshot(
            doc(db, 'roles', volunteer.roleRef),
            (rSnap) => {
              const role = rSnap.exists() ? { id: rSnap.id, ...rSnap.data() } : null;
              setState({
                loading: false,
                authUser: user,
                user,
                volunteer,
                role,
                permissions: role && Array.isArray(role.permissions) ? role.permissions : [],
                assignedAreas: Array.isArray(volunteer.assignedAreas) ? volunteer.assignedAreas : [],
                assignedMandals: Array.isArray(volunteer.assignedMandals) ? volunteer.assignedMandals : [],
                error: volunteer.roleRef && !role ? 'role-not-found' : null,
              });
            },
            (err) => setState((s) => ({ ...s, loading: false, error: err?.message || 'role-lookup-error' }))
          );
        },
        (err) => setState((s) => ({ ...s, loading: false, error: err?.message || 'volunteer-lookup-error' }))
      );
    });

    return () => {
      unsubAuth();
      unsubVolunteer();
      unsubRole();
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

  const value = { ...state, hasPermission, hasAnyPermission, hasAllPermissions };

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
