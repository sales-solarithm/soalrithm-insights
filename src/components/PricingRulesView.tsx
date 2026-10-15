'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { 
  collection, 
  doc, 
  updateDoc, 
  addDoc, 
  deleteDoc 
} from 'firebase/firestore';
import { db } from '@/src/lib/firebase';
import { 
  Tags, 
  Plus, 
  Filter, 
  Calculator, 
  Edit3, 
  Trash2, 
  X, 
  FileText, 
  AlertCircle, 
  ChevronRight, 
  Info,
  Database,
  Layers
} from 'lucide-react';
import { COLLECTIONS } from '@/src/config/schema';
import { 
  formatCurrency, 
  safeNumber, 
  findMatchingCapacityRow 
} from '@/src/lib/projectUtils';
import { 
  useDynamicTaxonomy, 
  resolveCompoundScope, 
  getCompoundScopeBreakdown,
  normalizeCategoryKey,
  resolveCanonicalCategory
} from '@/src/lib/taxonomyService';

export interface PricingRulesViewProps {
  pricingRules?: any[];
  commissionRules?: any[];
  clients?: any[];
  projects?: any[];
  onNavigateToProposals?: () => void;
  onNavigateToProjects?: () => void;
}

export default function PricingRulesView({
  pricingRules: propRules,
  commissionRules: propCommissions = [],
  clients = [],
  projects = [],
  onNavigateToProposals,
  onNavigateToProjects
}: PricingRulesViewProps) {
  // =========================================================================
  // DYNAMIC TAXONOMY RESOLUTION (FROM ADMIN CONSOLE FIRESTORE CONTRACTS)
  // Subscribes dynamically to:
  // - /metadata/taxonomies
  // - /config/pricing
  // - /scopes
  // - /pricingCategories
  // - /pricingRules
  // =========================================================================
  const {
    canonicalScopes,
    canonicalCategories,
    rules: activeRulesList,
    scopeCanonicalMap,
    isLoading,
    resolveScope,
    getScopeBreakdown
  } = useDynamicTaxonomy(propRules);

  // 3-Level Cascade Filter State
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedScope, setSelectedScope] = useState<string>('');
  const [selectedSubService, setSelectedSubService] = useState<string>('');

  // Simulator Toggle State (Optional, never default)
  const [showSimulator, setShowSimulator] = useState<boolean>(false);
  const [calcCapacity, setCalcCapacity] = useState<number>(100);
  const [calcUnit, setCalcUnit] = useState<'KW' | 'MW'>('KW');

  // Rule Modal State
  const [isRuleModalOpen, setIsRuleModalOpen] = useState<boolean>(false);
  const [editingRule, setEditingRule] = useState<any | null>(null);
  const [isSavingRule, setIsSavingRule] = useState<boolean>(false);

  // =========================================================================
  // 1. DYNAMIC CATEGORIES / TIERS
  // - Populated dynamically with unique tiers available in Firestore (pricingRules)
  // - Group case-insensitive duplicates (e.g. merging 'T0 BHIMANI' and 'TO Bhimani',
  //   or 'T7K' and 'T7k') under canonical entry defined in Admin Console
  // =========================================================================
  const availableCategories = useMemo(() => {
    const categoryMap = new Map<string, string>(); // normKey -> exact canonical string

    // Map unique tiers present in active pricingRules
    activeRulesList.forEach((r) => {
      const rawCat = r.category || r.pricingCategory || r.tier;
      if (rawCat && typeof rawCat === 'string' && rawCat.trim()) {
        const normKey = normalizeCategoryKey(rawCat);
        if (!categoryMap.has(normKey)) {
          const canonical = resolveCanonicalCategory(rawCat, canonicalCategories);
          categoryMap.set(normKey, canonical);
        }
      }
    });

    // Also include any categories configured in Admin Console taxonomy contracts
    canonicalCategories.forEach((cat) => {
      const normKey = normalizeCategoryKey(cat);
      if (!categoryMap.has(normKey)) {
        categoryMap.set(normKey, cat);
      }
    });

    return Array.from(categoryMap.values()).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
    );
  }, [canonicalCategories, activeRulesList]);

  // =========================================================================
  // 2. DYNAMIC SCOPES OF WORK
  // - Disabled until a Category/Tier is chosen
  // - Populated dynamically with ONLY the scopes configured under selected Category/Tier
  // - Values and labels render using canonical casing stored in Firestore
  // =========================================================================
  const availableScopes = useMemo(() => {
    if (!selectedCategory) return [];

    const scopeMap = new Map<string, string>(); // normalizedKey -> exact canonical string
    const targetCatNorm = normalizeCategoryKey(selectedCategory);

    // Filter only from active Firestore pricing rules matching selected category
    activeRulesList.forEach((r) => {
      const rCat = normalizeCategoryKey(r.category || r.pricingCategory || r.tier || '');
      if (rCat === targetCatNorm) {
        const rawScope = r.scopeOfWork || r.scope || r.scopeName || r.name;
        if (rawScope && typeof rawScope === 'string' && rawScope.trim()) {
          // Resolve compound scopes via '+' and preserve canonical casing from Firestore
          const resolved = resolveScope(rawScope);
          const key = resolved.toLowerCase().trim();
          if (!scopeMap.has(key)) {
            scopeMap.set(key, resolved);
          }
        }
      }
    });

    return Array.from(scopeMap.values()).sort((a, b) => a.localeCompare(b));
  }, [activeRulesList, selectedCategory, resolveScope]);

  // =========================================================================
  // 3. DYNAMIC SUB-SERVICES
  // - Disabled until a Scope of Work is chosen
  // - Populated dynamically with ONLY the sub-services attached to that specific
  //   Category + Scope combination
  // - If no sub-services exist for that scope in Firestore, default automatically
  //   to the standard tier without breaking the component or showing empty states
  // =========================================================================
  const availableSubServices = useMemo(() => {
    if (!selectedCategory || !selectedScope) return [];

    const subServiceMap = new Map<string, string>(); // lowercase key -> exact canonical string
    const targetCatNorm = normalizeCategoryKey(selectedCategory);
    const targetScopeResolved = resolveScope(selectedScope).toLowerCase().trim();

    activeRulesList.forEach((r) => {
      const rCat = normalizeCategoryKey(r.category || r.pricingCategory || r.tier || '');
      const rScopeRaw = String(r.scopeOfWork || r.scope || r.scopeName || r.name || '').trim();
      const rScopeResolved = resolveScope(rScopeRaw).toLowerCase().trim();

      if (rCat === targetCatNorm && (rScopeResolved === targetScopeResolved || rScopeRaw.toLowerCase() === targetScopeResolved)) {
        const rawSub = r.subService || r.service || r.subServiceName;
        if (rawSub && typeof rawSub === 'string' && rawSub.trim()) {
          const canonical = rawSub.trim();
          const key = canonical.toLowerCase();
          if (!subServiceMap.has(key)) {
            subServiceMap.set(key, canonical);
          }
        }
      }
    });

    // If no sub-services exist for that scope in Firestore, default automatically to 'Standard'
    if (subServiceMap.size === 0) {
      subServiceMap.set('standard', 'Standard');
    }

    return Array.from(subServiceMap.values()).sort((a, b) => a.localeCompare(b));
  }, [activeRulesList, selectedCategory, selectedScope, resolveScope]);

  // =========================================================================
  // REACTIVE DRILL-DOWN SYNCHRONIZATION
  // =========================================================================
  // 1. Reset Scope if previously selected scope is not in new availableScopes
  useEffect(() => {
    if (selectedScope && !availableScopes.includes(selectedScope)) {
      setSelectedScope('');
      setSelectedSubService('');
    }
  }, [availableScopes, selectedScope]);

  // 2. Default automatically to the standard tier if no sub-services exist in Firestore,
  // preventing empty dropdown states or broken components
  useEffect(() => {
    if (!selectedCategory || !selectedScope) {
      if (selectedSubService) {
        setSelectedSubService('');
      }
      return;
    }

    if (availableSubServices.length > 0) {
      // If current sub-service is not selected or not in available options
      if (!selectedSubService || !availableSubServices.includes(selectedSubService)) {
        const defaultTier = availableSubServices.includes('Standard')
          ? 'Standard'
          : availableSubServices[0];
        setSelectedSubService(defaultTier);
      }
    }
  }, [selectedCategory, selectedScope, availableSubServices, selectedSubService]);

  // Cascading Selection Handlers
  const handleCategoryChange = (cat: string) => {
    setSelectedCategory(cat);
    setSelectedScope('');
    setSelectedSubService('');
  };

  const handleScopeChange = (scope: string) => {
    setSelectedScope(scope);
    if (!scope) {
      setSelectedSubService('');
    }
  };

  // Check if all 3 cascade levels are selected
  const isCascadeComplete = Boolean(selectedCategory && selectedScope && selectedSubService);

  // Matched rules in Firestore matching all 3 selections exactly
  const matchedRules = useMemo(() => {
    if (!isCascadeComplete) return [];

    const targetCatNorm = normalizeCategoryKey(selectedCategory);
    const targetScopeResolved = resolveScope(selectedScope).toLowerCase().trim();
    const targetSubKey = selectedSubService.trim().toLowerCase();

    return activeRulesList.filter((r) => {
      const rCat = normalizeCategoryKey(r.category || r.pricingCategory || r.tier || '');
      const rScopeRaw = String(r.scopeOfWork || r.scope || r.scopeName || r.name || '').trim();
      const rScopeResolved = resolveScope(rScopeRaw).toLowerCase().trim();
      const rawSub = r.subService || r.service || r.subServiceName;
      const rSub = String(rawSub && typeof rawSub === 'string' && rawSub.trim() ? rawSub : 'Standard').trim().toLowerCase();

      const matchCat = rCat === targetCatNorm;
      const matchScope = rScopeResolved === targetScopeResolved || rScopeRaw.toLowerCase() === targetScopeResolved;
      const matchSub = rSub === targetSubKey;

      return matchCat && matchScope && matchSub;
    });
  }, [activeRulesList, selectedCategory, selectedScope, selectedSubService, isCascadeComplete, resolveScope]);

  // Primary matched rule with robust fallback to any category+scope match
  const primaryMatchedRule = useMemo(() => {
    if (!isCascadeComplete) return null;
    if (matchedRules.length > 0) return matchedRules[0];

    const targetCatNorm = normalizeCategoryKey(selectedCategory);
    const targetScopeResolved = resolveScope(selectedScope).toLowerCase().trim();

    return activeRulesList.find((r) => {
      const rCat = normalizeCategoryKey(r.category || r.pricingCategory || r.tier || '');
      const rScopeRaw = String(r.scopeOfWork || r.scope || r.scopeName || r.name || '').trim();
      const rScopeResolved = resolveScope(rScopeRaw).toLowerCase().trim();
      return rCat === targetCatNorm && (rScopeResolved === targetScopeResolved || rScopeRaw.toLowerCase() === targetScopeResolved);
    }) || null;
  }, [isCascadeComplete, matchedRules, activeRulesList, selectedCategory, selectedScope, resolveScope]);

  // Simulator calculation for matched rule
  const simulatedCost = useMemo(() => {
    if (!primaryMatchedRule) return 0;
    const capacityInKW = calcUnit === 'MW' ? calcCapacity * 1000 : calcCapacity;
    const base = safeNumber(primaryMatchedRule.basePrice || primaryMatchedRule.price);
    const capacityRows = Array.isArray(primaryMatchedRule.capacityRows) ? primaryMatchedRule.capacityRows : [];

    if (capacityRows.length > 0) {
      const matchedRow = findMatchingCapacityRow(capacityRows, capacityInKW);
      if (matchedRow) {
        const rate = safeNumber(matchedRow.price);
        return matchedRow.priceType === 'Fixed' ? rate : rate * capacityInKW;
      }
    }
    return primaryMatchedRule.priceType === 'Fixed' ? base : base * capacityInKW;
  }, [primaryMatchedRule, calcCapacity, calcUnit]);

  // Reset drill-down
  const handleResetFilters = () => {
    setSelectedCategory('');
    setSelectedScope('');
    setSelectedSubService('');
  };

  // Save rule handler: Writes canonical strings directly to Firestore
  const handleSaveRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRule) return;

    setIsSavingRule(true);
    // Respect canonical scope formatting (resolves compound scopes before writing)
    const canonicalScope = resolveScope(editingRule.scopeOfWork || editingRule.scope || '');

    const ruleData = {
      ...editingRule,
      category: String(editingRule.category || '').trim(),
      scopeOfWork: canonicalScope,
      scope: editingRule.scope || canonicalScope,
      subService: String(editingRule.subService || 'Standard').trim(),
      basePrice: safeNumber(editingRule.basePrice),
      priceType: editingRule.priceType || 'Per kW',
      salesCommPercent: safeNumber(editingRule.salesCommPercent),
      designerCommPercent: safeNumber(editingRule.designerCommPercent),
      maxCommission: safeNumber(editingRule.maxCommission),
      updatedAt: new Date().toISOString()
    };

    try {
      if (db) {
        if (editingRule.id && !editingRule.id.startsWith('new-')) {
          await updateDoc(doc(db, COLLECTIONS.PRICING_RULES, editingRule.id), ruleData);
        } else {
          await addDoc(collection(db, COLLECTIONS.PRICING_RULES), {
            ...ruleData,
            createdAt: new Date().toISOString()
          });
        }
      }
      setIsRuleModalOpen(false);
      setEditingRule(null);
    } catch (err: any) {
      console.warn('[PricingRulesView] Failed to save rule to Firestore:', err);
    } finally {
      setIsSavingRule(false);
    }
  };

  // Delete rule handler
  const handleDeleteRule = async (ruleId: string) => {
    if (!confirm('Are you sure you want to remove this pricing rule from Firestore?')) return;
    try {
      if (db) {
        await deleteDoc(doc(db, COLLECTIONS.PRICING_RULES, ruleId));
      }
    } catch (err) {
      console.warn('[PricingRulesView] Failed to delete rule from Firestore:', err);
    }
  };

  return (
    <div className="w-full space-y-6">
      {/* 1. Header: "Pricing Matrix Directory" */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 rounded-xl bg-gray-100 dark:bg-[#1E1E1E] text-[#D4AF37] border border-gray-200 dark:border-[#333333] shadow-xs">
            <Tags className="w-5 h-5 text-[#D4AF37]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold tracking-tight text-gray-900 dark:text-white">
                Pricing Matrix Directory
              </h2>

            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Reference rate models, compound scope packages, and capacity slabs derived dynamically from Firestore contracts.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onNavigateToProposals && (
            <button
              type="button"
              onClick={onNavigateToProposals}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-gray-100 dark:bg-[#1E1E1E] hover:bg-gray-200 dark:hover:bg-[#252525] text-gray-800 dark:text-gray-200 border border-gray-300 dark:border-[#333333] transition-colors cursor-pointer"
            >
              <FileText className="w-4 h-4 text-[#D4AF37]" />
              <span>Proposals Directory</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setEditingRule({
                id: `new-${Date.now()}`,
                category: selectedCategory || '',
                scopeOfWork: selectedScope ? resolveScope(selectedScope) : '',
                subService: selectedSubService || 'Standard',
                basePrice: 50000,
                priceType: 'Per kW',
                salesCommPercent: 5,
                designerCommPercent: 10,
                maxCommission: 25000,
                description: '',
                capacityRows: [
                  { capacityRange: '0-50', price: 800, priceType: 'Per kW' },
                  { capacityRange: '51-200', price: 650, priceType: 'Per kW' },
                  { capacityRange: 'ABOVE 200', price: 500, priceType: 'Per kW' }
                ]
              });
              setIsRuleModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-[#D4AF37] hover:bg-[#c49f2c] text-black shadow-xs transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Pricing Rule</span>
          </button>
        </div>
      </div>

      {/* 2. Filter Selectors: Single top row drill-down card with Upgraded Accessibility & Typography */}
      <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-neutral-700 rounded-2xl p-6 shadow-md transition-colors">
        <div className="flex items-center justify-between pb-4 mb-5 border-b border-gray-200 dark:border-neutral-800">
          <div className="flex items-center space-x-2.5">
            <Filter className="w-4 h-4 text-[#D4AF37]" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-800 dark:text-neutral-200">
              Pricing Matrix Cascade
            </h3>
            <span className="text-xs text-gray-500 dark:text-neutral-400 font-mono">
              ({activeRulesList.length} rules loaded from Firestore)
            </span>
          </div>

          {(selectedCategory || selectedScope || selectedSubService) && (
            <button
              type="button"
              onClick={handleResetFilters}
              className="text-xs font-semibold text-gray-500 dark:text-neutral-400 hover:text-rose-500 dark:hover:text-rose-400 transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              <span>Reset Selection</span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* LEVEL 1: CATEGORY / TIER */}
          <div>
            <label
              htmlFor="pricing-category-select"
              className="text-xs font-semibold tracking-wider text-gray-700 dark:text-neutral-400 uppercase mb-2 block"
            >
              CATEGORY / TIER
            </label>
            <div className="relative">
              <select
                id="pricing-category-select"
                value={selectedCategory}
                onChange={(e) => handleCategoryChange(e.target.value)}
                className="w-full text-base font-medium py-3 px-4 min-h-[48px] bg-gray-50 dark:bg-[#1E1E1E] text-gray-900 dark:text-neutral-100 border border-gray-300 dark:border-neutral-700 rounded-lg focus:border-[#D4AF37] focus:ring-1 focus:ring-[#D4AF37] transition-all cursor-pointer outline-none"
              >
                <option value="" className="text-base py-2.5 bg-white dark:bg-[#1E1E1E] text-gray-500 dark:text-neutral-400">
                  Select Category / Tier ({availableCategories.length})
                </option>
                {availableCategories.map((cat) => (
                  <option key={cat} value={cat} className="text-base py-2.5 bg-white dark:bg-[#1E1E1E] text-gray-900 dark:text-neutral-100">
                    {cat}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-[11px] text-gray-500 dark:text-neutral-400 mt-1.5 font-mono">
              {selectedCategory ? `Active Tier: ${selectedCategory}` : 'Derived dynamically from Firestore pricing rules'}
            </p>
          </div>

          {/* LEVEL 2: SCOPE OF WORK */}
          <div>
            <label
              htmlFor="pricing-scope-select"
              className="text-xs font-semibold tracking-wider text-gray-700 dark:text-neutral-400 uppercase mb-2 block"
            >
              SCOPE OF WORK
            </label>
            <div className="relative">
              <select
                id="pricing-scope-select"
                value={selectedScope}
                onChange={(e) => handleScopeChange(e.target.value)}
                disabled={!selectedCategory}
                className={`w-full text-base font-medium py-3 px-4 min-h-[48px] bg-gray-50 dark:bg-[#1E1E1E] text-gray-900 dark:text-neutral-100 border border-gray-300 dark:border-neutral-700 rounded-lg focus:border-[#D4AF37] focus:ring-1 focus:ring-[#D4AF37] transition-all cursor-pointer outline-none ${
                  !selectedCategory ? 'opacity-50 cursor-not-allowed border-gray-200 dark:border-neutral-800 text-gray-400 dark:text-neutral-500' : ''
                }`}
              >
                <option value="" className="text-base py-2.5 bg-white dark:bg-[#1E1E1E] text-gray-500 dark:text-neutral-400">
                  {selectedCategory
                    ? availableScopes.length > 0
                      ? `Select Scope (${availableScopes.length})`
                      : 'No scopes configured for this tier'
                    : '1. Select Category / Tier first'}
                </option>
                {availableScopes.map((scope) => (
                  <option key={scope} value={scope} className="text-base py-2.5 bg-white dark:bg-[#1E1E1E] text-gray-900 dark:text-neutral-100">
                    {scope}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-[11px] text-gray-500 dark:text-neutral-400 mt-1.5 font-mono">
              {selectedScope
                ? `Resolved Scope: ${selectedScope}`
                : selectedCategory
                ? 'Only scopes configured under this tier'
                : 'Disabled until Category/Tier is chosen'}
            </p>
          </div>

          {/* LEVEL 3: SUB-SERVICE */}
          <div>
            <label
              htmlFor="pricing-subservice-select"
              className="text-xs font-semibold tracking-wider text-gray-700 dark:text-neutral-400 uppercase mb-2 block"
            >
              SUB-SERVICE
            </label>
            <div className="relative">
              <select
                id="pricing-subservice-select"
                value={selectedSubService}
                onChange={(e) => setSelectedSubService(e.target.value)}
                disabled={!selectedScope}
                className={`w-full text-base font-medium py-3 px-4 min-h-[48px] bg-gray-50 dark:bg-[#1E1E1E] text-gray-900 dark:text-neutral-100 border border-gray-300 dark:border-neutral-700 rounded-lg focus:border-[#D4AF37] focus:ring-1 focus:ring-[#D4AF37] transition-all cursor-pointer outline-none ${
                  !selectedScope ? 'opacity-50 cursor-not-allowed border-gray-200 dark:border-neutral-800 text-gray-400 dark:text-neutral-500' : ''
                }`}
              >
                <option value="" className="text-base py-2.5 bg-white dark:bg-[#1E1E1E] text-gray-500 dark:text-neutral-400">
                  {selectedScope
                    ? `Select Sub-Service (${availableSubServices.length})`
                    : '2. Select Scope of Work first'}
                </option>
                {availableSubServices.map((sub) => (
                  <option key={sub} value={sub} className="text-base py-2.5 bg-white dark:bg-[#1E1E1E] text-gray-900 dark:text-neutral-100">
                    {sub}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-[11px] text-gray-500 dark:text-neutral-400 mt-1.5 font-mono">
              {selectedSubService
                ? `Active Sub-Service: ${selectedSubService}`
                : selectedScope
                ? 'Defaults automatically to standard tier if none specified'
                : 'Disabled until Scope of Work is chosen'}
            </p>
          </div>
        </div>
      </div>

      {/* 3. DEFAULT EMPTY STATE vs MATCHED PRICING TIER TABLE */}
      {!isCascadeComplete ? (
        // DEFAULT EMPTY STATE:
        // Centered gold tag icon with:
        // "Drill Down Required"
        // "Please select a Category, Scope, and Sub-Service to view reference pricing."
        <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] rounded-2xl p-12 text-center shadow-sm">
          <div className="max-w-md mx-auto space-y-4">
            {/* Centered gold tag icon */}
            <div className="w-16 h-16 mx-auto rounded-2xl bg-[#D4AF37]/10 border border-[#D4AF37]/30 flex items-center justify-center text-[#D4AF37] shadow-inner">
              <Tags className="w-8 h-8 text-[#D4AF37]" />
            </div>

            <div className="space-y-1.5">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white tracking-tight">
                Drill Down Required
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                Please select a Category, Scope, and Sub-Service to view reference pricing.
              </p>
            </div>

            {/* Step Indicator Badges with exact resolved labels */}
            <div className="pt-2 flex items-center justify-center gap-2 text-[11px]">
              <span
                className={`px-2.5 py-1 rounded-lg border font-mono ${
                  selectedCategory
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 font-semibold'
                    : 'bg-gray-100 dark:bg-[#141414] border-gray-200 dark:border-[#2D2D2D] text-gray-400'
                }`}
              >
                1. Category {selectedCategory ? `(${selectedCategory})` : ''}
              </span>
              <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
              <span
                className={`px-2.5 py-1 rounded-lg border font-mono ${
                  selectedScope
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 font-semibold'
                    : 'bg-gray-100 dark:bg-[#141414] border-gray-200 dark:border-[#2D2D2D] text-gray-400'
                }`}
              >
                2. Scope {selectedScope ? `(${selectedScope})` : ''}
              </span>
              <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
              <span
                className={`px-2.5 py-1 rounded-lg border font-mono ${
                  selectedSubService
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 font-semibold'
                    : 'bg-gray-100 dark:bg-[#141414] border-gray-200 dark:border-[#2D2D2D] text-gray-400'
                }`}
              >
                3. Sub-Service
              </span>
            </div>
          </div>
        </div>
      ) : (
        // 4. MATCHED PRICING TIER TABLE
        <div className="space-y-5">
          {primaryMatchedRule ? (
            <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] rounded-2xl shadow-sm overflow-hidden transition-colors">
              {/* Header Strip with exact matched selection details */}
              <div className="p-5 sm:p-6 border-b border-gray-200 dark:border-[#333333] bg-gray-50/70 dark:bg-[#141414]/70 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded-lg text-xs font-bold font-mono bg-[#D4AF37]/15 text-[#D4AF37] border border-[#D4AF37]/40">
                      Tier: {selectedCategory}
                    </span>
                    <span className="text-gray-400">•</span>
                    <span className="px-2.5 py-0.5 rounded-lg text-xs font-semibold bg-gray-200 dark:bg-[#252525] text-gray-800 dark:text-gray-200">
                      {resolveScope(selectedScope)}
                    </span>
                    <span className="text-gray-400">•</span>
                    <span className="px-2.5 py-0.5 rounded-lg text-xs font-semibold bg-gray-200 dark:bg-[#252525] text-gray-800 dark:text-gray-200">
                      {selectedSubService}
                    </span>
                  </div>

                  <h3 className="text-base font-bold text-gray-900 dark:text-white mt-2">
                    {selectedCategory} — {resolveScope(primaryMatchedRule.scopeOfWork || selectedScope)} ({selectedSubService}) Reference Matrix
                  </h3>

                  {/* Compound Scope Token Breakdown Badge Bar */}
                  {getScopeBreakdown(primaryMatchedRule.scopeOfWork || selectedScope).length > 1 && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-2">
                      <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                        <Layers className="w-3 h-3 text-[#D4AF37]" />
                        Compound Scope Package:
                      </span>
                      {getScopeBreakdown(primaryMatchedRule.scopeOfWork || selectedScope).map((part, pIdx) => (
                        <span
                          key={pIdx}
                          className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/25"
                        >
                          {part}
                        </span>
                      ))}
                    </div>
                  )}

                  {primaryMatchedRule.description && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 max-w-2xl">
                      {primaryMatchedRule.description}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingRule(primaryMatchedRule);
                      setIsRuleModalOpen(true);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-gray-100 dark:bg-[#252525] hover:bg-[#D4AF37]/10 text-gray-800 dark:text-gray-200 hover:text-[#D4AF37] border border-gray-300 dark:border-[#3A3A3A] transition-colors cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5 text-[#D4AF37]" />
                    <span>Edit Tier Rule</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowSimulator(!showSimulator)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-gray-100 dark:bg-[#252525] hover:bg-gray-200 dark:hover:bg-[#2F2F2F] text-gray-800 dark:text-gray-200 border border-gray-300 dark:border-[#3A3A3A] transition-colors cursor-pointer"
                  >
                    <Calculator className="w-3.5 h-3.5 text-[#D4AF37]" />
                    <span>{showSimulator ? 'Hide Simulator' : 'Cost Calculator'}</span>
                  </button>
                </div>
              </div>

              {/* Optional Simulator Toggle Area */}
              {showSimulator && (
                <div className="p-5 border-b border-gray-100 dark:border-[#2A2A2A] bg-amber-50/20 dark:bg-[#161616]/70">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                        Test Capacity:
                      </span>
                      <div className="flex items-center max-w-[200px]">
                        <input
                          type="number"
                          min="1"
                          value={calcCapacity}
                          onChange={(e) => setCalcCapacity(Math.max(1, parseFloat(e.target.value) || 0))}
                          className="w-full bg-white dark:bg-[#121212] border border-r-0 border-gray-300 dark:border-[#333333] rounded-l-lg px-3 py-1.5 text-xs font-mono font-bold text-gray-900 dark:text-white focus:outline-none focus:border-[#D4AF37]"
                        />
                        <select
                          value={calcUnit}
                          onChange={(e) => setCalcUnit(e.target.value as 'KW' | 'MW')}
                          className="bg-gray-100 dark:bg-[#252525] border border-gray-300 dark:border-[#333333] rounded-r-lg px-2.5 py-1.5 text-xs font-bold text-gray-700 dark:text-gray-300 focus:outline-none"
                        >
                          <option value="KW">kW</option>
                          <option value="MW">MW</option>
                        </select>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 text-xs font-mono">
                      <div>
                        <span className="text-gray-500 text-[10px] block">Simulated Final Cost:</span>
                        <span className="font-bold text-base text-gray-900 dark:text-white">
                          {formatCurrency(simulatedCost)}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500 text-[10px] block">Designer Fee:</span>
                        <span className="font-bold text-base text-[#D4AF37]">
                          {formatCurrency((simulatedCost * safeNumber(primaryMatchedRule.designerCommPercent)) / 100)}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500 text-[10px] block">Sales Comm:</span>
                        <span className="font-bold text-base text-emerald-600 dark:text-emerald-400">
                          {formatCurrency(
                            Math.min(
                              safeNumber(primaryMatchedRule.maxCommission) || Infinity,
                              (simulatedCost * safeNumber(primaryMatchedRule.salesCommPercent)) / 100
                            )
                          )}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Matched Capacity Tier Slabs Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs whitespace-nowrap">
                  <thead>
                    <tr className="text-gray-500 dark:text-gray-400 text-[11px] uppercase tracking-wider border-b border-gray-200 dark:border-[#333333] bg-gray-50/70 dark:bg-[#141414]/70">
                      <th scope="col" className="py-3 px-6 font-semibold">
                        SLAB / CAPACITY RANGE (kWp)
                      </th>
                      <th scope="col" className="py-3 px-6 font-semibold">
                        RATE MODEL
                      </th>
                      <th scope="col" className="py-3 px-6 font-semibold text-right">
                        UNIT RATE (₹)
                      </th>
                      <th scope="col" className="py-3 px-6 font-semibold text-right">
                        SAMPLE 50 kWp
                      </th>
                      <th scope="col" className="py-3 px-6 font-semibold text-right">
                        SAMPLE 100 kWp
                      </th>
                      <th scope="col" className="py-3 px-6 font-semibold text-right">
                        SAMPLE 500 kWp
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-[#282828]">
                    {Array.isArray(primaryMatchedRule.capacityRows) && primaryMatchedRule.capacityRows.length > 0 ? (
                      primaryMatchedRule.capacityRows.map((row: any, idx: number) => {
                        const price = safeNumber(row.price);
                        const isFixed = row.priceType === 'Fixed' || primaryMatchedRule.priceType === 'Fixed';

                        return (
                          <tr key={idx} className="hover:bg-gray-50/80 dark:hover:bg-[#222222]/80 transition-colors">
                            <td className="py-4 px-6 font-mono font-bold text-gray-900 dark:text-white">
                              <span className="px-2.5 py-1 rounded-lg bg-gray-100 dark:bg-[#252525] border border-gray-200 dark:border-[#333333]">
                                {row.capacityRange} kWp
                              </span>
                            </td>

                            <td className="py-4 px-6 text-gray-600 dark:text-gray-400">
                              <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-gray-100 dark:bg-[#161616] border border-gray-200 dark:border-[#333333]">
                                {row.priceType || primaryMatchedRule.priceType || 'Per kW'}
                              </span>
                            </td>

                            <td className="py-4 px-6 text-right font-mono font-bold text-base text-[#D4AF37]">
                              {isFixed ? formatCurrency(price) : `₹${price} / kW`}
                            </td>

                            <td className="py-4 px-6 text-right font-mono text-gray-700 dark:text-gray-300">
                              {formatCurrency(isFixed ? price : price * 50)}
                            </td>

                            <td className="py-4 px-6 text-right font-mono text-gray-700 dark:text-gray-300">
                              {formatCurrency(isFixed ? price : price * 100)}
                            </td>

                            <td className="py-4 px-6 text-right font-mono text-gray-700 dark:text-gray-300">
                              {formatCurrency(isFixed ? price : price * 500)}
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-gray-500">
                          <p className="text-xs">
                            No explicit slab breakdowns in this document. Flat rate of{' '}
                            {formatCurrency(safeNumber(primaryMatchedRule.basePrice || primaryMatchedRule.price))} applies.
                          </p>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Footer Information */}
              <div className="p-4 bg-gray-50/50 dark:bg-[#141414]/50 border-t border-gray-100 dark:border-[#2A2A2A] flex flex-col sm:flex-row sm:items-center justify-between text-[11px] text-gray-500 gap-2">
                <div className="flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5 text-[#D4AF37]" />
                  <span>
                    Canonical record synchronized with Nexus Admin Console pricing rules.
                  </span>
                </div>
                <div>
                  Document ID: <span className="font-mono text-gray-700 dark:text-gray-300">{primaryMatchedRule.id}</span>
                </div>
              </div>
            </div>
          ) : (
            // No rule found for this exact combination
            <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] rounded-2xl p-8 text-center shadow-sm">
              <AlertCircle className="w-8 h-8 mx-auto text-[#D4AF37] mb-2" />
              <h4 className="text-sm font-bold text-gray-900 dark:text-white">
                No Rule Configured for this Selection
              </h4>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 max-w-md mx-auto">
                No reference pricing rule is currently persisted for <span className="font-semibold text-gray-700 dark:text-gray-200">{selectedCategory}</span> &gt; <span className="font-semibold text-gray-700 dark:text-gray-200">{resolveScope(selectedScope)}</span> &gt; <span className="font-semibold text-gray-700 dark:text-gray-200">{selectedSubService}</span>.
              </p>
              <button
                type="button"
                onClick={() => {
                  setEditingRule({
                    id: `new-${Date.now()}`,
                    category: selectedCategory,
                    scopeOfWork: resolveScope(selectedScope),
                    subService: selectedSubService,
                    basePrice: 50000,
                    priceType: 'Per kW',
                    salesCommPercent: 5,
                    designerCommPercent: 10,
                    maxCommission: 25000,
                    description: `${selectedCategory} ${resolveScope(selectedScope)} (${selectedSubService})`,
                    capacityRows: [
                      { capacityRange: '0-50', price: 800, priceType: 'Per kW' },
                      { capacityRange: '51-200', price: 650, priceType: 'Per kW' },
                      { capacityRange: 'ABOVE 200', price: 500, priceType: 'Per kW' }
                    ]
                  });
                  setIsRuleModalOpen(true);
                }}
                className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-[#D4AF37] hover:bg-[#c49f2c] text-black transition-all cursor-pointer shadow-xs"
              >
                <Plus className="w-4 h-4" />
                <span>Create Pricing Rule for this Selection</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Add / Edit Pricing Rule Modal */}
      {isRuleModalOpen && editingRule && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-[#333333] flex justify-between items-center bg-gray-50/70 dark:bg-[#141414]/70">
              <h3 className="text-sm font-bold text-gray-900 dark:text-white">
                {editingRule.id && !editingRule.id.startsWith('new-') ? 'Edit Pricing Rule' : 'New Pricing Rule'}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setIsRuleModalOpen(false);
                  setEditingRule(null);
                }}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveRule} className="p-6 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-gray-600 dark:text-gray-400 font-semibold mb-1 uppercase text-[10px]">
                    Category / Tier
                  </label>
                  <input
                    type="text"
                    value={editingRule.category || ''}
                    onChange={(e) => setEditingRule({ ...editingRule, category: e.target.value })}
                    placeholder="e.g. T1, T2, T0 Bhimani, T7k"
                    className="w-full bg-white dark:bg-[#121212] border border-gray-300 dark:border-[#333333] rounded-lg p-2 text-gray-900 dark:text-white focus:outline-none focus:border-[#D4AF37]"
                    required
                  />
                </div>

                <div>
                  <label className="block text-gray-600 dark:text-gray-400 font-semibold mb-1 uppercase text-[10px]">
                    Scope of Work (Single or Compound with "+")
                  </label>
                  <input
                    type="text"
                    value={editingRule.scopeOfWork || ''}
                    onChange={(e) => setEditingRule({ ...editingRule, scopeOfWork: e.target.value })}
                    placeholder="e.g. Pre-Design + PVsyst + CEIG + IFP"
                    className="w-full bg-white dark:bg-[#121212] border border-gray-300 dark:border-[#333333] rounded-lg p-2 text-gray-900 dark:text-white focus:outline-none focus:border-[#D4AF37]"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-gray-600 dark:text-gray-400 font-semibold mb-1 uppercase text-[10px]">
                    Sub-Service
                  </label>
                  <input
                    type="text"
                    value={editingRule.subService || 'Standard'}
                    onChange={(e) => setEditingRule({ ...editingRule, subService: e.target.value })}
                    placeholder="e.g. Standard, Complete Engineering"
                    className="w-full bg-white dark:bg-[#121212] border border-gray-300 dark:border-[#333333] rounded-lg p-2 text-gray-900 dark:text-white focus:outline-none focus:border-[#D4AF37]"
                  />
                </div>

                <div>
                  <label className="block text-gray-600 dark:text-gray-400 font-semibold mb-1 uppercase text-[10px]">
                    Rate Model
                  </label>
                  <select
                    value={editingRule.priceType || 'Per kW'}
                    onChange={(e) => setEditingRule({ ...editingRule, priceType: e.target.value })}
                    className="w-full bg-white dark:bg-[#121212] border border-gray-300 dark:border-[#333333] rounded-lg p-2 text-gray-900 dark:text-white focus:outline-none focus:border-[#D4AF37]"
                  >
                    <option value="Per kW">Per kW</option>
                    <option value="Fixed">Fixed Fee</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-gray-600 dark:text-gray-400 font-semibold mb-1 uppercase text-[10px]">
                    Base Price (₹)
                  </label>
                  <input
                    type="number"
                    value={editingRule.basePrice || 0}
                    onChange={(e) => setEditingRule({ ...editingRule, basePrice: parseFloat(e.target.value) || 0 })}
                    className="w-full bg-white dark:bg-[#121212] border border-gray-300 dark:border-[#333333] rounded-lg p-2 text-gray-900 dark:text-white font-mono focus:outline-none focus:border-[#D4AF37]"
                  />
                </div>

                <div>
                  <label className="block text-gray-600 dark:text-gray-400 font-semibold mb-1 uppercase text-[10px]">
                    Designer Comm (%)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={editingRule.designerCommPercent || 0}
                    onChange={(e) => setEditingRule({ ...editingRule, designerCommPercent: parseFloat(e.target.value) || 0 })}
                    className="w-full bg-white dark:bg-[#121212] border border-gray-300 dark:border-[#333333] rounded-lg p-2 text-gray-900 dark:text-white font-mono focus:outline-none focus:border-[#D4AF37]"
                  />
                </div>

                <div>
                  <label className="block text-gray-600 dark:text-gray-400 font-semibold mb-1 uppercase text-[10px]">
                    Sales Comm (%)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={editingRule.salesCommPercent || 0}
                    onChange={(e) => setEditingRule({ ...editingRule, salesCommPercent: parseFloat(e.target.value) || 0 })}
                    className="w-full bg-white dark:bg-[#121212] border border-gray-300 dark:border-[#333333] rounded-lg p-2 text-gray-900 dark:text-white font-mono focus:outline-none focus:border-[#D4AF37]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-gray-600 dark:text-gray-400 font-semibold mb-1 uppercase text-[10px]">
                  Description / Specification
                </label>
                <textarea
                  rows={2}
                  value={editingRule.description || ''}
                  onChange={(e) => setEditingRule({ ...editingRule, description: e.target.value })}
                  placeholder="Canonical description and package specification notes..."
                  className="w-full bg-white dark:bg-[#121212] border border-gray-300 dark:border-[#333333] rounded-lg p-2 text-gray-900 dark:text-white focus:outline-none focus:border-[#D4AF37]"
                />
              </div>

              <div className="flex justify-between items-center pt-3 border-t border-gray-200 dark:border-[#333333]">
                {editingRule.id && !editingRule.id.startsWith('new-') ? (
                  <button
                    type="button"
                    onClick={() => {
                      handleDeleteRule(editingRule.id);
                      setIsRuleModalOpen(false);
                    }}
                    className="text-rose-500 hover:text-rose-600 text-xs font-semibold cursor-pointer"
                  >
                    Delete Rule
                  </button>
                ) : <div />}

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsRuleModalOpen(false);
                      setEditingRule(null);
                    }}
                    className="px-3.5 py-1.5 rounded-lg border border-gray-300 dark:border-[#444] text-gray-600 dark:text-gray-300 font-semibold hover:bg-gray-100 dark:hover:bg-[#252525] cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingRule}
                    className="px-4 py-1.5 rounded-lg bg-[#D4AF37] hover:bg-[#c49f2c] text-black font-semibold shadow-xs cursor-pointer disabled:opacity-50"
                  >
                    {isSavingRule ? 'Saving...' : 'Save Rule'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
