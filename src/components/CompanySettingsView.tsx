'use client';
import React, { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import {
  Building2,
  Image as ImageIcon,
  CreditCard,
  Save,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Upload,
  Trash2,
  Eye,
  ShieldCheck,
  Building,
  FileSignature,
  Stamp,
  Sparkles,
  ExternalLink,
  Check,
  Sun,
  Moon
} from 'lucide-react';
import {
  CompanySettings,
  useCompanySettings,
  defaultCompanySettings
} from '@/src/lib/useCompanySettings';
import { useTheme } from '@/src/context/ThemeContext';

interface CompanySettingsViewProps {
  onNavigateToBilling?: () => void;
}

function readAndResizeImage(file: File, maxDim: number, callback: (dataUrl: string) => void) {
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new window.Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const ratio = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, width, height);
        callback(canvas.toDataURL('image/png'));
      } else {
        callback(ev.target?.result as string);
      }
    };
    img.onerror = () => callback(ev.target?.result as string);
    img.src = ev.target?.result as string;
  };
  reader.readAsDataURL(file);
}

export default function CompanySettingsView({ onNavigateToBilling }: CompanySettingsViewProps) {
  const { theme, toggleTheme, setTheme } = useTheme();
  const { companySettings, saveCompanySettings } = useCompanySettings();
  const [form, setForm] = useState<CompanySettings>(companySettings);
  const [isDirty, setIsDirty] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [toastType, setToastType] = useState<'success' | 'info' | 'error'>('info');
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const handleCustomChange = (e: any) => {
      if (e.detail) {
        setForm(e.detail);
        setIsDirty(false);
      }
    };
    window.addEventListener('solarithm_company_settings_changed', handleCustomChange);
    return () => {
      window.removeEventListener('solarithm_company_settings_changed', handleCustomChange);
    };
  }, []);

  const showToast = (msg: string, type: 'success' | 'info' | 'error' = 'info') => {
    setToastMsg(msg);
    setToastType(type);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMsg('');
    }, 3500);
  };

  const handleFieldChange = (field: keyof CompanySettings, value: any) => {
    let cleanVal = value;
    if (field === 'gstin' || field === 'pan' || field === 'cin') {
      cleanVal = typeof value === 'string' ? value.toUpperCase() : value;
    }
    setForm((prev) => ({ ...prev, [field]: cleanVal }));
    setIsDirty(true);
  };

  const handleBankChange = (bankField: keyof typeof form.bank, value: string) => {
    let cleanVal = value;
    if (bankField === 'ifsc') {
      cleanVal = value.toUpperCase();
    }
    setForm((prev) => ({
      ...prev,
      bank: {
        ...prev.bank,
        [bankField]: cleanVal
      }
    }));
    setIsDirty(true);
  };

  const handleSave = () => {
    saveCompanySettings(form);
    setIsDirty(false);
    showToast('Company profile & settings saved to global state! ✓', 'success');
  };

  const handleResetToDefaults = () => {
    if (window.confirm('Reset company profile, branding, and bank details to system defaults?')) {
      const defaults = defaultCompanySettings();
      setForm(defaults);
      saveCompanySettings(defaults);
      setIsDirty(false);
      showToast('Settings reset to default configuration', 'info');
    }
  };

  const completedAssetsCount = [
    Boolean(form.companyName),
    Boolean(form.address),
    Boolean(form.phone),
    Boolean(form.email),
    Boolean(form.logo),
    Boolean(form.signature),
    Boolean(form.bank?.acc && form.bank?.ifsc)
  ].filter(Boolean).length;

  return (
    <div className="w-full space-y-8 pb-16">
      {/* Toast Notification */}
      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-2xl bg-white dark:bg-[#1E1E1E] border border-[#D4AF37] text-gray-900 dark:text-white text-sm font-medium">
          {toastType === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-[#D4AF37]" />
          ) : (
            <AlertCircle className="w-5 h-5 text-amber-500" />
          )}
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Main Settings Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-gray-200 dark:border-[#333333] pb-6">
        <div>
          <div className="flex items-center space-x-3 mb-1">
            <div className="p-2.5 rounded-xl bg-gray-100 dark:bg-[#2A2A2A] border border-gray-200 dark:border-[#333333] text-[#D4AF37] shadow-sm">
              <Building2 className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white tracking-wide">Enterprise Global Settings</h2>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#D4AF37]/15 text-[#D4AF37] border border-[#D4AF37]/30">
                  Global Single Source of Truth
                </span>
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                Central corporate identity, tax identifiers, branding assets, signatures, and settlement accounts applied across all modules &amp; PDF exports.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={handleResetToDefaults}
            className="flex items-center space-x-2 px-3.5 py-2 rounded-lg bg-white dark:bg-[#1E1E1E] border border-gray-300 dark:border-[#444444] text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#2A2A2A] transition-colors"
          >
            <RotateCcw className="w-4 h-4 text-gray-400" />
            <span>Reset Defaults</span>
          </button>

          <button
            onClick={handleSave}
            className="flex items-center space-x-2 px-5 py-2 rounded-lg text-xs font-bold bg-[#D4AF37] hover:bg-[#f2c94c] text-black shadow-md transition-all"
          >
            <Save className="w-4 h-4 text-black" />
            <span>{isDirty ? 'Save All Changes *' : 'Save Changes'}</span>
          </button>
        </div>
      </div>

      {/* Main Settings Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 space-y-6">
          {/* Section 1: Company Profile */}
          <div className="bg-white dark:bg-[#121212] rounded-xl border border-gray-200 dark:border-[#333333] p-5 shadow-sm space-y-4 transition-colors">
            <div className="flex items-center justify-between border-b border-gray-200 dark:border-[#2A2A2A] pb-2">
              <div className="flex items-center space-x-2">
                <Building className="w-4 h-4 text-[#D4AF37]" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-900 dark:text-white">1. Company &amp; Legal Identity</h3>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="sm:col-span-2">
                <label className="block font-semibold text-gray-700 dark:text-gray-300 mb-1">Company Name *</label>
                <input
                  type="text"
                  value={form.companyName || ''}
                  onChange={(e) => handleFieldChange('companyName', e.target.value)}
                  className="w-full bg-gray-50 dark:bg-[#1A1A1A] border border-gray-300 dark:border-[#333333] rounded-lg px-3 py-2 text-gray-900 dark:text-white"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block font-semibold text-gray-700 dark:text-gray-300 mb-1">Company Tagline</label>
                <input
                  type="text"
                  value={form.tagline || ''}
                  onChange={(e) => handleFieldChange('tagline', e.target.value)}
                  className="w-full bg-gray-50 dark:bg-[#1A1A1A] border border-gray-300 dark:border-[#333333] rounded-lg px-3 py-2 text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block font-semibold text-gray-700 dark:text-gray-300 mb-1">GSTIN</label>
                <input
                  type="text"
                  value={form.gstin || ''}
                  onChange={(e) => handleFieldChange('gstin', e.target.value)}
                  className="w-full bg-gray-50 dark:bg-[#1A1A1A] border border-gray-300 dark:border-[#333333] rounded-lg px-3 py-2 text-gray-900 dark:text-white font-mono"
                />
              </div>

              <div>
                <label className="block font-semibold text-gray-700 dark:text-gray-300 mb-1">PAN</label>
                <input
                  type="text"
                  value={form.pan || ''}
                  onChange={(e) => handleFieldChange('pan', e.target.value)}
                  className="w-full bg-gray-50 dark:bg-[#1A1A1A] border border-gray-300 dark:border-[#333333] rounded-lg px-3 py-2 text-gray-900 dark:text-white font-mono"
                />
              </div>

              <div>
                <label className="block font-semibold text-gray-700 dark:text-gray-300 mb-1">Official Phone</label>
                <input
                  type="text"
                  value={form.phone || ''}
                  onChange={(e) => handleFieldChange('phone', e.target.value)}
                  className="w-full bg-gray-50 dark:bg-[#1A1A1A] border border-gray-300 dark:border-[#333333] rounded-lg px-3 py-2 text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block font-semibold text-gray-700 dark:text-gray-300 mb-1">Official Email</label>
                <input
                  type="email"
                  value={form.email || ''}
                  onChange={(e) => handleFieldChange('email', e.target.value)}
                  className="w-full bg-gray-50 dark:bg-[#1A1A1A] border border-gray-300 dark:border-[#333333] rounded-lg px-3 py-2 text-gray-900 dark:text-white"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block font-semibold text-gray-700 dark:text-gray-300 mb-1">Office Address</label>
                <textarea
                  rows={2}
                  value={form.address || ''}
                  onChange={(e) => handleFieldChange('address', e.target.value)}
                  className="w-full bg-gray-50 dark:bg-[#1A1A1A] border border-gray-300 dark:border-[#333333] rounded-lg px-3 py-2 text-gray-900 dark:text-white resize-none"
                />
              </div>
            </div>
          </div>

          {/* Section 2: Branding Assets */}
          <div className="bg-white dark:bg-[#121212] rounded-xl border border-gray-200 dark:border-[#333333] p-5 shadow-sm space-y-4 transition-colors">
            <div className="flex items-center space-x-2 border-b border-gray-200 dark:border-[#2A2A2A] pb-2">
              <ImageIcon className="w-4 h-4 text-[#D4AF37]" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-900 dark:text-white">2. Visual Branding Assets</h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="p-4 rounded-xl bg-gray-50 dark:bg-[#1A1A1A] border border-gray-200 dark:border-[#2D2D2D] space-y-2">
                <span className="font-bold text-gray-800 dark:text-gray-200">Company Logo</span>
                <div className="border border-dashed border-[#D4AF37]/50 rounded-lg p-3 text-center relative min-h-[90px] flex items-center justify-center">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      readAndResizeImage(file, 400, (dataUrl) => {
                        handleFieldChange('logo', dataUrl);
                        showToast('Logo updated ✓', 'success');
                      });
                    }}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                  />
                  {form.logo ? (
                    <img src={form.logo} alt="Logo" className="max-h-12 object-contain" />
                  ) : (
                    <span className="text-gray-400">Click to upload logo (PNG/SVG)</span>
                  )}
                </div>
              </div>

              <div className="p-4 rounded-xl bg-gray-50 dark:bg-[#1A1A1A] border border-gray-200 dark:border-[#2D2D2D] space-y-2">
                <span className="font-bold text-gray-800 dark:text-gray-200">Digital Signature</span>
                <div className="border border-dashed border-[#D4AF37]/50 rounded-lg p-3 text-center relative min-h-[90px] flex items-center justify-center">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      readAndResizeImage(file, 360, (dataUrl) => {
                        handleFieldChange('signature', dataUrl);
                        showToast('Signature updated ✓', 'success');
                      });
                    }}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                  />
                  {form.signature ? (
                    <img src={form.signature} alt="Signature" className="max-h-12 object-contain" />
                  ) : (
                    <span className="text-gray-400">Click to upload signature (PNG)</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Section 3: Bank Details */}
          <div className="bg-white dark:bg-[#121212] rounded-xl border border-gray-200 dark:border-[#333333] p-5 shadow-sm space-y-4 transition-colors">
            <div className="flex items-center space-x-2 border-b border-gray-200 dark:border-[#2A2A2A] pb-2">
              <CreditCard className="w-4 h-4 text-[#D4AF37]" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-900 dark:text-white">3. Default Settlement Bank</h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-semibold text-gray-700 dark:text-gray-300 mb-1">Bank Name</label>
                <input
                  type="text"
                  value={form.bank?.name || ''}
                  onChange={(e) => handleBankChange('name', e.target.value)}
                  placeholder="e.g. Bank Of Baroda"
                  className="w-full bg-gray-50 dark:bg-[#1A1A1A] border border-gray-300 dark:border-[#333333] rounded-lg px-3 py-2 text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block font-semibold text-gray-700 dark:text-gray-300 mb-1">Account Number</label>
                <input
                  type="text"
                  value={form.bank?.acc || ''}
                  onChange={(e) => handleBankChange('acc', e.target.value)}
                  placeholder="e.g. 34670100017957"
                  className="w-full bg-gray-50 dark:bg-[#1A1A1A] border border-gray-300 dark:border-[#333333] rounded-lg px-3 py-2 text-gray-900 dark:text-white font-mono"
                />
              </div>

              <div>
                <label className="block font-semibold text-gray-700 dark:text-gray-300 mb-1">Account Holder / Name</label>
                <input
                  type="text"
                  value={form.bank?.accName || ''}
                  onChange={(e) => handleBankChange('accName', e.target.value)}
                  placeholder="e.g. Solarithm Consultancy"
                  className="w-full bg-gray-50 dark:bg-[#1A1A1A] border border-gray-300 dark:border-[#333333] rounded-lg px-3 py-2 text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block font-semibold text-gray-700 dark:text-gray-300 mb-1">IFSC Code (Strict Uppercase)</label>
                <input
                  type="text"
                  value={(form.bank?.ifsc || '').toUpperCase()}
                  onChange={(e) => handleBankChange('ifsc', e.target.value)}
                  placeholder="e.g. AUBL0002519"
                  className="w-full bg-gray-50 dark:bg-[#1A1A1A] border border-gray-300 dark:border-[#333333] rounded-lg px-3 py-2 text-gray-900 dark:text-white font-mono uppercase"
                />
              </div>

              <div>
                <label className="block font-semibold text-gray-700 dark:text-gray-300 mb-1">UPI ID</label>
                <input
                  type="text"
                  value={form.bank?.upi || ''}
                  onChange={(e) => handleBankChange('upi', e.target.value)}
                  placeholder="e.g. solarithm@okaxis"
                  className="w-full bg-gray-50 dark:bg-[#1A1A1A] border border-gray-300 dark:border-[#333333] rounded-lg px-3 py-2 text-gray-900 dark:text-white font-mono"
                />
              </div>

              <div>
                <label className="block font-semibold text-gray-700 dark:text-gray-300 mb-1">Branch Name</label>
                <input
                  type="text"
                  value={form.bank?.branch || ''}
                  onChange={(e) => handleBankChange('branch', e.target.value)}
                  placeholder="e.g. Kamrej Branch"
                  className="w-full bg-gray-50 dark:bg-[#1A1A1A] border border-gray-300 dark:border-[#333333] rounded-lg px-3 py-2 text-gray-900 dark:text-white"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Live Card */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-white dark:bg-[#121212] rounded-xl border border-gray-200 dark:border-[#333333] p-5 shadow-sm space-y-3 transition-colors">
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-900 dark:text-white flex items-center gap-1.5">
              <Eye className="w-4 h-4 text-[#D4AF37]" />
              <span>Live Header Snapshot</span>
            </h3>

            <div className="bg-gray-50 dark:bg-[#1A1A1A] rounded-lg p-3 border border-gray-200 dark:border-[#2D2D2D] text-xs space-y-1">
              <div className="font-bold text-gray-900 dark:text-white">{form.companyName}</div>
              <div className="text-[10px] text-gray-500 dark:text-gray-400 italic">{form.tagline}</div>
              <div className="text-[10px] text-gray-600 dark:text-gray-300 pt-1 font-mono">
                GSTIN: {(form.gstin || '').toUpperCase()}
              </div>
              <div className="text-[10px] text-gray-600 dark:text-gray-300 font-mono">
                PAN: {(form.pan || '').toUpperCase()}
              </div>
              <div className="text-[10px] text-gray-600 dark:text-gray-300 font-mono pt-1">
                Bank: {form.bank?.name || '—'}
              </div>
              <div className="text-[10px] text-gray-600 dark:text-gray-300 font-mono">
                A/C: {form.bank?.acc || '—'} ({form.bank?.accName || form.companyName})
              </div>
              <div className="text-[10px] text-[#D4AF37] font-mono font-semibold">
                IFSC: {(form.bank?.ifsc || '—').toUpperCase()}
              </div>
            </div>

            <div className="pt-2">
              <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
                <span>Profile Readiness</span>
                <span className="font-bold text-[#D4AF37]">{Math.round((completedAssetsCount / 7) * 100)}%</span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-[#1E1E1E] h-2 rounded-full overflow-hidden">
                <div
                  className="bg-[#D4AF37] h-full rounded-full transition-all"
                  style={{ width: `${Math.round((completedAssetsCount / 7) * 100)}%` }}
                />
              </div>
            </div>

            {onNavigateToBilling && (
              <button
                onClick={onNavigateToBilling}
                className="w-full mt-2 py-2 rounded-lg bg-gray-100 dark:bg-[#1E1E1E] text-xs font-semibold text-[#D4AF37] border border-gray-300 dark:border-[#444] flex items-center justify-center gap-1 cursor-pointer"
              >
                <span>Jump to Invoicing</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Section 4: Interface & Theme Preference (UIX-01 / UIX-02) */}
          <div className="bg-white dark:bg-[#121212] rounded-xl border border-gray-200 dark:border-[#333333] p-5 shadow-sm space-y-3 transition-colors">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-900 dark:text-white flex items-center gap-1.5">
                {theme === 'dark' ? <Moon className="w-4 h-4 text-[#D4AF37]" /> : <Sun className="w-4 h-4 text-[#D4AF37]" />}
                <span>Display Appearance</span>
              </h3>
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold uppercase ${
                theme === 'dark'
                  ? 'bg-[#D4AF37]/15 text-[#D4AF37] border border-[#D4AF37]/30'
                  : 'bg-amber-100 text-amber-800 border border-amber-300'
              }`}>
                {theme === 'dark' ? 'Obsidian Dark' : 'Daylight Contrast'}
              </span>
            </div>

            <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
              Switch between Solarithm high-contrast Light mode and Obsidian Dark mode. Your selection persists across browser reloads.
            </p>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={() => setTheme('light')}
                className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  theme === 'light'
                    ? 'bg-[#D4AF37] text-black font-bold shadow-sm'
                    : 'bg-gray-100 dark:bg-[#1E1E1E] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#2A2A2A] border border-gray-300 dark:border-[#444]'
                }`}
              >
                <Sun className="w-3.5 h-3.5" />
                <span>Light Mode</span>
              </button>

              <button
                type="button"
                onClick={() => setTheme('dark')}
                className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  theme === 'dark'
                    ? 'bg-[#D4AF37] text-black font-bold shadow-sm'
                    : 'bg-gray-100 dark:bg-[#1E1E1E] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#2A2A2A] border border-gray-300 dark:border-[#444]'
                }`}
              >
                <Moon className="w-3.5 h-3.5" />
                <span>Dark Mode</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
