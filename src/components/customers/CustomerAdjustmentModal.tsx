/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { X, PlusCircle, MinusCircle, AlertCircle } from 'lucide-react';
import { Customer } from '../../types';
import { formatRs } from '../../lib/customerData';

interface CustomerAdjustmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  customer: Customer | null;
  onSaveAdjustment: (
    customer: Customer,
    type: 'DEBIT' | 'CREDIT',
    amount: number,
    reason: string,
    referenceNo?: string
  ) => void;
}

export default function CustomerAdjustmentModal({
  isOpen,
  onClose,
  customer,
  onSaveAdjustment
}: CustomerAdjustmentModalProps) {
  const [adjustmentType, setAdjustmentType] = useState<'DEBIT' | 'CREDIT'>('DEBIT');
  const [amount, setAmount] = useState<number | ''>('');
  const [reason, setReason] = useState('');
  const [referenceNo, setReferenceNo] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen || !customer) return null;

  const isDeposit = customer.customerType === 'Deposit';
  const numAmount = Number(amount) || 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (numAmount <= 0) {
      setErrorMsg('Please enter an adjustment amount greater than Rs. 0.00');
      return;
    }

    if (!reason.trim()) {
      setErrorMsg('Please enter a specific reason / authorization note for this adjustment.');
      return;
    }

    onSaveAdjustment(customer, adjustmentType, numAmount, reason.trim(), referenceNo.trim() || undefined);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-gray-200 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-slate-50/50">
          <div>
            <h2 className="text-base font-bold text-slate-900 font-sans">Manual Ledger Adjustment</h2>
            <p className="text-xs text-gray-500 font-sans">{customer.name} ({customer.id})</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-gray-400 hover:text-gray-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {errorMsg && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Current balance */}
          <div className="p-3 rounded-xl bg-gray-50 border border-gray-200 text-xs flex justify-between">
            <span className="text-gray-600 font-medium">Current Account Balance:</span>
            <span className="font-bold font-mono text-slate-900">
              {formatRs(isDeposit ? customer.depositBalance : customer.currentBalance)}
            </span>
          </div>

          {/* Type */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Adjustment Action</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setAdjustmentType('DEBIT')}
                className={`py-2 px-3 rounded-xl text-xs font-bold border flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  adjustmentType === 'DEBIT'
                    ? 'bg-rose-50 border-rose-400 text-rose-700 ring-2 ring-rose-500/20'
                    : 'bg-white border-gray-200 text-gray-600'
                }`}
              >
                <PlusCircle className="w-4 h-4 text-rose-600" />
                {isDeposit ? 'Debit (Deduct Deposit)' : 'Debit (Increase Debt)'}
              </button>

              <button
                type="button"
                onClick={() => setAdjustmentType('CREDIT')}
                className={`py-2 px-3 rounded-xl text-xs font-bold border flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  adjustmentType === 'CREDIT'
                    ? 'bg-emerald-50 border-emerald-400 text-emerald-700 ring-2 ring-emerald-500/20'
                    : 'bg-white border-gray-200 text-gray-600'
                }`}
              >
                <MinusCircle className="w-4 h-4 text-emerald-600" />
                {isDeposit ? 'Credit (Add Deposit)' : 'Credit (Reduce Debt)'}
              </button>
            </div>
          </div>

          {/* Amount */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Adjustment Amount (Rs.) *</label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400">Rs.</span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="0.00"
                className="w-full pl-9 pr-3 py-2 text-xs font-bold font-mono rounded-xl border border-gray-200 focus:ring-2 focus:ring-slate-900 focus:outline-none"
                required
              />
            </div>
          </div>

          {/* Reason */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Reason & Authorization Note *</label>
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Disputed invoice correction approved by manager"
              className="w-full px-3 py-2 text-xs rounded-xl border border-gray-200 focus:ring-2 focus:ring-slate-900 focus:outline-none resize-none"
              required
            />
          </div>

          {/* Reference */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Reference / Doc No</label>
            <input
              type="text"
              value={referenceNo}
              onChange={(e) => setReferenceNo(e.target.value)}
              placeholder="e.g. ADJ-2026-04"
              className="w-full px-3 py-2 text-xs font-mono rounded-xl border border-gray-200 focus:ring-2 focus:ring-slate-900 focus:outline-none"
            />
          </div>
        </form>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-end gap-2 bg-slate-50/50">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="px-4 py-1.5 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl shadow-2xs"
          >
            Post Adjustment
          </button>
        </div>
      </div>
    </div>
  );
}
