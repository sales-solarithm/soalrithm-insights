'use client';
import React, { useState, useEffect } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '@/src/lib/firebase';
import { Loader2, AlertTriangle, Tags } from 'lucide-react';
import { COLLECTIONS } from '@/src/config/schema';

export default function PricingRules() {
  const [rules, setRules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let unsubscribePricing: () => void;

    try {
      unsubscribePricing = onSnapshot(
        collection(db, COLLECTIONS.PRICING_RULES),
        (snapshot) => {
          const pricingData = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
          }));
          setRules(pricingData);
          setLoading(false);
        },
        (err) => {
          console.error("Pricing sync error:", err);
          setError(err.message || 'Failed to sync pricing rules.');
          setLoading(false);
        }
      );
    } catch (err: any) {
      console.error("Firebase connection error:", err);
      setTimeout(() => {
        setError(err.message || 'Failed to connect to the database.');
        setLoading(false);
      }, 0);
    }

    return () => {
      if (unsubscribePricing) unsubscribePricing();
    };
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 bg-[#121212] text-[#D4AF37]">
        <Loader2 className="w-8 h-8 animate-spin mb-4" />
        <p className="text-sm font-medium">Loading Pricing Engine Rules...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 bg-[#121212]">
        <div className="bg-red-950/30 border border-red-500/50 p-6 rounded-xl text-center">
          <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-3" />
          <p className="text-red-200 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#1E1E1E] rounded-xl shadow-2xl overflow-hidden border border-[#333333] mt-8">
      <div className="px-6 py-5 border-b border-[#333333] flex items-center space-x-3 bg-[#121212]/50">
        <div className="p-2 bg-[#2A2A2A] rounded-lg">
          <Tags className="w-5 h-5 text-[#D4AF37]" />
        </div>
        <div>
          <h3 className="text-lg font-medium text-white">Pricing Engine Rules</h3>
          <p className="text-xs text-gray-500 mt-0.5">Read-only master configuration for cost and commission calculations.</p>
        </div>
      </div>

      {rules.length === 0 ? (
        <div className="text-center py-12">
          <Tags className="mx-auto h-10 w-10 text-gray-500 mb-3" />
          <h4 className="text-base font-medium text-gray-300">No pricing rules found</h4>
          <p className="text-sm text-gray-500 mt-1">Pricing tiers have not been configured in the database.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left whitespace-nowrap">
            <thead className="bg-[#121212]/50 border-b border-[#333333]">
              <tr className="text-gray-400 text-xs uppercase tracking-wider">
                <th className="py-4 px-6 font-semibold">Category / Tier</th>
                <th className="py-4 px-6 font-semibold text-right">Base Price</th>
                <th className="py-4 px-6 font-semibold text-right">Sales Comm (%)</th>
                <th className="py-4 px-6 font-semibold text-right">Designer Comm (%)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#333333]">
              {rules.map((rule) => {
                const formatCurrency = (val: number) =>
                  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(val);

                return (
                  <tr key={rule.id} className="hover:bg-[#2A2A2A] transition-colors">
                    <td className="py-4 px-6">
                      <span className="font-medium text-[#D4AF37]">
                        {rule.name || rule.category || rule.id}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-right text-gray-200 font-mono">
                      {formatCurrency(Number(rule.basePrice) || 0)}
                    </td>
                    <td className="py-4 px-6 text-right text-gray-200 font-mono">
                      {Number(rule.salesCommPercent) || 0}%
                    </td>
                    <td className="py-4 px-6 text-right text-gray-200 font-mono">
                      {Number(rule.designerCommPercent) || 0}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
