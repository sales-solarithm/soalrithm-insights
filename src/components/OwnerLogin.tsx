'use client';

import React, { useState } from 'react';
import { 
  ShieldCheck, 
  Lock, 
  Mail, 
  Eye, 
  EyeOff, 
  AlertCircle, 
  ArrowRight,
  LayoutGrid,
  Clock,
  KeyRound,
  CheckCircle2,
  X,
  Sparkles,
  Send
} from 'lucide-react';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  updatePassword,
  signOut 
} from 'firebase/auth';
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  doc, 
  getDoc, 
  setDoc
} from 'firebase/firestore';
import { auth, db } from '@/src/lib/firebase';
import { COLLECTIONS } from '@/src/config/schema';
import { 
  useOwnerAuth, 
  OwnerProfile, 
  isOwnerRecord, 
  findOwnerRecordAcrossCollections, 
  mirrorOwnerToUsers 
} from '@/src/context/OwnerAuthContext';
import { logAuditEvent } from '@/src/lib/masterHub';

interface OwnerLoginProps {
  onSuccess: (userProfile: any) => void;
  externalError?: string | null;
  externalNotice?: string | null;
}

export default function OwnerLogin({ onSuccess, externalError, externalNotice }: OwnerLoginProps) {
  const { setAuthorizedOwner } = useOwnerAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(externalError || null);

  // Set / Reset Password Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalStep, setModalStep] = useState<'verify' | 'set_password' | 'reset_dispatched' | 'success'>('verify');
  const [modalEmail, setModalEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalSuccess, setModalSuccess] = useState<string | null>(null);
  const [verifiedOwnerData, setVerifiedOwnerData] = useState<{
    name?: string;
    email: string;
    docId?: string;
    userData?: any;
  } | null>(null);

  /**
   * Primary Login Handler
   * Direct Firebase Auth with clean error catches (no artificial 8000ms timeouts)
   */
  const handleLogin = async (e?: React.FormEvent | React.MouseEvent) => {
    if (e && typeof e.preventDefault === 'function') {
      e.preventDefault();
    }

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setError('Please enter your owner email address.');
      return;
    }

    if (!password) {
      setError('Please enter your access password or security PIN.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 1. Direct Firebase Auth sign in
      const userCredential = await signInWithEmailAndPassword(auth, cleanEmail, password);
      const user = userCredential.user;

      // 2. Dual-collection verification check against Firestore (/users and /employees)
      let isOwner = false;
      let userProfileData: any = null;

      if (db) {
        // Direct UID lookup in /users
        try {
          const userDocSnap = await getDoc(doc(db, COLLECTIONS.USERS, user.uid));
          if (userDocSnap.exists()) {
            const data = userDocSnap.data();
            if (isOwnerRecord(data)) {
              isOwner = true;
              userProfileData = { id: userDocSnap.id, uid: user.uid, email: user.email, ...data };
            }
          }
        } catch (docErr) {
          console.warn('[OwnerLogin] User doc lookup warning:', docErr);
        }

        // Dual-collection search across /users and /employees if not yet verified
        if (!isOwner) {
          try {
            const match = await findOwnerRecordAcrossCollections(db, cleanEmail);
            if (match.isOwner && match.docData) {
              isOwner = true;
              userProfileData = { id: match.docId || user.uid, uid: user.uid, email: cleanEmail, ...match.docData };
              // Auto-mirror to /users under user.uid
              await mirrorOwnerToUsers(db, cleanEmail, match.docData, user.uid);
            }
          } catch (lookupErr) {
            console.warn('[OwnerLogin] Dual-collection search warning:', lookupErr);
          }
        }
      }

      // Strictly rely on live Firestore authorization - no hardcoded email bypass
      if (!isOwner) {
        await signOut(auth).catch(() => {});
        setError('This email is not registered as an authorized owner.');
        setLoading(false);
        return;
      }

      const profile: OwnerProfile = {
        uid: user.uid,
        email: user.email || cleanEmail,
        name: user.displayName || userProfileData?.name || 'Executive Owner',
        role: 'owner',
        assignedRole: 'owner',
        ...userProfileData
      };

      // Ensure /users has the latest UID and timestamp for this owner (syncs with Nexus Console)
      if (db) {
        try {
          await setDoc(doc(db, COLLECTIONS.USERS, user.uid), {
            ...profile,
            lastLoginAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }, { merge: true });
        } catch (updateErr) {
          console.warn('[OwnerLogin] Firestore user update notice:', updateErr);
        }
      }

      if (setAuthorizedOwner) {
        setAuthorizedOwner(user, profile);
      }
      onSuccess(profile);
    } catch (authErr: any) {
      console.warn('[OwnerLogin] Firebase auth error:', authErr);
      let errorMsg = 'Authentication failed. Please verify your credentials.';

      switch (authErr.code) {
        case 'auth/invalid-credential':
        case 'auth/wrong-password':
          errorMsg = 'Invalid owner email or password. If you need to set or reset your password, click "Set / Reset Owner Password" below.';
          break;
        case 'auth/user-not-found':
          errorMsg = 'No account found with this email. Click "Set / Reset Owner Password" below to initialize your credentials.';
          break;
        case 'auth/too-many-requests':
          errorMsg = 'Access temporarily restricted due to multiple failed login attempts. Please reset your password or try again later.';
          break;
        case 'auth/user-disabled':
          errorMsg = 'This executive account has been deactivated. Please contact the administrator.';
          break;
        case 'auth/invalid-email':
          errorMsg = 'Please enter a valid owner email address.';
          break;
        case 'auth/network-request-failed':
          errorMsg = 'Network connection failed. Please check your internet connection.';
          break;
        default:
          errorMsg = authErr.message || errorMsg;
      }

      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Open the Set / Reset Password Modal
   */
  const handleOpenSetPasswordModal = () => {
    setModalEmail(email.trim());
    setNewPassword('');
    setConfirmPassword('');
    setShowNewPassword(false);
    setShowConfirmPassword(false);
    setModalStep('verify');
    setModalError(null);
    setModalSuccess(null);
    setVerifiedOwnerData(null);
    setIsModalOpen(true);
  };

  /**
   * Modal Step 1: Verification Check
   * Queries BOTH /users and /employees collections by entered email & personalEmail
   * - If not found or not owner: Reject with "This email is not registered as an authorized owner."
   * - If verified with role/designation === 'owner' or management:
   *   1. Permit password setup/reset flow
   *   2. Automatically create or mirror their record into /users with role: 'owner'
   *   3. Trigger sendPasswordResetEmail(auth, enteredEmail)
   */
  const handleVerifyOwnerEmail = async (e?: React.FormEvent) => {
    if (e && typeof e.preventDefault === 'function') {
      e.preventDefault();
    }

    const cleanEmail = modalEmail.trim().toLowerCase();
    if (!cleanEmail) {
      setModalError('Please enter your owner email address.');
      return;
    }

    setModalLoading(true);
    setModalError(null);
    setModalSuccess(null);

    try {
      if (!db) {
        throw new Error('Database connection is not initialized.');
      }

      // Query BOTH /users and /employees collections using case-insensitive role & designation comparison
      const match = await findOwnerRecordAcrossCollections(db, cleanEmail);

      // If isOwner is false: Reject with "This email is not registered as an authorized owner."
      if (!match.isOwner || !match.docData) {
        setModalError('This email is not registered as an authorized owner.');
        setModalLoading(false);
        return;
      }

      // 1. If user does not yet exist in /users or needs role sync, automatically mirror into /users with role: 'owner'
      await mirrorOwnerToUsers(db, cleanEmail, match.docData);

      // 2. Trigger sendPasswordResetEmail(auth, cleanEmail)
      let resetDispatched = false;
      try {
        await sendPasswordResetEmail(auth, cleanEmail);
        resetDispatched = true;
        await logAuditEvent({
          action: 'OWNER_PASSWORD_RESET_DISPATCHED',
          target: cleanEmail,
          details: { role: 'owner', source: 'owner_verification_step1' }
        });
      } catch (resetErr: any) {
        console.log('[OwnerLogin] Reset email dispatch notice (new user will set password directly):', resetErr?.code || resetErr?.message);
      }

      // 3. Configure modal destination based on account existence
      setVerifiedOwnerData({
        name: match.docData?.name || match.docData?.employeeName || 'Executive Owner',
        email: cleanEmail,
        docId: match.docId || undefined,
        userData: match.docData
      });

      if (resetDispatched) {
        setModalStep('reset_dispatched');
        setModalSuccess(
          `Authorized Owner account confirmed! A password reset link has been dispatched to ${cleanEmail}.`
        );
      } else {
        setModalStep('set_password');
        setModalSuccess(
          `Authorized Owner verified! Please initialize your owner credentials below.`
        );
      }
      setModalError(null);      setModalError(null);
    } catch (err: any) {
      console.error('[OwnerLogin] Owner verification error:', err);
      setModalError(err.message || 'Unable to verify owner eligibility. Please check network connection.');
    } finally {
      setModalLoading(false);
    }
  };

  /**
   * Modal Step 2: Set New Password
   * Creates or updates Firebase Authentication credentials, ensuring full access to Executive Dashboard & Nexus Admin
   */
  const handleSetPasswordSubmit = async (e?: React.FormEvent) => {
    if (e && typeof e.preventDefault === 'function') {
      e.preventDefault();
    }

    if (newPassword.length < 6) {
      setModalError('Password must be at least 6 characters long.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setModalError('Passwords do not match. Please ensure both passwords match.');
      return;
    }

    const cleanEmail = modalEmail.trim().toLowerCase();
    setModalLoading(true);
    setModalError(null);
    setModalSuccess(null);

    try {
      let authUser: any = null;
      let alreadyExists = false;

      // Attempt to create new user credentials in Firebase Auth
      try {
        const cred = await createUserWithEmailAndPassword(auth, cleanEmail, newPassword);
        authUser = cred.user;
      } catch (createErr: any) {
        if (createErr.code === 'auth/email-already-in-use') {
          alreadyExists = true;
        } else {
          throw createErr;
        }
      }

      // If user is already registered in Firebase Auth:
      if (alreadyExists) {
        // If current authenticated session matches, update password directly
        if (auth.currentUser && auth.currentUser.email?.toLowerCase() === cleanEmail) {
          await updatePassword(auth.currentUser, newPassword);
          authUser = auth.currentUser;
        } else {
          // Trigger Firebase Auth password reset email
          await sendPasswordResetEmail(auth, cleanEmail);
          // Update Firestore user document
          const docId = verifiedOwnerData?.docId || cleanEmail.replace(/[^a-zA-Z0-9_]/g, '_');
          if (db) {
            await setDoc(doc(db, COLLECTIONS.USERS, docId), {
              role: 'owner',
              assignedRole: 'owner',
              email: cleanEmail,
              passwordResetRequestedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            }, { merge: true });
          }
          await logAuditEvent({
            action: 'OWNER_PASSWORD_RESET_DISPATCHED',
            target: cleanEmail,
            details: { role: 'owner', source: 'owner_login_modal' }
          });
          setModalStep('reset_dispatched');
          setModalSuccess(
            `Your owner account already exists in Firebase. For security, a password reset link has been dispatched to ${cleanEmail}. Please check your inbox (and spam folder), click the link to set your password, then return here to sign in.`
          );
          setModalLoading(false);
          return;
        }
      }      // User created or updated directly: sync Firestore records
      if (authUser) {
        const docId = verifiedOwnerData?.docId || authUser.uid;
        const ownerPayload = {
          ...(verifiedOwnerData?.userData || {}),
          uid: authUser.uid,
          email: cleanEmail,
          name: verifiedOwnerData?.name || verifiedOwnerData?.userData?.name || authUser.displayName || 'Executive Owner',
          role: 'owner',
          assignedRole: 'owner',
          status: 'active',
          passwordUpdatedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        if (db) {
          // Save to both the auth UID doc and the custom docId in /users
          await setDoc(doc(db, COLLECTIONS.USERS, authUser.uid), ownerPayload, { merge: true });
          if (docId !== authUser.uid) {
            await setDoc(doc(db, COLLECTIONS.USERS, docId), ownerPayload, { merge: true });
          }
          await mirrorOwnerToUsers(db, cleanEmail, ownerPayload, authUser.uid);
        }

        await logAuditEvent({
          action: 'OWNER_PASSWORD_INITIALIZED',
          target: cleanEmail,
          details: { uid: authUser.uid, role: 'owner' }
        });

        const profile: OwnerProfile = {
          ...ownerPayload,
          id: docId
        };

        setModalStep('success');
        setModalSuccess('Password successfully set! Signing you in to Executive Dashboard & Nexus Console...');

        setTimeout(() => {
          setIsModalOpen(false);
          if (setAuthorizedOwner) {
            setAuthorizedOwner(authUser, profile);
          }
          onSuccess(profile);
        }, 1500);
      }
    } catch (err: any) {
      console.error('[OwnerLogin] Set password error:', err);
      let msg = err.message || 'Failed to set password. Please try again.';
      if (err.code === 'auth/weak-password') {
        msg = 'Password is too weak. Please use at least 6 characters.';
      } else if (err.code === 'auth/invalid-email') {
        msg = 'The email address is invalid.';
      }
      setModalError(msg);
    } finally {
      setModalLoading(false);
    }
  };

  /**
   * Direct Reset Email Trigger
   */
  const handleSendResetEmailDirectly = async () => {
    const cleanEmail = modalEmail.trim().toLowerCase();
    if (!cleanEmail) {
      setModalError('Please enter your owner email address.');
      return;
    }

    setModalLoading(true);
    setModalError(null);
    setModalSuccess(null);

    try {
      if (db) {
        const match = await findOwnerRecordAcrossCollections(db, cleanEmail);
        if (!match.isOwner) {
          setModalError('This email is not registered as an authorized owner.');
          setModalLoading(false);
          return;
        }
        await mirrorOwnerToUsers(db, cleanEmail, match.docData);
      }

      await sendPasswordResetEmail(auth, cleanEmail);
      await logAuditEvent({
        action: 'OWNER_PASSWORD_RESET_DISPATCHED',
        target: cleanEmail,
        details: { role: 'owner', source: 'direct_modal_trigger' }
      });
      setModalStep('reset_dispatched');
      setModalSuccess(`A secure password reset link has been dispatched to ${cleanEmail}. Please check your inbox.`);
    } catch (err: any) {
      console.error('[OwnerLogin] Send reset email error:', err);
      setModalError(err.message || 'Failed to send password reset email.');
    } finally {
      setModalLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#121212] flex flex-col justify-center items-center px-4 sm:px-6 lg:px-8 relative overflow-hidden font-sans transition-colors">
      {/* Background ambient lighting */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-[#D4AF37]/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-72 h-72 bg-amber-500/5 rounded-full blur-2xl pointer-events-none" />

      {/* Main card */}
      <div className="w-full max-w-md bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] hover:border-[#D4AF37]/50 rounded-2xl shadow-xl p-8 relative z-10 transition-colors">
        {/* Brand header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-gray-100 dark:bg-[#252525] border border-gray-200 dark:border-[#3A3A3A] shadow-inner mb-3">
            <LayoutGrid className="h-7 w-7 text-[#D4AF37]" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white mb-1">
            Solarithm Insight
          </h1>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Executive Project &amp; Financial Management Console
          </p>

          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#D4AF37]/10 border border-[#D4AF37]/30 text-[#D4AF37] text-xs font-semibold mt-3">
            <ShieldCheck className="w-3.5 h-3.5 text-[#D4AF37]" />
            Owner Authentication Required
          </div>
        </div>

        {/* Login Form */}
        <form id="owner-login-form" onSubmit={handleLogin} noValidate className="space-y-4">
          <div>
            <label htmlFor="owner-email-input" className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5 uppercase tracking-wider">
              Owner Email
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-gray-400">
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
                className="block w-full pl-10 pr-3 py-2.5 bg-gray-50 dark:bg-[#121212] border border-gray-300 dark:border-[#333333] rounded-xl text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/40 focus:border-[#D4AF37] transition-colors"
                autoComplete="email"
              />
            </div>
          </div>

          <div>
            <label htmlFor="owner-password-input" className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1.5">
              Access Password / Security PIN
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-gray-400">
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
                className="block w-full pl-10 pr-10 py-2.5 bg-gray-50 dark:bg-[#121212] border border-gray-300 dark:border-[#333333] rounded-xl text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/40 focus:border-[#D4AF37] transition-colors"
                autoComplete="current-password"
              />
              <button
                id="owner-toggle-password-btn"
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 focus:outline-none cursor-pointer"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* External informational notice banner */}
          {externalNotice && !error && (
            <div
              id="owner-auth-notice-banner"
              className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/40 text-amber-700 dark:text-amber-300 text-xs flex items-start gap-2.5"
              role="status"
            >
              <Clock className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <div className="flex-1 leading-relaxed font-medium">{externalNotice}</div>
            </div>
          )}

          {/* Error Banner */}
          {error && (
            <div 
              id="owner-auth-error-banner"
              className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-500/50 text-rose-600 dark:text-rose-400 text-xs flex items-start gap-2.5"
              role="alert"
            >
              <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
              <div className="flex-1 leading-relaxed font-medium">{error}</div>
            </div>
          )}

          {/* Sign In Button */}
          <button
            id="owner-sign-in-btn"
            type="submit"
            disabled={loading}
            className="w-full mt-2 flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-[#D4AF37] hover:bg-[#c49f2c] active:bg-[#b59024] text-black font-bold text-sm transition-all duration-150 shadow-lg shadow-[#D4AF37]/20 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                Authenticating Executive Owner...
              </span>
            ) : (
              <>
                <span>Sign In as Executive Owner</span>
                <ArrowRight className="w-4 h-4 text-black" />
              </>
            )}
          </button>

          {/* Dedicated "Set / Reset Owner Password" Button */}
          <div className="pt-2">
            <button
              id="owner-set-password-btn"
              type="button"
              onClick={handleOpenSetPasswordModal}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border border-[#D4AF37]/40 hover:border-[#D4AF37] bg-[#D4AF37]/5 hover:bg-[#D4AF37]/10 text-[#D4AF37] hover:text-[#e5c148] font-semibold text-xs transition-colors cursor-pointer"
            >
              <KeyRound className="w-4 h-4" />
              <span>Set / Reset Owner Password</span>
            </button>
          </div>
        </form>

        {/* Security Info */}
        <div className="mt-6 pt-5 border-t border-gray-200 dark:border-[#2A2A2A] text-center">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Solarithm Central Data Hub · Security Tier 1
          </p>
          <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
            Strict role enforcement active. Public registrations disabled.
          </p>
        </div>
      </div>

      {/* Set / Reset Owner Password Modal */}
      {isModalOpen && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm transition-opacity"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-headline"
        >
          <div className="relative w-full max-w-md bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] rounded-2xl shadow-2xl p-6 sm:p-7 overflow-hidden">
            {/* Modal Close Button */}
            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 rounded-lg transition-colors cursor-pointer"
              aria-label="Close dialog"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Modal Header */}
            <div className="flex items-center gap-3 mb-5">
              <div className="h-10 w-10 rounded-xl bg-[#D4AF37]/10 border border-[#D4AF37]/30 flex items-center justify-center shrink-0">
                <KeyRound className="w-5 h-5 text-[#D4AF37]" />
              </div>
              <div>
                <h2 id="modal-headline" className="text-lg font-bold text-gray-900 dark:text-white">
                  Owner Password Security Portal
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Solarithm Insight &amp; Nexus Console Access
                </p>
              </div>
            </div>

            {/* Modal Notification / Error Banner */}
            {modalError && (
              <div 
                className="mb-4 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-500/50 text-rose-600 dark:text-rose-400 text-xs flex items-start gap-2.5"
                role="alert"
              >
                <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                <div className="flex-1 font-medium leading-relaxed">{modalError}</div>
              </div>
            )}

            {/* Modal Success Banner */}
            {modalSuccess && (
              <div 
                className="mb-4 p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-500/50 text-emerald-700 dark:text-emerald-300 text-xs flex items-start gap-2.5"
                role="status"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                <div className="flex-1 font-medium leading-relaxed">{modalSuccess}</div>
              </div>
            )}

            {/* STEP 1: Verify Owner Email */}
            {modalStep === 'verify' && (
              <form onSubmit={handleVerifyOwnerEmail} className="space-y-4">
                <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
                  Enter your registered Executive Owner email. We will verify your authorized <span className="font-semibold text-[#D4AF37]">role: &quot;owner&quot;</span> in Firestore before enabling password initialization.
                </p>

                <div>
                  <label htmlFor="modal-owner-email" className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5 uppercase tracking-wider">
                    Executive Owner Email
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-gray-400">
                      <Mail className="h-4 w-4" />
                    </div>
                    <input
                      id="modal-owner-email"
                      type="email"
                      required
                      value={modalEmail}
                      onChange={(e) => {
                        setModalEmail(e.target.value);
                        if (modalError) setModalError(null);
                      }}
                      placeholder="owner@solarithmdesign.com"
                      className="block w-full pl-10 pr-3 py-2.5 bg-gray-50 dark:bg-[#121212] border border-gray-300 dark:border-[#333333] rounded-xl text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/40 focus:border-[#D4AF37] transition-colors"
                      autoComplete="email"
                      autoFocus
                    />
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    id="verify-owner-eligibility-btn"
                    type="submit"
                    disabled={modalLoading}
                    className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-[#D4AF37] hover:bg-[#c49f2c] active:bg-[#b59024] text-black font-bold text-sm transition-all shadow-md shadow-[#D4AF37]/20 disabled:opacity-50 cursor-pointer"
                  >
                    {modalLoading ? (
                      <span className="flex items-center gap-2">
                        <span className="h-4 w-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                        Verifying Owner Eligibility...
                      </span>
                    ) : (
                      <>
                        <ShieldCheck className="w-4 h-4 text-black" />
                        <span>Verify Owner Eligibility</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}

            {/* STEP 2: Set New Password */}
            {modalStep === 'set_password' && (
              <form onSubmit={handleSetPasswordSubmit} className="space-y-4">
                <div className="p-3 rounded-xl bg-[#D4AF37]/10 border border-[#D4AF37]/30 flex items-center gap-2.5">
                  <Sparkles className="w-4 h-4 text-[#D4AF37] shrink-0" />
                  <div className="text-xs text-gray-800 dark:text-gray-200">
                    <span className="font-semibold text-[#D4AF37]">Verified Executive Owner:</span>{' '}
                    <span className="font-mono">{modalEmail}</span>
                  </div>
                </div>

                <div>
                  <label htmlFor="new-owner-password" className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5 uppercase tracking-wider">
                    New Access Password (Min 6 chars)
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-gray-400">
                      <Lock className="h-4 w-4" />
                    </div>
                    <input
                      id="new-owner-password"
                      type={showNewPassword ? 'text' : 'password'}
                      required
                      minLength={6}
                      value={newPassword}
                      onChange={(e) => {
                        setNewPassword(e.target.value);
                        if (modalError) setModalError(null);
                      }}
                      placeholder="••••••••••••"
                      className="block w-full pl-10 pr-10 py-2.5 bg-gray-50 dark:bg-[#121212] border border-gray-300 dark:border-[#333333] rounded-xl text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/40 focus:border-[#D4AF37] transition-colors"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 focus:outline-none cursor-pointer"
                      aria-label={showNewPassword ? "Hide password" : "Show password"}
                    >
                      {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label htmlFor="confirm-owner-password" className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5 uppercase tracking-wider">
                    Confirm New Password
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-gray-400">
                      <Lock className="h-4 w-4" />
                    </div>
                    <input
                      id="confirm-owner-password"
                      type={showConfirmPassword ? 'text' : 'password'}
                      required
                      minLength={6}
                      value={confirmPassword}
                      onChange={(e) => {
                        setConfirmPassword(e.target.value);
                        if (modalError) setModalError(null);
                      }}
                      placeholder="••••••••••••"
                      className="block w-full pl-10 pr-10 py-2.5 bg-gray-50 dark:bg-[#121212] border border-gray-300 dark:border-[#333333] rounded-xl text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/40 focus:border-[#D4AF37] transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 focus:outline-none cursor-pointer"
                      aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                    >
                      {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="pt-2 space-y-2.5">
                  <button
                    id="set-activate-password-btn"
                    type="submit"
                    disabled={modalLoading}
                    className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-[#D4AF37] hover:bg-[#c49f2c] active:bg-[#b59024] text-black font-bold text-sm transition-all shadow-md shadow-[#D4AF37]/20 disabled:opacity-50 cursor-pointer"
                  >
                    {modalLoading ? (
                      <span className="flex items-center gap-2">
                        <span className="h-4 w-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                        Saving &amp; Activating Credentials...
                      </span>
                    ) : (
                      <>
                        <ShieldCheck className="w-4 h-4 text-black" />
                        <span>Set &amp; Activate Password</span>
                      </>
                    )}
                  </button>

                  <div className="text-center">
                    <span className="text-[11px] text-gray-400 dark:text-gray-500 uppercase tracking-wider">— OR —</span>
                  </div>

                  <button
                    type="button"
                    disabled={modalLoading}
                    onClick={handleSendResetEmailDirectly}
                    className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl border border-gray-300 dark:border-[#333333] hover:border-[#D4AF37]/50 bg-gray-50 dark:bg-[#161616] text-gray-700 dark:text-gray-300 hover:text-[#D4AF37] text-xs font-semibold transition-colors cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Send Password Reset Link to Inbox Instead</span>
                  </button>
                </div>
              </form>
            )}

            {/* STEP: Reset Link Dispatched (Accurate User Guidance) */}
            {modalStep === 'reset_dispatched' && (
              <div className="text-center py-2 space-y-4">
                <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-[#D4AF37]/10 border border-[#D4AF37]/30 text-[#D4AF37]">
                  <Send className="w-6 h-6 text-[#D4AF37]" />
                </div>
                <div className="space-y-1.5">
                  <h3 className="text-base font-bold text-gray-900 dark:text-white">
                    Password Reset Link Dispatched
                  </h3>
                  <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/30 text-left space-y-2">
                    <p className="text-xs text-blue-900 dark:text-blue-200 leading-relaxed">
                      Your owner account already exists in Firebase. For security, a password reset link has been dispatched to <strong className="font-mono text-[#D4AF37]">{modalEmail}</strong>.
                    </p>
                    <p className="text-[11px] text-gray-600 dark:text-gray-300 leading-relaxed">
                      Please check your inbox (and spam folder), click the link to set your password, then return here to sign in.
                    </p>
                  </div>
                </div>

                <div className="p-2.5 rounded-lg bg-gray-50 dark:bg-[#121212] border border-gray-200 dark:border-[#333333] text-[11px] text-gray-500 dark:text-gray-400 text-left space-y-1">
                  <div className="font-semibold text-gray-700 dark:text-gray-300">Authorized Domain Notice:</div>
                  <div>Ensure you are accessing via an authorized Firebase Authentication domain (e.g. localhost, Cloudflare Pages, or solarithm-master.firebaseapp.com).</div>
                </div>

                <div className="space-y-2 pt-2">
                  <button
                    type="button"
                    disabled={modalLoading}
                    onClick={handleSendResetEmailDirectly}
                    className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border border-gray-300 dark:border-[#333333] hover:border-[#D4AF37]/60 bg-gray-50 dark:bg-[#161616] text-gray-800 dark:text-gray-200 hover:text-[#D4AF37] text-xs font-bold transition-all cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Resend Password Reset Email</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsModalOpen(false);
                      setEmail(modalEmail);
                    }}
                    className="w-full py-2.5 px-4 rounded-xl bg-[#D4AF37] hover:bg-[#c49f2c] text-black font-bold text-sm transition-all shadow-md shadow-[#D4AF37]/20 cursor-pointer"
                  >
                    Return to Sign In
                  </button>
                </div>
              </div>
            )}

            {/* STEP 3: Success Confirmation */}
            {modalStep === 'success' && (
              <div className="text-center py-4 space-y-4">
                <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-500">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <h3 className="text-base font-bold text-gray-900 dark:text-white">
                  Owner Password Configured
                </h3>
                <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                  Your credentials grant full authorization across both the Solarithm Executive Dashboard and Nexus Admin Console.
                </p>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="w-full py-2.5 px-4 rounded-xl bg-[#D4AF37] hover:bg-[#c49f2c] text-black font-bold text-sm transition-all cursor-pointer"
                >
                  Return to Sign In
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
