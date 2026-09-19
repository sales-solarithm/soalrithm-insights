'use client';
import React, { useState, useEffect, useRef } from 'react';
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
  FileText,
  Eye,
  ShieldCheck,
  Building,
  Globe,
  Phone,
  Mail,
  MapPin,
  FileSignature,
  Stamp,
  Award,
  Sparkles,
  ExternalLink,
  Check
} from 'lucide-react';
import {
  CompanySettings,
  useCompanySettings,
  defaultCompanySettings
} from '@/src/lib/useCompanySettings';

interface CompanySettingsViewProps {
  onNavigateToBilling?: () => void;
}

function readAndResizeImage(file: File, maxDim: number, callback: (dataUrl: string) => void) {
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
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
  const { companySettings, saveCompanySettings } = useCompanySettings();
  const [form, setForm] = useState<CompanySettings>(companySettings);
  const [isDirty, setIsDirty] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [toastType, setToastType] = useState<'success' | 'info' | 'error'>('info');
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Sync state when companySettings changes from outside via custom event
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
    setForm((prev) => {
      const updated = { ...prev, [field]: value };
      return updated;
    });
    setIsDirty(true);
  };

  const handleBankChange = (bankField: keyof typeof form.bank, value: string) => {
    setForm((prev) => ({
      ...prev,
      bank: {
        ...prev.bank,
        [bankField]: value
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

  // Asset completion calculation
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
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-2xl bg-[#1E1E1E] border border-[#D4AF37] text-white text-sm font-medium animate-in fade-in slide-in-from-bottom-5">
          {toastType === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-[#D4AF37]" />
          ) : (
            <AlertCircle className="w-5 h-5 text-amber-400" />
          )}
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Main Settings Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-[#333333] pb-6">
        <div>
          <div className="flex items-center space-x-3 mb-1">
            <div className="p-2.5 rounded-xl bg-[#2A2A2A] border border-[#333333] text-[#D4AF37] shadow-sm">
              <Building2 className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-2xl font-bold text-white tracking-wide">Enterprise Global Settings</h2>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#D4AF37]/15 text-[#D4AF37] border border-[#D4AF37]/30">
                  Global Single Source of Truth
                </span>
              </div>
              <p className="text-sm text-gray-400 mt-0.5">
                Central corporate identity, tax identifiers, branding assets, signatures, and settlement accounts applied across all modules &amp; PDF exports.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={handleResetToDefaults}
            className="flex items-center space-x-2 px-3.5 py-2.5 rounded-lg bg-[#1E1E1E] border border-[#444444] text-xs font-medium text-gray-300 hover:text-white hover:bg-[#2A2A2A] transition-colors"
            title="Reset to default company template"
          >
            <RotateCcw className="w-4 h-4 text-gray-400" />
            <span>Reset Defaults</span>
          </button>

          <button
            onClick={handleSave}
            className={`flex items-center space-x-2 px-5 py-2.5 rounded-lg text-xs font-bold transition-all shadow-lg ${
              isDirty
                ? 'bg-[#D4AF37] hover:bg-[#f2c94c] text-black shadow-[#D4AF37]/30 scale-102 ring-2 ring-[#D4AF37]/60'
                : 'bg-[#D4AF37] hover:bg-[#f2c94c] text-black shadow-[#D4AF37]/20'
            }`}
          >
            <Save className="w-4 h-4 text-black" />
            <span>{isDirty ? 'Save All Changes *' : 'Save Changes'}</span>
          </button>
        </div>
      </div>

      {/* Main Settings Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Form Controls (8 Cols) */}
        <div className="lg:col-span-8 space-y-8">
          {/* SECTION 1: Company Profile & Tax Identifiers */}
          <div className="bg-[#121212] rounded-xl border border-[#333333] p-6 shadow-xl space-y-5">
            <div className="flex items-center justify-between border-b border-[#2A2A2A] pb-3">
              <div className="flex items-center space-x-2.5">
                <div className="p-1.5 rounded-lg bg-[#1E1E1E] text-[#D4AF37]">
                  <Building className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wider text-white">Company &amp; Legal Identity</h3>
                  <p className="text-[11px] text-gray-400">Master entity legal names and tax registration IDs</p>
                </div>
              </div>
              <span className="text-[11px] text-gray-400 font-mono">Section 1 of 4</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-gray-300 mb-1.5">
                  Official Company / Entity Name <span className="text-rose-400 font-bold">*</span>
                </label>
                <input
                  type="text"
                  value={form.companyName || ''}
                  onChange={(e) => handleFieldChange('companyName', e.target.value)}
                  placeholder="e.g. SOLARITHM DESIGN & ENGINEERING CONSULTANCY"
                  className="w-full bg-[#1A1A1A] border border-[#333333] rounded-lg px-3.5 py-2.5 text-sm text-white font-medium focus:outline-none focus:border-[#D4AF37] transition-colors"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-gray-300 mb-1.5">Company Tagline / Subtitle</label>
                <input
                  type="text"
                  value={form.tagline || ''}
                  onChange={(e) => handleFieldChange('tagline', e.target.value)}
                  placeholder="e.g. Smart Design, Sustainable Power"
                  className="w-full bg-[#1A1A1A] border border-[#333333] rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#D4AF37] transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1.5">GSTIN / Tax ID</label>
                <input
                  type="text"
                  value={form.gstin || ''}
                  onChange={(e) => handleFieldChange('gstin', e.target.value)}
                  placeholder="e.g. 24ABCDE1234F1Z5"
                  className="w-full bg-[#1A1A1A] border border-[#333333] rounded-lg px-3.5 py-2.5 text-sm text-white font-mono uppercase focus:outline-none focus:border-[#D4AF37] transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1.5">CIN / Registration No.</label>
                <input
                  type="text"
                  value={form.cin || ''}
                  onChange={(e) => handleFieldChange('cin', e.target.value)}
                  placeholder="e.g. U74999GJ2024PTC123456"
                  className="w-full bg-[#1A1A1A] border border-[#333333] rounded-lg px-3.5 py-2.5 text-sm text-white font-mono uppercase focus:outline-none focus:border-[#D4AF37] transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1.5">PAN (Permanent Account Number)</label>
                <input
                  type="text"
                  value={form.pan || ''}
                  onChange={(e) => handleFieldChange('pan', e.target.value)}
                  placeholder="e.g. ABCDE1234F"
                  className="w-full bg-[#1A1A1A] border border-[#333333] rounded-lg px-3.5 py-2.5 text-sm text-white font-mono uppercase focus:outline-none focus:border-[#D4AF37] transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1.5">Official Website URL</label>
                <input
                  type="text"
                  value={form.website || ''}
                  onChange={(e) => handleFieldChange('website', e.target.value)}
                  placeholder="e.g. https://solarithm.com"
                  className="w-full bg-[#1A1A1A] border border-[#333333] rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#D4AF37] transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1.5">Official Phone Number(s)</label>
                <input
                  type="text"
                  value={form.phone || ''}
                  onChange={(e) => handleFieldChange('phone', e.target.value)}
                  placeholder="e.g. +91 94295 00746 / 63"
                  className="w-full bg-[#1A1A1A] border border-[#333333] rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#D4AF37] transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1.5">Official Business Email</label>
                <input
                  type="email"
                  value={form.email || ''}
                  onChange={(e) => handleFieldChange('email', e.target.value)}
                  placeholder="e.g. info.solarithm@gmail.com"
                  className="w-full bg-[#1A1A1A] border border-[#333333] rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#D4AF37] transition-colors"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-gray-300 mb-1.5">Registered Office Address</label>
                <textarea
                  rows={2}
                  value={form.address || ''}
                  onChange={(e) => handleFieldChange('address', e.target.value)}
                  placeholder="e.g. Surat, Gujarat, India"
                  className="w-full bg-[#1A1A1A] border border-[#333333] rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#D4AF37] transition-colors resize-none"
                />
              </div>
            </div>
          </div>

          {/* SECTION 2: Authorized Signatory Details */}
          <div className="bg-[#121212] rounded-xl border border-[#333333] p-6 shadow-xl space-y-5">
            <div className="flex items-center justify-between border-b border-[#2A2A2A] pb-3">
              <div className="flex items-center space-x-2.5">
                <div className="p-1.5 rounded-lg bg-[#1E1E1E] text-[#D4AF37]">
                  <FileSignature className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wider text-white">Authorized Signatory &amp; Authentication</h3>
                  <p className="text-[11px] text-gray-400">Designated executive authority for signing official documents &amp; invoices</p>
                </div>
              </div>
              <span className="text-[11px] text-gray-400 font-mono">Section 2 of 4</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1.5">Signatory Full Name</label>
                <input
                  type="text"
                  value={form.signatoryName || ''}
                  onChange={(e) => handleFieldChange('signatoryName', e.target.value)}
                  placeholder="e.g. Jay Nilesh Shah"
                  className="w-full bg-[#1A1A1A] border border-[#333333] rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#D4AF37] transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1.5">Signatory Title / Designation</label>
                <input
                  type="text"
                  value={form.signatoryDesignation || ''}
                  onChange={(e) => handleFieldChange('signatoryDesignation', e.target.value)}
                  placeholder="e.g. Authorized Signatory / Managing Partner"
                  className="w-full bg-[#1A1A1A] border border-[#333333] rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#D4AF37] transition-colors"
                />
              </div>
            </div>
          </div>

          {/* SECTION 3: Visual Identity & Branding Assets */}
          <div className="bg-[#121212] rounded-xl border border-[#333333] p-6 shadow-xl space-y-5">
            <div className="flex items-center justify-between border-b border-[#2A2A2A] pb-3">
              <div className="flex items-center space-x-2.5">
                <div className="p-1.5 rounded-lg bg-[#1E1E1E] text-[#D4AF37]">
                  <ImageIcon className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wider text-white">Visual Branding Assets (Logo, Signature &amp; Stamp)</h3>
                  <p className="text-[11px] text-gray-400">High-resolution graphical assets embedded directly on generated documents</p>
                </div>
              </div>
              <span className="text-[11px] text-gray-400 font-mono">Section 3 of 4</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {/* Asset 1: Company Logo */}
              <div className="p-4 rounded-xl bg-[#1A1A1A] border border-[#2D2D2D] flex flex-col justify-between space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold text-gray-200 uppercase tracking-wider flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-[#D4AF37]" />
                      Company Logo
                    </span>
                    {form.logo ? (
                      <span className="text-[10px] text-emerald-400 font-semibold flex items-center gap-0.5">
                        <Check className="w-3 h-3" /> Active
                      </span>
                    ) : (
                      <span className="text-[10px] text-gray-500">Badge Fallback</span>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-400">Printed on invoice headers, salary slips, &amp; proposals.</p>
                </div>

                <div className="border border-dashed border-[#D4AF37]/50 rounded-lg p-3 text-center bg-[#121212] relative min-h-[110px] flex flex-col items-center justify-center hover:border-[#D4AF37] transition-colors group cursor-pointer">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      readAndResizeImage(file, 400, (dataUrl) => {
                        handleFieldChange('logo', dataUrl);
                        showToast('Company logo updated ✓', 'success');
                      });
                    }}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10"
                  />
                  {form.logo ? (
                    <div className="flex flex-col items-center gap-1.5">
                      <img src={form.logo} alt="Company Logo" className="max-h-14 object-contain max-w-[140px]" />
                      <span className="text-[10px] text-gray-400 group-hover:text-[#D4AF37] transition-colors">
                        Click to change
                      </span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-1">
                      <div className="p-2 rounded-full bg-[#1E1E1E] text-[#D4AF37]">
                        <Upload className="w-4 h-4" />
                      </div>
                      <span className="text-xs text-gray-300 font-medium">Upload Logo</span>
                      <span className="text-[10px] text-gray-500">PNG or SVG</span>
                    </div>
                  )}
                </div>

                {form.logo && (
                  <button
                    onClick={() => {
                      handleFieldChange('logo', null);
                      showToast('Logo removed', 'info');
                    }}
                    className="flex items-center justify-center gap-1 text-xs text-rose-400 hover:text-rose-300 font-medium py-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Remove Logo</span>
                  </button>
                )}
              </div>

              {/* Asset 2: Authorized Signature */}
              <div className="p-4 rounded-xl bg-[#1A1A1A] border border-[#2D2D2D] flex flex-col justify-between space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold text-gray-200 uppercase tracking-wider flex items-center gap-1.5">
                      <FileSignature className="w-3.5 h-3.5 text-[#D4AF37]" />
                      Digital Signature
                    </span>
                    {form.signature ? (
                      <span className="text-[10px] text-emerald-400 font-semibold flex items-center gap-0.5">
                        <Check className="w-3 h-3" /> Active
                      </span>
                    ) : (
                      <span className="text-[10px] text-gray-500">Optional</span>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-400">Placed in the official signatory block on PDFs.</p>
                </div>

                <div className="border border-dashed border-[#D4AF37]/50 rounded-lg p-3 text-center bg-[#121212] relative min-h-[110px] flex flex-col items-center justify-center hover:border-[#D4AF37] transition-colors group cursor-pointer">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      readAndResizeImage(file, 360, (dataUrl) => {
                        handleFieldChange('signature', dataUrl);
                        showToast('Authorized signature updated ✓', 'success');
                      });
                    }}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10"
                  />
                  {form.signature ? (
                    <div className="flex flex-col items-center gap-1.5">
                      <img src={form.signature} alt="Signature" className="max-h-14 object-contain max-w-[140px]" />
                      <span className="text-[10px] text-gray-400 group-hover:text-[#D4AF37] transition-colors">
                        Click to replace
                      </span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-1">
                      <div className="p-2 rounded-full bg-[#1E1E1E] text-[#D4AF37]">
                        <Upload className="w-4 h-4" />
                      </div>
                      <span className="text-xs text-gray-300 font-medium">Upload Signature</span>
                      <span className="text-[10px] text-gray-500">Transparent PNG</span>
                    </div>
                  )}
                </div>

                {form.signature && (
                  <button
                    onClick={() => {
                      handleFieldChange('signature', null);
                      showToast('Signature removed', 'info');
                    }}
                    className="flex items-center justify-center gap-1 text-xs text-rose-400 hover:text-rose-300 font-medium py-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Remove Signature</span>
                  </button>
                )}
              </div>

              {/* Asset 3: Official Company Stamp */}
              <div className="p-4 rounded-xl bg-[#1A1A1A] border border-[#2D2D2D] flex flex-col justify-between space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold text-gray-200 uppercase tracking-wider flex items-center gap-1.5">
                      <Stamp className="w-3.5 h-3.5 text-amber-400" />
                      Company Stamp / Seal
                    </span>
                    {form.stamp ? (
                      <span className="text-[10px] text-emerald-400 font-semibold flex items-center gap-0.5">
                        <Check className="w-3 h-3" /> Active
                      </span>
                    ) : (
                      <span className="text-[10px] text-gray-500">Optional</span>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-400">Official company seal overlay for authenticity.</p>
                </div>

                <div className="border border-dashed border-amber-400/50 rounded-lg p-3 text-center bg-[#121212] relative min-h-[110px] flex flex-col items-center justify-center hover:border-amber-400 transition-colors group cursor-pointer">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      readAndResizeImage(file, 360, (dataUrl) => {
                        handleFieldChange('stamp', dataUrl);
                        showToast('Company stamp / seal updated ✓', 'success');
                      });
                    }}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10"
                  />
                  {form.stamp ? (
                    <div className="flex flex-col items-center gap-1.5">
                      <img src={form.stamp} alt="Company Stamp" className="max-h-14 object-contain max-w-[140px]" />
                      <span className="text-[10px] text-gray-400 group-hover:text-amber-400 transition-colors">
                        Click to replace
                      </span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-1">
                      <div className="p-2 rounded-full bg-[#1E1E1E] text-amber-400">
                        <Upload className="w-4 h-4" />
                      </div>
                      <span className="text-xs text-gray-300 font-medium">Upload Stamp</span>
                      <span className="text-[10px] text-gray-500">PNG or JPEG</span>
                    </div>
                  )}
                </div>

                {form.stamp && (
                  <button
                    onClick={() => {
                      handleFieldChange('stamp', null);
                      showToast('Stamp removed', 'info');
                    }}
                    className="flex items-center justify-center gap-1 text-xs text-rose-400 hover:text-rose-300 font-medium py-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Remove Stamp</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* SECTION 4: Default Bank & Settlement Credentials */}
          <div className="bg-[#121212] rounded-xl border border-[#333333] p-6 shadow-xl space-y-5">
            <div className="flex items-center justify-between border-b border-[#2A2A2A] pb-3">
              <div className="flex items-center space-x-2.5">
                <div className="p-1.5 rounded-lg bg-[#1E1E1E] text-[#D4AF37]">
                  <CreditCard className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wider text-white">Default Bank &amp; Settlement Account</h3>
                  <p className="text-[11px] text-gray-400">Direct account numbers and UPI handles printed on official payment slips &amp; invoices</p>
                </div>
              </div>
              <span className="text-[11px] text-gray-400 font-mono">Section 4 of 4</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1.5">Bank Name</label>
                <input
                  type="text"
                  value={form.bank?.name || ''}
                  onChange={(e) => handleBankChange('name', e.target.value)}
                  placeholder="e.g. Bank Of Baroda"
                  className="w-full bg-[#1A1A1A] border border-[#333333] rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#D4AF37] transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1.5">Account Number</label>
                <input
                  type="text"
                  value={form.bank?.acc || ''}
                  onChange={(e) => handleBankChange('acc', e.target.value)}
                  placeholder="e.g. 34670100017957"
                  className="w-full bg-[#1A1A1A] border border-[#333333] rounded-lg px-3.5 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-[#D4AF37] transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1.5">Account / Beneficiary Name</label>
                <input
                  type="text"
                  value={form.bank?.accName || ''}
                  onChange={(e) => handleBankChange('accName', e.target.value)}
                  placeholder="e.g. Jay Nilesh Shah"
                  className="w-full bg-[#1A1A1A] border border-[#333333] rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#D4AF37] transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1.5">IFSC Code</label>
                <input
                  type="text"
                  value={form.bank?.ifsc || ''}
                  onChange={(e) => handleBankChange('ifsc', e.target.value)}
                  placeholder="e.g. BARB0KAMREJ"
                  className="w-full bg-[#1A1A1A] border border-[#333333] rounded-lg px-3.5 py-2.5 text-sm text-white font-mono uppercase focus:outline-none focus:border-[#D4AF37] transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1.5">UPI ID / VPA</label>
                <input
                  type="text"
                  value={form.bank?.upi || ''}
                  onChange={(e) => handleBankChange('upi', e.target.value)}
                  placeholder="e.g. jayjalpa2002@okaxis"
                  className="w-full bg-[#1A1A1A] border border-[#333333] rounded-lg px-3.5 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-[#D4AF37] transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1.5">Branch Name (Optional)</label>
                <input
                  type="text"
                  value={form.bank?.branch || ''}
                  onChange={(e) => handleBankChange('branch', e.target.value)}
                  placeholder="e.g. Kamrej Branch"
                  className="w-full bg-[#1A1A1A] border border-[#333333] rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#D4AF37] transition-colors"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Live Header & Document Preview (4 Cols) */}
        <div className="lg:col-span-4 space-y-6">
          {/* Live Document Preview Card */}
          <div className="bg-[#121212] rounded-xl border border-[#333333] p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#2A2A2A] pb-3">
              <div className="flex items-center space-x-2">
                <Eye className="w-4 h-4 text-[#D4AF37]" />
                <h3 className="text-sm font-bold uppercase tracking-wider text-white">Live Document Preview</h3>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Real-time
              </span>
            </div>

            <p className="text-xs text-gray-400 leading-relaxed">
              Instant visualization of how your company profile, branding assets, tax codes, and signature appear on generated PDFs.
            </p>

            {/* Rendered Mock Header Band */}
            <div className="bg-white rounded-lg p-4 text-black shadow-inner border border-gray-200">
              <div className="flex items-start justify-between gap-3 border-b-2 border-[#D4AF37] pb-3">
                <div className="flex items-start gap-2.5">
                  {form.logo ? (
                    <img src={form.logo} alt="Company Logo" className="h-10 max-w-[80px] object-contain" />
                  ) : (
                    <div className="w-10 h-10 rounded bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-[#D4AF37] text-xs font-bold font-mono">
                      SOL
                    </div>
                  )}
                  <div>
                    <div className="text-xs font-bold text-gray-900 leading-tight uppercase">
                      {form.companyName || 'COMPANY NAME'}
                    </div>
                    {form.tagline && (
                      <div className="text-[10px] text-amber-700 italic mt-0.5">{form.tagline}</div>
                    )}
                    {form.gstin && (
                      <div className="text-[9px] font-mono text-gray-600 mt-0.5">GSTIN: {form.gstin}</div>
                    )}
                    {form.pan && (
                      <div className="text-[9px] font-mono text-gray-600">PAN: {form.pan}</div>
                    )}
                  </div>
                </div>

                <div className="text-[9px] text-gray-700 text-right space-y-0.5 font-mono">
                  {form.phone && <div>📞 {form.phone}</div>}
                  {form.email && <div>✉ {form.email}</div>}
                  {form.website && <div>🌐 {form.website.replace(/^https?:\/\//, '')}</div>}
                  {form.address && <div>📍 {form.address}</div>}
                </div>
              </div>

              {/* Rendered Mock Bank Details Box */}
              <div className="mt-3 pt-2 text-[10px] text-gray-800 bg-gray-50 rounded p-2.5 border border-gray-200">
                <div className="text-[9px] font-bold text-[#D4AF37] uppercase tracking-wider mb-1">
                  Settlement Account
                </div>
                <div className="grid grid-cols-2 gap-1 text-[9px] font-mono">
                  <div>Bank: <span className="font-semibold">{form.bank?.name || '—'}</span></div>
                  <div>A/C: <span className="font-semibold">{form.bank?.acc || '—'}</span></div>
                  <div>Name: <span className="font-semibold">{form.bank?.accName || '—'}</span></div>
                  <div>IFSC: <span className="font-semibold">{form.bank?.ifsc || '—'}</span></div>
                  {form.bank?.upi && <div className="col-span-2">UPI: <span className="font-semibold">{form.bank.upi}</span></div>}
                </div>
              </div>

              {/* Rendered Mock Signature & Stamp Box */}
              <div className="mt-3 pt-2 border-t border-gray-200 flex items-center justify-between">
                <div className="text-[8px] text-gray-500 italic">
                  Document Authentication Seal
                </div>
                <div className="flex items-center gap-2">
                  {form.stamp && (
                    <img src={form.stamp} alt="Stamp" className="h-8 max-w-[50px] object-contain opacity-85" />
                  )}
                  <div className="text-right">
                    {form.signature && (
                      <img src={form.signature} alt="Signature" className="h-6 max-w-[60px] object-contain ml-auto" />
                    )}
                    <div className="text-[8px] font-bold text-gray-800">
                      {form.signatoryName || 'Authorized Signatory'}
                    </div>
                    <div className="text-[7px] text-gray-500">
                      {form.signatoryDesignation || 'Authorised Signature'}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Stats / Completeness Card */}
          <div className="bg-[#121212] rounded-xl border border-[#333333] p-5 space-y-3">
            <div className="flex items-center space-x-2 text-[#D4AF37]">
              <ShieldCheck className="w-4 h-4" />
              <h4 className="text-xs font-bold uppercase tracking-wider text-white">Profile Completeness</h4>
            </div>
            <div className="w-full bg-[#1E1E1E] h-2 rounded-full overflow-hidden border border-[#333333]">
              <div
                className="bg-[#D4AF37] h-full transition-all duration-500 rounded-full"
                style={{ width: `${Math.round((completedAssetsCount / 7) * 100)}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-gray-400">
              <span>{completedAssetsCount} of 7 core details filled</span>
              <span className="font-mono text-[#D4AF37] font-semibold">
                {Math.round((completedAssetsCount / 7) * 100)}%
              </span>
            </div>

            {onNavigateToBilling && (
              <button
                onClick={onNavigateToBilling}
                className="w-full flex items-center justify-center space-x-1.5 px-3 py-2.5 rounded-lg bg-[#1E1E1E] hover:bg-[#2A2A2A] border border-[#444444] text-xs font-semibold text-[#D4AF37] transition-colors mt-2"
              >
                <span>Jump to Invoicing &amp; Billing</span>
                <ExternalLink className="w-3.5 h-3.5 ml-1" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
