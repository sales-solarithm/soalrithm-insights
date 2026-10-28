import { collection, doc, writeBatch } from 'firebase/firestore';
import { db } from './firebase';
import { COLLECTIONS } from '@/src/config/schema';
import { findMatchingInvoicesForProject } from './projectUtils';
import { InvoiceData, canonicalInvoiceStatus } from './invoicePdfEngine';
import { canMutateDocument } from './mutationGuard';

/**
 * Atomically updates paymentStatus of projects linked to an invoice.
 * Guaranteed:
 * - NO fallback getDocs(collection(...)) to prevent quota leaks.
 * - Deep dirty-checking before batch.update() (skips write if status already matches).
 * - Rate-limited via mutationGuard.
 */
export async function syncInvoiceProjectsToFirestore(
  invoice: Partial<InvoiceData>,
  rawTargetStatus: string,
  knownProjects: any[] = []
): Promise<string[]> {
  if (!invoice || !db) return [];
  
  // Guard 1: Never fetch entire collections as fallback
  if (!Array.isArray(knownProjects) || knownProjects.length === 0) {
    console.warn('[projectSync] Skipped sync: No in-memory projects provided. Full collection scan suppressed.');
    return [];
  }

  const canonical = canonicalInvoiceStatus(rawTargetStatus);
  const projectPaymentStatus =
    canonical === 'PAID'
      ? 'paid'
      : canonical === 'PARTIALLY_PAID'
      ? 'partially_paid'
      : canonical === 'CANCELLED'
      ? 'cancelled'
      : 'pending';

  const matchedProjectIds = new Set<string>();

  // Check direct IDs on invoice
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

  // Check matching projects from provided in-memory list
  knownProjects.forEach((p) => {
    if (!p || !p.id) return;
    const matches = findMatchingInvoicesForProject(p, [invoice]);
    if (matches.length > 0) {
      matchedProjectIds.add(p.id);
    }
  });

  const targetIds = Array.from(matchedProjectIds);
  if (targetIds.length === 0) return [];

  try {
    const batch = writeBatch(db);
    const nowIso = new Date().toISOString();
    const billingPeriod = invoice.invDate ? invoice.invDate.slice(0, 7) : nowIso.slice(0, 7);
    let queuedWrites = 0;

    targetIds.forEach((projectId) => {
      const proj = knownProjects.find((p) => p.id === projectId);
      if (!proj) return;

      // Guard 2: Dirty check. Do NOT write if values already match!
      const currentPaymentStatus = String(proj.paymentStatus || proj.payment_status || '').toLowerCase().trim();
      const currentInvoiceStatus = String(proj.invoiceStatus || '').toUpperCase().trim();
      const currentInvoiceId = String(proj.invoiceId || '').trim();

      const isStatusIdentical =
        currentPaymentStatus === projectPaymentStatus &&
        currentInvoiceStatus === canonical &&
        (currentInvoiceId === String(invoice.id || '').trim());

      if (isStatusIdentical) {
        return; // Skip write
      }

      // Guard 3: Circuit breaker per document
      if (!canMutateDocument(`projects/${projectId}`, 15000)) {
        return; // Cooldown active
      }

      const pRef = doc(db, COLLECTIONS.PROJECTS, projectId);

      let updatedUpgradeHistory = undefined;
      if (Array.isArray(proj.upgradeHistory) && proj.upgradeHistory.length > 0) {
        let historyChanged = false;
        updatedUpgradeHistory = proj.upgradeHistory.map((u: any, idx: number) => {
          if ((idx === proj.upgradeHistory.length - 1 || !u.invoicedInPeriod) && u.invoicedInPeriod !== billingPeriod) {
            historyChanged = true;
            return {
              ...u,
              invoicedInPeriod: billingPeriod,
              invoicedInInvoiceNo: invoice.invNo || ''
            };
          }
          return u;
        });
        if (!historyChanged) {
          updatedUpgradeHistory = undefined;
        }
      }

      const updateData: Record<string, any> = {
        paymentStatus: projectPaymentStatus,
        payment_status: projectPaymentStatus,
        invoiceStatus: canonical,
        invoiceId: invoice.id || '',
        invoiceNo: invoice.invNo || '',
        updatedAt: nowIso
      };

      if (updatedUpgradeHistory) {
        updateData.upgradeHistory = updatedUpgradeHistory;
      }

      batch.update(pRef, updateData);
      queuedWrites++;
    });

    if (queuedWrites > 0) {
      await batch.commit();
      console.info(`[projectSync] Successfully updated ${queuedWrites} project(s) to status: ${projectPaymentStatus}.`);
    }

    return targetIds;
  } catch (err) {
    console.error('[projectSync] Error updating project payment statuses:', err);
    return [];
  }
}

/**
 * Deterministic status hierarchy to prevent oscillation:
 * PAID (3) > PARTIALLY_PAID (2) > PENDING (1) > CANCELLED (0)
 */
const STATUS_PRIORITY: Record<string, number> = {
  PAID: 3,
  PARTIALLY_PAID: 2,
  PENDING: 1,
  CANCELLED: 0
};

/**
 * Historical healer: Runs ONLY via explicit user command.
 * Enforces highest-priority status win when multiple invoices match.
 */
export async function auditAndHealProjectPaymentSync(
  invoices: any[],
  projects: any[]
): Promise<number> {
  if (!Array.isArray(invoices) || !Array.isArray(projects) || invoices.length === 0 || projects.length === 0 || !db) {
    return 0;
  }

  const projectStatusCandidateMap = new Map<string, { status: string; invNo: string; invId: string; priority: number }>();

  // Determine highest priority invoice status for each project
  invoices.forEach((inv) => {
    const canonical = canonicalInvoiceStatus(inv.status);
    const priority = STATUS_PRIORITY[canonical] ?? 0;

    projects.forEach((proj) => {
      if (!proj || !proj.id) return;
      const matches = findMatchingInvoicesForProject(proj, [inv]);
      if (matches.length > 0) {
        const existing = projectStatusCandidateMap.get(proj.id);
        if (!existing || priority > existing.priority) {
          projectStatusCandidateMap.set(proj.id, {
            status: canonical === 'PAID' ? 'paid' : canonical === 'PARTIALLY_PAID' ? 'partially_paid' : 'pending',
            invNo: inv.invNo || '',
            invId: inv.id || '',
            priority
          });
        }
      }
    });
  });

  if (projectStatusCandidateMap.size === 0) return 0;

  try {
    const batch = writeBatch(db);
    const nowIso = new Date().toISOString();
    let writeCount = 0;

    projectStatusCandidateMap.forEach((info, projectId) => {
      const proj = projects.find((p) => p.id === projectId);
      if (!proj) return;

      const currentStatus = String(proj.paymentStatus || proj.payment_status || '').toLowerCase().trim();
      if (currentStatus === info.status) return; // Already in sync

      if (!canMutateDocument(`projects/${projectId}`, 15000)) return;

      const pRef = doc(db, COLLECTIONS.PROJECTS, projectId);
      batch.update(pRef, {
        paymentStatus: info.status,
        payment_status: info.status,
        invoiceStatus: info.status.toUpperCase(),
        invoiceId: info.invId,
        invoiceNo: info.invNo,
        updatedAt: nowIso
      });
      writeCount++;
    });

    if (writeCount > 0) {
      await batch.commit();
      console.info(`[projectSync:heal] Healed ${writeCount} mismatched project payment statuses.`);
    }

    return writeCount;
  } catch (err) {
    console.error('[projectSync:heal] Failed during payment sync heal:', err);
    return 0;
  }
}
