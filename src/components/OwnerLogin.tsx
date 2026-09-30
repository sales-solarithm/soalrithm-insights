'use client';
import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, 
  Lock, 
  Mail, 
  Eye, 
  EyeOff, 
  AlertCircle, 
  ArrowRight,
  LayoutGrid,
  Clock
} from 'lucide-react';
import { 
  signInWithEmailAndPassword, 
  signOut 
} from 'firebase/auth';
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  doc, 
  getDoc, 
  addDoc 
} from 'firebase/firestore';
import { auth, db } from '@/src/lib/firebase';
import { COLLECTIONS } from '@/src/config/schema';
import { useOwnerAuth } from '@/src/context/OwnerAuthContext';

function withTimeout<T>(promise: Promise<T>, timeoutMs: number = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Firestore operation timed out after ${timeoutMs}ms`));
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

interface OwnerLoginProps {
  onSuccess: (userProfile: any) => void;
  externalError?: string | null;
  /** Informational (non-error) message, e.g. "session expired due to inactivity". */
  externalNotice?: string | null;
}

export default function OwnerLogin({ onSuccess, externalError, externalNotice }: OwnerLoginProps) {
  const { setAuthorizedOwner } = useOwnerAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(externalError || null);
  const [prevExternalError, setPrevExternalError] = useState<string | null | undefined>(externalError);

  if (externalError !== prevExternalError) {
    setPrevExternalError(externalError);
    if (externalError) {
      setError(externalError);
    }
  }

  const handleLogin = async (e?: React.FormEvent | React.MouseEvent) => {
    if (e && typeof e.preventDefault === 'function') {
      e.preventDefault();
    }

    if (!email.trim() || !password) {
      setError('Please provide both your email address and password.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      if (!auth) {
        throw new Error('Firebase Authentication is not initialized.');
      }

      // 1. Sign in with Firebase Auth
      const userCredential = await withTimeout(
        signInWithEmailAndPassword(auth, email.trim(), password),
        8000
      );
      const user = userCredential.user;

      if (!user) {
        throw new Error('Authentication failed: No user returned.');
      }

      // 2. On success: Check if user document in Firestore has role === "owner"
      let isOwner = false;
      let userProfileData: any = null;
      let detectedUserRole = '';

      if (db) {
        // Direct document check: doc(db, 'users', user.uid)
        try {
          const userDocRef = doc(db, COLLECTIONS.USERS, user.uid);
          const userDocSnap = await withTimeout(getDoc(userDocRef), 5000);

          if (userDocSnap && userDocSnap.exists()) {
            const data = userDocSnap.data();
            const r = (data?.role || data?.assignedRole || data?.Role || data?.userRole || '').toString().trim();
            if (r) detectedUserRole = r;
            if (r.toLowerCase() === 'owner') {
              isOwner = true;
              userProfileData = { id: userDocSnap.id, uid: user.uid, email: user.email || undefined, ...data };
            }
          }
        } catch (docErr) {
          console.warn('[OwnerLogin] User doc lookup warning:', docErr);
        }

        // Fall back only to querying 'users' by email if document lookup by UID didn't resolve owner status
        if (!isOwner && user.email) {
          try {
            const qEmail = query(collection(db, COLLECTIONS.USERS), where('email', '==', user.email));
            const snapEmail = await withTimeout(getDocs(qEmail), 5000);
            for (const docItem of snapEmail.docs) {
              const data = docItem.data();
              const r = (data?.role || data?.assignedRole || data?.Role || data?.userRole || '').toString().trim();
              if (r && !detectedUserRole) detectedUserRole = r;
              if (r.toLowerCase() === 'owner') {
                isOwner = true;
                userProfileData = { id: docItem.id, uid: user.uid, email: user.email || undefined, ...data };
                break;
              }
            }
          } catch (emailErr) {
            console.warn('[OwnerLogin] Email query warning:', emailErr);
          }
        }
      }

      if (!isOwner) {
        if (auth) {
          await signOut(auth).catch(() => {});
        }
        setError('Access Restricted: Only authorized Executive Owners can access this console.');
        setLoading(false);
        return;
      }

      // Record successful login audit log
      try {
        if (db) {
          await addDoc(collection(db, COLLECTIONS.AUDIT_LOGS), {
            action: 'OWNER_LOGIN_SUCCESS',
            actor: user.email || email.trim(),
            target: 'Solarithm Insight',
            details: { uid: user.uid, role: 'owner' },
            timestamp: new Date().toISOString()
          });
        }
      } catch (logErr) {
        console.warn('Could not record login audit log:', logErr);
      }

      // Valid: set authenticated state to true and immediately transition to the main dashboard view
      const profile = userProfileData || { uid: user.uid, email: user.email, role: 'owner' };
      if (setAuthorizedOwner) {
        setAuthorizedOwner(user, profile);
      }
      onSuccess(profile);
    } catch (err: any) {
      console.error('Login error:', err);
      let message = 'Failed to authenticate. Please verify your credentials.';
      const errorCode = err?.code || '';

      if (err?.message?.includes('timed out')) {
        message = 'Authentication request timed out. Please check your network or credentials.';
      } else if (
        errorCode === 'auth/wrong-password' ||
        errorCode === 'auth/invalid-credential' ||
        errorCode === 'auth/invalid-login-credentials'
      ) {
        message = 'Invalid email or password. Please check your credentials and try again.';
      } else if (errorCode === 'auth/user-not-found') {
        message = 'No account found with this email address. Please verify your email.';
      } else if (errorCode === 'auth/invalid-email') {
        message = 'Please enter a valid email address.';
      } else if (errorCode === 'auth/too-many-requests') {
        message = 'Too many failed login attempts. Please wait a few minutes or reset your password.';
      } else if (errorCode === 'auth/network-request-failed') {
        message = 'Network error: Please check your internet connection and try again.';
      } else if (errorCode === 'auth/user-disabled') {
        message = 'This account has been disabled. Please contact system support.';
      } else if (err?.message) {
        const cleanMsg = err.message.replace(/^Firebase:\s*/, '').replace(/\s*\(auth\/[^)]+\)\.?$/, '');
        message = cleanMsg || err.message;
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  };


  return (
    <div className="min-h-screen bg-[#121212] flex flex-col justify-center items-center px-4 sm:px-6 lg:px-8 relative overflow-hidden font-sans">
      {/* Background ambient lighting */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-[#D4AF37]/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-72 h-72 bg-amber-500/5 rounded-full blur-2xl pointer-events-none" />

      {/* Main card */}
      <div className="w-full max-w-md bg-[#1E1E1E] border border-[#333333] hover:border-[#D4AF37]/40 rounded-2xl shadow-2xl p-8 relative z-10 transition-colors">
        {/* Brand header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-[#252525] border border-[#3A3A3A] shadow-inner mb-4">
            <LayoutGrid className="h-7 w-7 text-[#D4AF37]" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white mb-1">
            Solarithm Insight
          </h1>
          <p className="text-sm text-gray-400">
            Executive Project & Financial Management Console
          </p>

          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#D4AF37]/10 border border-[#D4AF37]/30 text-[#D4AF37] text-xs font-semibold mt-4">
            <ShieldCheck className="w-3.5 h-3.5 text-[#D4AF37]" />
            Owner Authentication Required
          </div>
        </div>

        {/* Login Form */}
        <form id="owner-login-form" onSubmit={handleLogin} noValidate className="space-y-4">
          <div>
            <label htmlFor="owner-email-input" className="block text-xs font-medium text-gray-300 mb-1.5 uppercase tracking-wider">
              Owner Email
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-gray-500">
                <Mail className="h-4 w-4" />
              </div>
              <input
                id="owner-email-input"
                type="email"
                required
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="owner@solarithmdesign.com"
                className="block w-full pl-10 pr-3 py-2.5 bg-[#121212] border border-[#333333] rounded-xl text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/40 focus:border-[#D4AF37] transition-colors"
                autoComplete="email"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="owner-password-input" className="block text-xs font-medium text-gray-300 uppercase tracking-wider">
                Password
              </label>
            </div>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-gray-500">
                <Lock className="h-4 w-4" />
              </div>
              <input
                id="owner-password-input"
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="••••••••••••"
                className="block w-full pl-10 pr-10 py-2.5 bg-[#121212] border border-[#333333] rounded-xl text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/40 focus:border-[#D4AF37] transition-colors"
                autoComplete="current-password"
              />
              <button
                id="owner-toggle-password-btn"
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-gray-500 hover:text-gray-300 focus:outline-none cursor-pointer"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* Informational notice (e.g. idle timeout) -- amber, not an error */}
          {externalNotice && !error && (
            <div
              id="owner-auth-notice-banner"
              className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-500/50 text-amber-300 text-xs flex items-start gap-2.5 animate-in fade-in"
              role="status"
            >
              <Clock className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="flex-1 leading-relaxed text-amber-200 font-medium">{externalNotice}</div>
            </div>
          )}

          {/* Firebase Authentication Error Display directly above the submit button */}
          {error && (
            <div 
              id="owner-auth-error-banner"
              className="p-3.5 rounded-xl bg-red-950/40 border border-red-500/50 text-red-400 text-xs flex items-start gap-2.5 animate-in fade-in"
              role="alert"
            >
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div className="flex-1 leading-relaxed text-red-300 font-medium">{error}</div>
            </div>
          )}

          <button
            id="owner-sign-in-btn"
            type="submit"
            disabled={loading}
            className="w-full mt-2 flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-[#D4AF37] hover:bg-[#c49f2c] active:bg-[#b59024] text-black font-semibold text-sm transition-all duration-150 shadow-lg shadow-[#D4AF37]/20 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                Verifying Credentials & Role...
              </span>
            ) : (
              <>
                <span>Sign In as Owner</span>
                <ArrowRight className="w-4 h-4 text-black" />
              </>
            )}
          </button>
        </form>

        {/* Security badge & info */}
        <div className="mt-8 pt-6 border-t border-[#2A2A2A] text-center">
          <p className="text-xs text-gray-500">
            Solarithm Central Data Hub · Security Tier 1
          </p>
          <p className="text-[11px] text-gray-600 mt-1">
            Access strictly monitored and logged in centralized <code className="text-gray-500 font-mono">auditLogs</code>.
          </p>
        </div>
      </div>
    </div>
  );
}
