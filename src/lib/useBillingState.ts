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

export function blankInvoice(settings: InvoiceSettings, companyOverride?: CompanySettings): InvoiceData {
  const company = companyOverride || getInitialCompanySettings();
  const effectiveBank = company.bank || settings.bank;
  return {
    id: uid('inv'),
    _isNew: true,
    invNo: settings.nextInvNo || 'IN-SRD-2026-01',
    invDate: todayISO(),
    invDue: addDaysISO(todayISO(), 7),
    quotNo: '',
    status: 'draft',
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
    bank: Object.assign({}, effectiveBank),
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

  // Firestore is now the source of truth for invoices. On first load, any
  // invoice that only ever existed in this browser's localStorage is
  // additively merged into Firestore by ID -- existing Firestore invoices
  // are never overwritten, and local storage is never cleared
  // automatically, so no browser's historical invoices can be silently
  // lost even if several browsers each held different local invoices.
  useEffect(() => {
    const invoicesRef = collection(db, COLLECTIONS.INVOICES);

    const unsubscribe = onSnapshot(
      invoicesRef,
      async (snapshot) => {
        const firestoreInvoices = snapshot.docs.map((d) => d.data() as InvoiceData);

        if (!hasMigratedRef.current) {
          hasMigratedRef.current = true;
          try {
            const alreadyMigrated = localStorage.getItem('solarithm_billing_migrated_v1') === 'true';
            if (!alreadyMigrated) {
              const localInvoices = getInitialInvoices();
              const existingIds = new Set(firestoreInvoices.map((inv) => inv.id));
              const missing = localInvoices.filter((inv) => inv.id && !existingIds.has(inv.id));
              if (missing.length > 0) {
                await Promise.all(
                  missing.map((inv) => setDoc(doc(db, COLLECTIONS.INVOICES, inv.id), inv, { merge: true }))
                );
              }
              // Local copies are deliberately left in place -- this only
              // marks the one-time migration attempt as done so it does not
              // repeat needlessly on every load.
              localStorage.setItem('solarithm_billing_migrated_v1', 'true');
            }
          } catch (e) {
            console.error('Error migrating local invoices to Firestore:', e);
          }
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
          bank: { ...prev.bank, ...updatedComp.bank }
        }));
      }
    };

    window.addEventListener('solarithm_company_settings_changed', handleCompanyUpdate);
    return () => {
      window.removeEventListener('solarithm_company_settings_changed', handleCompanyUpdate);
    };
  }, []);

  const saveSettings = useCallback((newSettings: InvoiceSettings) => {
    setSettingsState(newSettings);
    try {
      const billingSpecifics = {
        signature: newSettings.signature,
        defaultGST: newSettings.defaultGST,
        terms: newSettings.terms,
        nextInvNo: newSettings.nextInvNo
      };
      localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(billingSpecifics));
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

      // Full reconcile against Firestore: upsert everything present in
      // newInvoices, and remove anything that existed before but was
      // dropped from this array (e.g. a bulk "clear all" action) -- so
      // Firestore never silently diverges from what the UI shows.
      (async () => {
        try {
          const batch = writeBatch(db);
          const newIds = new Set(newInvoices.filter((inv) => inv.id).map((inv) => inv.id));
          invoices.forEach((inv) => {
            if (inv.id && !newIds.has(inv.id)) {
              batch.delete(doc(db, COLLECTIONS.INVOICES, inv.id));
            }
          });
          newInvoices.forEach((inv) => {
            if (inv.id) {
              batch.set(doc(db, COLLECTIONS.INVOICES, inv.id), inv, { merge: true });
            }
          });
          await batch.commit();
        } catch (e) {
          console.error('Error syncing invoices to Firestore:', e);
        }
      })();
    },
    [invoices]
  );

  const updateInvoiceStatus = useCallback((id: string, newStatus: string, amountReceived?: number) => {
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

    const firestoreUpdate: Record<string, any> = { status: newStatus, updatedAt: new Date().toISOString() };
    if (amountReceived !== undefined && !isNaN(amountReceived)) {
      firestoreUpdate.amountReceived = amountReceived;
    }
    updateDoc(doc(db, COLLECTIONS.INVOICES, id), firestoreUpdate).catch((e) =>
      console.error('Error updating invoice status in Firestore:', e)
    );

    // Also sync currentInvoice if the currently open invoice is being edited
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
  }, []);

  /**
   * Atomic two-way sync: logs a payment against an invoice and updates that
   * invoice's status/amountReceived in a single Firestore transaction, so the
   * income ledger and the invoice can never drift out of sync with each
   * other. `newAmountReceivedTotal` matches the existing "Record Partial
   * Payment" modal's semantics -- it's the running total received on this
   * invoice (the modal's 25/50/75/100% presets are fractions of the total
   * payable), not a fresh incremental payment. The income document still
   * records the incremental delta, since that's the actual amount received
   * in this transaction.
   */
  const logRevenueForInvoice = useCallback(
    async (invoiceId: string, newAmountReceivedTotal: number, meta?: { note?: string; loggedBy?: string }) => {
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
        const newStatus = payable > 0 && newAmountReceivedTotal >= payable ? 'paid' : 'partially paid';
        const nowIso = new Date().toISOString();

        tx.update(invoiceRef, {
          amountReceived: newAmountReceivedTotal,
          status: newStatus,
          updatedAt: nowIso
        });

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

      // Optimistic local mirror -- the live onSnapshot listener will confirm
      // this shortly after, so this just avoids a visible flicker/delay.
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

      return result;
    },
    []
  );

  const saveCurrentDraft = useCallback(
    (invoiceToSave: InvoiceData) => {
      const totals = calculateInvoiceTotals(
        invoiceToSave.rows,
        invoiceToSave.sgst,
        invoiceToSave.cgst,
        invoiceToSave.igst,
        invoiceToSave.advance
      );

      const data: InvoiceData = {
        ...invoiceToSave,
        totals,
        updatedAt: new Date().toISOString()
      };

      if (data._isNew) {
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

      // Write only the single changed document -- avoids rewriting every
      // invoice in Firestore on every draft save.
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
      saveInvoices(updated);
      if (currentInvoice.id === id) {
        setCurrentInvoice(blankInvoice(settings));
        setIsDirty(false);
      }
    },
    [invoices, currentInvoice.id, settings, saveInvoices]
  );

  const startNewInvoice = useCallback(() => {
    const fresh = blankInvoice(settings);
    setCurrentInvoice(fresh);
    setIsDirty(false);
    return fresh;
  }, [settings]);

  const loadInvoice = useCallback((id: string) => {
    const found = invoices.find((x) => x.id === id);
    if (!found) return null;
    const copy: InvoiceData = JSON.parse(JSON.stringify(found));
    copy._isNew = false;
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
    copy.status = 'draft';
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
