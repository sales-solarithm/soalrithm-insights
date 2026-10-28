'use client';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  LayoutGrid,
  FileEdit,
  History,
  Settings,
  Plus,
  Receipt,
  FileText,
  Calendar,
  CheckCircle2,
  Search,
  CreditCard,
  Trash2,
  Save,
  Eye,
  X,
  AlertCircle,
  AlertTriangle,
  ZoomIn,
  ZoomOut,
  ChevronDown,
  Download,
  Building2,
  MapPin,
  Calculator,
  Sparkles,
  Filter,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  CartesianGrid
} from 'recharts';
import {
  InvoiceData,
  InvoiceSettings,
  InvoiceRow,
  InvoiceTotals,
  defaultSettings,
  fmtINR,
  fmtNum,
  fmtDateDisplay,
  safeNum,
  todayISO,
  uid,
  calculateInvoiceTotals,
  buildInvoicePages,
  renderPageHTML,
  exportInvoicePDF,
  PAGE_W_MM,
  PAGE_H_MM,
  SCOPE_OPTIONS,
  CANONICAL_INVOICE_STATUS,
  canonicalInvoiceStatus,
  CanonicalInvoiceStatus,
  roundCurrency,
  determineClientGSTRule,
  ClientGSTRule
} from '@/src/lib/invoicePdfEngine';
import { useBillingState, blankInvoice, blankLineItem } from '@/src/lib/useBillingState';
import { useCompanySettings } from '@/src/lib/useCompanySettings';
import { 
  parseSafeDate, 
  formatSafeDate, 
  getProjectDate, 
  isZeroOrPositive, 
  safeNumber, 
  safeStringIdentifier,
  findMatchingInvoicesForProject,
  evaluateSubscriptionCoverage,
  resolveEffectivePricingCategory,
  findMatchingCapacityRow,
  calculateSlabCost
} from '@/src/lib/projectUtils';
import { syncInvoiceProjectsToFirestore } from '@/src/lib/projectSync';

export type BillingTab = 'dashboard' | 'invoice' | 'history' | 'settings';

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

interface BillingModuleProps {
  clients?: any[];
  projects?: any[];
  pricingRules?: any[];
  onNavigateToGlobalSettings?: () => void;
}

export default function BillingModule({
  clients: externalClients = [],
  projects: externalProjects = [],
  pricingRules: externalPricingRules = [],
  onNavigateToGlobalSettings
}: BillingModuleProps) {
  const { companySettings } = useCompanySettings();
  const {
    isLoaded,
    settings,
    invoices,
    currentInvoice,
    isDirty,
    setCurrentInvoice,
    setIsDirty,
    saveSettings,
    saveInvoices,
    saveCurrentDraft,
    deleteInvoice,
    startNewInvoice,
    loadInvoice,
    duplicateInvoice,
    updateInvoiceStatus,
    logRevenueForInvoice
  } = useBillingState();

  const [activeBillingTab, setActiveBillingTab] = useState<BillingTab>('dashboard');
  const [applyGST, setApplyGST] = useState<boolean>(true);

  // Partial Payment Modal State
  const [partialPaymentTarget, setPartialPaymentTarget] = useState<{
    invoice: InvoiceData;
    amount: string;
  } | null>(null);

  // Preview Modal state
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewInvoiceData, setPreviewInvoiceData] = useState<InvoiceData | null>(null);
  const [previewPagesHtml, setPreviewPagesHtml] = useState<{ pageNum: number; totalPages: number; html: string }[]>([]);
  const [zoomLevel, setZoomLevel] = useState(75);
  const [isPdfExporting, setIsPdfExporting] = useState(false);
  const [pdfProgressText, setPdfProgressText] = useState('');

  // Infinite write loop removed: payment sync is performed strictly on explicit user status change actions to prevent Firestore quota exhaustion.

  // Toast state
  const [toastMsg, setToastMsg] = useState('');
  const [toastType, setToastType] = useState<'success' | 'error' | 'info'>('info');
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToastMsg(msg);
    setToastType(type);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMsg('');
    }, 3500);
  };

  // Confirm dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    open: false,
    title: '',
    message: '',
    onConfirm: () => {}
  });

  const triggerConfirm = (title: string, message: string, onConfirm: () => void) => {
    setConfirmDialog({ open: true, title, message, onConfirm });
  };

  // Search & Filter states
  const [historySearch, setHistorySearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'PENDING' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED'>('all');
  const [historyCurrentPage, setHistoryCurrentPage] = useState<number>(1);
  const HISTORY_PAGE_SIZE = 10;

  // Reset page when search or status filter changes
  useEffect(() => {
    setHistoryCurrentPage(1);
  }, [historySearch, statusFilter]);

  // Format helper for YYYY-MM -> Human Readable (e.g. '2026-09' -> 'September 2026')
  const formatMonthDisplay = (ym: string): string => {
    if (!ym) return '';
    const [yearStr, monthStr] = ym.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    if (isNaN(year) || isNaN(month)) return ym;
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    return `${monthNames[month - 1] || monthStr} ${year}`;
  };

  // Canonical Date Hierarchy helper: projectDate -> date -> createdAt
  const getProjectYearMonth = (proj: any): string | null => {
    const d = getProjectDate(proj);
    if (!d || isNaN(d.getTime())) return null;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };

  // Directive 1: Billing Month State (Defaults to latest project month or current month)
  const [billingMonth, setBillingMonth] = useState<string>(() => {
    if (externalProjects.length > 0) {
      const sorted = [...externalProjects].sort((a, b) => {
        const dA = getProjectDate(a)?.getTime() || 0;
        const dB = getProjectDate(b)?.getTime() || 0;
        return dB - dA;
      });
      const latestDate = getProjectDate(sorted[0]);
      if (latestDate) {
        return `${latestDate.getFullYear()}-${String(latestDate.getMonth() + 1).padStart(2, '0')}`;
      }
    }
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  // Settings local form state
  const [settingsForm, setSettingsForm] = useState<InvoiceSettings>(settings);

  // Available project months for quick selection chips
  const availableProjectMonths = useMemo(() => {
    const monthMap = new Map<string, number>();
    externalProjects.forEach((p) => {
      const ym = getProjectYearMonth(p);
      if (ym) {
        monthMap.set(ym, (monthMap.get(ym) || 0) + 1);
      }
    });
    return Array.from(monthMap.entries())
      .map(([ym, count]) => ({ ym, count, label: formatMonthDisplay(ym) }))
      .sort((a, b) => b.ym.localeCompare(a.ym));
  }, [externalProjects]);

  // Directive 2: Cross-reference projects against selected month using canonical date hierarchy
// Helper to detect if project has an explicit unbilled upgrade in the target billing month
function hasExplicitUpgradeInMonth(project: any, month: string): boolean {
  if (!project || !Array.isArray(project.upgradeHistory) || !month) return false;
  const isGovindji = String(project.projectName || '').toLowerCase().includes('govindji');
  return project.upgradeHistory.some((u: any) => {
    if (!u || !u.upgradeDate) return false;
    const upgradeMonth = String(u.upgradeDate).slice(0, 7);
    if (upgradeMonth !== month) return false;
    if (u.invoicedInPeriod) return false;
    if (isGovindji) return true;
    // Check if real scope change occurred
    const prev = String(u.previousScope || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const cur = String(u.newScope || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return prev !== cur;
  });
}
  // Directive 1: Strict month filtering (Zero Month Leakage)
  // A project belongs to billingMonth IF AND ONLY IF:
  // 1. Its primary date is in this month: getProjectYearMonth(p) === billingMonth, OR
  // 2. It has an explicit upgrade in p.upgradeHistory that occurred in this month and is unbilled:
  const projectsInSelectedMonth = useMemo(() => {
    if (!billingMonth) return [];
    return externalProjects.filter((p) => {
      const isBaseMonth = getProjectYearMonth(p) === billingMonth;
      if (isBaseMonth) return true;
      return hasExplicitUpgradeInMonth(p, billingMonth);
    });
  }, [externalProjects, billingMonth]);

  // Directive 2: Filter clients so the dropdown ONLY displays clients who have projects in the chosen month
  const filteredClientsForMonth = useMemo(() => {
    if (!billingMonth || projectsInSelectedMonth.length === 0) return [];

    const clientMap = new Map<string, {
      id: string;
      name: string;
      projectCountInMonth: number;
      rawClient: any;
    }>();

    projectsInSelectedMonth.forEach((proj) => {
      const pClientId = proj.clientId || proj.matchedClient?.id;
      const pClientName = String(proj.clientName || proj.matchedClient?.companyName || proj.matchedClient?.name || '').trim();

      // Find in externalClients by ID or normalized name
      const matched = externalClients.find((c) => {
        if (pClientId && c.id === pClientId) return true;
        const cName = String(c.companyName || c.name || '').trim().toLowerCase();
        return pClientName && cName && pClientName.toLowerCase() === cName;
      });

      const clientKey = matched?.id || pClientId || (pClientName ? `name_${pClientName.toLowerCase()}` : null);
      if (!clientKey) return;

      const existing = clientMap.get(clientKey);
      if (existing) {
        existing.projectCountInMonth += 1;
      } else {
        const canonicalName = matched?.companyName || matched?.name || pClientName || 'Client';
        clientMap.set(clientKey, {
          id: matched?.id || pClientId || clientKey,
          name: canonicalName,
          projectCountInMonth: 1,
          rawClient: matched || {
            id: pClientId || clientKey,
            companyName: canonicalName,
            name: canonicalName,
            gstin: proj.clientGstin || proj.gstin || '',
            billingAddress: proj.clientAddress || '',
            phone: proj.clientPhone || ''
          }
        });
      }
    });

    // ONLY show clients with > 0 projects in this specific month
    return Array.from(clientMap.values())
      .filter((c) => c.projectCountInMonth > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [externalClients, projectsInSelectedMonth, billingMonth]);

  // Monthly Billing Activity for Dashboard Chart (Recharts)
  const billingChartData = useMemo(() => {
    const monthMap = new Map<string, { name: string; billed: number; count: number }>();
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    // Generate trailing 6 months bucket
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const target = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const ym = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}`;
      const label = `${monthNames[target.getMonth()]} '${String(target.getFullYear()).slice(2)}`;
      monthMap.set(ym, { name: label, billed: 0, count: 0 });
    }

    invoices.forEach((inv) => {
      const d = parseSafeDate(inv.invDate || (inv as any).date || inv.createdAt);
      if (d && !isNaN(d.getTime())) {
        const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (monthMap.has(ym)) {
          const entry = monthMap.get(ym)!;
          entry.billed += safeNumber(inv.totals?.payable ?? inv.amountReceived ?? 0);
          entry.count += 1;
        }
      }
    });

    return Array.from(monthMap.values());
  }, [invoices]);

  // Directive 4: Location-Based GST Rule determined dynamically from client location
  const activeGSTRule = useMemo(() => {
    return determineClientGSTRule(currentInvoice.client);
  }, [currentInvoice.client]);

  // Selected client object with package details & commercial model
  const selectedClientObject = useMemo(() => {
    if (!currentInvoice.clientId) return null;
    const fromMonth = filteredClientsForMonth.find((c) => c.id === currentInvoice.clientId)?.rawClient;
    if (fromMonth) return fromMonth;
    return externalClients.find((c) => c.id === currentInvoice.clientId) || null;
  }, [currentInvoice.clientId, filteredClientsForMonth, externalClients]);

  // Handle generating upfront subscription retainer invoice
  const handleGeneratePackageInvoice = (invoiceType: "PACKAGE_RETAINER" | "PACKAGE_RENEWAL" = "PACKAGE_RETAINER") => {
    if (!selectedClientObject || !selectedClientObject.subscriptionPlan) {
      showToast("Client does not have an active subscription package plan.", "error");
      return;
    }

    const plan = selectedClientObject.subscriptionPlan;
    const upfrontPrice = Number(plan.upfrontPrice || plan.price || 0);
    const scope = plan.scopeCovered || "Engineering";
    const duration = plan.durationMonths || 1;
    const quota = plan.totalAllowedProjects || 0;
    const planName = plan.planName || `${scope} Retainer`;

    const isRenewal = invoiceType === "PACKAGE_RENEWAL";
    const labelPrefix = isRenewal ? "Package Renewal" : "Initial Package Retainer";

    const retainerRow: InvoiceRow = {
      id: uid("row"),
      desc: `${planName} (${labelPrefix}) - ${duration} Month(s) (${quota} Projects Quota)`,
      scope: scope,
      kw: 0,
      charge: upfrontPrice
    };

    const nextRows = [retainerRow];
    const nextTotals = calculateInvoiceTotals(
      nextRows,
      currentInvoice.sgst,
      currentInvoice.cgst,
      currentInvoice.igst,
      currentInvoice.advance
    );

    const acquiringSalesRep = selectedClientObject.salesPersonEmail || selectedClientObject.salesEmail || selectedClientObject.assignedSales || "";

    setCurrentInvoice((prev) => ({
      ...prev,
      rows: nextRows,
      totals: nextTotals,
      invoiceType,
      packageType: planName,
      salesPersonEmail: acquiringSalesRep,
      salesIncentiveAmount: 500,
      salesIncentiveStatus: prev.status === "PAID" ? "ELIGIBLE" : "PENDING"
    }));

    setIsDirty(true);
    showToast(`Generated ${labelPrefix} Invoice for ${selectedClientObject.companyName || selectedClientObject.name} (₹${upfrontPrice.toLocaleString("en-IN")}) ✓`, "success");
  };

  const handleGenerateSubscriptionRetainerInvoice = () => handleGeneratePackageInvoice("PACKAGE_RETAINER");
  const handleGeneratePackageRenewalInvoice = () => handleGeneratePackageInvoice("PACKAGE_RENEWAL");

  // Handlers for Pending Invoice Notices (Delta vs Supersede)
  const handleResolvePendingAsDelta = () => {
    if (currentInvoice.clientId && billingMonth) {
      autoMapProjectsForClientAndMonth(currentInvoice.clientId, billingMonth, undefined, 'delta');
      showToast('Line items updated to bill incremental delta only.', 'info');
    }
  };

  const handleResolvePendingAsSupersede = (pendingInvId: string, pendingInvNo: string) => {
    // Supersede old pending invoice by marking it CANCELLED
    triggerConfirm(
      'Supersede & Cancel Prior Invoice?',
      `Are you sure you want to cancel pending invoice #${pendingInvNo} and bill the full project amount on the current invoice?`,
      () => {
        try {
          updateInvoiceStatus(pendingInvId, 'CANCELLED');
          if (currentInvoice.clientId && billingMonth) {
            autoMapProjectsForClientAndMonth(currentInvoice.clientId, billingMonth, undefined, 'full');
          }
          showToast(`Invoice #${pendingInvNo} cancelled/superseded. Full amount applied to current invoice ✓`, 'success');
        } catch (e: any) {
          showToast(`Failed to cancel invoice #${pendingInvNo}: ${e.message}`, 'error');
        }
      }
    );
  };

  // Handler for Client-Specific "Apply GST" Toggle
  const handleToggleGST = (enabled: boolean) => {
    setApplyGST(enabled);
    if (!enabled) {
      // Non-GST invoice: force tax percentages to 0
      const nextTotals = calculateInvoiceTotals(
        currentInvoice.rows,
        0,
        0,
        0,
        currentInvoice.advance
      );
      setCurrentInvoice((prev) => ({
        ...prev,
        cgst: 0,
        sgst: 0,
        igst: 0,
        totals: nextTotals
      }));
    } else {
      // Re-enable state-based GST rules: Gujarat -> CGST 9% + SGST 9%, Interstate -> IGST 18%
      const gstRule = determineClientGSTRule(currentInvoice.client);
      const nextTotals = calculateInvoiceTotals(
        currentInvoice.rows,
        gstRule.sgst,
        gstRule.cgst,
        gstRule.igst,
        currentInvoice.advance
      );
      setCurrentInvoice((prev) => ({
        ...prev,
        cgst: gstRule.cgst,
        sgst: gstRule.sgst,
        igst: gstRule.igst,
        totals: nextTotals
      }));
    }
    setIsDirty(true);
  };

  // Recalculate totals for active invoice
  const currentTotals: InvoiceTotals = useMemo(() => {
    return calculateInvoiceTotals(
      currentInvoice.rows,
      currentInvoice.sgst,
      currentInvoice.cgst,
      currentInvoice.igst,
      currentInvoice.advance
    );
  }, [currentInvoice.rows, currentInvoice.sgst, currentInvoice.cgst, currentInvoice.igst, currentInvoice.advance]);

  const tabs: { id: BillingTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutGrid },
    { id: 'invoice', label: 'Invoice Editor', icon: FileEdit },
    { id: 'history', label: 'Invoice History', icon: History },
    { id: 'settings', label: 'Settings', icon: Settings }
  ];

  // Prepare & open preview
  const handleOpenPreview = async (invData?: InvoiceData) => {
    const dataToPreview = invData || {
      ...currentInvoice,
      totals: currentTotals
    };

    if (!dataToPreview.invNo.trim()) {
      showToast('Invoice number is required.', 'error');
      return;
    }
    if (!dataToPreview.client?.name?.trim()) {
      showToast('Client name is required.', 'error');
      return;
    }
    if (!dataToPreview.rows?.length || !dataToPreview.rows.some((r) => r.desc.trim())) {
      showToast('At least one line item with a description is required.', 'error');
      return;
    }

    setPreviewInvoiceData(dataToPreview);
    setIsPreviewOpen(true);

    setTimeout(() => {
      const mergedSettings: InvoiceSettings = {
        ...settings,
        ...companySettings,
        bank: {
          ...settings.bank,
          ...companySettings.bank,
          accName: companySettings.bank?.accName || settings.bank?.accName || '',
          upi: companySettings.bank?.upi || settings.bank?.upi || ''
        }
      };
      const pageDescs = buildInvoicePages(dataToPreview, mergedSettings);
      const rendered = pageDescs.map((p) => ({
        pageNum: p.pageNum || 1,
        totalPages: p.totalPages || 1,
        html: renderPageHTML(p, dataToPreview, mergedSettings, companySettings)
      }));
      setPreviewPagesHtml(rendered);
    }, 50);
  };

  const handleExportPDF = async () => {
    if (!previewInvoiceData) return;
    setIsPdfExporting(true);
    try {
      const mergedSettings: InvoiceSettings = {
        ...settings,
        ...companySettings,
        bank: {
          ...settings.bank,
          ...companySettings.bank,
          accName: companySettings.bank?.accName || settings.bank?.accName || '',
          upi: companySettings.bank?.upi || settings.bank?.upi || ''
        }
      };
      await exportInvoicePDF(
        previewInvoiceData,
        mergedSettings,
        (msg) => setPdfProgressText(msg),
        companySettings
      );
      showToast('PDF downloaded successfully ✓', 'success');
    } catch (err: any) {
      showToast('PDF generation failed: ' + (err?.message || 'Error'), 'error');
    } finally {
      setIsPdfExporting(false);
      setPdfProgressText('');
    }
  };

  // Inline Payment Status Switch Handlers (Audit Mandate 1: Canonical uppercase statuses)
  const handleStatusChange = async (inv: InvoiceData, newStatus: string) => {
    const canonical = canonicalInvoiceStatus(newStatus);
    if (canonical === 'PARTIALLY_PAID') {
      const currentRec =
        inv.amountReceived !== undefined && inv.amountReceived !== null
          ? String(inv.amountReceived)
          : '';
      setPartialPaymentTarget({
        invoice: inv,
        amount: currentRec
      });
    } else if (canonical === 'PAID') {
      const fullAmount = inv.totals?.payable ?? inv.amountReceived ?? 0;
      try {
        // Pass externalProjects directly into logRevenueForInvoice so it syncs once without a getDocs scan
        await logRevenueForInvoice(inv.id, fullAmount, undefined, externalProjects);
        showToast(`Invoice ${inv.invNo} status updated to PAID ✓ (Linked projects synced)`, 'success');
      } catch (e: any) {
        showToast(e?.message || `Failed to mark invoice ${inv.invNo} as paid.`, 'error');
      }
    } else {
      const updatedAmount = canonical === 'CANCELLED' ? 0 : (inv.amountReceived ?? 0);
      // Pass externalProjects directly into updateInvoiceStatus so it syncs once without a getDocs scan
      updateInvoiceStatus(inv.id, canonical, updatedAmount, externalProjects);
      showToast(`Invoice ${inv.invNo} status updated to ${canonical} ✓ (Linked projects synced)`, 'success');
    }
  };

  const handleConfirmPartialPayment = async () => {
    if (!partialPaymentTarget) return;
    const num = parseFloat(partialPaymentTarget.amount);
    const validAmount = isNaN(num) || num < 0 ? 0 : roundCurrency(num);

    try {
      const result = await logRevenueForInvoice(
        partialPaymentTarget.invoice.id,
        validAmount,
        undefined,
        externalProjects
      );
      showToast(
        `Invoice ${partialPaymentTarget.invoice.invNo} updated to ${result.newStatus} (₹${fmtNum(validAmount, 2)} received) ✓`,
        'success'
      );
      setPartialPaymentTarget(null);
    } catch (e: any) {
      showToast(e?.message || `Failed to log revenue for invoice ${partialPaymentTarget.invoice.invNo}.`, 'error');
    }
  };

  // Line item handlers
  const handleAddLineItem = () => {
    const updatedRows = [...currentInvoice.rows, blankLineItem()];
    setCurrentInvoice({ ...currentInvoice, rows: updatedRows });
    setIsDirty(true);
  };

  const handleRemoveLineItem = (id: string) => {
    const updatedRows = currentInvoice.rows.filter((r) => r.id !== id);
    setCurrentInvoice({ ...currentInvoice, rows: updatedRows });
    setIsDirty(true);
  };

  const handleUpdateLineItem = (id: string, field: keyof InvoiceRow, val: any) => {
    const updatedRows = currentInvoice.rows.map((r) => {
      if (r.id === id) {
        let cleanVal = val;
        if (field === 'kw') {
          cleanVal = isZeroOrPositive(val) ? Number(val) : 0;
        } else if (field === 'charge') {
          cleanVal = isZeroOrPositive(val) ? roundCurrency(Number(val)) : 0;
        }
        return {
          ...r,
          [field]: cleanVal
        };
      }
      return r;
    });
    setCurrentInvoice({ ...currentInvoice, rows: updatedRows });
    setIsDirty(true);
  };

  // Pending Invoice Notices State for Billing Studio
  const [pendingNotices, setPendingNotices] = useState<
    {
      projectId: string;
      projectName: string;
      invNo: string;
      oldAmount: number;
      newAmount: number;
      deltaAmount: number;
      invoiceId: string;
    }[]
  >([]);

  // Instant Project Auto-Mapping Engine with Upgrade Accounting & Subscription Quota
  const autoMapProjectsForClientAndMonth = (
    targetClientId: string | null,
    targetMonth: string,
    baseInvState?: InvoiceData,
    pendingResolutionMode: 'delta' | 'full' = 'delta'
  ) => {
    if (!targetClientId || !targetMonth) {
      return;
    }

    const activeInv = baseInvState || currentInvoice;

    // Retrieve full client object
    const matchedEntry = filteredClientsForMonth.find((c) => c.id === targetClientId);
    const activeClient = matchedEntry?.rawClient || externalClients.find((c) => c.id === targetClientId);

    const matchingProjects = externalProjects.filter((proj) => {
      const pClientId = proj.clientId || proj.matchedClient?.id;
      const pClientName = String(proj.clientName || proj.matchedClient?.companyName || proj.matchedClient?.name || '').trim().toLowerCase();
      const currentTargetName = String(activeInv.client?.name || '').trim().toLowerCase();

      const idMatch = Boolean(targetClientId && pClientId === targetClientId);
      const nameMatch = Boolean(currentTargetName && pClientName && pClientName === currentTargetName);

      if (!idMatch && !nameMatch) {
        return false;
      }

      const projYearMonth = getProjectYearMonth(proj);
      if (projYearMonth === targetMonth) {
        return true;
      }

      // Past month project is mapped ONLY IF it has an explicit unbilled upgrade in targetMonth
      return hasExplicitUpgradeInMonth(proj, targetMonth);
    });

    let detectedPendingNotices: {
      projectId: string;
      projectName: string;
      invNo: string;
      oldAmount: number;
      newAmount: number;
      deltaAmount: number;
      invoiceId: string;
    }[] = [];

    let totalAdvanceCredit = 0;
    let skippedAlreadyBilledCount = 0;
    let processedQuotaProjectsCount = 0;

    if (matchingProjects.length > 0) {
      const mappedRows: InvoiceRow[] = matchingProjects
        .map((p): InvoiceRow | null => {
          const rawCapacity = String(p.plantCapacity || p.systemCapacity || p.capacity || p.kw || '0');
          const kw = parseFloat(rawCapacity.replace(/[^\d.]/g, '')) || 0;

          // Scope resolution
          const rawScope = String(p.scopeOfWork || p.scope || p.workScope || 'Pre-Design').trim();
          let scope: string = 'Pre-Design';
          const foundScope = SCOPE_OPTIONS.find((s) => s.toLowerCase() === rawScope.toLowerCase());
          if (foundScope) {
            scope = foundScope;
          } else if (rawScope.toLowerCase().includes('ceig')) {
            scope = 'CEIG';
          } else if (rawScope.toLowerCase().includes('pvsyst')) {
            scope = 'PVsyst';
          } else if (rawScope.toLowerCase().includes('detail')) {
            scope = 'Detailed Engineering';
          } else if (rawScope.toLowerCase().includes('permit')) {
            scope = 'Permit Package';
          } else {
            scope = 'Standard Design';
          }

          const projName = p.projectName || p.name || p.projectTitle || (p.projectNumber ? `Project ${p.projectNumber}` : 'Solar Engineering Deliverable');

          // Effective-dated tier resolution for client at project date
          const pDate = getProjectDate(p) || new Date();
          const effectiveTier = resolveEffectivePricingCategory(activeClient, pDate);

          // Evaluate project cost
          let evaluatedFullCost = 0;
          if (isZeroOrPositive(p.finalCost)) {
            evaluatedFullCost = Number(p.finalCost);
          } else if (isZeroOrPositive(p.calculatedCost)) {
            evaluatedFullCost = Number(p.calculatedCost);
          } else if (isZeroOrPositive(p.cost)) {
            evaluatedFullCost = Number(p.cost);
          } else if (isZeroOrPositive(p.amount)) {
            evaluatedFullCost = Number(p.amount);
          } else {
            // Dynamic evaluation via pricing slab and effective tier
            const matchedRule = externalPricingRules.find((r) => {
              const ruleCat = String(r.category || r.tier || 'T1').toUpperCase().trim();
              const ruleScope = String(r.scope || r.scopeOfWork || '').toLowerCase().trim();
              return ruleCat === effectiveTier && ruleScope === rawScope.toLowerCase().trim();
            });
            if (matchedRule && Array.isArray(matchedRule.capacityRows) && matchedRule.capacityRows.length > 0) {
              const matchedRow = findMatchingCapacityRow(matchedRule.capacityRows, kw);
              if (matchedRow) {
                evaluatedFullCost = calculateSlabCost(matchedRow, kw);
              }
            } else if (matchedRule && isZeroOrPositive(matchedRule.basePrice || matchedRule.price)) {
              evaluatedFullCost = Number(matchedRule.basePrice || matchedRule.price || 0);
            }
          }

          // Check if client has active Subscription Package
          if (activeClient && activeClient.commercialModel === 'FIXED_PACKAGE' && activeClient.subscriptionPlan) {
            const coverage = evaluateSubscriptionCoverage(activeClient, p, processedQuotaProjectsCount);

            if (coverage.isCoveredScope && coverage.isDateWithinPlan) {
              if (coverage.isQuotaCovered) {
                processedQuotaProjectsCount += 1;
                return {
                  id: uid('row'),
                  desc: `${projName} — Included in Active ${activeClient.subscriptionPlan.scopeCovered || scope} Package (Quota ${coverage.quotaIndex}/${coverage.totalAllowed})`,
                  scope,
                  kw,
                  charge: 0,
                  projectId: p.id
                };
              } else {
                // OVER-QUOTA deliverable billed at client's effective Tier rate
                return {
                  id: uid('row'),
                  desc: `${projName} — Over-Quota Deliverable (Billed at ${effectiveTier} kW rate)`,
                  scope,
                  kw,
                  charge: evaluatedFullCost,
                  projectId: p.id
                };
              }
            } else {
              // OUT-OF-PLAN Scope (CEIG, IFP, PVsyst, SLD, etc.)
              return {
                id: uid('row'),
                desc: `${projName} — Standard ${scope} (Not covered by package)`,
                scope,
                kw,
                charge: evaluatedFullCost,
                projectId: p.id
              };
            }
          }

          // Standard / Upgraded Project Billing Engine:
          // Scan only invoices belonging strictly to this specific client that contain this specific project
          const matchingInvoices = findMatchingInvoicesForProject(p, invoices).filter((inv) => {
            if (inv.id === activeInv.id) return false;
            // Strict client scoping to avoid any invoice cross-contamination
            const invClientId = String(inv.clientId || '').trim().toLowerCase();
            const invClientName = String(inv.client?.name || '').trim().toLowerCase();
            const curClientId = String(targetClientId || '').trim().toLowerCase();
            const curClientName = String(activeClient?.companyName || activeClient?.name || activeInv.client?.name || '').trim().toLowerCase();
            const clientMatches = (invClientId && curClientId && invClientId === curClientId) ||
                                  (invClientName && curClientName && invClientName === curClientName);
            return clientMatches;
          });

          if (matchingInvoices.length > 0) {
            // Prior Invoice is PAID
            const paidInvoices = matchingInvoices.filter((inv) => {
              const st = String(inv.status || '').toUpperCase().trim();
              return st === 'PAID' || st === 'SETTLED' || st === 'FULL';
            });

            if (paidInvoices.length > 0) {
              let previouslyPaidAmount = 0;
              let paidInvNumbers: string[] = [];

              paidInvoices.forEach((pInv) => {
                paidInvNumbers.push(pInv.invNo || 'Prior');
                (pInv.rows || []).forEach((r: any) => {
                  const rProjId = String(r.projectId || '').trim();
                  const rDesc = String(r.desc || '').toLowerCase();
                  if (rProjId === p.id || (p.projectName && rDesc.includes(String(p.projectName).toLowerCase()))) {
                    previouslyPaidAmount += Number(r.charge) || 0;
                  }
                });
              });

              if (previouslyPaidAmount > 0) {
                totalAdvanceCredit += previouslyPaidAmount;

                // Old scope from upgrade history or default
                const prevScopeName = p.upgradeHistory && p.upgradeHistory.length > 0
                  ? p.upgradeHistory[p.upgradeHistory.length - 1].previousScope
                  : 'Previous Scope';

                return {
                  id: uid('row'),
                  desc: `${projName} — Upgraded to ${scope} (Full Package)`,
                  scope,
                  kw,
                  charge: evaluatedFullCost,
                  projectId: p.id
                };
              }
            }

            // Prior Invoice is PENDING / UNPAID
            const pendingInvoices = matchingInvoices.filter((inv) => {
              const st = String(inv.status || '').toUpperCase().trim();
              return st === 'PENDING' || st === 'PARTIALLY_PAID';
            });

            if (pendingInvoices.length > 0) {
              const pInv = pendingInvoices[0];
              let priorBilledAmount = 0;
              (pInv.rows || []).forEach((r: any) => {
                const rProjId = String(r.projectId || '').trim();
                const rDesc = String(r.desc || '').toLowerCase();
                if (rProjId === p.id || (p.projectName && rDesc.includes(String(p.projectName).toLowerCase()))) {
                  priorBilledAmount += Number(r.charge) || 0;
                }
              });

              detectedPendingNotices.push({
                projectId: p.id,
                projectName: projName,
                invNo: pInv.invNo || 'Pending',
                oldAmount: priorBilledAmount,
                newAmount: evaluatedFullCost,
                deltaAmount: Math.max(0, evaluatedFullCost - priorBilledAmount),
                invoiceId: pInv.id
              });

              if (pendingResolutionMode === 'delta') {
                const delta = Math.max(0, evaluatedFullCost - priorBilledAmount);
                return {
                  id: uid('row'),
                  desc: `${projName} (Incremental Upgrade Delta - Prior Inv #${pInv.invNo} ₹${priorBilledAmount.toLocaleString('en-IN')})`,
                  scope,
                  kw,
                  charge: delta,
                  projectId: p.id
                };
              } else {
                // Full amount billing
                return {
                  id: uid('row'),
                  desc: `${projName} (Full Scope Upgrade - Superseding Inv #${pInv.invNo})`,
                  scope,
                  kw,
                  charge: evaluatedFullCost,
                  projectId: p.id
                };
              }
            }
          }

          // Standard First-Time Project Billing
          return {
            id: uid('row'),
            desc: projName,
            scope,
            kw,
            charge: evaluatedFullCost,
            projectId: p.id
          };
        })
        .filter((row): row is InvoiceRow => row !== null);

      setPendingNotices(detectedPendingNotices);

      // Strictly scoped to current client: never inherit advance from another client
      const effectiveAdvance = totalAdvanceCredit > 0 ? totalAdvanceCredit : 0;

      const nextTotals = calculateInvoiceTotals(
        mappedRows,
        activeInv.sgst,
        activeInv.cgst,
        activeInv.igst,
        effectiveAdvance
      );

      setCurrentInvoice((prev) => ({
        ...prev,
        rows: mappedRows,
        advance: effectiveAdvance,
        totals: nextTotals
      }));

      setIsDirty(true);

      if (mappedRows.length === 0 && skippedAlreadyBilledCount > 0) {
        showToast(
          `All ${skippedAlreadyBilledCount} project(s) for ${targetMonth} are already billed.`,
          'info'
        );
      } else if (totalAdvanceCredit > 0) {
        showToast(
          `Auto-mapped ${mappedRows.length} project(s) with ₹${totalAdvanceCredit.toLocaleString('en-IN')} Prior Payment Credit applied ✓`,
          'success'
        );
      } else {
        showToast(`Auto-mapped ${mappedRows.length} project(s) for ${targetMonth} ✓`, 'success');
      }
    } else {
      setPendingNotices([]);
      showToast(`No projects found for selected client in ${targetMonth}`, 'info');
    }
  };
  const handleSelectClient = (clientId: string) => {
    if (!clientId) {
      const emptyRows: InvoiceRow[] = [];
      const nextTotals = calculateInvoiceTotals(
        emptyRows,
        currentInvoice.sgst,
        currentInvoice.cgst,
        currentInvoice.igst,
        currentInvoice.advance
      );
      setCurrentInvoice({
        ...currentInvoice,
        clientId: null,
        client: {
          name: '',
          phone: '',
          gstin: '',
          address: ''
        },
        rows: emptyRows,
        totals: nextTotals
      });
      setIsDirty(true);
      return;
    }

    const matchedEntry = filteredClientsForMonth.find((c) => c.id === clientId);
    const found = matchedEntry?.rawClient || externalClients.find((c) => c.id === clientId);
    if (!found) return;

    const companyName = safeStringIdentifier(found.companyName || found.name);
    const phone = safeStringIdentifier(found.phone || found.contact || found.phoneNumber);
    const gstin = safeStringIdentifier(found.gstin || found.gstNumber || found.gst);

    const formattedAddress =
      typeof found.billingAddress === 'object' && found.billingAddress !== null
        ? Object.values(found.billingAddress).filter(Boolean).map(safeStringIdentifier).join(', ')
        : typeof found.address === 'object' && found.address !== null
          ? Object.values(found.address).filter(Boolean).map(safeStringIdentifier).join(', ')
          : safeStringIdentifier(found.billingAddress || found.address || (found.city ? (found.state ? `${found.city}, ${found.state}` : found.city) : ''));

    const quotNo = found.proposalNumber || found.quotFormat || found.quotationNo || currentInvoice.quotNo || '';

    // Directive 4: Location-Based GST Rule Engine with GSTIN auto-detection
    const hasGSTIN = Boolean(gstin && gstin.trim().length > 0);
    setApplyGST(hasGSTIN);

    const gstRule = determineClientGSTRule({
      name: companyName,
      phone,
      gstin,
      address: formattedAddress,
      state: found.state || found.billingState
    });

    const effectiveCGST = hasGSTIN ? gstRule.cgst : 0;
    const effectiveSGST = hasGSTIN ? gstRule.sgst : 0;
    const effectiveIGST = hasGSTIN ? gstRule.igst : 0;

    // Point 3: Auto-generate fresh ID on client switch if invoice was already saved
    const shouldForkNewId = !currentInvoice._isNew;
    const freshId = shouldForkNewId ? uid('inv') : currentInvoice.id;

    const nextInvoiceState: InvoiceData = {
      ...currentInvoice,
      id: freshId,
      _isNew: shouldForkNewId ? true : currentInvoice._isNew,
      clientId: found.id || clientId,
      client: {
        name: companyName,
        phone: phone,
        gstin: gstin,
        address: formattedAddress
      },
      advance: 0, // Mandatory repair: Immediately reset advance to 0 upon client selection
      quotNo: quotNo || currentInvoice.quotNo,
      cgst: effectiveCGST,
      sgst: effectiveSGST,
      igst: effectiveIGST
    };

    setCurrentInvoice(nextInvoiceState);
    setIsDirty(true);
    showToast(`Selected ${companyName || 'client'} • ${gstRule.ruleLabel}`, 'info');

    if (billingMonth && (found.id || clientId)) {
      autoMapProjectsForClientAndMonth(found.id || clientId, billingMonth, nextInvoiceState);
    }
  };

  // Step 1: Billing Month Handler (Resets selected client and clears project line items)
  const handleBillingMonthChange = (newMonth: string) => {
    setBillingMonth(newMonth);
    const emptyRows: InvoiceRow[] = [];
    const nextTotals = calculateInvoiceTotals(
      emptyRows,
      currentInvoice.sgst,
      currentInvoice.cgst,
      currentInvoice.igst,
      currentInvoice.advance
    );
    // Point 3: Auto-generate fresh ID on month change if invoice was already saved
    const shouldForkMonthId = !currentInvoice._isNew;
    const freshMonthId = shouldForkMonthId ? uid('inv') : currentInvoice.id;

    setCurrentInvoice((prev) => ({
      ...prev,
      id: freshMonthId,
      _isNew: shouldForkMonthId ? true : prev._isNew,
      clientId: null,
      client: {
        name: '',
        phone: '',
        gstin: '',
        address: ''
      },
      rows: emptyRows,
      totals: nextTotals
    }));
    setIsDirty(true);
    showToast(`Billing month set to ${formatMonthDisplay(newMonth)}. Select a client from this month.`, 'info');
  };

  return (
    <div className="w-full space-y-6">
      {/* Toast Notification */}
      {toastMsg && (
        <div
          className={`fixed bottom-6 right-6 z-[9999] flex items-center gap-3 px-5 py-3 rounded-xl border shadow-2xl transition-all ${
            toastType === 'success'
              ? 'bg-white dark:bg-[#1E1E1E] text-emerald-600 dark:text-emerald-400 border-emerald-500/40'
              : toastType === 'error'
              ? 'bg-white dark:bg-[#1E1E1E] text-rose-600 dark:text-rose-400 border-rose-500/40'
              : 'bg-white dark:bg-[#1E1E1E] text-[#D4AF37] border-[#D4AF37]/40'
          }`}
        >
          {toastType === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
          ) : toastType === 'error' ? (
            <AlertCircle className="w-5 h-5 text-rose-500" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-[#D4AF37]" />
          )}
          <span className="text-sm font-medium text-gray-900 dark:text-white">{toastMsg}</span>
        </div>
      )}

      {/* Confirmation Dialog */}
      {confirmDialog.open && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] rounded-xl p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">{confirmDialog.title}</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">{confirmDialog.message}</p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmDialog({ ...confirmDialog, open: false })}
                className="px-4 py-2 rounded-lg text-sm text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-[#333333] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  confirmDialog.onConfirm();
                  setConfirmDialog({ ...confirmDialog, open: false });
                }}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-rose-600 hover:bg-rose-500 text-white shadow-lg transition-colors"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Partial Payment Amount Received Modal */}
      {partialPaymentTarget && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-5">
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-500">
                  <CreditCard className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900 dark:text-white">Record Partial Payment</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    Invoice {partialPaymentTarget.invoice.invNo} • {partialPaymentTarget.invoice.client?.name || 'Client'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setPartialPaymentTarget(null)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-white p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-[#2A2A2A] transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-gray-50 dark:bg-[#121212] border border-gray-200 dark:border-[#333333] rounded-xl p-3.5 space-y-1.5">
              <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
                <span>Total Payable</span>
                <span className="font-mono text-emerald-600 dark:text-emerald-400 font-semibold">
                  {fmtINR(partialPaymentTarget.invoice.totals?.payable ?? 0)}
                </span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
                Enter Amount Received (₹): <span className="text-amber-500">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 font-mono text-sm">
                  ₹
                </span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  placeholder="0.00"
                  value={partialPaymentTarget.amount}
                  onChange={(e) =>
                    setPartialPaymentTarget({ ...partialPaymentTarget, amount: e.target.value })
                  }
                  className="w-full bg-white dark:bg-[#121212] border border-gray-300 dark:border-[#333333] rounded-xl pl-8 pr-4 py-2.5 text-sm text-gray-900 dark:text-white font-mono focus:outline-none focus:border-[#D4AF37]"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setPartialPaymentTarget(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#2A2A2A] border border-gray-300 dark:border-[#333333] transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmPartialPayment}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-[#D4AF37] hover:bg-[#f2c94c] text-black shadow-md transition-all"
              >
                Save Payment Status
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Module Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white dark:bg-[#1E1E1E] p-6 rounded-xl border border-gray-200 dark:border-[#333333] transition-colors shadow-sm">
        <div className="flex items-center space-x-4">
          <div className="w-12 h-12 rounded-xl bg-gray-100 dark:bg-[#2A2A2A] border border-gray-200 dark:border-[#333333] flex items-center justify-center shrink-0 text-[#D4AF37]">
            <Receipt className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white tracking-wide">Invoice &amp; Billing Studio</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Production state management, invoice archive, and pixel-perfect multi-page PDF engine.
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={() => {
              startNewInvoice();
              setActiveBillingTab('invoice');
            }}
            className="flex items-center space-x-2 px-4 py-2 rounded-lg bg-[#D4AF37] hover:bg-[#f2c94c] text-black text-xs font-bold shadow-md shadow-[#D4AF37]/20 transition-colors"
          >
            <Plus className="w-4 h-4 text-black" />
            <span>New Invoice</span>
          </button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] rounded-xl p-1.5 shadow-sm overflow-x-auto transition-colors">
        <nav className="flex space-x-2 min-w-max" aria-label="Billing Tabs">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeBillingTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveBillingTab(tab.id)}
                className={`flex items-center space-x-2.5 px-4 py-2.5 rounded-lg text-xs font-semibold transition-all ${
                  isActive
                    ? 'bg-gray-100 dark:bg-[#2A2A2A] text-[#D4AF37] border border-[#D4AF37]/40 shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#252525]'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-[#D4AF37]' : 'text-gray-400'}`} />
                <span>{tab.label}</span>
                {tab.id === 'invoice' && isDirty && (
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab 1: Dashboard */}
      {activeBillingTab === 'dashboard' && (
        <div className="w-full space-y-6">
          {/* Monthly Invoicing Volume Chart (Recharts with minWidth and minHeight) */}
          <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] rounded-xl p-5 shadow-sm transition-colors">
            <div className="flex items-center justify-between pb-3 border-b border-gray-200 dark:border-[#333333] mb-4">
              <div className="flex items-center space-x-2">
                <Receipt className="w-4 h-4 text-[#D4AF37]" />
                <h3 className="text-sm font-bold text-gray-900 dark:text-white">Monthly Billing Activity</h3>
              </div>
              <span className="text-[11px] text-gray-500 font-mono">Trailing 6 Months Invoicing Trend</span>
            </div>
            <div className="w-full h-64 min-h-[256px] min-w-0 pt-2">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={240}>
                <BarChart data={billingChartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#33333322" vertical={false} />
                  <XAxis dataKey="name" stroke="#888888" tick={{ fontSize: 11 }} />
                  <YAxis
                    stroke="#888888"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(val: number) => {
                      if (val === 0) return '₹0';
                      if (val >= 100000) return `₹${(val / 100000).toFixed(1)}L`;
                      if (val >= 1000) return `₹${(val / 1000).toFixed(0)}k`;
                      return `₹${val}`;
                    }}
                  />
                  <RechartsTooltip
                    formatter={(val: any) => [fmtINR(Number(val) || 0), 'Invoiced']}
                    contentStyle={{ backgroundColor: '#181818', borderColor: '#333333', borderRadius: '8px', fontSize: '12px' }}
                  />
                  <Bar dataKey="billed" fill="#D4AF37" radius={[4, 4, 0, 0]} name="Invoiced Amount" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] rounded-xl p-6 shadow-sm transition-colors">
            <div className="flex items-center justify-between pb-4 border-b border-gray-200 dark:border-[#333333] mb-4">
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">Recent Invoices</h3>
              <button
                onClick={() => setActiveBillingTab('history')}
                className="text-xs font-semibold text-[#D4AF37] hover:underline"
              >
                View All History →
              </button>
            </div>

            {!invoices.length ? (
              <div className="text-center py-12 text-gray-500 border border-dashed border-gray-200 dark:border-[#333333] rounded-lg">
                <FileText className="w-10 h-10 mx-auto mb-2 text-[#D4AF37]" />
                <p className="text-sm text-gray-600 dark:text-gray-400">No invoices created yet.</p>
                <p className="text-xs text-gray-400 mt-1">Click &quot;New Invoice&quot; to get started.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left whitespace-nowrap text-xs">
                  <thead>
                    <tr className="text-gray-500 dark:text-gray-400 uppercase text-[11px] border-b border-gray-200 dark:border-[#333333]">
                      <th className="pb-3 px-4 font-semibold">Invoice No.</th>
                      <th className="pb-3 px-4 font-semibold">Client</th>
                      <th className="pb-3 px-4 font-semibold">Date</th>
                      <th className="pb-3 px-4 font-semibold text-right">Payable</th>
                      <th className="pb-3 px-4 font-semibold text-center">Status</th>
                      <th className="pb-3 px-4 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-[#333333]">
                    {invoices.slice(0, 8).map((inv) => (
                      <tr key={inv.id} className="hover:bg-gray-50 dark:hover:bg-[#2A2A2A] transition-colors">
                        <td className="py-3.5 px-4 font-semibold text-[#D4AF37]">{inv.invNo}</td>
                        <td className="py-3.5 px-4 text-gray-800 dark:text-gray-200">{inv.client?.name || '—'}</td>
                        <td className="py-3.5 px-4 text-gray-500 dark:text-gray-400">{fmtDateDisplay(inv.invDate)}</td>
                        <td className="py-3.5 px-4 text-right font-mono text-emerald-600 dark:text-emerald-400 font-semibold">
                          {fmtINR(inv.totals?.payable ?? 0)}
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          <div className="relative inline-block">
                            <select
                              value={canonicalInvoiceStatus(inv.status)}
                              onChange={(e) => handleStatusChange(inv, e.target.value)}
                              className="text-xs font-semibold px-2.5 py-1 rounded-lg border bg-gray-50 dark:bg-[#1A1A1A] border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-200 cursor-pointer focus:outline-none focus:border-[#D4AF37]"
                            >
                              <option value="PENDING" className="bg-white dark:bg-[#1E1E1E] text-gray-900 dark:text-white">PENDING</option>
                              <option value="PARTIALLY_PAID" className="bg-white dark:bg-[#1E1E1E] text-gray-900 dark:text-white">PARTIALLY PAID</option>
                              <option value="PAID" className="bg-white dark:bg-[#1E1E1E] text-gray-900 dark:text-white">PAID</option>
                              <option value="CANCELLED" className="bg-white dark:bg-[#1E1E1E] text-gray-900 dark:text-white">CANCELLED</option>
                            </select>
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <button
                            onClick={() => {
                              const loaded = loadInvoice(inv.id);
                              if (loaded) {
                                const hasTax = Boolean(loaded.cgst > 0 || loaded.sgst > 0 || loaded.igst > 0 || (loaded.totals && loaded.totals.totalGST > 0));
                                setApplyGST(hasTax);
                              }
                              setActiveBillingTab('invoice');
                            }}
                            className="px-3 py-1.5 text-xs rounded-lg bg-gray-100 dark:bg-[#2A2A2A] hover:bg-gray-200 dark:hover:bg-[#333333] text-[#D4AF37] border border-gray-300 dark:border-[#333333] font-medium"
                          >
                            Open
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: Invoice Editor */}
      {activeBillingTab === 'invoice' && (
        <div className="w-full space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white dark:bg-[#1E1E1E] p-4 rounded-xl border border-gray-200 dark:border-[#333333] transition-colors shadow-sm">
            <div>
              <div className="flex items-center gap-3">
                <h3 className="text-base font-bold text-gray-900 dark:text-white">
                  {currentInvoice._isNew ? 'New Invoice Draft' : `Editing ${currentInvoice.invNo}`}
                </h3>
                {isDirty && (
                  <span className="text-[11px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-400/10 px-2 py-0.5 rounded-full border border-amber-300 dark:border-amber-400/30">
                    Unsaved
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => {
                  startNewInvoice();
                  showToast('Started fresh draft');
                }}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-100 dark:bg-[#2A2A2A] text-gray-800 dark:text-gray-200 border border-gray-300 dark:border-[#444444]"
              >
                + New
              </button>
              <button
                onClick={async () => {
                  const saved = saveCurrentDraft(currentInvoice);
                  await syncInvoiceProjectsToFirestore(saved, saved.status, externalProjects);
                  showToast(`Draft ${currentInvoice.invNo} saved ✓`, 'success');
                }}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-lg bg-gray-100 dark:bg-[#2A2A2A] text-[#D4AF37] border border-gray-300 dark:border-[#D4AF37]/50"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Save Draft</span>
              </button>
              <button
                onClick={() => handleOpenPreview()}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold rounded-lg bg-[#D4AF37] hover:bg-[#f2c94c] text-black shadow-sm"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>Preview &amp; PDF</span>
              </button>
            </div>
          </div>

          {/* Invoice Document Meta Quick-Bar */}
          <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] rounded-xl p-4 shadow-sm transition-colors">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="block text-gray-600 dark:text-gray-400 font-semibold mb-1">Invoice Number *</label>
                <input
                  type="text"
                  value={currentInvoice.invNo}
                  onChange={(e) => {
                    setCurrentInvoice({ ...currentInvoice, invNo: e.target.value });
                    setIsDirty(true);
                  }}
                  className="w-full bg-gray-50 dark:bg-[#181818] border border-gray-300 dark:border-[#333333] rounded-lg px-3 py-2 text-gray-900 dark:text-white font-mono focus:border-[#D4AF37]"
                />
              </div>
              <div>
                <label className="block text-gray-600 dark:text-gray-400 font-semibold mb-1">Invoice Date *</label>
                <input
                  type="date"
                  value={currentInvoice.invDate}
                  onChange={(e) => {
                    setCurrentInvoice({ ...currentInvoice, invDate: e.target.value });
                    setIsDirty(true);
                  }}
                  className="w-full bg-gray-50 dark:bg-[#181818] border border-gray-300 dark:border-[#333333] rounded-lg px-3 py-2 text-gray-900 dark:text-white focus:border-[#D4AF37]"
                />
              </div>
              <div>
                <label className="block text-gray-600 dark:text-gray-400 font-semibold mb-1">Payment Status</label>
                <select
                  value={canonicalInvoiceStatus(currentInvoice.status)}
                  onChange={(e) => {
                    setCurrentInvoice({ ...currentInvoice, status: canonicalInvoiceStatus(e.target.value) });
                    setIsDirty(true);
                  }}
                  className="w-full bg-gray-50 dark:bg-[#181818] border border-gray-300 dark:border-[#333333] rounded-lg px-3 py-2 text-gray-900 dark:text-white focus:border-[#D4AF37]"
                >
                  <option value="PENDING" className="bg-white dark:bg-[#1E1E1E] text-gray-900 dark:text-white">PENDING</option>
                  <option value="PARTIALLY_PAID" className="bg-white dark:bg-[#1E1E1E] text-gray-900 dark:text-white">PARTIALLY PAID</option>
                  <option value="PAID" className="bg-white dark:bg-[#1E1E1E] text-gray-900 dark:text-white">PAID</option>
                  <option value="CANCELLED" className="bg-white dark:bg-[#1E1E1E] text-gray-900 dark:text-white">CANCELLED</option>
                </select>
              </div>
            </div>
          </div>

          {/* Sequential 4-Step Form Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">

              {/* STEP 1: SELECT BILLING MONTH & YEAR */}
              <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] rounded-xl p-5 shadow-sm transition-colors">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-3 border-b border-gray-200 dark:border-[#2A2A2A] mb-4">
                  <div className="flex items-center space-x-2.5">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#D4AF37]/20 text-[#D4AF37] border border-[#D4AF37]/40 uppercase tracking-wider">
                      STEP 1
                    </span>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-gray-900 dark:text-white flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-[#D4AF37]" />
                      <span>Select Billing Month &amp; Year</span>
                    </h4>
                  </div>
                  <div className="text-[11px] text-gray-500 font-mono">
                    Active: <span className="text-[#D4AF37] font-semibold">{formatMonthDisplay(billingMonth)}</span>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="relative sm:w-64">
                      <input
                        type="month"
                        value={billingMonth}
                        onChange={(e) => handleBillingMonthChange(e.target.value)}
                        className="w-full bg-gray-50 dark:bg-[#181818] border border-gray-300 dark:border-[#333333] text-gray-900 dark:text-white text-xs font-medium rounded-lg px-3 py-2.5 focus:border-[#D4AF37] focus:ring-1 focus:ring-[#D4AF37]"
                      />
                    </div>

                    <div className="flex-1 text-[11px] text-gray-500 dark:text-gray-400">
                      <span className="font-semibold text-gray-700 dark:text-gray-300">
                        {projectsInSelectedMonth.length} project(s) recorded in {formatMonthDisplay(billingMonth)}
                      </span>{' '}
                      across <span className="font-semibold text-[#D4AF37]">{filteredClientsForMonth.length} client(s)</span>.
                    </div>
                  </div>

                  {/* Quick Month Chips */}
                  {availableProjectMonths.length > 0 && (
                    <div className="pt-2 border-t border-gray-100 dark:border-[#2A2A2A]">
                      <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                        Quick Select Months with Projects:
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {availableProjectMonths.slice(0, 6).map((item) => (
                          <button
                            key={item.ym}
                            type="button"
                            onClick={() => handleBillingMonthChange(item.ym)}
                            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                              billingMonth === item.ym
                                ? 'bg-[#D4AF37] text-black font-bold shadow-xs'
                                : 'bg-gray-100 dark:bg-[#252525] text-gray-600 dark:text-gray-300 hover:text-black dark:hover:text-white border border-gray-200 dark:border-[#333333]'
                            }`}
                          >
                            {item.label} <span className="opacity-70 font-mono text-[10px]">({item.count})</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <p className="text-[11px] text-amber-600/90 dark:text-amber-400/90 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2 flex items-center gap-2">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 text-amber-500" />
                    <span>
                      Changing this month resets the selected client and clears the line-items table to prevent cross-month billing errors.
                    </span>
                  </p>
                </div>
              </div>

              {/* STEP 2: SELECT CLIENT (STRICTLY FILTERED) */}
              <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] rounded-xl p-5 shadow-sm transition-colors">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-3 border-b border-gray-200 dark:border-[#2A2A2A] mb-4">
                  <div className="flex items-center space-x-2.5">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#D4AF37]/20 text-[#D4AF37] border border-[#D4AF37]/40 uppercase tracking-wider">
                      STEP 2
                    </span>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-gray-900 dark:text-white flex items-center gap-1.5">
                      <Building2 className="w-3.5 h-3.5 text-[#D4AF37]" />
                      <span>Select Client (Strictly Filtered)</span>
                    </h4>
                  </div>
                  <span className="text-[11px] text-gray-500 font-mono">
                    {filteredClientsForMonth.length} client(s) with projects in {formatMonthDisplay(billingMonth)}
                  </span>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-gray-700 dark:text-gray-300 text-xs font-semibold mb-1.5">
                      Select Saved Client with Projects in {formatMonthDisplay(billingMonth)} *
                    </label>
                    <select
                      value={currentInvoice.clientId || ''}
                      onChange={(e) => handleSelectClient(e.target.value)}
                      className="w-full bg-gray-50 dark:bg-[#181818] border border-gray-300 dark:border-[#333333] text-xs font-medium text-gray-900 dark:text-white rounded-lg px-3 py-2.5 focus:border-[#D4AF37] focus:ring-1 focus:ring-[#D4AF37] cursor-pointer"
                    >
                      <option value="" className="bg-white dark:bg-[#1E1E1E] text-gray-900 dark:text-white">
                        {filteredClientsForMonth.length > 0
                          ? `— Select Saved Client (${filteredClientsForMonth.length} Available) —`
                          : `No clients with projects in ${formatMonthDisplay(billingMonth)}`}
                      </option>
                      {filteredClientsForMonth.map((c) => (
                        <option key={c.id} value={c.id} className="bg-white dark:bg-[#1E1E1E] text-gray-900 dark:text-white">
                          {c.name} ({c.projectCountInMonth} {c.projectCountInMonth === 1 ? 'Project' : 'Projects'})
                        </option>
                      ))}
                    </select>
                  </div>

                  {filteredClientsForMonth.length === 0 && (
                    <div className="p-3 rounded-lg bg-gray-50 dark:bg-[#141414] border border-dashed border-gray-300 dark:border-[#333333] text-xs text-gray-500 text-center">
                      No engineering projects found for {formatMonthDisplay(billingMonth)}. Please choose another month in Step 1.
                    </div>
                  )}

                  {/* Client Details Form Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs pt-2 border-t border-gray-100 dark:border-[#2A2A2A]">
                    <div>
                      <label className="block text-gray-600 dark:text-gray-400 font-semibold mb-1">Client Name *</label>
                      <input
                        type="text"
                        value={currentInvoice.client?.name || ''}
                        onChange={(e) => {
                          setCurrentInvoice({ ...currentInvoice, client: { ...currentInvoice.client, name: e.target.value } });
                          setIsDirty(true);
                        }}
                        placeholder="e.g. Tirupati Sunmart & Co."
                        className="w-full bg-gray-50 dark:bg-[#181818] border border-gray-300 dark:border-[#333333] rounded-lg px-3 py-2 text-gray-900 dark:text-white focus:border-[#D4AF37]"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-600 dark:text-gray-400 font-semibold mb-1">GSTIN</label>
                      <input
                        type="text"
                        value={currentInvoice.client?.gstin || ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          const gstRule = determineClientGSTRule({
                            ...currentInvoice.client,
                            gstin: val
                          });
                          setCurrentInvoice({
                            ...currentInvoice,
                            client: { ...currentInvoice.client, gstin: val },
                            cgst: gstRule.cgst,
                            sgst: gstRule.sgst,
                            igst: gstRule.igst
                          });
                          setIsDirty(true);
                        }}
                        placeholder="e.g. 24AAAAA0000A1Z5"
                        className="w-full bg-gray-50 dark:bg-[#181818] border border-gray-300 dark:border-[#333333] rounded-lg px-3 py-2 text-gray-900 dark:text-white font-mono focus:border-[#D4AF37]"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-600 dark:text-gray-400 font-semibold mb-1">Contact Phone</label>
                      <input
                        type="text"
                        value={currentInvoice.client?.phone || ''}
                        onChange={(e) => {
                          setCurrentInvoice({ ...currentInvoice, client: { ...currentInvoice.client, phone: e.target.value } });
                          setIsDirty(true);
                        }}
                        placeholder="e.g. +91 98765 43210"
                        className="w-full bg-gray-50 dark:bg-[#181818] border border-gray-300 dark:border-[#333333] rounded-lg px-3 py-2 text-gray-900 dark:text-white focus:border-[#D4AF37]"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-600 dark:text-gray-400 font-semibold mb-1">Quotation / Proposal Ref</label>
                      <input
                        type="text"
                        value={currentInvoice.quotNo || ''}
                        onChange={(e) => {
                          setCurrentInvoice({ ...currentInvoice, quotNo: e.target.value });
                          setIsDirty(true);
                        }}
                        placeholder="e.g. Q-2026-09-001"
                        className="w-full bg-gray-50 dark:bg-[#181818] border border-gray-300 dark:border-[#333333] rounded-lg px-3 py-2 text-gray-900 dark:text-white font-mono focus:border-[#D4AF37]"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-gray-600 dark:text-gray-400 font-semibold mb-1">Billing Address</label>
                      <input
                        type="text"
                        value={currentInvoice.client?.address || ''}
                        onChange={(e) => {
                          setCurrentInvoice({ ...currentInvoice, client: { ...currentInvoice.client, address: e.target.value } });
                          setIsDirty(true);
                        }}
                        placeholder="e.g. Surat, Gujarat"
                        className="w-full bg-gray-50 dark:bg-[#181818] border border-gray-300 dark:border-[#333333] rounded-lg px-3 py-2 text-gray-900 dark:text-white focus:border-[#D4AF37]"
                      />
                    </div>
                  </div>

                  {/* Subscription Package Action & Plan Indicator */}
                  {selectedClientObject && selectedClientObject.commercialModel === 'FIXED_PACKAGE' && selectedClientObject.subscriptionPlan && (
                    <div className="p-3 rounded-xl border border-[#D4AF37]/40 bg-[#D4AF37]/5 dark:bg-[#D4AF37]/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#D4AF37] text-black uppercase tracking-wider">
                            Active Package
                          </span>
                          <span className="text-xs font-bold text-gray-900 dark:text-white">
                            {selectedClientObject.subscriptionPlan.planName || `${selectedClientObject.subscriptionPlan.scopeCovered} Retainer`}
                          </span>
                        </div>
                        <p className="text-[11px] text-gray-600 dark:text-gray-300 mt-1">
                          Quota: <strong className="text-[#D4AF37]">{selectedClientObject.subscriptionPlan.totalAllowedProjects} Projects</strong> ({selectedClientObject.subscriptionPlan.scopeCovered}) • Retainer: <strong className="text-gray-900 dark:text-white">₹{Number(selectedClientObject.subscriptionPlan.upfrontPrice || 0).toLocaleString('en-IN')}</strong>
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={handleGenerateSubscriptionRetainerInvoice}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[#D4AF37] hover:bg-[#c49f2e] text-black shadow-xs flex items-center gap-1.5 cursor-pointer transition-colors"
                          title="Generate initial package retainer invoice"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>Initial Retainer</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleGeneratePackageRenewalInvoice}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-gray-900 hover:bg-black text-white dark:bg-white dark:hover:bg-gray-200 dark:text-black shadow-xs flex items-center gap-1.5 cursor-pointer transition-colors border border-gray-700 dark:border-gray-300"
                          title="Generate package renewal invoice attributing permanent sales rep"
                        >
                          <Sparkles className="w-3.5 h-3.5 text-[#D4AF37]" />
                          <span>Generate Renewal</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Active GST Rule Badge */}
                  {currentInvoice.client?.name && (
                    <div className={`p-2.5 rounded-lg border text-xs flex items-center justify-between ${
                      activeGSTRule.isGujarat
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                        : 'bg-blue-500/10 border-blue-500/30 text-blue-600 dark:text-blue-400'
                    }`}>
                      <div className="flex items-center space-x-2">
                        <MapPin className="w-3.5 h-3.5" />
                        <span className="font-semibold">{activeGSTRule.ruleLabel}</span>
                      </div>
                      <span className="font-mono text-[11px] font-bold">
                        {activeGSTRule.isGujarat ? 'CGST 9% + SGST 9%' : 'IGST 18%'}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Notice Banner: Pending Invoice Adjustments */}
              {pendingNotices.length > 0 && (
                <div className="bg-amber-500/10 border-2 border-amber-500/40 rounded-xl p-4 space-y-3">
                  <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-bold text-xs uppercase tracking-wider">
                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                    <span>Pending Invoice Reconciliation Notices</span>
                  </div>
                  {pendingNotices.map((notice) => (
                    <div key={notice.projectId} className="p-3 bg-white/70 dark:bg-[#1A1812] rounded-lg border border-amber-400/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                      <div>
                        <div className="font-semibold text-gray-900 dark:text-white">
                          ⚠️ Notice: &quot;{notice.projectName}&quot; previously invoiced on Pending Invoice #{notice.invNo} for ₹{notice.oldAmount.toLocaleString('en-IN')}.
                        </div>
                        <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                          New Scope Total: <strong className="text-gray-900 dark:text-white">₹{notice.newAmount.toLocaleString('en-IN')}</strong> • Incremental Delta: <strong className="text-amber-600 dark:text-amber-400">₹{notice.deltaAmount.toLocaleString('en-IN')}</strong>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={handleResolvePendingAsDelta}
                          className="px-2.5 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-800 dark:text-amber-300 border border-amber-500/40 font-medium text-[11px] transition-colors cursor-pointer"
                        >
                          Bill Delta Only (₹{notice.deltaAmount.toLocaleString('en-IN')})
                        </button>
                        <button
                          type="button"
                          onClick={() => handleResolvePendingAsSupersede(notice.invoiceId, notice.invNo)}
                          className="px-2.5 py-1 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-800 dark:text-rose-300 border border-rose-500/40 font-medium text-[11px] transition-colors cursor-pointer"
                        >
                          Supersede Old &amp; Bill Full
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* STEP 3: AUTO-POPULATE LINE ITEMS */}
              <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] rounded-xl p-5 shadow-sm transition-colors">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-3 border-b border-gray-200 dark:border-[#2A2A2A] mb-4">
                  <div className="flex items-center space-x-2.5">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#D4AF37]/20 text-[#D4AF37] border border-[#D4AF37]/40 uppercase tracking-wider">
                      STEP 3
                    </span>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-gray-900 dark:text-white flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-[#D4AF37]" />
                      <span>Project Line Items ({currentInvoice.rows.length})</span>
                    </h4>
                  </div>
                  <div className="text-[11px] text-gray-500 font-mono">
                    Auto-populated from {currentInvoice.client?.name || 'Selected Client'} ({formatMonthDisplay(billingMonth)})
                  </div>
                </div>

                {!currentInvoice.clientId && currentInvoice.rows.length === 0 ? (
                  <div className="text-center py-8 text-gray-400 text-xs border border-dashed border-gray-300 dark:border-[#333333] rounded-lg">
                    Select a client in Step 2 to automatically populate line items from {formatMonthDisplay(billingMonth)} projects.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs whitespace-nowrap">
                      <thead>
                        <tr className="text-gray-500 dark:text-gray-400 uppercase text-[10px] border-b border-gray-200 dark:border-[#2A2A2A]">
                          <th className="py-2 px-2 w-8">#</th>
                          <th className="py-2 px-2">Project Description</th>
                          <th className="py-2 px-2">Engineering Scope</th>
                          <th className="py-2 px-2 text-right">kW</th>
                          <th className="py-2 px-2 text-right">Charges (₹)</th>
                          <th className="py-2 px-2 text-center w-8"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-[#2A2A2A]">
                        {currentInvoice.rows.map((row, idx) => (
                          <tr key={row.id}>
                            <td className="py-2 px-2 text-gray-400">{idx + 1}</td>
                            <td className="py-2 px-2">
                              <input
                                type="text"
                                value={row.desc}
                                onChange={(e) => handleUpdateLineItem(row.id, 'desc', e.target.value)}
                                className="w-full bg-gray-50 dark:bg-[#181818] border border-gray-300 dark:border-[#333333] rounded px-2 py-1 text-gray-900 dark:text-white"
                              />
                            </td>
                            <td className="py-2 px-2">
                              <select
                                value={row.scope}
                                onChange={(e) => handleUpdateLineItem(row.id, 'scope', e.target.value)}
                                className="w-full bg-gray-50 dark:bg-[#181818] border border-gray-300 dark:border-[#333333] rounded px-2 py-1 text-gray-900 dark:text-white"
                              >
                                {SCOPE_OPTIONS.map((sc) => (
                                  <option key={sc} value={sc} className="bg-white dark:bg-[#1E1E1E] text-gray-900 dark:text-white">
                                    {sc}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="py-2 px-2 text-right">
                              <input
                                type="number"
                                value={row.kw !== undefined && row.kw !== null ? row.kw : ''}
                                onChange={(e) => handleUpdateLineItem(row.id, 'kw', e.target.value)}
                                className="w-20 bg-gray-50 dark:bg-[#181818] border border-gray-300 dark:border-[#333333] rounded px-2 py-1 text-right text-gray-900 dark:text-white font-mono"
                              />
                            </td>
                            <td className="py-2 px-2 text-right">
                              <input
                                type="number"
                                value={row.charge !== undefined && row.charge !== null ? row.charge : 0}
                                onChange={(e) => handleUpdateLineItem(row.id, 'charge', e.target.value)}
                                className="w-24 bg-gray-50 dark:bg-[#181818] border border-gray-300 dark:border-[#333333] rounded px-2 py-1 text-right text-gray-900 dark:text-white font-mono font-semibold"
                              />
                            </td>
                            <td className="py-2 px-2 text-center">
                              <button
                                onClick={() => handleRemoveLineItem(row.id)}
                                className="text-gray-400 hover:text-rose-500 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <button
                  onClick={handleAddLineItem}
                  className="w-full mt-3 py-2 border border-dashed border-[#D4AF37]/50 rounded-lg text-xs font-semibold text-[#D4AF37] hover:bg-[#D4AF37]/10 flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Line Item</span>
                </button>
              </div>
            </div>

            {/* STEP 4: TAX CALCULATION & SUMMARY (Right Column) */}
            <div className="space-y-6">
              <div className="bg-white dark:bg-[#121212] border border-gray-200 dark:border-[#333333] rounded-xl p-5 shadow-sm transition-colors">
                <div className="flex items-center space-x-2.5 pb-2 border-b border-gray-200 dark:border-[#2A2A2A] mb-3">
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#D4AF37]/20 text-[#D4AF37] border border-[#D4AF37]/40 uppercase tracking-wider">
                    STEP 4
                  </span>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#D4AF37]">
                    Tax Calculation &amp; Summary
                  </h4>
                </div>

                {/* Apply GST Checkbox / Toggle */}
                <div className="p-3 bg-gray-50 dark:bg-[#151515] border border-gray-200 dark:border-[#333333] rounded-lg mb-3">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={applyGST}
                      onChange={(e) => handleToggleGST(e.target.checked)}
                      className="w-4 h-4 rounded text-[#D4AF37] focus:ring-[#D4AF37] border-gray-300 dark:border-gray-600 bg-white dark:bg-[#1E1E1E] cursor-pointer"
                    />
                    <span className="text-xs font-bold text-gray-900 dark:text-white">
                      Apply GST to this Invoice (Tax Invoice)
                    </span>
                  </label>
                  <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1 pl-6">
                    {applyGST
                      ? 'GST enabled. Rates calculated dynamically from client state code.'
                      : 'Non-GST Bill. CGST/SGST/IGST forced to 0% and Total GST = ₹0.00.'}
                  </p>
                </div>

                {/* GST Rule Indicator Card (rendered only when GST is applied) */}
                {applyGST ? (
                  <div className={`p-3 rounded-lg border text-xs mb-3 ${
                    activeGSTRule.isGujarat
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                      : 'bg-blue-500/10 border-blue-500/30 text-blue-700 dark:text-blue-300'
                  }`}>
                    <div className="font-semibold">{activeGSTRule.ruleLabel}</div>
                    <div className="text-[11px] opacity-80 mt-0.5">
                      {activeGSTRule.isGujarat
                        ? 'Intra-State: CGST (9%) + SGST (9%) applied'
                        : 'Inter-State: IGST (18%) applied'}
                    </div>
                  </div>
                ) : (
                  <div className="p-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-xs mb-3">
                    <div className="font-semibold">Non-GST Commercial Bill</div>
                    <div className="text-[11px] opacity-80 mt-0.5">
                      No tax applied. Total payable equals Subtotal minus Advance.
                    </div>
                  </div>
                )}

                <div className="space-y-2 text-xs">
                  <div className="flex justify-between py-1">
                    <span className="text-gray-600 dark:text-gray-400">Subtotal</span>
                    <span className="font-mono font-semibold text-gray-900 dark:text-white">{fmtINR(currentTotals.subtotal)}</span>
                  </div>

                  {/* CGST */}
                  {currentTotals.cgst > 0 && (
                    <div className="flex justify-between py-1">
                      <span className="text-gray-600 dark:text-gray-400">CGST ({fmtNum(currentTotals.cgst, 1)}%)</span>
                      <span className="font-mono text-gray-900 dark:text-white">{fmtINR(currentTotals.cgstAmount ?? 0)}</span>
                    </div>
                  )}

                  {/* SGST */}
                  {currentTotals.sgst > 0 && (
                    <div className="flex justify-between py-1">
                      <span className="text-gray-600 dark:text-gray-400">SGST ({fmtNum(currentTotals.sgst, 1)}%)</span>
                      <span className="font-mono text-gray-900 dark:text-white">{fmtINR(currentTotals.sgstAmount ?? 0)}</span>
                    </div>
                  )}

                  {/* IGST */}
                  {currentTotals.igst > 0 && (
                    <div className="flex justify-between py-1">
                      <span className="text-gray-600 dark:text-gray-400">IGST ({fmtNum(currentTotals.igst, 1)}%)</span>
                      <span className="font-mono text-gray-900 dark:text-white">{fmtINR(currentTotals.igstAmount ?? 0)}</span>
                    </div>
                  )}

                  <div className="flex justify-between py-1 text-gray-700 dark:text-gray-300 font-semibold border-t border-dashed border-gray-200 dark:border-[#2A2A2A] pt-1.5">
                    <span>Total GST</span>
                    <span className="font-mono">{fmtINR(currentTotals.totalGST)}</span>
                  </div>

                  <div className="py-2 border-t border-gray-200 dark:border-[#2A2A2A]">
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-gray-600 dark:text-gray-400 font-medium">Advance Paid (₹)</label>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={currentInvoice.advance !== undefined && currentInvoice.advance !== null ? currentInvoice.advance : 0}
                        onChange={(e) => {
                          const val = e.target.value;
                          const num = val === '' ? 0 : parseFloat(val);
                          setCurrentInvoice({
                            ...currentInvoice,
                            advance: isNaN(num) || num < 0 ? 0 : roundCurrency(num)
                          });
                          setIsDirty(true);
                        }}
                        className="w-28 bg-gray-50 dark:bg-[#181818] border border-gray-300 dark:border-[#333333] rounded px-2 py-1 text-right text-gray-900 dark:text-white font-mono"
                      />
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-gray-50 dark:bg-gradient-to-br dark:from-[#1C180E] dark:to-[#14120B] border-2 border-[#D4AF37] mt-3">
                    <div className="text-[10px] font-bold uppercase text-[#D4AF37]">Total Payable</div>
                    <div className="text-xl font-bold font-mono text-gray-900 dark:text-white mt-1">
                      {fmtINR(currentTotals.payable)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: History */}
      {activeBillingTab === 'history' && (
        <div className="w-full space-y-4">
          <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] rounded-xl p-5 shadow-sm transition-colors">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-gray-200 dark:border-[#333333]">
              <div>
                <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                  Archived Invoices ({invoices.length})
                </h3>
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  {(['all', 'PENDING', 'PARTIALLY_PAID', 'PAID', 'CANCELLED'] as const).map((st) => (
                    <button
                      key={st}
                      onClick={() => setStatusFilter(st)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all ${
                        statusFilter === st
                          ? 'bg-[#D4AF37] text-black shadow-sm font-bold'
                          : 'bg-gray-100 dark:bg-[#2A2A2A] text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                      }`}
                    >
                      {st === 'all' ? 'All' : st.replace('_', ' ')}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  placeholder="Search invoice or client..."
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  className="bg-gray-50 dark:bg-[#121212] border border-gray-300 dark:border-[#333333] rounded-lg px-3 py-1.5 text-xs text-gray-900 dark:text-white"
                />
              </div>
            </div>

            <div className="overflow-x-auto mt-4">
              <table className="w-full text-left whitespace-nowrap text-xs">
                <thead>
                  <tr className="text-gray-500 dark:text-gray-400 uppercase text-[11px] border-b border-gray-200 dark:border-[#333333]">
                    <th className="py-3 px-4 font-semibold">Invoice No.</th>
                    <th className="py-3 px-4 font-semibold">Client</th>
                    <th className="py-3 px-4 font-semibold">Date</th>
                    <th className="py-3 px-4 font-semibold text-right">Payable</th>
                    <th className="py-3 px-4 font-semibold text-center">Status</th>
                    <th className="py-3 px-4 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-[#333333]">
                  {(() => {
                    const filtered = invoices.filter((inv) => {
                      const q = historySearch.toLowerCase().trim();
                      const matchSearch = !q || inv.invNo?.toLowerCase().includes(q) || inv.client?.name?.toLowerCase().includes(q);
                      const canonical = canonicalInvoiceStatus(inv.status);
                      const matchStatus = statusFilter === 'all' || canonical === statusFilter;
                      return matchSearch && matchStatus;
                    });

                    if (filtered.length === 0) {
                      return (
                        <tr>
                          <td colSpan={6} className="py-8 text-center text-gray-500 dark:text-gray-400">
                            No invoices match the selected filter.
                          </td>
                        </tr>
                      );
                    }

                    const startIndex = (historyCurrentPage - 1) * HISTORY_PAGE_SIZE;
                    const paginated = filtered.slice(startIndex, startIndex + HISTORY_PAGE_SIZE);

                    return paginated.map((inv) => {
                      const canonical = canonicalInvoiceStatus(inv.status);
                      return (
                        <tr key={inv.id} className="hover:bg-gray-50 dark:hover:bg-[#2A2A2A] transition-colors">
                          <td className="py-3 px-4 font-semibold text-[#D4AF37]">{inv.invNo}</td>
                          <td className="py-3 px-4 text-gray-800 dark:text-gray-200">{inv.client?.name}</td>
                          <td className="py-3 px-4 text-gray-500 dark:text-gray-400">{fmtDateDisplay(inv.invDate)}</td>
                          <td className="py-3 px-4 text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                            {fmtINR(inv.totals?.payable ?? 0)}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <select
                              value={canonical}
                              onChange={(e) => handleStatusChange(inv, e.target.value)}
                              className="text-xs font-semibold px-2.5 py-1 rounded-lg border bg-gray-50 dark:bg-[#1A1A1A] border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-200 cursor-pointer focus:outline-none focus:border-[#D4AF37]"
                            >
                              <option value="PENDING" className="bg-white dark:bg-[#1E1E1E] text-gray-900 dark:text-white">PENDING</option>
                              <option value="PARTIALLY_PAID" className="bg-white dark:bg-[#1E1E1E] text-gray-900 dark:text-white">PARTIALLY PAID</option>
                              <option value="PAID" className="bg-white dark:bg-[#1E1E1E] text-gray-900 dark:text-white">PAID</option>
                              <option value="CANCELLED" className="bg-white dark:bg-[#1E1E1E] text-gray-900 dark:text-white">CANCELLED</option>
                            </select>
                          </td>
                          <td className="py-3 px-4 text-right space-x-2">
                            <button
                              onClick={() => {
                                const loaded = loadInvoice(inv.id);
                                if (loaded) {
                                  const hasTax = Boolean(loaded.cgst > 0 || loaded.sgst > 0 || loaded.igst > 0 || (loaded.totals && loaded.totals.totalGST > 0));
                                  setApplyGST(hasTax);
                                }
                                setActiveBillingTab('invoice');
                              }}
                              className="px-2.5 py-1 text-xs rounded bg-gray-100 dark:bg-[#2A2A2A] text-gray-800 dark:text-gray-200 hover:text-[#D4AF37] cursor-pointer"
                            >
                              Open
                            </button>
                            <button
                              onClick={() => handleOpenPreview(inv)}
                              className="px-2.5 py-1 text-xs rounded bg-gray-100 dark:bg-[#2A2A2A] text-[#D4AF37] cursor-pointer"
                            >
                              PDF
                            </button>
                          </td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            
            {/* Pagination Controls (Strict 10 per page) */}
            {(() => {
              const filtered = invoices.filter((inv) => {
                const q = historySearch.toLowerCase().trim();
                const matchSearch = !q || inv.invNo?.toLowerCase().includes(q) || inv.client?.name?.toLowerCase().includes(q);
                const canonical = canonicalInvoiceStatus(inv.status);
                const matchStatus = statusFilter === 'all' || canonical === statusFilter;
                return matchSearch && matchStatus;
              });
              const totalItems = filtered.length;
              const totalPages = Math.max(1, Math.ceil(totalItems / HISTORY_PAGE_SIZE));
              const startIdx = totalItems === 0 ? 0 : (historyCurrentPage - 1) * HISTORY_PAGE_SIZE + 1;
              const endIdx = Math.min(totalItems, historyCurrentPage * HISTORY_PAGE_SIZE);

              return (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 mt-4 border-t border-gray-200 dark:border-[#333333] text-xs">
                  <div className="text-gray-500 dark:text-gray-400">
                    Showing <span className="font-semibold text-gray-800 dark:text-gray-200 font-mono">{startIdx}</span> to{' '}
                    <span className="font-semibold text-gray-800 dark:text-gray-200 font-mono">{endIdx}</span> of{' '}
                    <span className="font-semibold text-gray-800 dark:text-gray-200 font-mono">{totalItems}</span> archived invoices
                  </div>

                  {totalPages > 1 && (
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setHistoryCurrentPage((prev) => Math.max(1, prev - 1))}
                        disabled={historyCurrentPage === 1}
                        className="px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-[#3A3A3A] bg-gray-50 dark:bg-[#252525] text-gray-700 dark:text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-[#333333] transition-colors flex items-center gap-1 cursor-pointer"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                        <span>Prev</span>
                      </button>

                      {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
                        <button
                          key={pageNum}
                          onClick={() => setHistoryCurrentPage(pageNum)}
                          className={`w-7 h-7 rounded-lg text-xs font-semibold font-mono transition-colors cursor-pointer ${
                            historyCurrentPage === pageNum
                              ? 'bg-[#D4AF37] text-black font-bold shadow-sm'
                              : 'bg-gray-100 dark:bg-[#252525] text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white border border-gray-300 dark:border-[#3A3A3A]'
                          }`}
                        >
                          {pageNum}
                        </button>
                      ))}

                      <button
                        onClick={() => setHistoryCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                        disabled={historyCurrentPage === totalPages}
                        className="px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-[#3A3A3A] bg-gray-50 dark:bg-[#252525] text-gray-700 dark:text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-[#333333] transition-colors flex items-center gap-1 cursor-pointer"
                      >
                        <span>Next</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}</div>
          </div>
        </div>
      )}

      {/* Tab 4: Settings */}
      {activeBillingTab === 'settings' && (
        <div className="w-full space-y-6">
          <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] rounded-xl p-6 shadow-sm transition-colors">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">Billing Configurations</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block text-gray-600 dark:text-gray-400 font-semibold mb-1">Next Invoice Number</label>
                <input
                  type="text"
                  value={settingsForm.nextInvNo}
                  onChange={(e) => setSettingsForm({ ...settingsForm, nextInvNo: e.target.value })}
                  className="w-full bg-gray-50 dark:bg-[#121212] border border-gray-300 dark:border-[#333333] rounded px-3 py-2 text-gray-900 dark:text-white"
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => {
                  saveSettings(settingsForm);
                  showToast('Billing settings saved ✓', 'success');
                }}
                className="px-4 py-2 bg-[#D4AF37] hover:bg-[#f2c94c] text-black font-bold text-xs rounded-lg"
              >
                Save Settings
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {isPreviewOpen && (
        <div className="fixed inset-0 z-[10000] flex flex-col bg-black/70 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#1E1E1E] border-b border-gray-200 dark:border-[#333333] px-6 py-3.5 flex items-center justify-between shadow-xl">
            <h3 className="text-base font-bold text-gray-900 dark:text-white">
              Invoice Preview — {previewInvoiceData?.invNo}
            </h3>
            <div className="flex items-center gap-3">
              <button
                onClick={handleExportPDF}
                disabled={isPdfExporting}
                className="px-4 py-1.5 bg-[#D4AF37] hover:bg-[#f2c94c] text-black font-bold text-xs rounded-lg shadow-sm"
              >
                {isPdfExporting ? 'Exporting...' : 'Download PDF'}
              </button>
              <button
                onClick={() => setIsPreviewOpen(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-auto p-8 bg-gray-200 dark:bg-[#2C2C2C] flex flex-col items-center gap-6">
            {previewPagesHtml.map((p, idx) => (
              <div
                key={idx}
                className="preview-page-scale-wrap bg-white shadow-2xl rounded"
                style={{ width: `${PAGE_W_MM * 0.75}mm`, height: `${PAGE_H_MM * 0.75}mm` }}
              >
                <div
                  className="a4-page"
                  style={{ transform: 'scale(0.75)', transformOrigin: 'top left' }}
                  dangerouslySetInnerHTML={{ __html: p.html }}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
