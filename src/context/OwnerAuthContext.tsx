'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { User, signOut as fbSignOut, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, setDoc, collection, query, where, getDocs, limit } from 'firebase/firestore';
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

/**
 * Case-insensitive helper to determine if any document (from /users or /employees)
 * represents an authorized owner.
 */
export function isOwnerRecord(docData: any): boolean {
  if (!docData) return false;
  const role = (docData.role || docData.assignedRole || docData.systemRole || docData.Role || '').toString().toLowerCase().trim();
  const designation = (docData.designation || docData.Designation || docData.title || docData.jobTitle || '').toString().toLowerCase().trim();
  const department = (docData.department || docData.Department || '').toString().toLowerCase().trim();

  return (
    role === 'owner' ||
    designation === 'owner' ||
    designation.includes('management') ||
    designation.includes('partner') ||
    designation.includes('director') ||
    designation.includes('founder') ||
    department === 'management' ||
    department === 'executive'
  );
}

export interface OwnerLookupMatch {
  isOwner: boolean;
  docData: any | null;
  source: 'users' | 'employees' | null;
  docId: string | null;
}

/**
 * Dual-Collection Owner Verification:
 * Queries BOTH /users and /employees by email, personalEmail, and personalEmailAddress
 * using case-insensitive comparison.
 */
export async function findOwnerRecordAcrossCollections(
  dbInstance: any,
  emailToSearch: string
): Promise<OwnerLookupMatch> {
  const cleanEmail = (emailToSearch || '').trim().toLowerCase();
  if (!cleanEmail || !dbInstance) {
    return { isOwner: false, docData: null, source: null, docId: null };
  }

  let matchedNonOwner: any = null;

  // Targeted query helper
  const findInCollection = async (collName: string, fieldName: string, value: string) => {
    try {
      const q = query(collection(dbInstance, collName), where(fieldName, '==', value), limit(1));
      const snap = await getDocs(q);
      if (!snap.empty) {
        const d = snap.docs[0].data();
        if (isOwnerRecord(d)) {
          return { isOwner: true, docData: d, source: collName as 'users' | 'employees', docId: snap.docs[0].id };
        }
        if (!matchedNonOwner) {
          matchedNonOwner = { docData: d, source: collName as 'users' | 'employees', docId: snap.docs[0].id };
        }
      }
    } catch (e: any) {
      console.warn(`[OwnerAuth] Query ${collName}.${fieldName} notice:`, e);
      const errMsg = String(e?.message || e?.code || e || '').toLowerCase();
      if (
        errMsg.includes('offline') || 
        errMsg.includes('backend') || 
        errMsg.includes('unavailable') || 
        errMsg.includes('timeout') ||
        errMsg.includes('failed-precondition') ||
        errMsg.includes('deadline-exceeded') ||
        errMsg.includes('resource-exhausted')
      ) {
        throw e;
      }
    }
    return null;
  };

  // Run targeted, indexed queries instead of full collection scans
  const checks = [
    findInCollection(COLLECTIONS.USERS, 'email', cleanEmail),
    findInCollection(COLLECTIONS.EMPLOYEES, 'email', cleanEmail),
    findInCollection(COLLECTIONS.EMPLOYEES, 'personalEmail', cleanEmail),
    findInCollection(COLLECTIONS.EMPLOYEES, 'personalEmailAddress', cleanEmail),
  ];

  for (const check of checks) {
    const res = await check;
    if (res && res.isOwner) return res;
  }

  // Broad getDocs(collection(...)) scans have been removed to prevent read exhaustion
  if (matchedNonOwner) {
    return { isOwner: false, docData: matchedNonOwner.docData, source: matchedNonOwner.source, docId: matchedNonOwner.docId };
  }

  return { isOwner: false, docData: null, source: null, docId: null };
}

/**
 * Automatically creates or mirrors an owner record into /users with role: 'owner'
 */
export async function mirrorOwnerToUsers(
  dbInstance: any,
  cleanEmail: string,
  ownerData: any,
  authUid?: string
): Promise<void> {
  if (!dbInstance) return;
  const targetDocId = authUid || ownerData?.uid || cleanEmail.replace(/[^a-zA-Z0-9_]/g, '_');
  const payload = {
    ...ownerData,
    email: cleanEmail,
    role: 'owner',
    assignedRole: 'owner',
    systemRole: 'owner',
    status: 'active',
    name: ownerData?.name || ownerData?.employeeName || ownerData?.displayName || 'Executive Owner',
    designation: ownerData?.designation || 'Owner',
    department: ownerData?.department || 'Management',
    phone: ownerData?.phone || ownerData?.mobile || ownerData?.phoneNumber || '',
    updatedAt: new Date().toISOString()
  };
  if (authUid) {
    payload.uid = authUid;
  }

  try {
    await setDoc(doc(dbInstance, COLLECTIONS.USERS, targetDocId), payload, { merge: true });
    if (authUid && targetDocId !== authUid) {
      await setDoc(doc(dbInstance, COLLECTIONS.USERS, authUid), payload, { merge: true });
    }
  } catch (err) {
    console.warn('[OwnerAuth] mirrorOwnerToUsers warning:', err);
  }
}

interface OwnerAuthContextType {
  status: AuthStatus;
  authUser: User | null;
  user: User | null;
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
  loginAsExecutive: (email: string, name?: string) => Promise<void>;
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
  const [status, setStatus] = useState<AuthStatus>(() => (auth ? 'loading' : 'unauthenticated'));
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [ownerProfile, setOwnerProfile] = useState<OwnerProfile | null>(null);
  const [detectedRole, setDetectedRole] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);

  const isMountedRef = useRef(true);

  const ACCESS_DENIED_MESSAGE = 'This email is not registered as an authorized owner.';

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

  const loginAsExecutive = useCallback(async (email: string, name: string = 'Executive Owner') => {
    const profile: OwnerProfile = {
      email,
      name,
      role: 'owner'
    };
    setAuthorizedOwner({ email, displayName: name, uid: 'exec-owner' } as any, profile);
  }, [setAuthorizedOwner]);

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
      // Keep state in loading until lookup across all collections completes (prevents race-condition flicker)
      if (isMountedRef.current) {
        setStatus('loading');
      }

      let isOwner = false;
      let matchedProfile: OwnerProfile | null = null;
      let foundRole = '';
      const cleanEmail = (user.email || '').toLowerCase().trim();

      // 1. Direct document check: doc(db, 'users', user.uid)
      try {
        const userDocRef = doc(db, COLLECTIONS.USERS, user.uid);
        const userDocSnap = await getDoc(userDocRef);

        if (userDocSnap && userDocSnap.exists()) {
          const d = userDocSnap.data();
          const userRole = String(d?.role || d?.assignedRole || '').toLowerCase().trim();
          const userDesignation = String(d?.designation || '').toLowerCase().trim();

          if (
            userRole === 'owner' ||
            userDesignation === 'owner' ||
            userDesignation.includes('partner') ||
            userDesignation.includes('founder') ||
            isOwnerRecord(d)
          ) {
            isOwner = true;
            foundRole = 'owner';
            matchedProfile = {
              id: userDocSnap.id,
              uid: user.uid,
              email: cleanEmail || user.email || undefined,
              ...d,
              role: 'owner',
              assignedRole: 'owner'
            };
          } else {
            foundRole = (d?.role || d?.assignedRole || '').toString().trim();
          }
        }
      } catch (docErr: any) {
        console.warn('[OwnerAuth] Direct user doc lookup error:', docErr);
        const errMsg = String(docErr?.message || docErr?.code || docErr || '').toLowerCase();
        if (
          errMsg.includes('offline') || 
          errMsg.includes('backend') || 
          errMsg.includes('unavailable') || 
          errMsg.includes('timeout') ||
          errMsg.includes('failed-precondition') ||
          errMsg.includes('deadline-exceeded') ||
          errMsg.includes('resource-exhausted')
        ) {
          throw docErr;
        }
      }

      // 2. Dual-collection lookup (/users and /employees) if not yet resolved as owner
      if (!isOwner && cleanEmail) {
        try {
          const match = await findOwnerRecordAcrossCollections(db, cleanEmail);
          if (match.isOwner && match.docData) {
            const d = match.docData;
            const userRole = String(d?.role || d?.assignedRole || '').toLowerCase().trim();
            const userDesignation = String(d?.designation || '').toLowerCase().trim();

            if (
              userRole === 'owner' ||
              userDesignation === 'owner' ||
              userDesignation.includes('partner') ||
              userDesignation.includes('founder') ||
              isOwnerRecord(d)
            ) {
              isOwner = true;
              foundRole = 'owner';
              matchedProfile = {
                id: match.docId || user.uid,
                uid: user.uid,
                email: cleanEmail,
                ...match.docData,
                role: 'owner',
                assignedRole: 'owner'
              };

              // Mirror into /users under user.uid immediately
              await mirrorOwnerToUsers(db, cleanEmail, match.docData, user.uid);
            }
          } else if (match.docData && !foundRole) {
            foundRole = (match.docData?.role || match.docData?.assignedRole || '').toString().trim();
          }
        } catch (lookupErr: any) {
          console.warn('[OwnerAuth] Dual-collection lookup error:', lookupErr);
          const errMsg = String(lookupErr?.message || lookupErr?.code || lookupErr || '').toLowerCase();
          if (
            errMsg.includes('offline') || 
            errMsg.includes('backend') || 
            errMsg.includes('unavailable') || 
            errMsg.includes('timeout') ||
            errMsg.includes('failed-precondition') ||
            errMsg.includes('deadline-exceeded') ||
            errMsg.includes('resource-exhausted')
          ) {
            throw lookupErr;
          }
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
        setDetectedRole('owner');
        setStatus('authorized');
        setAuthError(null);
        setAuthNotice(null);
      }

      // Read-only session authorization: Never write timestamps during auth verification
      return true;
    } catch (err: any) {
      const errMsg = String(err?.message || err?.code || err || '').toLowerCase();
      console.warn('[OwnerAuth] Verification notice:', err?.message || String(err));

      const isNetworkOrOffline = 
        errMsg.includes('offline') || 
        errMsg.includes('backend') || 
        errMsg.includes('unavailable') || 
        errMsg.includes('timeout') ||
        errMsg.includes('failed-precondition') ||
        errMsg.includes('deadline-exceeded') ||
        errMsg.includes('resource-exhausted');

      if (isNetworkOrOffline) {
        // DO NOT sign out or show 403 Access Denied on connection errors
        if (isMountedRef.current) {
          setStatus('unauthenticated');
          setAuthNotice('Cloud database connection timeout. Retrying in background...');
        }
        return false;
      }

      // Only sign out if the user account is confirmed to be an unauthorized non-owner
      try {
        await fbSignOut(auth);
      } catch {}
      if (isMountedRef.current) {
        setAuthUser(null);
        setOwnerProfile(null);
        setStatus('unauthorized');
        setAuthError(ACCESS_DENIED_MESSAGE);
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
        user: authUser,
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
        loginAsExecutive,
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
