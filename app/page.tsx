'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  collection, 
  onSnapshot, 
  doc, 
  updateDoc, 
  deleteDoc, 
  addDoc 
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '@/src/lib/firebase';
import { useOwnerAuth } from '@/src/context/OwnerAuthContext';
import { useTheme } from '@/src/context/ThemeContext';
import OwnerLogin from '@/src/components/OwnerLogin';
import { useInactivityLogout } from '@/src/hooks/useInactivityLogout';
import { 
  Users, 
  Briefcase, 
  FolderKanban, 
  LayoutGrid, 
  FileText, 
  Tags,
  Settings,
  Bell,
  Search,
  X,
  TrendingUp,
  DollarSign,
  Receipt,
  Scale,
  Award,
  PieChart,
  Calendar,
  RotateCcw,
  Filter,
  LineChart,
  Clock,
  Trophy,
  Star,
  CreditCard,
  Banknote,
  LogOut,
  ShieldCheck,
  Sun,
  Moon,
  Trash2,
  AlertTriangle
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid
} from 'recharts';
import { 
  COLLECTIONS, 
  PROJECT_FIELDS, 
  CLIENT_FIELDS, 
  CLIENT_STATUS, 
  ProjectUpgradeRecord 
} from '@/src/config/schema';
import { 
  parseSafeDate, 
  formatSafeDate, 
  getProjectDate, 
  formatCurrency, 
  toTitleCase, 
  getFirstName, 
  formatIndianName, 
  safeNumber, 
  isZeroOrPositive, 
  buildUpgradeRecordIfChanged, 
  findMatchingCapacityRow,
  calculateSlabCost,
  calculateSlabCommission,
  SCOPE_LABELS, 
  MONTH_OPTIONS,
  resolveProjectPaymentStatus,
  resolveEffectivePricingCategory
} from '@/src/lib/projectUtils';
import BillingModule from '@/src/components/Billing';
import CompanySettingsView from '@/src/components/CompanySettingsView';
import SalaryStudio from '@/src/components/SalaryStudio';
import EmployeeDirectory from '@/src/components/EmployeeDirectory';
import PricingRulesView from '@/src/components/PricingRulesView';
import ProposalsView from '@/src/components/ProposalsView';
import EditProjectModal from '@/src/components/EditProjectModal';
import ProjectsDirectory from '@/src/components/ProjectsDirectory';

export default function DashboardPage() {
  const { theme, toggleTheme } = useTheme();
  const [activeTab, setActiveTab] = useState('Dashboard');
  const [projects, setProjects] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [pricingRules, setPricingRules] = useState<any[]>([]);
  const [commissionRules, setCommissionRules] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [proposals, setProposals] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [salaryHistory, setSalaryHistory] = useState<any[]>([]);
  const [operationalExpenses, setOperationalExpenses] = useState<any[]>([]);
  const [operationalIncomes, setOperationalIncomes] = useState<any[]>([]);
  
  // Executive profile & session controls
  const { 
    status: authStatus,
    authError,
    authNotice,
    ownerProfile, 
    signOut: handleSignOut,
    expireSession
  } = useOwnerAuth();

  // Time-based filtering state
  const [selectedMonth, setSelectedMonth] = useState<string>('all');
  const [selectedYear, setSelectedYear] = useState<string>('all');

  // Projects Directory: column-header filters, search, and pagination
  const [projectClientFilter, setProjectClientFilter] = useState<string>('all');
  const [projectScopeFilter, setProjectScopeFilter] = useState<string>('all');
  const [projectStatusFilter, setProjectStatusFilter] = useState<string>('all');
  const [projectDesignerFilter, setProjectDesignerFilter] = useState<string>('all');
  const [projectSearchQuery, setProjectSearchQuery] = useState<string>('');
  const [projectsDirectoryPage, setProjectsDirectoryPage] = useState<number>(1);
  const PROJECTS_DIRECTORY_PAGE_SIZE = 15;
  const [expensePeriod, setExpensePeriod] = useState<'monthly' | 'quarterly' | 'yearly' | 'all'>('monthly');

  // Pricing Rules Filter States
  const [clientSearchTerm, setClientSearchTerm] = useState('');

  // Modal states
  const [isEditProjectModalOpen, setIsEditProjectModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<any>(null);
  const [projectPendingDeletion, setProjectPendingDeletion] = useState<any>(null);
  const [isDeletingProject, setIsDeletingProject] = useState(false);
  const [deleteProjectError, setDeleteProjectError] = useState<string | null>(null);

  const handleSignOutAndReset = useCallback(async () => {
    setProjects([]);
    setClients([]);
    setPricingRules([]);
    setCommissionRules([]);
    setUsers([]);
    setAuditLogs([]);
    setProposals([]);
    setInvoices([]);
    setSalaryHistory([]);
    setEditingProject(null);
    setIsEditProjectModalOpen(false);
    setActiveTab('Dashboard');
    await handleSignOut();
  }, [handleSignOut]);

  // 15-minute inactivity auto-logout for verified owners
  useInactivityLogout({
    enabled: authStatus === 'authorized',
    onExpire: expireSession
  });

  const executiveProfile = ownerProfile || {
    name: 'Executive Owner',
    email: 'owner@solarithmdesign.com',
    role: 'owner'
  };

  useEffect(() => {
    if (authStatus !== 'authorized') return;

    let unsubscribeProjects: (() => void) | undefined;
    let unsubscribeClients: (() => void) | undefined;
    let unsubscribePricing: (() => void) | undefined;
    let unsubscribeUsers: (() => void) | undefined;
    let unsubscribeEmployees: (() => void) | undefined;
    let unsubscribeProposals: (() => void) | undefined;
    let unsubscribeCommissions: (() => void) | undefined;
    let unsubscribeInvoices: (() => void) | undefined;
    let unsubscribeSalaryHistory: (() => void) | undefined;
    let unsubscribeExpenses: (() => void) | undefined;
    let unsubscribeIncomes: (() => void) | undefined;

    try {
      unsubscribeInvoices = onSnapshot(collection(db, 'invoices'), (snapshot) => {
        const fbInvoices = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setInvoices(fbInvoices);
      }, (err) => {
        console.warn("Firestore invoices listener error:", err);
      });

      unsubscribeProjects = onSnapshot(collection(db, COLLECTIONS.PROJECTS), (snapshot) => {
        const projectsData = snapshot.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            projectName: data[PROJECT_FIELDS.PROJECT_NAME] || data.projectName || 'Untitled',
            ...data
          };
        });
        setProjects(projectsData);
      }, (err) => {
        console.warn("Firestore projects listener error:", err);
      });

      unsubscribeClients = onSnapshot(collection(db, COLLECTIONS.CLIENTS), (snapshot) => {
        const clientsData = snapshot.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            companyName: data[CLIENT_FIELDS.COMPANY_NAME] || data.companyName || 'Unknown Company',
            ...data
          };
        });
        setClients(clientsData);
      }, (err) => {
        console.warn("Firestore clients listener error:", err);
      });

      unsubscribePricing = onSnapshot(collection(db, COLLECTIONS.PRICING_RULES), (snapshot) => {
        const pricingData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setPricingRules(pricingData);
      }, (err) => {
        console.warn("Firestore pricing rules listener error:", err);
      });

      let employeesMap: Record<string, any> = {};
      let usersMap: Record<string, any> = {};

      const syncEmployeesAndUsers = () => {
        const map = new Map<string, any>();
        const employeeIdIndex = new Map<string, string>();

        const registerEmployeeId = (record: any, mapKey: string) => {
          const empIdRaw = record.employeeId || record.empId;
          if (empIdRaw) {
            const normalizedEmpId = String(empIdRaw).toLowerCase().trim();
            if (normalizedEmpId && !employeeIdIndex.has(normalizedEmpId)) {
              employeeIdIndex.set(normalizedEmpId, mapKey);
            }
          }
        };

        Object.values(usersMap).forEach(u => {
          const key = (u.email || u.id || '').toLowerCase().trim();
          if (key) {
            map.set(key, u);
            registerEmployeeId(u, key);
          }
        });

        Object.values(employeesMap).forEach(emp => {
          const emailKey = (emp.email || '').toLowerCase().trim();
          const empIdRaw = emp.employeeId || emp.empId;
          const normalizedEmpId = empIdRaw ? String(empIdRaw).toLowerCase().trim() : '';

          let targetKey: string = emailKey && map.has(emailKey) ? emailKey : '';
          if (!targetKey && normalizedEmpId && employeeIdIndex.has(normalizedEmpId)) {
            targetKey = employeeIdIndex.get(normalizedEmpId) as string;
          }
          if (!targetKey) {
            targetKey = emailKey || (emp.id || '').toLowerCase().trim() || `emp_${normalizedEmpId || Math.random().toString(36).slice(2)}`;
          }

          const existing = map.get(targetKey) || {};
          const merged = { ...existing, ...emp };
          map.set(targetKey, merged);
          registerEmployeeId(merged, targetKey);
        });
        setUsers(Array.from(map.values()));
      };

      unsubscribeEmployees = onSnapshot(collection(db, COLLECTIONS.EMPLOYEES), (snapshot) => {
        employeesMap = {};
        snapshot.docs.forEach(doc => {
          employeesMap[doc.id] = { id: doc.id, ...doc.data() };
        });
        syncEmployeesAndUsers();
      }, (err) => {
        console.warn("Firestore employees listener error:", err);
      });

      unsubscribeUsers = onSnapshot(collection(db, COLLECTIONS.USERS), (snapshot) => {
        usersMap = {};
        snapshot.docs.forEach(doc => {
          usersMap[doc.id] = { id: doc.id, ...doc.data() };
        });
        syncEmployeesAndUsers();
      }, (err) => {
        console.warn("Firestore users listener error:", err);
      });

      unsubscribeProposals = onSnapshot(collection(db, COLLECTIONS.PROPOSALS), (snapshot) => {
        const proposalsData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setProposals(proposalsData);
      }, (err) => {
        console.warn("Firestore proposals listener error:", err);
      });

      unsubscribeCommissions = onSnapshot(collection(db, 'commissionRules'), (snapshot) => {
        const commissionsData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setCommissionRules(commissionsData);
      }, (err) => {
        console.warn("Firestore commissions listener error:", err);
      });

      unsubscribeSalaryHistory = onSnapshot(collection(db, 'salaryHistory'), (snapshot) => {
        const salaryData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setSalaryHistory(salaryData);
      }, (err) => {
        console.warn("Firestore salaryHistory listener error:", err);
      });

      // Solarithm Flow: Operational Expenses Outflows
      unsubscribeExpenses = onSnapshot(collection(db, 'expenses'), (snapshot) => {
        const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setOperationalExpenses(list);
      }, (err) => console.warn("Firestore expenses listener notice:", err));

      // Solarithm Flow: Direct Revenue Inflows
      unsubscribeIncomes = onSnapshot(collection(db, 'incomes'), (snapshot) => {
        const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setOperationalIncomes(list);
      }, (err) => console.warn("Firestore incomes listener notice:", err));

    } catch (err) {
      console.error("Firebase connection error:", err);
    }

    return () => {
      if (unsubscribeInvoices) unsubscribeInvoices();
      if (unsubscribeProjects) unsubscribeProjects();
      if (unsubscribeClients) unsubscribeClients();
      if (unsubscribePricing) unsubscribePricing();
      if (unsubscribeUsers) unsubscribeUsers();
      if (unsubscribeEmployees) unsubscribeEmployees();
      if (unsubscribeProposals) unsubscribeProposals();
      if (unsubscribeCommissions) unsubscribeCommissions();
      if (unsubscribeSalaryHistory) unsubscribeSalaryHistory();
      if (unsubscribeExpenses) unsubscribeExpenses();
      if (unsubscribeIncomes) unsubscribeIncomes();
    };
  }, [authStatus]);

  // DIRECTIVES 1 & 2: Guard auditLogs listener lifecycle with Firebase Auth state
  useEffect(() => {
    let unsubscribeAuditLogs: (() => void) | null = null;
    let isMounted = true;

    // 1. If auth is still loading, unauthorized, or db/auth unavailable, do not attach
    if (authStatus !== 'authorized' || !db || !auth) {
      setAuditLogs([]);
      return;
    }

    const attachAuditListener = (user: any) => {
      // Wait until auth.currentUser is fully resolved and non-null
      if (!user || !isMounted || !db) return;

      if (unsubscribeAuditLogs) {
        unsubscribeAuditLogs();
        unsubscribeAuditLogs = null;
      }

      try {
        unsubscribeAuditLogs = onSnapshot(
          collection(db, COLLECTIONS.AUDIT_LOGS),
          (snapshot) => {
            if (!isMounted) return;
            const logsData = snapshot.docs.map((doc) => ({
              id: doc.id,
              ...doc.data()
            }));
            setAuditLogs(logsData);
          },
          (err: any) => {
            // Directive 2: Graceful error handler for transient session reloads or permission initialization
            if (process.env.NODE_ENV === 'development') {
              console.warn('[AuditLogs] Non-fatal listener event handled:', err?.message || 'Permission pending');
            }
          }
        );
      } catch (err: any) {
        console.warn('[AuditLogs] Handled listener attachment warning:', err?.message || err);
      }
    };

    // If auth.currentUser is already resolved and present
    if (auth.currentUser) {
      attachAuditListener(auth.currentUser);
    }

    // Wait until auth.currentUser is fully resolved before creating the subscription
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (user) {
        attachAuditListener(user);
      } else {
        if (unsubscribeAuditLogs) {
          unsubscribeAuditLogs();
          unsubscribeAuditLogs = null;
        }
        if (isMounted) {
          setAuditLogs([]);
        }
      }
    });

    // 3. Ensure proper cleanup: unsubscribe whenever component unmounts or user logs out
    return () => {
      isMounted = false;
      unsubscribeAuth();
      if (unsubscribeAuditLogs) {
        unsubscribeAuditLogs();
        unsubscribeAuditLogs = null;
      }
    };
  }, [authStatus]);

  const financialProjects = useMemo(() => {
    return projects.map((project) => {
      const matchedClient = clients.find(
        (c) => c.id === project.clientId || c.companyName === project.clientName
      );

      const pDate = getProjectDate(project) || new Date();
      const resolvedTier = project.pricingCategory 
        ? project.pricingCategory 
        : (matchedClient ? resolveEffectivePricingCategory(matchedClient, pDate) : 'T1');
      const activeCategory = String(resolvedTier).toLowerCase().trim();

      const rawCapacity = String(project.plantCapacity || project.systemCapacity || project.capacity || '0');
      const capacity = parseFloat(rawCapacity.replace(/[^\d.]/g, '')) || 0;
      
      const scope = String(project.scopeOfWork || '').toLowerCase().trim();
      const subService = String(project.subService || 'Standard').toLowerCase().trim();

      // Historical Data Lock
      let calculatedCost = 0;
      let isCostLocked = false;
      
      if (isZeroOrPositive(project.finalCost)) {
        calculatedCost = Number(project.finalCost);
        isCostLocked = true;
      } else if (isZeroOrPositive(project.calculatedCost)) {
        calculatedCost = Number(project.calculatedCost);
        isCostLocked = true;
      } else if (isZeroOrPositive(project.cost)) {
        calculatedCost = Number(project.cost);
        isCostLocked = true;
      } else if (isZeroOrPositive(project.amount)) {
        calculatedCost = Number(project.amount);
        isCostLocked = true;
      } else if (isZeroOrPositive(project.totalCost)) {
        calculatedCost = Number(project.totalCost);
        isCostLocked = true;
      } else if (isZeroOrPositive(project.price)) {
        calculatedCost = Number(project.price);
        isCostLocked = true;
      }

      // Dynamic Pricing Fallback
      if (!isCostLocked) {
        const matchedRule = pricingRules.find(
          (rule) => {
            const ruleCategory = String(rule.category || 'Standard').toLowerCase().trim();
            const ruleScope = String(rule.scope || rule.scopeOfWork || '').toLowerCase().trim();
            const ruleSubService = String(rule.subService || 'Standard').toLowerCase().trim();
            
            return ruleCategory === activeCategory && ruleScope === scope && ruleSubService === subService;
          }
        );

        if (matchedRule && Array.isArray(matchedRule.capacityRows) && matchedRule.capacityRows.length > 0) {
          const matchedRow = findMatchingCapacityRow(matchedRule.capacityRows, capacity);
          if (matchedRow) {
            calculatedCost = calculateSlabCost(matchedRow, capacity);
          }
        }
        if (calculatedCost === 0 && matchedRule && (matchedRule.basePrice || matchedRule.price)) {
          calculatedCost = Number(matchedRule.basePrice || matchedRule.price || 0);
        }
      }

      // Commission Engine with Zero-Value Safety
      const calculateCommission = (role: string) => {
        const lockedVal = role === 'designer' 
          ? (project.designerCommission ?? project.designerFee ?? project.financials?.designerCommission)
          : (project.salesCommission ?? project.commission ?? project.totalCommission ?? project.financials?.salesCommission);
        
        if (isZeroOrPositive(lockedVal)) {
          return Number(lockedVal);
        }

        let matchedRule = commissionRules.find(rule => {
          const ruleRole = String(rule.role || '').toLowerCase().trim();
          const ruleScope = String(rule.scope || rule.scopeOfWork || '').toLowerCase().trim();
          const ruleSubService = String(rule.subService || 'Standard').toLowerCase().trim();
          return ruleRole === role && ruleScope === scope && ruleSubService === subService;
        });

        if (!matchedRule) {
          matchedRule = commissionRules.find(rule => {
            const ruleRole = String(rule.role || '').toLowerCase().trim();
            const ruleScope = String(rule.scope || rule.scopeOfWork || '').toLowerCase().trim();
            const ruleSubService = String(rule.subService || 'Standard').toLowerCase().trim();
            return ruleRole === role && ruleScope === scope && ruleSubService === 'standard';
          });
        }

        if (matchedRule && Array.isArray(matchedRule.capacityRows) && matchedRule.capacityRows.length > 0) {
          const matchedRow = findMatchingCapacityRow(matchedRule.capacityRows, capacity);
          if (matchedRow) {
            const maxCap = isZeroOrPositive(matchedRule.maxCommission)
              ? Number(matchedRule.maxCommission)
              : 0;
            return calculateSlabCommission(matchedRow, capacity, maxCap);
          }
        }
        if (matchedRule && isZeroOrPositive(matchedRule.basePrice || matchedRule.price)) {
          return Number(matchedRule.basePrice || matchedRule.price || 0);
        }
        return 0;
      };

      const designerCommission = calculateCommission('designer');
      const salesCommission = calculateCommission('sales');

      const directComm = safeNumber(project.commission ?? project.totalCommission ?? project.incentive);
      let totalCommissionExpense = designerCommission + salesCommission;
      if (totalCommissionExpense === 0 && directComm > 0) {
        totalCommissionExpense = directComm;
      }

      if (Array.isArray(project.employeeCommissions)) {
        const arrSum = project.employeeCommissions.reduce((sum: number, c: any) => sum + safeNumber(c.amount || c.commission), 0);
        if (arrSum > totalCommissionExpense) {
          totalCommissionExpense = arrSum;
        }
      }

      const remainingBalance = calculatedCost - totalCommissionExpense;

      return {
        ...project,
        calculatedCost,
        designerCommission,
        salesCommission,
        totalCommissionExpense,
        financials: {
          capacity,
          costOfProject: calculatedCost,
          salesCommission,
          designerCommission,
          totalCommissionExpense,
          remainingBalance,
        },
        matchedClient,
        activeCategory,
      };
    });
  }, [projects, clients, pricingRules, commissionRules]);

  const handleUpdateProject = async (overrideData?: any) => {
    const targetProject = overrideData || editingProject;
    if (!targetProject || !targetProject.id) return;
    const originalProject = projects.find(p => p.id === targetProject.id) || {};

    const finalCostValue = safeNumber(targetProject.finalCost ?? targetProject.calculatedCost ?? targetProject.cost);
    const salesCommissionValue = safeNumber(targetProject.salesCommission ?? targetProject.commission);
    const designerCommissionValue = safeNumber(targetProject.designerCommission ?? targetProject.designerFee);
    const plantCapacityValue = safeNumber(targetProject.plantCapacity ?? targetProject.systemCapacity ?? targetProject.capacity);

    // CRITICAL DATE PRESERVATION (Audit Task 5):
    // Preserve existing date strictly: project.projectDate || project.date || project.createdAt
    // Do NOT set new Date() unless the user explicitly changed the date picker value in the form
    const originalDate = originalProject.projectDate || originalProject.date || originalProject.createdAt || '';
    const originalFormattedDate = parseSafeDate(originalDate)?.toISOString().split('T')[0] || '';
    const dateExplicitlyChanged = Boolean(
      targetProject.projectDate &&
      targetProject.projectDate !== originalDate &&
      targetProject.projectDate !== originalFormattedDate
    );
    const finalProjectDate = dateExplicitlyChanged ? targetProject.projectDate : (originalDate || targetProject.projectDate || '');

    const updatedData: any = {
      projectName: (targetProject.projectName || '').trim(),
      clientName: (targetProject.clientName || '').trim(),
      clientId: targetProject.clientId || originalProject.clientId || '',
      status: targetProject.status || originalProject.status || 'Active',
      scopeOfWork: targetProject.scopeOfWork || originalProject.scopeOfWork || 'Detailed Engineering',
      subService: targetProject.subService || originalProject.subService || 'Standard',
      pricingCategory: targetProject.pricingCategory || originalProject.pricingCategory || 'T1',
      designerEmail: targetProject.designerEmail ?? originalProject.designerEmail ?? '',
      designerName: targetProject.designerName || (targetProject.designerEmail ? getEmployeeName(targetProject.designerEmail) : (originalProject.designerName || '')),
      salesPersonEmail: targetProject.salesPersonEmail || originalProject.salesPersonEmail || '',
      systemCapacity: plantCapacityValue,
      capacity: plantCapacityValue,
      plantCapacity: plantCapacityValue,
      capacityUnit: targetProject.capacityUnit || originalProject.capacityUnit || 'KW',
      projectDate: finalProjectDate,
      date: finalProjectDate,
      createdAt: originalProject.createdAt || finalProjectDate,
      calculatedCost: finalCostValue,
      finalCost: finalCostValue,
      cost: finalCostValue,
      // Critical Commission Output Persistence
      salesCommission: salesCommissionValue,
      commission: salesCommissionValue,
      totalCommission: salesCommissionValue + designerCommissionValue,
      designerCommission: designerCommissionValue,
      designerFee: designerCommissionValue,
      updatedAt: new Date().toISOString()
    };

    const upgradeRecord = buildUpgradeRecordIfChanged(originalProject, targetProject);
    if (upgradeRecord) {
      updatedData.upgradeHistory = [...(originalProject.upgradeHistory || []), upgradeRecord];
    }

    const previousProjects = [...projects];

    setProjects(prev => prev.map(p => {
      if (p.id !== targetProject.id) return p;
      const totComm = salesCommissionValue + designerCommissionValue;
      return {
        ...p,
        ...updatedData,
        designerCommission: designerCommissionValue,
        salesCommission: salesCommissionValue,
        commission: salesCommissionValue,
        totalCommissionExpense: totComm,
        financials: {
          ...(p.financials || {}),
          costOfProject: finalCostValue,
          salesCommission: salesCommissionValue,
          designerCommission: designerCommissionValue,
          totalCommissionExpense: totComm,
          remainingBalance: finalCostValue - totComm
        }
      };
    }));

    // Firestore updates must only modify fields that were changed by the user (Audit Task 5)
    try {
      const projectRef = doc(db, COLLECTIONS.PROJECTS, targetProject.id);
      const firestoreUpdatePayload: Record<string, any> = {
        updatedAt: new Date().toISOString()
      };

      if (targetProject.projectName && targetProject.projectName !== originalProject.projectName) {
        firestoreUpdatePayload.projectName = targetProject.projectName.trim();
      }
      if (targetProject.clientName && targetProject.clientName !== originalProject.clientName) {
        firestoreUpdatePayload.clientName = targetProject.clientName.trim();
      }
      if (targetProject.clientId && targetProject.clientId !== originalProject.clientId) {
        firestoreUpdatePayload.clientId = targetProject.clientId;
      }
      if (targetProject.status && targetProject.status !== originalProject.status) {
        firestoreUpdatePayload.status = targetProject.status;
      }
      if (targetProject.scopeOfWork && targetProject.scopeOfWork !== originalProject.scopeOfWork) {
        firestoreUpdatePayload.scopeOfWork = targetProject.scopeOfWork;
      }
      if (targetProject.subService && targetProject.subService !== originalProject.subService) {
        firestoreUpdatePayload.subService = targetProject.subService;
      }
      if (targetProject.pricingCategory && targetProject.pricingCategory !== originalProject.pricingCategory) {
        firestoreUpdatePayload.pricingCategory = targetProject.pricingCategory;
      }
      if (targetProject.designerEmail !== originalProject.designerEmail) {
        firestoreUpdatePayload.designerEmail = targetProject.designerEmail || '';
        firestoreUpdatePayload.designerName = targetProject.designerName || (targetProject.designerEmail ? getEmployeeName(targetProject.designerEmail) : '');
      }
      if (targetProject.salesPersonEmail !== originalProject.salesPersonEmail) {
        firestoreUpdatePayload.salesPersonEmail = targetProject.salesPersonEmail || '';
      }
      if (plantCapacityValue !== safeNumber(originalProject.plantCapacity)) {
        firestoreUpdatePayload.plantCapacity = plantCapacityValue;
        firestoreUpdatePayload.systemCapacity = plantCapacityValue;
        firestoreUpdatePayload.capacity = plantCapacityValue;
      }
      if (finalCostValue !== safeNumber(originalProject.finalCost)) {
        firestoreUpdatePayload.calculatedCost = finalCostValue;
        firestoreUpdatePayload.finalCost = finalCostValue;
        firestoreUpdatePayload.cost = finalCostValue;
      }
      if (salesCommissionValue !== safeNumber(originalProject.salesCommission)) {
        firestoreUpdatePayload.salesCommission = salesCommissionValue;
        firestoreUpdatePayload.commission = salesCommissionValue;
      }
      if (designerCommissionValue !== safeNumber(originalProject.designerCommission)) {
        firestoreUpdatePayload.designerCommission = designerCommissionValue;
        firestoreUpdatePayload.designerFee = designerCommissionValue;
      }
      firestoreUpdatePayload.totalCommission = salesCommissionValue + designerCommissionValue;

      // Strict Date preservation in Firestore: only write if explicitly changed by user
      if (dateExplicitlyChanged) {
        firestoreUpdatePayload.projectDate = finalProjectDate;
        firestoreUpdatePayload.date = finalProjectDate;
      }

      if (upgradeRecord) {
        firestoreUpdatePayload.upgradeHistory = [...(originalProject.upgradeHistory || []), upgradeRecord];
      }

      await updateDoc(projectRef, firestoreUpdatePayload);
    } catch (error) {
      console.warn("Could not sync project update to Firestore, rolling back:", error);
      setProjects(previousProjects);
    }
    
    setIsEditProjectModalOpen(false);
    setEditingProject(null);
  };

  const handleConfirmDeleteProject = async () => {
    if (!projectPendingDeletion?.id) return;
    setIsDeletingProject(true);
    setDeleteProjectError(null);

    const { id: projectId, projectName } = projectPendingDeletion;

    try {
      await deleteDoc(doc(db, COLLECTIONS.PROJECTS, projectId));
    } catch (error) {
      console.error('Failed to delete project from Firestore:', error);
      setDeleteProjectError('Could not delete this project. Please try again.');
      setIsDeletingProject(false);
      return;
    }

    setProjects((prev) => prev.filter((p) => p.id !== projectId));

    try {
      await addDoc(collection(db, COLLECTIONS.AUDIT_LOGS), {
        action: 'PROJECT_DELETED',
        actor: executiveProfile?.email || 'owner',
        target: projectId,
        details: { projectName: projectName || 'Untitled' },
        timestamp: new Date().toISOString()
      });
    } catch (logErr) {
      console.warn('Audit log write for project deletion failed:', logErr);
    }

    setIsDeletingProject(false);
    setProjectPendingDeletion(null);
  };

  const handleDeleteProjectDirectly = async (projectId: string, projectName: string) => {
    try {
      await deleteDoc(doc(db, COLLECTIONS.PROJECTS, projectId));
    } catch (error) {
      console.error('Failed to delete project from Firestore:', error);
    }
    setProjects((prev) => prev.filter((p) => p.id !== projectId));
    try {
      await addDoc(collection(db, COLLECTIONS.AUDIT_LOGS), {
        action: 'PROJECT_DELETED',
        actor: executiveProfile?.email || 'owner',
        target: projectId,
        details: { projectName: projectName || 'Untitled' },
        timestamp: new Date().toISOString()
      });
    } catch (logErr) {
      console.warn('Audit log write for project deletion failed:', logErr);
    }
  };

  const stats = [
    { name: 'Billing', collection: 'invoices', icon: Receipt, count: invoices?.length || 0, color: 'text-[#D4AF37]' },
    { name: 'Salary Studio', collection: 'salary_slips', icon: Banknote, count: salaryHistory?.length || 0, color: 'text-[#D4AF37]' },
    { name: 'Clients', collection: COLLECTIONS.CLIENTS, icon: Briefcase, count: clients?.length || 0, color: 'text-[#D4AF37]' },
    { name: 'Projects', collection: COLLECTIONS.PROJECTS, icon: FolderKanban, count: projects?.length || 0, color: 'text-[#D4AF37]' },
    { name: 'Pricing Rules', collection: COLLECTIONS.PRICING_RULES, icon: Tags, count: pricingRules?.length || 0, color: 'text-[#D4AF37]' },
    { name: 'Proposals', collection: COLLECTIONS.PROPOSALS, icon: FileText, count: proposals?.length || 0, color: 'text-[#D4AF37]' },
    { name: 'Employees', collection: COLLECTIONS.EMPLOYEES, icon: Users, count: users?.length || 0, color: 'text-[#D4AF37]' },
  ];

  const getEmployeeName = useCallback((email: string | undefined | null) => {
    if (!email) return 'N/A';
    const user = users.find(u => u.email?.toLowerCase() === email?.toLowerCase());
    return user?.name || user?.displayName || email.split('@')[0];
  }, [users]);

  const projectHasDesignerName = useCallback((project: any, designerName: string): boolean => {
    if (project.designerEmail && formatIndianName(getEmployeeName(project.designerEmail)) === designerName) {
      return true;
    }
    if (project.assignedScopes && typeof project.assignedScopes === 'object') {
      return Object.values(project.assignedScopes).some(
        (email: any) => email && formatIndianName(getEmployeeName(email)) === designerName
      );
    }
    return false;
  }, [getEmployeeName]);

  const getScopeDesignerSummary = useCallback((project: any): string => {
    const assignedScopes = project?.assignedScopes;
    if (assignedScopes && typeof assignedScopes === 'object' && Object.keys(assignedScopes).length > 0) {
      const groupsByDesigner = new Map<string, string[]>();
      Object.entries(assignedScopes).forEach(([scopeKey, email]) => {
        if (!email) return;
        const emailStr = String(email);
        const scopeLabel = SCOPE_LABELS[scopeKey] || toTitleCase(scopeKey);
        if (!groupsByDesigner.has(emailStr)) groupsByDesigner.set(emailStr, []);
        groupsByDesigner.get(emailStr)!.push(scopeLabel);
      });

      if (groupsByDesigner.size > 0) {
        return Array.from(groupsByDesigner.entries())
          .map(([email, scopeLabels]) => `${scopeLabels.join(' & ')}: ${formatIndianName(getEmployeeName(email))}`)
          .join(' | ');
      }
    }
    return formatIndianName(getEmployeeName(project?.designerEmail));
  }, [getEmployeeName]);

  const getStatusBadge = (status: string) => {
    const baseClasses = "w-32 flex items-center justify-center px-2 py-1 rounded text-xs font-medium border text-center";
    switch(status?.toLowerCase()) {
      case 'design_approved':
      case 'approved':
      case 'completed':
      case 'finished':
        return <div className={`${baseClasses} bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30`}>Approved</div>;
      case 'in_progress':
      case 'pending_design_approval':
      case 'active':
        return <div className={`${baseClasses} bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30`}>In Progress</div>;
      case 'in_revision':
        return <div className={`${baseClasses} bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/30`}>In Revision</div>;
      case 'not_started':
      case 'rejected':
      case 'cancelled':
        return <div className={`${baseClasses} bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30`}>Not Started</div>;
      default:
        return <div className={`${baseClasses} bg-gray-100 dark:bg-gray-500/10 text-gray-700 dark:text-gray-400 border-gray-300 dark:border-gray-500/30`}>{status || 'Unknown'}</div>;
    }
  };

  const getProjectPaymentStatus = useCallback((project: any): { status: 'pending' | 'sent' | 'partially_paid' | 'paid'; label: string } => {
    return resolveProjectPaymentStatus(project, invoices);
  }, [invoices]);

  const getPaymentStatusBadge = (paymentInfo: { status: string; label: string }) => {
    const baseClasses = "w-32 flex items-center justify-center px-2 py-1 rounded text-xs font-semibold text-center";
    switch (paymentInfo.status) {
      case 'paid':
        return (
          <div className={`${baseClasses} bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400`}>
            {paymentInfo.label}
          </div>
        );
      case 'partially_paid':
        return (
          <div className={`${baseClasses} bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400`}>
            {paymentInfo.label}
          </div>
        );
      case 'sent':
        return (
          <div className={`${baseClasses} bg-[#D4AF37]/15 border border-[#D4AF37]/50 text-[#D4AF37]`}>
            {paymentInfo.label}
          </div>
        );
      case 'pending':
      default:
        return (
          <div className={`${baseClasses} bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400`}>
            {paymentInfo.label}
          </div>
        );
    }
  };

  const availableYears = useMemo(() => {
    const yearsSet = new Set<number>();
    const currentYear = new Date().getFullYear();
    yearsSet.add(currentYear);
    financialProjects.forEach((p) => {
      const d = getProjectDate(p);
      if (d) yearsSet.add(d.getFullYear());
    });
    return Array.from(yearsSet).sort((a, b) => b - a);
  }, [financialProjects]);

  const filteredFinancialProjects = useMemo(() => {
    return financialProjects.filter((project) => {
      if (selectedMonth === 'all' && selectedYear === 'all') {
        return true;
      }
      const d = getProjectDate(project);
      if (!d) {
        return selectedMonth === 'all' && selectedYear === 'all';
      }
      if (selectedYear !== 'all' && d.getFullYear() !== Number(selectedYear)) {
        return false;
      }
      if (selectedMonth !== 'all' && d.getMonth() !== Number(selectedMonth)) {
        return false;
      }
      return true;
    });
  }, [financialProjects, selectedMonth, selectedYear]);

  const projectClientOptions = useMemo(() => {
    const set = new Set<string>();
    financialProjects.forEach((p) => {
      const name = p.clientName || p.matchedClient?.companyName;
      if (name) set.add(name);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [financialProjects]);

  const projectScopeOptions = useMemo(() => {
    const set = new Set<string>();
    financialProjects.forEach((p) => {
      if (p.scopeOfWork) set.add(p.scopeOfWork);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [financialProjects]);

  const projectStatusOptions = useMemo(() => {
    const set = new Set<string>();
    financialProjects.forEach((p) => {
      if (p.status) set.add(p.status);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [financialProjects]);

  const projectDesignerOptions = useMemo(() => {
    const set = new Set<string>();
    financialProjects.forEach((p) => {
      if (p.designerEmail) set.add(formatIndianName(getEmployeeName(p.designerEmail)));
      if (p.assignedScopes && typeof p.assignedScopes === 'object') {
        Object.values(p.assignedScopes).forEach((email: any) => {
          if (email) set.add(formatIndianName(getEmployeeName(email)));
        });
      }
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [financialProjects, getEmployeeName]);

  const projectsDirectoryFilteredSorted = useMemo(() => {
    const query = projectSearchQuery.trim().toLowerCase();
    const rows = filteredFinancialProjects.filter((project) => {
      if (projectClientFilter !== 'all') {
        const clientName = project.clientName || project.matchedClient?.companyName || '';
        if (clientName !== projectClientFilter) return false;
      }
      if (projectScopeFilter !== 'all' && project.scopeOfWork !== projectScopeFilter) {
        return false;
      }
      if (projectStatusFilter !== 'all' && project.status !== projectStatusFilter) {
        return false;
      }
      if (projectDesignerFilter !== 'all' && !projectHasDesignerName(project, projectDesignerFilter)) {
        return false;
      }
      if (query) {
        const haystack = [
          project.projectName,
          project.clientName || project.matchedClient?.companyName,
          project.scopeOfWork,
          project.subService
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });

    return [...rows].sort((a, b) => {
      const dA = getProjectDate(a);
      const dB = getProjectDate(b);
      if (!dA && !dB) return 0;
      if (!dA) return 1;
      if (!dB) return -1;
      return dB.getTime() - dA.getTime();
    });
  }, [
    filteredFinancialProjects,
    projectClientFilter,
    projectScopeFilter,
    projectStatusFilter,
    projectDesignerFilter,
    projectSearchQuery,
    projectHasDesignerName
  ]);

  const projectsDirectoryTotalPages = Math.max(1, Math.ceil(projectsDirectoryFilteredSorted.length / PROJECTS_DIRECTORY_PAGE_SIZE));
  const projectsDirectoryPageSafe = Math.min(projectsDirectoryPage, projectsDirectoryTotalPages);
  const projectsDirectoryPageRows = useMemo(() => {
    const start = (projectsDirectoryPageSafe - 1) * PROJECTS_DIRECTORY_PAGE_SIZE;
    return projectsDirectoryFilteredSorted.slice(start, start + PROJECTS_DIRECTORY_PAGE_SIZE);
  }, [projectsDirectoryFilteredSorted, projectsDirectoryPageSafe]);

  // Enterprise Financial Metrics Engine (Consolidated Projects + Solarithm Flow Treasury)
  const financialMetrics = useMemo(() => {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const currentQuarter = Math.floor(currentMonth / 3);
    const targetYear = selectedYear !== 'all' ? Number(selectedYear) : currentYear;

    let monthlyRevenue = 0;
    let yearlyRevenue = 0;
    let totalRevenueAllTime = 0;

    let monthlyExpenses = 0;
    let quarterlyExpenses = 0;
    let yearlyExpenses = 0;
    let totalExpensesAllTime = 0;

    const clientRevenueMap: Record<string, { revenue: number; projectCount: number }> = {};

    // 1. Project Invoiced Revenue & Commission Outflows
    filteredFinancialProjects.forEach((p) => {
      const cost = safeNumber(p.calculatedCost ?? p.cost ?? p.amount ?? p.totalCost);
      const desComm = safeNumber(p.designerCommission);
      const salesComm = safeNumber(p.salesCommission);
      const totalCommExp = safeNumber(p.totalCommissionExpense ?? (desComm + salesComm));
      
      const projectRevenue = cost;
      const projectExpense = totalCommExp;

      const d = getProjectDate(p);
      const projYear = d ? d.getFullYear() : currentYear;
      const projMonth = d ? d.getMonth() : currentMonth;
      const projQuarter = d ? Math.floor(projMonth / 3) : currentQuarter;

      totalRevenueAllTime += projectRevenue;
      totalExpensesAllTime += projectExpense;

      const isTargetYear = selectedYear !== 'all' ? (projYear === targetYear) : (projYear === currentYear);

      if (isTargetYear) {
        yearlyRevenue += projectRevenue;
        yearlyExpenses += projectExpense;

        if (projQuarter === currentQuarter) {
          quarterlyExpenses += projectExpense;
        }

        if (projMonth === currentMonth) {
          monthlyRevenue += projectRevenue;
          monthlyExpenses += projectExpense;
        }
      }

      const clientName = p.clientName || p.matchedClient?.companyName || 'Unknown Client';
      if (!clientRevenueMap[clientName]) {
        clientRevenueMap[clientName] = { revenue: 0, projectCount: 0 };
      }
      clientRevenueMap[clientName].revenue += projectRevenue;
      clientRevenueMap[clientName].projectCount += 1;
    });

    // 2. Solarithm Flow: Operational Expenses Outflows (/expenses)
    operationalExpenses.forEach((exp: any) => {
      const amount = Number(exp.amount) || Number(exp.total) || Number(exp.value) || 0;
      if (amount <= 0) return;

      const d = parseSafeDate(exp.date || exp.expenseDate || exp.createdAt || exp.timestamp);
      const expYear = d ? d.getFullYear() : currentYear;
      const expMonth = d ? d.getMonth() : currentMonth;
      const expQuarter = d ? Math.floor(expMonth / 3) : currentQuarter;

      totalExpensesAllTime += amount;

      const isTargetYear = selectedYear !== 'all' ? (expYear === targetYear) : (expYear === currentYear);
      if (isTargetYear) {
        yearlyExpenses += amount;

        if (expQuarter === currentQuarter) {
          quarterlyExpenses += amount;
        }

        if (expMonth === currentMonth) {
          monthlyExpenses += amount;
        }
      }
    });

    // 3. Solarithm Flow: Direct Revenue Inflows (/incomes)
    // Filter out entries with linkedInvoiceId to prevent double-counting invoice settlements
    operationalIncomes.forEach((inc: any) => {
      if (inc.linkedInvoiceId || inc.invoiceId) return;

      const amount = Number(inc.amount) || Number(inc.total) || Number(inc.value) || 0;
      if (amount <= 0) return;

      const d = parseSafeDate(inc.date || inc.incomeDate || inc.createdAt || inc.timestamp);
      const incYear = d ? d.getFullYear() : currentYear;
      const incMonth = d ? d.getMonth() : currentMonth;

      totalRevenueAllTime += amount;

      const isTargetYear = selectedYear !== 'all' ? (incYear === targetYear) : (incYear === currentYear);
      if (isTargetYear) {
        yearlyRevenue += amount;

        if (incMonth === currentMonth) {
          monthlyRevenue += amount;
        }
      }
    });

    // Handle fallback scenarios when filtering by all years
    if (yearlyRevenue === 0 && totalRevenueAllTime > 0 && selectedYear === 'all') {
      yearlyRevenue = totalRevenueAllTime;
    }
    if (yearlyExpenses === 0 && totalExpensesAllTime > 0 && selectedYear === 'all') {
      yearlyExpenses = totalExpensesAllTime;
    }

    if (yearlyExpenses === 0 && salaryHistory.length > 0) {
      salaryHistory.forEach((rec: any) => {
        const comm = safeNumber(rec.incentive ?? rec.commission ?? rec.incentiveAmount);
        if (comm > 0) {
          yearlyExpenses += comm;
          totalExpensesAllTime += comm;
        }
      });
    }

    let topClient = { name: 'None', revenue: 0, projectCount: 0 };
    Object.entries(clientRevenueMap).forEach(([name, data]) => {
      if (data.revenue > topClient.revenue || (topClient.name === 'None' && data.projectCount > 0)) {
        topClient = { name, ...data };
      }
    });

    // Net Profit = (Total Invoiced Revenue + Direct Inflows) - (Commissions + Operational Expenses)
    const netProfitYearly = yearlyRevenue - yearlyExpenses;
    const projectCount = filteredFinancialProjects.length;
    const avgCostPerProject = projectCount > 0 ? totalRevenueAllTime / projectCount : 0;
    const avgExpensePerProject = projectCount > 0 ? totalExpensesAllTime / projectCount : 0;
    
    const totalApprovedClients = clients.filter(c => String(c.status).toLowerCase() === 'approved').length || clients.length;

    return {
      monthlyRevenue,
      yearlyRevenue,
      totalRevenueAllTime,
      monthlyExpenses,
      quarterlyExpenses,
      yearlyExpenses,
      totalExpensesAllTime,
      netProfitYearly,
      topClient,
      totalProjectsCount: projectCount,
      totalApprovedClients,
      avgCostPerProject,
      avgExpensePerProject,
    };
  }, [filteredFinancialProjects, operationalExpenses, operationalIncomes, clients, salaryHistory, selectedYear]);

  const currentMonthName = new Date().toLocaleString('default', { month: 'short' });
  const currentYearNum = new Date().getFullYear();
  const currentQuarterNum = Math.floor(new Date().getMonth() / 3) + 1;

  const currentExpenseValue = useMemo(() => {
    switch (expensePeriod) {
      case 'monthly':
        return { 
          value: financialMetrics.monthlyExpenses > 0 ? financialMetrics.monthlyExpenses : financialMetrics.yearlyExpenses, 
          label: `${currentMonthName} Expenses` 
        };
      case 'quarterly':
        return { 
          value: financialMetrics.quarterlyExpenses > 0 ? financialMetrics.quarterlyExpenses : financialMetrics.yearlyExpenses, 
          label: `Q${currentQuarterNum} Expenses` 
        };
      case 'yearly':
        return { 
          value: financialMetrics.yearlyExpenses, 
          label: `${selectedYear !== 'all' ? selectedYear : currentYearNum} Expenses` 
        };
      case 'all':
      default:
        return { 
          value: financialMetrics.totalExpensesAllTime, 
          label: 'All-Time Expenses' 
        };
    }
  }, [expensePeriod, financialMetrics, currentMonthName, currentYearNum, currentQuarterNum, selectedYear]);

  const invoiceMetrics = useMemo(() => {
    const now = new Date();
    const curMonth = now.getMonth();
    const curYear = now.getFullYear();

    const unpaidInvoices = invoices.filter(
      (inv) => String(inv.status || '').toLowerCase().trim() !== 'paid'
    );
    const invoiceReceivables = unpaidInvoices.reduce((acc, inv) => {
      const val = safeNumber(inv.totals?.payable ?? inv.payable ?? inv.total);
      return acc + val;
    }, 0);

    let projectReceivables = 0;
    let pendingProjectsCount = 0;

    financialProjects.forEach((proj) => {
      const cost = safeNumber(proj.calculatedCost ?? proj.cost ?? proj.amount);
      const paymentInfo = getProjectPaymentStatus(proj);

      if (paymentInfo.status === 'paid') {
        // paid
      } else if (paymentInfo.status === 'partially_paid') {
        projectReceivables += cost * 0.5;
        pendingProjectsCount += 1;
      } else {
        projectReceivables += cost;
        pendingProjectsCount += 1;
      }
    });

    const outstandingReceivables = invoiceReceivables > 0 
      ? invoiceReceivables 
      : (projectReceivables > 0 ? projectReceivables : 0);

    const outstandingCount = unpaidInvoices.length > 0 
      ? unpaidInvoices.length 
      : pendingProjectsCount;

    const thisMonthInvoices = invoices.filter((inv) => {
      const d = parseSafeDate(inv.invDate || inv.date || inv.createdAt);
      return d && !isNaN(d.getTime()) && d.getMonth() === curMonth && d.getFullYear() === curYear;
    });

    const thisMonthProjects = financialProjects.filter((p) => {
      const d = getProjectDate(p);
      return d && !isNaN(d.getTime()) && d.getMonth() === curMonth && d.getFullYear() === curYear;
    });

    const invoicesThisMonthCount = thisMonthInvoices.length > 0
      ? thisMonthInvoices.length
      : (thisMonthProjects.length > 0 ? thisMonthProjects.length : financialProjects.length);

    const totalInvoicesCount = invoices.length > 0 ? invoices.length : financialProjects.length;

    return {
      outstandingReceivables,
      outstandingCount,
      invoicesThisMonthCount,
      totalInvoicesCount
    };
  }, [invoices, financialProjects, getProjectPaymentStatus]);

  const paymentPipelineMetrics = useMemo(() => {
    let pending = 0;
    let sent = 0;
    let partiallyPaid = 0;
    let paid = 0;

    projects.forEach((proj) => {
      const paymentInfo = getProjectPaymentStatus(proj);
      if (paymentInfo.status === 'paid') {
        paid += 1;
      } else if (paymentInfo.status === 'partially_paid') {
        partiallyPaid += 1;
      } else if (paymentInfo.status === 'sent') {
        sent += 1;
      } else {
        pending += 1;
      }
    });

    return {
      pending,
      sent,
      partiallyPaid,
      paid,
      total: projects.length
    };
  }, [projects, getProjectPaymentStatus]);

  const revenueBreakdown = useMemo(() => {
    let clearedRevenue = 0;
    let unclearedRevenue = 0;
    let paidCount = 0;
    let pendingCount = 0;

    if (invoices.length > 0) {
      invoices.forEach((inv) => {
        const amount = safeNumber(inv.totals?.payable ?? inv.payable ?? inv.total);
        const status = String(inv.status || '').toLowerCase().trim();

        if (status === 'paid') {
          clearedRevenue += amount;
          paidCount += 1;
        } else {
          unclearedRevenue += amount;
          pendingCount += 1;
        }
      });
    }

    if (clearedRevenue === 0 && unclearedRevenue === 0 && financialProjects.length > 0) {
      financialProjects.forEach((proj) => {
        const cost = safeNumber(proj.calculatedCost ?? proj.cost ?? proj.amount);
        const paymentInfo = getProjectPaymentStatus(proj);
        if (paymentInfo.status === 'paid') {
          clearedRevenue += cost;
          paidCount += 1;
        } else if (paymentInfo.status === 'partially_paid') {
          clearedRevenue += cost * 0.5;
          unclearedRevenue += cost * 0.5;
          paidCount += 1;
          pendingCount += 1;
        } else {
          unclearedRevenue += cost;
          pendingCount += 1;
        }
      });
    }

    return {
      clearedRevenue,
      unclearedRevenue,
      paidCount,
      pendingCount,
      totalRevenue: clearedRevenue + unclearedRevenue
    };
  }, [invoices, financialProjects, getProjectPaymentStatus]);

  const monthlyChartData = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const targetYear = selectedYear !== 'all' ? Number(selectedYear) : currentYear;

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthMap: Record<number, { revenue: number; expenses: number }> = {};
    for (let i = 0; i < 12; i++) {
      monthMap[i] = { revenue: 0, expenses: 0 };
    }

    financialProjects.forEach((p) => {
      const d = getProjectDate(p);
      const projYear = d ? d.getFullYear() : currentYear;
      const projMonth = d ? d.getMonth() : 0;

      if (selectedYear === 'all' || projYear === targetYear) {
        const cost = safeNumber(p.calculatedCost ?? p.cost ?? p.amount);
        const exp = safeNumber(p.totalCommissionExpense ?? (safeNumber(p.designerCommission) + safeNumber(p.salesCommission)));

        monthMap[projMonth].revenue += cost;
        monthMap[projMonth].expenses += exp;
      }
    });

    return monthNames.map((name, index) => ({
      name,
      revenue: monthMap[index].revenue,
      expenses: monthMap[index].expenses
    }));
  }, [financialProjects, selectedYear]);

  const starClient = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const targetYear = selectedYear !== 'all' ? Number(selectedYear) : currentYear;

    const clientRevenueMap: Record<string, { name: string; revenue: number; projectCount: number }> = {};

    financialProjects.forEach((p) => {
      const d = getProjectDate(p);
      const projYear = d ? d.getFullYear() : currentYear;

      if (selectedYear === 'all' || projYear === targetYear) {
        const cost = safeNumber(p.calculatedCost ?? p.cost ?? p.amount);
        const clientName = p.clientName || p.matchedClient?.companyName || 'Unknown Client';
        if (!clientRevenueMap[clientName]) {
          clientRevenueMap[clientName] = { name: clientName, revenue: 0, projectCount: 0 };
        }
        clientRevenueMap[clientName].revenue += cost;
        clientRevenueMap[clientName].projectCount += 1;
      }
    });

    let top = { name: 'None', revenue: 0, projectCount: 0 };
    Object.values(clientRevenueMap).forEach((item) => {
      if (item.revenue > top.revenue || (top.name === 'None' && item.projectCount > 0)) {
        top = item;
      }
    });

    return top;
  }, [financialProjects, selectedYear]);

  const topPerformers = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth();
    const targetYear = selectedYear !== 'all' ? Number(selectedYear) : currentYear;
    const targetMonth = selectedMonth !== 'all' ? Number(selectedMonth) : currentMonth;

    const employeeEarnings: Record<string, {
      name: string;
      email: string;
      role: string;
      totalEarnedYear: number;
      totalEarnedMonth: number;
      projectCount: number;
    }> = {};

    const addCommission = (email: string | undefined | null, amount: number, isCurrentMonth: boolean, isCurrentYear: boolean, role: string) => {
      if (!email || amount <= 0) return;
      const cleanEmail = email.trim().toLowerCase();
      const empName = formatIndianName(getEmployeeName(email));

      if (!employeeEarnings[cleanEmail]) {
        employeeEarnings[cleanEmail] = {
          name: empName,
          email: cleanEmail,
          role,
          totalEarnedYear: 0,
          totalEarnedMonth: 0,
          projectCount: 0
        };
      }
      if (isCurrentYear) {
        employeeEarnings[cleanEmail].totalEarnedYear += amount;
        employeeEarnings[cleanEmail].projectCount += 1;
      }
      if (isCurrentMonth && isCurrentYear) {
        employeeEarnings[cleanEmail].totalEarnedMonth += amount;
      }
    };

    financialProjects.forEach((p) => {
      const d = getProjectDate(p);
      const projYear = d ? d.getFullYear() : currentYear;
      const projMonth = d ? d.getMonth() : currentMonth;

      const isYear = selectedYear === 'all' ? true : (projYear === targetYear);
      const isMonth = selectedMonth === 'all' ? true : (projMonth === targetMonth);

      const desComm = safeNumber(p.designerCommission);
      const salesComm = safeNumber(p.salesCommission);

      const designerEmail = p.designerEmail;
      const salesPersonEmail = p.salesPersonEmail || p.matchedClient?.salesPersonEmail;

      if (designerEmail && desComm > 0) {
        addCommission(designerEmail, desComm, isMonth, isYear, 'Designer');
      }
      if (salesPersonEmail && salesComm > 0) {
        addCommission(salesPersonEmail, salesComm, isMonth, isYear, 'Sales');
      }
    });

    if (salaryHistory.length > 0) {
      salaryHistory.forEach((rec: any) => {
        const empEmail = rec.employeeEmail || rec.email || rec.employeeId;
        const comm = safeNumber(rec.incentive ?? rec.commission);
        if (empEmail && comm > 0) {
          addCommission(empEmail, comm, true, true, rec.role || 'Consultant');
        }
      });
    }

    const ranked = Object.values(employeeEarnings).sort((a, b) => b.totalEarnedYear - a.totalEarnedYear);
    const topPerformer = ranked.length > 0 ? ranked[0] : null;

    return {
      topPerformer,
      rankedList: ranked
    };
  }, [financialProjects, salaryHistory, selectedMonth, selectedYear, getEmployeeName]);

    const renderTimeFilterControls = (idPrefix: string) => {
    const selectedMonthLabel = MONTH_OPTIONS.find(m => m.value === selectedMonth)?.label || "All Months";
    return (
      <div className="flex flex-wrap items-center gap-2">
        {/* Month Dropdown */}
        <div className="flex items-center space-x-1.5 bg-white dark:bg-[#121212] border border-gray-300 dark:border-[#333333] hover:border-[#D4AF37]/60 rounded-lg px-2.5 py-1.5 focus-within:border-[#D4AF37] transition-colors shadow-xs">
          <Calendar className="w-3.5 h-3.5 text-[#D4AF37] shrink-0" />
          <select
            id={`${idPrefix}-month-select`}
            value={selectedMonth}
            onChange={(e) => {
              setSelectedMonth(e.target.value);
              setProjectsDirectoryPage(1);
            }}
            className="bg-transparent text-xs text-gray-800 dark:text-gray-200 focus:outline-none cursor-pointer pr-1 font-medium"
          >
            {MONTH_OPTIONS.map((m) => (
              <option key={m.value} value={m.value} className="bg-white dark:bg-[#1E1E1E] text-gray-800 dark:text-gray-200">
                {m.label}
              </option>
            ))}
          </select>
        </div>

        {/* Year Dropdown */}
        <div className="flex items-center space-x-1.5 bg-white dark:bg-[#121212] border border-gray-300 dark:border-[#333333] hover:border-[#D4AF37]/60 rounded-lg px-2.5 py-1.5 focus-within:border-[#D4AF37] transition-colors shadow-xs">
          <select
            id={`${idPrefix}-year-select`}
            value={selectedYear}
            onChange={(e) => {
              setSelectedYear(e.target.value);
              setProjectsDirectoryPage(1);
            }}
            className="bg-transparent text-xs text-gray-800 dark:text-gray-200 focus:outline-none cursor-pointer pr-1 font-medium"
          >
            <option value="all" className="bg-white dark:bg-[#1E1E1E] text-gray-800 dark:text-gray-200">All Years</option>
            {availableYears.map((yr) => (
              <option key={yr} value={String(yr)} className="bg-white dark:bg-[#1E1E1E] text-gray-800 dark:text-gray-200">
                {yr}
              </option>
            ))}
          </select>
        </div>

        {/* Active Filter Indicator & Reset */}
        {(selectedMonth !== "all" || selectedYear !== "all") && (
          <button
            id={`${idPrefix}-reset-btn`}
            onClick={() => {
              setSelectedMonth("all");
              setSelectedYear("all");
              setProjectsDirectoryPage(1);
            }}
            className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 hover:bg-amber-50 dark:hover:bg-[#252525] transition-colors border border-amber-300 dark:border-amber-500/30 cursor-pointer shadow-xs"
            title={`Showing: ${selectedMonthLabel} ${selectedYear !== "all" ? selectedYear : ""}. Click to clear filter`}
          >
            <RotateCcw className="w-3 h-3" />
            <span>Reset</span>
          </button>
        )}
      </div>
    );
  };

  if (authStatus === 'loading') {
    return (
      <div className="min-h-screen bg-white dark:bg-[#121212] flex items-center justify-center transition-colors">
        <div className="flex flex-col items-center gap-3">
          <span className="h-8 w-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
          <span className="text-xs text-gray-500 dark:text-gray-400 tracking-wider uppercase">Verifying session...</span>
        </div>
      </div>
    );
  }

  if (authStatus !== 'authorized') {
    return <OwnerLogin onSuccess={() => {}} externalError={authError} externalNotice={authNotice} />;
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-gray-50 dark:bg-[#121212] text-gray-900 dark:text-white transition-colors">
      {/* Global Header */}
      <header className="py-3 flex items-center justify-between px-6 bg-white dark:bg-[#1E1E1E] border-b border-gray-200 dark:border-[#333333] shrink-0 z-10 transition-colors shadow-sm">
        <div className="flex items-center space-x-3.5">
          <div className="h-9 w-9 rounded-xl bg-gray-100 dark:bg-[#252525] border border-gray-200 dark:border-[#333333] flex items-center justify-center shrink-0 shadow-sm">
            <LayoutGrid className="h-5 w-5 text-[#D4AF37]" />
          </div>
          <div className="flex flex-col hidden sm:flex">
            <span className="text-lg font-bold text-gray-900 dark:text-white tracking-tight">Solarithm Insight</span>
            <span className="text-[11px] text-gray-500 dark:text-gray-400">Executive Project & Financial Management Console</span>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <div className="hidden md:block relative w-64 lg:w-80 mr-2">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-4 w-4 text-gray-400" />
            </div>
            <input
              type="text"
              className="block w-full pl-9 pr-3 py-1.5 border border-gray-300 dark:border-[#333333] rounded-lg text-xs bg-gray-50 dark:bg-[#121212] text-gray-900 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:border-[#D4AF37] transition-colors"
              placeholder="Search console..."
            />
          </div>
          <button
            onClick={toggleTheme}
            className="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:text-[#D4AF37] hover:bg-gray-100 dark:hover:bg-[#252525] transition-colors"
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
          <button 
            onClick={() => setActiveTab('Settings')}
            className={`p-1.5 rounded-lg transition-colors ${activeTab === 'Settings' ? 'text-[#D4AF37] bg-[#D4AF37]/10' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-[#252525]'}`}
            title="Global Company Settings"
          >
            <Settings className="w-5 h-5" />
          </button>
          <button className="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-[#252525] relative">
            <Bell className="w-5 h-5" />
            <span className="absolute top-1 right-1 block h-2 w-2 rounded-full bg-[#D4AF37]"></span>
          </button>

          {/* Authenticated Owner Profile & Sign Out */}
          <div className="flex items-center gap-2.5 pl-3 border-l border-gray-200 dark:border-[#333333]">
            <div className="hidden lg:flex flex-col text-right">
              <div className="flex items-center justify-end gap-1.5">
                <span className="text-xs font-semibold text-gray-900 dark:text-white">
                  {formatIndianName(executiveProfile?.name || 'Owner')}
                </span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/30 uppercase tracking-wider flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3 text-[#D4AF37]" />
                  Owner
                </span>
              </div>
              <span className="text-[11px] text-gray-500 dark:text-gray-400 truncate max-w-[160px]">
                {executiveProfile?.email || 'owner@solarithmdesign.com'}
              </span>
            </div>

            <div 
              className="h-8 w-8 rounded-full bg-[#D4AF37] flex items-center justify-center text-black font-bold text-xs shrink-0 shadow-sm uppercase"
              title={executiveProfile?.email || 'Owner'}
            >
              {getFirstName(executiveProfile?.name || 'Owner').slice(0, 2).toUpperCase()}
            </div>

            <button
              onClick={handleSignOutAndReset}
              className="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:text-rose-500 hover:bg-gray-100 dark:hover:bg-[#252525] transition-colors cursor-pointer"
              title="Sign Out of Master Dashboard"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-64 bg-white dark:bg-[#1E1E1E] border-r border-gray-200 dark:border-[#333333] hidden md:flex flex-col transition-colors shrink-0">
          <nav className="flex-1 overflow-y-auto py-4">
            <ul className="space-y-1.5 px-3">
              <li>
                <a 
                  href="#" 
                  onClick={(e) => { e.preventDefault(); setActiveTab('Dashboard'); }}
                  className={`flex items-center px-3 py-2.5 rounded-lg font-medium text-xs transition-colors ${
                    activeTab === 'Dashboard' 
                      ? 'bg-gray-100 dark:bg-[#252525] text-gray-900 dark:text-white border-l-2 border-[#D4AF37] shadow-sm font-semibold' 
                      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-[#252525]/60 hover:text-gray-900 dark:hover:text-white'
                  }`}
                >
                  <LayoutGrid className="w-4 h-4 mr-3 text-[#D4AF37]" />
                  Dashboard
                </a>
              </li>
              {stats.map((item) => (
                <li key={item.name}>
                  <a 
                    href="#" 
                    onClick={(e) => { e.preventDefault(); setActiveTab(item.name); }}
                    className={`flex items-center px-3 py-2.5 rounded-lg font-medium text-xs transition-colors ${
                      activeTab === item.name 
                        ? 'bg-gray-100 dark:bg-[#252525] text-gray-900 dark:text-white border-l-2 border-[#D4AF37] shadow-sm font-semibold' 
                        : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-[#252525]/60 hover:text-gray-900 dark:hover:text-white'
                    }`}
                  >
                    <item.icon className={`w-4 h-4 mr-3 ${activeTab === item.name ? 'text-[#D4AF37]' : ''}`} />
                    {item.name}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="p-3 border-t border-gray-200 dark:border-[#333333]">
            <button 
              onClick={() => setActiveTab('Settings')}
              className={`flex items-center w-full px-3 py-2 rounded-lg font-medium text-xs transition-colors ${
                activeTab === 'Settings' 
                  ? 'bg-gray-100 dark:bg-[#252525] text-gray-900 dark:text-white border-l-2 border-[#D4AF37] font-semibold' 
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-[#252525]/60 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              <Settings className={`w-4 h-4 mr-3 ${activeTab === 'Settings' ? 'text-[#D4AF37]' : ''}`} />
              Company Settings
            </button>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-gray-50 dark:bg-[#121212] transition-colors">
          <div className="flex-1 overflow-y-auto p-6 lg:p-8">
            {activeTab === 'Dashboard' && (
              <div className="w-full space-y-8">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-bold mb-0.5 text-gray-900 dark:text-white">Master Overview</h2>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Financial health, cash flow projections, and project operations summary.</p>
                  </div>
                  {renderTimeFilterControls('dashboard-header')}
                </div>

                {/* Enterprise Financial KPI Cards Grid (UIX-01 Light/Dark Contrast Enforced) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {/* 1. Projects & Clients */}
                  <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] hover:border-[#D4AF37]/60 rounded-xl p-4 transition-all shadow-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Projects</span>
                      <div className="p-2 rounded-lg bg-gray-100 dark:bg-[#121212] text-[#D4AF37]">
                        <FolderKanban className="w-4 h-4" />
                      </div>
                    </div>
                    <div className="mt-2">
                      <div className="flex items-baseline space-x-2">
                        <span className="text-2xl font-bold text-gray-900 dark:text-white">{financialMetrics.totalProjectsCount}</span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">Projects</span>
                      </div>
                      <div className="mt-2 text-xs text-gray-500 dark:text-gray-400 flex items-center justify-between border-t border-gray-100 dark:border-[#2A2A2A] pt-2">
                        <span>Approved Clients:</span>
                        <span className="font-semibold text-gray-800 dark:text-gray-200">{financialMetrics.totalApprovedClients}</span>
                      </div>
                    </div>
                  </div>

                  {/* 2. Monthly Revenue */}
                  <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] hover:border-[#D4AF37]/60 rounded-xl p-4 transition-all shadow-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{currentMonthName} Revenue</span>
                      <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                        <TrendingUp className="w-4 h-4" />
                      </div>
                    </div>
                    <div className="mt-2">
                      <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                        {formatCurrency(financialMetrics.monthlyRevenue)}
                      </div>
                      <div className="mt-2 text-xs text-gray-500 dark:text-gray-400 flex items-center justify-between border-t border-gray-100 dark:border-[#2A2A2A] pt-2">
                        <span>Run Rate:</span>
                        <span className="font-medium text-gray-700 dark:text-gray-300">{financialMetrics.monthlyRevenue > 0 ? 'Active' : 'No billings'}</span>
                      </div>
                    </div>
                  </div>

                  {/* 3. Yearly Revenue */}
                  <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] hover:border-[#D4AF37]/60 rounded-xl p-4 transition-all shadow-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{currentYearNum} YTD Revenue</span>
                      <div className="p-2 rounded-lg bg-gray-100 dark:bg-[#121212] text-[#D4AF37]">
                        <DollarSign className="w-4 h-4" />
                      </div>
                    </div>
                    <div className="mt-2">
                      <div className="text-2xl font-bold text-gray-900 dark:text-white font-mono">
                        {formatCurrency(financialMetrics.yearlyRevenue)}
                      </div>
                      <div className="mt-2 text-xs text-gray-500 dark:text-gray-400 flex items-center justify-between border-t border-gray-100 dark:border-[#2A2A2A] pt-2">
                        <span>All-Time Total:</span>
                        <span className="font-mono text-gray-700 dark:text-gray-300">{formatCurrency(financialMetrics.totalRevenueAllTime)}</span>
                      </div>
                    </div>
                  </div>

                  {/* 4. Total Expenses with Toggle */}
                  <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] hover:border-[#D4AF37]/60 rounded-xl p-4 transition-all shadow-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Total Expenses</span>
                      <div className="p-2 rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400">
                        <Receipt className="w-4 h-4" />
                      </div>
                    </div>
                    <div className="mt-2">
                      <div className="text-2xl font-bold text-rose-600 dark:text-rose-400 font-mono">
                        {formatCurrency(currentExpenseValue.value)}
                      </div>
                      <div className="mt-2 flex items-center space-x-1 border-t border-gray-100 dark:border-[#2A2A2A] pt-2">
                        {(['monthly', 'quarterly', 'yearly', 'all'] as const).map((period) => (
                          <button
                            key={period}
                            onClick={() => setExpensePeriod(period)}
                            className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors uppercase ${
                              expensePeriod === period
                                ? 'bg-[#D4AF37] text-black font-bold'
                                : 'bg-gray-100 dark:bg-[#121212] text-gray-600 dark:text-gray-400 hover:text-black dark:hover:text-white'
                            }`}
                          >
                            {period === 'monthly' ? 'M' : period === 'quarterly' ? 'Q' : period === 'yearly' ? 'Y' : 'All'}
                          </button>
                        ))}
                        <span className="text-[10px] text-gray-500 ml-auto truncate pl-1">{currentExpenseValue.label}</span>
                      </div>
                    </div>
                  </div>

                  {/* 5. Net Profit / Loss */}
                  <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] hover:border-[#D4AF37]/60 rounded-xl p-4 transition-all shadow-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Net Profit (YTD)</span>
                      <div className={`p-2 rounded-lg ${financialMetrics.netProfitYearly >= 0 ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'}`}>
                        <Scale className="w-4 h-4" />
                      </div>
                    </div>
                    <div className="mt-2">
                      <div className={`text-2xl font-bold font-mono ${financialMetrics.netProfitYearly >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                        {formatCurrency(financialMetrics.netProfitYearly)}
                      </div>
                      <div className="mt-2 text-xs text-gray-500 dark:text-gray-400 flex items-center justify-between border-t border-gray-100 dark:border-[#2A2A2A] pt-2">
                        <span>Status:</span>
                        <span className={`font-semibold ${financialMetrics.netProfitYearly >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                          {financialMetrics.netProfitYearly >= 0 ? 'Profitable' : 'Loss'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* 6. Payment Pipeline */}
                  <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] hover:border-[#D4AF37]/60 rounded-xl p-4 transition-all shadow-sm flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Payment Pipeline</span>
                      <div className="p-2 rounded-lg bg-gray-100 dark:bg-[#121212] text-[#D4AF37]">
                        <CreditCard className="w-4 h-4" />
                      </div>
                    </div>
                    <div className="mt-2">
                      <div className="grid grid-cols-2 gap-1.5">
                        <div className="bg-gray-50 dark:bg-[#141414] border border-rose-500/30 rounded-lg px-2 py-1 flex items-center justify-between">
                          <span className="text-[10px] font-medium text-rose-600 dark:text-rose-400">Pending</span>
                          <span className="text-xs font-bold text-gray-900 dark:text-white font-mono">{paymentPipelineMetrics.pending}</span>
                        </div>
                        <div className="bg-gray-50 dark:bg-[#141414] border border-amber-500/30 rounded-lg px-2 py-1 flex items-center justify-between">
                          <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">Sent</span>
                          <span className="text-xs font-bold text-gray-900 dark:text-white font-mono">{paymentPipelineMetrics.sent}</span>
                        </div>
                        <div className="bg-gray-50 dark:bg-[#141414] border border-amber-500/30 rounded-lg px-2 py-1 flex items-center justify-between">
                          <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">Partial</span>
                          <span className="text-xs font-bold text-gray-900 dark:text-white font-mono">{paymentPipelineMetrics.partiallyPaid}</span>
                        </div>
                        <div className="bg-gray-50 dark:bg-[#141414] border border-[#D4AF37]/40 rounded-lg px-2 py-1 flex items-center justify-between">
                          <span className="text-[10px] font-medium text-[#D4AF37]">Paid</span>
                          <span className="text-xs font-bold text-gray-900 dark:text-white font-mono">{paymentPipelineMetrics.paid}</span>
                        </div>
                      </div>
                      <div className="mt-2 text-xs text-gray-500 dark:text-gray-400 flex items-center justify-between border-t border-gray-100 dark:border-[#2A2A2A] pt-2">
                        <span>Total Projects:</span>
                        <span className="font-mono text-gray-800 dark:text-gray-200 font-semibold">{paymentPipelineMetrics.total} Total</span>
                      </div>
                    </div>
                  </div>

                  {/* 7. Avg Cost per Project */}
                  <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] hover:border-[#D4AF37]/60 rounded-xl p-4 transition-all shadow-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Avg Cost / Project</span>
                      <div className="p-2 rounded-lg bg-gray-100 dark:bg-[#121212] text-[#D4AF37]">
                        <PieChart className="w-4 h-4" />
                      </div>
                    </div>
                    <div className="mt-2">
                      <div className="text-2xl font-bold text-gray-900 dark:text-white font-mono">
                        {formatCurrency(financialMetrics.avgCostPerProject)}
                      </div>
                      <div className="mt-2 text-xs text-gray-500 dark:text-gray-400 flex items-center justify-between border-t border-gray-100 dark:border-[#2A2A2A] pt-2">
                        <span>Across Projects:</span>
                        <span className="font-mono text-gray-700 dark:text-gray-300">{financialMetrics.totalProjectsCount} Total</span>
                      </div>
                    </div>
                  </div>

                  {/* 8. Outstanding Receivables */}
                  <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] hover:border-[#D4AF37]/60 rounded-xl p-4 transition-all shadow-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Outstanding Receivables</span>
                      <div className="p-2 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
                        <Clock className="w-4 h-4" />
                      </div>
                    </div>
                    <div className="mt-2">
                      <div className="text-2xl font-bold text-amber-600 dark:text-amber-400 font-mono">
                        {formatCurrency(invoiceMetrics.outstandingReceivables)}
                      </div>
                      <div className="mt-2 text-xs text-gray-500 dark:text-gray-400 flex items-center justify-between border-t border-gray-100 dark:border-[#2A2A2A] pt-2">
                        <span>Pending Receivables:</span>
                        <span className="font-semibold text-amber-600 dark:text-amber-400">{invoiceMetrics.outstandingCount} Unpaid</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Master Insights Analytics Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
                  {/* Panel 1: Cash Flow Projection */}
                  <div className="bg-white dark:bg-[#1E1E1E] rounded-xl p-5 border border-gray-200 dark:border-[#333333] hover:border-[#D4AF37]/40 transition-all lg:col-span-2 flex flex-col justify-between shadow-sm">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
                      <div>
                        <div className="flex items-center space-x-2">
                          <LineChart className="w-4 h-4 text-[#D4AF37]" />
                          <h3 className="text-base font-semibold text-gray-900 dark:text-white">Cash Flow Projection</h3>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">12-Month Revenue & Commission Expense Comparison</p>
                      </div>
                      <div className="flex items-center space-x-4 text-xs font-mono">
                        <div className="flex items-center space-x-1.5">
                          <span className="w-3 h-3 rounded-sm bg-[#D4AF37] inline-block shadow-sm"></span>
                          <span className="text-gray-600 dark:text-gray-300">Revenue</span>
                        </div>
                        <div className="flex items-center space-x-1.5">
                          <span className="w-3 h-3 rounded-sm bg-[#E57373] inline-block shadow-sm"></span>
                          <span className="text-gray-600 dark:text-gray-300">Expenses</span>
                        </div>
                      </div>
                    </div>

                    <div className="w-full h-72 min-h-[288px] min-w-0 pt-2">
                      <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={260}>
                        <AreaChart data={monthlyChartData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                          <defs>
                            <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#D4AF37" stopOpacity={0.4} />
                              <stop offset="95%" stopColor="#D4AF37" stopOpacity={0.0} />
                            </linearGradient>
                            <linearGradient id="colorExpenses" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#E57373" stopOpacity={0.35} />
                              <stop offset="95%" stopColor="#E57373" stopOpacity={0.0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke={theme === 'dark' ? '#2A2A2A' : '#E5E7EB'} vertical={false} />
                          <XAxis
                            dataKey="name"
                            stroke="#888888"
                            tick={{ fill: theme === 'dark' ? '#888888' : '#6B7280', fontSize: 11 }}
                            tickLine={{ stroke: theme === 'dark' ? '#333333' : '#E5E7EB' }}
                          />
                          <YAxis
                            stroke="#888888"
                            tick={{ fill: theme === 'dark' ? '#888888' : '#6B7280', fontSize: 11 }}
                            tickLine={{ stroke: theme === 'dark' ? '#333333' : '#E5E7EB' }}
                            tickFormatter={(val: number) => {
                              if (val === 0) return '₹0';
                              if (Math.abs(val) >= 10000000) return `₹${(val / 10000000).toFixed(1)}Cr`;
                              if (Math.abs(val) >= 100000) return `₹${(val / 100000).toFixed(1)}L`;
                              if (Math.abs(val) >= 1000) return `₹${(val / 1000).toFixed(0)}k`;
                              return `₹${val}`;
                            }}
                          />
                          <Tooltip
                            content={({ active, payload, label }) => {
                              if (active && payload && payload.length) {
                                const rev = Number(payload[0]?.value || 0);
                                const exp = Number(payload[1]?.value || 0);
                                const margin = rev - exp;
                                return (
                                  <div className="bg-white dark:bg-[#181818] border border-gray-200 dark:border-[#3A3A3A] p-3 rounded-lg shadow-xl text-xs space-y-1.5 font-mono">
                                    <div className="font-bold text-gray-900 dark:text-gray-200 border-b border-gray-100 dark:border-[#2E2E2E] pb-1">
                                      {label} Financials
                                    </div>
                                    <div className="flex justify-between items-center space-x-4 text-[#D4AF37]">
                                      <span>Revenue:</span>
                                      <span className="font-semibold">{formatCurrency(rev)}</span>
                                    </div>
                                    <div className="flex justify-between items-center space-x-4 text-rose-500 dark:text-[#E57373]">
                                      <span>Expenses:</span>
                                      <span className="font-semibold">{formatCurrency(exp)}</span>
                                    </div>
                                    <div className="flex justify-between items-center space-x-4 border-t border-gray-100 dark:border-[#2E2E2E] pt-1 text-emerald-600 dark:text-emerald-400 font-semibold">
                                      <span>Net Margin:</span>
                                      <span>{formatCurrency(margin)}</span>
                                    </div>
                                  </div>
                                );
                              }
                              return null;
                            }}
                          />
                          <Area
                            type="monotone"
                            dataKey="revenue"
                            stroke="#D4AF37"
                            strokeWidth={2.5}
                            fillOpacity={1}
                            fill="url(#colorRevenue)"
                            name="Revenue"
                          />
                          <Area
                            type="monotone"
                            dataKey="expenses"
                            stroke="#E57373"
                            strokeWidth={2}
                            fillOpacity={1}
                            fill="url(#colorExpenses)"
                            name="Expenses"
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Panel 2: Revenue Breakdown */}
                  <div className="bg-white dark:bg-[#1E1E1E] rounded-xl p-5 border border-gray-200 dark:border-[#333333] hover:border-[#D4AF37]/40 transition-all flex flex-col justify-between shadow-sm">
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center space-x-2">
                          <Receipt className="w-4 h-4 text-[#D4AF37]" />
                          <h3 className="text-base font-semibold text-gray-900 dark:text-white">Revenue Breakdown</h3>
                        </div>
                        <span className="text-[11px] bg-gray-100 dark:bg-[#121212] border border-gray-200 dark:border-[#333333] px-2 py-0.5 rounded-full text-gray-600 dark:text-gray-400 font-mono">
                          Invoice Status
                        </span>
                      </div>

                      <div className="mt-2 p-3.5 rounded-lg bg-gray-50 dark:bg-[#141414] border border-gray-200 dark:border-[#2A2A2A]">
                        <div className="text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-400 font-semibold">
                          Total Invoiced Revenue
                        </div>
                        <div className="text-2xl font-bold text-gray-900 dark:text-white font-mono mt-1">
                          {formatCurrency(revenueBreakdown.totalRevenue)}
                        </div>
                      </div>

                      {/* Segmented Progress */}
                      {(() => {
                        const total = revenueBreakdown.totalRevenue;
                        const clearedPct = total > 0 ? Math.round((revenueBreakdown.clearedRevenue / total) * 100) : 0;
                        const unclearedPct = total > 0 ? 100 - clearedPct : 0;

                        return (
                          <div className="mt-4 space-y-2">
                            <div className="flex justify-between text-xs font-mono">
                              <span className="text-emerald-600 dark:text-emerald-400 font-medium">Cleared: {clearedPct}%</span>
                              <span className="text-amber-600 dark:text-amber-400 font-medium">Uncleared: {unclearedPct}%</span>
                            </div>
                            <div className="w-full h-2.5 bg-gray-200 dark:bg-[#121212] rounded-full overflow-hidden flex border border-gray-300 dark:border-[#2A2A2A]">
                              <div
                                className="bg-emerald-500 h-full transition-all duration-500 rounded-l-full"
                                style={{ width: `${clearedPct}%` }}
                              />
                              <div
                                className="bg-[#D4AF37] h-full transition-all duration-500 rounded-r-full"
                                style={{ width: `${unclearedPct}%` }}
                              />
                            </div>
                          </div>
                        );
                      })()}

                      <div className="mt-4 space-y-2">
                        <div className="p-2.5 rounded-lg bg-gray-50 dark:bg-[#181818] border border-gray-200 dark:border-[#2A2A2A] flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-sm" />
                            <div>
                              <div className="text-xs font-semibold text-gray-800 dark:text-gray-200">Cleared Revenue</div>
                              <div className="text-[11px] text-gray-500 dark:text-gray-400">{revenueBreakdown.paidCount} Paid Invoices</div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                              {formatCurrency(revenueBreakdown.clearedRevenue)}
                            </div>
                          </div>
                        </div>

                        <div className="p-2.5 rounded-lg bg-gray-50 dark:bg-[#181818] border border-gray-200 dark:border-[#2A2A2A] flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <div className="w-2 h-2 rounded-full bg-amber-500 shadow-sm" />
                            <div>
                              <div className="text-xs font-semibold text-gray-800 dark:text-gray-200">Uncleared Revenue</div>
                              <div className="text-[11px] text-gray-500 dark:text-gray-400">{revenueBreakdown.pendingCount} Pending / Draft</div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-xs font-bold text-amber-600 dark:text-amber-400 font-mono">
                              {formatCurrency(revenueBreakdown.unclearedRevenue)}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 pt-3 border-t border-gray-100 dark:border-[#2A2A2A] flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                      <span>Collection Efficiency:</span>
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400 font-mono">
                        {revenueBreakdown.totalRevenue > 0
                          ? `${Math.round((revenueBreakdown.clearedRevenue / revenueBreakdown.totalRevenue) * 100)}% Collected`
                          : 'No Billings'}
                      </span>
                    </div>
                  </div>

                  {/* Panel 3: Star Client & Top Performer */}
                  <div className="lg:col-span-3 grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Star Client Card */}
                    <div className="bg-white dark:bg-[#1E1E1E] rounded-xl p-5 border border-gray-200 dark:border-[#333333] hover:border-[#D4AF37]/60 transition-all shadow-sm flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center space-x-2.5">
                            <div className="p-2 rounded-lg bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/30">
                              <Trophy className="w-4 h-4" />
                            </div>
                            <div>
                              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#D4AF37]">
                                Star Client
                              </span>
                              <h4 className="text-xs text-gray-500 dark:text-gray-400">Top Revenue Account</h4>
                            </div>
                          </div>
                          <span className="text-[11px] bg-gray-100 dark:bg-[#121212] border border-gray-200 dark:border-[#333333] px-2 py-0.5 rounded-full text-gray-600 dark:text-gray-400 font-mono">
                            Rank #1
                          </span>
                        </div>

                        <div className="mt-2">
                          <div className="text-lg font-bold text-gray-900 dark:text-white tracking-wide">
                            {toTitleCase(starClient.name)}
                          </div>
                          <div className="mt-2 flex items-baseline space-x-2">
                            <span className="text-xl font-bold text-[#D4AF37] font-mono">
                              {formatCurrency(starClient.revenue)}
                            </span>
                            <span className="text-xs text-gray-500 dark:text-gray-400">Total Invoiced</span>
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 pt-3 border-t border-gray-100 dark:border-[#2A2A2A] flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                        <span>Delivered Projects:</span>
                        <span className="font-semibold text-gray-800 dark:text-gray-200 font-mono">
                          {starClient.projectCount} {starClient.projectCount === 1 ? 'Project' : 'Projects'}
                        </span>
                      </div>
                    </div>

                    {/* Top Performer Card */}
                    <div className="bg-white dark:bg-[#1E1E1E] rounded-xl p-5 border border-gray-200 dark:border-[#333333] hover:border-[#D4AF37]/60 transition-all shadow-sm flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center space-x-2.5">
                            <div className="p-2 rounded-lg bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/30">
                              <Star className="w-4 h-4" />
                            </div>
                            <div>
                              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#D4AF37]">
                                Top Performer
                              </span>
                              <h4 className="text-xs text-gray-500 dark:text-gray-400">Commission Growth Leader</h4>
                            </div>
                          </div>
                          <span className="text-[11px] bg-gray-100 dark:bg-[#121212] border border-gray-200 dark:border-[#333333] px-2 py-0.5 rounded-full text-gray-600 dark:text-gray-400 font-mono">
                            {topPerformers.topPerformer?.role || 'Team Lead'}
                          </span>
                        </div>

                        <div className="mt-2">
                          <div className="text-lg font-bold text-gray-900 dark:text-white tracking-wide">
                            {topPerformers.topPerformer ? formatIndianName(topPerformers.topPerformer.name) : 'No Commissions Logged'}
                          </div>
                          <div className="mt-2 flex items-baseline space-x-2">
                            <span className="text-xl font-bold text-[#D4AF37] font-mono">
                              {formatCurrency(topPerformers.topPerformer?.totalEarnedYear || 0)}
                            </span>
                            <span className="text-xs text-gray-500 dark:text-gray-400">Earned This Year</span>
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 pt-3 border-t border-gray-100 dark:border-[#2A2A2A] flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                        <span>Projects & Pace:</span>
                        <span className="font-semibold text-gray-800 dark:text-gray-200 font-mono">
                          {topPerformers.topPerformer?.projectCount || 0} Projects • {formatCurrency(topPerformers.topPerformer?.totalEarnedMonth || 0)} this month
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Other Tabs */}
            {(activeTab === 'Clients' || activeTab.toLowerCase() === 'clients') && (
              <div className="w-full space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div className="flex items-center space-x-3">
                    <div className="p-2 rounded-lg bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/30">
                      <Briefcase className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-gray-900 dark:text-white tracking-wide">Approved Clients Directory</h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        Verified enterprise client profiles, commercial taxation details, and assigned sales representatives.
                      </p>
                    </div>
                  </div>

                  <div className="relative">
                    <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={clientSearchTerm}
                      onChange={(e) => setClientSearchTerm(e.target.value)}
                      placeholder="Search company, contact, city, GSTIN..."
                      className="bg-white dark:bg-[#1E1E1E] border border-gray-300 dark:border-[#333333] rounded-lg pl-9 pr-4 py-2 text-xs text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:border-[#D4AF37] w-64 sm:w-80"
                    />
                  </div>
                </div>

                <div className="bg-white dark:bg-[#1E1E1E] rounded-xl shadow-sm p-5 border border-gray-200 dark:border-[#333333] overflow-hidden">
                  <div className="overflow-x-auto whitespace-nowrap">
                    <table className="w-full text-left text-xs whitespace-nowrap">
                      <thead>
                        <tr className="text-gray-500 dark:text-gray-400 text-[11px] uppercase border-b border-gray-200 dark:border-[#333333]">
                          <th className="pb-3 px-4 font-semibold">Company Name</th>
                          <th className="pb-3 px-4 font-semibold">Contact Person</th>
                          <th className="pb-3 px-4 font-semibold">Phone</th>
                          <th className="pb-3 px-4 font-semibold">Email</th>
                          <th className="pb-3 px-4 font-semibold">City</th>
                          <th className="pb-3 px-4 font-semibold">GSTIN</th>
                          <th className="pb-3 px-4 font-semibold">Pricing Tier</th>
                          <th className="pb-3 px-4 font-semibold text-center">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-[#2A2A2A]">
                        {clients.map((client, idx) => (
                          <tr key={client.id || idx} className="hover:bg-gray-50 dark:hover:bg-[#252525] transition-colors">
                            <td className="py-3 px-4 font-bold text-[#D4AF37]">{toTitleCase(client.companyName)}</td>
                            <td className="py-3 px-4 text-gray-800 dark:text-gray-200">{formatIndianName(client.contactPerson || '—')}</td>
                            <td className="py-3 px-4 font-mono text-gray-600 dark:text-gray-400">{client.phone || client.mobile || '—'}</td>
                            <td className="py-3 px-4 font-mono text-gray-600 dark:text-gray-400 text-[11px]">{client.email || '—'}</td>
                            <td className="py-3 px-4 text-gray-700 dark:text-gray-300">{toTitleCase(client.city || '—')}</td>
                            <td className="py-3 px-4 font-mono text-gray-700 dark:text-gray-300">{client.gstin || '—'}</td>
                            <td className="py-3 px-4">
                              <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-gray-100 dark:bg-[#121212] border border-gray-200 dark:border-[#333333] text-gray-700 dark:text-gray-300">
                                {client.pricingCategory || 'T1'}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-center">
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                                Approved
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {(activeTab === 'Projects' || activeTab.toLowerCase() === 'projects') && (
              <ProjectsDirectory
                projects={financialProjects.length > 0 ? financialProjects : (projects || [])}
                clients={clients || []}
                users={users || []}
                invoices={invoices || []}
                onUpdateProject={handleUpdateProject}
                onDeleteProject={handleDeleteProjectDirectly}
                renderTimeFilterControls={renderTimeFilterControls}
              />
            )}

            {(activeTab === 'Billing' || activeTab.toLowerCase() === 'billing') && (
              <BillingModule clients={clients || []} projects={financialProjects.length > 0 ? financialProjects : (projects || [])} pricingRules={pricingRules || []} />
            )}

            {(activeTab === 'Salary Studio' || activeTab.toLowerCase() === 'salary studio' || activeTab.toLowerCase() === 'salary') && (
              <SalaryStudio 
                users={users || []} 
                projects={financialProjects.length > 0 ? financialProjects : (projects || [])} 
                commissionRules={commissionRules || []}
                onNavigateToGlobalSettings={() => setActiveTab('Settings')}
              />
            )}

            {(activeTab === 'Pricing Rules' || activeTab.toLowerCase() === 'pricing' || activeTab.toLowerCase() === 'pricing rules') && (
              <PricingRulesView 
                pricingRules={pricingRules || []}
                commissionRules={commissionRules || []}
                clients={clients || []}
                projects={financialProjects.length > 0 ? financialProjects : (projects || [])}
                onNavigateToProposals={() => setActiveTab('Proposals')}
                onNavigateToProjects={() => setActiveTab('Projects')}
              />
            )}

            {(activeTab === 'Proposals' || activeTab.toLowerCase() === 'proposals') && (
              <ProposalsView 
                proposals={proposals || []}
                clients={clients || []}
                projects={financialProjects.length > 0 ? financialProjects : (projects || [])}
                pricingRules={pricingRules || []}
                onNavigateToProjects={() => setActiveTab('Projects')}
                onNavigateToBilling={() => setActiveTab('Billing')}
                onNavigateToPricing={() => setActiveTab('Pricing Rules')}
              />
            )}

            {(activeTab === 'Employees' || activeTab.toLowerCase() === 'employees') && (
              <EmployeeDirectory
                users={users || []}
                setUsers={setUsers}
                clients={clients || []}
                projects={financialProjects.length > 0 ? financialProjects : (projects || [])}
                onNavigateToSalaryStudio={() => setActiveTab('Salary Studio')}
              />
            )}

            {(activeTab === 'Settings' || activeTab.toLowerCase() === 'settings') && (
              <CompanySettingsView onNavigateToBilling={() => setActiveTab('Billing')} />
            )}
          </div>
        </main>
      </div>

      {/* Edit Project Modal */}
      {isEditProjectModalOpen && editingProject && (
        <EditProjectModal
          isOpen={isEditProjectModalOpen}
          project={editingProject}
          clients={clients}
          users={users}
          onClose={() => {
            setIsEditProjectModalOpen(false);
            setEditingProject(null);
          }}
          onSave={handleUpdateProject}
          isSaving={false}
        />
      )}

      {/* Delete Confirmation Modal */}
      {projectPendingDeletion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] rounded-xl shadow-2xl w-full max-w-sm overflow-hidden p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 rounded-full bg-rose-500/10 text-rose-500">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-gray-900 dark:text-white">Delete Project</h3>
            </div>
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-4">
              Are you sure you want to permanently delete <span className="font-semibold text-gray-900 dark:text-white">{toTitleCase(projectPendingDeletion.projectName)}</span>?
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setProjectPendingDeletion(null)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-600 dark:text-gray-400"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDeleteProject}
                disabled={isDeletingProject}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white"
              >
                {isDeletingProject ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
