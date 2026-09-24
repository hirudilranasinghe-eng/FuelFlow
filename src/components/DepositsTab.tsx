/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import { 
  Landmark, Plus, Search, Filter, Calendar, Clock, User, 
  Receipt, FileText, Trash2, CheckCircle2, AlertCircle, 
  ArrowUpRight, DollarSign, RefreshCw, Download,
  Building2, Wallet, ArrowDownRight, ShieldCheck, Sparkles, X
} from 'lucide-react';
import { Shift, Employee, ShiftBankDeposit, AuthUser } from '../types';

interface DepositsTabProps {
  activeShift: Shift | null;
  shiftHistory: Shift[];
  employees: Employee[];
  bankDeposits: ShiftBankDeposit[];
  onAddDeposit: (deposit: Omit<ShiftBankDeposit, 'id' | 'created_at'>) => Promise<void> | void;
  onDeleteDeposit: (depositId: string, shiftId: string) => Promise<void> | void;
  user?: AuthUser | null;
  isLoading?: boolean;
}

const SRI_LANKAN_BANKS = [
  'Commercial Bank of Ceylon',
  'Bank of Ceylon (BOC)',
  'People\'s Bank',
  'Sampath Bank',
  'Hatton National Bank (HNB)',
  'Nations Trust Bank (NTB)',
  'Seylan Bank',
  'DFCC Bank',
  'National Development Bank (NDB)',
  'Pan Asia Bank',
  'Amana Bank',
  'Other / Cash Safe'
];

export default function DepositsTab({
  activeShift,
  shiftHistory,
  employees,
  bankDeposits,
  onAddDeposit,
  onDeleteDeposit,
  user,
  isLoading = false
}: DepositsTabProps) {
  // Modal State
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form State
  const [selectedShiftId, setSelectedShiftId] = useState<string>(activeShift?.id || '');
  const [amount, setAmount] = useState<string>('');
  const [bankName, setBankName] = useState<string>('Commercial Bank of Ceylon');
  const [customBankName, setCustomBankName] = useState<string>('');
  const [accountNumber, setAccountNumber] = useState<string>('');
  const [slipNo, setSlipNo] = useState<string>('');

  // Helper to resolve supervisor name for a shift
  const resolveSupervisorForShift = (shiftId?: string) => {
    const targetShift = shiftId 
      ? (activeShift?.id === shiftId ? activeShift : shiftHistory.find(s => s.id === shiftId))
      : activeShift;

    if (targetShift) {
      if ((targetShift as any).supervisor && typeof (targetShift as any).supervisor === 'string') {
        return (targetShift as any).supervisor;
      }
      if ((targetShift as any).supervisorName && typeof (targetShift as any).supervisorName === 'string') {
        return (targetShift as any).supervisorName;
      }
      if (targetShift.supervisorId) {
        const foundEmp = employees.find(e => e.id === targetShift.supervisorId);
        if (foundEmp) return foundEmp.name;
      }
    }
    return user?.name || 'Supervisor';
  };

  const [depositedBy, setDepositedBy] = useState<string>(() => resolveSupervisorForShift(activeShift?.id));

  // Dynamic list of active supervisors ONLY
  const supervisorOptions = useMemo(() => {
    const list: string[] = [];
    const activeShiftSupervisor = resolveSupervisorForShift(selectedShiftId || activeShift?.id);
    const addedNames = new Set<string>();

    // 1. Current Shift Supervisor (if known and valid)
    if (activeShiftSupervisor && activeShiftSupervisor !== 'Supervisor') {
      list.push(activeShiftSupervisor);
      addedNames.add(activeShiftSupervisor);
    }

    // 2. Supervisors strictly from employees list (role === 'Supervisor')
    const supervisors = employees.filter(e => e.role && e.role.toLowerCase() === 'supervisor');
    supervisors.forEach(s => {
      if (s.name && !addedNames.has(s.name)) {
        list.push(s.name);
        addedNames.add(s.name);
      }
    });

    // Fallback if list is empty
    if (list.length === 0) {
      const fallbackName = user?.name || activeShiftSupervisor || 'Supervisor';
      list.push(fallbackName);
    }

    return list;
  }, [employees, activeShift, selectedShiftId, user]);

  const [depositDateTime, setDepositDateTime] = useState<string>(() => {
    const now = new Date();
    // Local ISO format for datetime-local input
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().slice(0, 16);
  });
  const [notes, setNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Filters
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [filterShiftId, setFilterShiftId] = useState<string>('all');
  const [filterBank, setFilterBank] = useState<string>('all');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Sync default shift ID & supervisor if activeShift loads or changes
  useEffect(() => {
    if (activeShift) {
      if (!selectedShiftId) {
        setSelectedShiftId(activeShift.id);
      }
      const supervisorName = resolveSupervisorForShift(selectedShiftId || activeShift.id);
      if (supervisorName) {
        setDepositedBy(supervisorName);
      }
    }
  }, [activeShift, employees, user]);

  // Reset form inputs helper
  const resetFormFields = () => {
    setAmount('');
    setSlipNo('');
    setNotes('');
    setCustomBankName('');
    setAccountNumber('');
    setFormError(null);
    const targetId = activeShift ? activeShift.id : (shiftHistory.length > 0 ? shiftHistory[0].id : '');
    setDepositedBy(resolveSupervisorForShift(targetId));
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    setDepositDateTime(now.toISOString().slice(0, 16));
  };

  // Open / Close Modal Handlers
  const handleOpenModal = () => {
    resetFormFields();
    const targetId = activeShift ? activeShift.id : (shiftHistory.length > 0 ? shiftHistory[0].id : '');
    if (targetId) {
      setSelectedShiftId(targetId);
      setDepositedBy(resolveSupervisorForShift(targetId));
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    if (isSubmitting) return;
    setIsModalOpen(false);
    resetFormFields();
  };

  // Close on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isModalOpen && !isSubmitting) {
        handleCloseModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isModalOpen, isSubmitting]);

  // Format Helpers
  const formatCurrency = (val: number) => {
    return `Rs. ${Number(val || 0).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // Active shift financial calculation
  const activeShiftStats = useMemo(() => {
    if (!activeShift) return null;
    const readings = activeShift.pumpReadings || [];
    let grossRev = 0;
    let nonCashRev = 0;
    let actualPumperCash = 0;

    readings.forEach(r => {
      const fuelSold = Math.max(0, (r.endMeter || 0) - (r.startMeter || 0) - (r.testingQty || 0));
      const fuelRev = fuelSold * (r.unitPrice || 0);
      const oilRev = r.oilSalesAmount || 0;
      grossRev += (fuelRev + oilRev);
      nonCashRev += ((r.creditSalesAmount || 0) + (r.cardSalesAmount || 0) + (r.touchCardSalesAmount || 0) + (r.voucherSalesAmount || 0));
      actualPumperCash += (r.actualCash || 0);
    });

    const counterSales = activeShift.counterSales?.totalCounterRevenue || 0;
    grossRev += counterSales;

    const expectedCash = Math.max(0, grossRev - nonCashRev);
    const activeDeposits = bankDeposits.filter(d => d.shift_id === activeShift.id);
    const totalDeposited = activeDeposits.reduce((sum, d) => sum + (d.deposited_amount || 0), 0);
    
    // Effective physical cash in hand before and after deposits
    const effectiveCollectedCash = actualPumperCash > 0 ? actualPumperCash : expectedCash;
    const remainingCashInHand = Math.max(0, effectiveCollectedCash - totalDeposited);

    return {
      grossRev,
      nonCashRev,
      expectedCash,
      effectiveCollectedCash,
      totalDeposited,
      remainingCashInHand,
      depositCount: activeDeposits.length
    };
  }, [activeShift, bankDeposits]);

  // Filtered Deposits Ledger
  const filteredDeposits = useMemo(() => {
    return bankDeposits.filter(item => {
      // Shift filter
      if (filterShiftId === 'active') {
        if (!activeShift || item.shift_id !== activeShift.id) return false;
      } else if (filterShiftId !== 'all') {
        if (item.shift_id !== filterShiftId) return false;
      }

      // Bank filter
      if (filterBank !== 'all') {
        if (item.bank_name !== filterBank) return false;
      }

      // Search term (slip no, deposited by, notes, shift id)
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase().trim();
        const matchSlip = (item.slip_no || '').toLowerCase().includes(q);
        const matchBy = (item.deposited_by || '').toLowerCase().includes(q);
        const matchNotes = (item.notes || '').toLowerCase().includes(q);
        const matchShift = (item.shift_id || '').toLowerCase().includes(q);
        const matchBank = (item.bank_name || '').toLowerCase().includes(q);
        if (!matchSlip && !matchBy && !matchNotes && !matchShift && !matchBank) return false;
      }

      return true;
    });
  }, [bankDeposits, filterShiftId, filterBank, searchTerm, activeShift]);

  // Ledger Summary Totals
  const totalFilteredAmount = useMemo(() => {
    return filteredDeposits.reduce((acc, curr) => acc + (curr.deposited_amount || 0), 0);
  }, [filteredDeposits]);

  const totalAllTimeDeposited = useMemo(() => {
    return bankDeposits.reduce((acc, curr) => acc + (curr.deposited_amount || 0), 0);
  }, [bankDeposits]);

  // Handle Quick Amount Chips
  const handleQuickAmount = (val: number) => {
    setAmount(String(val));
  };

  // Form Submit Handler
  const handleSubmitDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setFormError('Please enter a valid deposit amount greater than Rs. 0.00');
      return;
    }

    if (!selectedShiftId) {
      setFormError('Please select a target shift.');
      return;
    }

    const finalBankName = bankName === 'Other / Cash Safe' && customBankName.trim()
      ? customBankName.trim()
      : bankName;

    setIsSubmitting(true);
    try {
      const selectedShiftObj = selectedShiftId === activeShift?.id
        ? activeShift
        : shiftHistory.find(s => s.id === selectedShiftId);

      await onAddDeposit({
        shift_id: selectedShiftId,
        shift_name: selectedShiftObj?.name || 'Standard Shift',
        deposited_amount: parsedAmount,
        deposited_by: depositedBy.trim() || user?.name || 'Supervisor',
        bank_name: finalBankName,
        account_number: accountNumber.trim(),
        slip_no: slipNo.trim(),
        notes: notes.trim(),
        deposit_date: new Date(depositDateTime).toISOString()
      });

      // Auto-close modal and reset fields
      resetFormFields();
      setIsModalOpen(false);

      // Trigger global banner toast
      setToastMessage({
        type: 'success',
        text: `✓ Successfully recorded deposit of ${formatCurrency(parsedAmount)} to ${finalBankName}`
      });

      setTimeout(() => {
        setToastMessage(null);
      }, 4500);
    } catch (err: any) {
      console.error('Failed to record bank deposit:', err);
      setFormError(err?.message || 'Failed to save bank deposit record. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Delete Action Handler
  const handleDelete = async (depositId: string, shiftId: string) => {
    try {
      await onDeleteDeposit(depositId, shiftId);
      setDeleteConfirmId(null);
      setToastMessage({
        type: 'success',
        text: 'Deposit record removed successfully.'
      });
      setTimeout(() => setToastMessage(null), 3000);
    } catch (err: any) {
      console.error('Failed to delete deposit:', err);
    }
  };

  // Export CSV
  const handleExportCSV = () => {
    if (filteredDeposits.length === 0) return;
    const headers = ['Deposit ID', 'Date & Time', 'Shift ID', 'Shift Name', 'Bank Name', 'Slip / Ref No', 'Deposited By', 'Amount (Rs)', 'Notes'];
    const rows = filteredDeposits.map(d => [
      d.id || '',
      new Date(d.deposit_date || d.created_at || '').toLocaleString(),
      d.shift_id,
      d.shift_name || '',
      `"${d.bank_name || ''}"`,
      `"${d.slip_no || ''}"`,
      `"${d.deposited_by || ''}"`,
      d.deposited_amount,
      `"${(d.notes || '').replace(/"/g, '""')}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Bank_Deposits_Report_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div id="deposits-tab-container" className="space-y-5 animate-fade-in pb-12 font-sans">
      {/* Toast Notification Banner */}
      {toastMessage && (
        <div className={`p-4 rounded-2xl border text-xs font-bold flex items-center justify-between shadow-md animate-fade-in transition-all ${
          toastMessage.type === 'success' 
            ? 'bg-emerald-50 border-emerald-200 text-emerald-900 shadow-emerald-600/10' 
            : 'bg-red-50 border-red-200 text-red-900 shadow-red-600/10'
        }`}>
          <div className="flex items-center gap-2.5">
            {toastMessage.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
            )}
            <span>{toastMessage.text}</span>
          </div>
          <button 
            onClick={() => setToastMessage(null)}
            className="p-1 hover:bg-emerald-100 rounded-lg text-emerald-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Top Header & Action Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0">
            <Landmark className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-slate-900 tracking-tight">
                Shift Bank Deposits & Safe Drops
              </h1>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 font-bold border border-emerald-200">
                Multi-Entry Ledger
              </span>
            </div>
            <p className="text-xs text-slate-500 font-normal">
              Log partial cash drops during active shifts and track bank deposit records
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {/* Primary Action: New Deposit Button */}
          <button
            id="btn-open-deposit-modal"
            onClick={handleOpenModal}
            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-sm hover:shadow"
          >
            <Plus className="w-4 h-4" />
            <span>New Deposit</span>
          </button>

          <button
            onClick={handleExportCSV}
            disabled={filteredDeposits.length === 0}
            className="px-3 py-2 bg-white hover:bg-slate-50 border border-slate-200/80 text-slate-700 disabled:opacity-50 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs"
            title="Export CSV"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Full-Width Deposit History Ledger Card */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs space-y-4">
        {/* Table Controls & Filters */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <h3 className="font-extrabold text-sm text-slate-900 flex items-center gap-2">
              Deposit History Ledger
              <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2.5 py-0.5 rounded-full border border-slate-200/60">
                {filteredDeposits.length} Records
              </span>
            </h3>
            {activeShift && (
              <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-extrabold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" />
                Active Shift {activeShift.id}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            {/* Shift Filter */}
            <select
              value={filterShiftId}
              onChange={(e) => setFilterShiftId(e.target.value)}
              className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            >
              <option value="all">All Shifts</option>
              {activeShift && <option value="active">Active Shift Only ({activeShift.id})</option>}
              {shiftHistory.map(s => (
                <option key={`filter-${s.id}`} value={s.id}>Shift {s.id} ({s.name})</option>
              ))}
            </select>

            {/* Bank Filter */}
            <select
              value={filterBank}
              onChange={(e) => setFilterBank(e.target.value)}
              className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 max-w-[160px] truncate"
            >
              <option value="all">All Banks</option>
              {SRI_LANKAN_BANKS.map(b => (
                <option key={`fbank-${b}`} value={b}>{b}</option>
              ))}
            </select>

            {/* Search Bar */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search slips, deposited by..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500/20 w-44 sm:w-56"
              />
            </div>
          </div>
        </div>

        {/* Table Area */}
        {filteredDeposits.length === 0 ? (
          <div className="py-16 text-center text-slate-400 space-y-3">
            <div className="w-14 h-14 rounded-2xl bg-slate-100 text-slate-400 mx-auto flex items-center justify-center">
              <Landmark className="w-7 h-7 stroke-[1.5]" />
            </div>
            <div>
              <p className="text-sm font-extrabold text-slate-700">No bank deposits found</p>
              <p className="text-xs text-slate-400 max-w-sm mx-auto mt-1">
                No partial deposits logged for the selected filter. Click the button below to record a cash banking drop.
              </p>
            </div>
            <button
              onClick={handleOpenModal}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-md shadow-emerald-600/20 transition-all inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Log First Deposit</span>
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[580px] overflow-y-auto no-scrollbar">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/80 text-[10px] font-extrabold text-slate-500 uppercase tracking-wider sticky top-0 z-10 backdrop-blur-xs">
                  <th className="py-3 px-4">Date & Time</th>
                  <th className="py-3 px-3">Shift ID</th>
                  <th className="py-3 px-4">Destination & Slip Ref</th>
                  <th className="py-3 px-4">Deposited By</th>
                  <th className="py-3 px-4 text-right">Amount (LKR)</th>
                  <th className="py-3 px-3 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredDeposits.map((item) => {
                  const isActive = activeShift && item.shift_id === activeShift.id;
                  const dateFormatted = new Date(item.deposit_date || item.created_at || '').toLocaleString('en-LK', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  });

                  return (
                    <tr 
                      key={item.id || `row-${Math.random()}`}
                      className="hover:bg-slate-50/70 transition-colors group"
                    >
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="font-extrabold text-slate-800 text-xs">{dateFormatted}</div>
                        {item.notes && (
                          <div className="text-[11px] text-slate-400 truncate max-w-xs mt-0.5" title={item.notes}>
                            {item.notes}
                          </div>
                        )}
                      </td>

                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <span className={`px-2.5 py-1 rounded-lg font-extrabold text-[11px] tabular-nums border ${
                          isActive 
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200' 
                            : 'bg-slate-100 text-slate-600 border-slate-200'
                        }`}>
                          {item.shift_id}
                        </span>
                        {item.shift_name && (
                          <span className="block text-[10px] text-slate-400 mt-0.5 font-medium">
                            {item.shift_name}
                          </span>
                        )}
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="font-extrabold text-slate-900 text-xs flex items-center gap-1.5">
                          <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span className="truncate max-w-[200px]">{item.bank_name || 'Commercial Bank'}</span>
                        </div>
                        <div className="text-[11px] font-medium text-slate-500 flex items-center gap-1 mt-0.5">
                          <Receipt className="w-3 h-3 text-slate-400 shrink-0" />
                          <span>{item.slip_no ? `Slip: ${item.slip_no}` : 'No slip attached'}</span>
                          {item.account_number && <span className="text-slate-400">({item.account_number})</span>}
                        </div>
                      </td>

                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-2 font-bold text-slate-700 text-xs">
                          <div className="w-6 h-6 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center font-black text-[10px]">
                            {(item.deposited_by || 'S').charAt(0)}
                          </div>
                          <span className="truncate max-w-[130px]">{item.deposited_by || 'Supervisor'}</span>
                        </div>
                      </td>

                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <span className="font-black text-emerald-700 tabular-nums text-sm">
                          {formatCurrency(item.deposited_amount || 0)}
                        </span>
                      </td>

                      <td className="py-3.5 px-3 text-center whitespace-nowrap">
                        {deleteConfirmId === item.id ? (
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => item.id && handleDelete(item.id, item.shift_id)}
                              className="px-2 py-1 bg-red-600 text-white font-extrabold text-[10px] rounded-lg hover:bg-red-700 cursor-pointer shadow-2xs"
                              title="Confirm Delete"
                            >
                              Delete
                            </button>
                            <button
                              onClick={() => setDeleteConfirmId(null)}
                              className="px-2 py-1 bg-slate-200 text-slate-700 font-extrabold text-[10px] rounded-lg hover:bg-slate-300 cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setDeleteConfirmId(item.id || null)}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all cursor-pointer opacity-70 group-hover:opacity-100"
                            title="Delete Deposit Record"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Table Footer: Total Sum */}
        <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-bold text-slate-700 bg-slate-50/70 p-3.5 rounded-xl">
          <div className="flex items-center gap-2">
            <span>Filtered Total Deposits:</span>
            <span className="text-[11px] font-normal text-slate-500">({filteredDeposits.length} entries shown)</span>
          </div>
          <span className="font-black text-emerald-700 tabular-nums text-base">
            {formatCurrency(totalFilteredAmount)}
          </span>
        </div>
      </div>

      {/* POPUP MODAL: Log New Partial Deposit Form */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in">
          <div 
            className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 overflow-hidden transform transition-all animate-scale-up"
            role="dialog"
            aria-modal="true"
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4.5 bg-gradient-to-r from-emerald-700 to-emerald-800 text-white">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-white/15 flex items-center justify-center">
                  <Landmark className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h3 className="font-black text-sm text-white tracking-tight">
                    Log Partial Bank Deposit
                  </h3>
                  <p className="text-[11px] text-emerald-100/90 font-medium">
                    Record a cash banking drop & sync with shift reconciliation
                  </p>
                </div>
              </div>
              <button
                onClick={handleCloseModal}
                disabled={isSubmitting}
                className="p-1.5 text-white/80 hover:text-white hover:bg-white/20 rounded-xl transition-colors cursor-pointer"
                title="Close (Esc)"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body / Form */}
            <div className="p-5 max-h-[80vh] overflow-y-auto space-y-4">
              {formError && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-800 rounded-xl text-xs font-semibold flex items-center gap-2 animate-fade-in">
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <form id="deposit-entry-modal-form" onSubmit={handleSubmitDeposit} className="space-y-4 text-xs">
                {/* Shift Target Selector */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-[11px] font-extrabold text-slate-700 uppercase tracking-wider">
                      Target Shift *
                    </label>
                    {activeShift && (
                      <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                        Shift {activeShift.id} is Live
                      </span>
                    )}
                  </div>
                  <select
                    value={selectedShiftId}
                    onChange={(e) => {
                      const newShiftId = e.target.value;
                      setSelectedShiftId(newShiftId);
                      setDepositedBy(resolveSupervisorForShift(newShiftId));
                    }}
                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                    required
                  >
                    {activeShift && (
                      <option value={activeShift.id}>
                        Active Shift: {activeShift.id} ({activeShift.name})
                      </option>
                    )}
                    {shiftHistory.map(s => (
                      <option key={s.id} value={s.id}>
                        Past Shift: {s.id} ({s.name}) — {new Date(s.startTime).toLocaleDateString()}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Deposit Amount Field */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-[11px] font-extrabold text-slate-700 uppercase tracking-wider">
                      Deposit Amount (Rs.) *
                    </label>
                    {activeShiftStats && activeShiftStats.remainingCashInHand > 0 && (
                      <button
                        type="button"
                        onClick={() => handleQuickAmount(Math.round(activeShiftStats.remainingCashInHand))}
                        className="text-[10px] font-bold text-emerald-700 hover:text-emerald-800 hover:underline cursor-pointer"
                      >
                        Safe Balance: {formatCurrency(activeShiftStats.remainingCashInHand)}
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-extrabold text-sm">Rs.</span>
                    <input
                      type="number"
                      min="1"
                      step="0.01"
                      placeholder="0.00"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      autoFocus
                      className="w-full pl-11 pr-3 py-2.5 bg-white border border-slate-300 rounded-xl text-base font-black text-slate-900 tabular-nums placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-600 shadow-2xs"
                      required
                    />
                  </div>
                </div>

                {/* Bank Name & Slip Number */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-extrabold text-slate-700 uppercase tracking-wider mb-1">
                      Bank / Destination *
                    </label>
                    <select
                      value={bankName}
                      onChange={(e) => setBankName(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                    >
                      {SRI_LANKAN_BANKS.map(b => (
                        <option key={b} value={b}>{b}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-extrabold text-slate-700 uppercase tracking-wider mb-1">
                      Slip / Ref No
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. SLIP-88412"
                      value={slipNo}
                      onChange={(e) => setSlipNo(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                    />
                  </div>
                </div>

                {bankName === 'Other / Cash Safe' && (
                  <div>
                    <label className="block text-[11px] font-extrabold text-slate-700 uppercase tracking-wider mb-1">
                      Specify Custom Bank / Vault Name *
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Forecourt Head Safe"
                      value={customBankName}
                      onChange={(e) => setCustomBankName(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                      required
                    />
                  </div>
                )}

                {/* Deposited By & Date/Time */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-extrabold text-slate-700 uppercase tracking-wider mb-1">
                      Deposited By *
                    </label>
                    <select
                      value={depositedBy}
                      onChange={(e) => setDepositedBy(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 cursor-pointer"
                      required
                    >
                      {supervisorOptions.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-extrabold text-slate-700 uppercase tracking-wider mb-1">
                      Date & Time
                    </label>
                    <input
                      type="datetime-local"
                      value={depositDateTime}
                      onChange={(e) => setDepositDateTime(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                    />
                  </div>
                </div>

                {/* Notes / Remarks */}
                <div>
                  <label className="block text-[11px] font-extrabold text-slate-700 uppercase tracking-wider mb-1">
                    Notes / Remarks (Optional)
                  </label>
                  <textarea
                    rows={2}
                    placeholder="e.g. Afternoon rush deposit by Supervisor; stamped by bank teller"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 resize-none"
                  />
                </div>
              </form>
            </div>

            {/* Modal Footer Controls */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={handleCloseModal}
                disabled={isSubmitting}
                className="px-4 py-2.5 bg-slate-200 hover:bg-slate-300 disabled:opacity-50 text-slate-700 font-extrabold text-xs rounded-xl transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                form="deposit-entry-modal-form"
                disabled={isSubmitting || isLoading}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-extrabold text-xs rounded-xl shadow-md shadow-emerald-600/20 hover:shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                {isSubmitting ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Recording...</span>
                  </>
                ) : (
                  <>
                    <Landmark className="w-4 h-4" />
                    <span>Record Deposit</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

