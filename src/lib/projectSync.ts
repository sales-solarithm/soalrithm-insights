import { collection, doc, writeBatch, getDocs } from 'firebase/firestore';
import { db } from './firebase';
import { COLLECTIONS } from '@/src/config/schema';
import { findMatchingInvoicesForProject } from './projectUtils';
import { InvoiceData, canonicalInvoiceStatus } from './invoicePdfEngine';

/**
 * Atomically updates the paymentStatus of all projects linked to an invoice in Firestore.
 * Supports:
 * - Direct invoice.projectId / invoice.projectIds
 * - Row-level invoice.rows[].projectId
 * - Dynamic matching via findMatchingInvoicesForProject
 * - Known projects list or dynamic Firestore scan fallback
 */
export async function syncInvoiceProjectsToFirestore(
  invoice: Partial<InvoiceData>,
  rawTargetStatus: string,
  knownProjects?: any[]
): Promise<string[]> {
  if (!invoice) return [];
  const canonical = canonicalInvoiceStatus(rawTargetStatus);
  const projectPaymentStatus =
    canonical === 'PAID'
      ? 'paid'
      : canonical === 'PARTIALLY_PAID'
      ? 'partially_paid'
      : canonical === 'CANCELLED'
      ? 'cancelled'
      : 'pending';

  // 1. Gather all candidate projects to scan
  let projectsToScan: any[] = Array.isArray(knownProjects) && knownProjects.length > 0 ? knownProjects : [];

  if (projectsToScan.length === 0) {
    try {
      const snap = await getDocs(collection(db, COLLECTIONS.PROJECTS));
      projectsToScan = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (e) {
      console.warn('Could not fetch projects to scan for invoice sync:', e);
    }
  }

  // 2. Identify all matched project IDs
  const matchedProjectIds = new Set<string>();

  // Direct IDs from invoice
  const anyInvoice = invoice as any;
  if (anyInvoice?.projectId) matchedProjectIds.add(String(anyInvoice.projectId));
  if (Array.isArray(anyInvoice?.projectIds)) {
    anyInvoice.projectIds.forEach((pid: any) => pid && matchedProjectIds.add(String(pid)));
  }
  if (Array.isArray(invoice.rows)) {
    invoice.rows.forEach((row: any) => {
      if (row?.projectId) matchedProjectIds.add(String(row.projectId));
    });
  }

  // Cross-reference with projects to scan
  projectsToScan.forEach((p) => {
    if (!p || !p.id) return;
    const matches = findMatchingInvoicesForProject(p, [invoice]);
    if (matches.length > 0) {
      matchedProjectIds.add(p.id);
    }
  });

  const targetIds = Array.from(matchedProjectIds);
  if (targetIds.length === 0) {
    return [];
  }

  // 3. Atomically update all linked project documents in Firestore
  try {
    const batch = writeBatch(db);
    const nowIso = new Date().toISOString();

    targetIds.forEach((projectId) => {
      const pRef = doc(db, COLLECTIONS.PROJECTS, projectId);
      batch.update(pRef, {
        paymentStatus: projectPaymentStatus,
        payment_status: projectPaymentStatus,
        invoiceStatus: canonical,
        invoiceId: invoice.id || '',
        invoiceNo: invoice.invNo || '',
        updatedAt: nowIso
      });
    });

    await batch.commit();
    return targetIds;
  } catch (err) {
    console.error('Failed to atomically sync project payment status to Firestore:', err);
    return [];
  }
}

/**
 * Historical healer: Cross-audits all invoices and projects in the system.
 * If any project linked to a PAID invoice still shows non-paid status,
 * atomically repairs it in Firestore.
 */
export async function auditAndHealProjectPaymentSync(
  invoices: any[],
  projects: any[]
): Promise<number> {
  if (!Array.isArray(invoices) || !Array.isArray(projects) || invoices.length === 0 || projects.length === 0) {
    return 0;
  }

  const projectsToUpdate = new Map<string, { status: string; invNo: string; invId: string }>();

  invoices.forEach((inv) => {
    const canonical = canonicalInvoiceStatus(inv.status);
    if (canonical !== 'PAID' && canonical !== 'PARTIALLY_PAID') return;

    const expectedPaymentStatus = canonical === 'PAID' ? 'paid' : 'partially_paid';

    projects.forEach((proj) => {
      if (!proj || !proj.id) return;
      const explicit = String(proj.paymentStatus || proj.payment_status || '').toLowerCase().trim();
      if (explicit === expectedPaymentStatus) return;

      const matches = findMatchingInvoicesForProject(proj, [inv]);
      if (matches.length > 0) {
        projectsToUpdate.set(proj.id, {
          status: expectedPaymentStatus,
          invNo: inv.invNo || '',
          invId: inv.id || ''
        });
      }
    });
  });

  if (projectsToUpdate.size === 0) {
    return 0;
  }

  try {
    const batch = writeBatch(db);
    const nowIso = new Date().toISOString();

    projectsToUpdate.forEach((info, projectId) => {
      const pRef = doc(db, COLLECTIONS.PROJECTS, projectId);
      batch.update(pRef, {
        paymentStatus: info.status,
        payment_status: info.status,
        invoiceStatus: info.status.toUpperCase(),
        invoiceId: info.invId,
        invoiceNo: info.invNo,
        updatedAt: nowIso
      });
    });

    await batch.commit();
    return projectsToUpdate.size;
  } catch (err) {
    console.error('Failed during historical project payment sync heal:', err);
    return 0;
  }
}
