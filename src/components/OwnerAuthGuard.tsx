'use client';

import React from 'react';

interface OwnerAuthGuardProps {
  children: React.ReactNode;
}

export default function OwnerAuthGuard({ children }: OwnerAuthGuardProps) {
  return <>{children}</>;
}
