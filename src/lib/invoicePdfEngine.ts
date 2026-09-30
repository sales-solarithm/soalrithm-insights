import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import {
  CompanySettings,
  defaultCompanySettings,
  getInitialCompanySettings,
  COMPANY_STORAGE_KEYS
} from './useCompanySettings';

/* ════════════════════════════════════════════════════════════
   1. CONSTANTS & DEFAULTS
   ════════════════════════════════════════════════════════════ */
export const STORAGE_KEYS = {
  settings: 'solarithm_settings_v2',
  companySettings: COMPANY_STORAGE_KEYS.companySettings,
  clients: 'clients',
  invoices: 'invoices'
};

export const DEFAULT_TERMS = [
  'Payment to be made within 5 days from invoice date.',
  'Client must verify and approve all drawings/specifications before execution.',
  'Design service charges are non-refundable after final delivery.',
  'Late payments may attract additional charges and delay support/revisions.',
  'Invoice covers only agreed design scope; additional revisions/documentation will be chargeable.'
];

export const SCOPE_OPTIONS = [
  'Pre Design',
  'Post Design',
  'Detail Design',
  'SLD',
  'GA Layout',
  'CEIG Layout',
  'IFP Process',
  'Staad Report'
];

export interface InvoiceBank {
  name: string;
  acc: string;
  accName: string;
  ifsc: string;
  upi: string;
  branch?: string;
}

export interface InvoiceGST {
  sgst: number;
  cgst: number;
  igst: number;
}

export interface InvoiceSettings {
  companyName: string;
  tagline: string;
  gstin: string;
  phone: string;
  email: string;
  address: string;
  logo: string | null;
  signature: string | null;
  bank: InvoiceBank;
  terms: string[];
  defaultGST: InvoiceGST;
  nextInvNo: string;
}

export interface InvoiceClient {
  id?: string;
  name: string;
  contactPerson?: string;
  phone: string;
  gstin: string;
  email?: string;
  quotFormat?: string;
  address: string;
  createdAt?: string;
}

export interface InvoiceRow {
  id: string;
  desc: string;
  scope: string;
  kw: number;
  charge: number;
  _sr?: number;
  // Traces this line item back to its source project, so the invoice
  // generator can detect a project that's already been billed elsewhere
  // (e.g. a scope upgrade) instead of re-billing its full baseline cost.
  projectId?: string;
}

export interface InvoiceTotals {
  subtotal: number;
  totalKW: number;
  projectCount: number;
  sgst: number;
  cgst: number;
  igst: number;
  totalGST: number;
  advance: number;
  payable: number;
}

export interface InvoiceData {
  id: string;
  _isNew?: boolean;
  invNo: string;
  invDate: string;
  invDue: string;
  quotNo: string;
  status: 'draft' | 'sent' | 'partially paid' | 'paid' | string;
  amountReceived?: number;
  clientId: string | null;
  client: InvoiceClient;
  rows: InvoiceRow[];
  sgst: number;
  cgst: number;
  igst: number;
  advance: number;
  bank: InvoiceBank;
  terms: string[];
  totals?: InvoiceTotals;
  createdAt: string;
  updatedAt: string;
}

export function defaultSettings(): InvoiceSettings {
  const company = typeof window !== 'undefined' ? getInitialCompanySettings() : defaultCompanySettings();
  return {
    companyName: company.companyName,
    tagline: company.tagline,
    gstin: company.gstin,
    phone: company.phone,
    email: company.email,
    address: company.address,
    logo: company.logo,
    signature: null,
    bank: {
      name: company.bank.name,
      acc: company.bank.acc,
      accName: company.bank.accName,
      ifsc: company.bank.ifsc,
      upi: company.bank.upi,
      branch: company.bank.branch || ''
    },
    terms: DEFAULT_TERMS.slice(),
    defaultGST: { sgst: 9, cgst: 9, igst: 0 },
    nextInvNo: 'IN-SRD-2026-01'
  };
}

/* ════════════════════════════════════════════════════════════
   2. FORMATTING & HELPER UTILITIES
   ════════════════════════════════════════════════════════════ */
export function safeNum(v: any): number {
  const n = parseFloat(v);
  return isNaN(n) || !isFinite(n) ? 0 : n;
}

export function fmtINR(n: number | string): string {
  return '₹' + safeNum(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtNum(n: number | string, dp = 2): string {
  return safeNum(n).toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function fmtDateDisplay(isoStr?: string | null): string {
  if (!isoStr) return '—';
  const d = new Date(isoStr + 'T00:00:00');
  if (isNaN(d.getTime())) return isoStr;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${String(d.getDate()).padStart(2, '0')}-${months[d.getMonth()]}-${d.getFullYear()}`;
}

export function todayISO(): string {
  const d = new Date();
  return d.toISOString().split('T')[0];
}

export function addDaysISO(isoStr: string, days: number): string {
  const d = new Date(isoStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

export function uid(prefix = 'id'): string {
  return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

export function escapeHtml(str: any): string {
  if (typeof str === 'object' && str !== null) {
    str = Object.values(str).filter(Boolean).join(', ');
  }
  return String(str === undefined || str === null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeAttr(str: any): string {
  return escapeHtml(str).replace(/\n/g, '&#10;');
}

export function generateNextInvoiceNumber(current: string): string {
  const m = String(current || '').match(/^(.*?)(\d+)$/);
  if (!m) return current + '-1';
  const prefix = m[1];
  const numStr = m[2];
  const next = (parseInt(numStr, 10) + 1).toString().padStart(numStr.length, '0');
  return prefix + next;
}

export function calculateInvoiceTotals(
  rows: InvoiceRow[],
  sgstPct: number,
  cgstPct: number,
  igstPct: number,
  advanceAmt: number
): InvoiceTotals {
  let subtotal = 0;
  let totalKW = 0;
  let projectCount = 0;

  rows.forEach((row) => {
    subtotal += safeNum(row.charge);
    totalKW += safeNum(row.kw);
    if (safeNum(row.kw) > 0 || safeNum(row.charge) > 0 || (row.desc && row.desc.trim())) {
      projectCount++;
    }
  });

  const sgst = safeNum(sgstPct);
  const cgst = safeNum(cgstPct);
  const igst = safeNum(igstPct);
  const totalGST = (subtotal * (sgst + cgst + igst)) / 100;
  const advance = safeNum(advanceAmt);
  const payable = Math.max(0, subtotal + totalGST - advance);

  return {
    subtotal,
    totalKW,
    projectCount,
    sgst,
    cgst,
    igst,
    totalGST,
    advance,
    payable
  };
}

/* ════════════════════════════════════════════════════════════
   3. PREVIEW / PDF — SECTION RENDERERS (EXACT SOURCE PRESERVATION)
   ════════════════════════════════════════════════════════════ */
export function iconPhone(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.36 1.9.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0122 16.92z"/></svg>`;
}

export function iconMail(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v16H4z" opacity="0"/><path d="M22 6 12 13 2 6"/><rect x="2" y="4" width="20" height="16" rx="2"/></svg>`;
}

export function iconPin(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 1118 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
}

export function logoFallbackSVG(): string {
  return `<svg class="pv-logo" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <g transform="translate(50,50)">
      <g stroke="#D4A017" stroke-width="1.5" fill="none">
        <polygon points="0,-38 8,-20 -8,-20" fill="rgba(212,160,23,0.15)" stroke="#D4A017"/>
        <polygon points="36,10 18,22 10,2" fill="rgba(212,160,23,0.15)" stroke="#D4A017" transform="rotate(45)"/>
        <polygon points="36,10 18,22 10,2" fill="rgba(212,160,23,0.12)" stroke="#C49010" transform="rotate(100)"/>
        <polygon points="0,-38 8,-20 -8,-20" fill="rgba(212,160,23,0.12)" stroke="#C49010" transform="rotate(130)"/>
        <polygon points="36,10 18,22 10,2" fill="rgba(212,160,23,0.15)" stroke="#D4A017" transform="rotate(190)"/>
        <polygon points="0,-38 8,-20 -8,-20" fill="rgba(212,160,23,0.12)" stroke="#C49010" transform="rotate(250)"/>
        <polygon points="36,10 18,22 10,2" fill="rgba(212,160,23,0.15)" stroke="#D4A017" transform="rotate(310)"/>
      </g>
      <path d="M-12,0 Q-6,-12 0,-6 Q6,0 12,6 Q6,12 0,6 Q-6,0 -12,0Z" fill="none" stroke="#F0C842" stroke-width="1.2"/>
      <circle cx="0" cy="0" r="6" fill="none" stroke="#F0C842" stroke-width="1.5"/>
    </g>
  </svg>`;
}

export function renderHeaderBand(
  data: InvoiceData,
  settings: InvoiceSettings,
  companySettingsOverride?: CompanySettings
): string {
  const company = companySettingsOverride || (typeof window !== 'undefined' ? getInitialCompanySettings() : defaultCompanySettings());

  const logoHtml = company.logo
    ? `<img class="pv-logo" src="${company.logo}" alt="Company logo">`
    : logoFallbackSVG();

  return `<div class="pv-header-band">
    <div class="pv-company-area">
      ${logoHtml}
      <div class="pv-company-info">
        <div class="pv-company-name">${escapeHtml(company.companyName)}</div>
        ${company.tagline ? `<div class="pv-company-tagline">${escapeHtml(company.tagline)}</div>` : ''}
        ${company.gstin ? `<div class="pv-company-gstin">GSTIN : ${escapeHtml(company.gstin)}</div>` : ''}
      </div>
    </div>
    <div class="pv-contact-block">
      ${company.phone ? `<div class="pv-contact-line">${iconPhone()}<span>${escapeHtml(company.phone)}</span></div>` : ''}
      ${company.email ? `<div class="pv-contact-line">${iconMail()}<span>${escapeHtml(company.email)}</span></div>` : ''}
      ${company.address ? `<div class="pv-contact-line">${iconPin()}<span>${escapeHtml(company.address)}</span></div>` : ''}
    </div>
  </div>`;
}

export function renderMetaStrip(data: InvoiceData): string {
  return `<div class="pv-meta-strip">
    <div class="pv-meta-title">Invoice</div>
    <div class="pv-meta-fields">
      <div class="pv-meta-field">
        <div class="pv-meta-field-label">Invoice No.</div>
        <div class="pv-meta-field-value">${escapeHtml(data.invNo || '—')}</div>
      </div>
      <div class="pv-meta-field">
        <div class="pv-meta-field-label">Invoice Date</div>
        <div class="pv-meta-field-value">${fmtDateDisplay(data.invDate)}</div>
      </div>
      <div class="pv-meta-field">
        <div class="pv-meta-field-label">Invoice Due</div>
        <div class="pv-meta-field-value">${fmtDateDisplay(data.invDue)}</div>
      </div>
    </div>
  </div>`;
}

export function renderClientProjectGrid(data: InvoiceData): string {
  const t = data.totals || { projectCount: 0, totalKW: 0 };
  const rawAddress = data.client?.address || '';
  // Preserve manually-entered line breaks (the Billing Address field is a
  // textarea) and render as a proper multi-line block rather than the
  // single-line flex row used for the other fields -- a full postal
  // address needs to wrap onto its own lines, not run on beside its label.
  const addressHtml = escapeHtml(rawAddress).replace(/\n/g, '<br/>') || '—';
  return `<div class="pv-info-grid">
    <div>
      <div class="pv-block-title">Client Details</div>
      <div class="pv-info-row"><span class="pv-label">Company Name</span><span class="pv-value">${escapeHtml(data.client?.name || '—')}</span></div>
      ${data.client?.gstin ? `<div class="pv-info-row"><span class="pv-label">GSTIN</span><span class="pv-value">${escapeHtml(data.client.gstin)}</span></div>` : ''}
      <div class="pv-address-block">
        <div class="pv-label">Billing Address</div>
        <div class="pv-value pv-address-value">${addressHtml}</div>
      </div>
      <div class="pv-info-row"><span class="pv-label">Contact No.</span><span class="pv-value">${escapeHtml(data.client?.phone || '—')}</span></div>
    </div>
    <div>
      <div class="pv-block-title">Project Summary</div>
      <div class="pv-summary-row">
        <div class="pv-summary-stat">
          <div class="pv-summary-stat-label">Total Projects</div>
          <div class="pv-summary-stat-value">${t.projectCount || 0}</div>
        </div>
        <div class="pv-summary-stat">
          <div class="pv-summary-stat-label">Total Capacity (kW)</div>
          <div class="pv-summary-stat-value">${fmtNum(t.totalKW || 0, 2)}</div>
        </div>
      </div>
      ${data.quotNo ? `<div class="pv-info-row" style="margin-top:1mm;"><span class="pv-label">Quotation No.</span><span class="pv-value">${escapeHtml(data.quotNo)}</span></div>` : ''}
    </div>
  </div>`;
}

export function renderTableHead(): string {
  return `<thead><tr><th>Sr.</th><th>Project Description</th><th>Scope of Work</th><th>Capacity (kW)</th><th>Charges (₹)</th></tr></thead>`;
}

export function renderTableRow(row: InvoiceRow, sr: number): string {
  return `<tr><td>${sr}</td><td>${escapeHtml(row.desc)}</td><td>${escapeHtml(row.scope)}</td><td>${fmtNum(row.kw, 2)}</td><td>${fmtINR(row.charge)}</td></tr>`;
}

export function renderContinuedNote(): string {
  return `<div class="pv-continued-note">Continued on Next Page →</div>`;
}

export function renderFooter(pageNum: number, totalPages: number): string {
  return `<div class="pv-footer">
    <div class="pv-footer-text">Thank you for your trust in Solarithm.</div>
    <div class="pv-footer-page">Page ${pageNum} of ${totalPages}</div>
    <div class="pv-footer-brand">SOLARITHM</div>
  </div>`;
}

export function renderBottomSection(
  data: InvoiceData,
  settings: InvoiceSettings,
  companySettingsOverride?: CompanySettings
): string {
  const t = data.totals || {
    subtotal: 0,
    sgst: 0,
    cgst: 0,
    igst: 0,
    totalGST: 0,
    advance: 0,
    payable: 0,
    totalKW: 0,
    projectCount: 0
  };
  const company = companySettingsOverride || (typeof window !== 'undefined' ? getInitialCompanySettings() : defaultCompanySettings());
  const fallbackBank = company.bank || settings.bank || {};
  const bank = {
    name: data.bank?.name || fallbackBank.name,
    acc: data.bank?.acc || fallbackBank.acc,
    accName: data.bank?.accName || fallbackBank.accName,
    ifsc: data.bank?.ifsc || fallbackBank.ifsc,
    upi: data.bank?.upi || fallbackBank.upi,
    branch: data.bank?.branch || fallbackBank.branch
  };
  const companyName = company.companyName || settings.companyName;
  const subtotal = t.subtotal || 0;
  const sgstAmt = (subtotal * (t.sgst || 0)) / 100;
  const cgstAmt = (subtotal * (t.cgst || 0)) / 100;
  const igstAmt = (subtotal * (t.igst || 0)) / 100;

  return `<div class="pv-bottom-wrap">
    <div class="pv-bottom-grid">
      <div>
        <div class="pv-block-title">Bank Details</div>
        <div class="pv-bank-row"><span class="pv-label">Bank Name</span><span>${escapeHtml(bank.name || '—')}</span></div>
        <div class="pv-bank-row"><span class="pv-label">Account No.</span><span>${escapeHtml(bank.acc || '—')}</span></div>
        <div class="pv-bank-row"><span class="pv-label">Account Name</span><span>${escapeHtml(bank.accName || '—')}</span></div>
        <div class="pv-bank-row"><span class="pv-label">IFSC Code</span><span>${escapeHtml(bank.ifsc || '—')}</span></div>
        <div class="pv-bank-row"><span class="pv-label">UPI ID</span><span>${escapeHtml(bank.upi || '—')}</span></div>
        ${bank.branch ? `<div class="pv-bank-row"><span class="pv-label">Branch</span><span>${escapeHtml(bank.branch)}</span></div>` : ''}
      </div>
      <div>
        <div class="pv-block-title">Tax &amp; Totals</div>
        <table class="pv-totals-table">
          <tr><td>Subtotal</td><td>${fmtINR(subtotal)}</td></tr>
          <tr><td>SGST (${fmtNum(t.sgst || 0, 1)}%)</td><td>${fmtINR(sgstAmt)}</td></tr>
          <tr><td>CGST (${fmtNum(t.cgst || 0, 1)}%)</td><td>${fmtINR(cgstAmt)}</td></tr>
          <tr><td>IGST (${fmtNum(t.igst || 0, 1)}%)</td><td>${fmtINR(igstAmt)}</td></tr>
          <tr><td>Total GST (₹)</td><td>${fmtINR(t.totalGST || 0)}</td></tr>
          <tr><td colspan="2"><div class="pv-totals-divider"></div></td></tr>
          <tr><td>Advance Payment</td><td>${fmtINR(t.advance || 0)}</td></tr>
        </table>
        <div class="pv-grand-total"><div class="gl">Payable Amount</div><div class="ga">${fmtINR(t.payable || 0)}</div></div>
      </div>
    </div>
    <div class="pv-terms-sig-grid">
      <div>
        <div class="pv-block-title">Terms &amp; Conditions</div>
        <ul class="pv-terms-list">${(data.terms || settings.terms || []).filter((x) => x && x.trim()).map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>
      </div>
      <div class="pv-sig-block">
        <div class="pv-sig-company">${escapeHtml(companyName)}</div>
        <div class="pv-sig-img-wrap" style="position:relative; display:flex; align-items:center; justify-content:center;">
          ${(company.stamp) ? `<img src="${company.stamp}" alt="Company Stamp" style="position:absolute; right:10px; max-height:48px; opacity:0.65; pointer-events:none;">` : ''}
          ${(company.signature || settings.signature) ? `<img src="${company.signature || settings.signature}" alt="Authorized signature" style="position:relative; z-index:2; max-height:40px;">` : ''}
        </div>
        <div class="pv-sig-label">${escapeHtml(company.signatoryName || 'Authorised Signatory')}</div>
        ${company.signatoryDesignation ? `<div style="font-size:7pt; color:#666; font-family:sans-serif; text-align:center;">${escapeHtml(company.signatoryDesignation)}</div>` : ''}
      </div>
    </div>
  </div>`;
}

/* ════════════════════════════════════════════════════════════
   4. PAGINATION ENGINE (EXACT SOURCE PRESERVATION)
   ════════════════════════════════════════════════════════════ */
export const PAGE_W_MM = 210;
export const PAGE_H_MM = 297;
export const PAD_LR_MM = 12;
export const PAD_TOP_MM = 10;
export const PAD_BOTTOM_MM = 4;
export const GAP_MM = 5;
export const SAFETY_MM = 4;
export const CONTENT_W_MM = PAGE_W_MM - PAD_LR_MM * 2;

export interface InvoicePageDescriptor {
  pageNum?: number;
  totalPages?: number;
  rows: InvoiceRow[];
  isFirst: boolean;
  hasBottom: boolean;
  isLastRowsPage: boolean;
  isLast?: boolean;
}

export function getMmToPx(): number {
  if (typeof document === 'undefined') return 3.7795;
  let root = document.getElementById('measure-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'measure-root';
    document.body.appendChild(root);
  }
  const probe = document.createElement('div');
  probe.style.width = '100mm';
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  root.appendChild(probe);
  const ratio = probe.getBoundingClientRect().width / 100;
  probe.remove();
  return ratio || 3.7795;
}

export function buildInvoicePages(
  data: InvoiceData,
  settings: InvoiceSettings,
  companySettingsOverride?: CompanySettings
): InvoicePageDescriptor[] {
  const globalCompany = companySettingsOverride || (typeof window !== 'undefined' ? getInitialCompanySettings() : defaultCompanySettings());

  if (typeof document === 'undefined') {
    return [{ rows: data.rows, isFirst: true, hasBottom: true, isLastRowsPage: true, pageNum: 1, totalPages: 1, isLast: true }];
  }

  let root = document.getElementById('measure-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'measure-root';
    document.body.appendChild(root);
  }
  root.innerHTML = '';
  const MMPX = getMmToPx();
  const mm = (v: number) => v * MMPX;

  const measDiv = document.createElement('div');
  measDiv.className = 'a4-measure';
  measDiv.style.width = CONTENT_W_MM + 'mm';
  root.appendChild(measDiv);

  function measure(html: string): number {
    measDiv.innerHTML = html;
    const h = measDiv.firstElementChild ? measDiv.firstElementChild.getBoundingClientRect().height : 0;
    measDiv.innerHTML = '';
    return h;
  }

  const headerH = measure(renderHeaderBand(data, settings, globalCompany));
  const metaH = measure(renderMetaStrip(data));
  const clientH = measure(renderClientProjectGrid(data));
  const labelH = measure(`<div class="pv-table-cont-label">Line Items</div>`);
  const contLblH = measure(`<div class="pv-table-cont-label">Line Items (Continued)</div>`);
  const theadH = measure(`<table class="pv-table">${renderTableHead()}</table>`);
  const continuedH = measure(renderContinuedNote());
  const bottomH = measure(renderBottomSection(data, settings, globalCompany));
  const footerH = measure(renderFooter(1, 1));

  let rowHeights: number[] = [];
  if (data.rows.length) {
    const rowsHtml = data.rows.map((r, i) => renderTableRow(r, i + 1)).join('');
    measDiv.innerHTML = `<table class="pv-table"><tbody>${rowsHtml}</tbody></table>`;
    const trs = measDiv.querySelectorAll('tbody tr');
    rowHeights = Array.from(trs).map((tr) => tr.getBoundingClientRect().height);
    measDiv.innerHTML = '';
  }

  root.removeChild(measDiv);

  const pageHpx = mm(PAGE_H_MM);
  const padTop = mm(PAD_TOP_MM);
  const padBottom = mm(PAD_BOTTOM_MM);
  const gap = mm(GAP_MM);
  const safety = mm(SAFETY_MM);

  const contentAvailable = pageHpx - footerH - padTop - padBottom - safety;
  const reserveContinued = continuedH + gap;
  const n = data.rows.length;

  const pages: InvoicePageDescriptor[] = [];
  let rowIdx = 0;

  do {
    const isFirst = pages.length === 0;
    let used = headerH + gap + metaH + gap;
    if (isFirst) used += clientH + gap;
    used += (isFirst ? labelH : contLblH) + gap;
    used += theadH;

    const pageRows: InvoiceRow[] = [];
    let pageHeight = used;

    while (rowIdx < n) {
      const rh = rowHeights[rowIdx] || 25;
      const isGlobalLastRow = rowIdx === n - 1;
      const reserve = isGlobalLastRow ? 0 : reserveContinued;
      const projected = pageHeight + rh + reserve;
      if (pageRows.length > 0 && projected > contentAvailable) break;
      pageRows.push(Object.assign({}, data.rows[rowIdx], { _sr: rowIdx + 1 }));
      pageHeight += rh;
      rowIdx++;
    }

    const isLastRowsPage = rowIdx >= n;
    let hasBottom = false;
    if (isLastRowsPage && pageHeight + bottomH + gap <= contentAvailable) {
      hasBottom = true;
    }

    pages.push({ rows: pageRows, isFirst, hasBottom, isLastRowsPage });
  } while (rowIdx < n);

  const lastPage = pages[pages.length - 1];
  if (lastPage && !lastPage.hasBottom) {
    pages.push({ rows: [], isFirst: false, hasBottom: true, isLastRowsPage: true });
  }

  const total = pages.length;
  pages.forEach((p, i) => {
    p.pageNum = i + 1;
    p.totalPages = total;
    p.isLast = i === total - 1;
  });

  return pages;
}

export function renderPageHTML(
  pageData: InvoicePageDescriptor,
  data: InvoiceData,
  settings: InvoiceSettings,
  companySettingsOverride?: CompanySettings
): string {
  let inner = '';
  inner += renderHeaderBand(data, settings, companySettingsOverride);
  inner += renderMetaStrip(data);
  if (pageData.isFirst) inner += renderClientProjectGrid(data);

  inner += `<div class="table-section">`;
  inner += `<div class="pv-table-cont-label">${pageData.isFirst ? 'Line Items' : 'Line Items (Continued)'}</div>`;
  inner += `<table class="pv-table">${renderTableHead()}<tbody>`;
  inner += pageData.rows.map((r) => renderTableRow(r, r._sr || 1)).join('');
  inner += `</tbody></table></div>`;

  if (!pageData.isLast) inner += renderContinuedNote();
  if (pageData.hasBottom) inner += renderBottomSection(data, settings, companySettingsOverride);

  return `<div class="a4-content">${inner}</div>` + renderFooter(pageData.pageNum || 1, pageData.totalPages || 1);
}

/* ════════════════════════════════════════════════════════════
   5. PDF EXPORT ENGINE (EXACT MULTI-PAGE RASTERIZATION PRESERVATION)
   ════════════════════════════════════════════════════════════ */
export async function exportInvoicePDF(
  data: InvoiceData,
  settings: InvoiceSettings,
  onProgress?: (msg: string) => void,
  companySettingsOverride?: CompanySettings
): Promise<void> {
  if (typeof document === 'undefined') return;

  const effectiveCompany = companySettingsOverride || (typeof window !== 'undefined' ? getInitialCompanySettings() : defaultCompanySettings());

  const mergedSettings: InvoiceSettings = {
    ...settings,
    companyName: effectiveCompany.companyName,
    tagline: effectiveCompany.tagline,
    gstin: effectiveCompany.gstin,
    phone: effectiveCompany.phone,
    email: effectiveCompany.email,
    address: effectiveCompany.address,
    logo: effectiveCompany.logo,
    bank: effectiveCompany.bank
  };

  let root = document.getElementById('pdf-render-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'pdf-render-root';
    document.body.appendChild(root);
  }
  root.innerHTML = '';

  try {
    onProgress?.('Preparing pages…');
    const pageDescs = buildInvoicePages(data, mergedSettings, effectiveCompany);
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });

    for (let i = 0; i < pageDescs.length; i++) {
      onProgress?.(`Rendering page ${i + 1} of ${pageDescs.length}…`);
      const p = pageDescs[i];
      const pageHtml = renderPageHTML(p, data, mergedSettings, effectiveCompany);

      const pageEl = document.createElement('div');
      pageEl.className = 'a4-page';
      pageEl.style.width = PAGE_W_MM + 'mm';
      pageEl.style.height = PAGE_H_MM + 'mm';
      pageEl.style.position = 'relative';
      pageEl.innerHTML = pageHtml;
      root.appendChild(pageEl);

      await new Promise((r) => setTimeout(r, 60));

      const canvas = await html2canvas(pageEl, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
        windowWidth: pageEl.scrollWidth,
        windowHeight: pageEl.scrollHeight
      });

      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      if (i > 0) pdf.addPage();
      pdf.addImage(imgData, 'JPEG', 0, 0, PAGE_W_MM, PAGE_H_MM);

      root.removeChild(pageEl);
    }

    const invNo = data.invNo || 'Invoice';
    const client = data.client?.name || 'Client';
    const filename = `Invoice_${invNo}_${client}.pdf`.replace(/[^a-zA-Z0-9._-]+/g, '_');
    pdf.save(filename);
  } catch (err: any) {
    console.error('PDF export error:', err);
    throw err;
  } finally {
    if (root) root.innerHTML = '';
  }
}
