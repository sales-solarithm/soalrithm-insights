'use client';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { collection, onSnapshot, doc, updateDoc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { db, auth } from '@/src/lib/firebase';
import { useOwnerAuth } from '@/src/context/OwnerAuthContext';
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
  ArrowUpRight,
  RotateCcw,
  Filter,
  LineChart,
  Clock,
  Trophy,
  Star,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  CreditCard,
  Banknote,
  LogOut,
  ShieldCheck
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend
} from 'recharts';
import { COLLECTIONS, PROJECT_FIELDS, CLIENT_FIELDS, CLIENT_STATUS } from '@/src/config/schema';
import { STORAGE_KEYS } from '@/src/lib/invoicePdfEngine';
import BillingModule from '@/src/components/Billing';
import CompanySettingsView from '@/src/components/CompanySettingsView';
import SalaryStudio from '@/src/components/SalaryStudio';
import EmployeeDirectory from '@/src/components/EmployeeDirectory';

const parseSafeDate = (dateVal: any): Date | null => {
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

const formatSafeDate = (dateVal: any, formatType: 'input' | 'display' | 'slash' = 'display'): string => {
  const d = parseSafeDate(dateVal);
  if (!d) return "";
  try {
    if (formatType === 'input') {
      return d.toISOString().split('T')[0];
    }
    if (formatType === 'slash') {
      return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    }
    return d.toLocaleDateString();
  } catch {
    return "";
  }
};

const MONTH_OPTIONS = [
  { value: 'all', label: 'All Months' },
  { value: '0', label: 'January' },
  { value: '1', label: 'February' },
  { value: '2', label: 'March' },
  { value: '3', label: 'April' },
  { value: '4', label: 'May' },
  { value: '5', label: 'June' },
  { value: '6', label: 'July' },
  { value: '7', label: 'August' },
  { value: '8', label: 'September' },
  { value: '9', label: 'October' },
  { value: '10', label: 'November' },
  { value: '11', label: 'December' },
];

const toTitleCase = (str: any): string => {
  if (str === null || str === undefined) return '';
  if (typeof str !== 'string') {
    if (typeof str === 'number') return String(str);
    if (typeof str === 'object') {
      if (str.name) return toTitleCase(String(str.name));
      if (str.label) return toTitleCase(String(str.label));
      if (str.title) return toTitleCase(String(str.title));
      if (str.companyName) return toTitleCase(String(str.companyName));
      return '';
    }
    return String(str);
  }
  return str
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

// Split-scope architecture: canonical scope keys -> display labels.
// A project's `assignedScopes` map (e.g. { preDesign: 'a@x.com', ceig: 'b@x.com' })
// lets each deliverable scope be assigned to a different designer.
const SCOPE_LABELS: Record<string, string> = {
  preDesign: 'Pre-Design',
  ceig: 'CEIG',
  ifp: 'IFP',
  pvsyst: 'PVsyst',
};

const getProjectDate = (project: any): Date | null => {
  if (!project) return null;
  return parseSafeDate(
    project.createdAt || 
    project.created_at || 
    project.date || 
    project.projectDate || 
    project.dateCreated || 
    project.updatedAt || 
    project.updated_at ||
    project.invDate
  );
};

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState('Dashboard');
  const [projects, setProjects] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [pricingRules, setPricingRules] = useState<any[]>([]);
  const [commissionRules, setCommissionRules] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [apps, setApps] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [proposals, setProposals] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [salaryHistory, setSalaryHistory] = useState<any[]>([]);
  
  // Executive profile & session controls
  const { 
    ownerProfile, 
    signOut: handleSignOut 
  } = useOwnerAuth();
  const executiveProfile = ownerProfile || {
    name: 'Executive Owner',
    email: 'owner@solarithmdesign.com',
    role: 'owner'
  };

  // Time-based filtering state
  const [selectedMonth, setSelectedMonth] = useState<string>('all');
  const [selectedYear, setSelectedYear] = useState<string>('all');
  const [expensePeriod, setExpensePeriod] = useState<'monthly' | 'quarterly' | 'yearly' | 'all'>('monthly');

  // Pricing Rules Filter States
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedScope, setSelectedScope] = useState('');
  const [selectedSubService, setSelectedSubService] = useState('');
  const [clientSearchTerm, setClientSearchTerm] = useState('');

  // Modal states
  const [isEditProjectModalOpen, setIsEditProjectModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<any>(null);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);

  useEffect(() => {
    let unsubscribeProjects: (() => void) | undefined;
    let unsubscribeClients: (() => void) | undefined;
    let unsubscribePricing: (() => void) | undefined;
    let unsubscribeUsers: (() => void) | undefined;
    let unsubscribeEmployees: (() => void) | undefined;
    let unsubscribeApps: (() => void) | undefined;
    let unsubscribeProposals: (() => void) | undefined;
    let unsubscribeCommissions: (() => void) | undefined;
    let unsubscribeInvoices: (() => void) | undefined;
    let unsubscribeSalaryHistory: (() => void) | undefined;
    let unsubscribeAuditLogs: (() => void) | undefined;

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

      // Synchronize employee directory & user profiles with Solarithm Master Blueprint
      let employeesMap: Record<string, any> = {};
      let usersMap: Record<string, any> = {};

      const syncEmployeesAndUsers = () => {
        const map = new Map<string, any>();
        // Process users store
        Object.values(usersMap).forEach(u => {
          const key = (u.email || u.id || '').toLowerCase();
          if (key) map.set(key, u);
        });
        // Merge primary employees directory records (highest authoritative KYC store)
        Object.values(employeesMap).forEach(emp => {
          const key = (emp.email || emp.id || '').toLowerCase();
          if (key) {
            const existing = map.get(key) || {};
            map.set(key, { ...existing, ...emp });
          } else {
            map.set(emp.id, emp);
          }
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

      unsubscribeApps = onSnapshot(collection(db, COLLECTIONS.REGISTERED_APPS), (snapshot) => {
        const appsData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setApps(appsData);
      }, (err) => {
        console.warn("Firestore registeredApps listener error:", err);
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

      unsubscribeAuditLogs = onSnapshot(collection(db, COLLECTIONS.AUDIT_LOGS), (snapshot) => {
        const logsData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setAuditLogs(logsData);
      }, (err) => {
        console.warn("Firestore auditLogs listener error:", err);
      });
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
      if (unsubscribeApps) unsubscribeApps();
      if (unsubscribeProposals) unsubscribeProposals();
      if (unsubscribeCommissions) unsubscribeCommissions();
      if (unsubscribeSalaryHistory) unsubscribeSalaryHistory();
      if (unsubscribeAuditLogs) unsubscribeAuditLogs();
    };
  }, []);

  const financialProjects = useMemo(() => {
    return projects.map((project) => {
      const matchedClient = clients.find(
        (c) => c.id === project.clientId || c.companyName === project.clientName
      );

      const activeCategory = String(
        project.pricingCategory || 
        (matchedClient && matchedClient.pricingCategory) || 
        'T1'
      ).toLowerCase().trim();

      const rawCapacity = String(project.plantCapacity || project.systemCapacity || project.capacity || '0');
      const capacity = parseFloat(rawCapacity.replace(/[^\d.]/g, '')) || 0;
      
      const scope = String(project.scopeOfWork || '').toLowerCase().trim();
      const subService = String(project.subService || 'Standard').toLowerCase().trim();

      // 1. HISTORICAL DATA LOCK
      let calculatedCost = 0;
      let isCostLocked = false;
      
      if (project.finalCost !== undefined && project.finalCost !== null && !isNaN(Number(project.finalCost)) && Number(project.finalCost) > 0) {
        calculatedCost = Number(project.finalCost);
        isCostLocked = true;
      } else if (project.calculatedCost !== undefined && project.calculatedCost !== null && !isNaN(Number(project.calculatedCost)) && Number(project.calculatedCost) > 0) {
        calculatedCost = Number(project.calculatedCost);
        isCostLocked = true;
      } else if (project.cost !== undefined && project.cost !== null && !isNaN(Number(project.cost)) && Number(project.cost) > 0) {
        calculatedCost = Number(project.cost);
        isCostLocked = true;
      } else if (project.amount !== undefined && project.amount !== null && !isNaN(Number(project.amount)) && Number(project.amount) > 0) {
        calculatedCost = Number(project.amount);
        isCostLocked = true;
      } else if (project.totalCost !== undefined && project.totalCost !== null && !isNaN(Number(project.totalCost)) && Number(project.totalCost) > 0) {
        calculatedCost = Number(project.totalCost);
        isCostLocked = true;
      } else if (project.price !== undefined && project.price !== null && !isNaN(Number(project.price)) && Number(project.price) > 0) {
        calculatedCost = Number(project.price);
        isCostLocked = true;
      }

      let finalMatchedRule = null;

      // 2. DYNAMIC CALCULATION
      if (!isCostLocked) {
        const matchedRule = pricingRules.find(
          (rule) => {
            const ruleCategory = String(rule.category || 'Standard').toLowerCase().trim();
            const ruleScope = String(rule.scope || rule.scopeOfWork || '').toLowerCase().trim();
            const ruleSubService = String(rule.subService || 'Standard').toLowerCase().trim();
            
            return ruleCategory === activeCategory && ruleScope === scope && ruleSubService === subService;
          }
        );

        if (matchedRule && Array.isArray(matchedRule.capacityRows)) {
          // 3. CAPACITY RANGE PARSING
          for (const row of matchedRule.capacityRows) {
            const range = String(row.capacityRange || '').toUpperCase().trim();
            let isMatch = false;

            if (range.includes('-')) {
              const [minStr, maxStr] = range.split('-');
              const min = Number(minStr);
              const max = Number(maxStr);
              if (capacity >= min && capacity <= max) {
                isMatch = true;
              }
            } else if (range.includes('ABOVE') || range.includes('>')) {
              const min = Number(range.replace('ABOVE', '').replace('>', '').trim());
              if (capacity > min) {
                isMatch = true;
              }
            } else if (range.includes('UP TO') || range.includes('<=')) {
              const max = Number(range.replace('UP TO', '').replace('<=', '').trim());
              if (capacity <= max) {
                isMatch = true;
              }
            } else if (range.includes('<')) {
              const max = Number(range.replace('<', '').trim());
              if (capacity < max) {
                isMatch = true;
              }
            }

            if (isMatch) {
              finalMatchedRule = row;
              // 4. PRICE TYPE MATH
              const price = Number(row.price || row.basePrice || 0);
              if (row.priceType === 'Per KW' || row.priceType === 'Per kW') {
                calculatedCost = price * capacity;
              } else {
                calculatedCost = price; // Fixed
              }
              break;
            }
          }
        }
        if (calculatedCost === 0 && matchedRule && (matchedRule.basePrice || matchedRule.price)) {
          calculatedCost = Number(matchedRule.basePrice || matchedRule.price || 0);
        }
      }

      // 5. COMMISSION ENGINE
      const calculateCommission = (role: string) => {
        // Explicit value on project takes absolute priority regardless of status
        const lockedVal = role === 'designer' 
          ? (project.designerCommission ?? project.financials?.designerCommission)
          : (project.salesCommission ?? project.financials?.salesCommission);
        
        if (lockedVal !== undefined && lockedVal !== null && String(lockedVal).trim() !== '') {
          const numVal = Number(lockedVal);
          if (!isNaN(numVal) && numVal > 0) {
            return numVal;
          }
        }

        let matchedRule = commissionRules.find(rule => {
          const ruleRole = String(rule.role || '').toLowerCase().trim();
          const ruleScope = String(rule.scope || rule.scopeOfWork || '').toLowerCase().trim();
          const ruleSubService = String(rule.subService || 'Standard').toLowerCase().trim();
          return ruleRole === role && ruleScope === scope && ruleSubService === subService;
        });

        if (!matchedRule) {
          // Fallback to Standard subService
          matchedRule = commissionRules.find(rule => {
            const ruleRole = String(rule.role || '').toLowerCase().trim();
            const ruleScope = String(rule.scope || rule.scopeOfWork || '').toLowerCase().trim();
            const ruleSubService = String(rule.subService || 'Standard').toLowerCase().trim();
            return ruleRole === role && ruleScope === scope && ruleSubService === 'standard';
          });
        }

        if (matchedRule && Array.isArray(matchedRule.capacityRows)) {
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
              const rawCommission = (type.includes('kw')) ? (price * capacity) : price;
              
              const maxCap = (matchedRule.maxCommission !== undefined && matchedRule.maxCommission !== null && String(matchedRule.maxCommission).trim() !== '')
                ? Number(matchedRule.maxCommission)
                : 0;

              if (!isNaN(maxCap) && maxCap > 0) {
                return Math.min(rawCommission, maxCap);
              }
              return rawCommission;
            }
          }
        }
        return 0;
      };

      const designerCommission = calculateCommission('designer');
      const salesCommission = calculateCommission('sales');

      const directComm = Number(project.commission ?? project.totalCommission ?? project.incentive ?? 0);
      let totalCommissionExpense = designerCommission + salesCommission;
      if (totalCommissionExpense === 0 && !isNaN(directComm) && directComm > 0) {
        totalCommissionExpense = directComm;
      }

      if (Array.isArray(project.employeeCommissions)) {
        const arrSum = project.employeeCommissions.reduce((sum: number, c: any) => sum + (Number(c.amount || c.commission || 0) || 0), 0);
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

  const handleUpdateProject = async () => {
    if (!editingProject || !editingProject.id) return;
    const originalProject = projects.find(p => p.id === editingProject.id) || {};
    
    const updatedData: any = {
      projectName: editingProject.projectName || '',
      clientName: editingProject.clientName || '',
      status: editingProject.status || 'Active',
      scopeOfWork: editingProject.scopeOfWork || '',
      designerEmail: editingProject.designerEmail || '',
      salesPersonEmail: editingProject.salesPersonEmail || '',
      systemCapacity: editingProject.systemCapacity || editingProject.capacity || '',
      capacity: editingProject.capacity || editingProject.systemCapacity || '',
      plantCapacity: editingProject.plantCapacity || editingProject.systemCapacity || editingProject.capacity || '',
      subService: editingProject.subService || '',
      pricingCategory: editingProject.pricingCategory || '',
      createdAt: editingProject.createdAt || originalProject.createdAt,
      calculatedCost: Number(editingProject.calculatedCost) || 0,
      designerCommission: Number(editingProject.designerCommission) || 0,
      salesCommission: Number(editingProject.salesCommission) || 0
    };

    // Update local state immediately
    setProjects(prev => prev.map(p => p.id === editingProject.id ? { ...p, ...updatedData } : p));

    try {
      const projectRef = doc(db, COLLECTIONS.PROJECTS, editingProject.id);
      await updateDoc(projectRef, updatedData);
    } catch (error) {
      console.warn("Could not sync project update to Firestore:", error);
    }
    
    setIsEditProjectModalOpen(false);
    setEditingProject(null);
  };

  const stats = [
    { name: 'Billing', collection: 'invoices', icon: Receipt, count: invoices?.length || 0, color: 'text-[#D4AF37]' },
    { name: 'Salary Studio', collection: 'salary_slips', icon: Banknote, count: salaryHistory?.length || 0, color: 'text-[#D4AF37]' },
    { name: 'Clients', collection: COLLECTIONS.CLIENTS, icon: Briefcase, count: clients?.length || 0, color: 'text-[#D4AF37]' },
    { name: 'Projects', collection: COLLECTIONS.PROJECTS, icon: FolderKanban, count: projects?.length || 0, color: 'text-[#D4AF37]' },
    { name: 'Pricing Rules', collection: COLLECTIONS.PRICING_RULES, icon: Tags, count: pricingRules?.length || 0, color: 'text-[#D4AF37]' },
    { name: 'Proposals', collection: COLLECTIONS.PROPOSALS, icon: FileText, count: proposals?.length || 0, color: 'text-[#D4AF37]' },
    { name: 'Employees', collection: COLLECTIONS.EMPLOYEES, icon: Users, count: users?.length || 0, color: 'text-[#D4AF37]' },
    { name: 'Apps', collection: COLLECTIONS.REGISTERED_APPS, icon: LayoutGrid, count: apps?.length || 0, color: 'text-[#D4AF37]' },
  ];

  const availableDesigners = users.filter(u => String(u.department).toLowerCase() === 'designer' || String(u.role).toLowerCase() === 'designer');
  const availableSales = users.filter(u => String(u.department).toLowerCase() === 'sales' || String(u.role).toLowerCase() === 'sales');

  const getEmployeeName = useCallback((email: string | undefined | null) => {
    if (!email) return 'N/A';
    const user = users.find(u => u.email?.toLowerCase() === email?.toLowerCase());
    return user?.name || user?.displayName || email.split('@')[0];
  }, [users]);

  // Builds the "Pre-Design & PVsyst: Designer A | CEIG & IFP: Designer B" summary
  // for split-scope projects. Falls back to the legacy single `designerEmail`
  // field for projects that haven't been migrated to `assignedScopes` yet, so
  // existing single-designer projects render exactly as before.
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
          .map(([email, scopeLabels]) => `${scopeLabels.join(' & ')}: ${toTitleCase(getEmployeeName(email))}`)
          .join(' | ');
      }
    }
    // Legacy single-scope project: one designer for the whole project.
    return toTitleCase(getEmployeeName(project?.designerEmail));
  }, [getEmployeeName]);

  const getStatusBadge = (status: string) => {
    const baseClasses = "w-32 flex items-center justify-center px-2 py-1 rounded text-xs font-medium border text-center";
    switch(status?.toLowerCase()) {
      case 'design_approved':
      case 'approved':
      case 'completed':
      case 'finished':
        return <div className={`${baseClasses} bg-emerald-500/10 text-emerald-400 border-emerald-500/30`}>Approved</div>;
      case 'in_progress':
      case 'pending_design_approval':
      case 'active':
        return <div className={`${baseClasses} bg-amber-500/10 text-amber-400 border-amber-500/30`}>In Progress</div>;
      case 'in_revision':
        return <div className={`${baseClasses} bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/30`}>In Revision</div>;
      case 'not_started':
      case 'rejected':
      case 'cancelled':
        return <div className={`${baseClasses} bg-rose-500/10 text-rose-400 border-rose-500/30`}>Not Started</div>;
      default:
        return <div className={`${baseClasses} bg-gray-500/10 text-gray-400 border-gray-500/30`}>{status || 'Unknown'}</div>;
    }
  };

  const getProjectPaymentStatus = useCallback((project: any): { status: 'pending' | 'sent' | 'partially_paid' | 'paid'; label: string } => {
    if (!project) {
      return { status: 'pending', label: 'Payment Pending' };
    }

    // Direct status on project record has immediate precedence
    const explicitStatus = String(project.paymentStatus || project.payment_status || project.invoiceStatus || '').toLowerCase().trim();
    if (explicitStatus === 'paid' || explicitStatus === 'cleared') {
      return { status: 'paid', label: 'Paid' };
    }
    if (explicitStatus === 'partially paid' || explicitStatus === 'partially_paid' || explicitStatus === 'partial') {
      return { status: 'partially_paid', label: 'Partially Paid' };
    }
    if (explicitStatus === 'sent' || explicitStatus === 'invoiced') {
      return { status: 'sent', label: 'Invoice Sent' };
    }
    if (explicitStatus === 'pending' || explicitStatus === 'unpaid' || explicitStatus === 'due') {
      return { status: 'pending', label: 'Payment Pending' };
    }

    if (!invoices || invoices.length === 0) {
      return { status: 'pending', label: 'Payment Pending' };
    }

    const projId = project.id ? String(project.id).trim().toLowerCase() : '';
    const projName = String(project.projectName || project.name || '').trim().toLowerCase();

    // Find all invoices that include this project
    const matchingInvoices = invoices.filter((inv) => {
      if (projId && (inv.projectId === projId || (Array.isArray(inv.projectIds) && inv.projectIds.includes(projId)))) {
        return true;
      }
      if (!inv.rows || !Array.isArray(inv.rows)) return false;
      return inv.rows.some((row: any) => {
        const rowProjId = row.projectId ? String(row.projectId).trim().toLowerCase() : '';
        const rowDesc = String(row.desc || row.projectName || '').trim().toLowerCase();
        if (projId && (rowProjId === projId || String(row.id).toLowerCase() === projId)) return true;
        if (projName && rowDesc && (rowDesc === projName || rowDesc.includes(projName) || projName.includes(rowDesc))) return true;
        return false;
      });
    });

    if (matchingInvoices.length === 0) {
      return { status: 'pending', label: 'Payment Pending' };
    }

    // Check invoice statuses with precedence: paid > partially paid > sent > draft/pending
    const hasPaid = matchingInvoices.some((inv) => String(inv.status || '').toLowerCase().trim() === 'paid');
    if (hasPaid) return { status: 'paid', label: 'Paid' };

    const hasPartiallyPaid = matchingInvoices.some((inv) => {
      const s = String(inv.status || '').toLowerCase().trim();
      return s === 'partially paid' || s === 'partially_paid' || s === 'partial';
    });
    if (hasPartiallyPaid) return { status: 'partially_paid', label: 'Partially Paid' };

    const hasSent = matchingInvoices.some((inv) => String(inv.status || '').toLowerCase().trim() === 'sent');
    if (hasSent) return { status: 'sent', label: 'Invoice Sent' };

    return { status: 'pending', label: 'Payment Pending' };
  }, [invoices]);

  const getPaymentStatusBadge = (paymentInfo: { status: string; label: string }) => {
    const baseClasses = "w-32 flex items-center justify-center px-2 py-1 rounded text-xs font-semibold text-center";
    switch (paymentInfo.status) {
      case 'paid':
        return (
          <div className={`${baseClasses} bg-emerald-500/10 border border-emerald-500/30 text-emerald-400`}>
            {paymentInfo.label}
          </div>
        );
      case 'partially_paid':
        return (
          <div className={`${baseClasses} bg-amber-500/10 border border-amber-500/30 text-amber-400`}>
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
          <div className={`${baseClasses} bg-red-900/20 border border-red-500/60 text-red-400`}>
            {paymentInfo.label}
          </div>
        );
    }
  };

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(val);

  // Dynamic Available Years from Projects
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

  // Synchronized Filtered Financial Projects
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

  // Enterprise Financial Metrics Engine
  // Map "Total Expenses" to Employee Project Commissions
  // Strict formula: Net Profit = (Total YTD Revenue) - (Total Commission Expenses)
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

    filteredFinancialProjects.forEach((p) => {
      const cost = Number(p.calculatedCost || p.cost || p.amount || p.totalCost || 0);
      
      // Sum up all employee commission values assigned to this project
      const desComm = Number(p.designerCommission || 0);
      const salesComm = Number(p.salesCommission || 0);
      const totalCommExp = Number(p.totalCommissionExpense ?? (desComm + salesComm));
      
      const projectRevenue = isNaN(cost) ? 0 : cost;
      const projectExpense = isNaN(totalCommExp) ? 0 : totalCommExp;

      const d = getProjectDate(p);
      const projYear = d ? d.getFullYear() : currentYear;
      const projMonth = d ? d.getMonth() : currentMonth;
      const projQuarter = d ? Math.floor(projMonth / 3) : currentQuarter;

      totalRevenueAllTime += projectRevenue;
      totalExpensesAllTime += projectExpense;

      // Project belongs to targetYear or current calendar year
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

      // Track Client Volume
      const clientName = p.clientName || p.matchedClient?.companyName || 'Unknown Client';
      if (!clientRevenueMap[clientName]) {
        clientRevenueMap[clientName] = { revenue: 0, projectCount: 0 };
      }
      clientRevenueMap[clientName].revenue += projectRevenue;
      clientRevenueMap[clientName].projectCount += 1;
    });

    // If target year had 0 data because projects lack dates or belong to all years, ensure YTD reflects total available
    if (yearlyRevenue === 0 && totalRevenueAllTime > 0 && selectedYear === 'all') {
      yearlyRevenue = totalRevenueAllTime;
    }
    if (yearlyExpenses === 0 && totalExpensesAllTime > 0 && selectedYear === 'all') {
      yearlyExpenses = totalExpensesAllTime;
    }

    // Incorporate salaryHistory commissions if project-level commission wasn't attached
    if (yearlyExpenses === 0 && salaryHistory.length > 0) {
      salaryHistory.forEach((rec: any) => {
        const comm = Number(rec.incentive || rec.commission || rec.incentiveAmount || 0);
        if (!isNaN(comm) && comm > 0) {
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

    // Net Profit strictly calculated as: (Total YTD Revenue) - (Total Commission Expenses)
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
  }, [filteredFinancialProjects, clients, salaryHistory, selectedYear]);

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

  // Master Overview Invoice Metrics Engine: Dynamically syncs with projects & billing
  const invoiceMetrics = useMemo(() => {
    const now = new Date();
    const curMonth = now.getMonth();
    const curYear = now.getFullYear();

    // 1. Calculate from Invoices array
    const unpaidInvoices = invoices.filter(
      (inv) => String(inv.status || '').toLowerCase().trim() !== 'paid'
    );
    const invoiceReceivables = unpaidInvoices.reduce((acc, inv) => {
      const val = Number(inv.totals?.payable ?? inv.payable ?? inv.total ?? 0);
      return acc + (isNaN(val) ? 0 : val);
    }, 0);

    // 2. Calculate from Projects array (sum projects marked Pending, Unpaid, or Partial)
    let projectReceivables = 0;
    let pendingProjectsCount = 0;

    financialProjects.forEach((proj) => {
      const cost = Number(proj.calculatedCost || proj.cost || proj.amount || 0);
      const paymentInfo = getProjectPaymentStatus(proj);

      if (paymentInfo.status === 'paid') {
        // paid
      } else if (paymentInfo.status === 'partially_paid') {
        projectReceivables += cost * 0.5;
        pendingProjectsCount += 1;
      } else {
        // Pending, sent, or unpaid
        projectReceivables += cost;
        pendingProjectsCount += 1;
      }
    });

    // If invoices exist and contain receivables, use that. Otherwise use projectReceivables.
    const outstandingReceivables = invoiceReceivables > 0 
      ? invoiceReceivables 
      : (projectReceivables > 0 ? projectReceivables : 0);

    const outstandingCount = unpaidInvoices.length > 0 
      ? unpaidInvoices.length 
      : pendingProjectsCount;

    // Monthly invoices / project volume
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

  // Master Overview Payment Pipeline Project Counters
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

  // Master Insights - Revenue Breakdown (Cleared vs Uncleared)
  // Dynamically calculated from billing invoices, with project payment status fallback
  const revenueBreakdown = useMemo(() => {
    let clearedRevenue = 0;
    let unclearedRevenue = 0;
    let paidCount = 0;
    let pendingCount = 0;

    if (invoices.length > 0) {
      invoices.forEach((inv) => {
        const val = Number(inv.totals?.payable ?? inv.payable ?? inv.total ?? 0);
        const amount = isNaN(val) ? 0 : val;
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

    // If invoices have 0 revenue recorded, derive dynamically from project pipeline
    if (clearedRevenue === 0 && unclearedRevenue === 0 && financialProjects.length > 0) {
      financialProjects.forEach((proj) => {
        const cost = Number(proj.calculatedCost || proj.cost || proj.amount || 0);
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

  // Master Insights - Monthly Chart Data (Jan - Dec)
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
        const cost = Number(p.calculatedCost || p.cost || p.amount || 0);
        const exp = Number(p.totalCommissionExpense ?? (Number(p.designerCommission || 0) + Number(p.salesCommission || 0)));

        monthMap[projMonth].revenue += (isNaN(cost) ? 0 : cost);
        monthMap[projMonth].expenses += (isNaN(exp) ? 0 : exp);
      }
    });

    return monthNames.map((name, index) => ({
      name,
      revenue: monthMap[index].revenue,
      expenses: monthMap[index].expenses
    }));
  }, [financialProjects, selectedYear]);

  // Master Insights - Star Client (Highest Project Revenue)
  const starClient = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const targetYear = selectedYear !== 'all' ? Number(selectedYear) : currentYear;

    const clientRevenueMap: Record<string, { name: string; revenue: number; projectCount: number }> = {};

    financialProjects.forEach((p) => {
      const d = getProjectDate(p);
      const projYear = d ? d.getFullYear() : currentYear;

      if (selectedYear === 'all' || projYear === targetYear) {
        const cost = Number(p.calculatedCost || p.cost || p.amount || 0);
        const clientName = p.clientName || p.matchedClient?.companyName || 'Unknown Client';
        if (!clientRevenueMap[clientName]) {
          clientRevenueMap[clientName] = { name: clientName, revenue: 0, projectCount: 0 };
        }
        clientRevenueMap[clientName].revenue += (isNaN(cost) ? 0 : cost);
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

  // Master Insights - Top Performer (Employee grouped by salesPerson & designer)
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
      const empName = getEmployeeName(email);

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

      const desComm = Number(p.designerCommission || 0);
      const salesComm = Number(p.salesCommission || 0);

      const designerEmail = p.designerEmail;
      const salesPersonEmail = p.salesPersonEmail || p.matchedClient?.salesPersonEmail;

      if (designerEmail && !isNaN(desComm) && desComm > 0) {
        addCommission(designerEmail, desComm, isMonth, isYear, 'Designer');
      }
      if (salesPersonEmail && !isNaN(salesComm) && salesComm > 0) {
        addCommission(salesPersonEmail, salesComm, isMonth, isYear, 'Sales');
      }
    });

    // Also parse salaryHistory if present
    if (salaryHistory.length > 0) {
      salaryHistory.forEach((rec: any) => {
        const empEmail = rec.employeeEmail || rec.email || rec.employeeId;
        const comm = Number(rec.incentive || rec.commission || 0);
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

  // Reusable Time Filter Controls
  const renderTimeFilterControls = (idPrefix: string) => {
    const selectedMonthLabel = MONTH_OPTIONS.find(m => m.value === selectedMonth)?.label || 'All Months';
    return (
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="flex items-center text-xs text-gray-400 font-medium">
          <Filter className="w-3.5 h-3.5 mr-1.5 text-[#D4AF37]" />
          <span>Timeline:</span>
        </div>
        
        {/* Month Dropdown */}
        <div className="flex items-center space-x-1.5 bg-[#121212] border border-[#333333] hover:border-[#D4AF37]/50 rounded-lg px-2.5 py-1.5 focus-within:border-[#D4AF37] transition-colors">
          <Calendar className="w-3.5 h-3.5 text-[#D4AF37]" />
          <select
            id={`${idPrefix}-month-select`}
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="bg-transparent text-xs text-gray-200 focus:outline-none cursor-pointer pr-1"
          >
            {MONTH_OPTIONS.map((m) => (
              <option key={m.value} value={m.value} className="bg-[#1E1E1E] text-gray-200">
                {m.label}
              </option>
            ))}
          </select>
        </div>

        {/* Year Dropdown */}
        <div className="flex items-center space-x-1.5 bg-[#121212] border border-[#333333] hover:border-[#D4AF37]/50 rounded-lg px-2.5 py-1.5 focus-within:border-[#D4AF37] transition-colors">
          <span className="text-xs text-gray-400 font-medium">Yr:</span>
          <select
            id={`${idPrefix}-year-select`}
            value={selectedYear}
            onChange={(e) => setSelectedYear(e.target.value)}
            className="bg-transparent text-xs text-gray-200 focus:outline-none cursor-pointer pr-1"
          >
            <option value="all" className="bg-[#1E1E1E] text-gray-200">All Years</option>
            {availableYears.map((yr) => (
              <option key={yr} value={String(yr)} className="bg-[#1E1E1E] text-gray-200">
                {yr}
              </option>
            ))}
          </select>
        </div>

        {/* Active Filter Indicator & Reset */}
        {(selectedMonth !== 'all' || selectedYear !== 'all') && (
          <button
            id={`${idPrefix}-reset-btn`}
            onClick={() => {
              setSelectedMonth('all');
              setSelectedYear('all');
            }}
            className="flex items-center space-x-1 px-2 py-1.5 rounded-lg text-xs font-medium text-amber-400/90 hover:text-amber-300 hover:bg-[#2A2A2A] transition-colors border border-[#444]"
            title={`Showing: ${selectedMonthLabel} ${selectedYear !== 'all' ? selectedYear : ''}. Click to clear filter`}
          >
            <RotateCcw className="w-3 h-3" />
            <span>Clear Filter</span>
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#121212] text-white">
      {/* Global Header */}
      <header className="py-3.5 flex items-center justify-between px-6 bg-[#1E1E1E] border-b border-[#333333] shrink-0 z-10">
        {/* Header Lockup (Left Side) */}
        <div className="flex items-center space-x-3.5">
          <div className="h-10 w-10 rounded-xl bg-[#252525] border border-[#333333] flex items-center justify-center shrink-0 shadow-sm">
            <LayoutGrid className="h-5 w-5 text-[#D4AF37]" />
          </div>
          <div className="flex flex-col hidden sm:flex">
            <span className="text-xl font-bold text-white tracking-tight">Solarithm Insight</span>
            <span className="text-xs text-gray-400">Executive Project & Financial Management Console</span>
          </div>
        </div>

        {/* Header Right Side */}
        <div className="flex items-center space-x-4">
          <div className="hidden md:block relative w-64 lg:w-96 mr-4">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-5 w-5 text-gray-500" />
            </div>
            <input
              type="text"
              className="block w-full pl-10 pr-3 py-2 border border-[#333333] rounded-md leading-5 bg-[#121212] text-gray-300 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-[#D4AF37] focus:border-[#D4AF37] sm:text-sm transition-colors"
              placeholder="Search..."
            />
          </div>
          <button 
            onClick={() => setActiveTab('Settings')}
            className={`transition-colors ${activeTab === 'Settings' ? 'text-[#D4AF37]' : 'text-gray-400 hover:text-white'}`}
            title="Global Company Settings"
          >
            <Settings className="w-6 h-6" />
          </button>
          <button className="text-gray-400 hover:text-white relative">
            <Bell className="w-6 h-6" />
            <span className="absolute top-0 right-0 block h-2 w-2 rounded-full bg-[#D4AF37] ring-2 ring-[#1E1E1E]"></span>
          </button>

          {/* Authenticated Owner Profile & Sign Out */}
          <div className="flex items-center gap-3 pl-2 border-l border-[#333333]">
            <div className="hidden lg:flex flex-col text-right">
              <div className="flex items-center justify-end gap-1.5">
                <span className="text-xs font-semibold text-white">
                  {executiveProfile?.name || executiveProfile?.email?.split('@')[0] || 'Owner'}
                </span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/30 uppercase tracking-wider flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3 text-[#D4AF37]" />
                  Owner
                </span>
              </div>
              <span className="text-[11px] text-gray-400 truncate max-w-[160px]">
                {executiveProfile?.email || 'owner@solarithmdesign.com'}
              </span>
            </div>

            <div 
              className="h-8 w-8 rounded-full bg-[#D4AF37] flex items-center justify-center text-black font-bold text-xs shrink-0 shadow-sm uppercase"
              title={executiveProfile?.email || 'Owner'}
            >
              {executiveProfile?.name 
                ? executiveProfile.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2)
                : (executiveProfile?.email?.[0] || 'OW')}
            </div>

            <button
              onClick={handleSignOut}
              className="p-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-[#252525] transition-colors cursor-pointer"
              title="Sign Out of Master Dashboard"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-64 bg-[#1E1E1E] border-r border-[#333333] hidden md:flex flex-col">
          <nav className="flex-1 overflow-y-auto py-4">
          <ul className="space-y-1.5 px-3">
            <li>
              <a 
                href="#" 
                onClick={(e) => { e.preventDefault(); setActiveTab('Dashboard'); }}
                className={`flex items-center px-3 py-2.5 rounded-lg font-medium transition-colors ${
                  activeTab === 'Dashboard' 
                    ? 'bg-[#252525] text-white border-l-2 border-[#D4AF37] shadow-sm' 
                    : 'text-gray-400 hover:bg-[#252525]/60 hover:text-white'
                }`}
              >
                <LayoutGrid className="w-5 h-5 mr-3 text-[#D4AF37]" />
                Dashboard
              </a>
            </li>
            {stats.map((item) => (
              <li key={item.name}>
                <a 
                  href="#" 
                  onClick={(e) => { e.preventDefault(); setActiveTab(item.name); }}
                  className={`flex items-center px-3 py-2.5 rounded-lg font-medium transition-colors ${
                    activeTab === item.name 
                      ? 'bg-[#252525] text-white border-l-2 border-[#D4AF37] shadow-sm' 
                      : 'text-gray-400 hover:bg-[#252525]/60 hover:text-white'
                  }`}
                >
                  <item.icon className={`w-5 h-5 mr-3 ${activeTab === item.name ? 'text-[#D4AF37]' : ''}`} />
                  {item.name}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="p-4 border-t border-[#333333]">
          <button 
            onClick={() => setActiveTab('Settings')}
            className={`flex items-center w-full px-3 py-2.5 rounded-lg font-medium transition-colors ${
              activeTab === 'Settings' 
                ? 'bg-[#252525] text-white border-l-2 border-[#D4AF37]' 
                : 'text-gray-400 hover:bg-[#252525]/60 hover:text-white'
            }`}
          >
            <Settings className={`w-5 h-5 mr-3 ${activeTab === 'Settings' ? 'text-[#D4AF37]' : ''}`} />
            Company Settings
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Dashboard Content */}
        <div className="flex-1 overflow-y-auto p-6 lg:p-8">
          {activeTab === 'Dashboard' && (
            <div className="w-full space-y-8">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-bold mb-1">Master Overview</h2>
                  <p className="text-gray-400">Financial health, cash flow projections, and project operations summary.</p>
                </div>
                {renderTimeFilterControls('dashboard-header')}
              </div>

              {/* Enterprise Financial KPI Cards Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                {/* 1. Projects & Clients */}
                <div className="bg-[#1E1E1E] border border-[#333333] hover:border-[#D4AF37]/60 rounded-xl p-5 transition-all">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Projects</span>
                    <div className="p-2 rounded-lg bg-[#121212] text-[#D4AF37]">
                      <FolderKanban className="w-5 h-5" />
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="flex items-baseline space-x-2">
                      <span className="text-2xl font-bold text-white">{financialMetrics.totalProjectsCount}</span>
                      <span className="text-xs text-gray-400">Projects</span>
                    </div>
                    <div className="mt-2 text-xs text-gray-400 flex items-center justify-between border-t border-[#2A2A2A] pt-2">
                      <span>Approved Clients:</span>
                      <span className="font-semibold text-gray-200">{financialMetrics.totalApprovedClients}</span>
                    </div>
                  </div>
                </div>

                {/* 2. Monthly Revenue */}
                <div className="bg-[#1E1E1E] border border-[#333333] hover:border-[#D4AF37]/60 rounded-xl p-5 transition-all">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">{currentMonthName} Revenue</span>
                    <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                      <TrendingUp className="w-5 h-5" />
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="text-2xl font-bold text-emerald-400 font-mono">
                      {formatCurrency(financialMetrics.monthlyRevenue)}
                    </div>
                    <div className="mt-2 text-xs text-gray-400 flex items-center justify-between border-t border-[#2A2A2A] pt-2">
                      <span>Run Rate:</span>
                      <span className="font-medium text-gray-300">{financialMetrics.monthlyRevenue > 0 ? 'Active' : 'No billings'}</span>
                    </div>
                  </div>
                </div>

                {/* 3. Yearly Revenue */}
                <div className="bg-[#1E1E1E] border border-[#333333] hover:border-[#D4AF37]/60 rounded-xl p-5 transition-all">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">{currentYearNum} YTD Revenue</span>
                    <div className="p-2 rounded-lg bg-[#121212] text-[#D4AF37]">
                      <DollarSign className="w-5 h-5" />
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="text-2xl font-bold text-white font-mono">
                      {formatCurrency(financialMetrics.yearlyRevenue)}
                    </div>
                    <div className="mt-2 text-xs text-gray-400 flex items-center justify-between border-t border-[#2A2A2A] pt-2">
                      <span>All-Time Total:</span>
                      <span className="font-mono text-gray-300">{formatCurrency(financialMetrics.totalRevenueAllTime)}</span>
                    </div>
                  </div>
                </div>

                {/* 4. Total Expenses with Toggle */}
                <div className="bg-[#1E1E1E] border border-[#333333] hover:border-[#D4AF37]/60 rounded-xl p-5 transition-all">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Total Expenses</span>
                    <div className="p-2 rounded-lg bg-rose-500/10 text-rose-400">
                      <Receipt className="w-5 h-5" />
                    </div>
                  </div>
                  <div className="mt-2">
                    <div className="text-2xl font-bold text-rose-400 font-mono">
                      {formatCurrency(currentExpenseValue.value)}
                    </div>
                    {/* Period Toggles */}
                    <div className="mt-2 flex items-center space-x-1 border-t border-[#2A2A2A] pt-2">
                      {(['monthly', 'quarterly', 'yearly', 'all'] as const).map((period) => (
                        <button
                          key={period}
                          onClick={() => setExpensePeriod(period)}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors uppercase ${
                            expensePeriod === period
                              ? 'bg-[#D4AF37] text-black font-bold'
                              : 'bg-[#121212] text-gray-400 hover:text-white'
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
                <div className="bg-[#1E1E1E] border border-[#333333] hover:border-[#D4AF37]/60 rounded-xl p-5 transition-all">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Net Profit (YTD)</span>
                    <div className={`p-2 rounded-lg ${financialMetrics.netProfitYearly >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                      <Scale className="w-5 h-5" />
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className={`text-2xl font-bold font-mono ${financialMetrics.netProfitYearly >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {formatCurrency(financialMetrics.netProfitYearly)}
                    </div>
                    <div className="mt-2 text-xs text-gray-400 flex items-center justify-between border-t border-[#2A2A2A] pt-2">
                      <span>Status:</span>
                      <span className={`font-semibold ${financialMetrics.netProfitYearly >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {financialMetrics.netProfitYearly >= 0 ? 'Profitable' : 'Loss'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 6. Payment Pipeline */}
                <div className="bg-[#1E1E1E] border border-[#333333] hover:border-[#D4AF37]/60 rounded-xl p-5 transition-all flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Payment Pipeline</span>
                    <div className="p-2 rounded-lg bg-[#121212] text-[#D4AF37]">
                      <CreditCard className="w-5 h-5" />
                    </div>
                  </div>
                  <div className="mt-2.5">
                    <div className="grid grid-cols-2 gap-1.5">
                      {/* Pending */}
                      <div className="bg-[#141414] border border-rose-500/30 rounded-lg px-2 py-1.5 flex items-center justify-between">
                        <span className="text-[11px] font-medium text-rose-400">Pending</span>
                        <span className="text-xs font-bold text-white font-mono">{paymentPipelineMetrics.pending}</span>
                      </div>
                      {/* Sent */}
                      <div className="bg-[#141414] border border-yellow-400/30 rounded-lg px-2 py-1.5 flex items-center justify-between">
                        <span className="text-[11px] font-medium text-yellow-400">Sent</span>
                        <span className="text-xs font-bold text-white font-mono">{paymentPipelineMetrics.sent}</span>
                      </div>
                      {/* Partially Paid */}
                      <div className="bg-[#141414] border border-amber-500/30 rounded-lg px-2 py-1.5 flex items-center justify-between">
                        <span className="text-[11px] font-medium text-amber-400">Partial</span>
                        <span className="text-xs font-bold text-white font-mono">{paymentPipelineMetrics.partiallyPaid}</span>
                      </div>
                      {/* Paid */}
                      <div className="bg-[#141414] border border-[#D4AF37]/40 rounded-lg px-2 py-1.5 flex items-center justify-between">
                        <span className="text-[11px] font-medium text-[#D4AF37]">Paid</span>
                        <span className="text-xs font-bold text-white font-mono">{paymentPipelineMetrics.paid}</span>
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-gray-400 flex items-center justify-between border-t border-[#2A2A2A] pt-2">
                      <span>Total Projects:</span>
                      <span className="font-mono text-gray-200 font-semibold">{paymentPipelineMetrics.total} Total</span>
                    </div>
                  </div>
                </div>

                {/* 7. Avg Cost per Project */}
                <div className="bg-[#1E1E1E] border border-[#333333] hover:border-[#D4AF37]/60 rounded-xl p-5 transition-all">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Avg Cost / Project</span>
                    <div className="p-2 rounded-lg bg-[#121212] text-[#D4AF37]">
                      <PieChart className="w-5 h-5" />
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="text-2xl font-bold text-white font-mono">
                      {formatCurrency(financialMetrics.avgCostPerProject)}
                    </div>
                    <div className="mt-2 text-xs text-gray-400 flex items-center justify-between border-t border-[#2A2A2A] pt-2">
                      <span>Across Projects:</span>
                      <span className="font-mono text-gray-300">{financialMetrics.totalProjectsCount} Total</span>
                    </div>
                  </div>
                </div>

                {/* 8. Avg Expense per Project */}
                <div className="bg-[#1E1E1E] border border-[#333333] hover:border-[#D4AF37]/60 rounded-xl p-5 transition-all">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Avg Expense / Project</span>
                    <div className="p-2 rounded-lg bg-[#121212] text-gray-300">
                      <Calendar className="w-5 h-5" />
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="text-2xl font-bold text-white font-mono">
                      {formatCurrency(financialMetrics.avgExpensePerProject)}
                    </div>
                    <div className="mt-2 text-xs text-gray-400 flex items-center justify-between border-t border-[#2A2A2A] pt-2">
                      <span>Across Projects:</span>
                      <span className="font-mono text-gray-300">{financialMetrics.totalProjectsCount} Total</span>
                    </div>
                  </div>
                </div>

                {/* 9. Outstanding Receivables */}
                <div className="bg-[#1E1E1E] border border-[#333333] hover:border-[#D4AF37]/60 rounded-xl p-5 transition-all">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Outstanding Receivables</span>
                    <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400">
                      <Clock className="w-5 h-5" />
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="text-2xl font-bold text-amber-400 font-mono">
                      {formatCurrency(invoiceMetrics.outstandingReceivables)}
                    </div>
                    <div className="mt-2 text-xs text-gray-400 flex items-center justify-between border-t border-[#2A2A2A] pt-2">
                      <span>Pending Receivables:</span>
                      <span className="font-semibold text-amber-400">{invoiceMetrics.outstandingCount} Unpaid</span>
                    </div>
                  </div>
                </div>

                {/* 10. Invoice Volume */}
                <div className="bg-[#1E1E1E] border border-[#333333] hover:border-[#D4AF37]/60 rounded-xl p-5 transition-all">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Invoice Volume</span>
                    <div className="p-2 rounded-lg bg-[#121212] text-[#D4AF37]">
                      <FileText className="w-5 h-5" />
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="flex items-baseline space-x-2">
                      <span className="text-2xl font-bold text-white font-mono">{invoiceMetrics.invoicesThisMonthCount}</span>
                      <span className="text-xs text-gray-400">This Month</span>
                    </div>
                    <div className="mt-2 text-xs text-gray-400 flex items-center justify-between border-t border-[#2A2A2A] pt-2">
                      <span>All-Time Invoices:</span>
                      <span className="font-semibold text-gray-200">{invoiceMetrics.totalInvoicesCount} Total</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Master Insights Analytics Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
                {/* Panel 1: Cash Flow Projection (Col-Span 2) */}
                <div className="bg-[#1E1E1E] rounded-xl p-6 border border-[#333333] hover:border-[#D4AF37]/40 transition-all lg:col-span-2 flex flex-col justify-between">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
                    <div>
                      <div className="flex items-center space-x-2">
                        <LineChart className="w-5 h-5 text-[#D4AF37]" />
                        <h3 className="text-lg font-medium text-white">Cash Flow Projection</h3>
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">12-Month Revenue & Commission Expense Comparison</p>
                    </div>
                    <div className="flex items-center space-x-4 text-xs font-mono">
                      <div className="flex items-center space-x-1.5">
                        <span className="w-3 h-3 rounded-sm bg-[#D4AF37] inline-block shadow-sm"></span>
                        <span className="text-gray-300">Revenue</span>
                      </div>
                      <div className="flex items-center space-x-1.5">
                        <span className="w-3 h-3 rounded-sm bg-[#E57373] inline-block shadow-sm"></span>
                        <span className="text-gray-300">Expenses</span>
                      </div>
                    </div>
                  </div>

                  <div className="w-full h-72 pt-2">
                    <ResponsiveContainer width="100%" height="100%">
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
                        <CartesianGrid strokeDasharray="3 3" stroke="#2A2A2A" vertical={false} />
                        <XAxis
                          dataKey="name"
                          stroke="#666666"
                          tick={{ fill: '#888888', fontSize: 11 }}
                          tickLine={{ stroke: '#333333' }}
                        />
                        <YAxis
                          stroke="#666666"
                          tick={{ fill: '#888888', fontSize: 11 }}
                          tickLine={{ stroke: '#333333' }}
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
                                <div className="bg-[#181818] border border-[#3A3A3A] p-3 rounded-lg shadow-xl text-xs space-y-1.5 font-mono">
                                  <div className="font-bold text-gray-200 border-b border-[#2E2E2E] pb-1">
                                    {label} Financials
                                  </div>
                                  <div className="flex justify-between items-center space-x-4 text-[#D4AF37]">
                                    <span>Revenue:</span>
                                    <span className="font-semibold">{formatCurrency(rev)}</span>
                                  </div>
                                  <div className="flex justify-between items-center space-x-4 text-[#E57373]">
                                    <span>Expenses:</span>
                                    <span className="font-semibold">{formatCurrency(exp)}</span>
                                  </div>
                                  <div className="flex justify-between items-center space-x-4 border-t border-[#2E2E2E] pt-1 text-emerald-400 font-semibold">
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

                {/* Panel 2: Revenue Breakdown (Col-Span 1) */}
                <div className="bg-[#1E1E1E] rounded-xl p-6 border border-[#333333] hover:border-[#D4AF37]/40 transition-all flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center space-x-2">
                        <Receipt className="w-5 h-5 text-[#D4AF37]" />
                        <h3 className="text-lg font-medium text-white">Revenue Breakdown</h3>
                      </div>
                      <span className="text-xs bg-[#121212] border border-[#333333] px-2.5 py-0.5 rounded-full text-gray-400 font-mono">
                        Invoice Status
                      </span>
                    </div>

                    {/* Total Revenue Display */}
                    <div className="mt-2 p-4 rounded-lg bg-[#141414] border border-[#2A2A2A]">
                      <div className="text-xs uppercase tracking-wider text-gray-400 font-semibold">
                        Total Invoiced Revenue
                      </div>
                      <div className="text-2xl font-bold text-white font-mono mt-1">
                        {formatCurrency(revenueBreakdown.totalRevenue)}
                      </div>
                    </div>

                    {/* Visual Segmented Progress Bar */}
                    {(() => {
                      const total = revenueBreakdown.totalRevenue;
                      const clearedPct = total > 0 ? Math.round((revenueBreakdown.clearedRevenue / total) * 100) : 0;
                      const unclearedPct = total > 0 ? 100 - clearedPct : 0;

                      return (
                        <div className="mt-4 space-y-2">
                          <div className="flex justify-between text-xs text-gray-400 font-mono">
                            <span className="text-emerald-400 font-medium">Cleared: {clearedPct}%</span>
                            <span className="text-amber-400 font-medium">Uncleared: {unclearedPct}%</span>
                          </div>
                          <div className="w-full h-3 bg-[#121212] rounded-full overflow-hidden flex border border-[#2A2A2A]">
                            <div
                              className="bg-emerald-500 h-full transition-all duration-500 rounded-l-full"
                              style={{ width: `${clearedPct}%` }}
                              title={`Cleared: ${clearedPct}%`}
                            />
                            <div
                              className="bg-[#D4AF37] h-full transition-all duration-500 rounded-r-full"
                              style={{ width: `${unclearedPct}%` }}
                              title={`Uncleared: ${unclearedPct}%`}
                            />
                          </div>
                        </div>
                      );
                    })()}

                    {/* Detailed Dual-Stat Comparison */}
                    <div className="mt-4 space-y-2.5">
                      {/* Cleared Revenue Stat */}
                      <div className="p-3 rounded-lg bg-[#181818] border border-[#2A2A2A] flex items-center justify-between">
                        <div className="flex items-center space-x-2.5">
                          <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-sm" />
                          <div>
                            <div className="text-xs font-semibold text-gray-200">Cleared Revenue</div>
                            <div className="text-xs text-gray-400">{revenueBreakdown.paidCount} Paid Invoices</div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-bold text-emerald-400 font-mono">
                            {formatCurrency(revenueBreakdown.clearedRevenue)}
                          </div>
                        </div>
                      </div>

                      {/* Uncleared Revenue Stat */}
                      <div className="p-3 rounded-lg bg-[#181818] border border-[#2A2A2A] flex items-center justify-between">
                        <div className="flex items-center space-x-2.5">
                          <div className="w-2.5 h-2.5 rounded-full bg-amber-400 shadow-sm" />
                          <div>
                            <div className="text-xs font-semibold text-gray-200">Uncleared Revenue</div>
                            <div className="text-xs text-gray-400">{revenueBreakdown.pendingCount} Pending / Draft</div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-bold text-amber-400 font-mono">
                            {formatCurrency(revenueBreakdown.unclearedRevenue)}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 pt-3 border-t border-[#2A2A2A] flex items-center justify-between text-xs text-gray-400">
                    <span>Collection Efficiency:</span>
                    <span className="font-semibold text-emerald-400 font-mono">
                      {revenueBreakdown.totalRevenue > 0
                        ? `${Math.round((revenueBreakdown.clearedRevenue / revenueBreakdown.totalRevenue) * 100)}% Collected`
                        : 'No Billings'}
                    </span>
                  </div>
                </div>

                {/* Panel 3: Team & Client Insights (Col-Span 3) */}
                <div className="lg:col-span-3 grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Card A: Star Client */}
                  <div className="bg-[#1E1E1E] rounded-xl p-6 border border-[#333333] hover:border-[#D4AF37]/60 transition-all relative overflow-hidden flex flex-col justify-between">
                    <div className="absolute -right-8 -top-8 w-32 h-32 bg-[#D4AF37]/5 rounded-full blur-2xl pointer-events-none" />
                    
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center space-x-2.5">
                          <div className="p-2 rounded-lg bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/30">
                            <Trophy className="w-5 h-5" />
                          </div>
                          <div>
                            <span className="text-xs font-semibold uppercase tracking-wider text-[#D4AF37]">
                              Star Client
                            </span>
                            <h4 className="text-xs text-gray-400">Top Revenue Contributing Account</h4>
                          </div>
                        </div>
                        <span className="text-xs bg-[#121212] border border-[#333333] px-2.5 py-0.5 rounded-full text-gray-400 font-mono">
                          Annual Rank #1
                        </span>
                      </div>

                      <div className="mt-2">
                        <div className="text-xl font-bold text-white tracking-wide">
                          {toTitleCase(starClient.name)}
                        </div>
                        <div className="mt-3 flex items-baseline space-x-2">
                          <span className="text-2xl font-bold text-[#D4AF37] font-mono">
                            {formatCurrency(starClient.revenue)}
                          </span>
                          <span className="text-xs text-gray-400">Total Value</span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-[#2A2A2A] flex items-center justify-between text-xs text-gray-400">
                      <span>Delivered Projects:</span>
                      <span className="font-semibold text-gray-200 font-mono">
                        {starClient.projectCount} {starClient.projectCount === 1 ? 'Project' : 'Projects'}
                      </span>
                    </div>
                  </div>

                  {/* Card B: Top Performer (Employee of the Year/Month) */}
                  <div className="bg-[#1E1E1E] rounded-xl p-6 border border-[#333333] hover:border-[#D4AF37]/60 transition-all relative overflow-hidden flex flex-col justify-between">
                    <div className="absolute -right-8 -top-8 w-32 h-32 bg-[#D4AF37]/5 rounded-full blur-2xl pointer-events-none" />

                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center space-x-2.5">
                          <div className="p-2 rounded-lg bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/30">
                            <Star className="w-5 h-5" />
                          </div>
                          <div>
                            <span className="text-xs font-semibold uppercase tracking-wider text-[#D4AF37]">
                              Top Performer
                            </span>
                            <h4 className="text-xs text-gray-400">Commission Growth Leader</h4>
                          </div>
                        </div>
                        <span className="text-xs bg-[#121212] border border-[#333333] px-2.5 py-0.5 rounded-full text-gray-400 font-mono">
                          {topPerformers.topPerformer?.role || 'Team Lead'}
                        </span>
                      </div>

                      <div className="mt-2">
                        <div className="text-xl font-bold text-white tracking-wide">
                          {topPerformers.topPerformer ? toTitleCase(topPerformers.topPerformer.name) : 'No Commissions Logged'}
                        </div>
                        <div className="mt-3 flex items-baseline space-x-2">
                          <span className="text-2xl font-bold text-[#D4AF37] font-mono">
                            {formatCurrency(topPerformers.topPerformer?.totalEarnedYear || 0)}
                          </span>
                          <span className="text-xs text-gray-400">Total Earned</span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-[#2A2A2A] flex items-center justify-between text-xs text-gray-400">
                      <span>Projects & Pace:</span>
                      <span className="font-semibold text-gray-200 font-mono">
                        {topPerformers.topPerformer?.projectCount || 0} Projects • {formatCurrency(topPerformers.topPerformer?.totalEarnedMonth || 0)} this month
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
          {activeTab === 'Clients' && (() => {
            const formatAddressToString = (addr: any): string => {
              if (!addr) return '';
              if (typeof addr === 'string') return addr.trim();
              if (typeof addr === 'object' && addr !== null) {
                const parts = [
                  addr.line1 || addr.addressLine1 || addr.street || addr.streetAddress,
                  addr.line2 || addr.addressLine2,
                  addr.landmark,
                  typeof addr.city === 'string' ? addr.city : (addr.city?.name || addr.city?.city),
                  typeof addr.state === 'string' ? addr.state : (addr.state?.name || addr.state?.state),
                  addr.pinCode || addr.pincode || addr.zipCode || addr.postalCode,
                  addr.country
                ].filter(Boolean);
                if (parts.length > 0) return parts.join(', ');

                const textVals = Object.values(addr)
                  .map(v => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : ''))
                  .filter(Boolean);
                if (textVals.length > 0) return textVals.join(', ');
              }
              return String(addr || '');
            };

            const getClientFullAddress = (client: any): string => {
              if (!client) return '—';

              if (client.fullAddress) {
                const formatted = formatAddressToString(client.fullAddress);
                if (formatted) return formatted;
              }
              if (client.address) {
                const formatted = formatAddressToString(client.address);
                if (formatted) return formatted;
              }
              if (client.billingAddress) {
                const formatted = formatAddressToString(client.billingAddress);
                if (formatted) return formatted;
              }
              if (client.streetAddress) {
                const formatted = formatAddressToString(client.streetAddress);
                if (formatted) return formatted;
              }

              const parts = [
                client.addressLine1,
                client.addressLine2,
                typeof client.city === 'string' ? client.city : (client.city?.name || client.city?.city),
                typeof client.state === 'string' ? client.state : (client.state?.name || client.state?.state),
                client.pinCode || client.pincode || client.zipCode || client.postalCode
              ].filter(Boolean);

              if (parts.length > 0) return parts.join(', ');

              if (client.city) {
                const cityStr = typeof client.city === 'string' ? client.city : (client.city?.name || client.city?.city);
                if (cityStr) return cityStr;
              }
              return '—';
            };

            const safeRenderString = (val: any, fallback = '—'): string => {
              if (val === null || val === undefined) return fallback;
              if (typeof val === 'string') return val.trim() || fallback;
              if (typeof val === 'number') return String(val);
              if (typeof val === 'boolean') return val ? 'Yes' : 'No';
              if (typeof val === 'object') {
                if (val.line1 !== undefined || val.line2 !== undefined || val.pinCode !== undefined || val.pincode !== undefined || val.street !== undefined) {
                  return formatAddressToString(val) || fallback;
                }
                if (val.name) return String(val.name);
                if (val.label) return String(val.label);
                if (val.value) return String(val.value);
                if (val.title) return String(val.title);
                if (val.email) return String(val.email);
                if (val.phone) return String(val.phone);
                if (val.city) return typeof val.city === 'string' ? val.city : (val.city?.name || fallback);
                
                const textVals = Object.values(val)
                  .map(v => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : ''))
                  .filter(Boolean);
                if (textVals.length > 0) return textVals.join(', ');
                return fallback;
              }
              return String(val) || fallback;
            };

            const getSalespersonName = (emailOrVal: string | undefined): string => {
              if (!emailOrVal) return '—';
              const val = String(emailOrVal).trim();
              const lower = val.toLowerCase();
              
              const matchedUser = users.find(u => 
                (u.email && u.email.toLowerCase() === lower) ||
                (u.id && u.id.toLowerCase() === lower) ||
                (u.name && u.name.toLowerCase() === lower) ||
                (u.displayName && u.displayName.toLowerCase() === lower) ||
                (u.employeeName && u.employeeName.toLowerCase() === lower) ||
                (u.empId && u.empId.toLowerCase() === lower)
              );

              if (matchedUser) {
                return matchedUser.name || matchedUser.displayName || matchedUser.employeeName || toTitleCase(matchedUser.email?.split('@')[0] || val);
              }

              if (val.includes('@')) {
                const namePart = val.split('@')[0].replace(/[._-]/g, ' ');
                return toTitleCase(namePart);
              }

              return toTitleCase(val);
            };

            const approvedClients = clients.filter(
              (c) => c.status === CLIENT_STATUS.APPROVED || c.status?.toLowerCase() === 'approved'
            );

            const filteredApprovedClients = approvedClients.filter(c => {
              if (!clientSearchTerm.trim()) return true;
              const q = clientSearchTerm.toLowerCase().trim();
              const company = safeRenderString(c.companyName, '').toLowerCase();
              const person = safeRenderString(c.contactPerson, '').toLowerCase();
              const city = safeRenderString(typeof c.city === 'object' ? (c.city?.name || c.city?.city) : c.city, '').toLowerCase();
              const gstin = safeRenderString(c.gstin || c.gst || c.gstNumber, '').toLowerCase();
              const sp = getSalespersonName(c.salesPersonEmail || c.salesPerson).toLowerCase();
              const phone = safeRenderString(c.phone || c.mobile || c.contactPhone, '').toLowerCase();
              const email = safeRenderString(c.email || c.contactEmail, '').toLowerCase();
              const addr = getClientFullAddress(c).toLowerCase();
              return company.includes(q) || person.includes(q) || city.includes(q) || gstin.includes(q) || sp.includes(q) || phone.includes(q) || email.includes(q) || addr.includes(q);
            });

            return (
              <div className="w-full space-y-6">
                {/* Header and Search Controls */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div className="flex items-center space-x-3">
                    <div className="p-2 rounded-lg bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/30">
                      <Briefcase className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-white tracking-wide">Approved Clients Directory</h3>
                      <p className="text-xs text-gray-400 mt-0.5">
                        Verified enterprise client profiles, commercial taxation details, and assigned sales representatives.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-3">
                    <div className="relative">
                      <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={clientSearchTerm}
                        onChange={(e) => setClientSearchTerm(e.target.value)}
                        placeholder="Search company, contact, city, GSTIN, sales person..."
                        className="bg-[#1E1E1E] border border-[#333333] rounded-lg pl-9 pr-4 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-[#D4AF37] w-64 sm:w-80"
                      />
                      {clientSearchTerm && (
                        <button
                          onClick={() => setClientSearchTerm('')}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white text-xs"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Table Container with Responsive Horizontal Scrolling */}
                <div className="bg-[#1E1E1E] rounded-xl shadow-2xl p-6 border border-[#333333] overflow-hidden">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-gray-300">
                        Client Roster
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-[#121212] border border-[#333333] text-[11px] font-mono font-semibold text-[#D4AF37]">
                        {filteredApprovedClients.length} of {approvedClients.length} Active
                      </span>
                    </div>
                  </div>

                  {filteredApprovedClients.length === 0 ? (
                    <div className="text-center py-12 border border-dashed border-[#333333] rounded-xl bg-[#141414]">
                      <Briefcase className="mx-auto h-12 w-12 text-gray-500 mb-3 opacity-60" />
                      <h4 className="text-sm font-semibold text-gray-300">
                        {clientSearchTerm ? 'No matching clients found' : 'No approved clients yet'}
                      </h4>
                      <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
                        {clientSearchTerm
                          ? 'Try modifying your search query to locate registered accounts.'
                          : 'Populate your Firebase connection to see real client profiles.'}
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto whitespace-nowrap scrollbar-thin scrollbar-thumb-[#333333] scrollbar-track-transparent">
                      <table className="w-full text-left text-xs whitespace-nowrap">
                        <thead>
                          <tr className="text-gray-400 text-[11px] uppercase border-b border-[#333333]">
                            <th className="pb-3.5 px-4 font-semibold">Company Name</th>
                            <th className="pb-3.5 px-4 font-semibold">Contact Person</th>
                            <th className="pb-3.5 px-4 font-semibold">Phone</th>
                            <th className="pb-3.5 px-4 font-semibold">Email</th>
                            <th className="pb-3.5 px-4 font-semibold">City</th>
                            <th className="pb-3.5 px-4 font-semibold">GSTIN</th>
                            <th className="pb-3.5 px-4 font-semibold">Full Address</th>
                            <th className="pb-3.5 px-4 font-semibold">Pricing Tier</th>
                            <th className="pb-3.5 px-4 font-semibold">Sales Person</th>
                            <th className="pb-3.5 px-4 font-semibold text-center">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#2A2A2A]">
                          {filteredApprovedClients.map((client, index) => {
                            const salesPersonName = getSalespersonName(client.salesPersonEmail || client.salesPerson || client.salesPersonName);
                            const fullAddress = getClientFullAddress(client);
                            const companyVal = safeRenderString(client.companyName);
                            const contactPersonVal = safeRenderString(client.contactPerson);
                            const phoneVal = safeRenderString(client.phone || client.mobile || client.contactPhone);
                            const emailVal = safeRenderString(client.email || client.contactEmail);
                            const cityVal = safeRenderString(typeof client.city === 'object' ? (client.city?.name || client.city?.city) : client.city);
                            const gstinVal = safeRenderString(client.gstin || client.gst || client.gstNumber);
                            const pricingTier = safeRenderString(client.pricingCategory || client.pricingTier, 'Standard');

                            return (
                              <tr key={client.id ? `${client.id}-${index}` : `client-${index}`} className="hover:bg-[#252525] transition-colors group">
                                {/* Company Name */}
                                <td className="py-3.5 px-4 font-bold text-[#D4AF37] group-hover:text-[#F3E5AB] transition-colors">
                                  {companyVal}
                                </td>

                                {/* Contact Person */}
                                <td className="py-3.5 px-4 text-gray-200 font-medium">
                                  {contactPersonVal}
                                </td>

                                {/* Phone */}
                                <td className="py-3.5 px-4 font-mono text-gray-300">
                                  {phoneVal}
                                </td>

                                {/* Email */}
                                <td className="py-3.5 px-4 font-mono text-gray-300 text-[11px]">
                                  {emailVal}
                                </td>

                                {/* City */}
                                <td className="py-3.5 px-4 text-gray-200 font-medium">
                                  {cityVal}
                                </td>

                                {/* GSTIN */}
                                <td className="py-3.5 px-4 font-mono text-gray-300 text-[11px]">
                                  {gstinVal !== '—' ? (
                                    <span className="px-2 py-0.5 rounded bg-[#141414] border border-[#333333] text-gray-300 font-mono">
                                      {gstinVal}
                                    </span>
                                  ) : (
                                    <span className="text-gray-500 italic">Unassigned</span>
                                  )}
                                </td>

                                {/* Full Address */}
                                <td className="py-3.5 px-4 text-gray-300 max-w-xs truncate" title={fullAddress}>
                                  {fullAddress}
                                </td>

                                {/* Pricing Tier */}
                                <td className="py-3.5 px-4">
                                  <span className="bg-[#121212] px-2.5 py-1 rounded text-xs font-semibold border border-[#333333] text-gray-200">
                                    {pricingTier}
                                  </span>
                                </td>

                                {/* Sales Person (Clean Employee Name) */}
                                <td className="py-3.5 px-4 text-gray-200 font-medium">
                                  <div className="flex items-center space-x-1.5">
                                    <div className="w-1.5 h-1.5 rounded-full bg-[#D4AF37]"></div>
                                    <span className="text-white font-semibold">{salesPersonName}</span>
                                  </div>
                                </td>

                                {/* Status */}
                                <td className="py-3.5 px-4 text-center">
                                  <span className="inline-flex items-center space-x-1 text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full text-xs font-semibold border border-emerald-500/20 shadow-sm">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                                    <span>Approved</span>
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
          {activeTab === 'Pricing Rules' && (() => {
            // Derived unique values for cascading dropdowns
            const uniqueCategories = Array.from(new Set(pricingRules.map(rule => rule.category || 'Standard'))).filter(Boolean);
            
            const availableScopes = Array.from(new Set(pricingRules
              .filter(rule => (rule.category || 'Standard') === selectedCategory)
              .map(rule => rule.scope)
            )).filter(Boolean);
            
            const availableSubServices = Array.from(new Set(pricingRules
              .filter(rule => 
                (rule.category || 'Standard') === selectedCategory && 
                rule.scope === selectedScope
              )
              .map(rule => rule.subService)
            )).filter(Boolean);

            // Filter the final table data based on all three selections
            const filteredRules = pricingRules
              .filter(rule => 
                (rule.category || 'Standard') === selectedCategory &&
                rule.scope === selectedScope &&
                rule.subService === selectedSubService
              )
              .flatMap(rule => rule.capacityRows || []);

            return (
              <div className="w-full space-y-8">
                <div className="bg-[#1E1E1E] rounded-xl shadow-2xl p-6 overflow-x-auto border border-[#333333]">
                  <div className="flex justify-between items-center mb-6">
                    <h3 className="text-lg font-medium">Pricing Matrix Directory</h3>
                  </div>

                  {/* Cascading Filter Bar */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 bg-[#1A1A1A] p-4 rounded-lg border border-[#333333]">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Category / Tier</label>
                      <select
                        value={selectedCategory}
                        onChange={(e) => {
                          setSelectedCategory(e.target.value);
                          setSelectedScope(''); // Reset dependent filters
                          setSelectedSubService('');
                        }}
                        className="w-full bg-[#121212] border border-[#333333] rounded-lg px-3 py-2 text-white focus:outline-none focus:border-[#D4AF37] transition-colors appearance-none"
                      >
                        <option value="">Select Category</option>
                        {uniqueCategories.map(cat => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Scope of Work</label>
                      <select
                        value={selectedScope}
                        onChange={(e) => {
                          setSelectedScope(e.target.value);
                          setSelectedSubService(''); // Reset dependent filter
                        }}
                        disabled={!selectedCategory}
                        className="w-full bg-[#121212] border border-[#333333] rounded-lg px-3 py-2 text-white focus:outline-none focus:border-[#D4AF37] transition-colors appearance-none disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <option value="">Select Scope</option>
                        {availableScopes.map(scope => (
                          <option key={scope} value={scope}>{scope}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Sub-Service</label>
                      <select
                        value={selectedSubService}
                        onChange={(e) => setSelectedSubService(e.target.value)}
                        disabled={!selectedScope}
                        className="w-full bg-[#121212] border border-[#333333] rounded-lg px-3 py-2 text-white focus:outline-none focus:border-[#D4AF37] transition-colors appearance-none disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <option value="">Select Sub-Service</option>
                        {availableSubServices.map(sub => (
                          <option key={sub} value={sub}>{sub}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  
                  {!(selectedCategory && selectedScope && selectedSubService) ? (
                    <div className="text-center py-12 border border-dashed border-[#333333] rounded-lg bg-[#1A1A1A]">
                      <Tags className="mx-auto h-12 w-12 text-[#D4AF37]/50 mb-4" />
                      <h4 className="text-lg font-medium text-gray-300">Drill Down Required</h4>
                      <p className="text-gray-500 mt-2 max-w-md mx-auto">Please select a Category, Scope, and Sub-Service to view reference pricing.</p>
                    </div>
                  ) : filteredRules.length === 0 ? (
                    <div className="text-center py-10 border border-dashed border-[#333333] rounded-lg">
                      <h4 className="text-lg font-medium text-gray-300">No matching rules found</h4>
                      <p className="text-gray-500 mt-1">There are no pricing tiers defined for this specific combination.</p>
                    </div>
                  ) : (
                    <table className="w-full text-left whitespace-nowrap min-w-[600px]">
                      <thead>
                        <tr className="text-gray-400 text-sm uppercase border-b border-[#333333]">
                          <th className="pb-3 px-4 font-semibold">Capacity Range</th>
                          <th className="pb-3 px-4 font-semibold">Price Type</th>
                          <th className="pb-3 px-4 font-semibold">Unit</th>
                          <th className="pb-3 px-4 font-semibold text-right">Price</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#333333]">
                        {filteredRules.map((row: any, index: number) => {
                          const formatCurrency = (val: number) =>
                            new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(val);
                          
                          const price = Number(row.price) || 0;

                          return (
                            <tr key={index} className="hover:bg-[#2A2A2A] transition-colors">
                              <td className="py-4 px-4 font-medium text-[#D4AF37]">{row.capacityRange || 'N/A'}</td>
                              <td className="py-4 px-4 text-gray-200">{row.priceType || 'N/A'}</td>
                              <td className="py-4 px-4 text-gray-200">{row.unit || 'N/A'}</td>
                              <td className="py-4 px-4 text-right text-gray-200 font-mono">
                                {formatCurrency(price)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            );
          })()}
          {activeTab === 'Projects' && (() => {
            return (
              <div className="w-full space-y-8">
                <div className="bg-[#1E1E1E] rounded-xl shadow-2xl p-6 overflow-x-auto border border-[#333333]">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                    <div className="flex items-center space-x-3">
                      <h3 className="text-lg font-medium">Projects Directory</h3>
                      <span className="text-xs bg-[#121212] border border-[#333333] px-2.5 py-0.5 rounded-full text-gray-400 font-mono">
                        {filteredFinancialProjects.length} of {financialProjects.length} projects
                      </span>
                    </div>
                    {renderTimeFilterControls('projects-directory')}
                  </div>
                  
                  {financialProjects.length === 0 ? (
                    <div className="text-center py-10 border border-dashed border-[#333333] rounded-lg">
                      <FolderKanban className="mx-auto h-12 w-12 text-gray-500 mb-4" />
                      <h4 className="text-lg font-medium text-gray-300">No active projects found</h4>
                      <p className="text-gray-500 mt-1">Populate your Firebase connection to see real projects.</p>
                    </div>
                  ) : filteredFinancialProjects.length === 0 ? (
                    <div className="text-center py-10 border border-dashed border-[#333333] rounded-lg">
                      <Calendar className="mx-auto h-12 w-12 text-[#D4AF37]/50 mb-4" />
                      <h4 className="text-lg font-medium text-gray-300">No projects match the selected time filter</h4>
                      <p className="text-gray-500 mt-1">
                        No project records found for the chosen month/year.
                      </p>
                      <button
                        onClick={() => {
                          setSelectedMonth('all');
                          setSelectedYear('all');
                        }}
                        className="mt-4 inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#D4AF37] text-black hover:bg-[#c49f2c] transition-colors shadow-sm"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Reset Time Filters</span>
                      </button>
                    </div>
                  ) : (
                    <table className="w-full text-left whitespace-nowrap">
                      <thead>
                        <tr className="text-gray-400 text-sm uppercase border-b border-[#333333]">
                          <th className="pb-3 px-4 font-semibold">Project Name</th>
                          <th className="pb-3 px-4 font-semibold">Client</th>
                          <th className="pb-3 px-4 font-semibold">Capacity</th>
                          <th className="pb-3 px-4 font-semibold">Date</th>
                          <th className="pb-3 px-4 font-semibold">Scope</th>
                          <th className="pb-3 px-4 font-semibold">Sub-Service</th>
                          <th className="pb-3 px-4 font-semibold">Designer(s)</th>
                          <th className="pb-3 px-4 font-semibold">Sales Person</th>
                          <th className="pb-3 px-4 font-semibold text-right">Cost</th>
                          <th className="pb-3 px-4 font-semibold text-right">Des. Comm</th>
                          <th className="pb-3 px-4 font-semibold text-right">Sales Comm</th>
                          <th className="pb-3 px-4 font-semibold text-right">Balance</th>
                          <th className="pb-3 px-4 font-semibold text-center">Status</th>
                          <th className="pb-3 px-4 font-semibold text-center">Payment Status</th>
                          <th className="pb-3 px-4 font-semibold text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#333333]">
                        {filteredFinancialProjects.map((project) => {
                          const d = getProjectDate(project);
                          const dateText = d ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}` : 'N/A';

                          const clientName = project.clientName || project.matchedClient?.companyName || 'N/A';
                          
                          const cost = project.calculatedCost || project.cost || 0;
                          const desComm = project.designerCommission || 0;
                          const salesComm = project.salesCommission || 0;
                          const balance = cost - (desComm + salesComm);
                          const paymentInfo = getProjectPaymentStatus(project);

                          return (
                            <tr key={project.id} className="hover:bg-[#252525]/50 transition-colors">
                              <td className="py-4 px-4 font-medium text-white">
                                {toTitleCase(project.projectName || 'Untitled')}
                              </td>
                              <td className="py-4 px-4 text-gray-200">{toTitleCase(clientName)}</td>
                              <td className="py-4 px-4 text-gray-200">
                                {project.plantCapacity ? `${project.plantCapacity} ${project.capacityUnit || 'KW'}` : 'N/A'}
                              </td>
                              <td className="py-4 px-4 text-gray-200">{dateText}</td>
                              <td className="py-4 px-4 text-gray-200">{toTitleCase(project.scopeOfWork || 'N/A')}</td>
                              <td className="py-4 px-4 text-gray-200">{toTitleCase(project.subService || 'N/A')}</td>
                              <td className="py-4 px-4 text-gray-200">
                                {project.assignedScopes && Object.keys(project.assignedScopes).length > 0 ? (
                                  <span className="text-xs" title={getScopeDesignerSummary(project)}>
                                    {getScopeDesignerSummary(project).split(' | ').map((line, i) => (
                                      <span key={i} className="block whitespace-nowrap">
                                        <span className="text-[#D4AF37]">{line.split(':')[0]}:</span>
                                        <span className="text-gray-200">{line.split(':').slice(1).join(':')}</span>
                                      </span>
                                    ))}
                                  </span>
                                ) : (
                                  getScopeDesignerSummary(project)
                                )}
                              </td>
                              <td className="py-4 px-4 text-gray-200">{toTitleCase(getEmployeeName(project.salesPersonEmail || project.matchedClient?.salesPersonEmail))}</td>
                              <td className="py-4 px-4 text-right text-gray-200 font-mono">
                                {formatCurrency(cost)}
                              </td>
                              <td className="py-4 px-4 text-right text-gray-200 font-mono">
                                {formatCurrency(desComm)}
                              </td>
                              <td className="py-4 px-4 text-right text-gray-200 font-mono">
                                {formatCurrency(salesComm)}
                              </td>
                              <td className="py-4 px-4 text-right font-mono font-medium text-white">
                                {formatCurrency(balance)}
                              </td>
                              <td className="py-4 px-4 flex justify-center">
                                {getStatusBadge(project.status)}
                              </td>
                              <td className="py-4 px-4 text-center">
                                <div className="flex justify-center">
                                  {getPaymentStatusBadge(paymentInfo)}
                                </div>
                              </td>
                              <td className="py-4 px-4 text-right">
                                <button 
                                  onClick={() => {
                                    setEditingProject(project);
                                    setIsEditProjectModalOpen(true);
                                  }}
                                  className="text-[#D4AF37] hover:text-[#f2c94c] transition-colors font-medium text-sm"
                                >
                                  Edit
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            );
          })()}
          {activeTab === 'Proposals' && (() => {
            return (
              <div className="w-full space-y-8">
                <div className="bg-[#1E1E1E] rounded-xl shadow-2xl p-6 overflow-x-auto border border-[#333333]">
                  <div className="flex justify-between items-center mb-6">
                    <h3 className="text-lg font-medium">Proposals Directory</h3>
                  </div>
                  
                  {proposals.length === 0 ? (
                    <div className="text-center py-10 border border-dashed border-[#333333] rounded-lg">
                      <FileText className="mx-auto h-12 w-12 text-gray-500 mb-4" />
                      <h4 className="text-lg font-medium text-gray-300">No proposals found</h4>
                      <p className="text-gray-500 mt-1">Populate your Firebase connection to see real proposals.</p>
                    </div>
                  ) : (
                    <table className="w-full text-left whitespace-nowrap">
                      <thead>
                        <tr className="text-gray-400 text-sm uppercase border-b border-[#333333]">
                          <th className="pb-3 px-4 font-semibold">Proposal Number</th>
                          <th className="pb-3 px-4 font-semibold">Client / Company Name</th>
                          <th className="pb-3 px-4 font-semibold">Date Created</th>
                          <th className="pb-3 px-4 font-semibold text-right">Total Value</th>
                          <th className="pb-3 px-4 font-semibold">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#333333]">
                        {proposals.map((prop) => {
                          const matchedClient = clients.find(c => c.id === prop.clientId);
                          const clientDisplayName = matchedClient 
                            ? (matchedClient.companyName || matchedClient.clientName || matchedClient.name)
                            : (prop.clientName || prop.companyName || 'Unknown Client');

                          const dateVal = prop.createdAt || prop.dateCreated || prop.date;
                          const dateText = formatSafeDate(dateVal) || 'N/A';

                          const formatCurrency = (val: number) =>
                            new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(val);
                          const amount = Number(prop.proposalAmount || prop.totalValue || prop.calculatedCost || prop.amount || prop.cost || 0);

                          const statusStr = (prop.status || 'pending').toLowerCase();
                          let badgeColors = 'text-gray-400 bg-gray-500/10 border-gray-500/20';
                          if (statusStr === 'accepted' || statusStr === 'approved' || statusStr === 'won') {
                            badgeColors = 'text-green-500 bg-green-500/10 border-green-500/20';
                          } else if (statusStr === 'rejected' || statusStr === 'lost') {
                            badgeColors = 'text-red-500 bg-red-500/10 border-red-500/20';
                          } else if (statusStr === 'pending' || statusStr === 'draft' || statusStr === 'sent') {
                            badgeColors = 'text-yellow-500 bg-yellow-500/10 border-yellow-500/20';
                          }

                          return (
                            <tr key={prop.id} className="hover:bg-[#2A2A2A] transition-colors">
                              <td className="py-4 px-4 font-medium text-[#D4AF37]">
                                {prop.proposalNumber || prop.id || 'N/A'}
                              </td>
                              <td className="py-4 px-4 text-gray-200">
                                {toTitleCase(clientDisplayName)}
                              </td>
                              <td className="py-4 px-4 text-gray-200">{dateText}</td>
                              <td className="py-4 px-4 text-right text-gray-200 font-mono">
                                {formatCurrency(amount)}
                              </td>
                              <td className="py-4 px-4">
                                <span className={`px-2.5 py-1 rounded text-xs font-medium border ${badgeColors}`}>
                                  {toTitleCase(prop.status || 'Pending')}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            );
          })()}
          {(activeTab === 'Employees' || activeTab === 'Users') && (
            <EmployeeDirectory
              users={users}
              setUsers={setUsers}
              clients={clients}
              projects={financialProjects.length > 0 ? financialProjects : projects}
              onNavigateToSalaryStudio={() => setActiveTab('Salary Studio')}
            />
          )}
          {activeTab === 'Billing' && (
            <BillingModule clients={clients} projects={financialProjects.length > 0 ? financialProjects : projects} />
          )}
          {activeTab === 'Salary Studio' && (
            <SalaryStudio 
              users={users} 
              projects={financialProjects.length > 0 ? financialProjects : projects} 
              commissionRules={commissionRules}
              onNavigateToGlobalSettings={() => setActiveTab('Settings')}
            />
          )}
          {activeTab === 'Apps' && (
            <div className="w-full space-y-8">
              <div className="bg-[#1E1E1E] rounded-xl shadow-2xl p-6 overflow-x-auto border border-[#333333]">
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-lg font-medium">Registered Applications</h3>
                </div>
                
                {apps.length === 0 ? (
                  <div className="text-center py-10 border border-dashed border-[#333333] rounded-lg">
                    <LayoutGrid className="mx-auto h-12 w-12 text-gray-500 mb-4" />
                    <h4 className="text-lg font-medium text-gray-300">No applications found</h4>
                    <p className="text-gray-500 mt-1">Populate your Firebase connection to see registered apps.</p>
                  </div>
                ) : (
                  <table className="w-full text-left whitespace-nowrap">
                    <thead>
                      <tr className="text-gray-400 text-sm uppercase border-b border-[#333333]">
                        <th className="pb-3 px-4 font-semibold">App Name</th>
                        <th className="pb-3 px-4 font-semibold">Category</th>
                        <th className="pb-3 px-4 font-semibold">Description</th>
                        <th className="pb-3 px-4 font-semibold">Application URL</th>
                        <th className="pb-3 px-4 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#333333]">
                      {apps.map((app) => {
                        const appName = app.name || app.appName || 'Untitled App';
                        const appCategory = app.category || 'General';
                        const appDesc = app.description || 'Solarithm Ecosystem Satellite';
                        const appUrl = app.url || app.appUrl;
                        const isActive = app.active !== undefined ? Boolean(app.active) : (app.status === 'active' || app.isActive);
                        const status = isActive ? 'active' : 'inactive';
                        
                        return (
                          <tr key={app.id} className="hover:bg-[#2A2A2A] transition-colors">
                            <td className="py-4 px-4 font-medium text-gray-200">
                              {appName}
                            </td>
                            <td className="py-4 px-4 text-xs text-gray-300">
                              <span className="px-2 py-0.5 rounded bg-[#2A2A2A] border border-[#444] text-gray-300 font-mono">
                                {appCategory}
                              </span>
                            </td>
                            <td className="py-4 px-4 text-xs text-gray-400 max-w-xs truncate">
                              {appDesc}
                            </td>
                            <td className="py-4 px-4">
                              {appUrl ? (
                                <a 
                                  href={appUrl} 
                                  target="_blank" 
                                  rel="noopener noreferrer" 
                                  className="text-[#D4AF37] hover:underline font-medium text-xs font-mono"
                                >
                                  {appUrl}
                                </a>
                              ) : (
                                <span className="text-gray-500 text-xs">N/A</span>
                              )}
                            </td>
                            <td className="py-4 px-4">
                              <span className={`px-2.5 py-1 rounded text-xs font-medium border capitalize ${
                                status.toLowerCase() === 'active' 
                                  ? 'text-green-500 bg-green-500/10 border-green-500/20' 
                                  : 'text-gray-400 bg-gray-500/10 border-gray-500/20'
                              }`}>
                                {status}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
          {activeTab === 'Settings' && (
            <CompanySettingsView onNavigateToBilling={() => setActiveTab('Billing')} />
          )}
        </div>
      </main>
      </div>

      {/* Edit Project Modal */}
      {isEditProjectModalOpen && editingProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-[#1E1E1E] border border-[#333333] rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-[#333333] flex justify-between items-center">
              <h3 className="text-lg font-medium text-white">Edit Project</h3>
              <button 
                onClick={() => { setIsEditProjectModalOpen(false); setEditingProject(null); }}
                className="text-gray-400 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
                        <div className="p-6 overflow-y-auto flex-1 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Project Name</label>
                  <input 
                    type="text" 
                    value={editingProject.projectName || ''}
                    onChange={(e) => setEditingProject({ ...editingProject, projectName: e.target.value })}
                    className="w-full bg-[#121212] border border-[#333333] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-[#D4AF37] transition-colors"
                    placeholder="Enter project name"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Client Name</label>
                  <input 
                    type="text" 
                    value={editingProject.clientName || ''}
                    onChange={(e) => setEditingProject({ ...editingProject, clientName: e.target.value })}
                    className="w-full bg-[#121212] border border-[#333333] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-[#D4AF37] transition-colors"
                    placeholder="Enter client name"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Capacity</label>
                  <input 
                    type="text" 
                    value={editingProject.systemCapacity || editingProject.capacity || editingProject.plantCapacity || ''}
                    onChange={(e) => setEditingProject({ ...editingProject, systemCapacity: e.target.value, capacity: e.target.value, plantCapacity: e.target.value })}
                    className="w-full bg-[#121212] border border-[#333333] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-[#D4AF37] transition-colors"
                    placeholder="e.g. 5kW"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Status</label>
                  <select 
                    value={editingProject.status || 'Active'}
                    onChange={(e) => setEditingProject({ ...editingProject, status: e.target.value })}
                    className="w-full bg-[#121212] border border-[#333333] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-[#D4AF37] transition-colors appearance-none"
                  >
                    <option value="Active">Active</option>
                    <option value="On Hold">On Hold</option>
                    <option value="Completed">Completed</option>
                    <option value="Cancelled">Cancelled</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Project Date</label>
                  <input 
                    type="date" 
                    value={formatSafeDate(editingProject.createdAt || editingProject.date || editingProject.dateCreated, 'input')}
                    onChange={(e) => { 
                      const val = e.target.value; 
                      if (val) { 
                        const timeVal = new Date(val).getTime();
                        if (!isNaN(timeVal)) {
                          setEditingProject({ ...editingProject, createdAt: timeVal, date: val });
                        }
                      } else {
                        setEditingProject({ ...editingProject, createdAt: null, date: null });
                      }
                    }}
                    className="w-full bg-[#121212] border border-[#333333] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-[#D4AF37] transition-colors"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Scope of Work</label>
                  <select 
                    value={editingProject.scopeOfWork || ''}
                    onChange={(e) => setEditingProject({ ...editingProject, scopeOfWork: e.target.value })}
                    className="w-full bg-[#121212] border border-[#333333] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-[#D4AF37] transition-colors appearance-none"
                  >
                    <option value="">Select Scope</option>
                    <option value="Domestic">Domestic</option>
                    <option value="Commercial">Commercial</option>
                    <option value="Industrial">Industrial</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Sub-Service</label>
                  <select 
                    value={editingProject.subService || ''}
                    onChange={(e) => setEditingProject({ ...editingProject, subService: e.target.value })}
                    className="w-full bg-[#121212] border border-[#333333] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-[#D4AF37] transition-colors appearance-none"
                  >
                    <option value="">Select Sub-Service</option>
                    <option value="Standard">Standard</option>
                    <option value="Premium">Premium</option>
                    <option value="Custom">Custom</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Pricing Tier</label>
                  <select 
                    value={editingProject.pricingCategory || ''}
                    onChange={(e) => setEditingProject({ ...editingProject, pricingCategory: e.target.value })}
                    className="w-full bg-[#121212] border border-[#333333] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-[#D4AF37] transition-colors appearance-none"
                  >
                    <option value="">Select Tier</option>
                    <option value="T1">T1</option>
                    <option value="T2">T2</option>
                    <option value="T3">T3</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Designer Email</label>
                  <select 
                    value={editingProject.designerEmail || ''}
                    onChange={(e) => setEditingProject({ ...editingProject, designerEmail: e.target.value })}
                    className="w-full bg-[#121212] border border-[#333333] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-[#D4AF37] transition-colors appearance-none"
                  >
                    <option value="">Select a Designer</option>
                    {availableDesigners.map(user => (
                      <option key={user.id} value={user.email}>
                        {user.name || user.email}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Sales Person Email</label>
                  <select 
                    value={editingProject.salesPersonEmail || editingProject.matchedClient?.salesPersonEmail || ''}
                    onChange={(e) => setEditingProject({ ...editingProject, salesPersonEmail: e.target.value })}
                    className="w-full bg-[#121212] border border-[#333333] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-[#D4AF37] transition-colors appearance-none"
                  >
                    <option value="">Select a Sales Person</option>
                    {availableSales.map(user => (
                      <option key={user.id} value={user.email}>
                        {user.name || user.email}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Final Cost (₹)</label>
                  <input 
                    type="number" 
                    value={editingProject.calculatedCost || 0}
                    onChange={(e) => setEditingProject({ ...editingProject, calculatedCost: Number(e.target.value) })}
                    className="w-full bg-[#121212] border border-[#333333] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-[#D4AF37] transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Designer Comm. (₹)</label>
                  <input 
                    type="number" 
                    value={editingProject.designerCommission || 0}
                    onChange={(e) => setEditingProject({ ...editingProject, designerCommission: Number(e.target.value) })}
                    className="w-full bg-[#121212] border border-[#333333] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-[#D4AF37] transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Sales Comm. (₹)</label>
                  <input 
                    type="number" 
                    value={editingProject.salesCommission || 0}
                    onChange={(e) => setEditingProject({ ...editingProject, salesCommission: Number(e.target.value) })}
                    className="w-full bg-[#121212] border border-[#333333] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-[#D4AF37] transition-colors"
                  />
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-[#333333] flex justify-end space-x-3 bg-[#1A1A1A]">
              <button 
                onClick={() => { setIsEditProjectModalOpen(false); setEditingProject(null); }}
                className="px-4 py-2 rounded-lg bg-[#252525] hover:bg-[#2A2A2A] text-gray-300 border border-[#333333] transition-colors font-medium text-sm"
              >
                Cancel
              </button>
              <button 
                onClick={handleUpdateProject}
                className="px-4 py-2 rounded-lg bg-[#D4AF37] hover:bg-[#c49f2c] text-black transition-colors font-semibold text-sm shadow-md shadow-[#D4AF37]/20"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Global App Settings Modal */}
      {isSettingsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-[#1E1E1E] border border-[#333333] rounded-xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-[#333333] flex justify-between items-center">
              <h3 className="text-lg font-medium text-white flex items-center">
                <Settings className="w-5 h-5 mr-2 text-[#D4AF37]" />
                Global App Settings
              </h3>
              <button 
                onClick={() => setIsSettingsModalOpen(false)}
                className="text-gray-400 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1 space-y-6">
              <div className="text-center py-8">
                <p className="text-gray-400 text-sm">Additional global settings will be available in a future update.</p>
                <p className="text-gray-500 text-xs mt-2">Note: Branding and logo configuration are now centrally managed in the Admin Console.</p>
              </div>
            </div>
            
            <div className="px-6 py-4 border-t border-[#333333] flex justify-end bg-[#1A1A1A]">
              <button 
                onClick={() => setIsSettingsModalOpen(false)}
                className="px-4 py-2 rounded-lg bg-[#D4AF37] hover:bg-[#c49f2c] text-black transition-colors font-semibold shadow-md shadow-[#D4AF37]/20 w-full"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
