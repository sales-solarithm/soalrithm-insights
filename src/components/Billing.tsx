'use client';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  LayoutGrid,
  FileEdit,
  FolderKanban,
  Building2,
  History,
  Settings,
  Plus,
  ArrowUpRight,
  TrendingUp,
  DollarSign,
  Receipt,
  FileText,
  Calendar,
  CheckCircle2,
  Clock,
  Download,
  Search,
  Filter,
  CreditCard,
  Building,
  Trash2,
  Copy,
  Save,
  Eye,
  X,
  RotateCcw,
  AlertCircle,
  AlertTriangle,
  ZoomIn,
  ZoomOut,
  ChevronDown
} from 'lucide-react';
import {
  InvoiceData,
  InvoiceSettings,
  InvoiceClient,
  InvoiceRow,
  InvoiceTotals,
  defaultSettings,
  fmtINR,
  fmtNum,
  fmtDateDisplay,
  safeNum,
  todayISO,
  addDaysISO,
  uid,
  calculateInvoiceTotals,
  generateNextInvoiceNumber,
  buildInvoicePages,
  renderPageHTML,
  exportInvoicePDF,
  PAGE_W_MM,
  PAGE_H_MM,
  SCOPE_OPTIONS
} from '@/src/lib/invoicePdfEngine';
import { useBillingState, blankInvoice, blankLineItem } from '@/src/lib/useBillingState';
import { useCompanySettings, CompanySettings } from '@/src/lib/useCompanySettings';

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
  onNavigateToGlobalSettings?: () => void;
}

export default function BillingModule({
  clients: externalClients = [],
  projects: externalProjects = [],
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

  // Partial Payment Modal State (for Inline Status Switch)
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
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'sent' | 'partially paid' | 'paid'>('all');

  // Inline Billing Month state for project autofetch
  const [billingMonth, setBillingMonth] = useState('');

  // Settings local form state
  const [settingsForm, setSettingsForm] = useState<InvoiceSettings>(settings);

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

  // Tabs list (Excel Import and Clients tabs removed)
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

    // Build pages using merged global company settings
    setTimeout(() => {
      const mergedSettings = { ...settings, ...companySettings };
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
      const mergedSettings = { ...settings, ...companySettings };
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

  // Inline Payment Status Switch Handlers
  const handleStatusChange = async (inv: InvoiceData, newStatus: string) => {
    if (newStatus === 'partially paid') {
      const currentRec =
        inv.amountReceived !== undefined && inv.amountReceived > 0
          ? String(inv.amountReceived)
          : '';
      setPartialPaymentTarget({
        invoice: inv,
        amount: currentRec
      });
    } else if (newStatus === 'paid') {
      // Marking an invoice fully paid is a revenue event just like a partial
      // payment -- route it through the same atomic transaction so the
      // income ledger never misses a full, one-shot payment.
      const fullAmount = inv.totals?.payable ?? inv.amountReceived ?? 0;
      try {
        await logRevenueForInvoice(inv.id, fullAmount);
        showToast(`Invoice ${inv.invNo} status updated to Paid ✓`, 'success');
      } catch (e: any) {
        showToast(e?.message || `Failed to mark invoice ${inv.invNo} as paid.`, 'error');
      }
    } else {
      // Non-monetary status changes (draft/sent) don't represent a revenue
      // event, so they stay on the plain status update path.
      const updatedAmount = newStatus === 'draft' ? 0 : inv.amountReceived;
      updateInvoiceStatus(inv.id, newStatus, updatedAmount);
      const label = newStatus === 'sent' ? 'Sent' : 'Draft';
      showToast(`Invoice ${inv.invNo} status updated to ${label} ✓`, 'success');
    }
  };

  const handleConfirmPartialPayment = async () => {
    if (!partialPaymentTarget) return;
    const num = parseFloat(partialPaymentTarget.amount);
    const validAmount = isNaN(num) || num < 0 ? 0 : num;

    try {
      const result = await logRevenueForInvoice(partialPaymentTarget.invoice.id, validAmount);
      const label = result.newStatus === 'paid' ? 'Paid' : 'Partially Paid';
      showToast(
        `Invoice ${partialPaymentTarget.invoice.invNo} updated to ${label} (₹${fmtNum(validAmount, 2)} received) ✓`,
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
        return {
          ...r,
          [field]: field === 'kw' || field === 'charge' ? safeNum(val) : val
        };
      }
      return r;
    });
    setCurrentInvoice({ ...currentInvoice, rows: updatedRows });
    setIsDirty(true);
  };

  // Helper to extract YYYY-MM from a project date safely
  const getProjectYearMonth = (proj: any): string | null => {
    // Priority: projectDate -> date -> createdAt. A project's original
    // createdAt must never outrank a deliberately-set projectDate/date --
    // otherwise retroactively correcting a project's date (e.g. for an
    // older, backdated entry) would silently have no effect on which
    // month's Billing line items it shows up in.
    const rawDate = proj.projectDate || proj.date || proj.createdAt;
    if (!rawDate) return null;

    // Handle Firestore Timestamp object (with seconds or toDate)
    if (typeof rawDate === 'object') {
      if (typeof rawDate.toDate === 'function') {
        const d = rawDate.toDate();
        if (d instanceof Date && !isNaN(d.getTime())) {
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        }
      }
      if (typeof rawDate.seconds === 'number') {
        const d = new Date(rawDate.seconds * 1000);
        if (!isNaN(d.getTime())) {
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        }
      }
    }

    // Handle string or number date
    const str = String(rawDate).trim();
    const match = str.match(/^(\d{4})-(\d{2})/);
    if (match) {
      return `${match[1]}-${match[2]}`;
    }

    const parsed = new Date(str);
    if (!isNaN(parsed.getTime())) {
      return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}`;
    }

    return null;
  };

  // Instant Project Auto-Mapping Engine
  const autoMapProjectsForClientAndMonth = (
    targetClientId: string | null,
    targetMonth: string,
    baseInvState?: InvoiceData
  ) => {
    if (!targetClientId || !targetMonth) {
      return;
    }

    const matchingProjects = externalProjects.filter((proj) => {
      // 1. Strict Client ID match
      if (proj.clientId !== targetClientId) {
        return false;
      }

      // 2. YYYY-MM Date match
      const projYearMonth = getProjectYearMonth(proj);
      return projYearMonth === targetMonth;
    });

    const activeInv = baseInvState || currentInvoice;

    // Anti-double-billing guard: sum what's already been billed for each
    // project across every OTHER invoice in the system (drafts included --
    // a draft is still a bill in progress). A project that's been upgraded
    // since its original bill only gets billed for the cost delta; a
    // project with no cost increase since its last bill is skipped
    // entirely, so a client is never charged twice for the same baseline
    // work.
    const alreadyBilledByProjectId = new Map<string, number>();
    invoices.forEach((inv) => {
      if (inv.id === activeInv.id) return; // don't count the invoice being edited against itself
      (inv.rows || []).forEach((row) => {
        if (row.projectId) {
          alreadyBilledByProjectId.set(
            row.projectId,
            (alreadyBilledByProjectId.get(row.projectId) || 0) + (Number(row.charge) || 0)
          );
        }
      });
    });

    let skippedAlreadyBilledCount = 0;

    if (matchingProjects.length > 0) {
      const mappedRows: InvoiceRow[] = matchingProjects
        .map((p): InvoiceRow | null => {
        // Capacity (kW)
        const rawCapacity = String(p.plantCapacity || p.systemCapacity || p.capacity || p.kw || '0');
        const kw = parseFloat(rawCapacity.replace(/[^\d.]/g, '')) || 0;

        // Final Cost / Charges (₹)
        let charge = 0;
        if (p.finalCost !== undefined && p.finalCost !== null && !isNaN(Number(p.finalCost))) {
          charge = Number(p.finalCost);
        } else if (p.calculatedCost !== undefined && p.calculatedCost !== null && !isNaN(Number(p.calculatedCost))) {
          charge = Number(p.calculatedCost);
        } else if (p.charges !== undefined && p.charges !== null && !isNaN(Number(p.charges))) {
          charge = Number(p.charges);
        } else if (p.cost !== undefined && p.cost !== null && !isNaN(Number(p.cost))) {
          charge = Number(p.cost);
        } else if (p.revenue !== undefined && p.revenue !== null && !isNaN(Number(p.revenue))) {
          charge = Number(p.revenue);
        } else if (p.amount !== undefined && p.amount !== null && !isNaN(Number(p.amount))) {
          charge = Number(p.amount);
        }

        // Scope of Work
        // NOTE: this intentionally reads only the client-facing package
        // classification (scopeOfWork/scope/workScope). `p.assignedScopes`
        // (the internal split-scope designer map from Phase 1) is never
        // read here -- client invoices always collapse to one line item
        // per project, at the parent package level, regardless of how many
        // designers are internally assigned to it.
        const rawScope = String(p.scopeOfWork || p.scope || p.workScope || 'Pre Design').trim();
        let scope = 'Pre Design';
        const foundScope = SCOPE_OPTIONS.find((s) => s.toLowerCase() === rawScope.toLowerCase());
        if (foundScope) {
          scope = foundScope;
        } else if (rawScope.toLowerCase().includes('sld')) {
          scope = 'SLD';
        } else if (rawScope.toLowerCase().includes('detail')) {
          scope = 'Detail Design';
        } else if (rawScope.toLowerCase().includes('pre')) {
          scope = 'Pre Design';
        } else {
          scope = rawScope || 'Other';
        }

        // Project Description
        const desc = p.projectName || p.name || p.projectTitle || (p.projectNumber ? `Project ${p.projectNumber}` : 'Solar Design Project');

        const alreadyBilled = alreadyBilledByProjectId.get(p.id) || 0;

        if (alreadyBilled > 0) {
          const delta = charge - alreadyBilled;
          if (delta <= 0) {
            // Already fully billed elsewhere, and no cost increase since --
            // skip so this project is never billed twice for baseline work.
            skippedAlreadyBilledCount += 1;
            return null;
          }
          // Scope upgrade since the original bill -- charge only the
          // incremental difference, not the full baseline cost again.
          return {
            id: uid('row'),
            desc: `${desc} (Scope Upgrade Adjustment)`,
            scope,
            kw,
            charge: delta,
            projectId: p.id
          };
        }

        return {
          id: uid('row'),
          desc,
          scope,
          kw,
          charge,
          projectId: p.id
        };
        })
        .filter((row): row is InvoiceRow => row !== null);

      const nextTotals = calculateInvoiceTotals(
        mappedRows,
        activeInv.sgst,
        activeInv.cgst,
        activeInv.igst,
        activeInv.advance
      );

      setCurrentInvoice((prev) => ({
        ...prev,
        rows: mappedRows,
        totals: nextTotals
      }));
      setIsDirty(true);
      if (mappedRows.length === 0 && skippedAlreadyBilledCount > 0) {
        showToast(
          `All ${skippedAlreadyBilledCount} matching project(s) for ${targetMonth} are already billed -- nothing new to invoice.`,
          'info'
        );
      } else if (skippedAlreadyBilledCount > 0) {
        showToast(
          `Auto-mapped ${mappedRows.length} project(s) for ${targetMonth} ✓ (${skippedAlreadyBilledCount} already billed, skipped)`,
          'success'
        );
      } else {
        showToast(`Auto-mapped ${mappedRows.length} project(s) for ${targetMonth} ✓`, 'success');
      }
    } else {
      showToast(`No projects found for selected client in ${targetMonth}`, 'info');
    }
  };

  // Client Selection in Editor (Global Client Registry Mapping)
  const handleSelectClient = (clientId: string) => {
    if (!clientId) {
      setCurrentInvoice({
        ...currentInvoice,
        clientId: null
      });
      setIsDirty(true);
      return;
    }
    const found = externalClients.find((c) => c.id === clientId);
    if (!found) return;

    const companyName = found.companyName || found.name || '';
    const phone = found.phone || found.contact || found.phoneNumber || '';
    const gstin = found.gstin || found.gstNumber || found.gst || '';

    // Defensive Serialization: convert structured object address to comma-separated string.
    // billingAddress takes priority over the generic address field, since a
    // client may have a separate site/project address that shouldn't be
    // used for invoicing.
    const formattedAddress =
      typeof found.billingAddress === 'object' && found.billingAddress !== null
        ? Object.values(found.billingAddress).filter(Boolean).join(', ')
        : typeof found.address === 'object' && found.address !== null
          ? Object.values(found.address).filter(Boolean).join(', ')
          : found.billingAddress || found.address || (found.city ? (found.state ? `${found.city}, ${found.state}` : found.city) : '') || '';

    const quotNo = found.proposalNumber || found.quotFormat || found.quotationNo || currentInvoice.quotNo || '';

    const nextInvoiceState: InvoiceData = {
      ...currentInvoice,
      clientId: found.id || null,
      client: {
        name: companyName,
        phone: phone,
        gstin: gstin,
        address: formattedAddress
      },
      quotNo: quotNo || currentInvoice.quotNo
    };

    setCurrentInvoice(nextInvoiceState);
    setIsDirty(true);
    showToast(`Loaded details for ${companyName || 'client'}`, 'info');

    // If a billing month is already selected, immediately auto-map matching projects
    if (billingMonth && found.id) {
      autoMapProjectsForClientAndMonth(found.id, billingMonth, nextInvoiceState);
    }
  };

  // Month change handler with instant project auto-mapping
  const handleBillingMonthChange = (newMonth: string) => {
    setBillingMonth(newMonth);
    if (currentInvoice.clientId && newMonth) {
      autoMapProjectsForClientAndMonth(currentInvoice.clientId, newMonth, currentInvoice);
    }
  };

  return (
    <div className="w-full space-y-6">
      {/* Toast Notification */}
      {toastMsg && (
        <div
          className={`fixed bottom-6 right-6 z-[9999] flex items-center gap-3 px-5 py-3 rounded-xl border shadow-2xl transition-all ${
            toastType === 'success'
              ? 'bg-[#1E1E1E] text-emerald-400 border-emerald-500/40'
              : toastType === 'error'
              ? 'bg-[#1E1E1E] text-rose-400 border-rose-500/40'
              : 'bg-[#1E1E1E] text-[#D4AF37] border-[#D4AF37]/40'
          }`}
        >
          {toastType === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
          ) : toastType === 'error' ? (
            <AlertCircle className="w-5 h-5 text-rose-400" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-[#D4AF37]" />
          )}
          <span className="text-sm font-medium text-white">{toastMsg}</span>
        </div>
      )}

      {/* Confirmation Dialog */}
      {confirmDialog.open && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-[#1E1E1E] border border-[#333333] rounded-xl p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-2">{confirmDialog.title}</h3>
            <p className="text-sm text-gray-400 mb-6">{confirmDialog.message}</p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmDialog({ ...confirmDialog, open: false })}
                className="px-4 py-2 rounded-lg text-sm text-gray-300 hover:text-white hover:bg-[#333333] transition-colors"
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
          <div className="bg-[#1E1E1E] border border-[#333333] rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-5">
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
                  <CreditCard className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Record Partial Payment</h3>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Invoice {partialPaymentTarget.invoice.invNo} • {partialPaymentTarget.invoice.client?.name || 'Client'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setPartialPaymentTarget(null)}
                className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-[#2A2A2A] transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-[#121212] border border-[#333333] rounded-xl p-3.5 space-y-1.5">
              <div className="flex justify-between text-xs text-gray-400">
                <span>Total Payable</span>
                <span className="font-mono text-emerald-400 font-semibold">
                  {fmtINR(partialPaymentTarget.invoice.totals?.payable ?? 0)}
                </span>
              </div>
              {partialPaymentTarget.invoice.totals?.payable ? (
                <div className="flex justify-between text-xs text-gray-400">
                  <span>Balance Remaining</span>
                  <span className="font-mono text-amber-400 font-semibold">
                    {fmtINR(
                      Math.max(
                        0,
                        (partialPaymentTarget.invoice.totals?.payable ?? 0) -
                          (parseFloat(partialPaymentTarget.amount) || 0)
                      )
                    )}
                  </span>
                </div>
              ) : null}
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1.5">
                Enter Amount Received (₹): <span className="text-amber-400">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 font-mono text-sm">
                  ₹
                </span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  autoFocus
                  placeholder="0.00"
                  value={partialPaymentTarget.amount}
                  onChange={(e) =>
                    setPartialPaymentTarget({ ...partialPaymentTarget, amount: e.target.value })
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleConfirmPartialPayment();
                    }
                  }}
                  className="w-full bg-[#121212] border border-[#333333] rounded-xl pl-8 pr-4 py-2.5 text-sm text-white font-mono placeholder:text-gray-600 focus:outline-none focus:border-[#D4AF37] focus:ring-1 focus:ring-[#D4AF37]"
                />
              </div>

              {/* Quick Preset Buttons */}
              {partialPaymentTarget.invoice.totals?.payable ? (
                <div className="flex items-center gap-2 mt-2.5">
                  <span className="text-[11px] text-gray-500 font-medium">Presets:</span>
                  {[0.25, 0.5, 0.75].map((ratio) => {
                    const presetVal = Math.round((partialPaymentTarget.invoice.totals?.payable || 0) * ratio);
                    return (
                      <button
                        key={ratio}
                        type="button"
                        onClick={() =>
                          setPartialPaymentTarget({
                            ...partialPaymentTarget,
                            amount: String(presetVal)
                          })
                        }
                        className="px-2 py-0.5 rounded bg-[#2A2A2A] hover:bg-[#333333] text-[11px] font-mono text-gray-300 border border-[#333333] hover:border-[#D4AF37]/40 transition-colors"
                      >
                        {ratio * 100}% ({fmtINR(presetVal)})
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setPartialPaymentTarget(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-gray-300 hover:text-white hover:bg-[#2A2A2A] border border-[#333333] transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmPartialPayment}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-[#D4AF37] hover:bg-[#f2c94c] text-black shadow-lg shadow-[#D4AF37]/20 transition-all"
              >
                Save Payment &amp; Set Status
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Module Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-[#1E1E1E] p-6 rounded-xl border border-[#333333]">
        <div className="flex items-center space-x-4">
          <div className="w-12 h-12 rounded-xl bg-[#2A2A2A] border border-[#333333] flex items-center justify-center shrink-0 text-[#D4AF37]">
            <Receipt className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-xl font-bold text-white tracking-wide">Invoice & Billing Studio</h2>
            </div>
            <p className="text-sm text-gray-400 mt-0.5">
              Production state management, invoice archive, and pixel-perfect multi-page PDF engine.
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={() => {
              if (isDirty) {
                triggerConfirm(
                  'Discard unsaved changes?',
                  'Starting a new invoice will discard any unsaved modifications in the current draft.',
                  () => {
                    startNewInvoice();
                    setActiveBillingTab('invoice');
                  }
                );
              } else {
                startNewInvoice();
                setActiveBillingTab('invoice');
              }
            }}
            className="flex items-center space-x-2 px-4 py-2 rounded-lg bg-[#D4AF37] hover:bg-[#f2c94c] text-black text-xs font-semibold shadow-lg shadow-[#D4AF37]/20 transition-colors"
          >
            <Plus className="w-4 h-4 text-black" />
            <span>New Invoice</span>
          </button>
        </div>
      </div>

      {/* Horizontal Tabbed Navigation Bar */}
      <div className="bg-[#1E1E1E] border border-[#333333] rounded-xl p-1.5 shadow-lg overflow-x-auto">
        <nav className="flex space-x-2 min-w-max" aria-label="Billing Tabs">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeBillingTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveBillingTab(tab.id)}
                className={`flex items-center space-x-2.5 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-[#2A2A2A] text-[#D4AF37] border border-[#D4AF37]/40 shadow-sm'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-[#252525]'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-[#D4AF37]' : 'text-gray-400'}`} />
                <span>{tab.label}</span>
                {tab.id === 'invoice' && isDirty && (
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" title="Unsaved changes" />
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content Containers */}
      <div className="space-y-6">
        {/* ───────────── 1. TAB: DASHBOARD ───────────── */}
        {activeBillingTab === 'dashboard' && (
          <div className="w-full space-y-6">
            {/* Main Dashboard Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Recent Invoices Table */}
              <div className="lg:col-span-2 bg-[#1E1E1E] border border-[#333333] rounded-xl p-6 shadow-sm">
                <div className="flex items-center justify-between pb-4 border-b border-[#333333] mb-4">
                  <h3 className="text-base font-semibold text-white">Recent Invoices</h3>
                  <button
                    onClick={() => setActiveBillingTab('history')}
                    className="text-xs font-semibold text-[#D4AF37] hover:underline"
                  >
                    View All History →
                  </button>
                </div>

                {!invoices.length ? (
                  <div className="text-center py-12 text-gray-500 border border-dashed border-[#333333] rounded-lg">
                    <FileText className="w-10 h-10 mx-auto mb-2 opacity-40 text-[#D4AF37]" />
                    <p className="text-sm text-gray-400">No invoices created yet.</p>
                    <p className="text-xs text-gray-500 mt-1">Click &quot;New Invoice&quot; to get started.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left whitespace-nowrap">
                      <thead>
                        <tr className="text-gray-400 text-xs uppercase border-b border-[#333333]">
                          <th className="pb-3 px-4 font-semibold">Invoice No.</th>
                          <th className="pb-3 px-4 font-semibold">Client</th>
                          <th className="pb-3 px-4 font-semibold">Date</th>
                          <th className="pb-3 px-4 font-semibold text-right">Payable</th>
                          <th className="pb-3 px-4 font-semibold text-center">Status</th>
                          <th className="pb-3 px-4 font-semibold text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#333333]">
                        {invoices.slice(0, 5).map((inv) => (
                          <tr key={inv.id} className="hover:bg-[#2A2A2A] transition-colors">
                            <td className="py-3.5 px-4 font-semibold text-[#D4AF37]">{inv.invNo}</td>
                            <td className="py-3.5 px-4 text-gray-200">{inv.client?.name || '—'}</td>
                            <td className="py-3.5 px-4 text-gray-400 text-xs">{fmtDateDisplay(inv.invDate)}</td>
                            <td className="py-3.5 px-4 text-right font-mono text-emerald-400 font-semibold">
                              {fmtINR(inv.totals?.payable ?? 0)}
                            </td>
                            <td className="py-3.5 px-4 text-center">
                              <div className="inline-flex flex-col items-center gap-1">
                                <div className="relative inline-block">
                                  <select
                                    value={
                                      inv.status === 'partially_paid' || inv.status === 'partial'
                                        ? 'partially paid'
                                        : inv.status || 'draft'
                                    }
                                    onChange={(e) => handleStatusChange(inv, e.target.value)}
                                    className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg border appearance-none pr-7 cursor-pointer transition-all focus:outline-none focus:ring-1 focus:ring-[#D4AF37] ${
                                      inv.status === 'paid'
                                        ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40 hover:bg-emerald-500/25'
                                        : inv.status === 'partially paid' || inv.status === 'partially_paid' || inv.status === 'partial'
                                        ? 'bg-amber-500/15 text-amber-400 border-amber-500/40 hover:bg-amber-500/25'
                                        : inv.status === 'sent'
                                        ? 'bg-[#D4AF37]/15 text-[#D4AF37] border-[#D4AF37]/40 hover:bg-[#D4AF37]/25'
                                        : 'bg-[#1A1A1A] text-gray-300 border-gray-600/40 hover:bg-[#252525]'
                                    }`}
                                  >
                                    <option value="draft" className="bg-[#1E1E1E] text-gray-300">Draft</option>
                                    <option value="sent" className="bg-[#1E1E1E] text-[#D4AF37]">Sent</option>
                                    <option value="partially paid" className="bg-[#1E1E1E] text-amber-400">Partially Paid</option>
                                    <option value="paid" className="bg-[#1E1E1E] text-emerald-400">Paid</option>
                                  </select>
                                  <ChevronDown className="w-3.5 h-3.5 text-current opacity-70 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                                </div>
                                {(inv.status === 'partially paid' || inv.status === 'partially_paid' || inv.status === 'partial') && inv.amountReceived !== undefined && inv.amountReceived > 0 && (
                                  <span className="text-[10px] font-mono text-amber-400/90 font-medium">
                                    Rec&apos;d: {fmtINR(inv.amountReceived)}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-3.5 px-4 text-right">
                              <button
                                onClick={() => {
                                  loadInvoice(inv.id);
                                  setActiveBillingTab('invoice');
                                }}
                                className="px-3 py-1.5 text-xs rounded-lg bg-[#2A2A2A] hover:bg-[#333333] text-[#D4AF37] border border-[#333333] hover:border-[#D4AF37]/50 font-medium transition-colors"
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

              {/* Quick Actions & Tips */}
              <div className="bg-[#1E1E1E] border border-[#333333] rounded-xl p-6 flex flex-col justify-between">
                <div>
                  <h3 className="text-base font-semibold text-white pb-3 border-b border-[#333333] mb-4">
                    Quick Actions
                  </h3>
                  <div className="grid grid-cols-1 gap-2.5">
                    <button
                      onClick={() => {
                        startNewInvoice();
                        setActiveBillingTab('invoice');
                      }}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#2A2A2A] hover:bg-[#333333] text-gray-200 hover:text-white border border-[#444444] text-xs font-semibold transition-colors"
                    >
                      <Plus className="w-4 h-4 text-[#D4AF37]" />
                      <span>Create New Invoice</span>
                    </button>
                    <button
                      onClick={() => setActiveBillingTab('settings')}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#2A2A2A] hover:bg-[#333333] text-gray-200 hover:text-white border border-[#444444] text-xs font-semibold transition-colors"
                    >
                      <Settings className="w-4 h-4 text-[#D4AF37]" />
                      <span>Configure Settings &amp; Bank</span>
                    </button>
                  </div>
                </div>

                <div className="mt-6 p-4 rounded-xl bg-[#121212] border border-[#333333] text-xs text-gray-400 space-y-1">
                  <p className="font-semibold text-[#D4AF37]">Invoice Management Tip:</p>
                  <p>
                    Configure your default company letterhead, signature, bank account, and GST tax slabs in <strong>Settings</strong> to automatically prefill every new invoice.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ───────────── 2. TAB: INVOICE EDITOR ───────────── */}
        {activeBillingTab === 'invoice' && (
          <div className="w-full space-y-6">
            {/* Editor Action Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-[#1E1E1E] p-4 rounded-xl border border-[#333333]">
              <div>
                <div className="flex items-center gap-3">
                  <h3 className="text-lg font-bold text-white">
                    {currentInvoice._isNew ? 'New Invoice Draft' : `Editing ${currentInvoice.invNo}`}
                  </h3>
                  {isDirty ? (
                    <span className="text-xs text-amber-400 bg-amber-400/10 px-2.5 py-0.5 rounded-full border border-amber-400/30">
                      Unsaved Changes
                    </span>
                  ) : (
                    <span className="text-xs text-emerald-400 bg-emerald-400/10 px-2.5 py-0.5 rounded-full border border-emerald-400/30">
                      Saved
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-0.5">
                  {currentInvoice.client?.name ? `Client: ${currentInvoice.client.name}` : 'Fill in the details below'}
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => {
                    startNewInvoice();
                    showToast('Started fresh invoice draft');
                  }}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#2A2A2A] hover:bg-[#333333] text-gray-200 border border-[#444444] transition-colors"
                >
                  ＋ New
                </button>
                <button
                  onClick={() => {
                    const dup = duplicateInvoice();
                    if (dup) showToast(`Duplicated as ${dup.invNo}`, 'success');
                  }}
                  disabled={!!currentInvoice._isNew}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#2A2A2A] hover:bg-[#333333] text-gray-200 border border-[#444444] transition-colors disabled:opacity-40"
                >
                  ⧉ Duplicate
                </button>
                <button
                  onClick={() => {
                    saveCurrentDraft(currentInvoice);
                    showToast(`Draft ${currentInvoice.invNo} saved ✓`, 'success');
                  }}
                  className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-lg bg-[#2A2A2A] hover:bg-[#333333] text-[#D4AF37] border border-[#D4AF37]/50 shadow-sm transition-colors"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Save Draft</span>
                </button>
                <button
                  onClick={() => handleOpenPreview()}
                  className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-lg bg-[#D4AF37] hover:bg-[#f2c94c] text-black shadow-lg shadow-[#D4AF37]/20 transition-colors"
                >
                  <Eye className="w-3.5 h-3.5 text-black" />
                  <span>Preview &amp; PDF</span>
                </button>
              </div>
            </div>

            {/* Grid Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left Column: Details, Client, Line Items */}
              <div className="lg:col-span-2 space-y-6">
                {/* 1. Invoice Meta Details */}
                <div className="bg-[#121212] border border-[#333333] rounded-xl p-6 shadow-lg">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#D4AF37] pb-3 border-b border-[#2A2A2A] mb-5 flex items-center justify-between">
                    <span>1. Invoice Details</span>
                    <span className="text-[11px] text-gray-500 font-mono font-normal">#{currentInvoice.invNo || 'DRAFT'}</span>
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-1.5">
                        Invoice Number *
                      </label>
                      <input
                        type="text"
                        value={currentInvoice.invNo}
                        onChange={(e) => {
                          setCurrentInvoice({ ...currentInvoice, invNo: e.target.value });
                          setIsDirty(true);
                        }}
                        className="w-full bg-[#181818] border border-[#333333] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-[#D4AF37] focus:border-[#D4AF37] transition-all font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-1.5">
                        Invoice Date *
                      </label>
                      <input
                        type="date"
                        value={currentInvoice.invDate}
                        onChange={(e) => {
                          setCurrentInvoice({ ...currentInvoice, invDate: e.target.value });
                          setIsDirty(true);
                        }}
                        className="w-full bg-[#181818] border border-[#333333] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-[#D4AF37] focus:border-[#D4AF37] transition-all [color-scheme:dark]"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-1.5">
                        Due Date
                      </label>
                      <input
                        type="date"
                        value={currentInvoice.invDue}
                        onChange={(e) => {
                          setCurrentInvoice({ ...currentInvoice, invDue: e.target.value });
                          setIsDirty(true);
                        }}
                        className="w-full bg-[#181818] border border-[#333333] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-[#D4AF37] focus:border-[#D4AF37] transition-all [color-scheme:dark]"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-1.5">
                        Quotation No.
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. SOL-APR-2026"
                        value={currentInvoice.quotNo}
                        onChange={(e) => {
                          setCurrentInvoice({ ...currentInvoice, quotNo: e.target.value });
                          setIsDirty(true);
                        }}
                        className="w-full bg-[#181818] border border-[#333333] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-[#D4AF37] focus:border-[#D4AF37] transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-1.5">
                        Invoice Status
                      </label>
                      <select
                        value={currentInvoice.status}
                        onChange={(e) => {
                          const newStatus = e.target.value;
                          setCurrentInvoice({
                            ...currentInvoice,
                            status: newStatus,
                            amountReceived:
                              newStatus === 'partially paid'
                                ? (currentInvoice.amountReceived !== undefined ? currentInvoice.amountReceived : 0)
                                : currentInvoice.amountReceived
                          });
                          setIsDirty(true);
                        }}
                        className="w-full bg-[#181818] border border-[#333333] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-[#D4AF37] focus:border-[#D4AF37] transition-all"
                      >
                        <option value="draft">Draft</option>
                        <option value="sent">Sent</option>
                        <option value="partially paid">Partially Paid</option>
                        <option value="paid">Paid</option>
                      </select>
                    </div>

                    {/* Conditional Amount Input for Partially Paid */}
                    {(currentInvoice.status === 'partially paid' ||
                      currentInvoice.status === 'partially_paid' ||
                      currentInvoice.status === 'partial') && (
                      <div>
                        <label className="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-1.5">
                          Amount Received (₹) *
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          placeholder="e.g. 5000"
                          value={
                            currentInvoice.amountReceived !== undefined && currentInvoice.amountReceived !== null
                              ? currentInvoice.amountReceived
                              : ''
                          }
                          onChange={(e) => {
                            const val = e.target.value === '' ? 0 : parseFloat(e.target.value);
                            setCurrentInvoice({
                              ...currentInvoice,
                              amountReceived: isNaN(val) ? 0 : val
                            });
                            setIsDirty(true);
                          }}
                          className="w-full bg-[#181818] border border-[#333333] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-[#D4AF37] focus:border-[#D4AF37] font-mono transition-all"
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* 2. Client Details */}
                <div className="bg-[#121212] border border-[#333333] rounded-xl p-6 shadow-lg">
                  <div className="flex items-center justify-between pb-3 border-b border-[#2A2A2A] mb-5">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-[#D4AF37]">
                      2. Client Information
                    </h4>
                    <div className="flex items-center gap-2">
                      <select
                        id="f-client-select"
                        value={currentInvoice.clientId || ''}
                        onChange={(e) => handleSelectClient(e.target.value)}
                        className="bg-[#181818] border border-[#333333] text-xs text-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#D4AF37] focus:border-[#D4AF37] transition-all"
                      >
                        <option value="">— Select Saved Client —</option>
                        {externalClients.map((c) => {
                          const displayName = c.companyName || c.name || 'Unnamed Client';
                          const citySuffix = c.city ? ` (${c.city})` : '';
                          return (
                            <option key={c.id} value={c.id}>
                              {displayName}{citySuffix}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-1.5">
                        Company / Client Name *
                      </label>
                      <input
                        type="text"
                        placeholder="Company name"
                        value={currentInvoice.client?.name || ''}
                        onChange={(e) => {
                          setCurrentInvoice({
                            ...currentInvoice,
                            client: { ...currentInvoice.client, name: e.target.value }
                          });
                          setIsDirty(true);
                        }}
                        className="w-full bg-[#181818] border border-[#333333] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-[#D4AF37] focus:border-[#D4AF37] transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-1.5">
                        Contact Number
                      </label>
                      <input
                        type="text"
                        placeholder="+91 9876543210"
                        value={currentInvoice.client?.phone || ''}
                        onChange={(e) => {
                          setCurrentInvoice({
                            ...currentInvoice,
                            client: { ...currentInvoice.client, phone: e.target.value }
                          });
                          setIsDirty(true);
                        }}
                        className="w-full bg-[#181818] border border-[#333333] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-[#D4AF37] focus:border-[#D4AF37] transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-1.5">
                        Client GSTIN (Optional)
                      </label>
                      <input
                        type="text"
                        placeholder="24AAAAA0000A1Z5"
                        value={currentInvoice.client?.gstin || ''}
                        onChange={(e) => {
                          setCurrentInvoice({
                            ...currentInvoice,
                            client: { ...currentInvoice.client, gstin: e.target.value }
                          });
                          setIsDirty(true);
                        }}
                        className="w-full bg-[#181818] border border-[#333333] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-[#D4AF37] focus:border-[#D4AF37] transition-all font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-1.5">
                        Billing Address
                      </label>
                      <textarea
                        rows={2}
                        placeholder="Street, City, State"
                        value={
                          typeof currentInvoice.client?.address === 'object' && currentInvoice.client?.address !== null
                            ? Object.values(currentInvoice.client.address).filter(Boolean).join(', ')
                            : (currentInvoice.client?.address || '')
                        }
                        onChange={(e) => {
                          setCurrentInvoice({
                            ...currentInvoice,
                            client: { ...currentInvoice.client, address: e.target.value }
                          });
                          setIsDirty(true);
                        }}
                        className="w-full bg-[#181818] border border-[#333333] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-[#D4AF37] focus:border-[#D4AF37] resize-none transition-all"
                      />
                    </div>
                  </div>
                </div>

                {/* 3. Line Items */}
                <div className="bg-[#121212] border border-[#333333] rounded-xl p-6 shadow-lg">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-[#2A2A2A] mb-5">
                    <div className="flex items-center gap-3">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-[#D4AF37]">
                        3. Project Line Items ({currentInvoice.rows.length})
                      </h4>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400 whitespace-nowrap flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5 text-gray-400" />
                          <span>Month:</span>
                        </span>
                        <input
                          type="month"
                          id="f-billing-month-picker"
                          value={billingMonth}
                          onChange={(e) => handleBillingMonthChange(e.target.value)}
                          className="bg-[#181818] border border-[#333333] text-white text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#D4AF37] focus:border-[#D4AF37] [color-scheme:dark]"
                        />
                      </div>
                    </div>
                    <span className="text-xs text-gray-400 font-mono">
                      Subtotal: <strong className="text-white">{fmtINR(currentTotals.subtotal)}</strong>
                    </span>
                  </div>

                  <div className="overflow-x-auto rounded-lg border border-[#2A2A2A]">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-[#181818] text-xs text-gray-400 uppercase tracking-wider border-b border-[#2A2A2A]">
                        <tr>
                          <th className="px-3 py-3 w-12 text-center">Sr.</th>
                          <th className="px-3 py-3 min-w-[220px]">Project Description</th>
                          <th className="px-3 py-3 min-w-[140px]">Scope of Work</th>
                          <th className="px-3 py-3 w-28 text-right">Capacity (kW)</th>
                          <th className="px-3 py-3 w-32 text-right">Charges (₹)</th>
                          <th className="px-2 py-3 w-10 text-center"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#2A2A2A]">
                        {currentInvoice.rows.map((row, idx) => (
                          <tr key={row.id} className={idx % 2 === 0 ? 'bg-[#121212] hover:bg-[#1A1A1A] transition-colors' : 'bg-[#161616] hover:bg-[#1E1E1E] transition-colors'}>
                            <td className="px-3 py-2.5 text-center text-xs text-gray-500 font-mono">
                              {idx + 1}
                            </td>
                            <td className="px-3 py-2.5">
                              <input
                                type="text"
                                placeholder="Project description…"
                                value={row.desc}
                                onChange={(e) => handleUpdateLineItem(row.id, 'desc', e.target.value)}
                                className="w-full bg-[#181818] border border-[#333333] rounded px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-[#D4AF37] focus:border-[#D4AF37] transition-all"
                              />
                            </td>
                            <td className="px-3 py-2.5">
                              <select
                                value={row.scope}
                                onChange={(e) => handleUpdateLineItem(row.id, 'scope', e.target.value)}
                                className="w-full bg-[#181818] border border-[#333333] rounded px-2.5 py-2 text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-[#D4AF37] focus:border-[#D4AF37] transition-all"
                              >
                                {SCOPE_OPTIONS.map((sc) => (
                                  <option key={sc} value={sc}>
                                    {sc}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={row.kw || ''}
                                placeholder="0.0"
                                onChange={(e) => handleUpdateLineItem(row.id, 'kw', e.target.value)}
                                className="w-full bg-[#181818] border border-[#333333] rounded px-3 py-2 text-sm text-right text-white focus:outline-none focus:ring-1 focus:ring-[#D4AF37] focus:border-[#D4AF37] font-mono transition-all"
                              />
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={row.charge || ''}
                                placeholder="0.00"
                                onChange={(e) => handleUpdateLineItem(row.id, 'charge', e.target.value)}
                                className="w-full bg-[#181818] border border-[#333333] rounded px-3 py-2 text-sm text-right font-mono text-emerald-400 focus:outline-none focus:ring-1 focus:ring-[#D4AF37] focus:border-[#D4AF37] transition-all"
                              />
                            </td>
                            <td className="px-2 py-2.5 text-center">
                              <button
                                onClick={() => handleRemoveLineItem(row.id)}
                                className="text-gray-500 hover:text-rose-400 p-1 transition-colors"
                                title="Remove item"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <button
                    onClick={handleAddLineItem}
                    className="w-full mt-4 py-2.5 border border-dashed border-[#D4AF37]/50 rounded-lg text-xs font-semibold text-[#D4AF37] hover:bg-[#D4AF37]/10 transition-colors flex items-center justify-center gap-1.5"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Add Project Line Item</span>
                  </button>
                </div>
              </div>

              {/* Right Column: Tax & Totals, Bank, Terms */}
              <div className="space-y-6">
                {/* 1. Summary Box */}
                <div className="bg-[#121212] border border-[#333333] rounded-xl p-5 shadow-lg">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#D4AF37] pb-2 border-b border-[#2A2A2A] mb-3">
                    Project Summary
                  </h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-[#181818] border border-[#2E2E2E] rounded-lg p-3">
                      <div className="text-[11px] text-gray-400 uppercase tracking-wider">Total Projects</div>
                      <div className="text-xl font-bold text-white font-serif mt-1">
                        {currentTotals.projectCount}
                      </div>
                    </div>
                    <div className="bg-[#181818] border border-[#2E2E2E] rounded-lg p-3">
                      <div className="text-[11px] text-gray-400 uppercase tracking-wider">Total kW</div>
                      <div className="text-xl font-bold text-[#D4AF37] font-mono mt-1">
                        {fmtNum(currentTotals.totalKW, 2)}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 2. Tax & Totals Box with subtle alternating background rows */}
                <div className="bg-[#121212] border border-[#333333] rounded-xl p-5 space-y-4 shadow-lg">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#D4AF37] pb-2 border-b border-[#2A2A2A]">
                    Tax &amp; Totals
                  </h4>

                  <div className="rounded-lg border border-[#2A2A2A] overflow-hidden divide-y divide-[#2A2A2A] text-xs">
                    <div className="flex justify-between items-center px-3.5 py-2.5 bg-[#181818] text-gray-200">
                      <span className="font-medium">Subtotal</span>
                      <span className="font-mono text-sm font-semibold">{fmtINR(currentTotals.subtotal)}</span>
                    </div>

                    <div className="flex items-center justify-between px-3.5 py-2.5 bg-[#141414] text-gray-400">
                      <span className="font-medium">SGST Rate</span>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          step="0.5"
                          min="0"
                          max="100"
                          value={currentInvoice.sgst}
                          onChange={(e) => {
                            setCurrentInvoice({ ...currentInvoice, sgst: safeNum(e.target.value) });
                            setIsDirty(true);
                          }}
                          className="w-16 bg-[#1A1A1A] border border-[#333333] rounded px-2 py-1 text-right text-white text-xs focus:outline-none focus:ring-1 focus:ring-[#D4AF37] focus:border-[#D4AF37] font-mono transition-all"
                        />
                        <span>%</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between px-3.5 py-2.5 bg-[#181818] text-gray-400">
                      <span className="font-medium">CGST Rate</span>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          step="0.5"
                          min="0"
                          max="100"
                          value={currentInvoice.cgst}
                          onChange={(e) => {
                            setCurrentInvoice({ ...currentInvoice, cgst: safeNum(e.target.value) });
                            setIsDirty(true);
                          }}
                          className="w-16 bg-[#1A1A1A] border border-[#333333] rounded px-2 py-1 text-right text-white text-xs focus:outline-none focus:ring-1 focus:ring-[#D4AF37] focus:border-[#D4AF37] font-mono transition-all"
                        />
                        <span>%</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between px-3.5 py-2.5 bg-[#141414] text-gray-400">
                      <span className="font-medium">IGST Rate</span>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          step="0.5"
                          min="0"
                          max="100"
                          value={currentInvoice.igst}
                          onChange={(e) => {
                            setCurrentInvoice({ ...currentInvoice, igst: safeNum(e.target.value) });
                            setIsDirty(true);
                          }}
                          className="w-16 bg-[#1A1A1A] border border-[#333333] rounded px-2 py-1 text-right text-white text-xs focus:outline-none focus:ring-1 focus:ring-[#D4AF37] focus:border-[#D4AF37] font-mono transition-all"
                        />
                        <span>%</span>
                      </div>
                    </div>

                    <div className="flex justify-between items-center px-3.5 py-2.5 bg-[#181818] text-gray-300">
                      <span className="font-medium">Total GST (₹)</span>
                      <span className="font-mono font-semibold text-gray-200">{fmtINR(currentTotals.totalGST)}</span>
                    </div>

                    <div className="flex items-center justify-between px-3.5 py-2.5 bg-[#141414] text-gray-400">
                      <span className="font-medium">Advance Paid (₹)</span>
                      <input
                        type="number"
                        min="0"
                        value={currentInvoice.advance || ''}
                        placeholder="0.00"
                        onChange={(e) => {
                          setCurrentInvoice({ ...currentInvoice, advance: safeNum(e.target.value) });
                          setIsDirty(true);
                        }}
                        className="w-28 bg-[#1A1A1A] border border-[#333333] rounded px-2.5 py-1 text-right text-white text-xs focus:outline-none focus:ring-1 focus:ring-[#D4AF37] focus:border-[#D4AF37] font-mono transition-all"
                      />
                    </div>
                  </div>

                  {/* Highlighted Payable Amount Block with distinct gold border and glow */}
                  <div className="p-4 rounded-xl bg-gradient-to-br from-[#1C180E] to-[#14120B] border-2 border-[#D4AF37] shadow-[0_0_15px_rgba(212,175,55,0.15)] flex items-center justify-between">
                    <div>
                      <div className="text-[10px] font-extrabold uppercase tracking-widest text-[#D4AF37]">
                        Payable Amount
                      </div>
                      <div className="text-2xl font-bold font-serif text-white mt-1 drop-shadow-sm">
                        {fmtINR(currentTotals.payable)}
                      </div>
                    </div>
                    <div className="w-10 h-10 rounded-lg bg-[#D4AF37]/15 border border-[#D4AF37]/40 flex items-center justify-center">
                      <Receipt className="w-5 h-5 text-[#D4AF37]" />
                    </div>
                  </div>
                </div>

                {/* 3. Bank Info override */}
                <div className="bg-[#121212] border border-[#333333] rounded-xl p-5 shadow-lg">
                  <div className="flex items-center justify-between pb-2 border-b border-[#2A2A2A] mb-3">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-[#D4AF37]">
                      Bank Details (Invoice Settlement)
                    </h4>
                    <button
                      onClick={() => {
                        const defaultBank = companySettings.bank || settings.bank;
                        setCurrentInvoice({ ...currentInvoice, bank: { ...defaultBank } });
                        setIsDirty(true);
                        showToast('Reset bank info from global company settings', 'info');
                      }}
                      className="text-[11px] text-gray-400 hover:text-white transition-colors"
                    >
                      ↺ From Global Settings
                    </button>
                  </div>
                  <div className="space-y-3 text-xs">
                    <div>
                      <label className="block text-gray-400 text-[11px] font-semibold uppercase tracking-wider mb-1">
                        Bank Name
                      </label>
                      <input
                        type="text"
                        value={currentInvoice.bank?.name || ''}
                        onChange={(e) => {
                          setCurrentInvoice({
                            ...currentInvoice,
                            bank: { ...currentInvoice.bank, name: e.target.value }
                          });
                          setIsDirty(true);
                        }}
                        className="w-full bg-[#181818] border border-[#333333] rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-[#D4AF37] focus:border-[#D4AF37] transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-400 text-[11px] font-semibold uppercase tracking-wider mb-1">
                        Account No.
                      </label>
                      <input
                        type="text"
                        value={currentInvoice.bank?.acc || ''}
                        onChange={(e) => {
                          setCurrentInvoice({
                            ...currentInvoice,
                            bank: { ...currentInvoice.bank, acc: e.target.value }
                          });
                          setIsDirty(true);
                        }}
                        className="w-full bg-[#181818] border border-[#333333] rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-[#D4AF37] focus:border-[#D4AF37] font-mono transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-400 text-[11px] font-semibold uppercase tracking-wider mb-1">
                        IFSC Code
                      </label>
                      <input
                        type="text"
                        value={currentInvoice.bank?.ifsc || ''}
                        onChange={(e) => {
                          setCurrentInvoice({
                            ...currentInvoice,
                            bank: { ...currentInvoice.bank, ifsc: e.target.value }
                          });
                          setIsDirty(true);
                        }}
                        className="w-full bg-[#181818] border border-[#333333] rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-[#D4AF37] focus:border-[#D4AF37] font-mono transition-all"
                      />
                    </div>
                  </div>
                </div>

                {/* 4. Terms override */}
                <div className="bg-[#121212] border border-[#333333] rounded-xl p-5 shadow-lg">
                  <div className="flex items-center justify-between pb-2 border-b border-[#2A2A2A] mb-3">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-[#D4AF37]">
                      Terms &amp; Conditions
                    </h4>
                    <button
                      onClick={() => {
                        setCurrentInvoice({ ...currentInvoice, terms: settings.terms.slice() });
                        setIsDirty(true);
                        showToast('Reset terms from company settings', 'info');
                      }}
                      className="text-[11px] text-gray-400 hover:text-white transition-colors"
                    >
                      ↺ From Defaults
                    </button>
                  </div>
                  <div className="space-y-2">
                    {currentInvoice.terms.map((t, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <span className="text-[#D4AF37] font-bold">•</span>
                        <input
                          type="text"
                          value={t}
                          onChange={(e) => {
                            const updated = [...currentInvoice.terms];
                            updated[idx] = e.target.value;
                            setCurrentInvoice({ ...currentInvoice, terms: updated });
                            setIsDirty(true);
                          }}
                          className="flex-1 bg-[#181818] border border-[#333333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-[#D4AF37] focus:border-[#D4AF37] transition-all"
                        />
                        <button
                          onClick={() => {
                            const updated = currentInvoice.terms.filter((_, i) => i !== idx);
                            setCurrentInvoice({ ...currentInvoice, terms: updated });
                            setIsDirty(true);
                          }}
                          className="text-gray-500 hover:text-rose-400 p-1.5 transition-colors"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => {
                        setCurrentInvoice({ ...currentInvoice, terms: [...currentInvoice.terms, ''] });
                        setIsDirty(true);
                      }}
                      className="text-xs text-[#D4AF37] hover:underline pt-1.5 block font-semibold"
                    >
                      ＋ Add Term
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ───────────── 3. TAB: INVOICE HISTORY ───────────── */}
        {activeBillingTab === 'history' && (
          <div className="w-full space-y-6">
            <div className="bg-[#1E1E1E] border border-[#333333] rounded-xl p-6 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-[#333333]">
                <div>
                  <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                    <History className="w-5 h-5 text-[#D4AF37]" />
                    Invoice Archive &amp; Payment Status ({invoices.length})
                  </h3>
                  <p className="text-xs text-gray-400 mt-1">
                    All saved drafts, dispatched invoices, and recorded settlements.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <Search className="w-4 h-4 text-gray-500 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      placeholder="Search # or client…"
                      value={historySearch}
                      onChange={(e) => setHistorySearch(e.target.value)}
                      className="bg-[#121212] border border-[#333333] hover:border-[#D4AF37]/50 rounded-lg pl-9 pr-3 py-1.5 text-xs text-white focus:outline-none focus:border-[#D4AF37] focus:ring-1 focus:ring-[#D4AF37]"
                    />
                  </div>
                  <select
                    value={statusFilter}
                    onChange={(e: any) => setStatusFilter(e.target.value)}
                    className="bg-[#121212] border border-[#333333] hover:border-[#D4AF37]/50 text-xs text-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-[#D4AF37]"
                  >
                    <option value="all">All Statuses</option>
                    <option value="draft">Draft</option>
                    <option value="sent">Sent</option>
                    <option value="partially paid">Partially Paid</option>
                    <option value="paid">Paid</option>
                  </select>
                </div>
              </div>

              <div className="mt-6 overflow-x-auto rounded-xl border border-[#333333]">
                <table className="w-full text-left whitespace-nowrap text-sm">
                  <thead className="bg-[#121212] text-xs text-gray-400 uppercase border-b border-[#333333]">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Invoice No.</th>
                      <th className="px-4 py-3 font-semibold">Client</th>
                      <th className="px-4 py-3 font-semibold">Date</th>
                      <th className="px-4 py-3 font-semibold text-center">Items</th>
                      <th className="px-4 py-3 font-semibold text-right">Capacity (kW)</th>
                      <th className="px-4 py-3 font-semibold text-right">Payable</th>
                      <th className="px-4 py-3 font-semibold text-center">Status</th>
                      <th className="px-4 py-3 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#333333]">
                    {invoices
                      .filter((inv) => {
                        if (statusFilter !== 'all' && inv.status !== statusFilter) return false;
                        if (!historySearch) return true;
                        const s = historySearch.toLowerCase();
                        return (
                          inv.invNo?.toLowerCase().includes(s) ||
                          inv.client?.name?.toLowerCase().includes(s)
                        );
                      })
                      .map((inv) => {
                        const kwTotal = (inv.rows || []).reduce((sum, r) => sum + safeNum(r.kw), 0);
                        return (
                          <tr key={inv.id} className="hover:bg-[#2A2A2A] transition-colors">
                            <td className="py-3.5 px-4 font-semibold text-[#D4AF37]">{inv.invNo}</td>
                            <td className="py-3.5 px-4 text-gray-200">{inv.client?.name || '—'}</td>
                            <td className="py-3.5 px-4 text-gray-400 text-xs">{fmtDateDisplay(inv.invDate)}</td>
                            <td className="py-3.5 px-4 text-center text-xs text-gray-400 font-mono">
                              {inv.rows?.length || 0}
                            </td>
                            <td className="py-3.5 px-4 text-right font-mono text-gray-300 text-xs">
                              {fmtNum(kwTotal, 2)}
                            </td>
                            <td className="py-3.5 px-4 text-right font-mono text-emerald-400 font-semibold">
                              {fmtINR(inv.totals?.payable ?? 0)}
                            </td>
                            <td className="py-3.5 px-4 text-center">
                              <div className="inline-flex flex-col items-center gap-1">
                                <div className="relative inline-block">
                                  <select
                                    value={
                                      inv.status === 'partially_paid' || inv.status === 'partial'
                                        ? 'partially paid'
                                        : inv.status || 'draft'
                                    }
                                    onChange={(e) => handleStatusChange(inv, e.target.value)}
                                    className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg border appearance-none pr-7 cursor-pointer transition-all focus:outline-none focus:ring-1 focus:ring-[#D4AF37] ${
                                      inv.status === 'paid'
                                        ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40 hover:bg-emerald-500/25'
                                        : inv.status === 'partially paid' || inv.status === 'partially_paid' || inv.status === 'partial'
                                        ? 'bg-amber-500/15 text-amber-400 border-amber-500/40 hover:bg-amber-500/25'
                                        : inv.status === 'sent'
                                        ? 'bg-[#D4AF37]/15 text-[#D4AF37] border-[#D4AF37]/40 hover:bg-[#D4AF37]/25'
                                        : 'bg-[#1A1A1A] text-gray-300 border-gray-600/40 hover:bg-[#252525]'
                                    }`}
                                  >
                                    <option value="draft" className="bg-[#1E1E1E] text-gray-300">Draft</option>
                                    <option value="sent" className="bg-[#1E1E1E] text-[#D4AF37]">Sent</option>
                                    <option value="partially paid" className="bg-[#1E1E1E] text-amber-400">Partially Paid</option>
                                    <option value="paid" className="bg-[#1E1E1E] text-emerald-400">Paid</option>
                                  </select>
                                  <ChevronDown className="w-3.5 h-3.5 text-current opacity-70 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                                </div>
                                {(inv.status === 'partially paid' || inv.status === 'partially_paid' || inv.status === 'partial') && inv.amountReceived !== undefined && inv.amountReceived > 0 && (
                                  <span className="text-[10px] font-mono text-amber-400/90 font-medium">
                                    Rec&apos;d: {fmtINR(inv.amountReceived)}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-3.5 px-4 text-right space-x-2">
                              <button
                                onClick={() => {
                                  loadInvoice(inv.id);
                                  setActiveBillingTab('invoice');
                                }}
                                className="px-3 py-1 text-xs rounded-lg bg-[#2A2A2A] hover:bg-[#333333] text-gray-200 border border-[#333333] hover:border-[#D4AF37]/40 transition-colors"
                              >
                                Open
                              </button>
                              <button
                                onClick={() => handleOpenPreview(inv)}
                                className="px-3 py-1 text-xs rounded-lg bg-[#2A2A2A] hover:bg-[#333333] text-[#D4AF37] border border-[#333333] hover:border-[#D4AF37]/50 font-medium transition-colors"
                              >
                                PDF
                              </button>
                              <button
                                onClick={() => {
                                  triggerConfirm(
                                    'Delete invoice?',
                                    `Permanently delete invoice ${inv.invNo}?`,
                                    () => {
                                      deleteInvoice(inv.id);
                                      showToast('Invoice deleted');
                                    }
                                  );
                                }}
                                className="px-3 py-1 text-xs rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 transition-colors"
                              >
                                Delete
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ───────────── 6. TAB: SETTINGS ───────────── */}
        {activeBillingTab === 'settings' && (
          <div className="w-full space-y-6">
            <div className="bg-[#1E1E1E] border border-[#333333] rounded-xl p-6">
              <div className="flex items-center justify-between pb-4 border-b border-[#333333]">
                <div>
                  <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                    <FileText className="w-5 h-5 text-[#D4AF37]" />
                    Billing-Specific Configurations
                  </h3>
                  <p className="text-xs text-gray-400 mt-1">
                    Configure authorized signatories, default terms &amp; conditions, tax rates, and sequential invoice numbering.
                  </p>
                </div>
                <button
                  onClick={() => {
                    saveSettings(settingsForm);
                    showToast('Billing settings saved successfully ✓', 'success');
                  }}
                  className="px-4 py-2 rounded-lg bg-[#D4AF37] hover:bg-[#f2c94c] text-black text-xs font-semibold shadow-lg shadow-[#D4AF37]/20 transition-colors"
                >
                  Save Billing Settings
                </button>
              </div>

              <div className="mt-6 space-y-6">
                {/* Authorized Signature Asset */}
                <div className="p-5 rounded-xl bg-[#121212] border border-[#333333] space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-[#D4AF37]">
                        Authorized Signatory Stamp / Signature
                      </h4>
                      <p className="text-xs text-gray-400 mt-0.5">
                        Embedded directly at the bottom-right of official PDF invoices.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">Signature Image (PNG / Transparent)</label>
                      <div className="border border-dashed border-[#D4AF37]/50 rounded-xl p-4 text-center bg-[#1E1E1E] relative min-h-[110px] flex flex-col items-center justify-center">
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            readAndResizeImage(file, 360, (dataUrl) => {
                              setSettingsForm({ ...settingsForm, signature: dataUrl });
                              showToast('Signature uploaded ✓', 'success');
                            });
                          }}
                          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                        />
                        {settingsForm.signature ? (
                          <img
                            src={settingsForm.signature}
                            alt="Signature"
                            className="max-h-16 object-contain"
                          />
                        ) : (
                          <div className="text-xs text-gray-400">Click or drag signature (PNG recommended)</div>
                        )}
                      </div>
                      {settingsForm.signature && (
                        <button
                          onClick={() => setSettingsForm({ ...settingsForm, signature: null })}
                          className="text-[11px] text-rose-400 hover:underline mt-1 block"
                        >
                          Remove Signature
                        </button>
                      )}
                    </div>

                    <div className="bg-[#1A1A1A] border border-[#2D2D2D] rounded-xl p-4 flex flex-col justify-center">
                      <div className="text-xs font-semibold text-gray-300 mb-1">Preview on Invoices</div>
                      <div className="h-16 bg-white/5 border border-dashed border-gray-700 rounded-lg flex items-center justify-center p-2">
                        {settingsForm.signature ? (
                          <img
                            src={settingsForm.signature}
                            alt="Signature Preview"
                            className="max-h-12 object-contain"
                          />
                        ) : (
                          <span className="text-[11px] text-gray-500 italic">No signature active</span>
                        )}
                      </div>
                      <div className="text-[11px] text-gray-400 mt-2 text-center">
                        For {companySettings.companyName || 'SOLARITHM ENERGY'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Next Invoice sequence & Tax defaults */}
                <div className="p-5 rounded-xl bg-[#121212] border border-[#333333] space-y-4">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#D4AF37]">
                    Invoice Numbering &amp; Tax Defaults
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">Next Invoice Number</label>
                      <input
                        type="text"
                        value={settingsForm.nextInvNo}
                        onChange={(e) => setSettingsForm({ ...settingsForm, nextInvNo: e.target.value })}
                        className="w-full bg-[#1E1E1E] border border-[#333333] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#D4AF37]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">Default SGST %</label>
                      <input
                        type="number"
                        value={settingsForm.defaultGST?.sgst ?? 9}
                        onChange={(e) =>
                          setSettingsForm({
                            ...settingsForm,
                            defaultGST: { ...settingsForm.defaultGST, sgst: safeNum(e.target.value) }
                          })
                        }
                        className="w-full bg-[#1E1E1E] border border-[#333333] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#D4AF37]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">Default CGST %</label>
                      <input
                        type="number"
                        value={settingsForm.defaultGST?.cgst ?? 9}
                        onChange={(e) =>
                          setSettingsForm({
                            ...settingsForm,
                            defaultGST: { ...settingsForm.defaultGST, cgst: safeNum(e.target.value) }
                          })
                        }
                        className="w-full bg-[#1E1E1E] border border-[#333333] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#D4AF37]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">Default IGST %</label>
                      <input
                        type="number"
                        value={settingsForm.defaultGST?.igst ?? 0}
                        onChange={(e) =>
                          setSettingsForm({
                            ...settingsForm,
                            defaultGST: { ...settingsForm.defaultGST, igst: safeNum(e.target.value) }
                          })
                        }
                        className="w-full bg-[#1E1E1E] border border-[#333333] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#D4AF37]"
                      />
                    </div>
                  </div>
                </div>

                {/* Default Terms */}
                <div className="p-5 rounded-xl bg-[#121212] border border-[#333333] space-y-4">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#D4AF37]">
                    Default Terms &amp; Conditions
                  </h4>
                  <div className="space-y-2">
                    {settingsForm.terms.map((t, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <span className="text-[#D4AF37] font-bold">•</span>
                        <input
                          type="text"
                          value={t}
                          onChange={(e) => {
                            const updated = [...settingsForm.terms];
                            updated[idx] = e.target.value;
                            setSettingsForm({ ...settingsForm, terms: updated });
                          }}
                          className="flex-1 bg-[#1E1E1E] border border-[#333333] rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-[#D4AF37]"
                        />
                        <button
                          onClick={() => {
                            const updated = settingsForm.terms.filter((_, i) => i !== idx);
                            setSettingsForm({ ...settingsForm, terms: updated });
                          }}
                          className="text-gray-500 hover:text-rose-400 p-1"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => setSettingsForm({ ...settingsForm, terms: [...settingsForm.terms, ''] })}
                      className="text-xs text-[#D4AF37] hover:underline pt-1 block"
                    >
                      ＋ Add Term
                    </button>
                  </div>
                </div>

                {/* Backup & Restore */}
                <div className="p-5 rounded-xl bg-[#121212] border border-[#333333] space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#D4AF37]">
                    Data Backup &amp; Storage
                  </h4>
                  <p className="text-xs text-gray-400">
                    All invoice data and client registers are saved in browser storage. Download JSON backups to archive or transfer records.
                  </p>
                  <div className="flex flex-wrap gap-3 pt-2">
                    <button
                      onClick={() => {
                        const backup = {
                          type: 'solarithm-invoice-studio-backup',
                          version: 2,
                          exportedAt: new Date().toISOString(),
                          settings,
                          clients: externalClients,
                          invoices
                        };
                        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `Solarithm_Invoice_Backup_${todayISO()}.json`;
                        a.click();
                        URL.revokeObjectURL(url);
                        showToast('Backup JSON exported ✓', 'success');
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1E1E1E] border border-[#444444] text-xs text-gray-200 hover:text-white"
                    >
                      <Download className="w-4 h-4 text-[#D4AF37]" />
                      <span>Export Backup (JSON)</span>
                    </button>
                    <button
                      onClick={() => {
                        triggerConfirm(
                          'Reset all billing data?',
                          'This will clear all local invoices and draft configurations stored in this browser session.',
                          () => {
                            saveInvoices([]);
                            saveSettings(defaultSettings());
                            showToast('Billing data reset', 'info');
                          }
                        );
                      }}
                      className="px-3 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-400 hover:bg-rose-500/20"
                    >
                      ⚠ Reset All Data
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ════════════════════ PREVIEW / PDF MODAL ════════════════════ */}
      {isPreviewOpen && (
        <div className="fixed inset-0 z-[10000] flex flex-col bg-black/70 backdrop-blur-sm">
          {/* Modal Header */}
          <div className="bg-[#1E1E1E] border-b border-[#333333] px-6 py-3.5 flex items-center justify-between shadow-xl">
            <div className="flex items-center gap-3">
              <h3 className="text-base font-bold text-white font-serif">
                Invoice Preview — <span className="text-[#D4AF37]">{previewInvoiceData?.invNo || 'Draft'}</span>
              </h3>
              <span className="text-xs text-gray-400">
                {previewPagesHtml.length} Page{previewPagesHtml.length === 1 ? '' : 's'}
              </span>
            </div>

            <div className="flex items-center gap-4">
              {/* Zoom controls */}
              <div className="flex items-center gap-1 bg-[#121212] border border-[#333333] rounded-lg p-1">
                <button
                  onClick={() => setZoomLevel((z) => Math.max(30, z - 10))}
                  className="p-1 rounded hover:bg-[#2A2A2A] text-gray-300 hover:text-white"
                  title="Zoom Out"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <span className="px-2 text-xs font-mono text-gray-300 min-w-[45px] text-center">
                  {zoomLevel}%
                </span>
                <button
                  onClick={() => setZoomLevel((z) => Math.min(150, z + 10))}
                  className="p-1 rounded hover:bg-[#2A2A2A] text-gray-300 hover:text-white"
                  title="Zoom In"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
              </div>

              {/* PDF Download Button */}
              <button
                onClick={handleExportPDF}
                disabled={isPdfExporting}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#D4AF37] hover:bg-[#f2c94c] text-black text-xs font-semibold shadow-lg shadow-[#D4AF37]/20 transition-colors disabled:opacity-50"
              >
                <Download className="w-4 h-4 text-black" />
                <span>{isPdfExporting ? pdfProgressText || 'Generating…' : 'Download PDF'}</span>
              </button>

              <button
                onClick={() => setIsPreviewOpen(false)}
                className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-[#2A2A2A] transition-colors"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Modal Body: A4 Print Preview Pages */}
          <div className="flex-1 overflow-auto p-8 bg-[#2C2C2C] flex flex-col items-center gap-6">
            {!previewPagesHtml.length ? (
              <div className="text-gray-400 text-sm py-20">Rendering A4 layout…</div>
            ) : (
              previewPagesHtml.map((p, idx) => {
                const scale = zoomLevel / 100;
                return (
                  <div key={idx} className="flex flex-col items-center gap-2">
                    <div className="text-xs font-medium text-gray-300 tracking-wider">
                      Page {p.pageNum} of {p.totalPages}
                    </div>
                    <div
                      className="preview-page-scale-wrap rounded-sm shadow-2xl overflow-hidden bg-white"
                      style={{
                        width: `${PAGE_W_MM * scale}mm`,
                        height: `${PAGE_H_MM * scale}mm`
                      }}
                    >
                      <div
                        className="a4-page"
                        style={{
                          transform: `scale(${scale})`,
                          transformOrigin: 'top left'
                        }}
                        dangerouslySetInnerHTML={{ __html: p.html }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Hidden Roots for Off-Screen Measurements and Rasterization */}
      <div id="measure-root" />
      <div id="pdf-render-root" />
    </div>
  );
}
