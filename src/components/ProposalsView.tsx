'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { 
  collection, 
  onSnapshot, 
  doc, 
  updateDoc, 
  addDoc, 
  deleteDoc,
  query,
  orderBy
} from 'firebase/firestore';
import { db } from '@/src/lib/firebase';
import { 
  FileText, 
  Plus, 
  Search, 
  Trash2, 
  X, 
  CheckCircle2, 
  Clock,
  Sparkles,
  ArrowUpDown
} from 'lucide-react';
import { COLLECTIONS } from '@/src/config/schema';

export interface ProposalsViewProps {
  proposals?: any[];
  clients?: any[];
  projects?: any[];
  pricingRules?: any[];
  onNavigateToProjects?: () => void;
  onNavigateToBilling?: () => void;
  onNavigateToPricing?: () => void;
}

// Fallback initial proposals
const FALLBACK_PROPOSALS = [
  {
    id: 'sol_apr_2026',
    proposalNumber: 'SOL-APR-2026',
    pricingCategory: 'T7K',
    createdAt: '2026-09-26T07:28:38.770Z',
    status: 'approved'
  },
  {
    id: 'sol_jly_2026_t0',
    proposalNumber: 'SOL-JLY-2026-T0',
    pricingCategory: 'T0 BHIMANI',
    createdAt: '2026-10-01T05:38:01.477Z',
    status: 'pending'
  },
  {
    id: 'sol_jly_2026_t1',
    proposalNumber: 'SOL-JLY-2026-T1',
    pricingCategory: 'T1',
    createdAt: '2026-09-15T16:45:29.223Z',
    status: 'approved'
  },
  {
    id: 'sol_jly_2026_t2',
    proposalNumber: 'SOL-JLY-2026-T2',
    pricingCategory: 'T2',
    createdAt: '2026-09-15T16:45:44.293Z',
    status: 'pending'
  },
  {
    id: 'sol_jly_2026_t3',
    proposalNumber: 'SOL-JLY-2026-T3',
    pricingCategory: 'T3',
    createdAt: '2026-09-15T16:45:52.914Z',
    status: 'pending'
  },
  {
    id: 'sol_jly_2026_t4',
    proposalNumber: 'SOL-JLY-2026-T4',
    pricingCategory: 'T4',
    createdAt: '2026-09-15T16:46:00.266Z',
    status: 'pending'
  },
  {
    id: 'sol_jly_2026_t5',
    proposalNumber: 'SOL-JLY-2026-T5',
    pricingCategory: 'T5',
    createdAt: '2026-09-15T16:46:06.944Z',
    status: 'pending'
  },
  {
    id: 'sol_jly_2026_t6',
    proposalNumber: 'SOL-JLY-2026-T6',
    pricingCategory: 'T6',
    createdAt: '2026-09-26T07:27:17.185Z',
    status: 'pending'
  }
];

/**
 * Format Date to exact M/D/YYYY (e.g., "9/26/2026")
 */
function formatMDYYYY(dateVal: any): string {
  if (!dateVal) return '—';
  let d: Date;
  if (dateVal?.toDate && typeof dateVal.toDate === 'function') {
    d = dateVal.toDate();
  } else if (typeof dateVal === 'string' || typeof dateVal === 'number') {
    d = new Date(dateVal);
  } else if (dateVal instanceof Date) {
    d = dateVal;
  } else {
    return '—';
  }

  if (isNaN(d.getTime())) return '—';
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const year = d.getFullYear();
  return `${month}/${day}/${year}`;
}

/**
 * Format Pricing Category / Tier (e.g., "T7k", "T0 Bhimani", "T1")
 */
function formatCategoryTier(val: string | undefined): string {
  if (!val) return '—';
  const clean = val.trim();
  const upper = clean.toUpperCase();

  if (upper.includes('BHIMANI')) {
    return 'T0 Bhimani';
  }
  if (upper === 'T7K') {
    return 'T7k';
  }
  if (upper.startsWith('T') && upper.length <= 4) {
    return upper;
  }
  return clean;
}

export default function ProposalsView({
  proposals: propProposals,
  pricingRules = [],
  onNavigateToProjects,
  onNavigateToBilling,
  onNavigateToPricing
}: ProposalsViewProps) {
  const [proposals, setProposals] = useState<any[]>(() => 
    propProposals && propProposals.length > 0 ? propProposals : FALLBACK_PROPOSALS
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // New Proposal Form State
  const [newPropNumber, setNewPropNumber] = useState('');
  const [newPropCategory, setNewPropCategory] = useState('T1');
  const [newPropStatus, setNewPropStatus] = useState<'pending' | 'approved'>('pending');

  // Query directly from Firestore proposals collection
  useEffect(() => {
    if (!db) return;

    let unsub: (() => void) | undefined;
    try {
      const q = collection(db, COLLECTIONS.PROPOSALS);
      unsub = onSnapshot(
        q,
        (snapshot) => {
          if (!snapshot.empty) {
            const items: any[] = snapshot.docs.map((docSnap) => ({
              id: docSnap.id,
              ...docSnap.data()
            }));
            // Sort by createdAt descending
            items.sort((a: any, b: any) => {
              const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
              const dbTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
              return dbTime - da;
            });
            setProposals(items);
          } else if (propProposals && propProposals.length > 0) {
            setProposals(propProposals);
          } else {
            setProposals(FALLBACK_PROPOSALS);
          }
        },
        (err) => {
          console.warn('[ProposalsView] Firestore listener error, using fallback:', err);
          if (propProposals && propProposals.length > 0) {
            setProposals(propProposals);
          }
        }
      );
    } catch (e) {
      console.warn('[ProposalsView] Setup error:', e);
    }

    return () => {
      if (unsub) unsub();
    };
  }, [propProposals]);

  // Toggle proposal status (Pending <-> Approved)
  const handleToggleStatus = async (proposal: any) => {
    const currentStatus = String(proposal.status || '').toLowerCase().trim();
    const nextStatus = currentStatus === 'approved' ? 'pending' : 'approved';

    // Optimistic UI update
    setProposals((prev) =>
      prev.map((p) => (p.id === proposal.id ? { ...p, status: nextStatus } : p))
    );

    if (db && proposal.id) {
      try {
        await updateDoc(doc(db, COLLECTIONS.PROPOSALS, proposal.id), {
          status: nextStatus,
          updatedAt: new Date().toISOString()
        });
      } catch (err) {
        console.warn('[ProposalsView] Failed to update status in Firestore:', err);
      }
    }
  };

  // Delete Proposal
  const handleDeleteProposal = async (proposalId: string) => {
    if (!confirm('Are you sure you want to remove this proposal record?')) return;

    setProposals((prev) => prev.filter((p) => p.id !== proposalId));

    if (db && proposalId) {
      try {
        await deleteDoc(doc(db, COLLECTIONS.PROPOSALS, proposalId));
      } catch (err) {
        console.warn('[ProposalsView] Failed to delete proposal from Firestore:', err);
      }
    }
  };

  // Create New Proposal
  const handleCreateProposal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPropNumber.trim()) return;

    setIsSubmitting(true);
    const newRecord = {
      proposalNumber: newPropNumber.trim().toUpperCase(),
      pricingCategory: newPropCategory.trim().toUpperCase(),
      category: newPropCategory.trim().toUpperCase(),
      status: newPropStatus,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    try {
      if (db) {
        const docRef = await addDoc(collection(db, COLLECTIONS.PROPOSALS), newRecord);
        setProposals((prev) => [{ id: docRef.id, ...newRecord }, ...prev]);
      } else {
        setProposals((prev) => [{ id: `local-${Date.now()}`, ...newRecord }, ...prev]);
      }
      setIsCreateModalOpen(false);
      setNewPropNumber('');
      setNewPropCategory('T1');
      setNewPropStatus('pending');
    } catch (err) {
      console.warn('[ProposalsView] Create proposal error:', err);
      setProposals((prev) => [{ id: `local-${Date.now()}`, ...newRecord }, ...prev]);
      setIsCreateModalOpen(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filtered proposals list - strictly verified, approved proposals only
  const filteredProposals = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return proposals.filter((p) => {
      const pNum = String(p.proposalNumber || p.id || '').toLowerCase();
      const pCat = String(p.pricingCategory || p.category || '').toLowerCase();
      const pStat = String(p.status || 'pending').toLowerCase().trim();

      // Strictly display verified, approved proposals only
      if (pStat !== 'approved') {
        return false;
      }

      if (q && !pNum.includes(q) && !pCat.includes(q)) {
        return false;
      }

      return true;
    });
  }, [proposals, searchQuery]);

  return (
    <div className="w-full space-y-6">
      {/* Dedicated Card: "Proposals Directory" */}
      <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] rounded-2xl shadow-sm overflow-hidden transition-colors">
        {/* Card Header: "Proposals Directory" */}
        <div className="p-5 sm:p-6 border-b border-gray-200 dark:border-[#333333] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-gray-50/50 dark:bg-[#141414]/50">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-gray-100 dark:bg-[#252525] text-[#D4AF37] border border-gray-200 dark:border-[#3A3A3A] shadow-inner">
              <FileText className="w-5 h-5 text-[#D4AF37]" />
            </div>
            <div>
              <h2 className="text-xl font-bold tracking-tight text-gray-900 dark:text-white">
                Proposals Directory
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Executive repository of standardized client proposal records and pricing categories.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setNewPropNumber(`SOL-${new Date().toLocaleString('en-US', { month: 'short' }).toUpperCase()}-${new Date().getFullYear()}`);
                setIsCreateModalOpen(true);
              }}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-[#D4AF37] hover:bg-[#c49f2c] active:bg-[#b59024] text-black shadow-sm transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>New Proposal</span>
            </button>
          </div>
        </div>

        {/* Search & Filter Toolbar */}
        <div className="p-4 border-b border-gray-100 dark:border-[#2A2A2A] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white dark:bg-[#1E1E1E]">
          <div className="relative w-full sm:max-w-xs">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by proposal number or tier..."
              className="w-full bg-gray-50 dark:bg-[#121212] border border-gray-300 dark:border-[#333333] rounded-xl pl-8 pr-3 py-2 text-xs text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/40 focus:border-[#D4AF37] transition-colors"
            />
          </div>

          <div className="flex items-center gap-2 text-xs font-medium text-gray-500 dark:text-gray-400">
            <span>Approved Proposals: <strong className="text-gray-900 dark:text-white font-mono">{filteredProposals.length}</strong></span>
          </div>
        </div>

        {/* Clean 4-Column Proposals Directory Table (Directive 5 / TAX-01) */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs whitespace-nowrap">
            <thead>
              <tr className="text-gray-500 dark:text-gray-400 text-[11px] uppercase tracking-wider border-b border-gray-200 dark:border-[#333333] bg-gray-50/70 dark:bg-[#141414]/70">
                <th scope="col" className="py-3.5 px-6 font-semibold">
                  PROPOSAL NUMBER
                </th>
                <th scope="col" className="py-3.5 px-6 font-semibold">
                  PRICING CATEGORY / TIER
                </th>
                <th scope="col" className="py-3.5 px-6 font-semibold">
                  DATE CREATED
                </th>

              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-[#282828]">
              {filteredProposals.length > 0 ? (
                filteredProposals.map((item) => {
                  const propNum = item.proposalNumber || item.id || 'SOL-PROP';
                  const tierDisplay = formatCategoryTier(item.pricingCategory || item.category);
                  const dateDisplay = formatMDYYYY(item.createdAt);
                  const isApproved = String(item.status || '').toLowerCase().trim() === 'approved';

                  return (
                    <tr 
                      key={item.id} 
                      className="hover:bg-gray-50/80 dark:hover:bg-[#222222]/80 transition-colors"
                    >
                      {/* 1. PROPOSAL NUMBER (in gold font) */}
                      <td className="py-4 px-6 font-mono font-bold text-sm tracking-wide text-[#D4AF37]">
                        {propNum}
                      </td>

                      {/* 2. PRICING CATEGORY / TIER */}
                      <td className="py-4 px-6 font-semibold text-gray-900 dark:text-white">
                        <span className="px-2.5 py-1 rounded-lg bg-gray-100 dark:bg-[#252525] border border-gray-200 dark:border-[#333333] text-gray-900 dark:text-gray-200">
                          {tierDisplay}
                        </span>
                      </td>

                      {/* 3. DATE CREATED (formatted M/D/YYYY, e.g. "9/26/2026") */}
                      <td className="py-4 px-6 font-mono text-gray-700 dark:text-gray-300">
                        {dateDisplay}
                      </td>


                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={3} className="py-12 text-center text-gray-500">
                    <FileText className="w-8 h-8 mx-auto text-gray-400 mb-2 opacity-50" />
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                      No matching proposals found
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Adjust your search criteria or create a new proposal record.
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Proposal Modal */}
      {isCreateModalOpen && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="relative w-full max-w-md bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] rounded-2xl shadow-2xl p-6 overflow-hidden">
            <button
              type="button"
              onClick={() => setIsCreateModalOpen(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-white p-1 rounded-lg cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-5">
              <div className="h-10 w-10 rounded-xl bg-[#D4AF37]/10 border border-[#D4AF37]/30 flex items-center justify-center text-[#D4AF37]">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-gray-900 dark:text-white">
                  Add Proposal Record
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Register a new proposal in the Proposals Directory
                </p>
              </div>
            </div>

            <form onSubmit={handleCreateProposal} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold uppercase text-gray-700 dark:text-gray-300 mb-1.5 tracking-wider">
                  Proposal Number
                </label>
                <input
                  type="text"
                  required
                  value={newPropNumber}
                  onChange={(e) => setNewPropNumber(e.target.value.toUpperCase())}
                  placeholder="e.g. SOL-OCT-2026-T1"
                  className="w-full bg-gray-50 dark:bg-[#121212] border border-gray-300 dark:border-[#333333] rounded-xl px-3 py-2.5 text-xs text-gray-900 dark:text-white font-mono font-bold focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/40 focus:border-[#D4AF37]"
                />
              </div>

              <div>
                <label className="block font-semibold uppercase text-gray-700 dark:text-gray-300 mb-1.5 tracking-wider">
                  Pricing Category / Tier
                </label>
                <select
                  value={newPropCategory}
                  onChange={(e) => setNewPropCategory(e.target.value)}
                  className="w-full bg-gray-50 dark:bg-[#121212] border border-gray-300 dark:border-[#333333] rounded-xl px-3 py-2.5 text-xs text-gray-900 dark:text-white font-semibold focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/40 focus:border-[#D4AF37] cursor-pointer"
                >
                  <option value="T1">T1</option>
                  <option value="T2">T2</option>
                  <option value="T3">T3</option>
                  <option value="T4">T4</option>
                  <option value="T5">T5</option>
                  <option value="T6">T6</option>
                  <option value="T7K">T7k</option>
                  <option value="T0 BHIMANI">T0 Bhimani</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold uppercase text-gray-700 dark:text-gray-300 mb-1.5 tracking-wider">
                  Initial Status
                </label>
                <select
                  value={newPropStatus}
                  onChange={(e) => setNewPropStatus(e.target.value as 'pending' | 'approved')}
                  className="w-full bg-gray-50 dark:bg-[#121212] border border-gray-300 dark:border-[#333333] rounded-xl px-3 py-2.5 text-xs text-gray-900 dark:text-white font-semibold focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/40 focus:border-[#D4AF37] cursor-pointer"
                >
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                </select>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-[#252525] font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-xl bg-[#D4AF37] hover:bg-[#c49f2c] active:bg-[#b59024] text-black font-bold shadow-sm transition-all cursor-pointer"
                >
                  {isSubmitting ? 'Saving...' : 'Save Proposal'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
