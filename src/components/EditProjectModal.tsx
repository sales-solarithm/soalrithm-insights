'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
  findMatchingCapacityRow,
  calculateSlabCost,
  calculateSlabCommission,
  calculateCompoundPackagePrice,
  isZeroOrPositive
} from '@/src/lib/projectUtils';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '@/src/lib/firebase';
import { COLLECTIONS } from '@/src/config/schema';

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

// Case-insensitive and punctuation-insensitive normalization
export const normalizeKey = (str: string) =>
  String(str || '')
    .toLowerCase()
    .replace(/[\s\-_]+/g, '')
    .trim();

// Clean TitleCase formatting for scopes preserving standard acronyms (CEI, CEIG, PVsyst, etc.)
export function formatScopeTitleCase(str: string): string {
  const trimmed = String(str || '').trim();
  if (!trimmed) return '';

  const specialWords: Record<string, string> = {
    cei: 'CEI',
    ceig: 'CEIG',
    ifp: 'IFP',
    pvsyst: 'PVsyst',
    sld: 'SLD',
    bom: 'BOM',
    pe: 'PE',
    kw: 'kW',
    kwp: 'kWp',
    mw: 'MW'
  };

  const isAllUpper = trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed);

  const tokens = trimmed.split(/([\s\-_+]+)/);
  return tokens
    .map((token) => {
      if (/^[\s\-_+]+$/.test(token)) {
        return token === '_' ? ' ' : token;
      }
      const lower = token.toLowerCase();
      if (specialWords[lower]) {
        return specialWords[lower];
      }
      if (isAllUpper || token === token.toLowerCase()) {
        return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
      }
      return token.charAt(0).toUpperCase() + token.slice(1);
    })
    .join('');
}

function getInitialProjectFormData(project: any) {
  if (!project) {
    return {
      projectName: '',
      clientName: '',
      clientId: '',
      plantCapacity: 0,
      capacityUnit: 'KW',
      scopeOfWork: '',
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

  const rawScope = project.scopeOfWork || project.scope || '';
  const cleanScope = formatScopeTitleCase(rawScope);

  return {
    projectName: project.projectName || project.name || '',
    clientName: project.clientName || project.matchedClient?.companyName || '',
    clientId: project.clientId || project.matchedClient?.id || '',
    plantCapacity: numCap,
    capacityUnit: project.capacityUnit || 'KW',
    scopeOfWork: cleanScope,
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
  // Sync state cleanly when project prop changes without useEffect
  const [prevProjectId, setPrevProjectId] = useState<string | null>(project?.id || null);
  const [formData, setFormData] = useState<any>(() => getInitialProjectFormData(project));
  const [validationError, setValidationError] = useState<string | null>(null);
  const [recalcFeedback, setRecalcFeedback] = useState<{
    tier: string;
    rateSummary: string;
    cost: number;
    scope: string;
  } | null>(null);

  if (project?.id && project.id !== prevProjectId) {
    setPrevProjectId(project.id);
    setFormData(getInitialProjectFormData(project));
    setValidationError(null);
    setRecalcFeedback(null);
  }

  const [adminConsoleScopes, setAdminConsoleScopes] = useState<string[]>([]);
  const [rawPricingRules, setRawPricingRules] = useState<any[]>([]);
  const [rawCommissionRules, setRawCommissionRules] = useState<any[]>([]);

  useEffect(() => {
    if (!db) return;
    let scopesList: string[] = [];
    let pricingRulesScopesList: string[] = [];

    const updateCombinedScopes = () => {
      const combined = [...scopesList, ...pricingRulesScopesList].filter(Boolean);
      if (combined.length > 0) {
        setAdminConsoleScopes(Array.from(new Set(combined)));
      }
    };

    // 1. Listen to the Admin Console's scopes collection
    const unsubScopes = onSnapshot(
      collection(db, COLLECTIONS.SCOPES),
      (snap) => {
        scopesList = snap.docs
          .map((d) => {
            const data = d.data();
            return (data.name || data.scopeOfWork || data.scope || data.title || d.id || '').trim();
          })
          .filter(Boolean);
        updateCombinedScopes();
      },
      (err) => console.warn('[EditProjectModal] Scopes listener warning:', err)
    );

    // 2. Listen to the Admin Console's pricingRules collection
    const unsubRules = onSnapshot(
      collection(db, COLLECTIONS.PRICING_RULES),
      (snap) => {
        const rules = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setRawPricingRules(rules);
        pricingRulesScopesList = rules
          .map((r: any) => (r.scopeOfWork || r.scope || r.scopeName || r.name || '').trim())
          .filter(Boolean);
        updateCombinedScopes();
      },
      (err) => console.warn('[EditProjectModal] Pricing rules listener warning:', err)
    );

    // 3. Listen to commissionRules collection
    const unsubCommissions = onSnapshot(
      collection(db, 'commissionRules'),
      (snap) => {
        const rules = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setRawCommissionRules(rules);
      },
      (err) => console.warn('[EditProjectModal] Commission rules listener warning:', err)
    );

    return () => {
      unsubScopes();
      unsubRules();
      unsubCommissions();
    };
  }, []);

  // Deduplicated & Canonical Scope Options (Case-insensitive & punctuation-insensitive)
  const dynamicScopeOptions = useMemo(() => {
    const scopeMap = new Map<string, { value: string; label: string }>();

    const addScope = (raw: any) => {
      if (!raw) return;
      const label = typeof raw === 'string' ? raw : (raw?.name || raw?.scopeOfWork || raw?.scope || raw?.title || '');
      const str = String(label || '').trim();
      if (!str) return;

      const normKey = normalizeKey(str);
      if (!normKey) return;

      const cleanTitle = formatScopeTitleCase(str);

      if (!scopeMap.has(normKey)) {
        scopeMap.set(normKey, { value: cleanTitle, label: cleanTitle });
      } else {
        const existing = scopeMap.get(normKey)!;
        if (existing.value === existing.value.toUpperCase() && cleanTitle !== cleanTitle.toUpperCase()) {
          scopeMap.set(normKey, { value: cleanTitle, label: cleanTitle });
        }
      }
    };

    // 1. Scopes from Admin Console Firestore collection (/scopes & /pricingRules)
    adminConsoleScopes.forEach(addScope);

    // 2. Scopes from passed scopes prop
    if (Array.isArray(scopes) && scopes.length > 0) {
      scopes.forEach(addScope);
    }

    // 3. Always preserve the project's current active scope so it doesn't get unselected
    const currentScope = (formData?.scopeOfWork || project?.scopeOfWork || project?.scope || '').trim();
    if (currentScope) {
      const normKey = normalizeKey(currentScope);
      if (!scopeMap.has(normKey)) {
        const cleanTitle = formatScopeTitleCase(currentScope);
        scopeMap.set(normKey, { value: cleanTitle, label: cleanTitle });
      }
    }

    return Array.from(scopeMap.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [adminConsoleScopes, scopes, project, formData?.scopeOfWork]);

  // Selected Scope with Case/Punctuation Resilient Matching
  const selectedScopeValue = useMemo(() => {
    if (!formData.scopeOfWork) return '';
    const exactMatch = dynamicScopeOptions.find((opt) => opt.value === formData.scopeOfWork);
    if (exactMatch) return exactMatch.value;
    const normKey = normalizeKey(formData.scopeOfWork);
    const normMatch = dynamicScopeOptions.find((opt) => normalizeKey(opt.value) === normKey);
    return normMatch ? normMatch.value : formData.scopeOfWork;
  }, [formData.scopeOfWork, dynamicScopeOptions]);

  // Dynamic Rate & Commissions Recalculation Routine
  const calculateRateAndCommissions = useCallback((
    currentScope: string,
    currentCapacity: number,
    currentClientName: string,
    currentSubService: string = 'Standard'
  ) => {
    if (!currentScope || !currentScope.trim()) return null;

    const matchedClient = (clients || []).find(
      (c) => c.companyName === currentClientName || c.name === currentClientName || c.id === formData.clientId
    );
    const activeTier = String(
      matchedClient?.pricingCategory || matchedClient?.tier || formData.pricingCategory || project?.pricingCategory || 'T1'
    ).trim();

    const targetCat = normalizeKey(activeTier);
    const targetScopeKey = normalizeKey(currentScope);
    const targetSub = (currentSubService || 'standard').toLowerCase().trim();

    // 1. Look up matched pricing rule from Firestore pricingRules using activeTier & normalized scope
    let matchedRule = (rawPricingRules || []).find((r: any) => {
      const rCat = normalizeKey(r.category || r.pricingCategory || r.tier || '');
      const rScope = normalizeKey(r.scope || r.scopeOfWork || r.scopeName || r.name || '');
      const rSub = (r.subService || r.service || 'standard').toLowerCase().trim();
      return rCat === targetCat && rScope === targetScopeKey && (rSub === targetSub || rSub === 'standard');
    });

    if (!matchedRule) {
      matchedRule = (rawPricingRules || []).find((r: any) => {
        const rCat = normalizeKey(r.category || r.pricingCategory || r.tier || '');
        const rScope = normalizeKey(r.scope || r.scopeOfWork || r.scopeName || r.name || '');
        return rCat === targetCat && rScope === targetScopeKey;
      });
    }

    if (!matchedRule) {
      matchedRule = (rawPricingRules || []).find((r: any) => {
        const rScope = normalizeKey(r.scope || r.scopeOfWork || r.scopeName || r.name || '');
        return rScope === targetScopeKey;
      });
    }

    let newCalculatedCost = 0;
    let ruleFound = false;
    let rateSummary = '';

    // 2. Calculate new cost using capacity slab matching or rate-per-kW (rate * capacity)
    if (matchedRule) {
      ruleFound = true;
      const rows = matchedRule.capacityRows || matchedRule.slabs || matchedRule.rows;
      if (Array.isArray(rows) && rows.length > 0) {
        const matchedRow = findMatchingCapacityRow(rows, currentCapacity);
        if (matchedRow) {
          const rowPrice = Number(matchedRow.price ?? matchedRow.rate ?? matchedRow.basePrice ?? 0);
          const priceType = String(matchedRow.priceType || matchedRow.type || matchedRule.priceType || '').toLowerCase();
          const isPerKw = priceType.includes('kw') || priceType === 'per kw';
          newCalculatedCost = isPerKw ? rowPrice * currentCapacity : rowPrice;
          rateSummary = isPerKw ? `@ ₹${rowPrice}/kW` : `@ ₹${rowPrice} fixed`;
        }
      } else {
        const baseRate = Number(
          matchedRule.ratePerKw ?? matchedRule.rate ?? matchedRule.pricePerKw ?? matchedRule.basePrice ?? matchedRule.price ?? 0
        );
        const priceType = String(matchedRule.priceType || '').toLowerCase();
        const isPerKw = priceType.includes('kw') || priceType === 'per kw' || matchedRule.ratePerKw !== undefined || matchedRule.pricePerKw !== undefined;
        newCalculatedCost = isPerKw ? baseRate * currentCapacity : baseRate;
        rateSummary = isPerKw ? `@ ₹${baseRate}/kW` : `@ ₹${baseRate} fixed`;
      }
    }

    // Fallback: evaluate compound package pricing
    if (newCalculatedCost === 0 && currentScope.includes('+')) {
      newCalculatedCost = calculateCompoundPackagePrice(
        currentScope,
        currentCapacity,
        activeTier,
        currentSubService,
        rawPricingRules
      );
      if (newCalculatedCost > 0) {
        ruleFound = true;
        rateSummary = 'Package Rate';
      }
    }

    newCalculatedCost = Math.round(newCalculatedCost * 100) / 100;

    // 3. Commissions calculation
    let newDesComm = 0;
    let newSalesComm = 0;

    if (rawCommissionRules && rawCommissionRules.length > 0) {
      const calcRole = (role: 'designer' | 'sales') => {
        let rule = rawCommissionRules.find((cr: any) => {
          const rRole = String(cr.role || '').toLowerCase().trim();
          const rScope = normalizeKey(cr.scope || cr.scopeOfWork || cr.serviceName || '');
          const rSub = (cr.subService || 'standard').toLowerCase().trim();
          return rRole === role && rScope === targetScopeKey && (rSub === targetSub || rSub === 'standard');
        });
        if (!rule) {
          rule = rawCommissionRules.find((cr: any) => {
            const rRole = String(cr.role || '').toLowerCase().trim();
            const rScope = normalizeKey(cr.scope || cr.scopeOfWork || cr.serviceName || '');
            return rRole === role && rScope === targetScopeKey;
          });
        }
        if (!rule && targetScopeKey.includes('cei')) {
          rule = rawCommissionRules.find((cr: any) => {
            const rRole = String(cr.role || '').toLowerCase().trim();
            const rScope = normalizeKey(cr.scope || cr.scopeOfWork || '');
            return rRole === role && rScope.includes('cei');
          });
        }
        if (rule) {
          const rows = rule.capacityRows || rule.slabs;
          if (Array.isArray(rows) && rows.length > 0) {
            const row = findMatchingCapacityRow(rows, currentCapacity);
            if (row) {
              const maxCap = isZeroOrPositive(rule.maxCommission) ? Number(rule.maxCommission) : 3000;
              const minFloor = isZeroOrPositive(rule.basePrice || rule.minCommission) ? Number(rule.basePrice || rule.minCommission) : 0;
              return calculateSlabCommission(row, currentCapacity, maxCap, minFloor);
            }
          }
          if (isZeroOrPositive(rule.basePrice || rule.price)) {
            const base = Number(rule.basePrice || rule.price || 0);
            const maxCap = isZeroOrPositive(rule.maxCommission) ? Number(rule.maxCommission) : 3000;
            return maxCap > 0 ? Math.min(base, maxCap) : base;
          }
        }
        return 0;
      };

      newDesComm = calcRole('designer');
      newSalesComm = calcRole('sales');
    }

    if (matchedRule) {
      if (newDesComm === 0 && isZeroOrPositive(matchedRule.designerCommission)) {
        newDesComm = Number(matchedRule.designerCommission);
      }
      if (newSalesComm === 0 && isZeroOrPositive(matchedRule.salesCommission)) {
        newSalesComm = Number(matchedRule.salesCommission);
      }
    }

    return {
      cost: newCalculatedCost,
      designerCommission: newDesComm,
      salesCommission: newSalesComm,
      ruleFound,
      tier: activeTier,
      rateSummary
    };
  }, [clients, formData.clientId, formData.pricingCategory, project?.pricingCategory, rawPricingRules, rawCommissionRules]);

  if (!isOpen || !project) return null;

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

  // Scope change handler with auto-recalculation
  const handleScopeChange = (newScope: string) => {
    const result = calculateRateAndCommissions(
      newScope,
      Number(formData.plantCapacity) || 0,
      formData.clientName,
      formData.subService
    );

    setFormData((prev: any) => {
      const next = {
        ...prev,
        scopeOfWork: newScope
      };
      if (result && (result.cost > 0 || result.ruleFound)) {
        next.finalCost = result.cost;
        next.calculatedCost = result.cost;
        next.designerCommission = result.designerCommission;
        next.salesCommission = result.salesCommission;
      }
      return next;
    });

    if (result && (result.cost > 0 || result.ruleFound)) {
      setRecalcFeedback({
        tier: result.tier,
        rateSummary: result.rateSummary,
        cost: result.cost,
        scope: newScope
      });
    } else {
      setRecalcFeedback(null);
    }
  };

  // Capacity change handler with auto-recalculation
  const handleCapacityChange = (rawVal: string) => {
    const parsed = rawVal === '' ? '' : (isNaN(parseFloat(rawVal)) ? '' : parseFloat(rawVal));
    const numCap = typeof parsed === 'number' ? parsed : 0;

    const result = calculateRateAndCommissions(
      formData.scopeOfWork,
      numCap,
      formData.clientName,
      formData.subService
    );

    setFormData((prev: any) => {
      const next = {
        ...prev,
        plantCapacity: parsed
      };
      if (result && (result.cost > 0 || result.ruleFound)) {
        next.finalCost = result.cost;
        next.calculatedCost = result.cost;
        next.designerCommission = result.designerCommission;
        next.salesCommission = result.salesCommission;
      }
      return next;
    });

    if (result && (result.cost > 0 || result.ruleFound)) {
      setRecalcFeedback({
        tier: result.tier,
        rateSummary: result.rateSummary,
        cost: result.cost,
        scope: formData.scopeOfWork
      });
    }
  };

  // Client selection handler with auto-recalculation
  const handleClientChange = (companyName: string) => {
    const foundClient = (clients || []).find((c) => c.companyName === companyName);
    const newClientId = foundClient?.id || formData.clientId;
    const newPricingCategory = foundClient?.pricingCategory || formData.pricingCategory;

    const result = calculateRateAndCommissions(
      formData.scopeOfWork,
      Number(formData.plantCapacity) || 0,
      companyName,
      formData.subService
    );

    setFormData((prev: any) => {
      const next = {
        ...prev,
        clientName: companyName,
        clientId: newClientId,
        pricingCategory: newPricingCategory
      };
      if (result && (result.cost > 0 || result.ruleFound)) {
        next.finalCost = result.cost;
        next.calculatedCost = result.cost;
        next.designerCommission = result.designerCommission;
        next.salesCommission = result.salesCommission;
      }
      return next;
    });

    if (result && (result.cost > 0 || result.ruleFound)) {
      setRecalcFeedback({
        tier: result.tier,
        rateSummary: result.rateSummary,
        cost: result.cost,
        scope: formData.scopeOfWork
      });
    }
  };

  // Manual auto-calculate trigger
  const handleAutoCalculateRate = () => {
    const result = calculateRateAndCommissions(
      formData.scopeOfWork,
      Number(formData.plantCapacity) || 0,
      formData.clientName,
      formData.subService
    );

    if (result) {
      setFormData((prev: any) => ({
        ...prev,
        finalCost: result.cost,
        calculatedCost: result.cost,
        designerCommission: result.designerCommission,
        salesCommission: result.salesCommission
      }));
      setRecalcFeedback({
        tier: result.tier,
        rateSummary: result.rateSummary,
        cost: result.cost,
        scope: formData.scopeOfWork
      });
    }
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
                  onChange={(e) => handleCapacityChange(e.target.value)}
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
                value={selectedScopeValue}
                onChange={(e) => handleScopeChange(e.target.value)}
                className="w-full bg-gray-50 dark:bg-[#121212] border border-gray-300 dark:border-[#333333] focus:border-[#D4AF37] rounded-lg px-3 py-2 text-gray-900 dark:text-white cursor-pointer focus:outline-none"
              >
                {!formData.scopeOfWork && (
                  <option value="" disabled>Select scope of work...</option>
                )}
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
                <div className="flex items-center justify-between mb-1">
                  <label className="block font-semibold uppercase text-gray-600 dark:text-gray-400 text-[10px]">
                    Final Cost (₹) *
                  </label>
                  <button
                    type="button"
                    onClick={handleAutoCalculateRate}
                    className="text-[10px] text-amber-600 dark:text-[#D4AF37] hover:underline flex items-center gap-1 font-bold cursor-pointer transition-colors"
                    title="Auto-calculate cost and commissions based on client tier and scope rate"
                  >
                    ⚡ Auto-Calculate Rate
                  </button>
                </div>
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
                <div className="mt-1 flex items-center justify-between text-[10px]">
                  <span className="text-gray-500">Total client contract value</span>
                  {recalcFeedback ? (
                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/30">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block animate-pulse"></span>
                      Tier {recalcFeedback.tier} {recalcFeedback.rateSummary ? `(${recalcFeedback.rateSummary})` : 'Rate'} Applied
                    </span>
                  ) : (
                    <span className="text-amber-600 dark:text-[#D4AF37]/80 text-[10px] font-medium">
                      Tier {formData.pricingCategory || 'T1'} Rate Engine
                    </span>
                  )}
                </div>
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
