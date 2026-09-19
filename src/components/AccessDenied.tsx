'use client';

import React, { useState } from 'react';
import { 
  ShieldAlert, 
  ShieldX, 
  LogOut, 
  RefreshCw, 
  AlertCircle, 
  UserX, 
  Lock, 
  LayoutGrid,
  ShieldCheck,
  ChevronRight
} from 'lucide-react';
import OwnerLogin from './OwnerLogin';

interface AccessDeniedProps {
  type: 'unauthenticated' | 'unauthorized';
  userEmail?: string | null;
  userId?: string | null;
  detectedRole?: string | null;
  errorMessage?: string | null;
  onSignOut: () => Promise<void>;
  onRetry: () => Promise<void>;
  onLoginSuccess?: (profile: any) => void;
}

export default function AccessDenied({
  type,
  userEmail,
  userId,
  detectedRole,
  errorMessage,
  onSignOut,
  onRetry,
  onLoginSuccess
}: AccessDeniedProps) {
  const [retrying, setRetrying] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await onSignOut();
    } finally {
      setSigningOut(false);
    }
  };

  if (type === 'unauthenticated') {
    return (
      <OwnerLogin
        onSuccess={onLoginSuccess || (() => {})}
        externalError={errorMessage || undefined}
      />
    );
  }

  // Type: 'unauthorized' (Non-Owner Authenticated User)
  return (
    <div className="min-h-screen bg-[#121212] flex flex-col justify-center items-center px-4 sm:px-6 py-12 relative overflow-hidden font-sans text-white">
      {/* Red ambient warning lighting */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-rose-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-72 h-72 bg-amber-500/5 rounded-full blur-2xl pointer-events-none" />

      {/* Main Access Denied Card */}
      <div className="w-full max-w-lg bg-[#1E1E1E] border border-rose-500/40 rounded-2xl shadow-2xl p-8 relative z-10 transition-all">
        {/* Header with Security Badge */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-rose-950/40 border border-rose-500/50 shadow-inner mb-4 animate-pulse">
            <ShieldAlert className="h-8 w-8 text-rose-400" />
          </div>

          <h1 className="text-2xl font-bold tracking-tight text-white mb-1.5 flex items-center justify-center gap-2">
            Access Denied: Owner Privileges Required
          </h1>
          <p className="text-sm text-gray-400">
            Solarithm Insight · Executive Security Guard
          </p>

          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs font-semibold mt-3">
            <ShieldX className="w-3.5 h-3.5 text-rose-400" />
            403 Forbidden · Non-Owner Account
          </div>
        </div>

        {/* Error Alert Box */}
        <div className="mb-6 p-4 rounded-xl bg-rose-950/30 border border-rose-500/40 text-rose-200 text-xs flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
          <div className="space-y-1 leading-relaxed">
            <p className="font-semibold text-rose-300">
              Access to this console is strictly restricted to verified owners.
            </p>
            <p className="text-gray-300">
              {errorMessage || 'Your Firebase account is authenticated, but your user profile does not hold the "owner" role in the Firestore users registry.'}
            </p>
          </div>
        </div>

        {/* Diagnostic Identity Details */}
        <div className="bg-[#141414] border border-[#333333] rounded-xl p-4 mb-6 space-y-3">
          <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wider flex items-center justify-between border-b border-[#252525] pb-2">
            <span>Identity Diagnostic</span>
            <span className="text-rose-400">Clearance Failed</span>
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-gray-400">Authenticated Email:</span>
              <span className="font-mono text-white truncate max-w-[260px] font-medium">
                {userEmail || 'N/A'}
              </span>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-gray-400">Firebase UID:</span>
              <span className="font-mono text-gray-400 text-[11px] truncate max-w-[260px]">
                {userId || 'N/A'}
              </span>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-gray-400">Registry Role:</span>
              <span className={`px-2 py-0.5 rounded text-[11px] font-bold uppercase ${
                detectedRole ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'bg-red-500/20 text-red-300 border border-red-500/30'
              }`}>
                {detectedRole || 'Unregistered'}
              </span>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-gray-400">Required Role:</span>
              <span className="px-2 py-0.5 rounded text-[11px] font-bold uppercase bg-[#D4AF37]/20 text-[#D4AF37] border border-[#D4AF37]/40">
                owner
              </span>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="space-y-3">
          <button
            onClick={handleSignOut}
            disabled={signingOut}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white font-semibold text-sm transition-all shadow-lg shadow-rose-950/50 disabled:opacity-50 cursor-pointer"
          >
            {signingOut ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Signing Out...
              </span>
            ) : (
              <>
                <LogOut className="w-4 h-4" />
                <span>Sign Out &amp; Switch Account</span>
              </>
            )}
          </button>

          <button
            onClick={handleRetry}
            disabled={retrying}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-[#252525] hover:bg-[#2e2e2e] active:bg-[#1f1f1f] text-gray-300 hover:text-white font-medium text-xs border border-[#3A3A3A] transition-colors disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${retrying ? 'animate-spin text-[#D4AF37]' : ''}`} />
            <span>{retrying ? 'Re-Verifying Clearance with Firestore...' : 'Re-Check Owner Permissions'}</span>
          </button>
        </div>

        {/* Audit footer */}
        <div className="mt-6 pt-4 border-t border-[#2A2A2A] text-center">
          <p className="text-[11px] text-gray-500">
            Security Incident Logged · Target: <code className="text-gray-400 font-mono">auditLogs</code>
          </p>
          <p className="text-[10px] text-gray-600 mt-0.5">
            If you believe this is an error, request the system administrator to assign the <code className="text-amber-400">role: &quot;owner&quot;</code> in your Firestore user document.
          </p>
        </div>
      </div>
    </div>
  );
}
