'use client';

import { useState, useEffect, useCallback } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '@/src/lib/firebase';
import { safeStringIdentifier } from '@/src/lib/projectUtils';

export const COMPANY_STORAGE_KEYS = {
  companySettings: 'solarithm_company_settings_v2',
  settings: 'solarithm_settings_v2',
  clients: 'clients',
  invoices: 'invoices',
} as const;

export interface CompanyBankSettings {
  name: string;
  acc: string;
  accName?: string;
  ifsc: string;
  upi?: string;
  branch?: string;
}

export interface CompanySettings {
  companyName: string;
  tagline: string;
  gstin: string;
  cin?: string;
  pan: string;
  website?: string;
  phone: string;
  email: string;
  address: string;
  signatoryName?: string;
  signatoryDesignation?: string;
  logo: string | null;
  signature: string | null;
  stamp: string | null;
  bank: CompanyBankSettings;
  updatedAt?: string;
}

export function defaultCompanySettings(): CompanySettings {
  return {
    companyName: 'SOLARITHM DESIGN & ENGINEERING CONSULTANCY',
    tagline: 'Smart Design, Sustainable Power',
    gstin: '24AAECS1234F1Z5',
    cin: 'U74999GJ2024PTC123456',
    pan: 'AAECS1234F',
    website: 'https://solarithm.com',
    phone: '+91 94295 00746 / 63',
    email: 'info.solarithm@gmail.com',
    address: 'Surat, Gujarat, India',
    signatoryName: 'Authorized Signatory',
    signatoryDesignation: 'Managing Partner',
    logo: null,
    signature: null,
    stamp: null,
    bank: {
      name: 'Bank Of Baroda',
      acc: '34670100017957',
      accName: 'Solarithm Consultancy',
      ifsc: 'BARB0KAMREJ',
      upi: 'solarithm@okaxis',
      branch: 'Kamrej Branch',
    },
  };
}

/**
 * Normalizes any incoming data payload into canonical CompanySettings
 * with guaranteed string integrity on statutory and banking identifiers.
 * Enforces strict uppercase on IFSC, GSTIN, PAN, and CIN.
 */
export function normalizeCompanySettings(raw: any): CompanySettings {
  const defaults = defaultCompanySettings();
  if (!raw || typeof raw !== 'object') return defaults;

  const rawGstin = safeStringIdentifier(raw.gstin ?? defaults.gstin).toUpperCase().trim();
  const rawPan = safeStringIdentifier(raw.pan ?? defaults.pan).toUpperCase().trim();
  const rawCin = raw.cin !== undefined && raw.cin !== null
    ? safeStringIdentifier(raw.cin).toUpperCase().trim()
    : defaults.cin;
  const rawIfsc = safeStringIdentifier(raw.bank?.ifsc ?? defaults.bank.ifsc).toUpperCase().trim();

  return {
    ...defaults,
    ...raw,
    companyName: String(raw.companyName ?? defaults.companyName).trim(),
    tagline: String(raw.tagline ?? defaults.tagline).trim(),
    // Enforce string integrity & uppercase on statutory fields
    gstin: rawGstin,
    cin: rawCin,
    pan: rawPan,
    website: raw.website ? String(raw.website).trim() : defaults.website,
    phone: String(raw.phone ?? defaults.phone).trim(),
    email: String(raw.email ?? defaults.email).trim(),
    address: String(raw.address ?? defaults.address).trim(),
    signatoryName: raw.signatoryName ? String(raw.signatoryName).trim() : defaults.signatoryName,
    signatoryDesignation: raw.signatoryDesignation ? String(raw.signatoryDesignation).trim() : defaults.signatoryDesignation,
    logo: raw.logo ?? null,
    signature: raw.signature ?? null,
    stamp: raw.stamp ?? null,
    bank: {
      ...defaults.bank,
      ...(raw.bank || {}),
      name: String(raw.bank?.name ?? defaults.bank.name).trim(),
      // Enforce string integrity on banking numbers
      acc: safeStringIdentifier(raw.bank?.acc ?? defaults.bank.acc).trim(),
      accName: raw.bank?.accName ? String(raw.bank.accName).trim() : (defaults.bank.accName || '').trim(),
      ifsc: rawIfsc,
      upi: raw.bank?.upi ? String(raw.bank.upi).trim() : (defaults.bank.upi || '').trim(),
      branch: raw.bank?.branch ? String(raw.bank.branch).trim() : (defaults.bank.branch || '').trim(),
    },
    updatedAt: raw.updatedAt ? String(raw.updatedAt) : undefined,
  };
}

export function getInitialCompanySettings(): CompanySettings {
  const defaults = defaultCompanySettings();
  if (typeof window === 'undefined') return defaults;
  try {
    const raw = localStorage.getItem(COMPANY_STORAGE_KEYS.companySettings);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    return normalizeCompanySettings(parsed);
  } catch (err) {
    console.warn('Failed to parse company settings from localStorage:', err);
    return defaults;
  }
}

export function useCompanySettings() {
  const [companySettings, setCompanySettings] = useState<CompanySettings>(() => {
    return getInitialCompanySettings();
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // 1. Establish real-time Firestore synchronization with /metadata/companySettings
  useEffect(() => {
    if (!db) {
      setIsLoading(false);
      return;
    }

    try {
      const docRef = doc(db, 'metadata', 'companySettings');
      const unsubscribe = onSnapshot(
        docRef,
        (snap) => {
          if (snap.exists()) {
            const cloudData = snap.data();
            const normalized = normalizeCompanySettings(cloudData);
            setCompanySettings(normalized);
            // Cache to localStorage for offline readiness
            try {
              localStorage.setItem(
                COMPANY_STORAGE_KEYS.companySettings,
                JSON.stringify(normalized)
              );
            } catch {
              // ignore storage write errors
            }
          }
          setIsLoading(false);
        },
        (err) => {
          console.warn('[useCompanySettings] Firestore onSnapshot warning:', err);
          setIsLoading(false);
        }
      );

      return () => {
        unsubscribe();
      };
    } catch (err) {
      console.warn('[useCompanySettings] Listener initialization warning:', err);
      setIsLoading(false);
    }
  }, []);

  // 2. Local window storage synchronization across tabs
  useEffect(() => {
    const handleStorageChange = (e: any) => {
      if (e?.detail) {
        const normalized = normalizeCompanySettings(e.detail);
        setCompanySettings(normalized);
      }
    };
    window.addEventListener('solarithm_company_settings_changed', handleStorageChange);
    return () => {
      window.removeEventListener('solarithm_company_settings_changed', handleStorageChange);
    };
  }, []);

  // 3. Save company settings to BOTH Firestore (/metadata/companySettings) and localStorage
  const saveCompanySettings = useCallback(async (newSettings: CompanySettings) => {
    const sanitized = normalizeCompanySettings({
      ...newSettings,
      updatedAt: new Date().toISOString(),
    });

    // Optimistic local update
    setCompanySettings(sanitized);

    // Save to localStorage for instant client response and offline fallback
    try {
      localStorage.setItem(
        COMPANY_STORAGE_KEYS.companySettings,
        JSON.stringify(sanitized)
      );
      window.dispatchEvent(
        new CustomEvent('solarithm_company_settings_changed', { detail: sanitized })
      );
    } catch {
      // ignore
    }

    // Persist to Firestore Single Source of Truth at /metadata/companySettings
    if (db) {
      try {
        const docRef = doc(db, 'metadata', 'companySettings');
        await setDoc(docRef, sanitized, { merge: true });
      } catch (err) {
        console.error('[useCompanySettings] Failed to persist settings to Firestore:', err);
        throw err;
      }
    }
  }, []);

  const safeSettings = companySettings || defaultCompanySettings();

  return {
    companySettings: safeSettings,
    saveCompanySettings,
    isLoading,
  };
}
