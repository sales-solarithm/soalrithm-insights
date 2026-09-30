'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { User, signOut as fbSignOut, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { COLLECTIONS } from '../config/schema';
import { INACTIVITY_LOGOUT_MESSAGE, isSessionStale, clearStoredActivity } from '../lib/inactivity';

/**
 * Clears everything session-scoped that is safe to drop when a session ends:
 * all of sessionStorage, and the shared last-activity marker.
 *
 * Deliberately does NOT call localStorage.clear(). This app keeps real
 * business data in localStorage -- notably saved salary slips (which are not
 * in Firestore), the slip-number counter, and any invoices not yet migrated
 * to Firestore -- and wiping those on an idle timeout would destroy records.
 */
function clearSessionCaches(): void {
  try {
    if (typeof window !== 'undefined') {
      window.sessionStorage.clear();
      clearStoredActivity(window.localStorage);
    }
  } catch {
    // storage unavailable -- nothing to clear
  }
}

export type AuthStatus = 'unauthenticated' | 'loading' | 'unauthorized' | 'authorized';

export interface OwnerProfile {
  id?: string;
  uid?: string;
  email?: string;
  name?: string;
  role?: string;
  assignedRole?: string;
  department?: string;
  designation?: string;
  phone?: string;
  [key: string]: any;
}

interface OwnerAuthContextType {
  status: AuthStatus;
  authUser: User | null;
  ownerProfile: OwnerProfile | null;
  detectedRole: string | null;
  authError: string | null;
  /** Non-error informational message for the login screen (e.g. idle timeout). */
  authNotice: string | null;
  isOwnerAuthorized: boolean;
  signOut: () => Promise<void>;
  /** End the session because of inactivity: clear caches, sign out, show notice. */
  expireSession: (message?: string) => Promise<void>;
  refreshAuth: () => Promise<void>;
  setAuthError: (err: string | null) => void;
  setAuthorizedOwner: (user: User | any, profile: OwnerProfile) => void;
  forceShowLogin: () => void;
  verifyAndAuthorizeUser: (user: User) => Promise<boolean>;
}

const OwnerAuthContext = createContext<OwnerAuthContextType | undefined>(undefined);

// Helper to enforce strict maximum execution timeout on asynchronous operations
function withTimeout<T>(promise: Promise<T>, timeoutMs: number = 5000, errorMsg?: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(errorMsg || `Operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((res) => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

export function OwnerAuthProvider({ children }: { children: React.ReactNode }) {
  // Real gate: starts in 'loading' until Firebase's auth state is known, then
  // becomes 'unauthenticated' (show login), 'unauthorized' (signed in but
  // not an owner -- already signed back out by the time this is set), or
  // 'authorized' (real owner, verified against Firestore).
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [ownerProfile, setOwnerProfile] = useState<OwnerProfile | null>(null);
  const [detectedRole, setDetectedRole] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);

  const isMountedRef = useRef(true);

  const ACCESS_DENIED_MESSAGE = 'Access Restricted: Only authorized Executive Owners can access this console.';

  const forceShowLogin = useCallback(() => {
    setStatus('unauthenticated');
    setAuthUser(null);
    setOwnerProfile(null);
    setDetectedRole(null);
  }, []);

  const setAuthorizedOwner = useCallback((user: User | any, profile: OwnerProfile) => {
    setAuthUser(user || null);
    setOwnerProfile(profile || { role: 'owner' });
    setDetectedRole('owner');
    setStatus('authorized');
    setAuthError(null);
    setAuthNotice(null);
  }, []);

  // Role verification method - invoked on every auth-state change (including
  // an existing session on page load) so a role change or revocation always
  // takes effect, not just at the moment of a fresh login.
  const verifyAndAuthorizeUser = useCallback(async (user: User): Promise<boolean> => {
    if (!db) {
      // No Firestore configured -- fail closed rather than silently granting access.
      if (isMountedRef.current) {
        setStatus('unauthorized');
        setAuthError(ACCESS_DENIED_MESSAGE);
      }
      return false;
    }

    try {
      let isOwner = false;
      let matchedProfile: OwnerProfile | null = null;
      let foundRole = '';

      // Direct document check: doc(db, 'users', user.uid)
      try {
        const userDocRef = doc(db, COLLECTIONS.USERS, user.uid);
        const userDocSnap = await getDoc(userDocRef);

        if (userDocSnap && userDocSnap.exists()) {
          const d = userDocSnap.data();
          foundRole = (d?.role || d?.assignedRole || d?.Role || '').toString().trim();
          matchedProfile = { id: userDocSnap.id, uid: user.uid, email: user.email || undefined, ...d };
          if (foundRole.toLowerCase() === 'owner') {
            isOwner = true;
          }
        }
      } catch (docErr) {
        console.warn('[OwnerAuth] Direct user doc lookup error:', docErr);
      }

      // Fall back only to querying Firestore 'users' by Email field if not resolved
      if (!isOwner && user.email) {
        try {
          const qEmail = query(collection(db, COLLECTIONS.USERS), where('email', '==', user.email));
          const snapEmail = await getDocs(qEmail);
          for (const docItem of snapEmail.docs) {
            const d = docItem.data();
            const r = (d?.role || d?.assignedRole || d?.Role || '').toString().trim();
            if (!foundRole) foundRole = r;
            matchedProfile = { id: docItem.id, uid: user.uid, email: user.email || undefined, ...d };
            if (r.toLowerCase() === 'owner') {
              isOwner = true;
              foundRole = r;
              break;
            }
          }
        } catch (emailQueryErr) {
          console.warn('[OwnerAuth] Email query error:', emailQueryErr);
        }
      }

      if (!isOwner) {
        // Strictly deny: sign the user out immediately, never leave a
        // non-owner session in an "authorized" or ambiguous state.
        try {
          await fbSignOut(auth);
        } catch (signOutErr) {
          console.warn('[OwnerAuth] Sign-out during denial failed:', signOutErr);
        }
        if (isMountedRef.current) {
          setAuthUser(null);
          setOwnerProfile(null);
          setDetectedRole(foundRole || null);
          setStatus('unauthorized');
          setAuthError(ACCESS_DENIED_MESSAGE);
        }
        return false;
      }

      if (isMountedRef.current) {
        setAuthUser(user);
        setOwnerProfile(matchedProfile);
        setDetectedRole(foundRole || 'owner');
        setStatus('authorized');
        setAuthError(null);
        setAuthNotice(null);
      }
      return true;
    } catch (err) {
      // Fail closed on an unexpected error -- never default to granting access.
      console.warn('[OwnerAuth] Verification error:', err);
      try {
        await fbSignOut(auth);
      } catch (signOutErr) {
        // already in an error path -- nothing further to do
      }
      if (isMountedRef.current) {
        setAuthUser(null);
        setOwnerProfile(null);
        setStatus('unauthorized');
        setAuthError('Unable to verify access. Please try signing in again.');
      }
      return false;
    }
  }, []);

  // Inactivity expiry: same teardown as a manual sign-out, plus a notice so
  // the login screen can explain why the user is there.
  const expireSession = useCallback(async (message: string = INACTIVITY_LOGOUT_MESSAGE) => {
    setAuthNotice(message);
    clearSessionCaches();
    try {
      if (auth) {
        await fbSignOut(auth);
      }
    } catch (err) {
      console.error('Sign out error during session expiry:', err);
    }
    if (isMountedRef.current) {
      setAuthUser(null);
      setOwnerProfile(null);
      setDetectedRole(null);
      setAuthError(null);
      setStatus('unauthenticated');
    }
  }, []);

  // Firebase auth state observer -- this is what makes the gate apply on
  // every page load, not just at the moment of a fresh login, so an
  // existing browser session is always re-checked against the current
  // Firestore role.
  useEffect(() => {
    isMountedRef.current = true;

    if (!auth) {
      setStatus('unauthenticated');
      return;
    }

    // The first callback of a page load is a *restored* persisted session
    // (or none); later callbacks are fresh sign-ins. Only a restored session
    // can be stale, so a tab closed for >15 minutes still needs a re-login,
    // while a brand-new login is never rejected by an old timestamp.
    let isInitialCallback = true;

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!isMountedRef.current) return;

      const isRestoredSession = isInitialCallback;
      isInitialCallback = false;

      if (user) {
        if (
          isRestoredSession &&
          typeof window !== 'undefined' &&
          isSessionStale(window.localStorage, Date.now())
        ) {
          await expireSession();
          return;
        }
        try {
          await verifyAndAuthorizeUser(user);
        } catch (err) {
          console.warn('[OwnerAuth] Session verification error:', err);
          setStatus('unauthenticated');
        }
      } else {
        setAuthUser(null);
        setOwnerProfile(null);
        setDetectedRole(null);
        setStatus('unauthenticated');
      }
    });

    return () => {
      isMountedRef.current = false;
      unsubscribe();
    };
  }, [verifyAndAuthorizeUser, expireSession]);

  const signOut = useCallback(async () => {
    try {
      if (auth) {
        await fbSignOut(auth);
      }
    } catch (err) {
      console.error('Sign out error:', err);
    }
    clearSessionCaches();
    setAuthUser(null);
    setOwnerProfile(null);
    setDetectedRole(null);
    setStatus('unauthenticated');
    setAuthError(null);
    setAuthNotice(null);
  }, []);

  const refreshAuth = useCallback(async () => {
    const currentUser = auth?.currentUser;
    if (currentUser) {
      await verifyAndAuthorizeUser(currentUser);
    }
  }, [verifyAndAuthorizeUser]);

  const isOwnerAuthorized = status === 'authorized';

  return (
    <OwnerAuthContext.Provider
      value={{
        status,
        authUser,
        ownerProfile,
        detectedRole,
        authError,
        authNotice,
        isOwnerAuthorized,
        signOut,
        expireSession,
        refreshAuth,
        setAuthError,
        setAuthorizedOwner,
        forceShowLogin,
        verifyAndAuthorizeUser
      }}
    >
      {children}
    </OwnerAuthContext.Provider>
  );
}

export function useOwnerAuth(): OwnerAuthContextType {
  const context = useContext(OwnerAuthContext);
  if (!context) {
    throw new Error('useOwnerAuth must be used within an OwnerAuthProvider');
  }
  return context;
}
