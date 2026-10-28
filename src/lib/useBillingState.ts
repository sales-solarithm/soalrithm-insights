import { useState, useEffect, useCallback, useRef } from 'react';
import {
  collection,
  onSnapshot,
  doc,
  setDoc,
  deleteDoc,
  updateDoc,
  runTransaction,
  writeBatch
} from 'firebase/firestore';
import { db } from './firebase';
import { COLLECTIONS } from '@/src/config/schema';
import {
  InvoiceData,
  InvoiceSettings,
  InvoiceClient,
  InvoiceRow,
  defaultSettings,
  STORAGE_KEYS,
  todayISO,
  addDaysISO,
  uid,
  calculateInvoiceTotals,
  generateNextInvoiceNumber,
  safeNum
} from './invoicePdfEngine';
import {
  CompanySettings,
  getInitialCompanySettings,
  defaultCompanySettings,
  COMPANY_STORAGE_KEYS
} from './useCompanySettings';
import { syncInvoiceProjectsToFirestore } from './projectSync';

export function blankInvoice(settings: InvoiceSettings, companyOverride?: CompanySettings): InvoiceData {
  const company = companyOverride || (typeof window !== 'undefined' ? getInitialCompanySettings() : defaultCompanySettings());
  const effectiveBank = {
    name: (company.bank?.name || settings.bank?.name || '').trim(),
    acc: (company.bank?.acc || settings.bank?.acc || '').trim(),
    accName: (company.bank?.accName || settings.bank?.accName || '').trim(),
    ifsc: (company.bank?.ifsc || settings.bank?.ifsc || '').toUpperCase().trim(),
    upi: (company.bank?.upi || settings.bank?.upi || '').trim(),
    branch: (company.bank?.branch || settings.bank?.branch || '').trim()
  };

  return {
    id: uid('inv'),
    _isNew: true,
    invNo: settings.nextInvNo || 'IN-SRD-2026-01',
    invDate: todayISO(),
    invDue: addDaysISO(todayISO(), 7),
    quotNo: '',
    status: 'PENDING',
    amountReceived: 0,
    clientId: null,
    client: { name: '', phone: '', gstin: '', address: '' },
    rows: [
      { id: uid('row'), desc: '', scope: 'Pre Design', kw: 0, charge: 0 },
      { id: uid('row'), desc: '', scope: 'Pre Design', kw: 0, charge: 0 },
      { id: uid('row'), desc: '', scope: 'Pre Design', kw: 0, charge: 0 }
    ],
    sgst: settings.defaultGST.sgst,
    cgst: settings.defaultGST.cgst,
    igst: settings.defaultGST.igst,
    advance: 0,
    bank: effectiveBank,
    terms: settings.terms.slice(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

export function blankLineItem(): InvoiceRow {
  return { id: uid('row'), desc: '', scope: 'Pre Design', kw: 0, charge: 0 };
}

function getInitialSettings(): InvoiceSettings {
  const company = typeof window !== 'undefined' ? getInitialCompanySettings() : defaultCompanySettings();
  const def = defaultSettings();
  if (typeof window === 'undefined') return def;
  try {
    const rawSettings = localStorage.getItem(STORAGE_KEYS.settings);
    if (rawSettings) {
      const parsed = JSON.parse(rawSettings);
      if (parsed) {
        return {
          companyName: company.companyName,
          tagline: company.tagline,
          gstin: company.gstin,
          phone: company.phone,
          email: company.email,
          address: company.address,
          logo: company.logo,
          bank: {
            name: company.bank.name,
            acc: company.bank.acc,
            accName: company.bank.accName,
            ifsc: company.bank.ifsc,
            upi: company.bank.upi,
            branch: company.bank.branch
          },
          signature: parsed.signature !== undefined ? parsed.signature : def.signature,
          defaultGST: parsed.defaultGST ? { ...def.defaultGST, ...parsed.defaultGST } : def.defaultGST,
          terms: Array.isArray(parsed.terms) && parsed.terms.length ? parsed.terms : def.terms,
          nextInvNo: parsed.nextInvNo || def.nextInvNo
        };
      }
    }
  } catch (e) {
    console.error('Error reading settings from localStorage:', e);
  }
  return def;
}

function getInitialInvoices(): InvoiceData[] {
  if (typeof window === 'undefined') return [];
  try {
    const rawInvoices = localStorage.getItem('invoices') || localStorage.getItem('billing') || localStorage.getItem(STORAGE_KEYS.invoices);
    if (rawInvoices) {
      const parsedI = JSON.parse(rawInvoices);
      if (Array.isArray(parsedI)) return parsedI;
    }
  } catch (e) {
    console.error('Error reading invoices from localStorage:', e);
  }
  return [];
}

export function useBillingState() {
  const [settings, setSettingsState] = useState<InvoiceSettings>(getInitialSettings);
  const [invoices, setInvoicesState] = useState<InvoiceData[]>(getInitialInvoices);
  const [currentInvoice, setCurrentInvoice] = useState<InvoiceData>(() => blankInvoice(getInitialSettings()));
  const [isDirty, setIsDirty] = useState<boolean>(false);
  const [isLoaded, setIsLoaded] = useState<boolean>(false);
  const hasMigratedRef = useRef(false);

  const invoicesRef = useRef<InvoiceData[]>(invoices);
  useEffect(() => {
    invoicesRef.current = invoices;
  }, [invoices]);

  // Firestore subscription for invoices collection
  useEffect(() => {
    const invoicesCollRef = collection(db, COLLECTIONS.INVOICES);
    const unsubscribe = onSnapshot(
      invoicesCollRef,
      async (snapshot) => {
        // Point 1: Explicitly map document ID to prevent ID collisions or undefined drop
        const firestoreInvoices = snapshot.docs.map((d) => {
          const raw = d.data() as InvoiceData;
          return {
            ...raw,
            id: d.id || raw.id
          };
        });

        // Point 4: Self-Healing Local Storage Rescue
        // Check localStorage for invoices whose invNo or id is missing from Firestore snapshot
        try {
          const localInvoices = getInitialInvoices();
          if (localInvoices.length > 0) {
            const existingIds = new Set(firestoreInvoices.map((inv) => inv.id));
            const existingInvNos = new Set(
              firestoreInvoices.map((inv) => (inv.invNo || '').trim().toLowerCase()).filter(Boolean)
            );

            const lostInvoices = localInvoices.filter((loc) => {
              if (!loc) return false;
              const hasMatchingId = loc.id && existingIds.has(loc.id);
              const locNo = (loc.invNo || '').trim().toLowerCase();
              const hasMatchingNo = locNo && existingInvNos.has(locNo);
              // If neither id nor invNo exists in Firestore, it was lost or unsynced
              return !hasMatchingId && !hasMatchingNo;
            });

            if (lostInvoices.length > 0 && db) {
              console.info(`[BillingRescue] Rescuing ${lostInvoices.length} local invoice(s) missing from Firestore...`);
              await Promise.all(
                lostInvoices.map((inv) => {
                  const targetId = inv.id || uid('inv');
                  const payload = { ...inv, id: targetId };
                  return setDoc(doc(db, COLLECTIONS.INVOICES, targetId), payload, { merge: true });
                })
              );
            }
          }
        } catch (e) {
          console.warn('[BillingRescue] Local invoice recovery notice:', e);
        }

        setInvoicesState(firestoreInvoices);
        setIsLoaded(true);
      },
      (err) => {
        console.error('Error subscribing to invoices collection:', err);
        setIsLoaded(true);
      }
    );
    return () => unsubscribe();
  }, []);

  // Sync with global company settings updates
  useEffect(() => {
    const handleCompanyUpdate = (e: any) => {
      if (e.detail) {
        const updatedComp: CompanySettings = e.detail;
        setSettingsState((prev) => ({
          ...prev,
          companyName: updatedComp.companyName,
          tagline: updatedComp.tagline,
          gstin: updatedComp.gstin,
          phone: updatedComp.phone,
          email: updatedComp.email,
          address: updatedComp.address,
          logo: updatedComp.logo,
          bank: {
            name: updatedComp.bank.name,
            acc: updatedComp.bank.acc,
            accName: updatedComp.bank.accName,
            ifsc: updatedComp.bank.ifsc,
            upi: updatedComp.bank.upi,
            branch: updatedComp.bank.branch
          }
        }));
      }
    };
    window.addEventListener((COMPANY_STORAGE_KEYS as any).updateEvent || 'solarithm_company_settings_updated', handleCompanyUpdate);
    return () => window.removeEventListener((COMPANY_STORAGE_KEYS as any).updateEvent || 'solarithm_company_settings_updated', handleCompanyUpdate);
  }, []);

  const saveSettings = useCallback((newSettings: InvoiceSettings) => {
    setSettingsState(newSettings);
    try {
      localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(newSettings));
    } catch (e) {
      console.error('Error saving settings to localStorage:', e);
    }
  }, []);

  const saveInvoices = useCallback(
    (newInvoices: InvoiceData[]) => {
      setInvoicesState(newInvoices);
      try {
        localStorage.setItem('invoices', JSON.stringify(newInvoices));
        localStorage.setItem('billing', JSON.stringify(newInvoices));
        localStorage.setItem(STORAGE_KEYS.invoices, JSON.stringify(newInvoices));
      } catch (e) {
        console.error('Error mirroring invoices to localStorage:', e);
      }
      // Note: Targeted Firestore updates are executed by saveCurrentDraft, updateInvoiceStatus,
      // and deleteInvoice. Full-collection batch overwrites have been permanently removed.
    },
    []
  );

  const startNewInvoice = useCallback(() => {
    const company = typeof window !== 'undefined' ? getInitialCompanySettings() : defaultCompanySettings();
    const fresh = blankInvoice(settings, company);
    setCurrentInvoice(fresh);
    setIsDirty(false);
    return fresh;
  }, [settings]);

  const loadInvoice = useCallback((id: string) => {
    const found = invoices.find((x) => x.id === id);
    if (!found) return null;
    const copy: InvoiceData = JSON.parse(JSON.stringify(found));
    copy._isNew = false;
    const company = typeof window !== 'undefined' ? getInitialCompanySettings() : defaultCompanySettings();
    if (company?.bank) {
      copy.bank = {
        name: (company.bank.name || copy.bank?.name || '').trim(),
        acc: (company.bank.acc || copy.bank?.acc || '').trim(),
        accName: (company.bank.accName || copy.bank?.accName || '').trim(),
        ifsc: (company.bank.ifsc || copy.bank?.ifsc || '').toUpperCase().trim(),
        upi: (company.bank.upi || copy.bank?.upi || '').trim(),
        branch: (company.bank.branch || copy.bank?.branch || '').trim()
      };
    }
    setCurrentInvoice(copy);
    setIsDirty(false);
    return copy;
  }, [invoices]);

  const duplicateInvoice = useCallback(() => {
    if (currentInvoice._isNew) return null;
    const copy: InvoiceData = JSON.parse(JSON.stringify(currentInvoice));
    copy.id = uid('inv');
    copy._isNew = true;
    copy.invNo = settings.nextInvNo;
    copy.status = 'PENDING';
    copy.amountReceived = 0;
    copy.invDate = todayISO();
    copy.invDue = addDaysISO(todayISO(), 7);
    copy.rows = copy.rows.map((r) => ({ ...r, id: uid('row') }));
    copy.createdAt = new Date().toISOString();
    copy.updatedAt = new Date().toISOString();
    setCurrentInvoice(copy);
    setIsDirty(true);
    return copy;
  }, [currentInvoice, settings.nextInvNo]);

  const saveCurrentDraft = useCallback(
    (invoiceToSave: InvoiceData) => {
      const totals = calculateInvoiceTotals(
        invoiceToSave.rows,
        invoiceToSave.sgst,
        invoiceToSave.cgst,
        invoiceToSave.igst,
        invoiceToSave.advance
      );

      // Point 2: Overwrite Prevention Check
      // If invoiceToSave.id exists, but its invNo does not match the invoice originally
      // stored under that ID, the user created a new invoice without clicking '+ New'.
      // In that case, generate a new id so it never overwrites the previously saved invoice.
      let effectiveId = invoiceToSave.id || uid('inv');
      const existingDoc = invoices.find((inv) => inv.id === effectiveId);
      if (
        existingDoc &&
        existingDoc.invNo &&
        invoiceToSave.invNo &&
        existingDoc.invNo.trim().toLowerCase() !== invoiceToSave.invNo.trim().toLowerCase()
      ) {
        effectiveId = uid('inv');
      }

      const data: InvoiceData = {
        ...invoiceToSave,
        id: effectiveId,
        totals,
        updatedAt: new Date().toISOString()
      };

      if (data._isNew || effectiveId !== invoiceToSave.id) {
        if (data.invNo === settings.nextInvNo) {
          const next = generateNextInvoiceNumber(settings.nextInvNo);
          const updatedSettings = { ...settings, nextInvNo: next };
          saveSettings(updatedSettings);
        }
        delete data._isNew;
      }

      const updatedInvoices = [...invoices];
      const idx = updatedInvoices.findIndex((inv) => inv.id === data.id);
      if (idx >= 0) {
        updatedInvoices[idx] = data;
      } else {
        updatedInvoices.push(data);
      }

      setInvoicesState(updatedInvoices);
      try {
        localStorage.setItem('invoices', JSON.stringify(updatedInvoices));
        localStorage.setItem('billing', JSON.stringify(updatedInvoices));
        localStorage.setItem(STORAGE_KEYS.invoices, JSON.stringify(updatedInvoices));
      } catch (e) {
        console.error('Error mirroring invoices to localStorage:', e);
      }

      // Write only the single changed document -- avoids rewriting every invoice in Firestore
      setDoc(doc(db, COLLECTIONS.INVOICES, data.id), data, { merge: true }).catch((e) =>
        console.error('Error saving invoice to Firestore:', e)
      );

      setCurrentInvoice(data);
      setIsDirty(false);
      return data;
    },
    [invoices, settings, saveSettings]
  );

  const deleteInvoice = useCallback(
    (id: string) => {
      const updated = invoices.filter((x) => x.id !== id);
      setInvoicesState(updated);
      try {
        localStorage.setItem('invoices', JSON.stringify(updated));
        localStorage.setItem('billing', JSON.stringify(updated));
        localStorage.setItem(STORAGE_KEYS.invoices, JSON.stringify(updated));
      } catch (e) {
        console.error('Error updating local storage on delete:', e);
      }

      // Mutate ONLY the single deleted document
      if (db && id) {
        deleteDoc(doc(db, COLLECTIONS.INVOICES, id)).catch((err) =>
          console.error('[useBillingState] Error deleting invoice doc:', err)
        );
      }

      if (currentInvoice.id === id) {
        setCurrentInvoice(blankInvoice(settings));
        setIsDirty(false);
      }
    },
    [invoices, currentInvoice.id, settings]
  );

  const updateInvoiceStatus = useCallback(
    (id: string, newStatus: string, amountReceived?: number, knownProjects: any[] = []) => {
      setInvoicesState((prev) => {
        const updatedInvoices = prev.map((inv) => {
          if (inv.id === id) {
            const updated: InvoiceData = {
              ...inv,
              status: newStatus,
              updatedAt: new Date().toISOString()
            };
            if (amountReceived !== undefined && !isNaN(amountReceived)) {
              updated.amountReceived = amountReceived;
            }
            return updated;
          }
          return inv;
        });

        try {
          localStorage.setItem(STORAGE_KEYS.invoices, JSON.stringify(updatedInvoices));
        } catch (e) {
          console.error('Error mirroring invoice status locally:', e);
        }

        return updatedInvoices;
      });

      const nowIsoStr = new Date().toISOString();
      const firestoreUpdate: Record<string, any> = { status: newStatus, updatedAt: nowIsoStr };
      if (amountReceived !== undefined && !isNaN(amountReceived)) {
        firestoreUpdate.amountReceived = amountReceived;
      }
      if (newStatus === 'PAID') {
        firestoreUpdate.paymentDate = nowIsoStr;
        firestoreUpdate.salesIncentiveStatus = 'ELIGIBLE';
      } else {
        firestoreUpdate.salesIncentiveStatus = 'PENDING';
      }

      if (db) {
        updateDoc(doc(db, COLLECTIONS.INVOICES, id), firestoreUpdate).catch((e) =>
          console.error('Error updating invoice status in Firestore:', e)
        );
      }

      const matchingInv = invoicesRef.current.find((x) => x.id === id);
      if (matchingInv && knownProjects.length > 0) {
        syncInvoiceProjectsToFirestore({ ...matchingInv, status: newStatus }, newStatus, knownProjects).catch((e) =>
          console.warn('Error syncing projects in updateInvoiceStatus:', e)
        );
      }

      setCurrentInvoice((curr) => {
        if (curr.id === id) {
          const copy = { ...curr, status: newStatus };
          if (amountReceived !== undefined && !isNaN(amountReceived)) {
            copy.amountReceived = amountReceived;
          }
          return copy;
        }
        return curr;
      });
    },
    []
  );

  /**
   * Atomic two-way sync: logs a payment against an invoice and updates that
   * invoice's status/amountReceived in a single Firestore transaction.
   */
  const logRevenueForInvoice = useCallback(
    async (
      invoiceId: string,
      newAmountReceivedTotal: number,
      meta?: { note?: string; loggedBy?: string },
      knownProjects: any[] = []
    ) => {
      if (!invoiceId || isNaN(newAmountReceivedTotal) || newAmountReceivedTotal < 0) {
        throw new Error('A valid invoice and a non-negative amount received are required to log revenue.');
      }

      const invoiceRef = doc(db, COLLECTIONS.INVOICES, invoiceId);
      const incomeRef = doc(collection(db, COLLECTIONS.INCOMES));

      const result = await runTransaction(db, async (tx) => {
        const invoiceSnap = await tx.get(invoiceRef);
        if (!invoiceSnap.exists()) {
          throw new Error("Invoice not found in Firestore yet -- it may still be syncing. Please try again shortly.");
        }
        const invoiceData = invoiceSnap.data() as InvoiceData;
        const payable = Number(invoiceData.totals?.payable || 0);
        const previouslyReceived = Number(invoiceData.amountReceived || 0);
        const delta = Math.max(0, newAmountReceivedTotal - previouslyReceived);
        const newStatus = payable > 0 && newAmountReceivedTotal >= payable ? 'PAID' : 'PARTIALLY_PAID';
        const nowIso = new Date().toISOString();

        const invoiceUpdates: Record<string, any> = {
          amountReceived: newAmountReceivedTotal,
          status: newStatus,
          updatedAt: nowIso
        };
        if (newStatus === 'PAID') {
          invoiceUpdates.paymentDate = nowIso;
          if (invoiceData.salesPersonEmail && (invoiceData.invoiceType === 'PACKAGE_RETAINER' || invoiceData.invoiceType === 'PACKAGE_RENEWAL' || invoiceData.salesIncentiveAmount)) {
            invoiceUpdates.salesIncentiveStatus = 'ELIGIBLE';
          }
        } else {
          if (invoiceData.salesIncentiveAmount) {
            invoiceUpdates.salesIncentiveStatus = 'PENDING';
          }
        }
        tx.update(invoiceRef, invoiceUpdates);

        tx.set(incomeRef, {
          id: incomeRef.id,
          invoiceId,
          invoiceNo: invoiceData.invNo || null,
          clientName: invoiceData.client?.name || null,
          amount: delta,
          runningAmountReceived: newAmountReceivedTotal,
          loggedAt: nowIso,
          note: meta?.note || '',
          loggedBy: meta?.loggedBy || null
        });

        return { newStatus, newAmountReceived: newAmountReceivedTotal };
      });

      // Optimistic local mirror
      setInvoicesState((prev) =>
        prev.map((inv) =>
          inv.id === invoiceId
            ? { ...inv, status: result.newStatus, amountReceived: result.newAmountReceived }
            : inv
        )
      );
      setCurrentInvoice((curr) =>
        curr.id === invoiceId ? { ...curr, status: result.newStatus, amountReceived: result.newAmountReceived } : curr
      );

      const invToSync = invoicesRef.current.find((x) => x.id === invoiceId);
      if (invToSync && knownProjects.length > 0) {
        syncInvoiceProjectsToFirestore({ ...invToSync, status: result.newStatus }, result.newStatus, knownProjects).catch((e) =>
          console.warn('Error syncing projects in logRevenueForInvoice:', e)
        );
      }

      return result;
    },
    []
  );

  return {
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
  };
}
