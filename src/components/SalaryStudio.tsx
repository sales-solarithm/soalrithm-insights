'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import Image from 'next/image';
import {
  LayoutGrid,
  FileText,
  Clock,
  Users,
  Trophy,
  Building2,
  Settings as SettingsIcon,
  Plus,
  Upload,
  Download,
  Eye,
  Trash2,
  Printer,
  CheckCircle2,
  Search,
  Filter,
  X,
  Calendar,
  Edit,
  FileSpreadsheet,
  Banknote,
  Sparkles,
  ArrowUpRight,
  ShieldCheck,
  Receipt,
  Check,
  AlertCircle,
  FileDown
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import QRCode from 'qrcode';
import { useCompanySettings, CompanySettings, defaultCompanySettings } from '@/src/lib/useCompanySettings';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '@/src/lib/firebase';
import { COLLECTIONS } from '@/src/config/schema';

// Storage keys (Central global keys)
export const SALARY_STORAGE_KEYS = {
  employees: 'users',
  incentives: 'incentives',
  history: 'salaryHistory',
  draft: 'solarithm_salary_generator_draft_v1',
  settings: 'solarithm_salary_rules_v1',
  counter: 'solarithm_salary_slip_counter_v1'
};

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
  hra: number;
  conv: number;
  med: number;
  spl: number;
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
  // Populated only for split-scope designer credits, so the finalized
  // salary slip can write an anti-double-crediting payout record back onto
  // the source project for exactly these scopes.
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
  attendance: AttendanceData;
  earnings: {
    basic: number;
    hra: number;
    conv: number;
    med: number;
    spl: number;
    othAllow: number;
    incentive: number;
    ot: number;
    bonus: number;
    reimbursement: number;
    otherAllowance: number;
  };
  deductions: DeductionsData;
  incentivesList: IncentiveRecord[];
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
  onNavigateToGlobalSettings?: () => void;
}

// Number to Words Converter for Indian Currency Format
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
  return (result.trim() + ' Rupees Only');
}

export const SALARY_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export const parseSafeDate = (dateVal: any): Date | null => {
  if (!dateVal) return null;
  try {
    if (typeof dateVal?.toDate === 'function') {
      const d = dateVal.toDate();
      return isNaN(d.getTime()) ? null : d;
    }
    if (dateVal?.seconds !== undefined) {
      const d = new Date(dateVal.seconds * 1000);
      return isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(dateVal);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
};

export const formatSafeDate = (dateVal: any, formatType: 'input' | 'display' | 'slash' = 'display'): string => {
  const d = parseSafeDate(dateVal);
  if (!d) return '';
  try {
    if (formatType === 'input') {
      return d.toISOString().split('T')[0];
    }
    if (formatType === 'slash') {
      return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    }
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return '';
  }
};

/**
 * Checks if a project date falls into the specified Month and Financial Year (Indian FY: April - March)
 */
export const isProjectInMonthAndFY = (projectDate: Date | null, monthName: string, fyString: string): boolean => {
  if (!projectDate) return false;
  
  const monthIdx = SALARY_MONTHS.findIndex(m => m.toLowerCase() === monthName.toLowerCase());
  if (monthIdx === -1) return false;

  // Project month check
  if (projectDate.getMonth() !== monthIdx) {
    return false;
  }

  const projYear = projectDate.getFullYear();

  // Indian Financial Year: e.g. "2025-26" covers April 2025 to March 2026
  if (fyString.includes('-')) {
    const parts = fyString.split('-');
    const startYear = parseInt(parts[0], 10);
    const endYear = parts[1].length === 2 ? parseInt(parts[0].slice(0, 2) + parts[1], 10) : parseInt(parts[1], 10);
    
    // In India FY: April(3) - Dec(11) is startYear; Jan(0) - Mar(2) is endYear
    const expectedYear = monthIdx >= 3 ? startYear : endYear;
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
 * Normalizes a scope-combination key so Admin Console entries like
 * "Pre-Design+PVsyst", "predesign,pvsyst" or "pvsyst & preDesign" all resolve
 * to the same canonical string, regardless of casing, separator, or order.
 */
const normalizeComboKey = (raw: string): string =>
  String(raw || '')
    .toLowerCase()
    .split(/[+,&/]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .sort()
    .join('+');

/**
 * Split-scope commission lookup. For a designer who was assigned only a
 * subset of a project's deliverable scopes (via `project.assignedScopes`),
 * this matches their exact scope combination against a `commissionRules`
 * document's combo key and returns that preset rate directly -- individual
 * scope prices are never summed. Falls back to a zero amount (never a
 * partial guess) if no combo rule has been uploaded yet for that
 * combination, so missing Admin Console data is visible rather than silently
 * wrong.
 */
const getComboScopeCommission = (
  project: any,
  designerEmail: string,
  commissionRules: any[]
): { amount: number; scopeKeys: string[]; matched: boolean; comboFullAmount?: number } => {
  const assignedScopes = project?.assignedScopes;
  if (!assignedScopes || typeof assignedScopes !== 'object') {
    return { amount: 0, scopeKeys: [], matched: false };
  }

  const scopeKeys = Object.entries(assignedScopes)
    .filter(([, email]) => String(email || '').toLowerCase().trim() === designerEmail)
    .map(([scopeKey]) => scopeKey);

  if (scopeKeys.length === 0) {
    return { amount: 0, scopeKeys: [], matched: false };
  }

  const comboKey = normalizeComboKey(scopeKeys.join('+'));

  const matchedRule = (commissionRules || []).find((rule) => {
    const ruleRole = String(rule.role || '').toLowerCase().trim();
    if (ruleRole !== 'designer') return false;
    const ruleCombo = normalizeComboKey(rule.scopeCombination || rule.scope || rule.scopeOfWork || '');
    return ruleCombo === comboKey;
  });

  if (!matchedRule) {
    return { amount: 0, scopeKeys, matched: false };
  }

  const capacity = parseFloat(
    String(project.plantCapacity || project.systemCapacity || project.capacity || '0').replace(/[^\d.]/g, '')
  ) || 0;

  // Resolve the full preset combo amount for this exact scope set (flat or
  // capacity-tiered). This is the target total the designer should have
  // received for these scopes once fully paid -- never a sum of individual
  // scope prices.
  let comboFullAmount = 0;

  if (!Array.isArray(matchedRule.capacityRows) || matchedRule.capacityRows.length === 0) {
    comboFullAmount = Number(matchedRule.price || matchedRule.basePrice || matchedRule.amount || 0);
  } else {
    for (const row of matchedRule.capacityRows) {
      const range = String(row.capacityRange || '').toUpperCase().trim();
      let isMatch = false;

      if (range.includes('-')) {
        const [minStr, maxStr] = range.split('-');
        if (capacity >= Number(minStr) && capacity <= Number(maxStr)) isMatch = true;
      } else if (range.includes('ABOVE') || range.includes('>')) {
        if (capacity > Number(range.replace('ABOVE', '').replace('>', '').trim())) isMatch = true;
      } else if (range.includes('UP TO') || range.includes('<=')) {
        if (capacity <= Number(range.replace('UP TO', '').replace('<=', '').trim())) isMatch = true;
      } else if (range.includes('<')) {
        if (capacity < Number(range.replace('<', '').trim())) isMatch = true;
      }

      if (isMatch) {
        const price = Number(row.price || row.basePrice || 0);
        const type = String(row.priceType || '').toLowerCase();
        const rawCommission = type.includes('kw') ? price * capacity : price;
        const maxCap =
          matchedRule.maxCommission !== undefined && matchedRule.maxCommission !== null && String(matchedRule.maxCommission).trim() !== ''
            ? Number(matchedRule.maxCommission)
            : 0;
        comboFullAmount = !isNaN(maxCap) && maxCap > 0 ? Math.min(rawCommission, maxCap) : rawCommission;
        break;
      }
    }
  }

  // Anti-double-crediting: check what's already been marked paid for these
  // exact scopes on this project. `payoutHistory` is written back onto the
  // project doc only when a salary slip is finalized (see
  // handleSaveSlipToHistory) -- so previewing or regenerating a slip before
  // it's saved never locks anything in.
  const payoutHistory = project?.payoutHistory || {};
  const paidEntries = scopeKeys.map((k) => payoutHistory[k]).filter(Boolean);

  if (paidEntries.length === 0) {
    // Nothing paid yet for any of these scopes -- the full combo amount is owed.
    return { amount: comboFullAmount, scopeKeys, matched: true, comboFullAmount };
  }

  // Some or all of these scopes were already paid, possibly under a smaller
  // combo (a scope was added since -- a project upgrade). Credit only the
  // increase over what was already paid; never the full combo amount again.
  const alreadyPaidAmount = Math.max(...paidEntries.map((e: any) => Number(e?.amount) || 0));
  const delta = comboFullAmount - alreadyPaidAmount;
  return { amount: Math.max(0, delta), scopeKeys, matched: true, comboFullAmount };
};

/**
 * Maps a single project from central database into an Employee Incentive Record if matched
 */
export const getProjectIncentiveForEmployee = (
  project: any,
  employee: EmployeeRecord,
  monthName: string,
  fyString: string,
  commissionRules: any[] = []
): IncentiveRecord | null => {
  if (!project || !employee) return null;

  // 1. Date Extraction & Verification
  const pDate = parseSafeDate(
    project.createdAt ||
    project.date ||
    project.dateCreated ||
    project.projectDate ||
    project.completedDate ||
    project.createdDate
  );

  // If project has date, verify month & FY matching
  if (pDate && !isProjectInMonthAndFY(pDate, monthName, fyString)) {
    return null;
  }

  // 2. Normalize Employee Identifiers
  const empEmail = (employee.email || '').toLowerCase().trim();
  const empName = (employee.name || '').toLowerCase().trim();
  const empId = (employee.empId || '').toLowerCase().trim();
  const empMasterId = (employee.id || '').toLowerCase().trim();
  const empDept = (employee.department || '').toLowerCase().trim();
  const empDesig = (employee.designation || '').toLowerCase().trim();

  // 3. Normalize Project Assignment Fields
  const pDesEmail = String(project.designerEmail || project.designer_email || '').toLowerCase().trim();
  const pDesName = String(project.designer || project.designerName || project.assignedDesigner || '').toLowerCase().trim();
  const pDesId = String(project.designerId || '').toLowerCase().trim();

  const pSalesEmail = String(project.salesPersonEmail || project.sales_email || project.salesEmail || '').toLowerCase().trim();
  const pSalesName = String(project.salesPerson || project.salesPersonName || project.salesName || project.assignedSales || '').toLowerCase().trim();
  const pSalesId = String(project.salesId || '').toLowerCase().trim();

  const pAssignedEmail = String(project.assignedTo || project.staffEmail || project.employeeEmail || project.engineerEmail || '').toLowerCase().trim();
  const pAssignedName = String(project.assignedToName || project.staffName || project.employeeName || '').toLowerCase().trim();

  // 4. Role Matching Rules
  const isDesigner = Boolean(
    (empEmail && pDesEmail === empEmail) ||
    (empName && pDesName && (pDesName === empName || pDesName.includes(empName) || empName.includes(pDesName))) ||
    (empId && pDesId === empId) ||
    (empMasterId && pDesId === empMasterId)
  );

  const isSales = Boolean(
    (empEmail && pSalesEmail === empEmail) ||
    (empName && pSalesName && (pSalesName === empName || pSalesName.includes(empName) || empName.includes(pSalesName))) ||
    (empId && pSalesId === empId) ||
    (empMasterId && pSalesId === empMasterId)
  );

  const isAssigned = Boolean(
    (empEmail && pAssignedEmail === empEmail) ||
    (empName && pAssignedName && (pAssignedName === empName || pAssignedName.includes(empName) || empName.includes(pAssignedName)))
  );

  // Split-scope check: does this employee hold one or more (but not
  // necessarily all) of the project's assigned deliverable scopes? Checked
  // before the early-return guard since a split-scope designer may not be
  // the project's single legacy `designerEmail`.
  const isSplitScopeDesigner = Boolean(
    project.assignedScopes &&
    typeof project.assignedScopes === 'object' &&
    empEmail &&
    Object.values(project.assignedScopes).some((v: any) => String(v || '').toLowerCase().trim() === empEmail)
  );

  if (!isDesigner && !isSales && !isAssigned && !isSplitScopeDesigner) {
    return null;
  }

  // 5. Commission Amount Calculation
  let amount = 0;
  let roleLabel = '';

  const comboResult = isSplitScopeDesigner
    ? getComboScopeCommission(project, empEmail, commissionRules)
    : null;

  // For split-scope projects the designer's payout comes directly from the
  // preset combo rate for their exact scope set -- never the flat
  // project-level designerCommission, and never a manual sum of scopes.
  const desComm = isSplitScopeDesigner
    ? comboResult!.amount
    : Number(project.designerCommission ?? project.financials?.designerCommission ?? 0);
  const salesComm = Number(project.salesCommission ?? project.financials?.salesCommission ?? 0);

  if (isSplitScopeDesigner) {
    const scopeLabel = (comboResult!.scopeKeys || []).join(' + ') || 'Assigned Scope';
    if (isSales) {
      amount = desComm + salesComm;
      roleLabel = `Designer (${scopeLabel}) & Sales Commission`;
    } else {
      amount = desComm;
      roleLabel = `Designer Commission (${scopeLabel})`;
    }
  } else if (isDesigner && isSales) {
    amount = desComm + salesComm;
    roleLabel = 'Designer & Sales Commission';
  } else if (isDesigner) {
    amount = desComm;
    roleLabel = 'Designer Commission';
  } else if (isSales) {
    amount = salesComm;
    roleLabel = 'Sales Commission';
  } else if (isAssigned) {
    if (empDept.includes('design') || empDesig.includes('design')) {
      amount = desComm || Number(project.commission || project.incentive || 0);
      roleLabel = 'Designer Commission';
    } else if (empDept.includes('sales') || empDesig.includes('sales')) {
      amount = salesComm || Number(project.commission || project.incentive || 0);
      roleLabel = 'Sales Commission';
    } else {
      amount = Number(project.commission || project.incentive || desComm || salesComm || 0);
      roleLabel = 'Project Incentive';
    }
  }

  const dateDisplay = formatSafeDate(pDate || project.createdAt || project.date, 'slash') || formatSafeDate(new Date(), 'slash');
  const kw = parseFloat(String(project.plantCapacity || project.systemCapacity || project.capacity || '0').replace(/[^\d.]/g, '')) || 0;

  return {
    id: `PROJ_INC_${project.id || Math.random().toString(36).substring(2, 8)}`,
    date: dateDisplay,
    empId: employee.empId,
    empName: employee.name,
    project: project.projectName || project.name || project.title || 'Solar Project',
    client: project.clientName || project.client || project.matchedClient?.companyName || 'Corporate Client',
    kw,
    amount: Math.max(0, amount),
    role: roleLabel || 'Project Commission',
    projectId: project.id,
    status: project.status || 'Active',
    // Only populated for split-scope designer credits -- lets the salary
    // slip finalize step (handleSaveSlipToHistory) write an
    // anti-double-crediting payout record back onto the source project for
    // exactly these scopes.
    ...(isSplitScopeDesigner
      ? {
          scopeKeys: comboResult!.scopeKeys,
          comboFullAmount: comboResult!.comboFullAmount,
          designerEmail: empEmail
        }
      : {})
  };
};

export default function SalaryStudio({
  users: externalUsers = [],
  projects: externalProjects = [],
  commissionRules: externalCommissionRules = [],
  onNavigateToGlobalSettings
}: SalaryStudioProps) {
  // 1. Centralized Global Company Settings Hook
  const { companySettings, saveCompanySettings } = useCompanySettings();

  // Active sub-tab state
  const [activeSubTab, setActiveSubTab] = useState<SalaryStudioTab>('dashboard');
  const [activeSettingsTab, setActiveSettingsTab] = useState<'payroll' | 'slip' | 'tax' | 'currency'>('payroll');

  // Modal States
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);
  const [isEmpModalOpen, setIsEmpModalOpen] = useState(false);
  const [editingEmpId, setEditingEmpId] = useState<string | null>(null);
  const [previewSlipData, setPreviewSlipData] = useState<SalarySlipRecord | null>(null);

  // Toast State
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const showToast = (text: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 3500);
  };

  // 2. Persisted Employees state (merged with external users)
  const [customEmployees, setCustomEmployees] = useState<EmployeeRecord[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = localStorage.getItem(SALARY_STORAGE_KEYS.employees);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {
      console.error(e);
    }
    return [];
  });

  // Merge external master users from dashboard into available employees list
  const masterEmployees = useMemo<EmployeeRecord[]>(() => {
    const list: EmployeeRecord[] = [];
    const existingIds = new Set<string>();
    const existingEmails = new Set<string>();

    if (externalUsers && externalUsers.length > 0) {
      externalUsers.forEach((u, idx) => {
        const uEmail = (u.email || '').toLowerCase().trim();
        const uId = (u.empId || u.employeeId || u.id || '').toLowerCase().trim();
        const cleanId = u.id || `EMP_${idx + 1}`;
        const basicAmt = Number(u.basic || u.basicPay || u.baseSalary || 25000);
        const bankName = u.bankName || u.bank || 'HDFC Bank';
        const accNo = u.accountNumber || u.accNo || u.bankAccountNo || '';
        const ifsc = u.ifscCode || u.ifsc || '';
        const doj = u.dateOfJoining || u.doj || u.createdAt || '2026-01-01';
        const dob = u.dateOfBirth || u.dob || '';

        list.push({
          id: cleanId,
          empId: u.empId || u.employeeId || `SOL-${(u.name || 'EMP').substring(0, 3).toUpperCase()}-${String(idx + 1).padStart(3, '0')}`,
          name: u.name || u.displayName || u.employeeName || u.email?.split('@')[0] || 'Team Member',
          designation: u.designation || u.role || 'Associate',
          department: u.department || 'Solar Design & Engineering',
          doj: String(doj).split('T')[0],
          dob: dob ? String(dob).split('T')[0] : '',
          pan: u.pan || '',
          uan: u.uan || '',
          pfNo: u.pfNo || '',
          esicNo: u.esicNo || '',
          bank: bankName,
          bankName: bankName,
          accNo: accNo,
          accountNumber: accNo,
          ifsc: ifsc,
          ifscCode: ifsc,
          email: u.email || '',
          mobile: u.mobile || u.phone || '',
          basic: basicAmt,
          hra: Number(u.hra || Math.round(basicAmt * 0.4)),
          conv: Number(u.conv || 1600),
          med: Number(u.med || 500),
          spl: Number(u.spl || 1250),
          othAllow: Number(u.othAllow || 0),
          active: u.active !== false && u.status !== 'inactive'
        });

        if (uEmail) existingEmails.add(uEmail);
        if (uId) existingIds.add(uId);
      });
    }

    if (customEmployees && customEmployees.length > 0) {
      customEmployees.forEach(e => {
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

  // 3. Persisted Incentives
  const [incentives, setIncentives] = useState<IncentiveRecord[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = localStorage.getItem(SALARY_STORAGE_KEYS.incentives);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {
      console.error(e);
    }
    return [];
  });

  // 4. Persisted Salary Slips History
  const [history, setHistory] = useState<SalarySlipRecord[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = localStorage.getItem(SALARY_STORAGE_KEYS.history);
      if (raw) return JSON.parse(raw);
    } catch (e) {
      console.error(e);
    }
    return [];
  });

  // 5. Persisted Payroll & Slip Rules Settings
  const [payrollSettings, setPayrollSettings] = useState({
    pfRate: 12,
    pfEmpRate: 12,
    pfCeil: 15000,
    esicRate: 0.75,
    esicCeil: 21000,
    pt: 200,
    ptThresh: 10000,
    otFormula: 2,
    tdsRate: 0,
    slipPrefix: 'SOL-PAY',
    slipFmt: 'PREFIX-YYYY-SEQ',
    watermark: true,
    wmText: 'CONFIDENTIAL',
    currSym: '₹',
    currName: 'Rupees'
  });

  // Save employees, incentives, history to LocalStorage
  const saveEmployees = (updated: EmployeeRecord[]) => {
    setCustomEmployees(updated);
    if (typeof window !== 'undefined') {
      localStorage.setItem(SALARY_STORAGE_KEYS.employees, JSON.stringify(updated));
    }
  };

  const saveIncentives = (updated: IncentiveRecord[]) => {
    setIncentives(updated);
    if (typeof window !== 'undefined') {
      localStorage.setItem(SALARY_STORAGE_KEYS.incentives, JSON.stringify(updated));
    }
  };

  const saveHistory = (updated: SalarySlipRecord[]) => {
    setHistory(updated);
    if (typeof window !== 'undefined') {
      localStorage.setItem(SALARY_STORAGE_KEYS.history, JSON.stringify(updated));
      window.dispatchEvent(new CustomEvent('solarithm_salary_slips_updated', { detail: updated }));
    }
  };

  // ══════════════════════════════════════════════════════
  //   3. PERSISTENT SALARY GENERATOR STATE
  // ══════════════════════════════════════════════════════
  const [selectedEmpId, setSelectedEmpId] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const raw = localStorage.getItem(SALARY_STORAGE_KEYS.draft);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.selectedEmpId) return parsed.selectedEmpId;
        } catch (e) {}
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
        } catch (e) {}
      }
    }
    return 'June';
  });

  const [genFY, setGenFY] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const raw = localStorage.getItem(SALARY_STORAGE_KEYS.draft);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.genFY) return parsed.genFY;
        } catch (e) {}
      }
    }
    return '2025-26';
  });

  const [genPayDate, setGenPayDate] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const raw = localStorage.getItem(SALARY_STORAGE_KEYS.draft);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.genPayDate) return parsed.genPayDate;
        } catch (e) {}
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
        } catch (e) {}
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
        } catch (e) {}
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
        } catch (e) {}
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

  // Save draft on every change
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const draft = {
        selectedEmpId,
        genMonth,
        genFY,
        genPayDate,
        attendance,
        additionalEarnings,
        deductions
      };
      localStorage.setItem(SALARY_STORAGE_KEYS.draft, JSON.stringify(draft));
    }
  }, [selectedEmpId, genMonth, genFY, genPayDate, attendance, additionalEarnings, deductions]);

  // Selected Employee Lookup
  const currentEmployee = useMemo<EmployeeRecord | null>(() => {
    return (
      masterEmployees.find(e => e.id === selectedEmpId || e.empId === selectedEmpId) ||
      masterEmployees[0] || null
    );
  }, [masterEmployees, selectedEmpId]);

  // ── Auto-Fetch & Map Live Project Incentives from Central Projects Database ──
  const activeIncentives = useMemo<IncentiveRecord[]>(() => {
    if (!currentEmployee) return [];

    // 1. Live query central projects database
    const matchedFromProjects: IncentiveRecord[] = [];
    if (Array.isArray(externalProjects) && externalProjects.length > 0) {
      externalProjects.forEach(p => {
        const inc = getProjectIncentiveForEmployee(p, currentEmployee, genMonth, genFY, externalCommissionRules);
        if (inc) {
          matchedFromProjects.push(inc);
        }
      });
    }

    // If projects matched live from central DB, return them
    if (matchedFromProjects.length > 0) {
      return matchedFromProjects;
    }

    // 2. Fallback to any custom saved incentives for backwards compatibility
    return incentives.filter(inc => {
      const isEmpMatch = currentEmployee && (inc.empId === currentEmployee.empId || inc.empName.toLowerCase() === currentEmployee.name.toLowerCase());
      if (!isEmpMatch) return false;
      if (!genMonth) return true;
      const d = parseSafeDate(inc.date);
      if (!d) return true;
      const incMonth = d.toLocaleString('default', { month: 'long' });
      return incMonth.toLowerCase() === genMonth.toLowerCase();
    });
  }, [externalProjects, currentEmployee, genMonth, genFY, incentives, externalCommissionRules]);

  const totalIncentiveAmount = useMemo(() => {
    return activeIncentives.reduce((sum, inc) => sum + (Number(inc.amount) || 0), 0);
  }, [activeIncentives]);

  // Attendance ratio calculations
  const attendanceRatio = useMemo(() => {
    const total = attendance.totalDays > 0 ? attendance.totalDays : 26;
    const present = attendance.presentDays;
    return total > 0 ? Math.min(Math.max(present / total, 0), 1) : 1;
  }, [attendance.totalDays, attendance.presentDays]);

  // Calculated Earnings Components
  const calculatedEarnings = useMemo(() => {
    const basic = Math.round(((currentEmployee?.basic || 0)) * attendanceRatio);
    const hra = Math.round(((currentEmployee?.hra || 0)) * attendanceRatio);
    const conv = Math.round(((currentEmployee?.conv || 0)) * attendanceRatio);
    const med = Math.round(((currentEmployee?.med || 0)) * attendanceRatio);
    const spl = Math.round(((currentEmployee?.spl || 0)) * attendanceRatio);
    const othAllow = Math.round(((currentEmployee?.othAllow || 0)) * attendanceRatio);

    const totalDays = attendance.totalDays || 26;
    const hourlyRate = totalDays > 0 ? ((currentEmployee?.basic || 0)) / (totalDays * 8) : 0;
    const otPay = Math.round(hourlyRate * (attendance.otHours || 0) * payrollSettings.otFormula);

    const bonus = Number(additionalEarnings.bonus) || 0;
    const reimb = Number(additionalEarnings.reimbursement) || 0;
    const otherEarn = Number(additionalEarnings.otherAllowance) || 0;

    const gross = basic + hra + conv + med + spl + othAllow + totalIncentiveAmount + otPay + bonus + reimb + otherEarn;

    return {
      basic,
      hra,
      conv,
      med,
      spl,
      othAllow,
      incentive: totalIncentiveAmount,
      ot: otPay,
      bonus,
      reimbursement: reimb,
      otherAllowance: otherEarn,
      gross
    };
  }, [currentEmployee, attendanceRatio, attendance.totalDays, attendance.otHours, payrollSettings.otFormula, additionalEarnings, totalIncentiveAmount]);

  // Calculated Deductions
  const totalDeductions = useMemo(() => {
    return (
      (Number(deductions.pf) || 0) +
      (Number(deductions.esic) || 0) +
      (Number(deductions.pt) || 0) +
      (Number(deductions.tds) || 0) +
      (Number(deductions.advance) || 0) +
      (Number(deductions.other) || 0)
    );
  }, [deductions]);

  // Net Salary Payable
  const netSalaryPayable = useMemo(() => {
    return Math.max(0, calculatedEarnings.gross - totalDeductions);
  }, [calculatedEarnings.gross, totalDeductions]);

  // Generate unique sequential salary slip number
  const generateSlipNumber = () => {
    let ctr = 1;
    if (typeof window !== 'undefined') {
      const raw = localStorage.getItem(SALARY_STORAGE_KEYS.counter);
      ctr = (raw ? parseInt(raw, 10) : 0) + 1;
      localStorage.setItem(SALARY_STORAGE_KEYS.counter, String(ctr));
    }
    const year = new Date().getFullYear();
    const seq = String(ctr).padStart(4, '0');
    return `${payrollSettings.slipPrefix}-${year}-${seq}`;
  };

  // Build Salary Slip Snapshot Data
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
      attendance: { ...attendance },
      earnings: { ...calculatedEarnings },
      deductions: { ...deductions },
      incentivesList: [...activeIncentives],
      companySnapshot: {
        name: companySettings.companyName || 'SOLARITHM DESIGN & ENGINEERING CONSULTANCY',
        address: companySettings.address || 'Surat, Gujarat, India',
        gstin: companySettings.gstin || '',
        phone: companySettings.phone || '+91 94295 00746 / 63',
        email: companySettings.email || 'info.solarithm@gmail.com',
        web: 'www.solarithm.com',
        signName: 'Authorized Signatory',
        logo: companySettings.logo || null,
        sig: null,
        stamp: null
      },
      employeeSnapshot: currentEmployee ? { ...currentEmployee } : ({} as any)
    };
  };

  // Anti-double-crediting writeback: once a salary slip is actually
  // finalized (not just previewed), lock in which scopes were paid on each
  // split-scope project by writing a payoutHistory entry per scope key.
  // getComboScopeCommission checks this on every future run so the same
  // combo is never credited twice, and only the increase is credited if new
  // scopes are added to the project later.
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
          await updateDoc(doc(db, COLLECTIONS.PROJECTS, projectId), updates);
        } catch (e) {
          console.error(`Error writing payout history for project ${projectId}:`, e);
        }
      })
    );
  };

  // Save Salary Slip to History
  const handleSaveSlipToHistory = async () => {
    if (!currentEmployee) {
      showToast('Please select or create an employee first.', 'error');
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
      finalizedRecord = buildSalarySlipRecord();
      updatedHistory = [finalizedRecord, ...history];
      showToast(`Generated & saved Salary Slip #${finalizedRecord.slipNo}`, 'success');
    }
    saveHistory(updatedHistory);

    try {
      await commitPayoutHistoryForSlip(finalizedRecord);
    } catch (e) {
      console.error('Error committing payout history for slip:', e);
    }
  };

  // Trigger A4 Slip Preview
  const handlePreviewSlip = (customSlip?: SalarySlipRecord) => {
    if (!currentEmployee && !customSlip) {
      showToast('Please select an employee first.', 'error');
      return;
    }
    const slip = customSlip || buildSalarySlipRecord(history.find(h => currentEmployee && h.empEmpId === currentEmployee.empId && h.month === genMonth && h.fy === genFY)?.slipNo);
    setPreviewSlipData(slip);
    setIsPreviewModalOpen(true);
  };

  // QR Code canvas rendering inside slip preview modal
  const qrCanvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (isPreviewModalOpen && previewSlipData && qrCanvasRef.current) {
      const verificationPayload = JSON.stringify({
        slipNo: previewSlipData.slipNo,
        empId: previewSlipData.empEmpId,
        name: previewSlipData.empName,
        month: previewSlipData.month,
        fy: previewSlipData.fy,
        net: previewSlipData.net,
        co: previewSlipData.companySnapshot.name
      });
      QRCode.toCanvas(qrCanvasRef.current, verificationPayload, {
        width: 76,
        margin: 1,
        color: { dark: '#121212', light: '#FFFFFF' }
      }, (err) => {
        if (err) console.error('QR generation error', err);
      });
    }
  }, [isPreviewModalOpen, previewSlipData]);

  // Export PDF from DOM
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
      const pageHeight = 841.89;
      const margin = 24;
      const renderWidth = pageWidth - margin * 2;
      const renderHeight = (canvas.height * renderWidth) / canvas.width;

      if (renderHeight <= pageHeight - margin * 2) {
        pdf.addImage(imgData, 'PNG', margin, margin, renderWidth, renderHeight);
      } else {
        // Multi-page slicing if large incentive list
        let srcY = 0;
        const pageImgHeight = Math.floor(((pageHeight - margin * 2) * canvas.width) / renderWidth);
        while (srcY < canvas.height) {
          const sliceH = Math.min(pageImgHeight, canvas.height - srcY);
          const pageCanvas = document.createElement('canvas');
          pageCanvas.width = canvas.width;
          pageCanvas.height = sliceH;
          const ctx = pageCanvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(canvas, 0, srcY, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
            if (srcY > 0) pdf.addPage();
            pdf.addImage(pageCanvas.toDataURL('image/png'), 'PNG', margin, margin, renderWidth, (sliceH * renderWidth) / canvas.width);
          }
          srcY += pageImgHeight;
        }
      }

      const safeEmpName = (previewSlipData?.empName || 'Employee').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
      const safeMonth = (previewSlipData?.month || 'Month').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
      const safeYear = (previewSlipData?.fy || '2025-26').trim().replace(/[\/\\]/g, '-').replace(/[^a-zA-Z0-9_-]/g, '_');
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

  // Search and Filter States for History
  const [histSearch, setHistSearch] = useState('');
  const [histMonthFilter, setHistMonthFilter] = useState('');
  const [histFYFilter, setHistFYFilter] = useState('');

  // Mapped Live Project Incentive Database from Central Projects
  const allMappedProjectIncentives = useMemo(() => {
    if (!Array.isArray(externalProjects) || externalProjects.length === 0) {
      return [];
    }

    return externalProjects.map(p => {
      const pDate = parseSafeDate(
        p.createdAt || p.date || p.dateCreated || p.projectDate || p.completedDate || p.createdDate
      );
      const kw = parseFloat(String(p.plantCapacity || p.systemCapacity || p.capacity || '0').replace(/[^\d.]/g, '')) || 0;
      const desComm = Number(p.designerCommission ?? p.financials?.designerCommission ?? 0);
      const salesComm = Number(p.salesCommission ?? p.financials?.salesCommission ?? 0);

      const dName = p.designer || p.designerName || p.assignedDesigner || '';
      const dEmail = p.designerEmail || p.designer_email || '';
      const sName = p.salesPerson || p.salesPersonName || p.salesName || p.assignedSales || '';
      const sEmail = p.salesPersonEmail || p.sales_email || p.salesEmail || '';

      const month = pDate ? SALARY_MONTHS[pDate.getMonth()] : (p.month || '');
      let fy = '';
      if (pDate) {
        const y = pDate.getFullYear();
        const m = pDate.getMonth();
        const startY = m >= 3 ? y : y - 1;
        const endY = (startY + 1) % 100;
        fy = `${startY}-${String(endY).padStart(2, '0')}`;
      } else {
        fy = p.financialYear || p.fy || '2025-26';
      }

      return {
        projectId: p.id || 'PROJ',
        projectName: p.projectName || p.name || p.title || 'Solar Plant Project',
        clientName: p.clientName || p.client || p.matchedClient?.companyName || 'Corporate Client',
        date: formatSafeDate(pDate || p.createdAt || p.date, 'slash') || '—',
        dateObj: pDate,
        month,
        fy,
        kw,
        designerName: dName,
        designerEmail: dEmail,
        designerCommission: desComm,
        salesName: sName,
        salesEmail: sEmail,
        salesCommission: salesComm,
        totalCommission: desComm + salesComm,
        status: p.status || 'Active',
        rawProject: p
      };
    });
  }, [externalProjects]);

  const filteredHistory = useMemo(() => {
    return history.filter(h => {
      if (histMonthFilter && h.month !== histMonthFilter) return false;
      if (histFYFilter && h.fy !== histFYFilter) return false;
      if (histSearch) {
        const q = histSearch.toLowerCase();
        return (
          h.empName.toLowerCase().includes(q) ||
          h.slipNo.toLowerCase().includes(q) ||
          h.empEmpId.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [history, histSearch, histMonthFilter, histFYFilter]);

  return (
    <div id="sec-salary-studio" className="w-full space-y-6 text-white">
      {/* Toast Alert */}
      {toastMessage && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-2xl flex items-center space-x-3 text-xs font-semibold border backdrop-blur-md transition-all animate-bounce ${
            toastMessage.type === 'success'
              ? 'bg-emerald-950/90 text-emerald-300 border-emerald-500/40 shadow-emerald-950/50'
              : toastMessage.type === 'error'
              ? 'bg-rose-950/90 text-rose-300 border-rose-500/40 shadow-rose-950/50'
              : 'bg-[#1E1E1E]/95 text-[#D4AF37] border-[#D4AF37]/40 shadow-black/60'
          }`}
        >
          {toastMessage.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          )}
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* Module Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-[#121212] p-6 rounded-xl border border-[#333333]">
        <div className="flex items-center space-x-4">
          <div className="w-12 h-12 rounded-xl bg-[#1E1E1E] border border-[#333333] flex items-center justify-center shrink-0 text-[#D4AF37]">
            <Banknote className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-xl font-bold text-white tracking-wide">Salary Studio</h2>
            </div>
            <p className="text-sm text-gray-400 mt-0.5">
              Production payroll calculation, live project commission mapping, and automated salary slip engine.
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={() => setActiveSubTab('salary-generator')}
            className="flex items-center space-x-2 px-4 py-2 rounded-lg bg-[#D4AF37] hover:bg-[#f2c94c] text-black text-xs font-semibold shadow-lg shadow-[#D4AF37]/20 transition-colors"
          >
            <Plus className="w-4 h-4 text-black" />
            <span>Generate Slip</span>
          </button>
        </div>
      </div>

      {/* Horizontal Tabbed Navigation Bar */}
      <div className="bg-[#1E1E1E] border border-[#333333] rounded-xl p-1.5 shadow-lg overflow-x-auto">
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
                className={`flex items-center space-x-2.5 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-[#2A2A2A] text-[#D4AF37] border border-[#D4AF37]/40 shadow-sm'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-[#252525]'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-[#D4AF37]' : 'text-gray-400'}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* ══════════════════════════════════════════════════════
           1. SECTION: DASHBOARD (Overview)
      ═══════════════════════════════════════════════════════ */}
      {activeSubTab === 'dashboard' && (
        <div className="space-y-6">
          {/* Stat Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-[#1E1E1E] border border-[#333333] rounded-xl p-6 hover:border-[#D4AF37]/50 transition-all">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Total Employees</span>
                <div className="w-8 h-8 rounded-lg bg-[#D4AF37]/10 text-[#D4AF37] flex items-center justify-center">
                  <Users className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-3 text-2xl font-bold text-white font-mono">{masterEmployees.length}</div>
              <div className="text-[11px] text-gray-400 mt-1">Active on Master Payroll</div>
            </div>

            <div className="bg-[#1E1E1E] border border-[#333333] rounded-xl p-6 hover:border-[#D4AF37]/50 transition-all">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Slips Generated</span>
                <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                  <FileText className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-3 text-2xl font-bold text-emerald-400 font-mono">{history.length}</div>
              <div className="text-[11px] text-gray-400 mt-1">Archived Salary Slips</div>
            </div>

            <div className="bg-[#1E1E1E] border border-[#333333] rounded-xl p-6 hover:border-[#D4AF37]/50 transition-all">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Incentive Records</span>
                <div className="w-8 h-8 rounded-lg bg-[#D4AF37]/10 text-[#D4AF37] flex items-center justify-center">
                  <Trophy className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-3 text-2xl font-bold text-[#D4AF37] font-mono">{allMappedProjectIncentives.length}</div>
              <div className="text-[11px] text-gray-400 mt-1">Live Project Commissions</div>
            </div>

            <div className="bg-[#1E1E1E] border border-[#333333] rounded-xl p-6 hover:border-[#D4AF37]/50 transition-all">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Last Net Salary</span>
                <div className="w-8 h-8 rounded-lg bg-[#D4AF37]/10 text-[#D4AF37] flex items-center justify-center">
                  <Receipt className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-3 text-2xl font-bold text-[#D4AF37] font-mono">
                ₹{history[0]?.net ? history[0].net.toLocaleString('en-IN') : '0'}
              </div>
              <div className="text-[11px] text-gray-400 mt-1">Latest Pay Slip Net</div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Recent Slips Table */}
            <div className="lg:col-span-2 bg-[#1E1E1E] border border-[#333333] rounded-xl p-6 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between pb-3 border-b border-[#333333]">
                  <div className="flex items-center space-x-2">
                    <Clock className="w-4 h-4 text-[#D4AF37]" />
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider">Recent Salary Slips</h3>
                  </div>
                  <button
                    onClick={() => setActiveSubTab('history')}
                    className="text-xs text-[#D4AF37] hover:underline font-semibold flex items-center space-x-1"
                  >
                    <span>View All</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="overflow-x-auto mt-4">
                  {history.length === 0 ? (
                    <div className="py-8 text-center text-gray-400 text-xs">
                      No salary slips generated yet. Click &quot;Generate Slip&quot; to begin.
                    </div>
                  ) : (
                    <table className="w-full text-left text-xs whitespace-nowrap">
                      <thead>
                        <tr className="text-gray-400 uppercase border-b border-[#333333]">
                          <th className="pb-2.5 px-3 font-semibold">Slip No.</th>
                          <th className="pb-2.5 px-3 font-semibold">Employee</th>
                          <th className="pb-2.5 px-3 font-semibold">Period</th>
                          <th className="pb-2.5 px-3 font-semibold">Net Pay</th>
                          <th className="pb-2.5 px-3 font-semibold">Date</th>
                          <th className="pb-2.5 px-3 font-semibold text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#333333]">
                        {history.slice(0, 5).map(row => (
                          <tr key={row.slipNo} className="hover:bg-[#2A2A2A] transition-colors">
                            <td className="py-3 px-3 font-mono font-semibold text-[#D4AF37]">{row.slipNo}</td>
                            <td className="py-3 px-3 font-medium text-white">{row.empName}</td>
                            <td className="py-3 px-3 text-gray-300">
                              {row.month} {row.fy}
                            </td>
                            <td className="py-3 px-3 font-mono font-bold text-emerald-400">
                              ₹{row.net.toLocaleString('en-IN')}
                            </td>
                            <td className="py-3 px-3 text-gray-400">
                              {new Date(row.generated).toLocaleDateString('en-IN')}
                            </td>
                            <td className="py-3 px-3 text-right">
                              <button
                                onClick={() => handlePreviewSlip(row)}
                                className="px-2.5 py-1.5 rounded-lg bg-[#2A2A2A] hover:bg-[#333333] text-[#D4AF37] font-semibold text-xs inline-flex items-center space-x-1 border border-[#333333] hover:border-[#D4AF37]/50 transition-colors"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                <span>Preview</span>
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>

            {/* Quick Actions & Tips Card */}
            <div className="bg-[#1E1E1E] border border-[#333333] rounded-xl p-6 flex flex-col justify-between shadow-sm">
              <div>
                <div className="flex items-center space-x-2 pb-3 border-b border-[#333333] mb-4">
                  <Sparkles className="w-4 h-4 text-[#D4AF37]" />
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">Quick Actions</h3>
                </div>
                <div className="space-y-2.5">
                  <button
                    onClick={() => setActiveSubTab('salary-generator')}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#D4AF37] hover:bg-[#f2c94c] text-black text-xs font-bold shadow-md shadow-[#D4AF37]/20 transition-all"
                  >
                    <Plus className="w-4 h-4 text-black" />
                    <span>Generate Salary Slip</span>
                  </button>
                  <button
                    onClick={() => setActiveSubTab('history')}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#2A2A2A] hover:bg-[#333333] text-gray-200 hover:text-white border border-[#444444] text-xs font-semibold transition-colors"
                  >
                    <Clock className="w-4 h-4 text-[#D4AF37]" />
                    <span>View Slip History</span>
                  </button>
                  <button
                    onClick={() => setActiveSubTab('settings')}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#2A2A2A] hover:bg-[#333333] text-gray-200 hover:text-white border border-[#444444] text-xs font-semibold transition-colors"
                  >
                    <SettingsIcon className="w-4 h-4 text-[#D4AF37]" />
                    <span>Payroll Rules &amp; Format</span>
                  </button>
                </div>
              </div>

              <div className="mt-6 p-4 rounded-xl bg-[#121212] border border-[#333333] text-xs text-gray-400 space-y-1">
                <p className="font-semibold text-[#D4AF37]">Unified Data Sources:</p>
                <p>
                  Employee records and project commissions are directly synchronized from the centralized Employees and Projects modules.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
           2. SECTION: SALARY GENERATOR
      ═══════════════════════════════════════════════════════ */}
      {activeSubTab === 'salary-generator' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column (Inputs): col-span-7 */}
          <div className="lg:col-span-7 space-y-6">
            {/* Card 1: Employee & Period (Master Data Linked) */}
            <div className="bg-[#1E1E1E] border border-[#333333] rounded-xl p-6 shadow-sm">
              <div className="flex items-center space-x-2 pb-3 border-b border-[#333333] mb-4">
                <Users className="w-4 h-4 text-[#D4AF37]" />
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">Employee &amp; Period Selection</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                <div className="md:col-span-6">
                  <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                    Select Employee (Master Directory) *
                  </label>
                  <select
                    value={selectedEmpId}
                    onChange={e => setSelectedEmpId(e.target.value)}
                    className="w-full bg-[#1A1A1A] border border-[#333333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-[#D4AF37]"
                  >
                    {masterEmployees.length === 0 ? (
                      <option value="" className="bg-[#1E1E1E] text-gray-500">No employees found in directory</option>
                    ) : (
                      masterEmployees.map((e, index) => (
                        <option key={e.id ? `${e.id}-${index}` : `emp-${index}`} value={e.id} className="bg-[#1E1E1E] text-white">
                          {e.name} ({e.empId}) — {e.designation} [{e.department}]
                        </option>
                      ))
                    )}
                  </select>
                </div>
                <div className="md:col-span-3">
                  <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                    Salary Month *
                  </label>
                  <select
                    value={genMonth}
                    onChange={e => setGenMonth(e.target.value)}
                    className="w-full bg-[#1A1A1A] border border-[#333333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-[#D4AF37]"
                  >
                    {['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map(m => (
                      <option key={m} value={m} className="bg-[#1E1E1E] text-white">
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-3">
                  <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                    Financial Year *
                  </label>
                  <select
                    value={genFY}
                    onChange={e => setGenFY(e.target.value)}
                    className="w-full bg-[#1A1A1A] border border-[#333333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-[#D4AF37]"
                  >
                    <option value="2024-25" className="bg-[#1E1E1E] text-white">2024-25</option>
                    <option value="2025-26" className="bg-[#1E1E1E] text-white">2025-26</option>
                    <option value="2026-27" className="bg-[#1E1E1E] text-white">2026-27</option>
                  </select>
                </div>

                <div className="md:col-span-6">
                  <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                    Pay Settlement Date
                  </label>
                  <input
                    type="date"
                    value={genPayDate}
                    onChange={e => setGenPayDate(e.target.value)}
                    className="w-full bg-[#1A1A1A] border border-[#333333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-[#D4AF37]"
                  />
                </div>

                <div className="md:col-span-6">
                  {currentEmployee ? (
                    <div className="p-2.5 rounded-lg bg-[#D4AF37]/10 border border-[#D4AF37]/30 flex flex-col justify-center">
                      <div className="text-xs font-bold text-[#D4AF37]">{currentEmployee.name}</div>
                      <div className="text-[11px] text-gray-300">
                        {currentEmployee.designation} • {currentEmployee.department}
                      </div>
                      <div className="text-[10px] text-gray-400 font-mono mt-0.5">
                        Emp ID: {currentEmployee.empId} | Base: ₹{(currentEmployee.basic || 0).toLocaleString('en-IN')} | Bank: {currentEmployee.bank || 'N/A'}
                      </div>
                    </div>
                  ) : (
                    <div className="p-2.5 rounded-lg bg-[#141414] border border-[#333333] flex flex-col justify-center">
                      <div className="text-xs font-semibold text-gray-400">No Employee Selected</div>
                      <div className="text-[11px] text-gray-500">Directory contains no employee records.</div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Card 2: Attendance Summary */}
            <div className="bg-[#1E1E1E] border border-[#333333] rounded-xl p-6 shadow-sm">
              <div className="flex items-center space-x-2 pb-3 border-b border-[#333333] mb-4">
                <Calendar className="w-4 h-4 text-[#D4AF37]" />
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">Attendance Breakdown</h3>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
                <div>
                  <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Working Days</label>
                  <input
                    type="number"
                    value={attendance.totalDays}
                    onChange={e => setAttendance({ ...attendance, totalDays: Number(e.target.value) || 0 })}
                    className="w-full bg-[#1A1A1A] border border-[#333333] rounded px-2.5 py-1.5 text-xs text-white font-mono focus:border-[#D4AF37]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Present Days</label>
                  <input
                    type="number"
                    value={attendance.presentDays}
                    onChange={e => setAttendance({ ...attendance, presentDays: Number(e.target.value) || 0 })}
                    className="w-full bg-[#1A1A1A] border border-[#333333] rounded px-2.5 py-1.5 text-xs text-white font-mono focus:border-[#D4AF37]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Leave Days</label>
                  <input
                    type="number"
                    value={attendance.leaveDays}
                    onChange={e => setAttendance({ ...attendance, leaveDays: Number(e.target.value) || 0 })}
                    className="w-full bg-[#1A1A1A] border border-[#333333] rounded px-2.5 py-1.5 text-xs text-white font-mono focus:border-[#D4AF37]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Paid Leave</label>
                  <input
                    type="number"
                    value={attendance.paidLeave}
                    onChange={e => setAttendance({ ...attendance, paidLeave: Number(e.target.value) || 0 })}
                    className="w-full bg-[#1A1A1A] border border-[#333333] rounded px-2.5 py-1.5 text-xs text-white font-mono focus:border-[#D4AF37]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Overtime (Hrs)</label>
                  <input
                    type="number"
                    value={attendance.otHours}
                    onChange={e => setAttendance({ ...attendance, otHours: Number(e.target.value) || 0 })}
                    className="w-full bg-[#1A1A1A] border border-[#333333] rounded px-2.5 py-1.5 text-xs text-white font-mono focus:border-[#D4AF37]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">LOP Days</label>
                  <input
                    type="number"
                    value={attendance.lopDays}
                    onChange={e => setAttendance({ ...attendance, lopDays: Number(e.target.value) || 0 })}
                    className="w-full bg-[#1A1A1A] border border-[#333333] rounded px-2.5 py-1.5 text-xs text-white font-mono focus:border-[#D4AF37]"
                  />
                </div>
              </div>
            </div>

            {/* Card 3: Additional Earnings & Deductions */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Additional Earnings */}
              <div className="bg-[#1E1E1E] border border-[#333333] rounded-xl p-6 shadow-sm">
                <div className="flex items-center space-x-2 pb-3 border-b border-[#333333] mb-3">
                  <Plus className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider">Additional Earnings</h3>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Bonus (₹)</label>
                    <input
                      type="number"
                      value={additionalEarnings.bonus}
                      onChange={e => setAdditionalEarnings({ ...additionalEarnings, bonus: Number(e.target.value) || 0 })}
                      className="w-full bg-[#1A1A1A] border border-[#333333] rounded px-3 py-1.5 text-xs text-white font-mono focus:border-[#D4AF37]"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Reimbursement (₹)</label>
                    <input
                      type="number"
                      value={additionalEarnings.reimbursement}
                      onChange={e => setAdditionalEarnings({ ...additionalEarnings, reimbursement: Number(e.target.value) || 0 })}
                      className="w-full bg-[#1A1A1A] border border-[#333333] rounded px-3 py-1.5 text-xs text-white font-mono focus:border-[#D4AF37]"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Other Earnings (₹)</label>
                    <input
                      type="number"
                      value={additionalEarnings.otherAllowance}
                      onChange={e => setAdditionalEarnings({ ...additionalEarnings, otherAllowance: Number(e.target.value) || 0 })}
                      className="w-full bg-[#1A1A1A] border border-[#333333] rounded px-3 py-1.5 text-xs text-white font-mono focus:border-[#D4AF37]"
                    />
                  </div>
                </div>
              </div>

              {/* Deductions (Manual Entry) */}
              <div className="bg-[#1E1E1E] border border-[#333333] rounded-xl p-6 shadow-sm">
                <div className="flex items-center space-x-2 pb-3 border-b border-[#333333] mb-3">
                  <Trash2 className="w-4 h-4 text-rose-400" />
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider">Manual Deductions (₹)</h3>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">PF</label>
                    <input
                      type="number"
                      value={deductions.pf}
                      onChange={e => setDeductions({ ...deductions, pf: Number(e.target.value) || 0 })}
                      className="w-full bg-[#1A1A1A] border border-[#333333] rounded px-2 py-1.5 text-xs text-white font-mono focus:border-[#D4AF37]"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">ESIC</label>
                    <input
                      type="number"
                      value={deductions.esic}
                      onChange={e => setDeductions({ ...deductions, esic: Number(e.target.value) || 0 })}
                      className="w-full bg-[#1A1A1A] border border-[#333333] rounded px-2 py-1.5 text-xs text-white font-mono focus:border-[#D4AF37]"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Prof. Tax</label>
                    <input
                      type="number"
                      value={deductions.pt}
                      onChange={e => setDeductions({ ...deductions, pt: Number(e.target.value) || 0 })}
                      className="w-full bg-[#1A1A1A] border border-[#333333] rounded px-2 py-1.5 text-xs text-white font-mono focus:border-[#D4AF37]"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">TDS</label>
                    <input
                      type="number"
                      value={deductions.tds}
                      onChange={e => setDeductions({ ...deductions, tds: Number(e.target.value) || 0 })}
                      className="w-full bg-[#1A1A1A] border border-[#333333] rounded px-2 py-1.5 text-xs text-white font-mono focus:border-[#D4AF37]"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Advance</label>
                    <input
                      type="number"
                      value={deductions.advance}
                      onChange={e => setDeductions({ ...deductions, advance: Number(e.target.value) || 0 })}
                      className="w-full bg-[#1A1A1A] border border-[#333333] rounded px-2 py-1.5 text-xs text-white font-mono focus:border-[#D4AF37]"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Other</label>
                    <input
                      type="number"
                      value={deductions.other}
                      onChange={e => setDeductions({ ...deductions, other: Number(e.target.value) || 0 })}
                      className="w-full bg-[#1A1A1A] border border-[#333333] rounded px-2 py-1.5 text-xs text-white font-mono focus:border-[#D4AF37]"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Incentives for selected period (Live Central Projects Mapping) */}
            <div className="bg-[#1E1E1E] border border-[#333333] rounded-xl p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#333333] mb-3">
                <div className="flex items-center space-x-2">
                  <Trophy className="w-4 h-4 text-[#D4AF37]" />
                  <div>
                    <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                      Live Project Incentives ({genMonth} {genFY})
                    </h3>
                    <p className="text-[10px] text-gray-400 flex items-center gap-1 mt-0.5">
                      <Sparkles className="w-3 h-3 text-emerald-400" />
                      Auto-mapped from Central Projects Database
                    </p>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="px-2.5 py-1 rounded bg-emerald-500/10 border border-emerald-500/30 text-xs font-bold text-emerald-400 font-mono">
                    Total: ₹{totalIncentiveAmount.toLocaleString('en-IN')}
                  </span>
                  <span className="text-[11px] text-gray-400 font-mono">
                    ({activeIncentives.length} {activeIncentives.length === 1 ? 'project' : 'projects'})
                  </span>
                </div>
              </div>
              <div className="overflow-x-auto">
                {activeIncentives.length === 0 ? (
                  <div className="py-6 px-4 text-center rounded-lg bg-[#181818] border border-[#2A2A2A]/60">
                    <AlertCircle className="w-6 h-6 text-gray-500 mx-auto mb-2 opacity-60" />
                    <p className="text-xs font-medium text-gray-300">
                      No active project commissions found for <span className="text-[#D4AF37] font-semibold">{currentEmployee?.name}</span> in {genMonth} {genFY}.
                    </p>
                    <p className="text-[11px] text-gray-500 mt-1 max-w-md mx-auto">
                      Any solar projects assigned to this employee (as Designer or Sales) in the Central Database during this billing period will automatically calculate into gross earnings.
                    </p>
                  </div>
                ) : (
                  <table className="w-full text-left text-xs whitespace-nowrap">
                    <thead>
                      <tr className="text-gray-400 uppercase text-[10px] border-b border-[#2A2A2A]">
                        <th className="pb-2 px-2 font-semibold">Date</th>
                        <th className="pb-2 px-2 font-semibold">Project</th>
                        <th className="pb-2 px-2 font-semibold">Client</th>
                        <th className="pb-2 px-2 font-semibold">Role / Type</th>
                        <th className="pb-2 px-2 font-semibold text-right">Capacity</th>
                        <th className="pb-2 px-2 font-semibold text-right">Commission</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#2A2A2A]">
                      {activeIncentives.map((inc, index) => (
                        <tr key={inc.id ? `${inc.id}-${index}` : `inc-${index}`} className="hover:bg-[#1E1E1E] transition-colors">
                          <td className="py-2.5 px-2 text-gray-300">{inc.date}</td>
                          <td className="py-2.5 px-2 font-medium text-white">
                            <div>{inc.project}</div>
                            {inc.projectId && (
                              <div className="text-[10px] text-gray-500 font-mono">{inc.projectId}</div>
                            )}
                          </td>
                          <td className="py-2.5 px-2 text-gray-400">{inc.client}</td>
                          <td className="py-2.5 px-2">
                            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-[#1E1E1E] text-amber-300 border border-[#333333]">
                              {inc.role || 'Project Incentive'}
                            </span>
                          </td>
                          <td className="py-2.5 px-2 font-mono text-gray-300 text-right">{inc.kw} kWp</td>
                          <td className="py-2.5 px-2 font-mono font-bold text-emerald-400 text-right">
                            ₹{inc.amount.toLocaleString('en-IN')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>

          {/* Right Column: Live Calculator & Preview Panel (col-span-5) */}
          <div className="lg:col-span-5">
            <div className="bg-[#1E1E1E] border border-[#333333] rounded-xl p-6 shadow-sm sticky top-6">
              <div className="flex items-center space-x-2 pb-3 border-b border-[#333333]">
                <Receipt className="w-4 h-4 text-[#D4AF37]" />
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">Salary Calculator (Live)</h3>
              </div>

              {/* Earnings Breakdown */}
              <div className="mt-4 space-y-2 text-xs">
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider pb-1 border-b border-[#2A2A2A]">
                  Earnings Breakdown
                </div>
                <div className="flex justify-between py-1 text-gray-300">
                  <span>Basic Salary</span>
                  <span className="font-mono text-white">₹{calculatedEarnings.basic.toLocaleString('en-IN')}</span>
                </div>
                <div className="flex justify-between py-1 text-gray-300">
                  <span>HRA</span>
                  <span className="font-mono text-white">₹{calculatedEarnings.hra.toLocaleString('en-IN')}</span>
                </div>
                <div className="flex justify-between py-1 text-gray-300">
                  <span>Conveyance Allowance</span>
                  <span className="font-mono text-white">₹{calculatedEarnings.conv.toLocaleString('en-IN')}</span>
                </div>
                <div className="flex justify-between py-1 text-gray-300">
                  <span>Medical Allowance</span>
                  <span className="font-mono text-white">₹{calculatedEarnings.med.toLocaleString('en-IN')}</span>
                </div>
                <div className="flex justify-between py-1 text-gray-300">
                  <span>Special Allowance</span>
                  <span className="font-mono text-white">₹{calculatedEarnings.spl.toLocaleString('en-IN')}</span>
                </div>
                {calculatedEarnings.incentive > 0 && (
                  <div className="flex justify-between py-1 text-emerald-400 font-semibold">
                    <span>Project Incentives</span>
                    <span className="font-mono">+₹{calculatedEarnings.incentive.toLocaleString('en-IN')}</span>
                  </div>
                )}
                {calculatedEarnings.ot > 0 && (
                  <div className="flex justify-between py-1 text-emerald-400 font-semibold">
                    <span>Overtime Pay</span>
                    <span className="font-mono">+₹{calculatedEarnings.ot.toLocaleString('en-IN')}</span>
                  </div>
                )}
                {calculatedEarnings.bonus > 0 && (
                  <div className="flex justify-between py-1 text-emerald-400 font-semibold">
                    <span>Bonus</span>
                    <span className="font-mono">+₹{calculatedEarnings.bonus.toLocaleString('en-IN')}</span>
                  </div>
                )}
                {calculatedEarnings.reimbursement > 0 && (
                  <div className="flex justify-between py-1 text-emerald-400 font-semibold">
                    <span>Reimbursement</span>
                    <span className="font-mono">+₹{calculatedEarnings.reimbursement.toLocaleString('en-IN')}</span>
                  </div>
                )}
                <div className="flex justify-between py-2 border-t border-b border-[#2A2A2A] font-bold text-sm text-[#D4AF37]">
                  <span>Gross Earnings</span>
                  <span className="font-mono">₹{calculatedEarnings.gross.toLocaleString('en-IN')}</span>
                </div>

                {/* Deductions Breakdown */}
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider pt-2 pb-1 border-b border-[#2A2A2A]">
                  Deductions
                </div>
                {deductions.pt > 0 && (
                  <div className="flex justify-between py-1 text-gray-300">
                    <span>Professional Tax (PT)</span>
                    <span className="font-mono text-rose-400">-₹{deductions.pt.toLocaleString('en-IN')}</span>
                  </div>
                )}
                {deductions.pf > 0 && (
                  <div className="flex justify-between py-1 text-gray-300">
                    <span>Provident Fund (PF)</span>
                    <span className="font-mono text-rose-400">-₹{deductions.pf.toLocaleString('en-IN')}</span>
                  </div>
                )}
                {deductions.esic > 0 && (
                  <div className="flex justify-between py-1 text-gray-300">
                    <span>ESIC</span>
                    <span className="font-mono text-rose-400">-₹{deductions.esic.toLocaleString('en-IN')}</span>
                  </div>
                )}
                {deductions.tds > 0 && (
                  <div className="flex justify-between py-1 text-gray-300">
                    <span>TDS / Income Tax</span>
                    <span className="font-mono text-rose-400">-₹{deductions.tds.toLocaleString('en-IN')}</span>
                  </div>
                )}
                {deductions.advance > 0 && (
                  <div className="flex justify-between py-1 text-gray-300">
                    <span>Advance Recovery</span>
                    <span className="font-mono text-rose-400">-₹{deductions.advance.toLocaleString('en-IN')}</span>
                  </div>
                )}
                {deductions.other > 0 && (
                  <div className="flex justify-between py-1 text-gray-300">
                    <span>Other Deductions</span>
                    <span className="font-mono text-rose-400">-₹{deductions.other.toLocaleString('en-IN')}</span>
                  </div>
                )}
                <div className="flex justify-between py-2 border-t border-b border-[#2A2A2A] font-bold text-xs text-rose-400">
                  <span>Total Deductions</span>
                  <span className="font-mono">-₹{totalDeductions.toLocaleString('en-IN')}</span>
                </div>

                {/* NET PAYABLE */}
                <div className="p-4 rounded-xl bg-gradient-to-br from-[#1C180E] to-[#121212] border-2 border-[#D4AF37] mt-4 shadow-lg">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[#D4AF37]">
                    NET SALARY PAYABLE
                  </div>
                  <div className="text-2xl font-bold font-mono text-[#D4AF37] mt-1">
                    ₹{netSalaryPayable.toLocaleString('en-IN')}
                  </div>
                  <div className="text-[10px] text-gray-400 italic mt-1">
                    {numberToWordsINR(netSalaryPayable)}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-4">
                  <button
                    onClick={() => handlePreviewSlip()}
                    className="py-2.5 px-3 rounded-lg bg-[#D4AF37] hover:bg-[#f2c94c] text-black font-bold text-xs flex items-center justify-center space-x-1.5 shadow-md shadow-[#D4AF37]/20 transition-all"
                  >
                    <Eye className="w-4 h-4" />
                    <span>Preview Slip</span>
                  </button>
                  <button
                    onClick={handleSaveSlipToHistory}
                    className="py-2.5 px-3 rounded-lg bg-[#2A2A2A] hover:bg-[#333333] text-white font-semibold text-xs flex items-center justify-center space-x-1.5 border border-[#3A3A3A] transition-all"
                  >
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>Save &amp; Archive</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
           3. SECTION: HISTORY
      ═══════════════════════════════════════════════════════ */}
      {activeSubTab === 'history' && (
        <div className="space-y-4">
          <div className="bg-[#1E1E1E] border border-[#333333] rounded-xl p-6 flex flex-wrap items-center justify-between gap-4 shadow-sm">
            <div className="flex items-center space-x-3 flex-1 min-w-[260px]">
              <Search className="w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={histSearch}
                onChange={e => setHistSearch(e.target.value)}
                placeholder="Search salary slips by employee, slip number, ID..."
                className="bg-transparent border-none text-xs text-white placeholder-gray-500 focus:outline-none w-full"
              />
            </div>
            <div className="flex items-center space-x-2">
              <select
                value={histMonthFilter}
                onChange={e => setHistMonthFilter(e.target.value)}
                className="bg-[#1A1A1A] border border-[#333333] rounded-lg px-3 py-1.5 text-xs text-gray-300 focus:border-[#D4AF37]"
              >
                <option value="">All Months</option>
                {['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <select
                value={histFYFilter}
                onChange={e => setHistFYFilter(e.target.value)}
                className="bg-[#1A1A1A] border border-[#333333] rounded-lg px-3 py-1.5 text-xs text-gray-300 focus:border-[#D4AF37]"
              >
                <option value="">All FY</option>
                <option value="2024-25">2024-25</option>
                <option value="2025-26">2025-26</option>
                <option value="2026-27">2026-27</option>
              </select>
            </div>
          </div>

          <div className="bg-[#1E1E1E] border border-[#333333] rounded-xl p-6 overflow-x-auto shadow-sm">
            {filteredHistory.length === 0 ? (
              <div className="text-center py-10 border border-dashed border-[#333333] rounded-lg text-gray-400 text-xs">
                No salary slips found in history.
              </div>
            ) : (
              <table className="w-full text-left text-xs whitespace-nowrap">
                <thead>
                  <tr className="text-gray-400 uppercase border-b border-[#2A2A2A]">
                    <th className="pb-3 px-3 font-semibold">Slip No.</th>
                    <th className="pb-3 px-3 font-semibold">Employee</th>
                    <th className="pb-3 px-3 font-semibold">Emp ID</th>
                    <th className="pb-3 px-3 font-semibold">Month</th>
                    <th className="pb-3 px-3 font-semibold">FY</th>
                    <th className="pb-3 px-3 font-semibold">Gross</th>
                    <th className="pb-3 px-3 font-semibold">Deductions</th>
                    <th className="pb-3 px-3 font-semibold">Net Pay</th>
                    <th className="pb-3 px-3 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#2A2A2A]">
                  {filteredHistory.map((slip, index) => (
                    <tr key={slip.slipNo ? `${slip.slipNo}-${index}` : `slip-${index}`} className="hover:bg-[#1E1E1E]">
                      <td className="py-3.5 px-3 font-mono font-bold text-[#D4AF37]">{slip.slipNo}</td>
                      <td className="py-3.5 px-3 font-medium text-white">{slip.empName}</td>
                      <td className="py-3.5 px-3 font-mono text-gray-400">{slip.empEmpId}</td>
                      <td className="py-3.5 px-3 text-gray-300">{slip.month}</td>
                      <td className="py-3.5 px-3 text-gray-300">{slip.fy}</td>
                      <td className="py-3.5 px-3 font-mono text-gray-300">₹{slip.gross.toLocaleString('en-IN')}</td>
                      <td className="py-3.5 px-3 font-mono text-rose-400">₹{slip.totalDed.toLocaleString('en-IN')}</td>
                      <td className="py-3.5 px-3 font-mono font-bold text-emerald-400">₹{slip.net.toLocaleString('en-IN')}</td>
                      <td className="py-3.5 px-3 text-right">
                        <div className="inline-flex items-center space-x-2">
                          <button
                            onClick={() => handlePreviewSlip(slip)}
                            className="p-1.5 rounded bg-[#2A2A2A] hover:bg-[#333333] text-[#D4AF37] border border-[#3A3A3A]"
                            title="Preview Salary Slip"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => {
                              if (confirm(`Delete slip ${slip.slipNo}?`)) {
                                const next = history.filter(h => h.slipNo !== slip.slipNo);
                                saveHistory(next);
                                showToast(`Deleted slip ${slip.slipNo}`, 'info');
                              }
                            }}
                            className="p-1.5 rounded bg-[#2A2A2A] hover:bg-[#333333] text-rose-400 border border-[#3A3A3A]"
                            title="Delete Record"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
           4. SECTION: SETTINGS (Payroll Rules)
      ═══════════════════════════════════════════════════════ */}
      {activeSubTab === 'settings' && (
        <div className="bg-[#1E1E1E] border border-[#333333] rounded-xl p-6 shadow-sm space-y-6">
          <div className="flex items-center space-x-2 pb-4 border-b border-[#333333]">
            <SettingsIcon className="w-5 h-5 text-[#D4AF37]" />
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">Payroll &amp; Slip Configuration</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs">
            <div>
              <label className="block text-gray-400 uppercase font-semibold mb-1">Slip Number Prefix</label>
              <input
                type="text"
                value={payrollSettings.slipPrefix}
                onChange={e => setPayrollSettings({ ...payrollSettings, slipPrefix: e.target.value })}
                className="w-full bg-[#121212] border border-[#333333] rounded-lg px-3 py-2 text-white font-mono focus:border-[#D4AF37] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-gray-400 uppercase font-semibold mb-1">Overtime Multiplier</label>
              <input
                type="number"
                step="0.5"
                value={payrollSettings.otFormula}
                onChange={e => setPayrollSettings({ ...payrollSettings, otFormula: Number(e.target.value) || 2 })}
                className="w-full bg-[#121212] border border-[#333333] rounded-lg px-3 py-2 text-white font-mono focus:border-[#D4AF37] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-gray-400 uppercase font-semibold mb-1">Watermark Text</label>
              <input
                type="text"
                value={payrollSettings.wmText}
                onChange={e => setPayrollSettings({ ...payrollSettings, wmText: e.target.value })}
                className="w-full bg-[#121212] border border-[#333333] rounded-lg px-3 py-2 text-white font-mono focus:border-[#D4AF37] focus:outline-none"
              />
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
           MODAL: HIGH-FIDELITY A4 SALARY SLIP PREVIEW
      ═══════════════════════════════════════════════════════ */}
      {isPreviewModalOpen && previewSlipData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 overflow-y-auto">
          <div className="bg-[#181818] border border-[#333333] rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Modal Header Bar */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#2A2A2A] bg-[#1E1E1E]">
              <div className="flex items-center space-x-2">
                <FileText className="w-5 h-5 text-[#D4AF37]" />
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                  Salary Slip Preview — {previewSlipData.slipNo}
                </h3>
              </div>
              <div className="flex items-center space-x-3">
                <button
                  onClick={() => window.print()}
                  className="px-3 py-1.5 rounded-lg bg-[#2A2A2A] hover:bg-[#333333] text-gray-300 text-xs font-semibold flex items-center space-x-1.5 border border-[#3A3A3A]"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print</span>
                </button>
                <button
                  onClick={handleDownloadPDF}
                  disabled={isPdfExporting}
                  className="px-3 py-1.5 rounded-lg bg-[#D4AF37] hover:bg-[#f2c94c] text-black text-xs font-bold flex items-center space-x-1.5 shadow-md shadow-[#D4AF37]/20 disabled:opacity-50"
                >
                  <FileDown className="w-3.5 h-3.5" />
                  <span>{isPdfExporting ? 'Generating PDF...' : 'Download PDF'}</span>
                </button>
                <button
                  onClick={() => setIsPreviewModalOpen(false)}
                  className="p-1.5 rounded-lg hover:bg-[#2A2A2A] text-gray-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Scrollable Printable A4 Slip Container */}
            <div className="flex-1 overflow-y-auto p-6 bg-[#0E0E0E] flex justify-center">
              <div
                id="salarySlipPrintContainer"
                style={{ width: '794px', minHeight: '1123px' }}
                className="bg-white text-[#1A202C] font-sans relative shadow-2xl select-text"
              >
                {/* ── 1. SLIP HEADER ── */}
                <div style={{ background: 'linear-gradient(135deg, #0F1C35 0%, #152238 50%, #1B2A4A 100%)' }} className="p-6 flex items-center justify-between gap-4 text-white border-b-2 border-[#D4AF37]">
                  <div className="flex items-center gap-4 flex-1">
                    {companySettings.logo ? (
                      <div className="w-16 h-16 bg-white/95 rounded-lg p-1.5 flex items-center justify-center shrink-0 border border-[#D4AF37]/40 shadow-sm">
                        <Image src={companySettings.logo} alt="Company Logo" width={60} height={60} className="max-h-full max-w-full object-contain" />
                      </div>
                    ) : (
                      <div className="w-14 h-14 bg-[#1B2A4A] border border-[#D4AF37] rounded-lg flex items-center justify-center font-bold text-2xl text-[#D4AF37] shrink-0 shadow-md">
                        ☀️
                      </div>
                    )}
                    <div>
                      <h1 className="text-base font-extrabold uppercase tracking-wide text-white font-serif flex items-center gap-2">
                        <span>{previewSlipData.companySnapshot.name}</span>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-[#D4AF37]/20 border border-[#D4AF37]/60 text-[#D4AF37] font-mono font-normal">
                          SOLARITHM LUXURY SERIES
                        </span>
                      </h1>
                      <p className="text-[11px] text-gray-300 mt-0.5">{previewSlipData.companySnapshot.address}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        {previewSlipData.companySnapshot.gstin ? `GSTIN: ${previewSlipData.companySnapshot.gstin} | ` : ''}
                        Phone: {previewSlipData.companySnapshot.phone} | Email: {previewSlipData.companySnapshot.email}
                      </p>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <div className="inline-block px-3 py-1 bg-[#D4AF37] text-[#0F1C35] rounded font-black text-xs tracking-widest uppercase shadow-md">
                      PAYSLIP / SALARY SLIP
                    </div>
                    <div className="text-xs font-bold text-[#D4AF37] mt-1.5">
                      {previewSlipData.month} {previewSlipData.fy}
                    </div>
                    <div className="text-[10px] text-gray-300 font-mono mt-0.5">
                      Slip Ref: {previewSlipData.slipNo}
                    </div>
                  </div>
                </div>

                {/* ── 2. GOLD INFO BAND ── */}
                <div style={{ background: 'linear-gradient(135deg, #D4AF37 0%, #E6C65A 50%, #D4AF37 100%)' }} className="px-6 py-2.5 grid grid-cols-4 gap-4 text-[#0F1C35] border-b border-[#0F1C35]/20 shadow-sm">
                  <div>
                    <div className="text-[9px] uppercase font-extrabold tracking-wider text-[#0F1C35]/80">Employee Name</div>
                    <div className="text-xs font-black text-[#0F1C35]">{previewSlipData.empName}</div>
                  </div>
                  <div>
                    <div className="text-[9px] uppercase font-extrabold tracking-wider text-[#0F1C35]/80">Employee ID</div>
                    <div className="text-xs font-black font-mono text-[#0F1C35]">{previewSlipData.empEmpId}</div>
                  </div>
                  <div>
                    <div className="text-[9px] uppercase font-extrabold tracking-wider text-[#0F1C35]/80">Designation</div>
                    <div className="text-xs font-black text-[#0F1C35]">{previewSlipData.employeeSnapshot.designation}</div>
                  </div>
                  <div>
                    <div className="text-[9px] uppercase font-extrabold tracking-wider text-[#0F1C35]/80">Department</div>
                    <div className="text-xs font-black text-[#0F1C35]">{previewSlipData.employeeSnapshot.department}</div>
                  </div>
                </div>

                {/* ── 3. DARK INFO BAND ── */}
                <div style={{ background: 'linear-gradient(135deg, #0F1C35 0%, #17243E 100%)' }} className="px-6 py-2.5 grid grid-cols-5 gap-3 text-white text-[11px] border-b border-gray-200">
                  <div>
                    <div className="text-[9px] uppercase text-[#D4AF37] font-semibold tracking-wider">Date of Joining</div>
                    <div className="font-medium text-gray-100">{previewSlipData.employeeSnapshot.doj || '01-01-2026'}</div>
                  </div>
                  <div>
                    <div className="text-[9px] uppercase text-[#D4AF37] font-semibold tracking-wider">PAN Number</div>
                    <div className="font-mono font-medium text-gray-100">{previewSlipData.employeeSnapshot.pan || '—'}</div>
                  </div>
                  <div>
                    <div className="text-[9px] uppercase text-[#D4AF37] font-semibold tracking-wider">UAN Number</div>
                    <div className="font-mono font-medium text-gray-100">{previewSlipData.employeeSnapshot.uan || '—'}</div>
                  </div>
                  <div>
                    <div className="text-[9px] uppercase text-[#D4AF37] font-semibold tracking-wider">PF Number</div>
                    <div className="font-mono font-medium text-gray-100">{previewSlipData.employeeSnapshot.pfNo || '—'}</div>
                  </div>
                  <div>
                    <div className="text-[9px] uppercase text-[#D4AF37] font-semibold tracking-wider">Settlement Date</div>
                    <div className="font-medium text-gray-100">{previewSlipData.payDate}</div>
                  </div>
                </div>

                {/* ── 4. SLIP BODY ── */}
                <div className="p-6 space-y-4">
                  {/* Expanded Grid (Bank details) */}
                  <div className="grid grid-cols-3 border border-gray-200 rounded-lg text-xs overflow-hidden bg-gray-50/50">
                    <div className="p-2.5 border-r border-b border-gray-200">
                      <div className="text-[9px] uppercase font-bold text-gray-500">Bank Name</div>
                      <div className="font-semibold text-gray-900 mt-0.5">{previewSlipData.employeeSnapshot.bank || 'Bank of Baroda'}</div>
                    </div>
                    <div className="p-2.5 border-r border-b border-gray-200">
                      <div className="text-[9px] uppercase font-bold text-gray-500">Account Number</div>
                      <div className="font-mono font-semibold text-gray-900 mt-0.5">
                        {previewSlipData.employeeSnapshot.accNo ? `••••${String(previewSlipData.employeeSnapshot.accNo).slice(-4)}` : '—'}
                      </div>
                    </div>
                    <div className="p-2.5 border-b border-gray-200">
                      <div className="text-[9px] uppercase font-bold text-gray-500">IFSC Code</div>
                      <div className="font-mono font-semibold text-gray-900 mt-0.5">{previewSlipData.employeeSnapshot.ifsc || '—'}</div>
                    </div>
                    <div className="p-2.5 border-r border-gray-200">
                      <div className="text-[9px] uppercase font-bold text-gray-500">Financial Year</div>
                      <div className="font-semibold text-gray-900 mt-0.5">{previewSlipData.fy}</div>
                    </div>
                    <div className="p-2.5 border-r border-gray-200">
                      <div className="text-[9px] uppercase font-bold text-gray-500">Pay Period</div>
                      <div className="font-semibold text-gray-900 mt-0.5">{previewSlipData.month} (Monthly)</div>
                    </div>
                    <div className="p-2.5">
                      <div className="text-[9px] uppercase font-bold text-gray-500">Working Days</div>
                      <div className="font-mono font-semibold text-gray-900 mt-0.5">{previewSlipData.attendance.totalDays} Days</div>
                    </div>
                  </div>

                  {/* Attendance Summary */}
                  <div>
                    <div style={{ background: 'linear-gradient(135deg, #0F1C35 0%, #1B2A4A 100%)' }} className="text-white px-3 py-1.5 rounded-t-md text-[10px] uppercase font-bold tracking-wider flex items-center justify-between border-b-2 border-[#D4AF37]">
                      <span>ATTENDANCE RECORD &amp; PAY DAYS</span>
                      <span className="text-[#D4AF37] font-mono text-[9px] font-semibold">MONTH: {previewSlipData.month.toUpperCase()}</span>
                    </div>
                    <div className="bg-gradient-to-r from-gray-50 to-slate-50 border border-gray-200 rounded-b-md p-3 grid grid-cols-6 gap-2 text-center text-xs">
                      <div>
                        <div className="text-[9px] uppercase font-semibold text-gray-500">Total Days</div>
                        <div className="text-base font-bold font-mono text-gray-900">{previewSlipData.attendance.totalDays}</div>
                      </div>
                      <div>
                        <div className="text-[9px] uppercase font-semibold text-gray-500">Present</div>
                        <div className="text-base font-bold font-mono text-gray-900">{previewSlipData.attendance.presentDays}</div>
                      </div>
                      <div>
                        <div className="text-[9px] uppercase font-semibold text-gray-500">Leave</div>
                        <div className="text-base font-bold font-mono text-gray-900">{previewSlipData.attendance.leaveDays}</div>
                      </div>
                      <div>
                        <div className="text-[9px] uppercase font-semibold text-gray-500">Paid Leave</div>
                        <div className="text-base font-bold font-mono text-gray-900">{previewSlipData.attendance.paidLeave}</div>
                      </div>
                      <div>
                        <div className="text-[9px] uppercase font-semibold text-gray-500">OT Hours</div>
                        <div className="text-base font-bold font-mono text-gray-900">{previewSlipData.attendance.otHours}</div>
                      </div>
                      <div>
                        <div className="text-[9px] uppercase font-semibold text-gray-500">LOP Days</div>
                        <div className="text-base font-bold font-mono text-rose-600">{previewSlipData.attendance.lopDays}</div>
                      </div>
                    </div>
                  </div>

                  {/* Earnings & Deductions Tables */}
                  <div className="grid grid-cols-2 gap-4 text-xs">
                    {/* Earnings */}
                    <div>
                      <div style={{ background: 'linear-gradient(135deg, #0F1C35 0%, #1B2A4A 100%)' }} className="text-white px-3 py-1.5 rounded-t-md text-[10px] uppercase font-bold tracking-wider flex justify-between border-b-2 border-[#D4AF37]">
                        <span>Earnings</span>
                        <span className="text-[#D4AF37]">Amount (₹)</span>
                      </div>
                      <div className="border border-gray-200 rounded-b-md overflow-hidden">
                        <table className="w-full text-left">
                          <tbody className="divide-y divide-gray-100">
                            <tr><td className="py-1.5 px-3">Basic Salary</td><td className="py-1.5 px-3 text-right font-mono font-medium">₹{previewSlipData.earnings.basic.toLocaleString('en-IN')}</td></tr>
                            <tr><td className="py-1.5 px-3">House Rent Allowance (HRA)</td><td className="py-1.5 px-3 text-right font-mono font-medium">₹{previewSlipData.earnings.hra.toLocaleString('en-IN')}</td></tr>
                            <tr><td className="py-1.5 px-3">Conveyance Allowance</td><td className="py-1.5 px-3 text-right font-mono font-medium">₹{previewSlipData.earnings.conv.toLocaleString('en-IN')}</td></tr>
                            <tr><td className="py-1.5 px-3">Medical Allowance</td><td className="py-1.5 px-3 text-right font-mono font-medium">₹{previewSlipData.earnings.med.toLocaleString('en-IN')}</td></tr>
                            <tr><td className="py-1.5 px-3">Special Allowance</td><td className="py-1.5 px-3 text-right font-mono font-medium">₹{previewSlipData.earnings.spl.toLocaleString('en-IN')}</td></tr>
                            {previewSlipData.earnings.incentive > 0 && (
                              <tr className="bg-amber-50/60 text-amber-900 font-semibold"><td className="py-1.5 px-3">Project Incentives</td><td className="py-1.5 px-3 text-right font-mono text-emerald-700">₹{previewSlipData.earnings.incentive.toLocaleString('en-IN')}</td></tr>
                            )}
                            {previewSlipData.earnings.ot > 0 && (
                              <tr><td className="py-1.5 px-3">Overtime Pay</td><td className="py-1.5 px-3 text-right font-mono font-medium">₹{previewSlipData.earnings.ot.toLocaleString('en-IN')}</td></tr>
                            )}
                            {previewSlipData.earnings.bonus > 0 && (
                              <tr><td className="py-1.5 px-3">Bonus</td><td className="py-1.5 px-3 text-right font-mono font-medium">₹{previewSlipData.earnings.bonus.toLocaleString('en-IN')}</td></tr>
                            )}
                            {previewSlipData.earnings.reimbursement > 0 && (
                              <tr><td className="py-1.5 px-3">Reimbursement</td><td className="py-1.5 px-3 text-right font-mono font-medium">₹{previewSlipData.earnings.reimbursement.toLocaleString('en-IN')}</td></tr>
                            )}
                          </tbody>
                          <tfoot>
                            <tr className="bg-slate-100 font-bold border-t-2 border-[#0F1C35]">
                              <td className="py-2 px-3 text-[#0F1C35]">Gross Earnings</td>
                              <td className="py-2 px-3 text-right font-mono text-[#0F1C35]">₹{previewSlipData.gross.toLocaleString('en-IN')}</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>

                    {/* Deductions */}
                    <div>
                      <div style={{ background: 'linear-gradient(135deg, #1B2A4A 0%, #2A3B60 100%)' }} className="text-white px-3 py-1.5 rounded-t-md text-[10px] uppercase font-bold tracking-wider flex justify-between border-b-2 border-rose-500">
                        <span>Deductions</span>
                        <span className="text-rose-300">Amount (₹)</span>
                      </div>
                      <div className="border border-gray-200 rounded-b-md overflow-hidden">
                        <table className="w-full text-left">
                          <tbody className="divide-y divide-gray-100">
                            <tr><td className="py-1.5 px-3">Provident Fund (PF)</td><td className="py-1.5 px-3 text-right font-mono font-medium text-rose-600">₹{previewSlipData.deductions.pf.toLocaleString('en-IN')}</td></tr>
                            <tr><td className="py-1.5 px-3">ESIC</td><td className="py-1.5 px-3 text-right font-mono font-medium text-rose-600">₹{previewSlipData.deductions.esic.toLocaleString('en-IN')}</td></tr>
                            <tr><td className="py-1.5 px-3">Professional Tax (PT)</td><td className="py-1.5 px-3 text-right font-mono font-medium text-rose-600">₹{previewSlipData.deductions.pt.toLocaleString('en-IN')}</td></tr>
                            <tr><td className="py-1.5 px-3">TDS / Income Tax</td><td className="py-1.5 px-3 text-right font-mono font-medium text-rose-600">₹{previewSlipData.deductions.tds.toLocaleString('en-IN')}</td></tr>
                            <tr><td className="py-1.5 px-3">Advance Deduction</td><td className="py-1.5 px-3 text-right font-mono font-medium text-rose-600">₹{previewSlipData.deductions.advance.toLocaleString('en-IN')}</td></tr>
                            <tr><td className="py-1.5 px-3">Other Deductions</td><td className="py-1.5 px-3 text-right font-mono font-medium text-rose-600">₹{previewSlipData.deductions.other.toLocaleString('en-IN')}</td></tr>
                          </tbody>
                          <tfoot>
                            <tr className="bg-rose-50/50 font-bold border-t-2 border-[#1B2A4A]">
                              <td className="py-2 px-3 text-rose-700">Total Deductions</td>
                              <td className="py-2 px-3 text-right font-mono text-rose-700">₹{previewSlipData.totalDed.toLocaleString('en-IN')}</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  </div>

                  {/* Project-wise Incentive Breakdown Table (if any) */}
                  {previewSlipData.incentivesList && previewSlipData.incentivesList.length > 0 && (
                    <div className="border border-[#D4AF37]/50 rounded-lg overflow-hidden text-xs shadow-sm">
                      <div style={{ background: 'linear-gradient(135deg, #0F1C35 0%, #1B2A4A 100%)' }} className="text-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider flex items-center justify-between border-b border-[#D4AF37]">
                        <span>Project-wise Incentive Breakdown</span>
                        <span className="text-[#D4AF37] font-mono text-[9px]">SOLAR COMMISSIONS</span>
                      </div>
                      <table className="w-full text-left">
                        <thead className="bg-gray-50 text-[10px] text-gray-500 uppercase border-b border-gray-200">
                          <tr>
                            <th className="py-1.5 px-3">Date</th>
                            <th className="py-1.5 px-3">Project Name</th>
                            <th className="py-1.5 px-3">Client</th>
                            <th className="py-1.5 px-3 text-right">kWp</th>
                            <th className="py-1.5 px-3 text-right">Incentive</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {previewSlipData.incentivesList.map((inc, i) => (
                            <tr key={i}>
                              <td className="py-1 px-3 text-gray-600">{inc.date}</td>
                              <td className="py-1 px-3 font-semibold text-gray-900">{inc.project}</td>
                              <td className="py-1 px-3 text-gray-600">{inc.client}</td>
                              <td className="py-1 px-3 text-right font-mono">{inc.kw}</td>
                              <td className="py-1 px-3 text-right font-mono font-bold text-emerald-700">₹{inc.amount.toLocaleString('en-IN')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Net Salary Summary Box */}
                  <div style={{ background: 'linear-gradient(135deg, #0F1C35 0%, #152238 50%, #1B2A4A 100%)' }} className="border-2 border-[#D4AF37] shadow-xl text-white rounded-xl p-5 grid grid-cols-3 gap-4 items-center text-center">
                    <div>
                      <div className="text-[9px] uppercase font-bold text-gray-400 tracking-wider">Gross Earnings</div>
                      <div className="text-base font-bold font-mono text-gray-100 mt-0.5">₹{previewSlipData.gross.toLocaleString('en-IN')}</div>
                    </div>
                    <div>
                      <div className="text-[9px] uppercase font-bold text-gray-400 tracking-wider">Total Deductions</div>
                      <div className="text-base font-bold font-mono text-rose-400 mt-0.5">₹{previewSlipData.totalDed.toLocaleString('en-IN')}</div>
                    </div>
                    <div className="border-l border-white/20 pl-4">
                      <div className="text-[10px] uppercase font-bold text-[#D4AF37] tracking-wider">NET SALARY PAYABLE</div>
                      <div className="text-2xl font-black font-mono text-[#D4AF37] mt-0.5 drop-shadow">₹{previewSlipData.net.toLocaleString('en-IN')}</div>
                    </div>
                  </div>

                  {/* In Words */}
                  <div className="bg-[#FAF7F0] border border-[#D4AF37]/50 rounded-lg p-3 text-xs">
                    <div className="text-[9px] uppercase font-bold text-[#8C6D1F] tracking-wider">Net Amount in Words</div>
                    <div className="font-bold text-[#0F1C35] italic mt-0.5">{numberToWordsINR(previewSlipData.net)}</div>
                  </div>

                  {/* Slip Verification Footer */}
                  <div className="pt-4 border-t-2 border-gray-200 grid grid-cols-3 gap-6 text-center text-xs items-end">
                    <div>
                      <div className="flex justify-center mb-1">
                        <canvas ref={qrCanvasRef} className="rounded border border-gray-200" />
                      </div>
                      <div className="text-[9px] font-semibold text-gray-500 uppercase tracking-wider">Scan to Verify</div>
                    </div>

                    <div>
                      <div className="h-16 flex items-center justify-center font-serif text-[#0F1C35] border border-dashed border-[#D4AF37]/60 rounded-md bg-[#FAF7F0] italic text-xs">
                        [ Official Stamp ]
                      </div>
                      <div className="text-[9px] font-semibold text-gray-500 uppercase tracking-wider mt-1">Company Seal</div>
                    </div>

                    <div>
                      <div className="h-12 flex items-center justify-center font-script text-base text-gray-800">
                        {previewSlipData.companySnapshot.signName}
                      </div>
                      <div className="border-b-2 border-[#0F1C35] w-32 mx-auto mb-1"></div>
                      <div className="text-[10px] font-bold text-[#0F1C35]">Authorized Signatory</div>
                      <div className="text-[9px] text-gray-500">{previewSlipData.companySnapshot.name}</div>
                    </div>
                  </div>

                  <div className="text-center text-[9px] text-gray-400 pt-2 border-t border-gray-100">
                    This is a computer-generated salary slip and does not require a physical signature. Confidential — For employee use only.
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
