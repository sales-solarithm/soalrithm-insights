'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { 
  X, 
  Save, 
  AlertCircle, 
  FolderKanban, 
  DollarSign, 
  Calendar, 
  User, 
  Building2, 
  Layers, 
  Zap, 
  CheckCircle2, 
  HelpCircle 
} from 'lucide-react';
import { 
  safeNumber, 
  formatCurrency, 
  parseSafeDate, 
  formatSafeDate, 
  formatIndianName, 
  toTitleCase, 
  SCOPE_LABELS,
  getEmployeeNameEnhanced,
  formatTwoPartName,
  toCanonicalScopeKey
} from '@/src/lib/projectUtils';
import { useDynamicTaxonomy } from '@/src/lib/taxonomyService';

export interface EditProjectModalProps {
  isOpen: boolean;
  project: any;
  clients?: any[];
  users?: any[];
  scopes?: any[];
  onClose: () => void;
  onSave: (updatedData: any) => Promise<void> | void;
  isSaving?: boolean;
}

// Canonical Display Labels for Standard Scopes
const CANONICAL_SCOPE_DISPLAY_LABELS: Record<string, string> = {
  preDesign: 'Pre-Design',
  postDesign: 'Post-Design',
  detailedEngineering: 'Detailed Engineering',
  pvsyst: 'PVsyst',
  ceig: 'CEIG Package',
  ifp: 'IFP Process',
  sld: 'Single Line Diagram (SLD)',
  bom: 'Bill of Materials (BOM)',
  peStamping: 'PE Stamping Review',
  asBuilt: 'As-Built Drawings',
  interconnection: 'Interconnection Package',
  ceiLayouts: 'CEI Layouts',
  pipeCalculation: 'Pipe Calculation',
  preDesignCeigIfp: 'Pre-Design + CEIG + IFP',
  postDesignCeigIfp: 'Post-Design + CEIG + IFP',
  preDesignPvsyst: 'Pre-Design + PVsyst',
  postDesignPvsyst: 'Post-Design + PVsyst',
  preDesignPvsystCeigIfp: 'Pre-Design + PVsyst + CEIG + IFP',
  postDesignPvsystCeigIfp: 'Post-Design + PVsyst + CEIG + IFP',
};


function getInitialProjectFormData(project: any) {
  if (!project) {
    return {
      projectName: '',
      clientName: '',
      clientId: '',
      plantCapacity: 0,
      capacityUnit: 'KW',
      scopeOfWork: 'Detailed Engineering',
      subService: 'Standard',
      projectDate: '',
      designerEmail: '',
      designerName: '',
      salesPersonEmail: '',
      calculatedCost: 0,
      finalCost: 0,
      designerCommission: 0,
      salesCommission: 0,
      status: 'Active',
      pricingCategory: 'T1'
    };
  }

  // Resolve date safely using local year/month/date (prevents 1-day timezone offset)
  const d = parseSafeDate(project.projectDate || project.date || project.createdAt);
  const dateFormatted = d ? formatSafeDate(d, 'input') : '';

  // Resolve capacity safely
  const rawCap = project.plantCapacity ?? project.systemCapacity ?? project.capacity ?? 0;
  const numCap = parseFloat(String(rawCap).replace(/[^\d.]/g, '')) || 0;

  // Resolve costs safely
  const costVal = safeNumber(
    project.finalCost ?? project.calculatedCost ?? project.cost ?? project.amount ?? project.totalCost ?? 0
  );

  // Resolve commissions safely
  const desCommVal = safeNumber(
    project.designerCommission ?? project.designerFee ?? project.financials?.designerCommission ?? 0
  );

  const salesCommVal = safeNumber(
    project.salesCommission ?? project.commission ?? project.totalCommission ?? project.financials?.salesCommission ?? 0
  );

  return {
    projectName: project.projectName || project.name || '',
    clientName: project.clientName || project.matchedClient?.companyName || '',
    clientId: project.clientId || project.matchedClient?.id || '',
    plantCapacity: numCap,
    capacityUnit: project.capacityUnit || 'KW',
    scopeOfWork: (() => {
      const raw = project.scopeOfWork || project.scope || 'Detailed Engineering';
      const key = toCanonicalScopeKey(raw);
      return CANONICAL_SCOPE_DISPLAY_LABELS[key] || toTitleCase(raw);
    })(),
    subService: project.subService || 'Standard',
    projectDate: dateFormatted,
    designerEmail: project.designerEmail || project.designer_email || project.designer || project.assignedDesigner || '',
    designerName: project.designerName || project.assignedDesignerName || '',
    salesPersonEmail: project.salesPersonEmail || '',
    calculatedCost: costVal,
    finalCost: costVal,
    designerCommission: desCommVal,
    salesCommission: salesCommVal,
    status: project.status || 'Active',
    pricingCategory: project.pricingCategory || 'T1'
  };
}

export default function EditProjectModal({
  isOpen,
  project,
  clients = [],
  users = [],
  scopes = [],
  onClose,
  onSave,
  isSaving = false
}: EditProjectModalProps) {
  // Dynamic Taxonomy from Firestore (/scopes, /pricingRules, /metadata/taxonomies)
  const { canonicalScopes } = useDynamicTaxonomy();
  // Sync state cleanly when project prop changes without useEffect
  const [prevProjectId, setPrevProjectId] = useState<string | null>(project?.id || null);
  const [formData, setFormData] = useState<any>(() => getInitialProjectFormData(project));
  const [validationError, setValidationError] = useState<string | null>(null);

  if (project?.id && project.id !== prevProjectId) {
    setPrevProjectId(project.id);
    setFormData(getInitialProjectFormData(project));
    setValidationError(null);
  }

  if (!isOpen || !project) return null;

  // Deduplicated & Canonical Scope Options (Collapses 'Pre Design' and 'Pre-Design' into one)
  const dynamicScopeOptions = useMemo(() => {
    const scopeMap = new Map<string, { value: string; label: string }>();

    // 1. Ingest scopes from Dynamic Firestore Taxonomy & passed scopes prop
    const rawSources: any[] = [...(canonicalScopes || []), ...(scopes || [])];

    rawSources.forEach((s: any) => {
      const raw = typeof s === 'string' ? s : (s?.name || s?.scopeOfWork || s?.scope || s?.title || '');
      if (!raw || !String(raw).trim()) return;
      const trimmed = String(raw).trim();
      const canonKey = toCanonicalScopeKey(trimmed);
      if (!scopeMap.has(canonKey)) {
        const cleanLabel = CANONICAL_SCOPE_DISPLAY_LABELS[canonKey] || toTitleCase(trimmed);
        scopeMap.set(canonKey, { value: cleanLabel, label: cleanLabel });
      }
    });

    // 2. Ensure standard architectural scopes are always available if DB is loading
    const defaultFallbacks = [
      'Pre-Design',
      'Detailed Engineering',
      'Post-Design',
      'PVsyst',
      'CEI Layouts',
      'Pipe Calculation',
      'Single Line Diagram (SLD)',
      'Pre-Design + PVsyst',
      'Pre-Design + CEIG + IFP',
      'Post-Design + CEIG + IFP'
    ];
    defaultFallbacks.forEach((fb) => {
      const canonKey = toCanonicalScopeKey(fb);
      if (!scopeMap.has(canonKey)) {
        const cleanLabel = CANONICAL_SCOPE_DISPLAY_LABELS[canonKey] || fb;
        scopeMap.set(canonKey, { value: cleanLabel, label: cleanLabel });
      }
    });

    // 3. Ensure active project's scope is present
    const projScope = project?.scopeOfWork || project?.scope || formData.scopeOfWork || '';
    if (projScope && String(projScope).trim()) {
      const canonKey = toCanonicalScopeKey(String(projScope).trim());
      if (!scopeMap.has(canonKey)) {
        const cleanLabel = CANONICAL_SCOPE_DISPLAY_LABELS[canonKey] || toTitleCase(String(projScope).trim());
        scopeMap.set(canonKey, { value: cleanLabel, label: cleanLabel });
      }
    }

    return Array.from(scopeMap.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [canonicalScopes, scopes, project, formData.scopeOfWork]);

  // Filter designer employees
  const designerOptions = (users || []).filter((u: any) => {
    const role = String(u.role || '').toLowerCase();
    const dept = String(u.department || '').toLowerCase();
    const desig = String(u.designation || '').toLowerCase();
    return (
      role.includes('designer') || 
      dept.includes('design') || 
      desig.includes('designer') || 
      role.includes('engineer') ||
      dept.includes('engineer')
    ) || (!role.includes('client') && !role.includes('vendor'));
  });

  // Designer selection handler
  const handleDesignerChange = (email: string) => {
    const resolvedName = getEmployeeNameEnhanced(email, users);
    setFormData((prev: any) => ({
      ...prev,
      designerEmail: email,
      designerName: formatTwoPartName(resolvedName) || email.split('@')[0]
    }));
  };

  // Client selection handler
  const handleClientChange = (companyName: string) => {
    const foundClient = (clients || []).find(c => c.companyName === companyName);
    setFormData((prev: any) => ({
      ...prev,
      clientName: companyName,
      clientId: foundClient?.id || prev.clientId,
      pricingCategory: foundClient?.pricingCategory || prev.pricingCategory
    }));
  };

  // Submit Handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.projectName.trim()) {
      setValidationError('Project name cannot be empty.');
      return;
    }

    const finalCostValue = safeNumber(formData.finalCost !== '' && Number(formData.finalCost) > 0 ? formData.finalCost : formData.calculatedCost, 0);
    const salesCommissionValue = safeNumber(formData.salesCommission, 0);
    const designerCommissionValue = safeNumber(formData.designerCommission, 0);
    const plantCapacityValue = safeNumber(formData.plantCapacity, 0);

    // CRITICAL DATE PRESERVATION (Audit Task 5):
    // Preserve existing date strictly: project.projectDate || project.date || project.createdAt
    // Do NOT set new Date() unless user explicitly changed date picker value
    const rawExistingDate = project.projectDate || project.date || project.createdAt || '';
    const parsedRaw = parseSafeDate(rawExistingDate);
    const initialFormattedDate = parsedRaw ? formatSafeDate(parsedRaw, 'input') : '';
    const dateExplicitlyChanged = Boolean(formData.projectDate && formData.projectDate !== initialFormattedDate);
    const finalProjectDate = dateExplicitlyChanged ? formData.projectDate : (rawExistingDate || formData.projectDate);

    const submissionPayload = {
      ...project,
      projectName: formData.projectName.trim(),
      clientName: formData.clientName.trim(),
      clientId: formData.clientId || project.clientId || '',
      plantCapacity: plantCapacityValue,
      systemCapacity: plantCapacityValue,
      capacity: plantCapacityValue,
      capacityUnit: formData.capacityUnit || 'KW',
      scopeOfWork: formData.scopeOfWork,
      subService: formData.subService || 'Standard',
      projectDate: finalProjectDate,
      date: finalProjectDate,
      createdAt: project.createdAt || finalProjectDate,
      designerEmail: formData.designerEmail,
      designerName: formData.designerName || (formData.designerEmail ? formData.designerEmail.split('@')[0] : ''),
      salesPersonEmail: formData.salesPersonEmail || project.salesPersonEmail || '',
      calculatedCost: finalCostValue,
      finalCost: finalCostValue,
      cost: finalCostValue,
      // CRITICAL COMMISSION PERSISTENCE: Write across all common key aliases
      salesCommission: salesCommissionValue,
      commission: salesCommissionValue,
      totalCommission: salesCommissionValue + designerCommissionValue,
      designerCommission: designerCommissionValue,
      designerFee: designerCommissionValue,
      status: formData.status,
      pricingCategory: formData.pricingCategory,
      updatedAt: new Date().toISOString()
    };

    // Optimistic UI Updates (Directive 4 / WRK-01):
    // Close modal instantly (0 ms delay) and run state update and persistence in background
    onClose();
    try {
      await onSave(submissionPayload);
    } catch (err: any) {
      console.error('[EditProjectModal] Failed to persist project changes:', err);
    }
  };

  // Calculation summaries with zero-safe math (empty string '' evaluates as 0)
  const cost = safeNumber(formData.finalCost !== '' && Number(formData.finalCost) > 0 ? formData.finalCost : formData.calculatedCost, 0);
  const desComm = safeNumber(formData.designerCommission, 0);
  const salesComm = safeNumber(formData.salesCommission, 0);
  const totalCommissions = desComm + salesComm;
  const netCompanyBalance = cost - totalCommissions;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] rounded-xl shadow-2xl w-full max-w-3xl overflow-hidden max-h-[92vh] flex flex-col">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-[#333333] flex justify-between items-center bg-gray-50/70 dark:bg-[#141414]/70 shrink-0">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-lg bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/30">
              <FolderKanban className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900 dark:text-white">
                Edit Project Row & Commission Matrix
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Update operational parameters, assigned engineers, and locked commission overrides.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-[#252525] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-5 text-xs flex-1">
          {validationError && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 rounded-lg flex items-center gap-2 text-rose-600 dark:text-rose-400">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{validationError}</span>
            </div>
          )}

          {/* Section 1: Identification & Client */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-semibold uppercase text-gray-600 dark:text-gray-400 mb-1 text-[11px] flex items-center gap-1">
                <FolderKanban className="w-3.5 h-3.5 text-[#D4AF37]" />
                <span>Project Name *</span>
              </label>
              <input
                type="text"
                value={formData.projectName}
                onChange={(e) => setFormData({ ...formData, projectName: e.target.value })}
                className="w-full bg-gray-50 dark:bg-[#121212] border border-gray-300 dark:border-[#333333] focus:border-[#D4AF37] rounded-lg px-3 py-2 text-gray-900 dark:text-white font-medium focus:outline-none transition-colors"
                placeholder="Enter project name..."
                required
              />
            </div>

            <div>
              <label className="block font-semibold uppercase text-gray-600 dark:text-gray-400 mb-1 text-[11px] flex items-center gap-1">
                <Building2 className="w-3.5 h-3.5 text-[#D4AF37]" />
                <span>Client Name *</span>
              </label>
              <input
                type="text"
                list="client-options-list"
                value={formData.clientName}
                onChange={(e) => handleClientChange(e.target.value)}
                className="w-full bg-gray-50 dark:bg-[#121212] border border-gray-300 dark:border-[#333333] focus:border-[#D4AF37] rounded-lg px-3 py-2 text-gray-900 dark:text-white font-medium focus:outline-none transition-colors"
                placeholder="Select or enter client name..."
                required
              />
              <datalist id="client-options-list">
                {(clients || []).map((c) => (
                  <option key={c.id || c.companyName} value={c.companyName} />
                ))}
              </datalist>
            </div>
          </div>

          {/* Section 2: Technical Specifications & Date */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block font-semibold uppercase text-gray-600 dark:text-gray-400 mb-1 text-[11px] flex items-center gap-1">
                <Zap className="w-3.5 h-3.5 text-[#D4AF37]" />
                <span>System Capacity (kWp)</span>
              </label>
              <div className="flex">
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={formData.plantCapacity !== undefined && formData.plantCapacity !== null ? formData.plantCapacity : ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    setFormData({
                      ...formData,
                      plantCapacity: val === '' ? '' : (isNaN(parseFloat(val)) ? '' : parseFloat(val))
                    });
                  }}
                  className="w-full bg-gray-50 dark:bg-[#121212] border border-r-0 border-gray-300 dark:border-[#333333] focus:border-[#D4AF37] rounded-l-lg px-3 py-2 text-gray-900 dark:text-white font-mono focus:outline-none"
                  required
                />
                <span className="bg-gray-100 dark:bg-[#252525] border border-gray-300 dark:border-[#333333] rounded-r-lg px-2.5 py-2 text-gray-700 dark:text-gray-300 font-bold text-xs flex items-center">
                  kWp
                </span>
              </div>
            </div>

            <div>
              <label className="block font-semibold uppercase text-gray-600 dark:text-gray-400 mb-1 text-[11px] flex items-center gap-1">
                <Layers className="w-3.5 h-3.5 text-[#D4AF37]" />
                <span>Scope of Work</span>
              </label>
              <select
                value={formData.scopeOfWork}
                onChange={(e) => setFormData({ ...formData, scopeOfWork: e.target.value })}
                className="w-full bg-gray-50 dark:bg-[#121212] border border-gray-300 dark:border-[#333333] focus:border-[#D4AF37] rounded-lg px-3 py-2 text-gray-900 dark:text-white cursor-pointer focus:outline-none"
              >
                {dynamicScopeOptions.map((opt: { value: string; label: string }) => (
                  <option key={opt.value} value={opt.value} className="bg-white dark:bg-[#1E1E1E] text-gray-900 dark:text-white">
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-semibold uppercase text-gray-600 dark:text-gray-400 mb-1 text-[11px] flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-[#D4AF37]" />
                <span>Project Date</span>
              </label>
              <input
                type="date"
                value={formData.projectDate}
                onChange={(e) => setFormData({ ...formData, projectDate: e.target.value })}
                className="w-full bg-gray-50 dark:bg-[#121212] border border-gray-300 dark:border-[#333333] focus:border-[#D4AF37] rounded-lg px-3 py-2 text-gray-900 dark:text-white font-mono focus:outline-none cursor-pointer"
                required
              />
            </div>
          </div>

          {/* Section 3: Designer Assignment & Status */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-semibold uppercase text-gray-600 dark:text-gray-400 mb-1 text-[11px] flex items-center gap-1">
                <User className="w-3.5 h-3.5 text-[#D4AF37]" />
                <span>Assigned Designer</span>
              </label>
              <select
                value={formData.designerEmail}
                onChange={(e) => handleDesignerChange(e.target.value)}
                className="w-full bg-gray-50 dark:bg-[#121212] border border-gray-300 dark:border-[#333333] focus:border-[#D4AF37] rounded-lg px-3 py-2 text-gray-900 dark:text-white cursor-pointer focus:outline-none"
              >
                <option value="" className="bg-white dark:bg-[#1E1E1E] text-gray-500">Unassigned</option>
                {/* Dynamically append assigned designer option if not already in filtered designerOptions */}
                {formData.designerEmail && !designerOptions.some((d: any) => String(d.email || '').toLowerCase() === String(formData.designerEmail).toLowerCase()) && (
                  <option value={formData.designerEmail} className="bg-white dark:bg-[#1E1E1E] text-[#D4AF37] font-semibold">
                    {formatTwoPartName(getEmployeeNameEnhanced(formData.designerEmail, users))} ({formData.designerEmail})
                  </option>
                )}
                {designerOptions.map((des: any) => (
                  <option 
                    key={des.email || des.id} 
                    value={des.email} 
                    className="bg-white dark:bg-[#1E1E1E] text-gray-900 dark:text-white"
                  >
                    {formatTwoPartName(getEmployeeNameEnhanced(des.email, users))} ({des.email})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-semibold uppercase text-gray-600 dark:text-gray-400 mb-1 text-[11px] flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-[#D4AF37]" />
                <span>Project Status</span>
              </label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                className="w-full bg-gray-50 dark:bg-[#121212] border border-gray-300 dark:border-[#333333] focus:border-[#D4AF37] rounded-lg px-3 py-2 text-gray-900 dark:text-white cursor-pointer focus:outline-none"
              >
                <option value="Active" className="bg-white dark:bg-[#1E1E1E] text-gray-900 dark:text-white">Active</option>
                <option value="In Progress" className="bg-white dark:bg-[#1E1E1E] text-gray-900 dark:text-white">In Progress</option>
                <option value="Approved" className="bg-white dark:bg-[#1E1E1E] text-gray-900 dark:text-white">Approved / Completed</option>
                <option value="In Revision" className="bg-white dark:bg-[#1E1E1E] text-gray-900 dark:text-white">In Revision</option>
                <option value="Not Started" className="bg-white dark:bg-[#1E1E1E] text-gray-900 dark:text-white">Not Started</option>
              </select>
            </div>
          </div>

          {/* Section 4: Financials & Commission Persistence (CRITICAL BUG FIX AREA) */}
          <div className="bg-gray-50 dark:bg-[#141414] p-4 rounded-xl border border-gray-200 dark:border-[#2A2A2A] space-y-4">
            <div className="flex items-center justify-between border-b border-gray-200 dark:border-[#2A2A2A] pb-2">
              <span className="font-bold text-gray-900 dark:text-white uppercase text-[11px] tracking-wider flex items-center gap-1.5">
                <DollarSign className="w-4 h-4 text-[#D4AF37]" />
                <span>Financial & Commission Overrides</span>
              </span>
              <span className="text-[10px] text-amber-600 dark:text-[#D4AF37] font-semibold bg-[#D4AF37]/10 px-2 py-0.5 rounded border border-[#D4AF37]/30">
                Direct Firestore Lock
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block font-semibold uppercase text-gray-600 dark:text-gray-400 mb-1 text-[10px]">
                  Final Cost (₹) *
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={formData.finalCost !== undefined && formData.finalCost !== null ? formData.finalCost : ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    const parsed = val === '' ? '' : (isNaN(parseFloat(val)) ? '' : parseFloat(val));
                    setFormData({
                      ...formData,
                      finalCost: parsed,
                      calculatedCost: parsed
                    });
                  }}
                  className="w-full bg-white dark:bg-[#1E1E1E] border border-gray-300 dark:border-[#333333] focus:border-[#D4AF37] rounded-lg px-3 py-2 text-gray-900 dark:text-white font-mono font-bold focus:outline-none"
                  required
                />
                <span className="text-[10px] text-gray-500 mt-1 block">Total client contract value</span>
              </div>

              <div>
                <label className="block font-semibold uppercase text-gray-600 dark:text-gray-400 mb-1 text-[10px]">
                  Designer Fee / Base Cost (₹)
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={formData.designerCommission !== undefined && formData.designerCommission !== null ? formData.designerCommission : ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    setFormData({
                      ...formData,
                      designerCommission: val === '' ? '' : (isNaN(parseFloat(val)) ? '' : parseFloat(val))
                    });
                  }}
                  className="w-full bg-white dark:bg-[#1E1E1E] border border-gray-300 dark:border-[#333333] focus:border-[#D4AF37] rounded-lg px-3 py-2 text-gray-800 dark:text-gray-200 font-mono focus:outline-none"
                />
                <span className="text-[10px] text-gray-500 mt-1 block">Incentive paid to designer</span>
              </div>

              <div>
                <label className="block font-semibold uppercase text-[#D4AF37] mb-1 text-[10px] flex items-center justify-between">
                  <span>Sales Commission (₹)</span>
                  <span className="text-[9px] font-normal uppercase text-gray-400">Locked Output</span>
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={formData.salesCommission !== undefined && formData.salesCommission !== null ? formData.salesCommission : ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    setFormData({
                      ...formData,
                      salesCommission: val === '' ? '' : (isNaN(parseFloat(val)) ? '' : parseFloat(val))
                    });
                  }}
                  className="w-full bg-white dark:bg-[#1E1E1E] border border-[#D4AF37]/50 focus:border-[#D4AF37] rounded-lg px-3 py-2 text-[#D4AF37] font-mono font-bold focus:outline-none"
                />
                <span className="text-[10px] text-gray-500 mt-1 block">Persists to salesCommission & commission</span>
              </div>
            </div>

            {/* Live Calculation Preview Banner */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-gray-200 dark:border-[#222]">
              <div className="p-2 rounded bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333]">
                <span className="text-[10px] text-gray-500 uppercase">Cost of Project:</span>
                <span className="block font-mono font-bold text-gray-900 dark:text-white">{formatCurrency(cost)}</span>
              </div>
              <div className="p-2 rounded bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333]">
                <span className="text-[10px] text-gray-500 uppercase">Designer Expense:</span>
                <span className="block font-mono font-bold text-gray-700 dark:text-gray-300">{formatCurrency(desComm)}</span>
              </div>
              <div className="p-2 rounded bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333]">
                <span className="text-[10px] text-[#D4AF37] uppercase font-semibold">Sales Expense:</span>
                <span className="block font-mono font-bold text-[#D4AF37]">{formatCurrency(salesComm)}</span>
              </div>
              <div className="p-2 rounded bg-[#D4AF37]/10 border border-[#D4AF37]/30">
                <span className="text-[10px] text-emerald-600 dark:text-emerald-400 uppercase font-semibold">Gross Balance:</span>
                <span className="block font-mono font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(netCompanyBalance)}</span>
              </div>
            </div>
          </div>
        </form>

        {/* Modal Footer */}
        <div className="px-6 py-4 bg-gray-50 dark:bg-[#141414] border-t border-gray-200 dark:border-[#333333] flex justify-end gap-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="px-4 py-2 rounded-lg text-xs font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#252525] transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSaving}
            className="px-5 py-2 rounded-lg text-xs font-semibold bg-[#D4AF37] hover:bg-[#c49f2c] text-black shadow-sm flex items-center gap-1.5 transition-all cursor-pointer"
          >
            <Save className="w-4 h-4" />
            <span>{isSaving ? 'Saving Project...' : 'Save & Persist Changes'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
