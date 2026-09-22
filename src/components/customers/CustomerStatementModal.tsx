/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { 
  X, FileText, Download, Printer, Plus, Search, Filter,
  Wallet, CreditCard, Fuel, ArrowDownRight, ArrowUpRight,
  Calendar, Car, Phone, Mail, Building2, User, RefreshCw
} from 'lucide-react';
import { Customer, CustomerLedgerEntry } from '../../types';
import { formatRs, formatLiters, formatDateTime, exportLedgerToCSV } from '../../lib/customerData';

interface CustomerStatementModalProps {
  isOpen: boolean;
  onClose: () => void;
  customer: Customer | null;
  ledgerEntries: CustomerLedgerEntry[];
  onOpenPaymentModal: (customer: Customer) => void;
  onOpenAdjustmentModal: (customer: Customer) => void;
}

export default function CustomerStatementModal({
  isOpen,
  onClose,
  customer,
  ledgerEntries,
  onOpenPaymentModal,
  onOpenAdjustmentModal
}: CustomerStatementModalProps) {
  const [filterType, setFilterType] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFilter, setDateFilter] = useState<'ALL' | '30DAYS' | 'THIS_MONTH'>('ALL');

  const isDeposit = customer?.customerType === 'Deposit';

  // Filter entries for this specific customer (always run hooks unconditionally)
  const customerEntries = useMemo(() => {
    if (!customer) return [];
    return ledgerEntries.filter(e => e.customerId === customer.id);
  }, [ledgerEntries, customer?.id]);

  // Sort descending by date
  const sortedEntries = useMemo(() => {
    return [...customerEntries].sort((a, b) => {
      const timeA = new Date(a.transactionDate || 0).getTime();
      const timeB = new Date(b.transactionDate || 0).getTime();
      return timeB - timeA;
    });
  }, [customerEntries]);

  // Apply filters
  const filteredEntries = useMemo(() => {
    let list = sortedEntries;

    // Type filter
    if (filterType === 'FUEL') {
      list = list.filter(e => e.transactionType === 'FUEL_DISPENSE');
    } else if (filterType === 'PAYMENT') {
      list = list.filter(e => e.transactionType === 'DEPOSIT_TOPUP' || e.transactionType === 'CREDIT_PAYMENT');
    } else if (filterType === 'ADJUSTMENT') {
      list = list.filter(e => e.transactionType === 'ADJUSTMENT');
    }

    // Date filter
    if (dateFilter === '30DAYS') {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      list = list.filter(e => new Date(e.transactionDate) >= thirtyDaysAgo);
    } else if (dateFilter === 'THIS_MONTH') {
      const now = new Date();
      list = list.filter(e => {
        const d = new Date(e.transactionDate);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      });
    }

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(e => 
        (e.description && e.description.toLowerCase().includes(q)) ||
        (e.referenceNo && e.referenceNo.toLowerCase().includes(q)) ||
        (e.vehicleNo && e.vehicleNo.toLowerCase().includes(q)) ||
        (e.fuelType && String(e.fuelType).toLowerCase().includes(q)) ||
        (e.notes && e.notes.toLowerCase().includes(q))
      );
    }

    return list;
  }, [sortedEntries, filterType, dateFilter, searchQuery]);

  if (!isOpen || !customer) return null;

  // Financial aggregates
  const totalDebits = customerEntries.reduce((sum, e) => sum + (Number(e.debit) || 0), 0);
  const totalCredits = customerEntries.reduce((sum, e) => sum + (Number(e.credit) || 0), 0);
  const totalFuelLiters = customerEntries.reduce((sum, e) => sum + (Number(e.liters) || 0), 0);

  const handleExportCSV = () => {
    exportLedgerToCSV(customer, sortedEntries);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 animate-in fade-in duration-150">
      <div 
        id="customer-statement-card" 
        className="bg-white rounded-2xl max-w-5xl w-full max-h-[95vh] shadow-2xl border border-gray-200 overflow-hidden flex flex-col"
      >
        {/* Statement Header Banner */}
        <div className="px-5 sm:px-6 py-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/70">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl text-white ${isDeposit ? 'bg-emerald-600' : 'bg-indigo-600'}`}>
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight font-sans">
                  Account Statement & Ledger
                </h2>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide ${
                  isDeposit 
                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' 
                    : 'bg-indigo-100 text-indigo-800 border border-indigo-200'
                }`}>
                  {isDeposit ? 'Advance Deposit' : 'Credit Facility'}
                </span>
              </div>
              <p className="text-xs text-gray-500 font-sans mt-0.5">
                Detailed transaction audit trail, fuel dispensations, and payments
              </p>
            </div>
          </div>

          {/* Quick Header Actions */}
          <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
            <button
              onClick={() => onOpenPaymentModal(customer)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold text-white shadow-2xs transition-all flex items-center gap-1.5 cursor-pointer ${
                isDeposit ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-indigo-600 hover:bg-indigo-700'
              }`}
            >
              <Plus className="w-3.5 h-3.5" />
              {isDeposit ? 'Top-up Deposit' : 'Receive Payment'}
            </button>

            <button
              onClick={() => onOpenAdjustmentModal(customer)}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer"
              title="Post manual debit or credit adjustment"
            >
              Adjustment
            </button>

            <button
              onClick={handleExportCSV}
              className="p-1.5 rounded-xl bg-white border border-gray-200 text-gray-600 hover:text-slate-900 hover:bg-gray-50 transition-colors cursor-pointer"
              title="Export statement as CSV"
            >
              <Download className="w-4 h-4" />
            </button>

            <button
              onClick={handlePrint}
              className="p-1.5 rounded-xl bg-white border border-gray-200 text-gray-600 hover:text-slate-900 hover:bg-gray-50 transition-colors cursor-pointer"
              title="Print Statement"
            >
              <Printer className="w-4 h-4" />
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer ml-1"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Customer Profile & Financial Summary Bar */}
        <div className="p-4 sm:p-5 border-b border-gray-100 bg-white grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Col 1: Customer Details */}
          <div className="md:col-span-1 space-y-1">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Account Profile</span>
            <div className="font-bold text-sm text-slate-900 flex items-center gap-1.5">
              {customer.category === 'Business' ? <Building2 className="w-4 h-4 text-slate-500" /> : <User className="w-4 h-4 text-slate-500" />}
              {customer.name}
            </div>
            <div className="text-xs text-gray-500 font-mono flex items-center gap-1">
              <Phone className="w-3 h-3 text-gray-400" />
              {customer.phone}
            </div>
            {customer.vehicleNumbers && customer.vehicleNumbers.length > 0 && (
              <div className="text-[11px] text-slate-600 font-mono truncate">
                Vehicles: {customer.vehicleNumbers.slice(0, 2).join(', ')}
                {customer.vehicleNumbers.length > 2 && ` +${customer.vehicleNumbers.length - 2}`}
              </div>
            )}
          </div>

          {/* Col 2: Current Balance Status */}
          <div className="p-3 rounded-xl bg-slate-50 border border-gray-200/80">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">
              {isDeposit ? 'Available Prepaid Deposit' : 'Outstanding Credit Balance'}
            </span>
            <div className={`text-lg sm:text-xl font-extrabold font-mono tabular-nums mt-0.5 ${
              isDeposit ? 'text-emerald-600' : 'text-slate-900'
            }`}>
              {formatRs(isDeposit ? customer.depositBalance : customer.currentBalance)}
            </div>
            <div className="text-[10px] text-gray-500 font-medium mt-0.5">
              {isDeposit ? 'Pool available for fuel' : `Limit: ${formatRs(customer.creditLimit)}`}
            </div>
          </div>

          {/* Col 3: Total Dispensed Fuel */}
          <div className="p-3 rounded-xl bg-slate-50 border border-gray-200/80">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">
              Total Fuel Dispensed
            </span>
            <div className="text-lg sm:text-xl font-extrabold font-mono tabular-nums text-slate-900 mt-0.5">
              {formatRs(totalDebits)}
            </div>
            <div className="text-[10px] text-gray-500 font-mono mt-0.5">
              {formatLiters(totalFuelLiters)} dispensed
            </div>
          </div>

          {/* Col 4: Total Received Settlements */}
          <div className="p-3 rounded-xl bg-slate-50 border border-gray-200/80">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">
              {isDeposit ? 'Total Deposits Added' : 'Total Payments Received'}
            </span>
            <div className="text-lg sm:text-xl font-extrabold font-mono tabular-nums text-emerald-600 mt-0.5">
              {formatRs(totalCredits)}
            </div>
            <div className="text-[10px] text-emerald-700 font-semibold mt-0.5">
              {sortedEntries.length} transaction entries
            </div>
          </div>
        </div>

        {/* Filter Toolbar */}
        <div className="px-4 sm:px-6 py-2.5 bg-gray-50/80 border-b border-gray-200/80 flex flex-wrap items-center justify-between gap-2.5">
          {/* Search within ledger */}
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search reference, vehicle, invoice #..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-white rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>

          {/* Type and Date Filters */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Transaction Type Filter */}
            <div className="flex rounded-xl border border-gray-200 bg-white p-0.5">
              <button
                type="button"
                onClick={() => setFilterType('ALL')}
                className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                  filterType === 'ALL' ? 'bg-slate-900 text-white' : 'text-gray-600 hover:text-slate-900'
                }`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setFilterType('FUEL')}
                className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                  filterType === 'FUEL' ? 'bg-slate-900 text-white' : 'text-gray-600 hover:text-slate-900'
                }`}
              >
                Fuel
              </button>
              <button
                type="button"
                onClick={() => setFilterType('PAYMENT')}
                className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                  filterType === 'PAYMENT' ? 'bg-slate-900 text-white' : 'text-gray-600 hover:text-slate-900'
                }`}
              >
                Payments
              </button>
              <button
                type="button"
                onClick={() => setFilterType('ADJUSTMENT')}
                className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                  filterType === 'ADJUSTMENT' ? 'bg-slate-900 text-white' : 'text-gray-600 hover:text-slate-900'
                }`}
              >
                Adj.
              </button>
            </div>

            {/* Date filter */}
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value as any)}
              className="px-2.5 py-1.5 bg-white border border-gray-200 rounded-xl text-xs font-semibold text-gray-700 focus:outline-none"
            >
              <option value="ALL">All Time</option>
              <option value="THIS_MONTH">This Month</option>
              <option value="30DAYS">Last 30 Days</option>
            </select>
          </div>
        </div>

        {/* Ledger Transaction Table */}
        <div className="overflow-y-auto flex-1 p-3 sm:p-6 no-scrollbar">
          {filteredEntries.length > 0 ? (
            <div className="border border-gray-200/90 rounded-xl overflow-hidden shadow-2xs">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50/90 border-b border-gray-200 text-gray-600 font-bold uppercase tracking-wider text-[10px]">
                    <th className="py-2.5 px-3">Date & Time</th>
                    <th className="py-2.5 px-3">Type</th>
                    <th className="py-2.5 px-3">Reference / Invoice</th>
                    <th className="py-2.5 px-3">Vehicle</th>
                    <th className="py-2.5 px-3">Description / Fuel</th>
                    <th className="py-2.5 px-3 text-right">Debit (Rs.)</th>
                    <th className="py-2.5 px-3 text-right">Credit (Rs.)</th>
                    <th className="py-2.5 px-3 text-right">Balance (Rs.)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 font-sans">
                  {filteredEntries.map((entry) => {
                    const isFuel = entry.transactionType === 'FUEL_DISPENSE';
                    const isPayment = entry.transactionType === 'DEPOSIT_TOPUP' || entry.transactionType === 'CREDIT_PAYMENT';
                    const isAdj = entry.transactionType === 'ADJUSTMENT';

                    return (
                      <tr key={entry.id} className="hover:bg-slate-50/60 transition-colors">
                        {/* Date & Time */}
                        <td className="py-2.5 px-3 font-mono text-[11px] text-gray-600 whitespace-nowrap">
                          {formatDateTime(entry.transactionDate)}
                        </td>

                        {/* Transaction Type */}
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          {isFuel && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-bold">
                              <Fuel className="w-3 h-3 text-amber-600" />
                              Fuel Dispense
                            </span>
                          )}
                          {isPayment && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-bold">
                              <ArrowDownRight className="w-3 h-3 text-emerald-600" />
                              {entry.transactionType === 'DEPOSIT_TOPUP' ? 'Deposit Top-up' : 'Payment Received'}
                            </span>
                          )}
                          {isAdj && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-purple-50 text-purple-800 border border-purple-200 text-[10px] font-bold">
                              Adjustment
                            </span>
                          )}
                          {entry.transactionType === 'INITIAL_DEPOSIT' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-50 text-blue-800 border border-blue-200 text-[10px] font-bold">
                              Account Setup
                            </span>
                          )}
                        </td>

                        {/* Reference / Chitty */}
                        <td className="py-2.5 px-3 font-mono font-bold text-slate-800 whitespace-nowrap">
                          {entry.referenceNo || '-'}
                        </td>

                        {/* Vehicle No */}
                        <td className="py-2.5 px-3 font-mono text-slate-700 whitespace-nowrap">
                          {entry.vehicleNo ? (
                            <span className="px-1.5 py-0.5 rounded bg-gray-100 text-slate-800 font-bold text-[10px]">
                              {entry.vehicleNo}
                            </span>
                          ) : (
                            <span className="text-gray-300">-</span>
                          )}
                        </td>

                        {/* Description / Fuel liters */}
                        <td className="py-2.5 px-3 text-slate-800 max-w-xs truncate" title={entry.description}>
                          <span className="font-medium">{entry.description}</span>
                          {entry.notes && (
                            <span className="block text-[10px] text-gray-400 truncate">{entry.notes}</span>
                          )}
                        </td>

                        {/* Debit */}
                        <td className="py-2.5 px-3 text-right font-mono font-bold tabular-nums text-rose-600 whitespace-nowrap">
                          {entry.debit > 0 ? formatRs(entry.debit) : '-'}
                        </td>

                        {/* Credit */}
                        <td className="py-2.5 px-3 text-right font-mono font-bold tabular-nums text-emerald-600 whitespace-nowrap">
                          {entry.credit > 0 ? formatRs(entry.credit) : '-'}
                        </td>

                        {/* Running Balance */}
                        <td className="py-2.5 px-3 text-right font-mono font-bold tabular-nums text-slate-900 whitespace-nowrap bg-slate-50/50">
                          {formatRs(entry.runningBalance)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-16 text-center border-2 border-dashed border-gray-200 rounded-xl">
              <FileText className="w-8 h-8 text-gray-300 mx-auto mb-2" />
              <p className="text-xs font-bold text-gray-600">No statement records match your criteria</p>
              <p className="text-[11px] text-gray-400 mt-0.5">
                Transactions are automatically generated when pumpers record credit/deposit sales or when payments are received.
              </p>
              <div className="mt-4 flex items-center justify-center gap-2">
                <button
                  onClick={() => onOpenPaymentModal(customer)}
                  className="px-3 py-1.5 bg-slate-900 text-white rounded-xl text-xs font-bold shadow-2xs hover:bg-slate-800 cursor-pointer"
                >
                  Record First Transaction
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 sm:px-6 py-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500 bg-slate-50/50">
          <span>Showing {filteredEntries.length} of {customerEntries.length} ledger entries</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
          >
            Close Statement
          </button>
        </div>
      </div>
    </div>
  );
}
