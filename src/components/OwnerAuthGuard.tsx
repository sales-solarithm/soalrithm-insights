'use client';

import React from 'react';
import { useOwnerAuth } from '@/src/context/OwnerAuthContext';
import OwnerLogin from './OwnerLogin';
import AccessDenied from './AccessDenied';

interface OwnerAuthGuardProps {
  children: React.ReactNode;
}

export default function OwnerAuthGuard({ children }: OwnerAuthGuardProps) {
  const { status, user, ownerProfile, authError, authNotice, signOut, refreshAuth } = useOwnerAuth();

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-white dark:bg-[#121212] flex items-center justify-center transition-colors">
        <div className="flex flex-col items-center gap-3">
          <span className="h-8 w-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
          <span className="text-xs text-gray-500 dark:text-gray-400 tracking-wider uppercase">Verifying owner session...</span>
        </div>
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return (
      <OwnerLogin
        onSuccess={() => {}}
        externalNotice={authNotice}
        externalError={authError}
      />
    );
  }

  const isOwner = Boolean(
    ownerProfile &&
    (
      String(ownerProfile.role || '').toLowerCase().trim() === 'owner' ||
      String(ownerProfile.assignedRole || '').toLowerCase().trim() === 'owner' ||
      String(ownerProfile.designation || '').toLowerCase().includes('owner') ||
      String(ownerProfile.designation || '').toLowerCase().includes('partner')
    )
  );

  if (status === 'unauthorized' || (ownerProfile && !isOwner)) {
    return (
      <AccessDenied
        type="unauthorized"
        userEmail={user?.email || ownerProfile?.email}
        userId={user?.uid}
        detectedRole={ownerProfile?.role || 'unregistered'}
        errorMessage={authError || 'Only accounts with the "owner" role are permitted to view the Executive Console.'}
        onSignOut={signOut}
        onRetry={async () => {
          if (refreshAuth) {
            await refreshAuth();
          } else {
            window.location.reload();
          }
        }}
        onLoginSuccess={() => {}}
      />
    );
  }

  return <>{children}</>;
}
