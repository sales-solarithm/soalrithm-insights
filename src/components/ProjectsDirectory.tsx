'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { 
  FolderKanban, 
  Search, 
  Filter, 
  RotateCcw, 
  Edit, 
  Trash2, 
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Plus,
  Eye,
  X,
  Calendar
} from 'lucide-react';
import { 
  formatCurrency, 
  formatSafeDate, 
  parseSafeDate,
  getProjectDate, 
  safeNumber, 
  isZeroOrPositive,
  toTitleCase, 
  formatIndianName, 
  SCOPE_LABELS,
  resolveProjectPaymentStatus,
  findMatchingInvoicesForProject,
  getEmployeeNameEnhanced,
  formatTwoPartName
} from '@/src/lib/projectUtils';
import EditProjectModal from './EditProjectModal';

export interface ProjectsDirectoryProps {
  projects: any[];
  clients: any[];
  users: any[];
  invoices?: any[];
  onUpdateProject?: (updatedProject: any) => Promise<void> | void;
  onDeleteProject?: (projectId: string, projectName: string) => Promise<void> | void;
  renderTimeFilterControls?: (prefix: string) => React.ReactNode;
}

/**
 * Generate smart pagination range with active page numbers
 */
function getPaginationRange(current: number, total: number): (number | string)[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  if (current <= 4) {
    return [1, 2, 3, 4, 5, '...', total];
  }
  if (current >= total - 3) {
    return [1, '...', total - 4, total - 3, total - 2, total - 1, total];
  }
  return [1, '...', current - 1, current, current + 1, '...', total];
}

/**
 * Detect if project has multi-scope specification
 */
function isMultiScope(project: any): boolean {
  if (!project) return false;
  if (Array.isArray(project.scopes) && project.scopes.length > 1) return true;
  if (Array.isArray(project.scopeList) && project.scopeList.length > 1) return true;
  const raw = String(project.scopeOfWork || '');
  return raw.includes('+') || raw.includes(',') || raw.includes('/');
}

/**
 * Extract single vs multi scope breakdown
 */
function getScopeBreakdown(project: any): string[] {
  if (!project) return ['Standard Scope'];
  if (Array.isArray(project.scopes) && project.scopes.length > 0) {
    return project.scopes;
  }
  if (Array.isArray(project.scopeList) && project.scopeList.length > 0) {
    return project.scopeList;
  }
  const raw = String(project.scopeOfWork || '');
  if (!raw) return ['Standard Scope'];
  if (raw.includes('+')) {
    return raw.split('+').map(s => s.trim()).filter(Boolean);
  }
  if (raw.includes(',')) {
    return raw.split(',').map(s => s.trim()).filter(Boolean);
  }
  return [raw];
}

/**
 * Zero-preserving project financial resolvers (Audit FIN-02 / ZERO-PRESERVATION)
 */
function resolveProjectCost(p: any): number {
  if (isZeroOrPositive(p?.finalCost)) return Number(p.finalCost);
  if (isZeroOrPositive(p?.calculatedCost)) return Number(p.calculatedCost);
  if (isZeroOrPositive(p?.cost)) return Number(p.cost);
  if (isZeroOrPositive(p?.amount)) return Number(p.amount);
  if (isZeroOrPositive(p?.totalCost)) return Number(p.totalCost);
  if (isZeroOrPositive(p?.price)) return Number(p.price);
  return 0;
}

function resolveDesignerCommission(p: any): number {
  if (isZeroOrPositive(p?.designerCommission)) return Number(p.designerCommission);
  if (isZeroOrPositive(p?.designerFee)) return Number(p.designerFee);
  return 0;
}

function resolveSalesCommission(p: any): number {
  if (isZeroOrPositive(p?.salesCommission)) return Number(p.salesCommission);
  if (isZeroOrPositive(p?.commission)) return Number(p.commission);
  return 0;
}

export default function ProjectsDirectory({
  projects = [],
  clients = [],
  users = [],
  invoices = [],
  onUpdateProject,
  onDeleteProject,
  renderTimeFilterControls
}: ProjectsDirectoryProps) {
  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [clientFilter, setClientFilter] = useState('all');
  const [scopeFilter, setScopeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [designerFilter, setDesignerFilter] = useState('all');
  const [selectedYear, setSelectedYear] = useState('all');
  const [selectedMonth, setSelectedMonth] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  
  // 20-Row Pagination
  const PAGE_SIZE = 20;

  // Edit, Delete & Details Modal States
  const [editingProject, setEditingProject] = useState<any | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [detailsProject, setDetailsProject] = useState<any | null>(null);
  const [projectToDelete, setProjectToDelete] = useState<any | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Enhanced Helper to resolve employee name with 2-part formatting (Surname & Firstname)
  const getEmployeeName = useCallback((email: string | undefined | null) => {
    if (!email) return 'Unassigned';
    const fullName = getEmployeeNameEnhanced(email, users);
    return formatTwoPartName(fullName);
  }, [users]);

  // Status Badge Helper
  const getStatusBadge = (status: string) => {
    const baseClasses = "w-28 flex items-center justify-center px-2 py-1 rounded text-xs font-medium border text-center";
    switch (status?.toLowerCase()) {
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

  // Payment Status Helper
  const getPaymentStatusBadge = (project: any) => {
    const paymentInfo = resolveProjectPaymentStatus(project, invoices);
    const baseClasses = "w-28 flex items-center justify-center px-2 py-1 rounded text-xs font-semibold text-center";

    switch (paymentInfo.status) {
      case 'paid':
        return (
          <div className={`${baseClasses} bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400`}>
            Paid
          </div>
        );
      case 'partially_paid':
        return (
          <div className={`${baseClasses} bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400`}>
            Partially Paid
          </div>
        );
      case 'sent':
        return (
          <div className={`${baseClasses} bg-[#D4AF37]/15 border border-[#D4AF37]/50 text-[#D4AF37]`}>
            Invoice Sent
          </div>
        );
      default:
        return (
          <div className={`${baseClasses} bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400`}>
            Payment Pending
          </div>
        );
    }
  };

  // Filter options
  const clientOptions = useMemo(() => {
    const set = new Set<string>();
    projects.forEach(p => {
      const name = p.clientName || p.client || p.matchedClient?.companyName || p.matchedClient?.name;
      if (name && typeof name === 'string' && name.trim()) set.add(name.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [projects]);

  const scopeOptions = useMemo(() => {
    const set = new Set<string>();
    projects.forEach(p => {
      const s1 = p.scopeOfWork;
      const s2 = p.scope;
      if (s1 && typeof s1 === 'string' && s1.trim()) set.add(s1.trim());
      if (s2 && typeof s2 === 'string' && s2.trim()) set.add(s2.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [projects]);

  const statusOptions = useMemo(() => {
    const set = new Set<string>();
    projects.forEach(p => {
      if (p.status && typeof p.status === 'string' && p.status.trim()) {
        set.add(p.status.trim());
      }
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [projects]);

  const designerOptions = useMemo(() => {
    const set = new Set<string>();
    projects.forEach(p => {
      const candidates = [
        p.assignedDesigner,
        p.designerName,
        p.designer,
        p.assignedEngineer,
        p.designerId,
        p.designerEmail ? formatIndianName(getEmployeeName(p.designerEmail)) : null
      ];
      candidates.forEach(d => {
        if (d && typeof d === 'string' && d.trim() && d.trim().toLowerCase() !== 'n/a' && d.trim().toLowerCase() !== 'unassigned') {
          set.add(d.trim());
        }
      });
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [projects, getEmployeeName]);

  const availableYears = useMemo(() => {
    const set = new Set<string>();
    projects.forEach(p => {
      const raw = p.projectDate || p.date || p.createdAt;
      const d = parseSafeDate(raw) || (raw ? new Date(raw) : null);
      if (d && !isNaN(d.getTime())) {
        set.add(String(d.getFullYear()));
      }
    });
    if (set.size === 0) {
      set.add(String(new Date().getFullYear()));
    }
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [projects]);

  const monthOptions = useMemo(() => [
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
  ], []);

  // Multi-Field Filter & Search Logic
  const filteredProjects = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const rows = projects.filter((p) => {
      // 1. Client Filter: check project.clientName, project.client, matchedClient
      if (clientFilter !== 'all') {
        const target = clientFilter.trim().toLowerCase();
        const clientCandidates = [
          p.clientName,
          p.client,
          p.matchedClient?.companyName,
          p.matchedClient?.name
        ].filter(Boolean).map(c => String(c).trim().toLowerCase());

        const matchesClient = clientCandidates.some(c => c === target || c.includes(target) || target.includes(c));
        if (!matchesClient) return false;
      }

      // 2. Scope Filter: match project.scopeOfWork and project.scope (trimmed and case-insensitive)
      if (scopeFilter !== 'all') {
        const targetScope = scopeFilter.trim().toLowerCase();
        const rawScopeOfWork = String(p.scopeOfWork || '').trim().toLowerCase();
        const rawScope = String(p.scope || '').trim().toLowerCase();
        const matchesScope =
          rawScopeOfWork === targetScope ||
          rawScope === targetScope ||
          rawScopeOfWork.includes(targetScope) ||
          rawScope.includes(targetScope);
        if (!matchesScope) return false;
      }

      // 3. Designer Filter: check project.assignedDesigner, project.designerName, project.designer, project.assignedEngineer, project.designerId
      if (designerFilter !== 'all') {
        const targetDes = designerFilter.trim().toLowerCase();
        const designerCandidates = [
          p.assignedDesigner,
          p.designerName,
          p.designer,
          p.assignedEngineer,
          p.designerId,
          p.designerEmail ? getEmployeeName(p.designerEmail) : null,
          p.designerEmail ? formatIndianName(getEmployeeName(p.designerEmail)) : null,
          p.designerEmail
        ].filter(Boolean).map(d => String(d).trim().toLowerCase());

        const matchesDesigner = designerCandidates.some(d => d === targetDes || d.includes(targetDes) || targetDes.includes(d));
        if (!matchesDesigner) return false;
      }

      // 4. Status Filter: case-insensitive match on project.status
      if (statusFilter !== 'all') {
        const targetStatus = statusFilter.trim().toLowerCase();
        const pStatus = String(p.status || '').trim().toLowerCase();
        if (pStatus !== targetStatus) return false;
      }

      // 5. Timeline Filter (Year & Month): resolve date using project.projectDate || project.date || project.createdAt
      if (selectedYear !== 'all' || selectedMonth !== 'all') {
        const rawDate = p.projectDate || p.date || p.createdAt;
        const d = parseSafeDate(rawDate) || (rawDate ? new Date(rawDate) : null);
        if (!d || isNaN(d.getTime())) return false;

        if (selectedYear !== 'all' && String(d.getFullYear()) !== String(selectedYear)) {
          return false;
        }

        if (selectedMonth !== 'all') {
          const mIdx = d.getMonth(); // 0-11
          const m1Idx = mIdx + 1; // 1-12
          const mName = d.toLocaleString('en-US', { month: 'long' }).toLowerCase();
          const targetM = String(selectedMonth).trim().toLowerCase();
          const matchesMonth =
            targetM === String(mIdx) ||
            targetM === String(m1Idx) ||
            targetM === mName ||
            mName.startsWith(targetM);
          if (!matchesMonth) return false;
        }
      }

      // 6. Search Bar: match search query across project name, project number (projectNumber / srNo), client name, and assigned designer
      if (q) {
        const searchPool = [
          p.projectName,
          p.name,
          p.title,
          p.projectNumber,
          p.srNo,
          p.projNo,
          p.id,
          p.clientName,
          p.client,
          p.matchedClient?.companyName,
          p.assignedDesigner,
          p.designerName,
          p.designer,
          p.assignedEngineer,
          p.designerId,
          p.designerEmail,
          p.designerEmail ? getEmployeeName(p.designerEmail) : null,
          p.scopeOfWork,
          p.scope
        ].filter(Boolean).map(v => String(v).toLowerCase());

        const matchesQuery = searchPool.some(val => val.includes(q));
        if (!matchesQuery) return false;
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
    projects,
    clientFilter,
    scopeFilter,
    statusFilter,
    designerFilter,
    selectedYear,
    selectedMonth,
    searchQuery,
    getEmployeeName
  ]);

  // Slicing calculation strictly tied to filteredProjects (20 projects per page)
  const totalPages = Math.max(1, Math.ceil(filteredProjects.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, currentPage), totalPages);
  const paginatedProjects = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filteredProjects.slice(start, start + PAGE_SIZE);
  }, [filteredProjects, safePage, PAGE_SIZE]);

  // Save updated project
  const handleSaveProject = async (updated: any) => {
    if (onUpdateProject) {
      await onUpdateProject(updated);
    }
    setIsEditModalOpen(false);
    setEditingProject(null);
  };

  // Confirm delete project
  const handleConfirmDelete = async () => {
    if (!projectToDelete) return;
    setIsDeleting(true);
    try {
      if (onDeleteProject) {
        await onDeleteProject(projectToDelete.id, projectToDelete.projectName);
      }
      setProjectToDelete(null);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="w-full space-y-6">
      <div className="bg-white dark:bg-[#1E1E1E] rounded-xl shadow-sm p-5 border border-gray-200 dark:border-[#333333] transition-colors">
        {/* Top Header & Search Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/30">
              <FolderKanban className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">Projects Directory</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Centralized registry with row-level cost, engineer assignment, and sales commission overrides.
              </p>
            </div>
            <span className="text-xs bg-gray-100 dark:bg-[#121212] border border-gray-300 dark:border-[#333333] px-2.5 py-0.5 rounded-full text-gray-600 dark:text-gray-400 font-mono hidden md:inline-block">
              {filteredProjects.length} of {projects.length}
            </span>
          </div>

          <div className="flex items-center gap-3">
            {renderTimeFilterControls && renderTimeFilterControls('projects-dir')}
          </div>
        </div>

        {/* Prominent High-Contrast Filter Toolbar (Single Control Source) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5 p-4 rounded-xl bg-gray-50 dark:bg-[#141414] border border-gray-200 dark:border-neutral-700/80 shadow-sm">
          {/* 1. Client Filter Dropdown */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-gray-700 dark:text-neutral-200 uppercase tracking-wider flex items-center justify-between">
              <span>Client</span>
              {clientFilter !== 'all' && (
                <span className="text-[#D4AF37] font-bold text-[10px] normal-case bg-[#D4AF37]/10 px-1 py-0.2 rounded border border-[#D4AF37]/30">
                  Active
                </span>
              )}
            </label>
            <select
              id="projects-client-filter-dropdown"
              value={clientFilter}
              onChange={(e) => {
                setClientFilter(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full text-xs font-medium py-2 px-2.5 min-h-[38px] text-neutral-900 dark:text-neutral-100 bg-white dark:bg-[#1E1E1E] border border-gray-300 dark:border-neutral-700 rounded-lg focus:outline-none focus:border-[#D4AF37] focus:ring-1 focus:ring-[#D4AF37] transition-all cursor-pointer shadow-sm truncate"
            >
              <option value="all" className="bg-white dark:bg-[#1E1E1E] text-neutral-900 dark:text-neutral-100 py-2">
                All Clients ({clientOptions.length})
              </option>
              {clientOptions.map((c) => (
                <option key={c} value={c} className="bg-white dark:bg-[#1E1E1E] text-neutral-900 dark:text-neutral-100 py-2">
                  {c}
                </option>
              ))}
            </select>
          </div>

          {/* 2. Scope Filter Dropdown */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-gray-700 dark:text-neutral-200 uppercase tracking-wider flex items-center justify-between">
              <span>Scope</span>
              {scopeFilter !== 'all' && (
                <span className="text-[#D4AF37] font-bold text-[10px] normal-case bg-[#D4AF37]/10 px-1 py-0.2 rounded border border-[#D4AF37]/30">
                  Active
                </span>
              )}
            </label>
            <select
              value={scopeFilter}
              onChange={(e) => {
                setScopeFilter(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full text-xs font-medium py-2 px-2.5 min-h-[38px] text-neutral-900 dark:text-neutral-100 bg-white dark:bg-[#1E1E1E] border border-gray-300 dark:border-neutral-700 rounded-lg focus:outline-none focus:border-[#D4AF37] focus:ring-1 focus:ring-[#D4AF37] transition-all cursor-pointer shadow-sm truncate"
            >
              <option value="all" className="bg-white dark:bg-[#1E1E1E] text-neutral-900 dark:text-neutral-100 py-2">All Scopes</option>
              {scopeOptions.map((s) => (
                <option key={s} value={s} className="bg-white dark:bg-[#1E1E1E] text-neutral-900 dark:text-neutral-100 py-2">
                  {toTitleCase(s)}
                </option>
              ))}
            </select>
          </div>

          {/* 3. Designer Filter Dropdown */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-gray-700 dark:text-neutral-200 uppercase tracking-wider flex items-center justify-between">
              <span>Designer</span>
              {designerFilter !== 'all' && (
                <span className="text-[#D4AF37] font-bold text-[10px] normal-case bg-[#D4AF37]/10 px-1 py-0.2 rounded border border-[#D4AF37]/30">
                  Active
                </span>
              )}
            </label>
            <select
              value={designerFilter}
              onChange={(e) => {
                setDesignerFilter(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full text-xs font-medium py-2 px-2.5 min-h-[38px] text-neutral-900 dark:text-neutral-100 bg-white dark:bg-[#1E1E1E] border border-gray-300 dark:border-neutral-700 rounded-lg focus:outline-none focus:border-[#D4AF37] focus:ring-1 focus:ring-[#D4AF37] transition-all cursor-pointer shadow-sm truncate"
            >
              <option value="all" className="bg-white dark:bg-[#1E1E1E] text-neutral-900 dark:text-neutral-100 py-2">All Designers ({designerOptions.length})</option>
              {designerOptions.map((d) => (
                <option key={d} value={d} className="bg-white dark:bg-[#1E1E1E] text-neutral-900 dark:text-neutral-100 py-2">
                  {d}
                </option>
              ))}
            </select>
          </div>

          {/* 4. Project Status Filter Dropdown */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-gray-700 dark:text-neutral-200 uppercase tracking-wider flex items-center justify-between">
              <span>Status</span>
              {statusFilter !== 'all' && (
                <span className="text-[#D4AF37] font-bold text-[10px] normal-case bg-[#D4AF37]/10 px-1 py-0.2 rounded border border-[#D4AF37]/30">
                  Active
                </span>
              )}
            </label>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full text-xs font-medium py-2 px-2.5 min-h-[38px] text-neutral-900 dark:text-neutral-100 bg-white dark:bg-[#1E1E1E] border border-gray-300 dark:border-neutral-700 rounded-lg focus:outline-none focus:border-[#D4AF37] focus:ring-1 focus:ring-[#D4AF37] transition-all cursor-pointer shadow-sm truncate"
            >
              <option value="all" className="bg-white dark:bg-[#1E1E1E] text-neutral-900 dark:text-neutral-100 py-2">All Statuses</option>
              {statusOptions.map((s) => (
                <option key={s} value={s} className="bg-white dark:bg-[#1E1E1E] text-neutral-900 dark:text-neutral-100 py-2">
                  {toTitleCase(s)}
                </option>
              ))}
            </select>
          </div>

          {/* 5. Timeline Month Dropdown */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-gray-700 dark:text-neutral-200 uppercase tracking-wider flex items-center justify-between">
              <span>Month</span>
              {selectedMonth !== 'all' && (
                <span className="text-[#D4AF37] font-bold text-[10px] normal-case bg-[#D4AF37]/10 px-1 py-0.2 rounded border border-[#D4AF37]/30">
                  Active
                </span>
              )}
            </label>
            <select
              value={selectedMonth}
              onChange={(e) => {
                setSelectedMonth(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full text-xs font-medium py-2 px-2.5 min-h-[38px] text-neutral-900 dark:text-neutral-100 bg-white dark:bg-[#1E1E1E] border border-gray-300 dark:border-neutral-700 rounded-lg focus:outline-none focus:border-[#D4AF37] focus:ring-1 focus:ring-[#D4AF37] transition-all cursor-pointer shadow-sm truncate"
            >
              {monthOptions.map((m) => (
                <option key={m.value} value={m.value} className="bg-white dark:bg-[#1E1E1E] text-neutral-900 dark:text-neutral-100 py-2">
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          {/* 6. Timeline Year Dropdown */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-gray-700 dark:text-neutral-200 uppercase tracking-wider flex items-center justify-between">
              <span>Year</span>
              {selectedYear !== 'all' && (
                <span className="text-[#D4AF37] font-bold text-[10px] normal-case bg-[#D4AF37]/10 px-1 py-0.2 rounded border border-[#D4AF37]/30">
                  Active
                </span>
              )}
            </label>
            <select
              value={selectedYear}
              onChange={(e) => {
                setSelectedYear(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full text-xs font-medium py-2 px-2.5 min-h-[38px] text-neutral-900 dark:text-neutral-100 bg-white dark:bg-[#1E1E1E] border border-gray-300 dark:border-neutral-700 rounded-lg focus:outline-none focus:border-[#D4AF37] focus:ring-1 focus:ring-[#D4AF37] transition-all cursor-pointer shadow-sm truncate"
            >
              <option value="all" className="bg-white dark:bg-[#1E1E1E] text-neutral-900 dark:text-neutral-100 py-2">All Years</option>
              {availableYears.map((yr) => (
                <option key={yr} value={yr} className="bg-white dark:bg-[#1E1E1E] text-neutral-900 dark:text-neutral-100 py-2">
                  {yr}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Global Filter & Quick Search */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 pt-3 border-t border-gray-100 dark:border-[#2A2A2A]">
          <div className="flex items-center flex-1 max-w-md bg-gray-50 dark:bg-[#121212] border border-gray-300 dark:border-neutral-700 hover:border-[#D4AF37]/50 focus-within:border-[#D4AF37] rounded-lg px-3 py-2 transition-colors">
            <Search className="w-4 h-4 text-gray-400 mr-2 flex-shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Search project name, client, scope, engineer..."
              className="bg-transparent text-sm text-gray-800 dark:text-gray-200 focus:outline-none w-full"
            />
          </div>

          {(clientFilter !== 'all' || scopeFilter !== 'all' || statusFilter !== 'all' || designerFilter !== 'all' || selectedYear !== 'all' || selectedMonth !== 'all' || searchQuery) && (
            <button
              onClick={() => {
                setClientFilter('all');
                setScopeFilter('all');
                setStatusFilter('all');
                setDesignerFilter('all');
                setSelectedYear('all');
                setSelectedMonth('all');
                setSearchQuery('');
                setCurrentPage(1);
              }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-amber-600 dark:text-[#D4AF37] hover:bg-[#D4AF37]/10 border border-[#D4AF37]/30 transition-colors cursor-pointer shrink-0"
              title="Reset all filters and restore full project list"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset All Filters</span>
            </button>
          )}
        </div>

        {/* Projects Table - Clean Header (No Duplicate Select Controls) */}
        <div className="overflow-x-auto whitespace-nowrap">
          <table className="w-full text-left text-xs whitespace-nowrap">
            <thead>
              <tr className="text-gray-500 dark:text-gray-400 uppercase text-[11px] border-b border-gray-200 dark:border-[#333333] bg-gray-50/50 dark:bg-[#141414]/50">
                <th className="pb-3 px-4 font-semibold">Project Name</th>
                <th className="pb-3 px-4 font-semibold">Client</th>
                <th className="pb-3 px-4 font-semibold">Capacity</th>
                <th className="pb-3 px-4 font-semibold">Date</th>
                <th className="pb-3 px-4 font-semibold">Scope of Work</th>
                <th className="pb-3 px-4 font-semibold">Assigned Designer</th>
                <th className="pb-3 px-4 font-semibold text-right">Cost (₹)</th>
                <th className="pb-3 px-4 font-semibold text-right">Des. Comm (₹)</th>
                <th className="pb-3 px-4 font-semibold text-right text-[#D4AF37]">Sales Comm (₹)</th>
                <th className="pb-3 px-4 font-semibold text-right">Balance (₹)</th>
                <th className="pb-3 px-4 font-semibold text-center">Status</th>
                <th className="pb-3 px-4 font-semibold text-center">Payment</th>
                <th className="pb-3 px-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-[#2A2A2A]">
              {paginatedProjects.length === 0 ? (
                <tr>
                  <td colSpan={13} className="py-8 text-center text-gray-500">
                    No matching projects found.
                  </td>
                </tr>
              ) : (
                paginatedProjects.map((proj) => {
                  const cost = resolveProjectCost(proj);
                  const desComm = resolveDesignerCommission(proj);
                  const salesComm = resolveSalesCommission(proj);
                  const balance = cost - (desComm + salesComm);
                  const pDate = getProjectDate(proj);
                  const designerAlias = proj.designerEmail || proj.designer_email || proj.designer || proj.assignedDesigner || '';
                  const desName = getEmployeeName(designerAlias) || formatTwoPartName(proj.designerName) || 'Unassigned';

                  return (
                    <tr key={proj.id} className="hover:bg-gray-50 dark:hover:bg-[#252525]/50 transition-colors">
                      <td className="py-3 px-4 font-medium text-gray-900 dark:text-white">
                        {toTitleCase(proj.projectName)}
                      </td>
                      <td className="py-3 px-4 text-gray-700 dark:text-gray-300">
                        {toTitleCase(proj.clientName || proj.matchedClient?.companyName || '—')}
                      </td>
                      <td className="py-3 px-4 font-mono text-gray-600 dark:text-gray-400">
                        {proj.plantCapacity || proj.systemCapacity || proj.capacity ? `${proj.plantCapacity || proj.systemCapacity || proj.capacity} kWp` : '—'}
                      </td>
                      <td className="py-3 px-4 font-mono text-gray-600 dark:text-gray-400">
                        {formatSafeDate(pDate, 'slash') || '—'}
                      </td>
                      <td className="py-3 px-4 text-gray-700 dark:text-gray-300">
                        {toTitleCase(proj.scopeOfWork || '—')}
                      </td>
                      <td className="py-3 px-4 text-gray-700 dark:text-gray-300">
                        {desName !== 'N/A' ? desName : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-gray-900 dark:text-white font-medium">
                        {formatCurrency(cost)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-gray-700 dark:text-gray-300">
                        {formatCurrency(desComm)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-[#D4AF37]">
                        {formatCurrency(salesComm)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                        {formatCurrency(balance)}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {getStatusBadge(proj.status)}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {getPaymentStatusBadge(proj)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Details Button */}
                          <button
                            type="button"
                            onClick={() => setDetailsProject(proj)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-gray-700 dark:text-gray-200 hover:text-[#D4AF37] dark:hover:text-[#D4AF37] bg-gray-100 dark:bg-[#252525] hover:bg-[#D4AF37]/10 dark:hover:bg-[#D4AF37]/10 border border-gray-300 dark:border-[#3A3A3A] hover:border-[#D4AF37]/40 transition-colors cursor-pointer"
                            title="View project details"
                          >
                            <Eye className="w-3 h-3 text-[#D4AF37]" />
                            <span>Details</span>
                          </button>

                          {/* Edit Button */}
                          <button
                            type="button"
                            onClick={() => {
                              setEditingProject(proj);
                              setIsEditModalOpen(true);
                            }}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-[#D4AF37] hover:underline font-semibold cursor-pointer"
                            title="Edit project"
                          >
                            <Edit className="w-3 h-3" />
                            <span>Edit</span>
                          </button>

                          {/* Delete Button */}
                          <button
                            type="button"
                            onClick={() => setProjectToDelete(proj)}
                            className="p-1 text-gray-400 hover:text-rose-500 transition-colors cursor-pointer"
                            title="Delete Project"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* 20-ROW PAGINATION: "Showing 1–20 of 120 projects", Previous / Next, Active page numbers */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-4 mt-2 border-t border-gray-100 dark:border-[#2A2A2A] text-xs">
          <span className="text-gray-500 dark:text-gray-400 font-medium">
            Showing {filteredProjects.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filteredProjects.length)} of {filteredProjects.length} projects
          </span>

          <div className="flex items-center space-x-1.5">
            <button
              type="button"
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={safePage === 1}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-[#333333] disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-[#252525] text-gray-700 dark:text-gray-300 font-medium transition-colors cursor-pointer disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Previous</span>
            </button>

            {/* Active Page Numbers */}
            <div className="flex items-center space-x-1">
              {getPaginationRange(safePage, totalPages).map((p, idx) => {
                if (p === '...') {
                  return (
                    <span key={`ellipsis-${idx}`} className="px-2 text-gray-400 select-none">
                      ...
                    </span>
                  );
                }
                const pageNum = Number(p);
                const isActive = pageNum === safePage;
                return (
                  <button
                    key={pageNum}
                    type="button"
                    onClick={() => setCurrentPage(pageNum)}
                    className={`min-w-[32px] h-8 px-2 flex items-center justify-center rounded-lg text-xs font-mono transition-all cursor-pointer ${
                      isActive
                        ? 'bg-[#D4AF37] text-black font-bold border border-[#D4AF37] shadow-xs'
                        : 'bg-white dark:bg-[#1E1E1E] border border-gray-300 dark:border-[#333333] text-gray-700 dark:text-gray-300 hover:border-[#D4AF37]/50 hover:bg-gray-50 dark:hover:bg-[#252525]'
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={safePage === totalPages}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-[#333333] disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-[#252525] text-gray-700 dark:text-gray-300 font-medium transition-colors cursor-pointer disabled:cursor-not-allowed"
            >
              <span>Next</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Comprehensive Project Details Modal */}
      {detailsProject && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm transition-opacity"
          role="dialog"
          aria-modal="true"
        >
          <div className="relative w-full max-w-2xl max-h-[90vh] bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] rounded-2xl shadow-2xl overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="p-5 sm:p-6 border-b border-gray-200 dark:border-[#333333] flex items-start justify-between gap-4 bg-gray-50/60 dark:bg-[#141414]/60">
              <div className="flex items-start gap-3">
                <div className="p-2.5 rounded-xl bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/30 shrink-0 mt-0.5">
                  <FolderKanban className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white tracking-tight">
                    {toTitleCase(detailsProject.projectName)}
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    Project Reference ID: <span className="font-mono text-gray-700 dark:text-gray-300">{detailsProject.id || 'N/A'}</span>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setDetailsProject(null)}
                  className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-white rounded-lg hover:bg-gray-100 dark:hover:bg-[#252525] transition-colors cursor-pointer"
                  aria-label="Close modal"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-5 sm:p-6 space-y-5 overflow-y-auto">
              {/* Status Badges Strip */}
              <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-gray-50 dark:bg-[#141414] border border-gray-200 dark:border-[#2D2D2D]">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Project Status:</span>
                  {getStatusBadge(detailsProject.status)}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Payment Status:</span>
                  {getPaymentStatusBadge(detailsProject)}
                </div>
              </div>

              {/* Core Information Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-xs">
                {/* Client Name */}
                <div className="p-3.5 rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1A1A1A]">
                  <span className="text-[10px] font-semibold uppercase text-gray-500 dark:text-gray-400 tracking-wider">Client Name</span>
                  <div className="text-sm font-bold text-gray-900 dark:text-white mt-1">
                    {toTitleCase(detailsProject.clientName || detailsProject.matchedClient?.companyName || '—')}
                  </div>
                </div>

                {/* Plant Capacity (kWp) */}
                <div className="p-3.5 rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1A1A1A]">
                  <span className="text-[10px] font-semibold uppercase text-gray-500 dark:text-gray-400 tracking-wider">Plant Capacity (kWp)</span>
                  <div className="text-sm font-bold text-gray-900 dark:text-white font-mono mt-1">
                    {detailsProject.plantCapacity || detailsProject.systemCapacity || detailsProject.capacity 
                      ? `${detailsProject.plantCapacity || detailsProject.systemCapacity || detailsProject.capacity} kWp` 
                      : '—'}
                  </div>
                </div>

                {/* Project Date */}
                <div className="p-3.5 rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1A1A1A]">
                  <span className="text-[10px] font-semibold uppercase text-gray-500 dark:text-gray-400 tracking-wider">Project Date</span>
                  <div className="text-sm font-bold text-gray-900 dark:text-white font-mono mt-1">
                    {formatSafeDate(getProjectDate(detailsProject), 'slash') || '—'}
                  </div>
                </div>

                {/* Pricing Category / Tier */}
                <div className="p-3.5 rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1A1A1A]">
                  <span className="text-[10px] font-semibold uppercase text-gray-500 dark:text-gray-400 tracking-wider">Pricing Category / Tier</span>
                  <div className="text-sm font-bold text-[#D4AF37] font-mono mt-1">
                    {detailsProject.pricingCategory || detailsProject.category || 'Standard Tier'}
                  </div>
                </div>
              </div>

              {/* Staff Assignments */}
              <div className="p-4 rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-gray-50/50 dark:bg-[#161616] space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300">
                  Staff &amp; Executive Assignment
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-gray-500">Sales Person / Sales Executive:</span>
                    <div className="text-sm font-semibold text-gray-900 dark:text-white mt-0.5">
                      {formatIndianName(
                        detailsProject.salesPerson || 
                        detailsProject.salesExecutive || 
                        detailsProject.salesRep || 
                        getEmployeeName(detailsProject.salesPersonEmail || detailsProject.salesEmail) || 
                        'Unassigned'
                      )}
                    </div>
                    {detailsProject.salesPersonEmail && (
                      <span className="text-[11px] text-gray-400 font-mono">{detailsProject.salesPersonEmail}</span>
                    )}
                  </div>

                  <div>
                    <span className="text-gray-500">Assigned Designer Name &amp; ID:</span>
                    <div className="text-sm font-semibold text-gray-900 dark:text-white mt-0.5">
                      {getEmployeeName(detailsProject.designerEmail || detailsProject.assignedDesigner || detailsProject.designer) || formatTwoPartName(detailsProject.designerName) || 'Unassigned'}
                    </div>
                    <div className="text-[11px] text-gray-400 font-mono mt-0.5">
                      ID: {detailsProject.designerEmployeeId || detailsProject.designerId || detailsProject.designerEmail || 'N/A'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Scope of Work Breakdown (Full specification: Single vs Multi scope breakdown) */}
              <div className="p-4 rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-gray-50/50 dark:bg-[#161616] space-y-2.5">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300">
                    Scope of Work Specification
                  </h4>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                    isMultiScope(detailsProject) 
                      ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30' 
                      : 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30'
                  }`}>
                    {isMultiScope(detailsProject) ? 'Multi-Scope Package' : 'Single Scope'}
                  </span>
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  {getScopeBreakdown(detailsProject).map((scopeItem, idx) => (
                    <span 
                      key={idx}
                      className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-white dark:bg-[#202020] border border-gray-200 dark:border-[#333333] text-gray-900 dark:text-white shadow-xs"
                    >
                      {toTitleCase(scopeItem)}
                    </span>
                  ))}
                </div>

                {detailsProject.subService && (
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 pt-1">
                    Sub-Service Tier: <span className="font-semibold text-gray-700 dark:text-gray-300">{detailsProject.subService}</span>
                  </p>
                )}
              </div>

              {/* Financial Breakdown (Final Cost, Designer Expense, Sales Commission, Net Balance) */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300">
                  Financial Breakdown
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div className="p-3.5 rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1A1A1A]">
                    <span className="text-[10px] font-semibold uppercase text-gray-500 dark:text-gray-400">Final Cost (₹)</span>
                    <div className="text-base font-bold text-gray-900 dark:text-white font-mono mt-1">
                      {formatCurrency(resolveProjectCost(detailsProject))}
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1A1A1A]">
                    <span className="text-[10px] font-semibold uppercase text-gray-500 dark:text-gray-400">Designer Expense (₹)</span>
                    <div className="text-base font-bold text-gray-800 dark:text-gray-200 font-mono mt-1">
                      {formatCurrency(resolveDesignerCommission(detailsProject))}
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl border border-[#D4AF37]/30 bg-[#D4AF37]/5">
                    <span className="text-[10px] font-semibold uppercase text-[#D4AF37]">Sales Commission (₹)</span>
                    <div className="text-base font-bold text-[#D4AF37] font-mono mt-1">
                      {formatCurrency(resolveSalesCommission(detailsProject))}
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl border border-emerald-500/30 bg-emerald-500/5">
                    <span className="text-[10px] font-semibold uppercase text-emerald-600 dark:text-emerald-400">Net Balance (₹)</span>
                    <div className="text-base font-bold text-emerald-600 dark:text-emerald-400 font-mono mt-1">
                      {formatCurrency(
                        resolveProjectCost(detailsProject) -
                        (resolveDesignerCommission(detailsProject) +
                         resolveSalesCommission(detailsProject))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 sm:p-5 border-t border-gray-200 dark:border-[#333333] flex items-center justify-end gap-2.5 bg-gray-50 dark:bg-[#141414]">
              <button
                type="button"
                onClick={() => setDetailsProject(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#252525] transition-colors cursor-pointer"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingProject(detailsProject);
                  setIsEditModalOpen(true);
                  setDetailsProject(null);
                }}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-[#D4AF37] hover:bg-[#c49f2c] active:bg-[#b59024] text-black transition-colors cursor-pointer shadow-sm"
              >
                Edit Project
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Project Modal */}
      {isEditModalOpen && editingProject && (
        <EditProjectModal
          isOpen={isEditModalOpen}
          project={editingProject}
          clients={clients}
          users={users}
          onClose={() => {
            setIsEditModalOpen(false);
            setEditingProject(null);
          }}
          onSave={handleSaveProject}
        />
      )}

      {/* Delete Confirmation Modal */}
      {projectToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] rounded-xl shadow-2xl w-full max-w-sm overflow-hidden p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 rounded-full bg-rose-500/10 text-rose-500">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-gray-900 dark:text-white">Delete Project</h3>
            </div>
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-4">
              Are you sure you want to permanently delete <span className="font-semibold text-gray-900 dark:text-white">{toTitleCase(projectToDelete.projectName)}</span>?
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setProjectToDelete(null)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-600 dark:text-gray-400 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white transition-colors cursor-pointer"
              >
                {isDeleting ? 'Deleting...' : 'Delete Project'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
