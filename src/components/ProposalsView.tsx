'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { 
  collection, 
  onSnapshot, 
  doc, 
  updateDoc, 
  addDoc, 
  deleteDoc
} from 'firebase/firestore';
import { db } from '@/src/lib/firebase';
import { 
  FileText, 
  Plus, 
  Search, 
  Trash2, 
  X
} from 'lucide-react';
import { COLLECTIONS } from '@/src/config/schema';
import { parseSafeDate, formatSafeDate } from '@/src/lib/projectUtils';

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
    status: 'approved'
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
    status: 'approved'
  },
  {
    id: 'sol_jly_2026_t3',
    proposalNumber: 'SOL-JLY-2026-T3',
    pricingCategory: 'T3',
    createdAt: '2026-09-15T16:45:52.914Z',
    status: 'approved'
  },
  {
    id: 'sol_jly_2026_t4',
    proposalNumber: 'SOL-JLY-2026-T4',
    pricingCategory: 'T4',
    createdAt: '2026-09-15T16:46:00.266Z',
    status: 'approved'
  },
  {
    id: 'sol_jly_2026_t5',
    proposalNumber: 'SOL-JLY-2026-T5',
    pricingCategory: 'T5',
    createdAt: '2026-09-15T16:46:06.944Z',
    status: 'approved'
  },
  {
    id: 'sol_jly_2026_t6',
    proposalNumber: 'SOL-JLY-2026-T6',
    pricingCategory: 'T6',
    createdAt: '2026-09-26T07:27:17.185Z',
    status: 'approved'
  }
];

/**
 * Format Date to standard DD/MM/YYYY using safe date resolution
 */
function formatProposalDate(dateVal: any): string {
  if (!dateVal) return '—';
  const d = parseSafeDate(dateVal);
  if (!d) return '—';
  return formatSafeDate(d, 'slash');
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
  return upper;
}

export type ProposalStatusCategory = 'all' | 'approved' | 'pending' | 'draft';

export function normalizeProposalStatus(status: any): 'approved' | 'pending' | 'draft' | 'rejected' {
  const s = String(status || '').toLowerCase().trim();
  if (s === 'approved' || s === 'won' || s === 'accepted') return 'approved';
  if (s === 'pending' || s === 'sent') return 'pending';
  if (s === 'draft') return 'draft';
  if (s === 'rejected' || s === 'lost') return 'rejected';
  // Standard default for unassigned proposals
  return 'approved';
}

export default function ProposalsView({
  proposals: propProposals,
  clients: _clients = [],
  projects: _projects = [],
  pricingRules: _pricingRules = [],
  onNavigateToProjects: _onNavigateToProjects,
  onNavigateToBilling: _onNavigateToBilling,
  onNavigateToPricing: _onNavigateToPricing
}: ProposalsViewProps) {
  const [proposals, setProposals] = useState<any[]>(() => 
    propProposals && propProposals.length > 0 ? propProposals : FALLBACK_PROPOSALS
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<ProposalStatusCategory>('all');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // New Proposal Form State
  const [newPropNumber, setNewPropNumber] = useState('');
  const [newPropCategory, setNewPropCategory] = useState('T1');
  const [newPropStatus, setNewPropStatus] = useState<'pending' | 'approved'>('approved');

  // Query directly from Firestore proposals collection with real-time onSnapshot
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
              const da = a.createdAt ? (parseSafeDate(a.createdAt)?.getTime() || 0) : 0;
              const dbTime = b.createdAt ? (parseSafeDate(b.createdAt)?.getTime() || 0) : 0;
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
      console.warn('[ProposalsView] Error setting up listener:', e);
    }

    return () => {
      if (unsub) unsub();
    };
  }, [propProposals]);

  // Inline status updater for Proposals Directory
  const handleUpdateStatus = async (proposal: any, nextStatus: string) => {
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
        setProposals((prev) => [{ id: `prop_${Date.now()}`, ...newRecord }, ...prev]);
      }
      setIsCreateModalOpen(false);
      setNewPropNumber('');
      setNewPropCategory('T1');
      setNewPropStatus('approved');
    } catch (err) {
      console.error('[ProposalsView] Failed to add proposal:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredProposals = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return proposals.filter((p) => {
      const pNum = String(p.proposalNumber || p.id || '').toLowerCase();
      const pCat = String(p.pricingCategory || p.category || '').toLowerCase();
      const normStatus = normalizeProposalStatus(p.status);

      // Status tab filter
      if (statusFilter === 'approved' && normStatus !== 'approved') return false;
      if (statusFilter === 'pending' && normStatus !== 'pending') return false;
      if (statusFilter === 'draft' && normStatus !== 'draft') return false;

      // Text search
      if (q && !pNum.includes(q) && !pCat.includes(q)) {
        return false;
      }
      return true;
    });
  }, [proposals, searchQuery, statusFilter]);

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

        {/* Search & Filter Toolbar with Filter Tabs */}
        <div className="p-4 border-b border-gray-100 dark:border-[#2A2A2A] flex flex-col md:flex-row md:items-center md:justify-between gap-3 bg-white dark:bg-[#1E1E1E]">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 flex-1">
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

            {/* Filter Tabs: All | Approved / Won | Pending | Draft / Sent */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {[
                { id: 'all', label: 'All Proposals' },
                { id: 'approved', label: 'Approved / Won' },
                { id: 'pending', label: 'Pending' },
                { id: 'draft', label: 'Draft / Sent' }
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setStatusFilter(tab.id as ProposalStatusCategory)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    statusFilter === tab.id
                      ? 'bg-[#D4AF37] text-black shadow-sm font-bold'
                      : 'bg-gray-100 dark:bg-[#2A2A2A] text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-[#333333]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs font-medium text-gray-500 dark:text-gray-400 self-end sm:self-auto">
            <span>Showing: <strong className="text-gray-900 dark:text-white font-mono">{filteredProposals.length}</strong> of <span className="font-mono">{proposals.length}</span> proposals</span>
          </div>
        </div>

        {/* Clean Proposals Directory Table with Status and Actions */}
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
                  STATUS
                </th>
                <th scope="col" className="py-3.5 px-6 font-semibold">
                  DATE CREATED
                </th>
                <th scope="col" className="py-3.5 px-6 font-semibold text-right">
                  ACTIONS
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-[#282828]">
              {filteredProposals.length > 0 ? (
                filteredProposals.map((item) => {
                  const propNum = item.proposalNumber || item.id || 'SOL-PROP';
                  const tierDisplay = formatCategoryTier(item.pricingCategory || item.category);
                  const dateDisplay = formatProposalDate(item.createdAt || item.date || item.proposalDate);
                  const normStatus = normalizeProposalStatus(item.status);

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
                        <span className="px-2.5 py-1 rounded-lg bg-gray-100 dark:bg-[#252525] border border-gray-200 dark:border-[#333333] text-gray-900 dark:text-gray-200 font-mono">
                          {tierDisplay}
                        </span>
                      </td>

                      {/* 3. STATUS (Inline Dropdown with standardized badges) */}
                      <td className="py-4 px-6">
                        <select
                          value={normStatus}
                          onChange={(e) => handleUpdateStatus(item, e.target.value)}
                          className={`text-xs font-semibold px-2.5 py-1 rounded-lg border cursor-pointer focus:outline-none transition-colors ${
                            normStatus === 'approved'
                              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                              : normStatus === 'pending'
                              ? 'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-[#D4AF37]'
                              : normStatus === 'draft'
                              ? 'bg-gray-100 dark:bg-[#2A2A2A] border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300'
                              : 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          <option value="approved" className="bg-white dark:bg-[#1E1E1E] text-gray-900 dark:text-white">Approved</option>
                          <option value="pending" className="bg-white dark:bg-[#1E1E1E] text-gray-900 dark:text-white">Pending</option>
                          <option value="draft" className="bg-white dark:bg-[#1E1E1E] text-gray-900 dark:text-white">Draft</option>
                          <option value="rejected" className="bg-white dark:bg-[#1E1E1E] text-gray-900 dark:text-white">Rejected</option>
                        </select>
                      </td>

                      {/* 4. DATE CREATED */}
                      <td className="py-4 px-6 text-gray-500 dark:text-gray-400 font-mono">
                        {dateDisplay}
                      </td>

                      {/* 5. ACTIONS */}
                      <td className="py-4 px-6 text-right">
                        <button
                          onClick={() => handleDeleteProposal(item.id)}
                          className="p-1.5 text-gray-400 hover:text-rose-500 dark:hover:text-rose-400 rounded-lg transition-colors cursor-pointer"
                          title="Delete Proposal"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-gray-500">
                    <div className="flex flex-col items-center justify-center space-y-2">
                      <FileText className="w-8 h-8 text-gray-400" />
                      <p className="text-sm font-medium">No matching proposals found</p>
                      <p className="text-xs text-gray-400">
                        Try adjusting your search query or selecting a different status filter tab.
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Create New Proposal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-[#2A2A2A] bg-gray-50/50 dark:bg-[#151515]">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-[#D4AF37]" />
                <h3 className="text-base font-bold text-gray-900 dark:text-white">
                  Add Proposal Record
                </h3>
              </div>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-white p-1 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateProposal} className="p-5 space-y-4 text-xs">
              <div>
                <label className="block text-gray-700 dark:text-gray-300 font-semibold mb-1">
                  Proposal Number *
                </label>
                <input
                  type="text"
                  required
                  value={newPropNumber}
                  onChange={(e) => setNewPropNumber(e.target.value.toUpperCase())}
                  placeholder="e.g. SOL-OCT-2026-T1"
                  className="w-full bg-gray-50 dark:bg-[#121212] border border-gray-300 dark:border-[#333333] rounded-lg px-3 py-2 text-gray-900 dark:text-white font-mono focus:border-[#D4AF37] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-gray-700 dark:text-gray-300 font-semibold mb-1">
                  Pricing Category / Tier *
                </label>
                <select
                  value={newPropCategory}
                  onChange={(e) => setNewPropCategory(e.target.value)}
                  className="w-full bg-gray-50 dark:bg-[#121212] border border-gray-300 dark:border-[#333333] rounded-lg px-3 py-2 text-gray-900 dark:text-white font-mono focus:border-[#D4AF37] focus:outline-none cursor-pointer"
                >
                  <option value="T1">T1 (Standard Residential / Commercial)</option>
                  <option value="T2">T2 (Elevated / Industrial)</option>
                  <option value="T3">T3 (Premium Enterprise)</option>
                  <option value="T4">T4 (High Volume Turnkey)</option>
                  <option value="T5">T5 (Strategic Corporate)</option>
                  <option value="T6">T6 (Custom Utility)</option>
                  <option value="T7K">T7k (Special Scale)</option>
                  <option value="T0 BHIMANI">T0 Bhimani (Dedicated Client Tier)</option>
                </select>
              </div>

              <div>
                <label className="block text-gray-700 dark:text-gray-300 font-semibold mb-1">
                  Initial Status
                </label>
                <select
                  value={newPropStatus}
                  onChange={(e) => setNewPropStatus(e.target.value as any)}
                  className="w-full bg-gray-50 dark:bg-[#121212] border border-gray-300 dark:border-[#333333] rounded-lg px-3 py-2 text-gray-900 dark:text-white focus:border-[#D4AF37] focus:outline-none cursor-pointer"
                >
                  <option value="approved">Approved</option>
                  <option value="pending">Pending</option>
                </select>
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-gray-200 dark:border-[#2A2A2A]">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-gray-100 dark:bg-[#2A2A2A] text-gray-700 dark:text-gray-300 font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-lg bg-[#D4AF37] hover:bg-[#c49f2c] text-black font-bold shadow-sm transition-all cursor-pointer disabled:opacity-50"
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
