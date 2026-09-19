'use client';
import { useState, useEffect, useCallback } from 'react';

export interface BankDetails {
  name: string;
  acc: string;
  accName: string;
  ifsc: string;
  upi: string;
  branch?: string;
}

export interface CompanySettings {
  companyName: string;
  tagline: string;
  gstin: string;
  cin?: string;
  pan?: string;
  phone: string;
  email: string;
  website?: string;
  address: string;
  signatoryName?: string;
  signatoryDesignation?: string;
  logo: string | null;
  signature: string | null;
  stamp: string | null;
  bank: BankDetails;
}

export const COMPANY_STORAGE_KEYS = {
  companySettings: 'solarithm_company_settings_v1',
  legacyBillingSettings: 'solarithm_settings_v2'
};

export function defaultCompanySettings(): CompanySettings {
  return {
    companyName: 'SOLARITHM DESIGN & ENGINEERING CONSULTANCY',
    tagline: 'Smart Design, Sustainable Power',
    gstin: '',
    cin: '',
    pan: '',
    phone: '+91 94295 00746 / 63',
    email: 'info.solarithm@gmail.com',
    website: 'https://solarithm.com',
    address: 'Surat, Gujarat, India',
    signatoryName: 'Jay Nilesh Shah',
    signatoryDesignation: 'Authorized Signatory',
    logo: null,
    signature: null,
    stamp: null,
    bank: {
      name: 'Bank Of Baroda',
      acc: '34670100017957',
      accName: 'Jay Nilesh Shah',
      ifsc: 'BARB0KAMREJ',
      upi: 'jayjalpa2002@okaxis',
      branch: ''
    }
  };
}

export function getInitialCompanySettings(): CompanySettings {
  if (typeof window === 'undefined') return defaultCompanySettings();
  try {
    // 1. Check primary dedicated storage key
    const raw = localStorage.getItem(COMPANY_STORAGE_KEYS.companySettings);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const def = defaultCompanySettings();
        return {
          companyName: parsed.companyName ?? def.companyName,
          tagline: parsed.tagline ?? def.tagline,
          gstin: parsed.gstin ?? def.gstin,
          cin: parsed.cin ?? def.cin,
          pan: parsed.pan ?? def.pan,
          phone: parsed.phone ?? def.phone,
          email: parsed.email ?? def.email,
          website: parsed.website ?? def.website,
          address: parsed.address ?? def.address,
          signatoryName: parsed.signatoryName ?? def.signatoryName,
          signatoryDesignation: parsed.signatoryDesignation ?? def.signatoryDesignation,
          logo: parsed.logo ?? def.logo,
          signature: parsed.signature ?? def.signature,
          stamp: parsed.stamp ?? def.stamp,
          bank: {
            name: parsed.bank?.name ?? def.bank.name,
            acc: parsed.bank?.acc ?? def.bank.acc,
            accName: parsed.bank?.accName ?? def.bank.accName,
            ifsc: parsed.bank?.ifsc ?? def.bank.ifsc,
            upi: parsed.bank?.upi ?? def.bank.upi,
            branch: parsed.bank?.branch ?? def.bank.branch
          }
        };
      }
    }

    // 2. Migration fallback: check legacy billing settings key
    const rawLegacy = localStorage.getItem(COMPANY_STORAGE_KEYS.legacyBillingSettings);
    if (rawLegacy) {
      const legacyParsed = JSON.parse(rawLegacy);
      if (legacyParsed && typeof legacyParsed === 'object') {
        const def = defaultCompanySettings();
        const migrated: CompanySettings = {
          companyName: legacyParsed.companyName || def.companyName,
          tagline: legacyParsed.tagline || def.tagline,
          gstin: legacyParsed.gstin || def.gstin,
          cin: legacyParsed.cin || def.cin,
          pan: legacyParsed.pan || def.pan,
          phone: legacyParsed.phone || def.phone,
          email: legacyParsed.email || def.email,
          website: legacyParsed.website || def.website,
          address: legacyParsed.address || def.address,
          signatoryName: legacyParsed.signatoryName || def.signatoryName,
          signatoryDesignation: legacyParsed.signatoryDesignation || def.signatoryDesignation,
          logo: legacyParsed.logo || def.logo,
          signature: legacyParsed.signature || def.signature,
          stamp: legacyParsed.stamp || def.stamp,
          bank: {
            name: legacyParsed.bank?.name || def.bank.name,
            acc: legacyParsed.bank?.acc || def.bank.acc,
            accName: legacyParsed.bank?.accName || def.bank.accName,
            ifsc: legacyParsed.bank?.ifsc || def.bank.ifsc,
            upi: legacyParsed.bank?.upi || def.bank.upi,
            branch: legacyParsed.bank?.branch || def.bank.branch
          }
        };
        // Save into new key for future loads
        localStorage.setItem(COMPANY_STORAGE_KEYS.companySettings, JSON.stringify(migrated));
        return migrated;
      }
    }
  } catch (e) {
    console.error('Error reading company settings from localStorage:', e);
  }
  return defaultCompanySettings();
}

export function useCompanySettings() {
  const [companySettings, setCompanySettingsState] = useState<CompanySettings>(getInitialCompanySettings);

  const saveCompanySettings = useCallback((newSettings: CompanySettings) => {
    setCompanySettingsState(newSettings);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(COMPANY_STORAGE_KEYS.companySettings, JSON.stringify(newSettings));
        
        // Also keep legacy billing settings in sync for seamless backwards compatibility
        const rawLegacy = localStorage.getItem(COMPANY_STORAGE_KEYS.legacyBillingSettings);
        let updatedLegacy: any = {};
        if (rawLegacy) {
          try {
            updatedLegacy = JSON.parse(rawLegacy) || {};
          } catch (e) {
            updatedLegacy = {};
          }
        }
        updatedLegacy = {
          ...updatedLegacy,
          companyName: newSettings.companyName,
          tagline: newSettings.tagline,
          gstin: newSettings.gstin,
          cin: newSettings.cin,
          pan: newSettings.pan,
          phone: newSettings.phone,
          email: newSettings.email,
          website: newSettings.website,
          address: newSettings.address,
          signatoryName: newSettings.signatoryName,
          signatoryDesignation: newSettings.signatoryDesignation,
          logo: newSettings.logo,
          signature: newSettings.signature,
          stamp: newSettings.stamp,
          bank: newSettings.bank
        };
        localStorage.setItem(COMPANY_STORAGE_KEYS.legacyBillingSettings, JSON.stringify(updatedLegacy));

        // Dispatch events for cross-component and cross-tab synchronization
        window.dispatchEvent(new CustomEvent('solarithm_company_settings_changed', { detail: newSettings }));
      } catch (e) {
        console.error('Error saving company settings to localStorage:', e);
      }
    }
  }, []);

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === COMPANY_STORAGE_KEYS.companySettings && e.newValue) {
        try {
          setCompanySettingsState(JSON.parse(e.newValue));
        } catch (err) {
          console.error(err);
        }
      }
    };

    const handleCustomChange = (e: any) => {
      if (e.detail) {
        setCompanySettingsState(e.detail);
      }
    };

    window.addEventListener('storage', handleStorage);
    window.addEventListener('solarithm_company_settings_changed', handleCustomChange);

    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('solarithm_company_settings_changed', handleCustomChange);
    };
  }, []);

  return {
    companySettings,
    saveCompanySettings,
    defaultCompanySettings
  };
}
