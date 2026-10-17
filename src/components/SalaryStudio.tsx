'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Image from 'next/image';
import {
  LayoutGrid,
  FileText,
  Clock,
  Users,
  Trophy,
  Settings as SettingsIcon,
  Plus,
  Printer,
  CheckCircle2,
  Search,
  X,
  Calendar,
  Banknote,
  Receipt,
  AlertCircle,
  FileDown,
  Filter
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { useCompanySettings } from '@/src/lib/useCompanySettings';
import { useDynamicTaxonomy } from '@/src/lib/taxonomyService';
import { doc, getDoc, updateDoc, setDoc, collection, getDocs, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '@/src/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { COLLECTIONS } from '@/src/config/schema';
import { 
  parseSafeDate, 
  resolveProjectDate, 
  formatSafeDate, 
  getFirstName, 
  formatIndianName, 
  isZeroOrPositive, 
  safeNumber, 
  formatCurrency,
  toCanonicalScopeKey,
  normalizeSubService,
  SCOPE_LABELS,
  areIndianNamesMatching,
  findMatchingCapacityRow,
  calculateSlabCommission
} from '@/src/lib/projectUtils';

// ============================================================================
// CONSTANTS & TAXONOMY (Mandate 4: Scope Taxonomy Decoupling)
// ============================================================================

export const SALARY_STORAGE_KEYS = {
  employees: 'users',
  incentives: 'incentives',
  history: 'salaryHistory',
  draft: 'solarithm_salary_generator_draft_v1',
  settings: 'solarithm_salary_rules_v1',
  counter: 'solarithm_salary_slip_counter_v1'
} as const;

export const ENGINEERING_SCOPES = [
  'All Scopes',
  'Pre-Design',
  'Post-Design',
  'Detailed Engineering',
  'Permit Package',
  'CEIG',
  'PVsyst',
  'Standard Design',
  'Single Line Diagram',
  'Bill of Materials',
  'PE Stamping'
] as const;

export const INSTALLATION_SECTORS = [
  'All Sectors',
  'Domestic',
  'Commercial',
  'Industrial',
  'Ground Mount',
  'Agricultural'
] as const;

export const SALARY_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
] as const;

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface EmployeeRecord {
  id: string;
  empId: string;
  name: string;
  designation: string;
  department: string;
  doj: string;
  dob?: string;
  pan: string;
  uan: string;
  pfNo: string;
  esicNo?: string;
  bank: string;
  bankName?: string;
  accNo: string;
  accountNumber?: string;
  ifsc: string;
  ifscCode?: string;
  email: string;
  mobile: string;
  basic: number;
  othAllow: number;
  active: boolean;
}

export interface IncentiveRecord {
  id: string;
  date: string;
  empId: string;
  empName: string;
  project: string;
  client: string;
  kw: number;
  amount: number;
  role?: string;
  projectId?: string;
  status?: string;
  scopeOfWork?: string;
  sector?: string;
  scopeKeys?: string[];
  comboFullAmount?: number;
  designerEmail?: string;
}

export interface AttendanceData {
  totalDays: number;
  presentDays: number;
  leaveDays: number;
  paidLeave: number;
  otHours: number;
  lopDays: number;
}

export interface AdditionalEarningsData {
  bonus: number;
  reimbursement: number;
  otherAllowance: number;
}

export interface DeductionsData {
  pf: number;
  esic: number;
  pt: number;
  tds: number;
  advance: number;
  other: number;
}

export interface SalarySlipRecord {
  slipNo: string;
  empId: string;
  empEmpId: string;
  empName: string;
  month: string;
  fy: string;
  payDate: string;
  gross: number;
  totalDed: number;
  net: number;
  generated: string;
  paymentMode: string;
  transactionId: string;
  paymentDate: string;
  employeeBankSnapshot: {
    bankName: string;
    maskedAccountNumber: string;
  };
  attendance: AttendanceData;
  earnings: {
    basic: number;
    othAllow: number;
    incentive: number;
    ot: number;
    bonus: number;
    reimbursement: number;
    otherAllowance: number;
  };
  deductions: DeductionsData;
  incentivesList: IncentiveRecord[];
  incentiveSummary: {
    cycleMonth: string;
    cycleFY: string;
    totalProjects: number;
    totalKwp: number;
    totalIncentive: number;
  };
  companySnapshot: {
    name: string;
    address: string;
    gstin: string;
    phone: string;
    email: string;
    web: string;
    signName: string;
    logo: string | null;
    sig: string | null;
    stamp: string | null;
  };
  employeeSnapshot: EmployeeRecord;
}

export type SalaryStudioTab =
  | 'dashboard'
  | 'salary-generator'
  | 'history'
  | 'settings';

interface SalaryStudioProps {
  users?: any[];
  projects?: any[];
  commissionRules?: any[];
  invoices?: any[];
  clients?: any[];
  onNavigateToGlobalSettings?: () => void;
}

// ============================================================================
// HELPER FUNCTIONS (Mandates 2, 3, 4)
// ============================================================================

export function maskAccountNumber(accountNumber: string | undefined | null): string {
  const clean = String(accountNumber || '').trim();
  if (!clean) return 'N/A';
  if (clean.length <= 4) return clean;
  return '•'.repeat(clean.length - 4) + clean.slice(-4);
}

export function numberToWordsINR(num: number): string {
  num = Math.round(num);
  if (num === 0) return 'Zero Rupees';
  const ones = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
    'Seventeen', 'Eighteen', 'Nineteen'
  ];
  const tens = [
    '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'
  ];

  function formatHundred(n: number): string {
    if (n === 0) return '';
    if (n < 20) return ones[n] + ' ';
    if (n < 100) return tens[Math.floor(n / 10)] + ' ' + (n % 10 ? ones[n % 10] + ' ' : '');
    return ones[Math.floor(n / 100)] + ' Hundred ' + (n % 100 ? formatHundred(n % 100) : '');
  }

  let result = '';
  if (num >= 10000000) {
    result += formatHundred(Math.floor(num / 10000000)) + 'Crore ';
    num %= 10000000;
  }
  if (num >= 100000) {
    result += formatHundred(Math.floor(num / 100000)) + 'Lakh ';
    num %= 100000;
  }
  if (num >= 1000) {
    result += formatHundred(Math.floor(num / 1000)) + 'Thousand ';
    num %= 1000;
  }
  if (num > 0) {
    result += formatHundred(num);
  }
  return result.trim() + ' Rupees Only';
}

const getPreviousFYString = (fyString: string): string => {
  if (fyString.includes("-")) {
    const parts = fyString.split("-");
    const startYear = parseInt(parts[0], 10);
    if (isNaN(startYear)) return fyString;
    const prevStart = startYear - 1;
    const prevEndFull = prevStart + 1;
    const prevEndSuffix = parts[1].length === 2 ? String(prevEndFull).slice(-2) : String(prevEndFull);
    return `${prevStart}-${prevEndSuffix}`;
  }
  const singleYear = parseInt(fyString, 10);
  if (!isNaN(singleYear)) {
    return String(singleYear - 1);
  }
  return fyString;
};

/**
 * 1-Month Incentive Delay & Cycle Offset Engine:
 * Returns primary evaluation period (N-1 month) and lookback window.
 * For pay period September 2026-27, primary evaluation month is August.
 * In addition, July/August deliverables and previous unbilled deliverables feed into this payroll run.
 */
export const getIncentiveCyclePeriod = (
  payPeriodMonth: string,
  payPeriodFY: string
): { month: string; fy: string; lookbackMonths: string[] } => {
  const monthIdx = SALARY_MONTHS.findIndex((m) => m.toLowerCase() === payPeriodMonth.toLowerCase());
  if (monthIdx === -1) {
    return { month: payPeriodMonth, fy: payPeriodFY, lookbackMonths: [payPeriodMonth] };
  }

  // Standard N-1 month (e.g., September payroll -> August incentive month)
  const prevMonthIdx = (monthIdx - 1 + 12) % 12;
  const incentiveMonth = SALARY_MONTHS[prevMonthIdx];
  const incentiveFY = monthIdx === 3 ? getPreviousFYString(payPeriodFY) : payPeriodFY;

  // Bi-month & lookback window (e.g. for September, look back at August and July)
  const biMonthIdx = (monthIdx - 2 + 12) % 12;
  const biMonth = SALARY_MONTHS[biMonthIdx];

  return {
    month: incentiveMonth,
    fy: incentiveFY,
    lookbackMonths: [incentiveMonth, biMonth]
  };
};

/**
 * Robust date matching for Indian Financial Year (April 1 - March 31)
 * Supports standard month matching or flexible lookback window for unbilled/prior cycle deliverables.
 */
export const isProjectInMonthAndFY = (
  projectDate: Date | null,
  monthName: string,
  fyString: string,
  allowedMonths?: string[]
): boolean => {
  if (!projectDate) return false;

  const projMonthIdx = projectDate.getMonth();
  const projYear = projectDate.getFullYear();

  // If specific allowedMonths provided (e.g., [August, July]), check membership
  if (Array.isArray(allowedMonths) && allowedMonths.length > 0) {
    const isAllowed = allowedMonths.some((m) => {
      const idx = SALARY_MONTHS.findIndex((sm) => sm.toLowerCase() === m.toLowerCase());
      return idx === projMonthIdx;
    });
    if (!isAllowed) return false;
  } else {
    const targetMonthIdx = SALARY_MONTHS.findIndex((m) => m.toLowerCase() === monthName.toLowerCase());
    if (targetMonthIdx === -1 || projMonthIdx !== targetMonthIdx) {
      return false;
    }
  }

  // Validate Indian Financial Year alignment (e.g., 2026-27: April 2026 to March 2027)
  if (fyString.includes("-")) {
    const parts = fyString.split("-");
    const startYear = parseInt(parts[0], 10);
    const endYear = parts[1].length === 2 ? parseInt(parts[0].slice(0, 2) + parts[1], 10) : parseInt(parts[1], 10);
    const expectedYear = projMonthIdx >= 3 ? startYear : endYear;
    return projYear === expectedYear;
  } else {
    const singleYear = parseInt(fyString, 10);
    if (!isNaN(singleYear)) {
      return projYear === singleYear;
    }
  }

  return true;
};

/**
 * Universal name token normalizer and matcher for Indian name variations
 * Matches "Sheladiya Om Mukeshbhai" <-> "Om Sheladiya" <-> "Sheladiya Om"
 */
export const matchEmployeeNames = (nameA: string, nameB: string): boolean => {
  if (!nameA || !nameB) return false;
  const rawA = String(nameA).toLowerCase().trim();
  const rawB = String(nameB).toLowerCase().trim();
  if (rawA === rawB) return true;

  const cleanA = rawA.replace(/[^a-z0-9\s]/g, "");
  const cleanB = rawB.replace(/[^a-z0-9\s]/g, "");
  if (cleanA === cleanB) return true;

  const tokensA = cleanA.split(/\s+/).filter(Boolean);
  const tokensB = cleanB.split(/\s+/).filter(Boolean);
  if (tokensA.length === 0 || tokensB.length === 0) return false;

  // Exact token match joined
  if (tokensA.join(" ") === tokensB.join(" ")) return true;

  // Common tokens check (e.g. "om" and "sheladiya" in both)
  const common = tokensA.filter((t) => tokensB.includes(t));
  if (common.length >= 2) return true;
  if ((tokensA.length === 1 || tokensB.length === 1) && common.length >= 1) return true;

  // First name or surname match
  if (
    tokensA[0] === tokensB[0] ||
    tokensA[0] === tokensB[tokensB.length - 1] ||
    tokensA[tokensA.length - 1] === tokensB[0]
  ) {
    if (common.length >= 1) return true;
  }

  return false;
};

const normalizeComboKey = (raw: string): string =>
  String(raw || "")
    .split(/[+,&/]/)
    .map((s) => toCanonicalScopeKey(s.trim()))
    .filter(Boolean)
    .sort()
    .join("+");

const getComboScopeCommission = (
  project: any,
  designerEmail: string,
  commissionRules: any[]
): { amount: number; scopeKeys: string[]; matched: boolean; comboFullAmount?: number } => {
  const assignedScopes = project?.assignedScopes;
  if (!assignedScopes || typeof assignedScopes !== "object") {
    return { amount: 0, scopeKeys: [], matched: false };
  }

  const scopeKeys = Object.entries(assignedScopes)
    .filter(([, email]) => String(email || "").toLowerCase().trim() === designerEmail)
    .map(([scopeKey]) => toCanonicalScopeKey(scopeKey));

  if (scopeKeys.length === 0) {
    return { amount: 0, scopeKeys: [], matched: false };
  }

  const comboKey = normalizeComboKey(scopeKeys.join("+"));

  const matchedRule = (commissionRules || []).find((rule) => {
    const ruleRole = String(rule.role || "").toLowerCase().trim();
    if (ruleRole !== "designer") return false;
    const ruleCombo = normalizeComboKey(rule.scopeCombination || rule.scope || rule.scopeOfWork || "");
    return ruleCombo === comboKey;
  });

  if (!matchedRule) {
    return { amount: 0, scopeKeys, matched: false };
  }

  const rawCap = project.plantCapacity ?? project.systemCapacity ?? project.capacity;
  const capacity = isZeroOrPositive(rawCap)
    ? Number(rawCap)
    : parseFloat(String(rawCap || "0").replace(/[^\d.]/g, "")) || 0;

  let comboFullAmount = 0;

  if (!Array.isArray(matchedRule.capacityRows) || matchedRule.capacityRows.length === 0) {
    const ruleBase = matchedRule.price ?? matchedRule.basePrice ?? matchedRule.amount;
    comboFullAmount = isZeroOrPositive(ruleBase) ? Number(ruleBase) : 0;
  } else {
    for (const row of matchedRule.capacityRows) {
      const range = String(row.capacityRange || "").toUpperCase().trim();
      let isMatch = false;

      if (range.includes("-")) {
        const [minStr, maxStr] = range.split("-");
        if (capacity >= Number(minStr) && capacity <= Number(maxStr)) isMatch = true;
      } else if (range.includes("ABOVE") || range.includes(">")) {
        if (capacity > Number(range.replace("ABOVE", "").replace(">", "").trim())) isMatch = true;
      } else if (range.includes("UP TO") || range.includes("<=")) {
        if (capacity <= Number(range.replace("UP TO", "").replace("<=", "").trim())) isMatch = true;
      } else if (range.includes("<")) {
        if (capacity < Number(range.replace("<", "").trim())) isMatch = true;
      }

      if (isMatch) {
        const price = isZeroOrPositive(row.price ?? row.basePrice) ? Number(row.price ?? row.basePrice) : 0;
        const type = String(row.priceType || "").toLowerCase();
        const rawCommission = type.includes("kw") ? price * capacity : price;
        const maxCapVal = matchedRule.maxCommission;
        const maxCap = isZeroOrPositive(maxCapVal) ? Number(maxCapVal) : 0;
        comboFullAmount = maxCap > 0 ? Math.min(rawCommission, maxCap) : rawCommission;
        break;
      }
    }
  }

  const payoutHistory = project?.payoutHistory || {};
  const paidEntries = scopeKeys.map((k) => payoutHistory[k]).filter(Boolean);

  if (paidEntries.length === 0) {
    return { amount: comboFullAmount, scopeKeys, matched: true, comboFullAmount };
  }

  const alreadyPaidAmount = Math.max(...paidEntries.map((e: any) => Number(e?.amount) || 0));
  const delta = comboFullAmount - alreadyPaidAmount;
  return { amount: Math.max(0, delta), scopeKeys, matched: true, comboFullAmount };
};

/**
 * Calculates project incentives for a given employee with universal name and email resolution,
 * supporting 1-month delay, bi-month cycle lookbacks, and robust scope taxonomy mapping.
 */
export const getProjectIncentiveForEmployee = (
  project: any,
  employee: EmployeeRecord,
  monthName: string,
  fyString: string,
  commissionRules: any[] = [],
  allowedMonths?: string[]
): IncentiveRecord | null => {
  if (!project || !employee) return null;

  // Canonical Date Precedence (Audit PRJ-02) with DD/MM/YYYY support
  const pDate = resolveProjectDate(project);
  if (!isProjectInMonthAndFY(pDate, monthName, fyString, allowedMonths)) {
    return null;
  }

  const empEmail = (employee.email || "").toLowerCase().trim();
  const empName = (employee.name || "").toLowerCase().trim();
  const empId = (employee.empId || "").toLowerCase().trim();
  const empMasterId = (employee.id || "").toLowerCase().trim();
  const empDept = (employee.department || "").toLowerCase().trim();
  const empDesig = (employee.designation || "").toLowerCase().trim();

  // Resilient Staff Attribution (Universal Key Aliasing)
  const pDesEmail = String(project.designerEmail || project.designer_email || project.designer || project.assignedDesigner || "").toLowerCase().trim();
  const pDesName = String(project.designer || project.designerName || project.assignedDesigner || "").toLowerCase().trim();
  const pDesId = String(project.designerId || "").toLowerCase().trim();

  const pSalesEmail = String(
    project.salesPersonEmail ||
    project.sales_email ||
    project.salesEmail ||
    project.salesPerson ||
    project.assignedSales ||
    project.matchedClient?.salesPersonEmail ||
    ""
  ).toLowerCase().trim();
  const pSalesName = String(project.salesPerson || project.salesPersonName || project.salesName || project.assignedSales || "").toLowerCase().trim();
  const pSalesId = String(project.salesId || "").toLowerCase().trim();

  const pAssignedEmail = String(project.assignedTo || project.staffEmail || project.employeeEmail || "").toLowerCase().trim();
  const pAssignedName = String(project.assignedToName || project.staffName || project.employeeName || "").toLowerCase().trim();

  // Universal Equality & Token Matching (Omni-casing and Indian 3-part naming)
  const isDesigner = Boolean(
    (empEmail && pDesEmail && (empEmail === pDesEmail || pDesEmail.includes(empEmail))) ||
    (empId && pDesId && empId === pDesId) ||
    (empName && pDesName && (empName === pDesName || matchEmployeeNames(empName, pDesName)))
  );

  const isSales = Boolean(
    (empEmail && pSalesEmail && (empEmail === pSalesEmail || pSalesEmail.includes(empEmail))) ||
    (empId && pSalesId && empId === pSalesId) ||
    (empName && pSalesName && (empName === pSalesName || matchEmployeeNames(empName, pSalesName)))
  );

  const isAssigned = Boolean(
    (empEmail && pAssignedEmail && (empEmail === pAssignedEmail || pAssignedEmail.includes(empEmail))) ||
    (empName && pAssignedName && (empName === pAssignedName || matchEmployeeNames(empName, pAssignedName)))
  );

  // Split-scope check (if project has assignedScopes mapping)
  let comboResult: { amount: number; scopeKeys: string[]; matched: boolean; comboFullAmount?: number } | null = null;
  if (project?.assignedScopes && typeof project.assignedScopes === "object") {
    comboResult = getComboScopeCommission(project, empEmail, commissionRules);
  }
  const isSplitScopeDesigner = Boolean(comboResult && comboResult.scopeKeys.length > 0);
  // If employee has no role on this project, early return
  if (!isDesigner && !isSales && !isAssigned && !isSplitScopeDesigner) {
    return null;
  }

  // Precedence 1: Explicit Manual Admin Overrides
  const explicitDesComm =
    project.designerCommission ??
    project.designerFee;
  
  const isExplicitlyLocked = Boolean(project.isCommissionLocked === true || project.isZeroCommissionApproved === true);

  const hasExplicitDesignerComm =
    isExplicitlyLocked
      ? isZeroOrPositive(explicitDesComm)
      : (explicitDesComm !== undefined && explicitDesComm !== null && String(explicitDesComm).trim() !== "" && !isNaN(Number(explicitDesComm)) && Number(explicitDesComm) > 0);

  const explicitSalesComm =
    project.salesCommission ??
    project.commission;

  const hasExplicitSalesComm =
    isExplicitlyLocked
      ? isZeroOrPositive(explicitSalesComm)
      : (explicitSalesComm !== undefined && explicitSalesComm !== null && String(explicitSalesComm).trim() !== "" && !isNaN(Number(explicitSalesComm)) && Number(explicitSalesComm) > 0);

  let desComm = 0;
  let salesComm = 0;
  let amount = 0;
  let roleLabel = '';

  const rawScope = String(project.scopeOfWork || project.scope || "").trim();
  const canScopeKey = toCanonicalScopeKey(rawScope);
  const pSub = normalizeSubService(project.subService);

  const rawCap = project.plantCapacity ?? project.systemCapacity ?? project.capacity;
  const capacity = isZeroOrPositive(rawCap)
    ? Number(rawCap)
    : parseFloat(String(rawCap || "0").replace(/[^\d.]/g, "")) || 0;

  // Helper to match commission rule
  const findRuleForRole = (role: string) => {
    let rule = (commissionRules || []).find((r) => {
      const rRole = String(r.role || "").toLowerCase().trim();
      const rKey = toCanonicalScopeKey(r.scope || r.scopeOfWork || r.serviceName || r.scopeCombination || "");
      const rSub = normalizeSubService(r.subService);
      return rRole === role && rKey === canScopeKey && (rSub === pSub || rSub === "standard");
    });
    if (!rule) {
      rule = (commissionRules || []).find((r) => {
        const rRole = String(r.role || "").toLowerCase().trim();
        const rKey = toCanonicalScopeKey(r.scope || r.scopeOfWork || r.serviceName || r.scopeCombination || "");
        return rRole === role && rKey === canScopeKey;
      });
    }
    if (!rule && (canScopeKey === "ceiLayouts" || canScopeKey === "pipeCalculation")) {
      rule = (commissionRules || []).find((r) => {
        const rRole = String(r.role || "").toLowerCase().trim();
        const rKey = toCanonicalScopeKey(r.scope || r.scopeOfWork || "");
        return rRole === role && rKey === "ceiLayouts";
      });
    }
    return rule;
  };

  // 1. Resolve Designer Commission
  if (hasExplicitDesignerComm) {
    desComm = Number(explicitDesComm);
  } else if (isSplitScopeDesigner && comboResult && comboResult.matched && comboResult.amount > 0) {
    desComm = comboResult.amount;
  } else if (isDesigner || isAssigned || isSplitScopeDesigner) {
    const matchedRule = findRuleForRole("designer");
    if (matchedRule) {
      if (Array.isArray(matchedRule.capacityRows) && matchedRule.capacityRows.length > 0) {
        const matchedRow = findMatchingCapacityRow(matchedRule.capacityRows, capacity);
        if (matchedRow) {
          const capVal = isZeroOrPositive(matchedRule.maxCommission)
            ? Number(matchedRule.maxCommission)
            : 3000;
          const minFloor = isZeroOrPositive(matchedRule.basePrice || matchedRule.minCommission)
            ? Number(matchedRule.basePrice || matchedRule.minCommission)
            : 0;
          desComm = calculateSlabCommission(matchedRow, capacity, capVal, minFloor);
        }
      } else {
        const ruleBase = matchedRule.price ?? matchedRule.basePrice ?? matchedRule.amount;
        if (isZeroOrPositive(ruleBase)) {
          const capVal = isZeroOrPositive(matchedRule.maxCommission) ? Number(matchedRule.maxCommission) : 3000;
          desComm = capVal > 0 ? Math.min(Number(ruleBase), capVal) : Number(ruleBase);
        }
      }
    }

    if (desComm === 0) {
      const finalCost = Number(project.finalCost ?? project.calculatedCost ?? project.cost ?? project.amount ?? 0);
      if (finalCost > 0) {
        desComm = Math.round(finalCost * 0.4);
      }
    }
  }

  // 2. Resolve Sales Commission
  if (hasExplicitSalesComm) {
    salesComm = Number(explicitSalesComm);
  } else if (isSales) {
    const matchedRule = findRuleForRole("sales");
    if (matchedRule) {
      if (Array.isArray(matchedRule.capacityRows) && matchedRule.capacityRows.length > 0) {
        const matchedRow = findMatchingCapacityRow(matchedRule.capacityRows, capacity);
        if (matchedRow) {
          const capVal = isZeroOrPositive(matchedRule.maxCommission)
            ? Number(matchedRule.maxCommission)
            : 3000;
          const minFloor = isZeroOrPositive(matchedRule.basePrice || matchedRule.minCommission)
            ? Number(matchedRule.basePrice || matchedRule.minCommission)
            : 0;
          salesComm = calculateSlabCommission(matchedRow, capacity, capVal, minFloor);
        }
      } else {
        const ruleBase = matchedRule.price ?? matchedRule.basePrice ?? matchedRule.amount;
        if (isZeroOrPositive(ruleBase)) {
          const capVal = isZeroOrPositive(matchedRule.maxCommission) ? Number(matchedRule.maxCommission) : 3000;
          salesComm = capVal > 0 ? Math.min(Number(ruleBase), capVal) : Number(ruleBase);
        }
      }
    }
  }
  // 3. Assemble Final Amount and Role Label
  if (isSplitScopeDesigner && comboResult && comboResult.scopeKeys.length > 0) {
    const scopeLabel = (comboResult.scopeKeys || []).map((k) => SCOPE_LABELS[k] || k).join(" + ") || "Assigned Scope";
    const matchNote = comboResult.matched ? "" : " — Standard Rate";
    if (isSales) {
      amount = desComm + salesComm;
      roleLabel = `Designer (${scopeLabel}) & Sales Commission${matchNote}`;
    } else {
      amount = desComm;
      roleLabel = `Designer Commission (${scopeLabel})${matchNote}`;
    }
  } else if (isDesigner && isSales) {
    amount = desComm + salesComm;
    roleLabel = "Designer & Sales Commission";
  } else if (isDesigner) {
    amount = desComm;
    roleLabel = "Designer Commission";
  } else if (isSales) {
    amount = salesComm;
    roleLabel = "Sales Commission";
  } else if (isAssigned) {
    const rawFallbackIncentive = project.commission ?? project.incentive;
    const fallbackIncentive = isZeroOrPositive(rawFallbackIncentive) ? Number(rawFallbackIncentive) : 0;
    if (empDept.includes("design") || empDesig.includes("design")) {
      amount = isZeroOrPositive(desComm) ? desComm : fallbackIncentive;
      roleLabel = "Designer Commission";
    } else if (empDept.includes("sales") || empDesig.includes("sales")) {
      amount = isZeroOrPositive(salesComm) ? salesComm : fallbackIncentive;
      roleLabel = "Sales Commission";
    } else {
      amount = isZeroOrPositive(fallbackIncentive) ? fallbackIncentive : desComm + salesComm;
      roleLabel = "Project Incentive";
    }
  } else if (isSplitScopeDesigner) {
    amount = desComm;
    roleLabel = "Designer Commission";
  }
  const dateDisplay = formatSafeDate(pDate, "slash") || formatSafeDate(new Date(), "slash");
  const kw = isZeroOrPositive(rawCap) ? Number(rawCap) : parseFloat(String(rawCap || "0").replace(/[^\d.]/g, "")) || 0;

  return {
    id: `PROJ_INC_${project.id || Math.random().toString(36).substring(2, 8)}`,
    date: dateDisplay,
    empId: employee.empId,
    empName: employee.name,
    project: project.projectName || project.name || project.title || "Solar Project",
    client: project.clientName || project.client || project.matchedClient?.companyName || "Corporate Client",
    kw,
    amount: Math.max(0, amount),
    role: roleLabel || "Project Commission",
    projectId: project.id,
    status: project.status || "Active",
    scopeOfWork: project.scopeOfWork || "General Engineering",
    sector: project.sector || project.projectSector || "Commercial",
    ...(isSplitScopeDesigner
      ? {
          scopeKeys: comboResult!.scopeKeys,
          comboFullAmount: comboResult!.comboFullAmount,
          designerEmail: empEmail,
        }
      : {}),
  };
};

// ============================================================================
// MAIN COMPONENT: SalaryStudio
// ============================================================================

export default function SalaryStudio({
  users: externalUsers = [],
  projects: externalProjects = [],
  commissionRules: externalCommissionRules = [],
  invoices: externalInvoices = [],
  clients: externalClients = [],
  onNavigateToGlobalSettings
}: SalaryStudioProps) {
  const { companySettings } = useCompanySettings();
  const { canonicalScopes } = useDynamicTaxonomy();

  const [activeSubTab, setActiveSubTab] = useState<SalaryStudioTab>('dashboard');
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);
  const [previewSlipData, setPreviewSlipData] = useState<SalarySlipRecord | null>(null);

  // Taxonomy Filter State (Mandate 4)
  const [selectedScopeFilter, setSelectedScopeFilter] = useState<string>('All Scopes');
  const [selectedSectorFilter, setSelectedSectorFilter] = useState<string>('All Sectors');

  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const showToast = (text: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 4000);
  };

  const [customEmployees] = useState<EmployeeRecord[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = localStorage.getItem(SALARY_STORAGE_KEYS.employees);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  });

  // Zero-Value Preserving Employee Master (Mandate 2)
  const masterEmployees = useMemo<EmployeeRecord[]>(() => {
    const list: EmployeeRecord[] = [];
    const existingIds = new Set<string>();
    const existingEmails = new Set<string>();

    if (externalUsers && externalUsers.length > 0) {
      externalUsers.forEach((u, idx) => {
        const uEmail = (u.email || '').toLowerCase().trim();
        const uId = (u.empId || u.employeeId || u.id || '').toLowerCase().trim();
        const cleanId = u.id || `EMP_${idx + 1}`;

        // Explicit 0 basic salary must be preserved as 0, not coerced into fallback
        const rawBasic = u.basic ?? u.basicPay ?? u.baseSalary;
        const basicAmt = isZeroOrPositive(rawBasic) ? Number(rawBasic) : 0;

        const rawOthAllow = u.othAllow ?? u.otherAllowance ?? u.allowance;
        const othAllowAmt = isZeroOrPositive(rawOthAllow) ? Number(rawOthAllow) : 0;

        const bankName = u.bankName || u.bank || 'HDFC Bank';
        const accNo = String(u.accountNumber ?? u.accNo ?? u.bankAccountNo ?? '').trim();
        const ifsc = String(u.ifscCode ?? u.ifsc ?? '').trim();
        const doj = u.dateOfJoining || u.doj || u.createdAt || '2026-01-01';
        const dob = u.dateOfBirth || u.dob || '';

        list.push({
          id: cleanId,
          empId: u.empId || u.employeeId || `SOL-${(u.name || 'EMP').substring(0, 3).toUpperCase()}-${String(idx + 1).padStart(3, '0')}`,
          name: formatIndianName(u.fullName || u.name || u.displayName || u.employeeName || 'Unnamed Employee'),
          designation: u.designation || u.role || 'Associate',
          department: u.department || 'Solar Design & Engineering',
          doj: String(doj).split('T')[0],
          dob: dob ? String(dob).split('T')[0] : '',
          pan: String(u.pan || '').trim().toUpperCase(),
          uan: String(u.uan || '').trim(),
          pfNo: String(u.pfNo || '').trim(),
          esicNo: String(u.esicNo || '').trim(),
          bank: bankName,
          bankName,
          accNo,
          accountNumber: accNo,
          ifsc,
          ifscCode: ifsc,
          email: u.email || '',
          mobile: String(u.mobile ?? u.phone ?? '').trim(),
          basic: basicAmt,
          othAllow: othAllowAmt,
          active: u.active !== false && u.status !== 'inactive'
        });

        if (uEmail) existingEmails.add(uEmail);
        if (uId) existingIds.add(uId);
      });
    }

    if (customEmployees && customEmployees.length > 0) {
      customEmployees.forEach((e) => {
        const eEmail = (e.email || '').toLowerCase().trim();
        const eId = (e.empId || e.id || '').toLowerCase().trim();
        if ((eEmail && existingEmails.has(eEmail)) || (eId && existingIds.has(eId))) {
          return;
        }
        list.push(e);
      });
    }

    return list;
  }, [customEmployees, externalUsers]);

  const [incentives] = useState<IncentiveRecord[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = localStorage.getItem(SALARY_STORAGE_KEYS.incentives);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  });

  const [history, setHistory] = useState<SalarySlipRecord[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = localStorage.getItem(SALARY_STORAGE_KEYS.history);
      if (raw) return JSON.parse(raw);
    } catch {}
    return [];
  });

  const [payrollSettings, setPayrollSettings] = useState({
    slipPrefix: 'SOL-PAY',
    otFormula: 2,
    wmText: 'CONFIDENTIAL',
  });

  const saveHistory = (updated: SalarySlipRecord[]) => {
    setHistory(updated);
    if (typeof window !== 'undefined') {
      localStorage.setItem(SALARY_STORAGE_KEYS.history, JSON.stringify(updated));
      window.dispatchEvent(new CustomEvent('solarithm_salary_slips_updated', { detail: updated }));
    }
  };

  // PART 2: Live Salary History & Slips Listeners with Initial Auth Verification & Collection Parity
  useEffect(() => {
    let isMounted = true;
    let unsubSlips: (() => void) | null = null;
    let unsubHistory: (() => void) | null = null;

    const setupSalaryListeners = () => {
      // 1. If auth.currentUser is null while auth is initializing, do not attach snapshot listeners until session is verified
      if (!auth?.currentUser || !db) return;

      const mergedMap = new Map<string, SalarySlipRecord>();

      const commitMergedRecords = () => {
        if (!isMounted) return;
        const list = Array.from(mergedMap.values());
        list.sort((a, b) => {
          const tA = new Date(a.generated || a.paymentDate || 0).getTime();
          const tB = new Date(b.generated || b.paymentDate || 0).getTime();
          return tB - tA;
        });
        if (list.length > 0) {
          setHistory(list);
          if (typeof window !== 'undefined') {
            localStorage.setItem(SALARY_STORAGE_KEYS.history, JSON.stringify(list));
          }
        }
      };

      // 2. Attach error callback on /salaryHistory listener
      try {
        unsubHistory = onSnapshot(
          collection(db, 'salaryHistory'),
          (snapshot) => {
            snapshot.docs.forEach((d) => {
              const data = d.data() as SalarySlipRecord;
              const key = data.slipNo || d.id;
              mergedMap.set(key, { ...data, slipNo: key });
            });
            commitMergedRecords();
          },
          (error) => {
            console.warn('Salary listener handled:', error.message);
          }
        );
      } catch (err: any) {
        console.warn('Salary listener handled:', err?.message);
      }

      // 3. Collection parity: check both /salarySlips and /salaryHistory so saved records load without permission errors
      try {
        unsubSlips = onSnapshot(
          collection(db, 'salarySlips'),
          (snapshot) => {
            snapshot.docs.forEach((d) => {
              const data = d.data() as SalarySlipRecord;
              const key = data.slipNo || d.id;
              mergedMap.set(key, { ...data, slipNo: key });
            });
            commitMergedRecords();
          },
          (error) => {
            console.warn('Salary listener handled:', error.message);
          }
        );
      } catch (err: any) {
        console.warn('Salary listener handled:', err?.message);
      }

      // Synchronize numbering counter from /metadata/counters
      getDoc(doc(db, 'metadata', 'counters'))
        .then((counterSnap) => {
          if (counterSnap.exists()) {
            const cData = counterSnap.data();
            if (cData && typeof cData.salarySlipCounter === 'number') {
              if (typeof window !== 'undefined') {
                localStorage.setItem(SALARY_STORAGE_KEYS.counter, String(cData.salarySlipCounter));
              }
            }
          }
        })
        .catch((cErr) => {
          console.warn('[SalaryStudio] Counter fetch warning:', cErr);
        });
    };

    // Verify user session before attaching listeners
    if (auth) {
      if (auth.currentUser) {
        setupSalaryListeners();
      }
      const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
        if (user) {
          if (!unsubHistory && !unsubSlips) {
            setupSalaryListeners();
          }
        } else {
          if (unsubHistory) { unsubHistory(); unsubHistory = null; }
          if (unsubSlips) { unsubSlips(); unsubSlips = null; }
        }
      });

      return () => {
        isMounted = false;
        unsubscribeAuth();
        if (unsubHistory) unsubHistory();
        if (unsubSlips) unsubSlips();
      };
    }

    return () => {
      isMounted = false;
      if (unsubHistory) unsubHistory();
      if (unsubSlips) unsubSlips();
    };
  }, []);

  const [selectedEmpId, setSelectedEmpId] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const raw = localStorage.getItem(SALARY_STORAGE_KEYS.draft);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.selectedEmpId) return parsed.selectedEmpId;
        } catch {}
      }
    }
    return masterEmployees[0]?.id || '';
  });

  const [genMonth, setGenMonth] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const raw = localStorage.getItem(SALARY_STORAGE_KEYS.draft);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.genMonth) return parsed.genMonth;
        } catch {}
      }
    }
    return 'September';
  });
  // Flexible Incentive Evaluation Month / Lookback Window (Task 2)
  const [incentiveEvalMonth, setIncentiveEvalMonth] = useState<string>('auto');

  const [genFY, setGenFY] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const raw = localStorage.getItem(SALARY_STORAGE_KEYS.draft);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.genFY) return parsed.genFY;
        } catch {}
      }
    }
    return '2026-27';
  });

  const [genPayDate, setGenPayDate] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const raw = localStorage.getItem(SALARY_STORAGE_KEYS.draft);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.genPayDate) return parsed.genPayDate;
        } catch {}
      }
    }
    return new Date().toISOString().split('T')[0];
  });

  const [attendance, setAttendance] = useState<AttendanceData>(() => {
    if (typeof window !== 'undefined') {
      const raw = localStorage.getItem(SALARY_STORAGE_KEYS.draft);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.attendance) return parsed.attendance;
        } catch {}
      }
    }
    return {
      totalDays: 26,
      presentDays: 26,
      leaveDays: 0,
      paidLeave: 0,
      otHours: 0,
      lopDays: 0
    };
  });

  const [additionalEarnings, setAdditionalEarnings] = useState<AdditionalEarningsData>(() => {
    if (typeof window !== 'undefined') {
      const raw = localStorage.getItem(SALARY_STORAGE_KEYS.draft);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.additionalEarnings) return parsed.additionalEarnings;
        } catch {}
      }
    }
    return {
      bonus: 0,
      reimbursement: 0,
      otherAllowance: 0
    };
  });

  const [deductions, setDeductions] = useState<DeductionsData>(() => {
    if (typeof window !== 'undefined') {
      const raw = localStorage.getItem(SALARY_STORAGE_KEYS.draft);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.deductions) return parsed.deductions;
        } catch {}
      }
    }
    return {
      pf: 0,
      esic: 0,
      pt: 200,
      tds: 0,
      advance: 0,
      other: 0
    };
  });

  const [paymentDetails, setPaymentDetails] = useState<{ paymentMode: string; transactionId: string; paymentDate: string }>(() => {
    if (typeof window !== 'undefined') {
      const raw = localStorage.getItem(SALARY_STORAGE_KEYS.draft);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.paymentDetails) return parsed.paymentDetails;
        } catch {}
      }
    }
    return {
      paymentMode: 'Bank Transfer',
      transactionId: 'TXN-2026-SEP-01',
      paymentDate: genPayDate
    };
  });

  const isPaymentDetailsComplete = Boolean(
    paymentDetails.paymentMode.trim() &&
    paymentDetails.transactionId.trim() &&
    paymentDetails.paymentDate.trim()
  );

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const draft = {
        selectedEmpId,
        genMonth,
        genFY,
        genPayDate,
        attendance,
        additionalEarnings,
        deductions,
        paymentDetails
      };
      localStorage.setItem(SALARY_STORAGE_KEYS.draft, JSON.stringify(draft));
    }
  }, [selectedEmpId, genMonth, genFY, genPayDate, attendance, additionalEarnings, deductions, paymentDetails]);

  const currentEmployee = useMemo<EmployeeRecord | null>(() => {
    return (
      masterEmployees.find(e => e.id === selectedEmpId || e.empId === selectedEmpId) ||
      masterEmployees[0] || null
    );
  }, [masterEmployees, selectedEmpId]);

  const incentiveCyclePeriod = useMemo(() => {
    const base = getIncentiveCyclePeriod(genMonth, genFY);
    if (!incentiveEvalMonth || incentiveEvalMonth === 'auto') {
      return base;
    }
    if (incentiveEvalMonth === 'unbilled') {
      return {
        month: base.month,
        fy: base.fy,
        lookbackMonths: SALARY_MONTHS as unknown as string[]
      };
    }
    return {
      month: incentiveEvalMonth,
      fy: genFY,
      lookbackMonths: [incentiveEvalMonth]
    };
  }, [genMonth, genFY, incentiveEvalMonth]);

  // Active Project Incentives with Scope & Sector Decoupling (Mandates 1, 2, 4)
  const allActiveIncentives = useMemo<IncentiveRecord[]>(() => {
    if (!currentEmployee) return [];

    const matchedIncentives: IncentiveRecord[] = [];
    const empEmail = (currentEmployee.email || "").toLowerCase().trim();
    const empName = (currentEmployee.name || "").toLowerCase().trim();
    const empId = (currentEmployee.empId || "").toLowerCase().trim();

    // =========================================================================
    // 1. Fixed Package Sales Incentive (FLAT ₹500 upon 100% PAID Invoices)
    // =========================================================================
    if (Array.isArray(externalInvoices) && externalInvoices.length > 0) {
      externalInvoices.forEach((inv) => {
        // Must be a Package Retainer or Package Renewal invoice
        const invType = String(inv.invoiceType || "").toUpperCase().trim();
        const isPackageInvoice =
          invType === "PACKAGE_RETAINER" ||
          invType === "PACKAGE_RENEWAL" ||
          Boolean(inv.packageType) ||
          Boolean(inv.salesIncentiveAmount);

        if (!isPackageInvoice) return;

        // Sales Attribution: Match acquiring sales rep email, name, or employee ID
        const invSalesEmail = String(inv.salesPersonEmail || inv.salesEmail || inv.assignedSales || "").toLowerCase().trim();
        const invSalesName = String(inv.salesPersonName || inv.salesName || "").toLowerCase().trim();

        const isSalesRepMatch = Boolean(
          (empEmail && invSalesEmail && (empEmail === invSalesEmail || invSalesEmail.includes(empEmail))) ||
          (empName && invSalesName && (empName === invSalesName || matchEmployeeNames(empName, invSalesName)))
        );

        if (!isSalesRepMatch) return;

        // Strict 100% Paid Settlement Verification
        const canonicalStatus = String(inv.status || "").toUpperCase().trim();
        const isFullyPaid = canonicalStatus === "PAID";
        if (!isFullyPaid) return;

        // Date alignment: Must fall into evaluated cycle month/lookback
        const paymentDateRaw = inv.paymentDate || inv.updatedAt || inv.invDate || inv.createdAt;
        const pDate = parseSafeDate(paymentDateRaw);
        if (!isProjectInMonthAndFY(pDate, incentiveCyclePeriod.month, incentiveCyclePeriod.fy, incentiveCyclePeriod.lookbackMonths)) {
          return;
        }

        const dateDisplay = formatSafeDate(pDate || new Date(), "slash");
        const isRenewal = invType === "PACKAGE_RENEWAL";
        const pkgTitle = inv.packageType || "Fixed Package";
        const clientTitle = inv.client?.name || inv.clientName || "Corporate Client";

        matchedIncentives.push({
          id: `PKG_INC_${inv.id || Math.random().toString(36).substring(2, 8)}`,
          date: dateDisplay,
          empId: currentEmployee.empId,
          empName: currentEmployee.name,
          project: `${pkgTitle} (${isRenewal ? "Renewal" : "Initial"})`,
          client: clientTitle,
          kw: 0,
          amount: 500, // Flat ₹500
          role: "Package Sales Incentive",
          status: "PAID",
          scopeOfWork: pkgTitle,
          sector: "Subscription"
        });
      });
    }

    // =========================================================================
    // 2. Deliverable Incentives (Designer Fees + Standard kW Commissions)
    // Individual deliverables under package quota have Sales Commission = ₹0
    // =========================================================================
    if (Array.isArray(externalProjects) && externalProjects.length > 0) {
      externalProjects.forEach((p) => {
        const inc = getProjectIncentiveForEmployee(
          p,
          currentEmployee,
          incentiveCyclePeriod.month,
          incentiveCyclePeriod.fy,
          externalCommissionRules,
          incentiveCyclePeriod.lookbackMonths
        );
        if (inc) {
          matchedIncentives.push(inc);
        }
      });
    }

    if (matchedIncentives.length > 0) {
      return matchedIncentives;
    }

    return incentives.filter((inc) => {
      const isEmpMatch =
        currentEmployee &&
        (inc.empId === currentEmployee.empId || inc.empName.toLowerCase() === currentEmployee.name.toLowerCase());
      if (!isEmpMatch) return false;
      if (!genMonth) return true;
      const d = parseSafeDate(inc.date);
      if (!d) return true;
      const incMonth = d.toLocaleString("default", { month: "long" });
      return incMonth.toLowerCase() === genMonth.toLowerCase();
    });
  }, [externalInvoices, externalProjects, currentEmployee, genMonth, incentiveCyclePeriod, incentives, externalCommissionRules]);

    // Dynamic Scopes derived from active project deliverables + taxonomy (Mandate 2 & Task 2)
  const availableScopesList = useMemo(() => {
    const scopeMap = new Map<string, string>();
    scopeMap.set("all scopes", "All Scopes");

    // Add canonical scopes from Firestore taxonomy
    (canonicalScopes || []).forEach((s) => {
      if (s && typeof s === "string" && s.trim()) {
        const key = toCanonicalScopeKey(s);
        if (!scopeMap.has(key)) {
          scopeMap.set(key, s.trim());
        }
      }
    });

    // Add unique scopes from allActiveIncentives & external projects
    allActiveIncentives.forEach((inc) => {
      const raw = String(inc.scopeOfWork || "").trim();
      if (raw) {
        const key = toCanonicalScopeKey(raw);
        if (!scopeMap.has(key)) {
          let label = raw;
          if (key === "detailedEngineering") label = "Detailed Engineering";
          else if (key === "pvsyst") label = "PVsyst";
          else if (key === "preDesign") label = "Pre-Design";
          scopeMap.set(key, label);
        }
      }
    });

    // Fallback standard engineering scopes if empty
    [
      "Pre-Design",
      "Detailed Engineering",
      "Permit Package",
      "CEIG",
      "PVsyst",
      "Single Line Diagram",
      "Bill of Materials",
      "PE Stamping"
    ].forEach((s) => {
      const key = toCanonicalScopeKey(s);
      if (!scopeMap.has(key)) {
        scopeMap.set(key, s);
      }
    });

    return Array.from(scopeMap.values());
  }, [canonicalScopes, allActiveIncentives]);

  // Filtered Incentives based on decoupled Scope and Sector with Canonical Normalization (Task 2)
  const activeIncentives = useMemo(() => {
    return allActiveIncentives.filter((inc) => {
      if (selectedScopeFilter && selectedScopeFilter !== 'All Scopes') {
        const incKey = toCanonicalScopeKey(String(inc.scopeOfWork || ''));
        const targetKey = toCanonicalScopeKey(selectedScopeFilter);
        const roleKey = toCanonicalScopeKey(String(inc.role || ''));

        const rawInc = String(inc.scopeOfWork || '').toLowerCase();
        const rawRole = String(inc.role || '').toLowerCase();
        const rawTarget = selectedScopeFilter.toLowerCase();

        // Check canonical equality (Detail Design === Detailed Engineering), role match, or string containment
        const isMatch =
          incKey === targetKey ||
          roleKey === targetKey ||
          rawInc.includes(rawTarget) ||
          rawRole.includes(rawTarget) ||
          rawTarget.includes(rawInc);

        if (!isMatch) {
          return false;
        }
      }
      if (selectedSectorFilter && selectedSectorFilter !== 'All Sectors') {
        const sectorStr = String(inc.sector || '').toLowerCase();
        const targetSector = selectedSectorFilter.toLowerCase();
        if (!sectorStr.includes(targetSector) && !targetSector.includes(sectorStr)) {
          return false;
        }
      }
      return true;
    });
  }, [allActiveIncentives, selectedScopeFilter, selectedSectorFilter]);
  const totalIncentiveAmount = useMemo(() => {
    return activeIncentives.reduce((sum, inc) => sum + (Number(inc.amount) || 0), 0);
  }, [activeIncentives]);

  const totalProjects = activeIncentives.length;
  const totalKwp = useMemo(
    () => activeIncentives.reduce((sum, inc) => sum + (Number(inc.kw) || 0), 0),
    [activeIncentives]
  );
  const totalIncentive = totalIncentiveAmount;

  const attendanceRatio = useMemo(() => {
    const total = attendance.totalDays > 0 ? attendance.totalDays : 26;
    const present = attendance.presentDays;
    return total > 0 ? Math.min(Math.max(present / total, 0), 1) : 1;
  }, [attendance.totalDays, attendance.presentDays]);

  // Zero-Value Preserving Calculations (Mandate 2)
  const calculatedEarnings = useMemo(() => {
    const rawBasic = currentEmployee?.basic ?? 0;
    const basic = Math.round(rawBasic * attendanceRatio);

    const rawOthAllow = currentEmployee?.othAllow ?? 0;
    const othAllow = Math.round(rawOthAllow * attendanceRatio);

    const totalDays = attendance.totalDays || 26;
    const hourlyRate = totalDays > 0 ? rawBasic / (totalDays * 8) : 0;
    const otPay = Math.round(hourlyRate * (attendance.otHours || 0) * payrollSettings.otFormula);

    const bonus = isZeroOrPositive(additionalEarnings.bonus) ? Number(additionalEarnings.bonus) : 0;
    const reimb = isZeroOrPositive(additionalEarnings.reimbursement) ? Number(additionalEarnings.reimbursement) : 0;
    const otherEarn = isZeroOrPositive(additionalEarnings.otherAllowance) ? Number(additionalEarnings.otherAllowance) : 0;

    const gross = basic + othAllow + totalIncentiveAmount + otPay + bonus + reimb + otherEarn;

    return {
      basic,
      othAllow,
      incentive: totalIncentiveAmount,
      ot: otPay,
      bonus,
      reimbursement: reimb,
      otherAllowance: otherEarn,
      gross
    };
  }, [currentEmployee, attendanceRatio, attendance.totalDays, attendance.otHours, payrollSettings.otFormula, additionalEarnings, totalIncentiveAmount]);

  const totalDeductions = useMemo(() => {
    return (
      (isZeroOrPositive(deductions.pf) ? Number(deductions.pf) : 0) +
      (isZeroOrPositive(deductions.esic) ? Number(deductions.esic) : 0) +
      (isZeroOrPositive(deductions.pt) ? Number(deductions.pt) : 0) +
      (isZeroOrPositive(deductions.tds) ? Number(deductions.tds) : 0) +
      (isZeroOrPositive(deductions.advance) ? Number(deductions.advance) : 0) +
      (isZeroOrPositive(deductions.other) ? Number(deductions.other) : 0)
    );
  }, [deductions]);

  const netSalaryPayable = useMemo(() => {
    return Math.max(0, calculatedEarnings.gross - totalDeductions);
  }, [calculatedEarnings.gross, totalDeductions]);

  const generateSlipNumber = (explicitCounter?: number) => {
    let ctr = explicitCounter;
    if (typeof ctr !== 'number') {
      if (typeof window !== 'undefined') {
        const raw = localStorage.getItem(SALARY_STORAGE_KEYS.counter);
        ctr = (raw ? parseInt(raw, 10) : 0) + 1;
        localStorage.setItem(SALARY_STORAGE_KEYS.counter, String(ctr));
      } else {
        ctr = 1;
      }
    }
    const year = new Date().getFullYear();
    const seq = String(ctr).padStart(4, '0');
    return `${payrollSettings.slipPrefix}-${year}-${seq}`;
  };

  const buildSalarySlipRecord = (customSlipNo?: string): SalarySlipRecord => {
    const slipNo = customSlipNo || generateSlipNumber();
    return {
      slipNo,
      empId: currentEmployee?.id || '',
      empEmpId: currentEmployee?.empId || '',
      empName: currentEmployee?.name || '',
      month: genMonth,
      fy: genFY,
      payDate: genPayDate,
      gross: calculatedEarnings.gross,
      totalDed: totalDeductions,
      net: netSalaryPayable,
      generated: new Date().toISOString(),
      paymentMode: paymentDetails.paymentMode,
      transactionId: paymentDetails.transactionId,
      paymentDate: paymentDetails.paymentDate,
      employeeBankSnapshot: {
        bankName: currentEmployee?.bankName || currentEmployee?.bank || 'N/A',
        maskedAccountNumber: maskAccountNumber(currentEmployee?.accNo || currentEmployee?.accountNumber)
      },
      attendance: { ...attendance },
      earnings: { ...calculatedEarnings },
      deductions: { ...deductions },
      incentivesList: [...activeIncentives],
      incentiveSummary: {
        cycleMonth: incentiveCyclePeriod.month,
        cycleFY: incentiveCyclePeriod.fy,
        totalProjects,
        totalKwp,
        totalIncentive
      },
      companySnapshot: {
        name: companySettings?.companyName || 'SOLARITHM DESIGN & ENGINEERING CONSULTANCY',
        address: companySettings?.address || 'Surat, Gujarat, India',
        gstin: companySettings?.gstin || '',
        phone: companySettings?.phone || '+91 94295 00746 / 63',
        email: companySettings?.email || 'info.solarithm@gmail.com',
        web: 'www.solarithm.com',
        signName: 'Authorized Signatory',
        logo: companySettings?.logo || null,
        sig: null,
        stamp: null
      },
      employeeSnapshot: currentEmployee ? { ...currentEmployee } : ({} as any)
    };
  };

  // ============================================================================
  // ATOMIC WRITEBACK CHECK (Mandate 1: Audit SEC-01 / Runtime Crash Prevention)
  // ============================================================================
  const commitPayoutHistoryForSlip = async (record: SalarySlipRecord) => {
    const splitScopeCredits = (record.incentivesList || []).filter(
      (inc) => inc.scopeKeys && inc.scopeKeys.length > 0 && inc.projectId && Number(inc.amount) > 0
    );
    if (splitScopeCredits.length === 0) return;

    const byProject = new Map<string, IncentiveRecord[]>();
    splitScopeCredits.forEach((inc) => {
      const list = byProject.get(inc.projectId as string) || [];
      list.push(inc);
      byProject.set(inc.projectId as string, list);
    });

    const nowIso = new Date().toISOString();

    await Promise.all(
      Array.from(byProject.entries()).map(async ([projectId, credits]) => {
        const updates: Record<string, any> = {};
        credits.forEach((inc) => {
          const paidAmount = inc.comboFullAmount !== undefined ? inc.comboFullAmount : inc.amount;
          (inc.scopeKeys || []).forEach((scopeKey) => {
            updates[`payoutHistory.${scopeKey}`] = {
              paidAt: nowIso,
              amount: paidAmount,
              designerEmail: inc.designerEmail || null,
              slipNo: record.slipNo
            };
          });
        });
        if (Object.keys(updates).length === 0) return;

        try {
          const projRef = doc(db, COLLECTIONS.PROJECTS, projectId);
          // Mandatory pre-check: verify document exists before executing updateDoc
          const snap = await getDoc(projRef);
          if (snap.exists()) {
            await updateDoc(projRef, updates);
          } else {
            console.warn(`[SalaryStudio] Project document "${projectId}" was not found in Firestore. Bypassing mutation safely.`);
            showToast(`Project record (${projectId}) not found in database. Payout writeback skipped safely.`, 'info');
          }
        } catch (err: any) {
          console.error(`Error during payout writeback for project ${projectId}:`, err);
          showToast(`Warning: Payout writeback for project ${projectId} failed.`, 'error');
        }
      })
    );
  };

  const handleSaveSlipToHistory = async () => {
    if (!currentEmployee) {
      showToast('Please select an employee first.', 'error');
      return;
    }
    if (!isPaymentDetailsComplete) {
      showToast('Payment Mode, Transaction ID, and Payment Date are all required before saving a slip.', 'error');
      return;
    }
    const existingIndex = history.findIndex(
      h => h.empEmpId === currentEmployee.empId && h.month === genMonth && h.fy === genFY
    );

    let updatedHistory: SalarySlipRecord[];
    let finalizedRecord: SalarySlipRecord;

    if (existingIndex > -1) {
      const existingSlipNo = history[existingIndex].slipNo;
      finalizedRecord = buildSalarySlipRecord(existingSlipNo);
      updatedHistory = [...history];
      updatedHistory[existingIndex] = finalizedRecord;
      showToast(`Updated existing salary slip ${existingSlipNo}`, 'info');
    } else {
      // Synchronize numbering sequence counter to Firestore (/metadata/counters)
      let nextCounter = 1;
      if (db) {
        try {
          const counterDocRef = doc(db, 'metadata', 'counters');
          const counterSnap = await getDoc(counterDocRef);
          if (counterSnap.exists()) {
            const rawVal = counterSnap.data()?.salarySlipCounter;
            if (typeof rawVal === 'number' && !isNaN(rawVal)) {
              nextCounter = rawVal + 1;
            } else {
              const localRaw = typeof window !== 'undefined' ? localStorage.getItem(SALARY_STORAGE_KEYS.counter) : null;
              nextCounter = (localRaw ? parseInt(localRaw, 10) : 0) + 1;
            }
          } else {
            const localRaw = typeof window !== 'undefined' ? localStorage.getItem(SALARY_STORAGE_KEYS.counter) : null;
            nextCounter = (localRaw ? parseInt(localRaw, 10) : 0) + 1;
          }
          await setDoc(counterDocRef, { salarySlipCounter: nextCounter }, { merge: true });
        } catch (ctrErr) {
          console.warn('[SalaryStudio] Counter synchronization notice:', ctrErr);
          const localRaw = typeof window !== 'undefined' ? localStorage.getItem(SALARY_STORAGE_KEYS.counter) : null;
          nextCounter = (localRaw ? parseInt(localRaw, 10) : 0) + 1;
        }
      } else if (typeof window !== 'undefined') {
        const localRaw = localStorage.getItem(SALARY_STORAGE_KEYS.counter);
        nextCounter = (localRaw ? parseInt(localRaw, 10) : 0) + 1;
      }

      if (typeof window !== 'undefined') {
        localStorage.setItem(SALARY_STORAGE_KEYS.counter, String(nextCounter));
      }

      const generatedSlipNo = generateSlipNumber(nextCounter);
      finalizedRecord = buildSalarySlipRecord(generatedSlipNo);
      updatedHistory = [finalizedRecord, ...history];
      showToast(`Generated & saved Salary Slip #${finalizedRecord.slipNo}`, 'success');
    }

    // Directive 1 [FIN-01]: Persist full payroll snapshot to Firestore /salarySlips/{slipNo} with { merge: true }
    if (db) {
      try {
        const fullPayrollSnapshot = {
          ...finalizedRecord,
          employeeId: finalizedRecord.empEmpId || finalizedRecord.empId,
          name: finalizedRecord.empName,
          designation: finalizedRecord.employeeSnapshot?.designation || '',
          month: finalizedRecord.month,
          financialYear: finalizedRecord.fy,
          basicPay: finalizedRecord.earnings?.basic ?? 0,
          commissions: finalizedRecord.earnings?.incentive ?? 0,
          netPayable: finalizedRecord.net ?? 0,
          paymentMode: finalizedRecord.paymentMode || '',
          transactionId: finalizedRecord.transactionId || '',
          paymentDate: finalizedRecord.paymentDate || '',
          serverTimestamp: serverTimestamp(),
          updatedAt: new Date().toISOString()
        };
        await setDoc(doc(db, 'salarySlips', finalizedRecord.slipNo), fullPayrollSnapshot, { merge: true });
      } catch (err) {
        console.error('[SalaryStudio] Failed to persist salary slip to Firestore /salarySlips:', err);
        showToast('Notice: Cloud sync pending. Slip saved to local session.', 'info');
      }
    }

    saveHistory(updatedHistory);

    try {
      await commitPayoutHistoryForSlip(finalizedRecord);
    } catch (e) {
      console.error('Error committing payout history for slip:', e);
    }
  };

  const handlePreviewSlip = (customSlip?: SalarySlipRecord) => {
    if (!currentEmployee && !customSlip) {
      showToast('Please select an employee first.', 'error');
      return;
    }
    if (!customSlip && !isPaymentDetailsComplete) {
      showToast('Payment Mode, Transaction ID, and Payment Date are required.', 'error');
      return;
    }
    const slip = customSlip || buildSalarySlipRecord(history.find(h => currentEmployee && h.empEmpId === currentEmployee.empId && h.month === genMonth && h.fy === genFY)?.slipNo);
    setPreviewSlipData(slip);
    setIsPreviewModalOpen(true);
  };

  const [isPdfExporting, setIsPdfExporting] = useState(false);
  const handleDownloadPDF = async () => {
    const printArea = document.getElementById('salarySlipPrintContainer');
    if (!printArea) {
      showToast('Slip template element not found', 'error');
      return;
    }
    setIsPdfExporting(true);
    try {
      const canvas = await html2canvas(printArea, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#FFFFFF',
        logging: false,
        windowWidth: 794
      });

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'pt',
        format: 'a4'
      });

      const pageWidth = 595.28;
      const margin = 24;
      const renderWidth = pageWidth - margin * 2;
      const renderHeight = (canvas.height * renderWidth) / canvas.width;

      pdf.addImage(imgData, 'PNG', margin, margin, renderWidth, renderHeight);

      const safeEmpName = (previewSlipData?.empName || 'Employee').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
      const safeMonth = (previewSlipData?.month || 'Month').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
      const safeYear = (previewSlipData?.fy || '2026-27').trim().replace(/[\/\\]/g, '-').replace(/[^a-zA-Z0-9_-]/g, '_');
      const fileName = `${safeEmpName}_${safeMonth}_${safeYear}_SalarySlip.pdf`;
      pdf.save(fileName);
      showToast(`Salary Slip PDF downloaded: ${fileName}`, 'success');
    } catch (err: any) {
      console.error(err);
      showToast('PDF generation failed: ' + (err.message || 'Error'), 'error');
    } finally {
      setIsPdfExporting(false);
    }
  };

  const [histSearch, setHistSearch] = useState('');

  return (
    <div id="sec-salary-studio" className="w-full space-y-6 text-gray-900 dark:text-white transition-colors">
      {/* Toast Alert */}
      {toastMessage && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-2xl flex items-center space-x-3 text-xs font-semibold border backdrop-blur-md transition-all ${
            toastMessage.type === 'success'
              ? 'bg-white dark:bg-emerald-950/90 text-emerald-600 dark:text-emerald-300 border-emerald-500/40'
              : toastMessage.type === 'error'
              ? 'bg-white dark:bg-rose-950/90 text-rose-600 dark:text-rose-300 border-rose-500/40'
              : 'bg-white dark:bg-[#1E1E1E]/95 text-[#D4AF37] border-[#D4AF37]/40'
          }`}
        >
          {toastMessage.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
          )}
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* Module Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white dark:bg-[#121212] p-6 rounded-xl border border-gray-200 dark:border-[#333333] shadow-sm transition-colors">
        <div className="flex items-center space-x-4">
          <div className="w-12 h-12 rounded-xl bg-gray-100 dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] flex items-center justify-center shrink-0 text-[#D4AF37]">
            <Banknote className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white tracking-wide">Salary Studio</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Production payroll calculation, live project commission mapping, and automated salary slip engine.
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={() => setActiveSubTab('salary-generator')}
            className="flex items-center space-x-2 px-4 py-2 rounded-lg bg-[#D4AF37] hover:bg-[#f2c94c] text-black text-xs font-bold shadow-md shadow-[#D4AF37]/20 transition-colors"
          >
            <Plus className="w-4 h-4 text-black" />
            <span>Generate Slip</span>
          </button>
        </div>
      </div>

      {/* Horizontal Tabbed Navigation Bar */}
      <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] rounded-xl p-1.5 shadow-sm overflow-x-auto transition-colors">
        <nav className="flex space-x-2 min-w-max" aria-label="Salary Studio Tabs">
          {[
            { id: 'dashboard', label: 'Overview', icon: LayoutGrid },
            { id: 'salary-generator', label: 'Generate Slip', icon: FileText },
            { id: 'history', label: 'Slip History', icon: Clock },
            { id: 'settings', label: 'Rules & Format', icon: SettingsIcon }
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeSubTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveSubTab(tab.id as SalaryStudioTab)}
                className={`flex items-center space-x-2.5 px-4 py-2.5 rounded-lg text-xs font-semibold transition-all ${
                  isActive
                    ? 'bg-gray-100 dark:bg-[#2A2A2A] text-[#D4AF37] border border-[#D4AF37]/40 shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#252525]'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-[#D4AF37]' : 'text-gray-400'}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* 1. OVERVIEW */}
      {activeSubTab === 'dashboard' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] rounded-xl p-5 shadow-sm transition-all">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Total Workforce</span>
                <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-[#121212] text-[#D4AF37] flex items-center justify-center">
                  <Users className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-2 text-2xl font-bold text-gray-900 dark:text-white font-mono">{masterEmployees.length}</div>
              <div className="text-[11px] text-gray-400 mt-1">Active on Master Payroll</div>
            </div>

            <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] rounded-xl p-5 shadow-sm transition-all">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Slips Generated</span>
                <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                  <FileText className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-2 text-2xl font-bold text-emerald-600 dark:text-emerald-400 font-mono">{history.length}</div>
              <div className="text-[11px] text-gray-400 mt-1">Archived Salary Slips</div>
            </div>

            <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] rounded-xl p-5 shadow-sm transition-all">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Incentive Records</span>
                <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-[#121212] text-[#D4AF37] flex items-center justify-center">
                  <Trophy className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-2 text-2xl font-bold text-[#D4AF37] font-mono">{allActiveIncentives.length}</div>
              <div className="text-[11px] text-gray-400 mt-1">Live Project Commissions</div>
            </div>

            <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] rounded-xl p-5 shadow-sm transition-all">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Last Net Salary</span>
                <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-[#121212] text-[#D4AF37] flex items-center justify-center">
                  <Receipt className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-2 text-2xl font-bold text-gray-900 dark:text-white font-mono">
                {formatCurrency(history[0]?.net ?? 0)}
              </div>
              <div className="text-[11px] text-gray-400 mt-1">Latest Slip Value</div>
            </div>
          </div>
        </div>
      )}

      {/* 2. GENERATE SLIP */}
      {activeSubTab === 'salary-generator' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 space-y-6">
            <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] rounded-xl p-5 shadow-sm transition-colors">
              <h3 className="text-xs font-bold text-gray-900 dark:text-white uppercase tracking-wider pb-2 border-b border-gray-200 dark:border-[#333333] mb-4">
                Employee &amp; Period Selection
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-12 gap-3 text-xs">
                <div className="md:col-span-6">
                  <label className="block text-gray-600 dark:text-gray-400 font-semibold mb-1">Select Employee *</label>
                  <select
                    value={selectedEmpId}
                    onChange={e => setSelectedEmpId(e.target.value)}
                    className="w-full bg-gray-50 dark:bg-[#1A1A1A] border border-gray-300 dark:border-[#333333] rounded-lg px-3 py-2 text-xs text-gray-900 dark:text-white focus:border-[#D4AF37]"
                  >
                    {masterEmployees.map((e, index) => (
                      <option key={e.id ? `${e.id}-${index}` : `emp-${index}`} value={e.id} className="bg-white dark:bg-[#1E1E1E] text-gray-900 dark:text-white">
                        {e.name} ({e.empId}) — {e.designation}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-3">
                  <label className="block text-gray-600 dark:text-gray-400 font-semibold mb-1">Month *</label>
                  <select
                    value={genMonth}
                    onChange={e => setGenMonth(e.target.value)}
                    className="w-full bg-gray-50 dark:bg-[#1A1A1A] border border-gray-300 dark:border-[#333333] rounded-lg px-3 py-2 text-xs text-gray-900 dark:text-white focus:border-[#D4AF37]"
                  >
                    {SALARY_MONTHS.map(m => (
                      <option key={m} value={m} className="bg-white dark:bg-[#1E1E1E] text-gray-900 dark:text-white">{m}</option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-3">
                  <label className="block text-gray-600 dark:text-gray-400 font-semibold mb-1">FY *</label>
                  <select
                    value={genFY}
                    onChange={e => setGenFY(e.target.value)}
                    className="w-full bg-gray-50 dark:bg-[#1A1A1A] border border-gray-300 dark:border-[#333333] rounded-lg px-3 py-2 text-xs text-gray-900 dark:text-white focus:border-[#D4AF37]"
                  >
                    <option value="2025-26" className="bg-white dark:bg-[#1E1E1E] text-gray-900 dark:text-white">2025-26</option>
                    <option value="2026-27" className="bg-white dark:bg-[#1E1E1E] text-gray-900 dark:text-white">2026-27</option>
                  </select>
                </div>
                <div className="md:col-span-3">
                  <label className="block text-gray-600 dark:text-gray-400 font-semibold mb-1 flex items-center justify-between">
                    <span>Incentive Cycle *</span>
                    <span className="text-[10px] text-[#D4AF37] font-mono font-normal">Active: {incentiveCyclePeriod.month}</span>
                  </label>
                  <select
                    value={incentiveEvalMonth}
                    onChange={e => setIncentiveEvalMonth(e.target.value)}
                    className="w-full bg-gray-50 dark:bg-[#1A1A1A] border border-gray-300 dark:border-[#333333] rounded-lg px-3 py-2 text-xs text-gray-900 dark:text-white focus:border-[#D4AF37]"
                    title="Select specific incentive evaluation month or automatic N-1 bi-month lookback window"
                  >
                    <option value="auto" className="bg-white dark:bg-[#1E1E1E] text-gray-900 dark:text-white">Auto (N-1 Bi-Month Lookback)</option>
                    <option value="unbilled" className="bg-white dark:bg-[#1E1E1E] text-gray-900 dark:text-white">All Prior Unbilled Projects</option>
                    {SALARY_MONTHS.map(m => (
                      <option key={`eval-${m}`} value={m} className="bg-white dark:bg-[#1E1E1E] text-gray-900 dark:text-white">
                        {m} Deliverables
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Attendance Breakdown */}
            <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] rounded-xl p-5 shadow-sm transition-colors">
              <h3 className="text-xs font-bold text-gray-900 dark:text-white uppercase tracking-wider pb-2 border-b border-gray-200 dark:border-[#333333] mb-4">
                Attendance Breakdown
              </h3>
              <div className="grid grid-cols-3 md:grid-cols-6 gap-2 text-xs">
                <div>
                  <label className="block text-[10px] text-gray-500 font-semibold mb-1">Total Days</label>
                  <input
                    type="number"
                    value={attendance.totalDays}
                    onChange={e => setAttendance({ ...attendance, totalDays: Number(e.target.value) || 0 })}
                    className="w-full bg-gray-50 dark:bg-[#1A1A1A] border border-gray-300 dark:border-[#333333] rounded px-2 py-1 text-gray-900 dark:text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-500 font-semibold mb-1">Present</label>
                  <input
                    type="number"
                    value={attendance.presentDays}
                    onChange={e => setAttendance({ ...attendance, presentDays: Number(e.target.value) || 0 })}
                    className="w-full bg-gray-50 dark:bg-[#1A1A1A] border border-gray-300 dark:border-[#333333] rounded px-2 py-1 text-gray-900 dark:text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-500 font-semibold mb-1">Leave</label>
                  <input
                    type="number"
                    value={attendance.leaveDays}
                    onChange={e => setAttendance({ ...attendance, leaveDays: Number(e.target.value) || 0 })}
                    className="w-full bg-gray-50 dark:bg-[#1A1A1A] border border-gray-300 dark:border-[#333333] rounded px-2 py-1 text-gray-900 dark:text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-500 font-semibold mb-1">Paid Leave</label>
                  <input
                    type="number"
                    value={attendance.paidLeave}
                    onChange={e => setAttendance({ ...attendance, paidLeave: Number(e.target.value) || 0 })}
                    className="w-full bg-gray-50 dark:bg-[#1A1A1A] border border-gray-300 dark:border-[#333333] rounded px-2 py-1 text-gray-900 dark:text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-500 font-semibold mb-1">OT Hours</label>
                  <input
                    type="number"
                    value={attendance.otHours}
                    onChange={e => setAttendance({ ...attendance, otHours: Number(e.target.value) || 0 })}
                    className="w-full bg-gray-50 dark:bg-[#1A1A1A] border border-gray-300 dark:border-[#333333] rounded px-2 py-1 text-gray-900 dark:text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-500 font-semibold mb-1">LOP Days</label>
                  <input
                    type="number"
                    value={attendance.lopDays}
                    onChange={e => setAttendance({ ...attendance, lopDays: Number(e.target.value) || 0 })}
                    className="w-full bg-gray-50 dark:bg-[#1A1A1A] border border-gray-300 dark:border-[#333333] rounded px-2 py-1 text-gray-900 dark:text-white font-mono"
                  />
                </div>
              </div>
            </div>

            {/* Incentives with Decoupled Taxonomy Filters (Mandate 4) */}
            <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] rounded-xl p-5 shadow-sm transition-colors">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-3 border-b border-gray-200 dark:border-[#333333] gap-2 mb-3">
                <div>
                  <h3 className="text-xs font-bold text-gray-900 dark:text-white uppercase tracking-wider">
                    Live Project Incentives ({incentiveCyclePeriod.month} {incentiveCyclePeriod.fy})
                  </h3>
                  <span className="text-[11px] text-gray-500 dark:text-gray-400">
                    Calculated from verified project assignments ({activeIncentives.length} deliverables)
                  </span>
                </div>
                <span className="text-xs font-mono font-bold text-emerald-600 dark:text-emerald-400">
                  Total: {formatCurrency(totalIncentiveAmount)}
                </span>
              </div>

              {/* Scope & Sector Decoupled Filters */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3 p-2.5 rounded-lg bg-gray-50 dark:bg-[#171717] border border-gray-200 dark:border-[#2E2E2E]">
                <div>
                  <label className="block text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider mb-1 flex items-center gap-1">
                    <Filter className="w-3 h-3 text-[#D4AF37]" />
                    <span>Engineering Scope</span>
                  </label>
                  <select
                    value={selectedScopeFilter}
                    onChange={(e) => setSelectedScopeFilter(e.target.value)}
                    className="w-full bg-white dark:bg-[#1F1F1F] border border-gray-300 dark:border-[#3A3A3A] rounded px-2.5 py-1 text-xs text-gray-900 dark:text-white"
                  >
                    {(availableScopesList || ENGINEERING_SCOPES).map((scope) => (
                      <option key={scope} value={scope} className="bg-white dark:bg-[#1E1E1E] text-gray-900 dark:text-white">{scope}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider mb-1 flex items-center gap-1">
                    <Filter className="w-3 h-3 text-[#D4AF37]" />
                    <span>Installation Sector</span>
                  </label>
                  <select
                    value={selectedSectorFilter}
                    onChange={(e) => setSelectedSectorFilter(e.target.value)}
                    className="w-full bg-white dark:bg-[#1F1F1F] border border-gray-300 dark:border-[#3A3A3A] rounded px-2.5 py-1 text-xs text-gray-900 dark:text-white"
                  >
                    {INSTALLATION_SECTORS.map((sector) => (
                      <option key={sector} value={sector} className="bg-white dark:bg-[#1E1E1E] text-gray-900 dark:text-white">{sector}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="overflow-x-auto">
                {activeIncentives.length === 0 ? (
                  <div className="py-6 text-center text-xs text-gray-500">
                    No matching project commissions found for {currentEmployee?.name} in {incentiveCyclePeriod.month}.
                  </div>
                ) : (
                  <table className="w-full text-left text-xs whitespace-nowrap">
                    <thead>
                      <tr className="text-gray-500 uppercase text-[10px] border-b border-gray-200 dark:border-[#2A2A2A]">
                        <th className="pb-2 px-2">Project</th>
                        <th className="pb-2 px-2">Client</th>
                        <th className="pb-2 px-2 text-right">kW</th>
                        <th className="pb-2 px-2 text-right">Commission</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-[#2A2A2A]">
                      {activeIncentives.map((inc, i) => (
                        <tr key={inc.id || i}>
                          <td className="py-2 px-2 font-medium text-gray-900 dark:text-white">{inc.project}</td>
                          <td className="py-2 px-2 text-gray-600 dark:text-gray-400">{inc.client}</td>
                          <td className="py-2 px-2 text-right font-mono text-gray-600 dark:text-gray-400">{inc.kw} kW</td>
                          <td className="py-2 px-2 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(inc.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>

          {/* Calculator Right Column */}
          <div className="lg:col-span-5">
            <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] rounded-xl p-5 shadow-sm sticky top-6 transition-colors">
              <h3 className="text-xs font-bold text-gray-900 dark:text-white uppercase tracking-wider pb-2 border-b border-gray-200 dark:border-[#333333]">
                Salary Calculator
              </h3>

              <div className="mt-3 space-y-2 text-xs">
                <div className="flex justify-between py-1">
                  <span className="text-gray-600 dark:text-gray-400">Basic Pay</span>
                  <span className="font-mono font-semibold text-gray-900 dark:text-white">{formatCurrency(calculatedEarnings.basic)}</span>
                </div>
                <div className="flex justify-between py-1 text-emerald-600 dark:text-emerald-400 font-semibold">
                  <span>Project Incentives</span>
                  <span className="font-mono">+{formatCurrency(calculatedEarnings.incentive)}</span>
                </div>
                <div className="flex justify-between py-1.5 border-t border-b border-gray-200 dark:border-[#2A2A2A] font-bold text-sm text-[#D4AF37]">
                  <span>Gross Earnings</span>
                  <span className="font-mono">{formatCurrency(calculatedEarnings.gross)}</span>
                </div>
                <div className="flex justify-between py-1 text-rose-600 dark:text-rose-400">
                  <span>Deductions</span>
                  <span className="font-mono">-{formatCurrency(totalDeductions)}</span>
                </div>

                <div className="p-4 rounded-xl bg-gray-50 dark:bg-gradient-to-br dark:from-[#1C180E] dark:to-[#121212] border-2 border-[#D4AF37] mt-3">
                  <div className="text-[10px] font-bold uppercase text-[#D4AF37]">Net Payable</div>
                  <div className="text-2xl font-bold font-mono text-[#D4AF37] mt-0.5">
                    {formatCurrency(netSalaryPayable)}
                  </div>
                  <div className="text-[10px] text-gray-500 mt-1 italic">
                    {numberToWordsINR(netSalaryPayable)}
                  </div>
                </div>

                <div className="pt-4 flex gap-2">
                  <button
                    onClick={() => handlePreviewSlip()}
                    disabled={!isPaymentDetailsComplete}
                    className="flex-1 py-2 rounded-lg bg-[#D4AF37] hover:bg-[#f2c94c] text-black font-bold text-xs shadow-sm disabled:opacity-50 transition-colors"
                  >
                    Preview Slip
                  </button>
                  <button
                    onClick={handleSaveSlipToHistory}
                    disabled={!isPaymentDetailsComplete}
                    className="flex-1 py-2 rounded-lg bg-gray-100 dark:bg-[#2A2A2A] text-gray-800 dark:text-white font-semibold text-xs border border-gray-300 dark:border-[#3A3A3A] disabled:opacity-50 transition-colors"
                  >
                    Save &amp; Archive
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. HISTORY */}
      {activeSubTab === 'history' && (
        <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] rounded-xl p-5 shadow-sm transition-colors">
          <div className="flex items-center justify-between pb-3 border-b border-gray-200 dark:border-[#333333] mb-4">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">Slip History ({history.length})</h3>
            <input
              type="text"
              placeholder="Search slip..."
              value={histSearch}
              onChange={e => setHistSearch(e.target.value)}
              className="bg-gray-50 dark:bg-[#121212] border border-gray-300 dark:border-[#333333] rounded-lg px-3 py-1 text-xs text-gray-900 dark:text-white"
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs whitespace-nowrap">
              <thead>
                <tr className="text-gray-500 dark:text-gray-400 uppercase text-[11px] border-b border-gray-200 dark:border-[#2A2A2A]">
                  <th className="py-2.5 px-3">Slip No.</th>
                  <th className="py-2.5 px-3">Employee</th>
                  <th className="py-2.5 px-3">Period</th>
                  <th className="py-2.5 px-3 text-right">Net Pay</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-[#2A2A2A]">
                {history
                  .filter(h => !histSearch || h.empName.toLowerCase().includes(histSearch.toLowerCase()))
                  .map((slip, i) => (
                    <tr key={slip.slipNo || i} className="hover:bg-gray-50 dark:hover:bg-[#252525]">
                      <td className="py-2.5 px-3 font-semibold text-[#D4AF37]">{slip.slipNo}</td>
                      <td className="py-2.5 px-3 font-medium text-gray-900 dark:text-white">{slip.empName}</td>
                      <td className="py-2.5 px-3 text-gray-600 dark:text-gray-400">{slip.month} {slip.fy}</td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(slip.net)}</td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          onClick={() => handlePreviewSlip(slip)}
                          className="px-2 py-1 rounded bg-gray-100 dark:bg-[#2A2A2A] text-[#D4AF37] font-semibold"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 4. SETTINGS */}
      {activeSubTab === 'settings' && (
        <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] rounded-xl p-5 shadow-sm transition-colors">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-3">Payroll Rules</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div>
              <label className="block text-gray-600 dark:text-gray-400 font-semibold mb-1">Slip Prefix</label>
              <input
                type="text"
                value={payrollSettings.slipPrefix}
                onChange={e => setPayrollSettings({ ...payrollSettings, slipPrefix: e.target.value })}
                className="w-full bg-gray-50 dark:bg-[#121212] border border-gray-300 dark:border-[#333333] rounded px-3 py-1.5 text-gray-900 dark:text-white"
              />
            </div>
          </div>
        </div>
      )}

      {/* Modal: A4 Salary Slip Preview */}
      {isPreviewModalOpen && previewSlipData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 overflow-y-auto">
          <div className="bg-white dark:bg-[#181818] border border-gray-200 dark:border-[#333333] rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-[#2A2A2A] bg-gray-50 dark:bg-[#1E1E1E]">
              <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider">
                Salary Slip — {previewSlipData.slipNo}
              </h3>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => window.print()}
                  className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-[#2A2A2A] text-gray-700 dark:text-gray-300 text-xs font-semibold flex items-center gap-1.5 border border-gray-300 dark:border-[#3A3A3A]"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print</span>
                </button>
                <button
                  onClick={handleDownloadPDF}
                  disabled={isPdfExporting}
                  className="px-3 py-1.5 rounded-lg bg-[#D4AF37] hover:bg-[#f2c94c] text-black text-xs font-bold flex items-center gap-1.5 shadow-sm disabled:opacity-50"
                >
                  <FileDown className="w-3.5 h-3.5" />
                  <span>{isPdfExporting ? 'Generating...' : 'Download PDF'}</span>
                </button>
                <button
                  onClick={() => setIsPreviewModalOpen(false)}
                  className="p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 bg-gray-100 dark:bg-[#0E0E0E] flex justify-center">
              <div
                id="salarySlipPrintContainer"
                style={{ width: '794px' }}
                className="bg-white text-[#1A202C] font-sans relative shadow-2xl"
              >
                {/* Header */}
                <div style={{ background: 'linear-gradient(135deg, #0F1C35 0%, #152238 50%, #1B2A4A 100%)' }} className="p-6 flex items-center justify-between gap-4 text-white border-b-2 border-[#D4AF37]">
                  <div className="flex items-center gap-4 flex-1">
                    {previewSlipData.companySnapshot.logo && (
                      <div className="w-16 h-16 bg-white rounded-lg p-1.5 flex items-center justify-center shrink-0 border border-[#D4AF37]/40 shadow-sm">
                        <Image src={previewSlipData.companySnapshot.logo} alt="Company Logo" width={60} height={60} className="max-h-full max-w-full object-contain" />
                      </div>
                    )}
                    <div>
                      <h1 className="text-base font-extrabold uppercase text-white font-serif">
                        {previewSlipData.companySnapshot.name}
                      </h1>
                      <p className="text-[11px] text-gray-300 mt-0.5">{previewSlipData.companySnapshot.address}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">Phone: {previewSlipData.companySnapshot.phone}</p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="px-3 py-1 bg-[#D4AF37] text-[#0F1C35] rounded font-black text-xs uppercase">
                      SALARY SLIP
                    </div>
                    <div className="text-xs font-bold text-[#D4AF37] mt-1">
                      {previewSlipData.month} {previewSlipData.fy}
                    </div>
                  </div>
                </div>

                {/* Info Bar */}
                <div style={{ background: 'linear-gradient(135deg, #D4AF37 0%, #E6C65A 50%, #D4AF37 100%)' }} className="px-6 py-2 grid grid-cols-4 gap-4 text-[#0F1C35]">
                  <div>
                    <div className="text-[9px] uppercase font-bold text-[#0F1C35]/80">Employee</div>
                    <div className="text-xs font-black">{previewSlipData.empName}</div>
                  </div>
                  <div>
                    <div className="text-[9px] uppercase font-bold text-[#0F1C35]/80">ID</div>
                    <div className="text-xs font-black font-mono">{previewSlipData.empEmpId}</div>
                  </div>
                  <div>
                    <div className="text-[9px] uppercase font-bold text-[#0F1C35]/80">Designation</div>
                    <div className="text-xs font-black">{previewSlipData.employeeSnapshot.designation}</div>
                  </div>
                  <div>
                    <div className="text-[9px] uppercase font-bold text-[#0F1C35]/80">Department</div>
                    <div className="text-xs font-black">{previewSlipData.employeeSnapshot.department}</div>
                  </div>
                </div>

                {/* Body Table */}
                <div className="p-6 space-y-4">
                  <div className="grid grid-cols-2 gap-4 text-xs">
                    <div className="border border-gray-200 rounded p-3 bg-gray-50/50">
                      <div className="font-bold text-gray-700 mb-2">Earnings</div>
                      <div className="flex justify-between py-1"><span>Basic Salary</span><span className="font-mono font-semibold">{formatCurrency(previewSlipData.earnings.basic)}</span></div>
                      <div className="flex justify-between py-1 text-emerald-700 font-semibold"><span>Project Incentives</span><span className="font-mono">+{formatCurrency(previewSlipData.earnings.incentive)}</span></div>
                      <div className="flex justify-between py-1.5 border-t border-gray-300 font-bold text-gray-900 mt-2"><span>Gross Earnings</span><span className="font-mono">{formatCurrency(previewSlipData.gross)}</span></div>
                    </div>
                    <div className="border border-gray-200 rounded p-3 bg-gray-50/50">
                      <div className="font-bold text-gray-700 mb-2">Deductions</div>
                      <div className="flex justify-between py-1 text-rose-600"><span>Professional Tax (PT)</span><span className="font-mono">-{formatCurrency(previewSlipData.deductions.pt)}</span></div>
                      <div className="flex justify-between py-1.5 border-t border-gray-300 font-bold text-rose-700 mt-2"><span>Total Deductions</span><span className="font-mono">-{formatCurrency(previewSlipData.totalDed)}</span></div>
                    </div>
                  </div>

                  <div style={{ background: 'linear-gradient(135deg, #0F1C35 0%, #152238 100%)' }} className="border-2 border-[#D4AF37] text-white rounded-xl p-4 flex items-center justify-between">
                    <div>
                      <div className="text-[10px] font-bold uppercase text-[#D4AF37]">NET SALARY PAYABLE</div>
                      <div className="text-xs text-gray-300 italic mt-0.5">{numberToWordsINR(previewSlipData.net)}</div>
                    </div>
                    <div className="text-2xl font-black font-mono text-[#D4AF37]">
                      {formatCurrency(previewSlipData.net)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
