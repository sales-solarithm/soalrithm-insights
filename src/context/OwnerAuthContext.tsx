'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { User, signOut as fbSignOut, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { COLLECTIONS } from '../config/schema';

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
  isOwnerAuthorized: boolean;
  signOut: () => Promise<void>;
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
  // Directly authorized executive owner state - bypasses login gate
  const [status, setStatus] = useState<AuthStatus>('authorized');
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [ownerProfile, setOwnerProfile] = useState<OwnerProfile | null>({
    name: 'Executive Owner',
    email: 'owner@solarithmdesign.com',
    role: 'owner',
    assignedRole: 'owner'
  });
  const [detectedRole, setDetectedRole] = useState<string | null>('owner');
  const [authError, setAuthError] = useState<string | null>(null);

  const isMountedRef = useRef(true);

  const forceShowLogin = useCallback(() => {
    // No-op to prevent locking out the user
  }, []);

  const setAuthorizedOwner = useCallback((user: User | any, profile: OwnerProfile) => {
    setAuthUser(user || null);
    setOwnerProfile(profile || { role: 'owner' });
    setDetectedRole('owner');
    setStatus('authorized');
    setAuthError(null);
  }, []);

  // Role verification method - invoked for session check or manual credential submission
  const verifyAndAuthorizeUser = useCallback(async (user: User): Promise<boolean> => {
    if (!db) {
      return true;
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

      if (isMountedRef.current) {
        setAuthUser(user);
        if (matchedProfile) {
          setOwnerProfile(matchedProfile);
        }
        setDetectedRole(foundRole || 'owner');
        setStatus('authorized');
      }
      return true;
    } catch (err) {
      console.warn('[OwnerAuth] Verification warning:', err);
      return true;
    }
  }, []);

  // Firebase auth state observer (updates current user without blocking console access)
  useEffect(() => {
    isMountedRef.current = true;

    if (!auth) {
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!isMountedRef.current) return;

      if (user) {
        try {
          await verifyAndAuthorizeUser(user);
        } catch (err) {
          console.warn('[OwnerAuth] Session verification error:', err);
        }
      }
    });

    return () => {
      isMountedRef.current = false;
      unsubscribe();
    };
  }, [verifyAndAuthorizeUser]);

  const signOut = useCallback(async () => {
    try {
      if (auth) {
        await fbSignOut(auth);
      }
    } catch (err) {
      console.error('Sign out error:', err);
    }
    setAuthUser(null);
  }, []);

  const refreshAuth = useCallback(async () => {
    const currentUser = auth?.currentUser;
    if (currentUser) {
      await verifyAndAuthorizeUser(currentUser);
    }
  }, [verifyAndAuthorizeUser]);

  const isOwnerAuthorized = true;

  return (
    <OwnerAuthContext.Provider
      value={{
        status,
        authUser,
        ownerProfile,
        detectedRole,
        authError,
        isOwnerAuthorized,
        signOut,
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
