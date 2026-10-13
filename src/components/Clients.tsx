'use client';
import React, { useState, useEffect } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '@/src/lib/firebase';
import { Loader2, AlertTriangle, Briefcase } from 'lucide-react';
import { COLLECTIONS, CLIENT_FIELDS, CLIENT_STATUS } from '@/src/config/schema';

export default function Clients() {
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let unsubscribeClients: (() => void) | undefined;

    try {
      unsubscribeClients = onSnapshot(
        collection(db, COLLECTIONS.CLIENTS),
        (snapshot) => {
          const clientsData = snapshot.docs.map((doc) => {
            const data = doc.data();
            return {
              id: doc.id,
              companyName: data[CLIENT_FIELDS.COMPANY_NAME] || data.companyName || 'Unknown Company',
              contactPerson: data[CLIENT_FIELDS.CONTACT_PERSON] || data.contactPerson || 'N/A',
              city: data[CLIENT_FIELDS.CITY] || data.city || 'N/A',
              salesPersonEmail: data[CLIENT_FIELDS.SALES_PERSON_EMAIL] || data.salesPersonEmail || 'N/A',
              status: data[CLIENT_FIELDS.STATUS] || data.status || 'unknown',
            };
          });

          // Filter only approved clients
          const approvedClients = clientsData.filter(
            (client) => client.status === CLIENT_STATUS.APPROVED || String(client.status).toLowerCase() === 'approved'
          );

          setClients(approvedClients);
          setLoading(false);
        },
        (err) => {
          console.error("Clients sync error:", err);
          setError(err.message || 'Failed to sync clients.');
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
      if (unsubscribeClients) unsubscribeClients();
    };
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 bg-white dark:bg-[#121212] text-[#D4AF37] transition-colors">
        <Loader2 className="w-8 h-8 animate-spin mb-4" />
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Loading Approved Clients...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 bg-white dark:bg-[#121212] transition-colors">
        <div className="bg-rose-50 dark:bg-red-950/30 border border-rose-300 dark:border-red-500/50 p-6 rounded-xl text-center">
          <AlertTriangle className="w-8 h-8 text-rose-500 mx-auto mb-3" />
          <p className="text-rose-700 dark:text-red-200 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-[#1E1E1E] rounded-xl shadow-sm overflow-hidden border border-gray-200 dark:border-[#333333] mt-8 transition-colors">
      <div className="px-6 py-5 border-b border-gray-200 dark:border-[#333333] flex items-center space-x-3 bg-gray-50/60 dark:bg-[#121212]/50">
        <div className="p-2 bg-gray-100 dark:bg-[#2A2A2A] rounded-lg">
          <Briefcase className="w-5 h-5 text-[#D4AF37]" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Approved Clients</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Read-only directory of verified and active clients.</p>
        </div>
      </div>

      {clients.length === 0 ? (
        <div className="text-center py-12">
          <Briefcase className="mx-auto h-10 w-10 text-gray-400 dark:text-gray-500 mb-3" />
          <h4 className="text-base font-semibold text-gray-700 dark:text-gray-300">No approved clients found</h4>
          <p className="text-sm text-gray-500 mt-1">Clients must be approved to appear in this directory.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left whitespace-nowrap">
            <thead className="bg-gray-50 dark:bg-[#121212]/50 border-b border-gray-200 dark:border-[#333333]">
              <tr className="text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">
                <th className="py-4 px-6 font-semibold">Company Name</th>
                <th className="py-4 px-6 font-semibold">Contact Person</th>
                <th className="py-4 px-6 font-semibold">City</th>
                <th className="py-4 px-6 font-semibold">Sales Person</th>
                <th className="py-4 px-6 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-[#333333]">
              {clients.map((client) => (
                <tr key={client.id} className="hover:bg-gray-50 dark:hover:bg-[#2A2A2A] transition-colors">
                  <td className="py-4 px-6">
                    <span className="font-semibold text-[#D4AF37]">
                      {client.companyName}
                    </span>
                  </td>
                  <td className="py-4 px-6 text-gray-800 dark:text-gray-200">
                    {client.contactPerson}
                  </td>
                  <td className="py-4 px-6 text-gray-700 dark:text-gray-300">
                    {client.city}
                  </td>
                  <td className="py-4 px-6 text-gray-700 dark:text-gray-300">
                    {client.salesPersonEmail}
                  </td>
                  <td className="py-4 px-6">
                    <span className="text-emerald-700 dark:text-green-500 bg-emerald-50 dark:bg-green-500/10 px-2.5 py-1 rounded text-xs font-semibold border border-emerald-200 dark:border-green-500/20">
                      Approved
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
