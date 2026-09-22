/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Clock, Droplet, CreditCard, TrendingUp, ArrowLeft,
  Search, RefreshCw, Eye, Database, CheckCircle2, AlertTriangle, 
  Fuel, User, Receipt, Filter, Calendar, Download, X, Plus, BarChart3,
  ArrowLeftRight
} from 'lucide-react';
import { Shift, StockDelivery, FuelTank, OilTank, Pump, Employee, Customer, CreditTransaction, CreditPayment } from '../types';
import { supabase } from '../lib/supabase';
import DailySalesTab from './DailySalesTab';
import OilMovementReport from './OilMovementReport';

export interface TankDipLog {
  id: string;
  date: string;
  tankId: string;
  tankName: string;
  fuelType: string;
  openingDip: number;
  closingDip: number;
  bowserReceipts: number;
  pumpSales: number;
  expectedStock: number;
  varianceLiters: number;
  variancePercentage: number;
  recordedBy?: string;
  notes?: string;
}

export interface BowserDeliveryRecord {
  id: string;
  receivedDate: string;
  invoiceNo: string;
  bowserNo: string;
  fuelType: string;
  tankId?: string;
  invoicedVolume: number;
  receivedVolume: number;
  densityReading: number;
  temperature?: number;
  recordedBy: string;
  shortageVolume?: number;
}

interface ReportsTabProps {
  shiftHistory?: Shift[];
  deliveries?: StockDelivery[];
  tanks?: FuelTank[];
  oilTanks?: OilTank[];
  pumps?: Pump[];
  employees?: Employee[];
  customers?: Customer[];
  creditTransactions?: CreditTransaction[];
  payments?: CreditPayment[];
  activeSubTab?: SubTab;
  onSubTabChange?: (tab: SubTab) => void;
}

type SubTab = 'daily-sales' | 'shift-meter' | 'tank-stock' | 'oil-movement' | 'credit-customer' | 'financials';

export default function ReportsTab({
  shiftHistory = [],
  employees = [],
  tanks = [],
  oilTanks = [],
  activeSubTab: propActiveSubTab,
  onSubTabChange,
}: ReportsTabProps) {
  // Navigation Sub-tab state - Default to 'daily-sales'
  const [internalSubTab, setInternalSubTab] = useState<SubTab>('daily-sales');
  const activeSubTab = propActiveSubTab || internalSubTab;

  const handleSubTabChange = (tab: SubTab) => {
    setInternalSubTab(tab);
    if (onSubTabChange) {
      onSubTabChange(tab);
    }
  };

  // Real-time Supabase state
  const [supabaseShifts, setSupabaseShifts] = useState<Shift[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Search, Date Range & Filter state
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'active'>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  // Full-Page Detail View state
  const [selectedShift, setSelectedShift] = useState<Shift | null>(null);

  // Tank & Stock Reconciliation state
  const [dipLogs, setDipLogs] = useState<TankDipLog[]>([]);
  const [isLoadingDipLogs, setIsLoadingDipLogs] = useState<boolean>(false);


  // Fetch shifts directly from Supabase
  const fetchShiftAudits = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const isConfigured = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
      if (!isConfigured) {
        setSupabaseShifts([]);
        setIsLoading(false);
        return;
      }

      const { data: shiftsData, error } = await supabase
        .from('shifts')
        .select(`
          *,
          pumpReadings:pump_readings(*)
        `)
        .order('starttime', { ascending: false });

      if (error) {
        console.warn("Supabase fetch warning:", error.message);
        setErrorMsg(error.message);
        setSupabaseShifts(shiftHistory || []);
      } else if (shiftsData) {
        const mappedShifts: Shift[] = shiftsData.map((s: any) => ({
          id: s.id,
          name: s.name || `Shift ${s.id}`,
          supervisorId: s.supervisorid || s.supervisor_id || s.supervisorId || 'Supervisor',
          startTime: s.starttime || s.start_time || s.startTime || new Date().toISOString(),
          endTime: s.endtime || s.end_time || s.endTime,
          isActive: s.isactive ?? s.is_active ?? false,
          totalFuelSold: Number(s.totalfuelsold || s.total_fuel_sold) || 0,
          totalNetSold: Number(s.totalnetsold || s.total_net_sold) || 0,
          totalNetSales: Number(s.totalnetsales || s.total_net_sales) || 0,
          initialPumperCash: Number(s.initialpumpercash || s.initial_pumper_cash) || 0,
          replacementPumperCash: Number(s.replacementpumpercash || s.replacement_pumper_cash) || 0,
          totalPhysicalCash: Number(s.totalphysicalcash || s.total_physical_cash) || 0,
          cashVariance: Number(s.cashvariance || s.cash_variance) || 0,
          handoverNotes: s.handovernotes || s.handover_notes || '',
          replacementPumperId: s.replacementpumperid || s.replacement_pumper_id || '',
          pumpReadings: (s.pumpReadings || s.pump_readings || []).map((r: any) => ({
            pumpId: r.pump_id || r.pumpid || r.pumpId,
            pumpName: r.pump_name || r.pumpname || r.pumpName || 'Pump',
            fuelType: r.fuel_type || r.fueltype || r.fuelType || 'Fuel',
            tankId: r.tank_id || r.tankid || r.tankId,
            assignedPumperId: r.assigned_pumper_id || r.assignedpumperid || r.assignedPumperId || null,
            replacementPumperId: r.replacement_pumper_id || r.replacementpumperid || r.replacementPumperId || null,
            initialPumperCash: Number(r.initial_pumper_cash || r.initialpumpercash) || 0,
            replacementPumperCash: Number(r.replacement_pumper_cash || r.replacementpumpercash) || 0,
            handoverMeter: Number(r.handover_meter ?? r.handovermeter) || 0,
            handoverNotes: r.handover_notes || r.handovernotes || '',
            startMeter: Number(r.start_meter ?? r.startmeter) || 0,
            endMeter: Number(r.end_meter ?? r.endmeter) || 0,
            testingQty: Number(r.testing_qty ?? r.testingqty) || 0,
            status: r.status || 'Active',
            isLocked: r.is_locked ?? r.islocked ?? false,
            unitPrice: Number(r.unit_price ?? r.unitprice) || 0,
            actualCash: Number(r.actual_cash ?? r.actualcash) || 0,
            cashVariance: Number(r.cash_variance ?? r.cashvariance) || 0,
            creditSalesAmount: Number(r.credit_sales_amount ?? r.creditsalesamount) || 0,
            cardSalesAmount: Number(r.card_sales_amount ?? r.cardsalesamount) || 0,
            oilSalesAmount: Number(r.oil_sales_amount ?? r.oilsalesamount) || 0
          }))
        }));
        setSupabaseShifts(mappedShifts);
      }
    } catch (err: any) {
      console.error("Error fetching shift audits:", err);
      setErrorMsg(err?.message || "Failed to query database");
      setSupabaseShifts(shiftHistory || []);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchShiftAudits();
  }, []);

  // Sync if prop shiftHistory updates
  useEffect(() => {
    if (shiftHistory && shiftHistory.length > 0 && supabaseShifts.length === 0) {
      setSupabaseShifts(shiftHistory);
    }
  }, [shiftHistory]);

  // Fetch Tank Dip Logs from Supabase
  const fetchTankStockData = async () => {
    const isConfigured = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
    if (!isConfigured) return;

    setIsLoadingDipLogs(true);

    try {
      const { data: dipData } = await supabase
        .from('tank_dip_logs')
        .select('*')
        .order('date', { ascending: false });

      if (dipData) {
        const mappedDip: TankDipLog[] = dipData.map((d: any) => {
          const open = Number(d.opening_dip ?? d.openingdip) || 0;
          const close = Number(d.closing_dip ?? d.closingdip) || 0;
          const receipts = Number(d.bowser_receipts ?? d.bowserreceipts) || 0;
          const sales = Number(d.pump_sales ?? d.pumpsales) || 0;
          const expected = d.expected_stock !== undefined && d.expected_stock !== null 
            ? Number(d.expected_stock) 
            : (open + receipts - sales);
          const varL = d.variance_liters !== undefined && d.variance_liters !== null 
            ? Number(d.variance_liters) 
            : (close - expected);
          const varPct = d.variance_percentage !== undefined && d.variance_percentage !== null 
            ? Number(d.variance_percentage) 
            : (expected > 0 ? (varL / expected) * 100 : 0);

          return {
            id: d.id,
            date: d.date || d.created_at || new Date().toISOString().slice(0, 10),
            tankId: d.tank_id || d.tankid || 'tank-1',
            tankName: d.tank_name || d.tankname || 'Tank 01',
            fuelType: d.fuel_type || d.fueltype || 'Petrol 92',
            openingDip: open,
            closingDip: close,
            bowserReceipts: receipts,
            pumpSales: sales,
            expectedStock: expected,
            varianceLiters: varL,
            variancePercentage: varPct,
            recordedBy: d.recorded_by || d.recordedby || 'Supervisor',
            notes: d.notes || ''
          };
        });
        setDipLogs(mappedDip);
      }
    } catch (err) {
      console.warn("Dip logs fetch notice:", err);
    } finally {
      setIsLoadingDipLogs(false);
    }
  };

  useEffect(() => {
    if (activeSubTab === 'tank-stock') {
      fetchTankStockData();
    }
  }, [activeSubTab]);

  // Name resolution helpers
  const getSupervisorName = (id?: string) => {
    if (!id) return 'Unassigned Supervisor';
    const found = employees?.find((e) => e.id === id || e.name.toLowerCase() === id.toLowerCase());
    return found ? found.name : id;
  };

  const getPumperName = (id?: string | null) => {
    if (!id) return 'Unassigned Pumper';
    const found = employees?.find((e) => e.id === id || e.name.toLowerCase() === id.toLowerCase());
    return found ? found.name : id;
  };

  // Currency Formatter (Sri Lankan Rs.)
  const formatRs = (amount: number | undefined | null): string => {
    if (amount === undefined || amount === null || isNaN(amount)) return 'Rs. 0.00';
    const isNegative = amount < 0;
    const absVal = Math.abs(amount).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${isNegative ? '-' : ''}Rs. ${absVal}`;
  };

  // Shift Financial Calculations
  const calculateShiftMetrics = (shift: Shift) => {
    let grossFuelSales = 0;
    let totalOilSales = 0;
    let totalCreditSales = 0;
    let totalCardSales = 0;
    let totalTouchCardSales = 0;
    let totalVoucherSales = 0;
    let sumActualCash = 0;

    if (shift.pumpReadings && shift.pumpReadings.length > 0) {
      shift.pumpReadings.forEach((r: any) => {
        const soldLiters = Math.max(0, (r.endMeter || 0) - (r.startMeter || 0) - (r.testingQty || 0));
        const fuelVal = soldLiters * (r.unitPrice || 0);
        const oilVal = Number(r.oilSalesAmount ?? r.oil_sales_amount) || 0;
        const creditVal = Number(r.creditSalesAmount ?? r.credit_sales_amount) || 0;
        const cardVal = Number(r.cardSalesAmount ?? r.card_sales_amount) || 0;
        const touchVal = Number(r.touchCardSalesAmount ?? r.touch_card_sales_amount) || 0;
        const voucherVal = Number(r.voucherSalesAmount ?? r.voucher_sales_amount) || 0;
        const cashVal = Number(r.actualCash ?? r.actual_cash) || 0;

        grossFuelSales += fuelVal;
        totalOilSales += oilVal;
        totalCreditSales += creditVal;
        totalCardSales += cardVal;
        totalTouchCardSales += touchVal;
        totalVoucherSales += voucherVal;
        sumActualCash += cashVal;
      });
    }

    const finalCredit = Math.max(totalCreditSales, Number((shift as any).creditSales ?? (shift as any).credit_sales ?? (shift as any).total_credit_sales ?? 0));
    const finalCard = Math.max(totalCardSales, Number((shift as any).cardSales ?? (shift as any).card_sales ?? (shift as any).total_card_sales ?? 0));
    const finalTouch = Math.max(totalTouchCardSales, Number((shift as any).touchCardSales ?? (shift as any).touch_card_sales ?? (shift as any).total_touch_card_sales ?? 0));
    const finalVoucher = Math.max(totalVoucherSales, Number((shift as any).voucherSales ?? (shift as any).voucher_sales ?? (shift as any).total_voucher_sales ?? 0));

    const totalGasSales = shift.counterSales?.totalGasSales ?? (shift.counterSales?.gasSales || []).reduce((sum: number, g: any) => sum + (Number(g.totalAmount) || 0), 0);
    const totalLubeSales = shift.counterSales?.totalLubeSales ?? (shift.counterSales?.lubeSales || []).reduce((sum: number, l: any) => sum + (Number(l.totalAmount) || 0), 0);

    const totalGrossSales = (grossFuelSales + totalOilSales + totalGasSales + totalLubeSales) || shift.totalNetSales || 0;
    const totalNonCash = finalCredit + finalCard + finalTouch + finalVoucher;
    
    // Expected cash = Total Gross Revenue - Non-Cash Deductions (Credit + Card + Touch Card + Voucher)
    const totalExpectedCash = Math.max(0, totalGrossSales - totalNonCash);
    
    const cashBanked = Number(shift.cashBanked ?? (shift as any).cash_banked) || 0;

    // Physical Cash handed over
    let actualCashHandedOver = sumActualCash > 0 
      ? sumActualCash 
      : (shift.totalPhysicalCash || (shift.initialPumperCash || 0) + (shift.replacementPumperCash || 0));

    if (actualCashHandedOver === 0 && cashBanked > 0) {
      actualCashHandedOver = cashBanked;
    }

    const effectivePhysical = actualCashHandedOver > 0 ? actualCashHandedOver : cashBanked;

    // Cash Variance = Effective Physical - Expected
    const variance = shift.cashVariance !== undefined && shift.cashVariance !== 0 
      ? shift.cashVariance 
      : effectivePhysical - totalExpectedCash;

    return {
      grossFuelSales,
      totalOilSales,
      totalGasSales,
      totalLubeSales,
      totalGrossSales,
      totalCreditSales: finalCredit,
      totalCardSales: finalCard,
      totalTouchCardSales: finalTouch,
      totalVoucherSales: finalVoucher,
      totalNonCash,
      totalExpectedCash,
      actualCashHandedOver,
      variance
    };
  };

  // CSV Download Utility
  const downloadCSV = (filename: string, headers: string[], rows: (string | number)[][]) => {
    const csvContent = [
      headers.map(h => `"${h.replace(/"/g, '""')}"`).join(','),
      ...rows.map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // CSV Export Actions
  const exportMainAuditCSV = () => {
    const headers = [
      'Date & Time',
      'Shift ID',
      'Supervisor',
      'Expected Physical Cash (Rs.)',
      'Actual Cash Handed Over (Rs.)',
      'Variance (Rs.)',
      'Status'
    ];

    const rows = filteredShifts.map((shift) => {
      const m = calculateShiftMetrics(shift);
      const dateFormatted = shift.startTime 
        ? new Date(shift.startTime).toLocaleString('en-LK')
        : 'N/A';
      const supervisorName = getSupervisorName(shift.supervisorId);
      const status = shift.isActive ? 'Active' : 'Completed';
      const varianceLabel = m.variance < 0 ? `${formatRs(m.variance)} (Shortage)` : m.variance === 0 ? 'Rs. 0.00 (Balanced)' : `+${formatRs(m.variance)} (Excess)`;

      return [
        dateFormatted,
        shift.id,
        supervisorName,
        formatRs(m.totalExpectedCash),
        formatRs(m.actualCashHandedOver),
        varianceLabel,
        status
      ];
    });

    downloadCSV(`Shift_Audit_Logs_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  };

  const exportPumpReadingsCSV = (shift: Shift) => {
    if (!shift.pumpReadings || shift.pumpReadings.length === 0) return;

    const headers = [
      'Pump Name',
      'Fuel Type',
      'Assigned Pumper',
      'Start Meter',
      'End Meter',
      'Testing (L)',
      'Net Sold (L)',
      'Unit Price (Rs.)',
      'Gross Total (Rs.)'
    ];

    const rows = shift.pumpReadings.map((r) => {
      const netLiters = Math.max(0, (r.endMeter || 0) - (r.startMeter || 0) - (r.testingQty || 0));
      const grossTotal = netLiters * (r.unitPrice || 0);

      return [
        r.pumpName,
        r.fuelType,
        getPumperName(r.assignedPumperId),
        r.startMeter || 0,
        r.endMeter || 0,
        r.testingQty || 0,
        `${netLiters} L`,
        formatRs(r.unitPrice),
        formatRs(grossTotal)
      ];
    });

    downloadCSV(`Pump_Readings_${shift.id}_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  };

  const exportPumperShortageCSV = (shift: Shift) => {
    if (!shift.pumpReadings || shift.pumpReadings.length === 0) return;

    const headers = [
      'Pumper Name',
      'Assigned Pump',
      'Gross Revenue (Rs.)',
      'Non-Cash Credit/POS (Rs.)',
      'Expected Cash (Rs.)',
      'Handed Over Cash (Rs.)',
      'Pumper Shortage (Rs.)'
    ];

    const rows = shift.pumpReadings.map((r) => {
      const netLiters = Math.max(0, (r.endMeter || 0) - (r.startMeter || 0) - (r.testingQty || 0));
      const grossRev = (netLiters * (r.unitPrice || 0)) + (r.oilSalesAmount || 0);
      const nonCash = (r.creditSalesAmount || 0) + (r.cardSalesAmount || 0);
      const expCash = Math.max(0, grossRev - nonCash);
      const actualCash = r.actualCash || 0;
      const pumperVar = actualCash - expCash;

      return [
        getPumperName(r.assignedPumperId),
        `${r.pumpName} (${r.fuelType})`,
        formatRs(grossRev),
        formatRs(nonCash),
        formatRs(expCash),
        formatRs(actualCash),
        pumperVar < 0 ? formatRs(pumperVar) : 'Rs. 0.00'
      ];
    });

    downloadCSV(`Pumper_Shortage_Breakdown_${shift.id}_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  };

  // Module 1: Dip Logs CSV Export
  const exportDipLogsCSV = () => {
    if (dipLogs.length === 0) return;
    const headers = [
      'Date',
      'Tank ID / Fuel Grade',
      'Opening Dip (L)',
      'Pump Sales (L)',
      'Bowser Receipts (L)',
      'Expected Stock (L)',
      'Closing Dip (L)',
      'Gain / Loss Variance (L)',
      'Gain / Loss Variance (%)',
      'Recorded By'
    ];

    const rows = dipLogs.map((d) => [
      d.date,
      `${d.tankName} (${d.fuelType})`,
      d.openingDip.toLocaleString('en-LK'),
      d.pumpSales.toLocaleString('en-LK'),
      d.bowserReceipts.toLocaleString('en-LK'),
      d.expectedStock.toLocaleString('en-LK'),
      d.closingDip.toLocaleString('en-LK'),
      `${d.varianceLiters >= 0 ? '+' : ''}${d.varianceLiters.toFixed(2)} L`,
      `${d.variancePercentage >= 0 ? '+' : ''}${d.variancePercentage.toFixed(2)}%`,
      d.recordedBy || 'Supervisor'
    ]);

    downloadCSV(`Tank_Dip_Reconciliation_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  };


  // Filtered Shifts List with Date Window Filtering
  const filteredShifts = useMemo(() => {
    return supabaseShifts.filter((s) => {
      const supervisor = getSupervisorName(s.supervisorId).toLowerCase();
      const shiftId = (s.id || '').toLowerCase();
      const matchesSearch = shiftId.includes(searchQuery.toLowerCase()) || supervisor.includes(searchQuery.toLowerCase());

      if (!matchesSearch) return false;

      if (statusFilter === 'completed' && s.isActive) return false;
      if (statusFilter === 'active' && !s.isActive) return false;

      // Date Range Filtering
      if (startDate) {
        const shiftTime = new Date(s.startTime).getTime();
        const fromTime = new Date(`${startDate}T00:00:00`).getTime();
        if (isNaN(shiftTime) || shiftTime < fromTime) return false;
      }

      if (endDate) {
        const shiftTime = new Date(s.startTime).getTime();
        const toTime = new Date(`${endDate}T23:59:59.999`).getTime();
        if (isNaN(shiftTime) || shiftTime > toTime) return false;
      }

      return true;
    });
  }, [supabaseShifts, searchQuery, statusFilter, startDate, endDate, employees]);

  // Details for fallback empty states of other sub-tabs
  const subTabDetails: Record<SubTab, { title: string; subtitle: string; icon: React.ComponentType<{ className?: string }> }> = {
    'daily-sales': {
      title: 'Daily Sales History',
      subtitle: 'Shift history and daily sales records',
      icon: BarChart3,
    },
    'shift-meter': {
      title: 'Shift & Meter Audits',
      subtitle: 'Electronic pump readings, testing deductions, and pumper shortage analysis',
      icon: Clock,
    },
    'tank-stock': {
      title: 'Tank & Stock Reconciliation',
      subtitle: 'Storage tank dip readings, bowser deliveries, and stock depletion tracking',
      icon: Droplet,
    },
    'oil-movement': {
      title: 'Oil Movement Report',
      subtitle: 'Audit log of bulk oil and barrel-to-chamber internal transfers',
      icon: ArrowLeftRight,
    },
    'credit-customer': {
      title: 'Credit & Customer Statements',
      subtitle: 'Corporate account aging analysis, vehicle logs, and deposit balance usage',
      icon: CreditCard,
    },
    'financials': {
      title: 'Financials & Profitability',
      subtitle: 'Fuel dealer margins, non-fuel lubricant sales, and gross margin audits',
      icon: TrendingUp,
    },
  };

  return (
    <div id="reports-tab-root" className="space-y-5 pb-12">

      {/* RENDER DAILY SALES TAB */}
      {activeSubTab === 'daily-sales' && (
        <DailySalesTab
          shiftHistory={supabaseShifts.length > 0 ? supabaseShifts : shiftHistory}
          employees={employees}
          tanks={tanks}
          oilTanks={oilTanks}
        />
      )}

      {/* RENDER SHIFT & METER AUDITS TAB */}
      {activeSubTab === 'shift-meter' && (
        <div>
          {/* IF A SHIFT IS SELECTED: FULL-PAGE DETAIL VIEW */}
          {selectedShift ? (
            <div className="space-y-5 animate-in fade-in duration-200">
              {/* Standalone Back Button */}
              <div>
                <button
                  onClick={() => setSelectedShift(null)}
                  className="inline-flex items-center gap-2 px-3.5 py-2 bg-white hover:bg-gray-50 border border-gray-200 text-gray-800 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-2xs"
                >
                  <ArrowLeft className="w-4 h-4 text-gray-700" />
                  <span>Back to Shift Audit List</span>
                </button>
              </div>

              {/* 1. Pump / Meter Readings Section */}
              <div className="bg-white rounded-2xl border border-gray-200/80 p-5 shadow-2xs space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <h3 className="text-xs font-bold text-gray-900 uppercase tracking-wider flex items-center gap-2">
                    <Fuel className="w-4 h-4 text-blue-600" />
                    <span>Pump & Meter Readings & Sales Breakdown</span>
                  </h3>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 font-semibold">
                      {selectedShift.pumpReadings?.length || 0} Pumps Total
                    </span>
                    {selectedShift.pumpReadings && selectedShift.pumpReadings.length > 0 && (
                      <button
                        onClick={() => exportPumpReadingsCSV(selectedShift)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg text-xs font-bold transition-all cursor-pointer"
                      >
                        <Download className="w-3 h-3 text-gray-600" />
                        <span>Export</span>
                      </button>
                    )}
                  </div>
                </div>

                {selectedShift.pumpReadings && selectedShift.pumpReadings.length > 0 ? (
                  <div className="overflow-x-auto border border-gray-100 rounded-xl">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-gray-50 font-bold text-gray-500 text-[10px] uppercase border-b border-gray-100">
                        <tr>
                          <th className="p-3">Pump</th>
                          <th className="p-3">Fuel Type</th>
                          <th className="p-3">Pumper</th>
                          <th className="p-3 text-right">Start Meter</th>
                          <th className="p-3 text-right">End Meter</th>
                          <th className="p-3 text-right">Testing (L)</th>
                          <th className="p-3 text-right">Net Sold (L)</th>
                          <th className="p-3 text-right">Unit Price</th>
                          <th className="p-3 text-right">Gross Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {selectedShift.pumpReadings.map((r, idx) => {
                          const netLiters = Math.max(0, (r.endMeter || 0) - (r.startMeter || 0) - (r.testingQty || 0));
                          const grossTotal = netLiters * (r.unitPrice || 0);

                          return (
                            <tr key={idx} className="hover:bg-gray-50">
                              <td className="p-3 font-bold font-sans text-gray-900">{r.pumpName}</td>
                              <td className="p-3 font-sans text-gray-600">{r.fuelType}</td>
                              <td className="p-3 font-sans text-gray-700 font-semibold">{getPumperName(r.assignedPumperId)}</td>
                              <td className="p-3 text-right text-gray-500">{r.startMeter?.toLocaleString()}</td>
                              <td className="p-3 text-right font-bold text-gray-800">{r.endMeter?.toLocaleString()}</td>
                              <td className="p-3 text-right text-amber-600">{r.testingQty || 0}</td>
                              <td className="p-3 text-right font-bold text-blue-600">{netLiters.toLocaleString()} L</td>
                              <td className="p-3 text-right text-gray-600">{formatRs(r.unitPrice)}</td>
                              <td className="p-3 text-right font-bold text-gray-900">{formatRs(grossTotal)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 italic">No pump meter readings recorded for this shift.</p>
                )}
              </div>

              {/* 3. Pumper-wise Cash Collection & Shortage Breakdown */}
              <div className="bg-white rounded-2xl border border-gray-200/80 p-5 shadow-2xs space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <h3 className="text-xs font-bold text-gray-900 uppercase tracking-wider flex items-center gap-2">
                    <User className="w-4 h-4 text-emerald-600" />
                    <span>Pumper Cash Collections & Shortage Breakdown</span>
                  </h3>
                  {selectedShift.pumpReadings && selectedShift.pumpReadings.length > 0 && (
                    <button
                      onClick={() => exportPumperShortageCSV(selectedShift)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg text-xs font-bold transition-all cursor-pointer"
                    >
                      <Download className="w-3 h-3 text-gray-600" />
                      <span>Export</span>
                    </button>
                  )}
                </div>

                {selectedShift.pumpReadings && selectedShift.pumpReadings.length > 0 ? (
                  <div className="overflow-x-auto border border-gray-100 rounded-xl">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-gray-50 font-bold text-gray-500 text-[10px] uppercase border-b border-gray-100">
                        <tr>
                          <th className="p-3">Pumper Name</th>
                          <th className="p-3">Assigned Pump</th>
                          <th className="p-3 text-right">Gross Revenue</th>
                          <th className="p-3 text-right">Non-Cash (Credit/POS)</th>
                          <th className="p-3 text-right">Expected Cash</th>
                          <th className="p-3 text-right">Handed Over Cash</th>
                          <th className="p-3 text-right">Pumper Shortage</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {selectedShift.pumpReadings.map((r, idx) => {
                          const netLiters = Math.max(0, (r.endMeter || 0) - (r.startMeter || 0) - (r.testingQty || 0));
                          const grossRev = (netLiters * (r.unitPrice || 0)) + (r.oilSalesAmount || 0);
                          const nonCash = (r.creditSalesAmount || 0) + (r.cardSalesAmount || 0);
                          const expCash = Math.max(0, grossRev - nonCash);
                          const actualCash = r.actualCash || 0;
                          const pumperVar = actualCash - expCash;

                          return (
                            <tr key={idx} className="hover:bg-gray-50">
                              <td className="p-3 font-sans font-bold text-gray-900">{getPumperName(r.assignedPumperId)}</td>
                              <td className="p-3 font-sans text-gray-600">{r.pumpName} ({r.fuelType})</td>
                              <td className="p-3 text-right text-gray-800">{formatRs(grossRev)}</td>
                              <td className="p-3 text-right text-blue-600">{formatRs(nonCash)}</td>
                              <td className="p-3 text-right font-semibold text-gray-900">{formatRs(expCash)}</td>
                              <td className="p-3 text-right font-bold text-emerald-700">{formatRs(actualCash)}</td>
                              <td className="p-3 text-right font-bold">
                                {pumperVar < 0 ? (
                                  <span className="text-rose-600">{formatRs(pumperVar)}</span>
                                ) : (
                                  <span className="text-emerald-600">Rs. 0.00</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 italic">No pumper collections recorded for this shift.</p>
                )}
              </div>

              {/* 4. Payment Method Split & Supervisor Notes */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Payment Method Split */}
                <div className="bg-white rounded-2xl border border-gray-200/80 p-5 shadow-2xs space-y-3">
                  <h3 className="text-xs font-bold text-gray-900 uppercase tracking-wider flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-purple-600" />
                    <span>Payment Method Breakdown</span>
                  </h3>
                  {(() => {
                    const m = calculateShiftMetrics(selectedShift);
                    return (
                      <div className="space-y-2.5 text-xs">
                        <div className="flex items-center justify-between p-2.5 bg-gray-50 rounded-xl">
                          <span className="font-sans text-gray-600 font-semibold">Physical Cash Handover</span>
                          <span className="font-bold text-emerald-700">{formatRs(m.actualCashHandedOver)}</span>
                        </div>
                        <div className="flex items-center justify-between p-2.5 bg-gray-50 rounded-xl">
                          <span className="font-sans text-gray-600 font-semibold">Credit Sales (Chitties)</span>
                          <span className="font-bold text-blue-600">{formatRs(m.totalCreditSales)}</span>
                        </div>
                        <div className="flex items-center justify-between p-2.5 bg-gray-50 rounded-xl">
                          <span className="font-sans text-gray-600 font-semibold">Card / POS Payments</span>
                          <span className="font-bold text-purple-600">{formatRs(m.totalCardSales)}</span>
                        </div>
                        <div className="flex items-center justify-between p-2.5 bg-gray-50 rounded-xl">
                          <span className="font-sans text-gray-600 font-semibold">Oil & Lubricant Sales</span>
                          <span className="font-bold text-amber-700">{formatRs(m.totalOilSales)}</span>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* Supervisor Audit Summary Notes */}
                <div className="bg-white rounded-2xl border border-gray-200/80 p-5 shadow-2xs space-y-3">
                  <h3 className="text-xs font-bold text-gray-900 uppercase tracking-wider flex items-center gap-2">
                    <Receipt className="w-4 h-4 text-gray-700" />
                    <span>Supervisor Notes & Handover Log</span>
                  </h3>
                  <div className="p-3.5 bg-gray-50 rounded-xl text-xs text-gray-700 min-h-[120px] space-y-2">
                    {selectedShift.handoverNotes ? (
                      <p className="whitespace-pre-wrap">{selectedShift.handoverNotes}</p>
                    ) : (
                      <p className="text-gray-400 italic">No supervisor handover notes entered for this shift.</p>
                    )}

                    {selectedShift.replacementPumperId && (
                      <div className="pt-2 border-t border-gray-200 text-[11px] text-gray-600">
                        <span className="font-bold">Mid-Shift Handover:</span> Replaced with {getPumperName(selectedShift.replacementPumperId)}
                      </div>
                    )}
                  </div>
                </div>
              </div>

            </div>
          ) : (
            /* IF NO SHIFT SELECTED: LIST TABLE VIEW */
            <div className="space-y-4">
              {/* Header Title Section (No Action Buttons) */}
              <div>
                <h1 className="text-lg font-bold text-slate-900 tracking-tight font-sans flex items-center gap-2">
                  <Clock className="w-4 h-4 text-blue-600" />
                  Shift Cash & Meter Audit Logs
                </h1>
                <p className="text-xs text-gray-500 mt-0.5">
                  Real-time shift closing reconciliations, physical cash vs expected collections, and shortage audits
                </p>
              </div>

              {/* Search, Date Range and Filters Bar */}
              <div className="bg-white p-3.5 rounded-2xl border border-gray-200/80 shadow-2xs flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-3">
                {/* Search Box & Date Pickers */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 flex-1">
                  {/* Search input */}
                  <div className="relative flex-1 min-w-[200px]">
                    <Search className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      placeholder="Search Shift ID or Supervisor..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-9 pr-3 py-1.5 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-medium"
                    />
                  </div>

                  {/* Date Pickers */}
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 px-2.5 py-1.5 rounded-xl text-xs">
                      <Calendar className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                      <span className="text-[11px] font-semibold text-gray-500">From:</span>
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="bg-transparent border-0 text-xs font-semibold text-gray-800 focus:outline-none cursor-pointer"
                      />
                    </div>

                    <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 px-2.5 py-1.5 rounded-xl text-xs">
                      <Calendar className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                      <span className="text-[11px] font-semibold text-gray-500">To:</span>
                      <input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="bg-transparent border-0 text-xs font-semibold text-gray-800 focus:outline-none cursor-pointer"
                      />
                    </div>

                    {(startDate || endDate) && (
                      <button
                        onClick={() => { setStartDate(''); setEndDate(''); }}
                        title="Clear date filter"
                        className="p-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg transition-all cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Status Filter Tabs & Export CSV Button */}
                <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2.5">
                  <div className="flex items-center gap-1 text-xs text-gray-400 font-semibold">
                    <Filter className="w-3.5 h-3.5" />
                    <span>Status:</span>
                  </div>
                  <div className="inline-flex bg-gray-100 p-1 rounded-xl text-xs font-bold">
                    <button
                      onClick={() => setStatusFilter('all')}
                      className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                        statusFilter === 'all' ? 'bg-white text-gray-900 shadow-2xs' : 'text-gray-500 hover:text-gray-900'
                      }`}
                    >
                      All ({supabaseShifts.length})
                    </button>
                    <button
                      onClick={() => setStatusFilter('completed')}
                      className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                        statusFilter === 'completed' ? 'bg-white text-gray-900 shadow-2xs' : 'text-gray-500 hover:text-gray-900'
                      }`}
                    >
                      Completed ({supabaseShifts.filter(s => !s.isActive).length})
                    </button>
                    <button
                      onClick={() => setStatusFilter('active')}
                      className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                        statusFilter === 'active' ? 'bg-white text-gray-900 shadow-2xs' : 'text-gray-500 hover:text-gray-900'
                      }`}
                    >
                      Active ({supabaseShifts.filter(s => s.isActive).length})
                    </button>
                  </div>

                  <button
                    onClick={exportMainAuditCSV}
                    disabled={filteredShifts.length === 0}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-2xs"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Export</span>
                  </button>
                </div>
              </div>

              {/* Loading Indicator */}
              {isLoading && (
                <div className="bg-white p-12 rounded-3xl border border-gray-200/80 text-center shadow-2xs">
                  <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
                  <p className="text-xs font-semibold text-gray-600">Querying Supabase real-time shift records...</p>
                </div>
              )}

              {/* Error Notice */}
              {!isLoading && errorMsg && (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-800 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                    <span>Supabase Sync Note: {errorMsg}</span>
                  </div>
                  <button 
                    onClick={fetchShiftAudits}
                    className="px-2.5 py-1 bg-amber-100 text-amber-900 rounded-lg font-bold hover:bg-amber-200 transition-all cursor-pointer"
                  >
                    Retry
                  </button>
                </div>
              )}

              {/* Empty State when no records exist */}
              {!isLoading && filteredShifts.length === 0 && (
                <div className="bg-white rounded-3xl border border-gray-200/80 p-12 text-center shadow-2xs my-2">
                  <div className="w-14 h-14 bg-blue-50 border border-blue-100 rounded-2xl flex items-center justify-center mx-auto text-blue-600 mb-3.5">
                    <Database className="w-7 h-7 text-blue-600" />
                  </div>
                  <h3 className="text-base font-bold text-[#1C1C1C]">No shift audit records found in Supabase</h3>
                  <p className="text-xs text-gray-500 mt-1.5 max-w-md mx-auto leading-relaxed">
                    There are currently no shift audit entries recorded in your Supabase database. Complete or save a shift in the system to automatically generate audit logs.
                  </p>
                  <button
                    onClick={fetchShiftAudits}
                    className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-[#1C1C1C] text-white text-xs font-bold rounded-xl hover:bg-gray-800 transition-all cursor-pointer shadow-2xs"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Refresh Supabase Records</span>
                  </button>
                </div>
              )}

              {/* Main Shift Audit Table View */}
              {!isLoading && filteredShifts.length > 0 && (
                <div className="bg-white rounded-2xl border border-gray-200/80 shadow-2xs overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-gray-50/80 border-b border-gray-200 text-gray-500 font-bold uppercase tracking-wider text-[11px]">
                          <th className="py-3 px-4">Date & Time</th>
                          <th className="py-3 px-4">Shift ID</th>
                          <th className="py-3 px-4">Supervisor</th>
                          <th className="py-3 px-4 text-right">Expected Physical Cash (Rs.)</th>
                          <th className="py-3 px-4 text-right">Actual Cash Handed Over (Rs.)</th>
                          <th className="py-3 px-4 text-right">Variance (Rs.)</th>
                          <th className="py-3 px-4 text-center">Status</th>
                          <th className="py-3 px-4 text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 font-medium text-gray-800">
                        {filteredShifts.map((shift) => {
                          const m = calculateShiftMetrics(shift);
                          const isShortage = m.variance < 0;
                          const isBalanced = m.variance === 0;
                          const dateFormatted = shift.startTime 
                            ? new Date(shift.startTime).toLocaleString('en-LK', {
                                year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit'
                              })
                            : 'N/A';
                          const supervisorName = getSupervisorName(shift.supervisorId);

                          return (
                            <tr 
                              key={shift.id}
                              onClick={() => setSelectedShift(shift)}
                              className="hover:bg-blue-50/40 transition-colors cursor-pointer group"
                            >
                              <td className="py-3.5 px-4 text-gray-600 whitespace-nowrap">
                                {dateFormatted}
                              </td>
                              <td className="py-3.5 px-4 font-bold text-blue-600 group-hover:underline">
                                {shift.id}
                              </td>
                              <td className="py-3.5 px-4 font-semibold text-gray-900">
                                <div className="flex items-center gap-1.5">
                                  <User className="w-3.5 h-3.5 text-gray-400" />
                                  <span>{supervisorName}</span>
                                </div>
                              </td>
                              <td className="py-3.5 px-4 text-right font-semibold text-gray-900">
                                {formatRs(m.totalExpectedCash)}
                              </td>
                              <td className="py-3.5 px-4 text-right font-bold text-emerald-700">
                                {formatRs(m.actualCashHandedOver)}
                              </td>
                              <td className="py-3.5 px-4 text-right whitespace-nowrap">
                                {isShortage ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-700 border border-rose-200">
                                    <AlertTriangle className="w-3 h-3" />
                                    <span>{formatRs(m.variance)} (Shortage)</span>
                                  </span>
                                ) : isBalanced ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                                    <CheckCircle2 className="w-3 h-3" />
                                    <span>Rs. 0.00 (Balanced)</span>
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-800 border border-blue-200">
                                    <TrendingUp className="w-3 h-3" />
                                    <span>+{formatRs(m.variance)} (Excess)</span>
                                  </span>
                                )}
                              </td>
                              <td className="py-3.5 px-4 text-center whitespace-nowrap">
                                {shift.isActive ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-amber-100 text-amber-800 uppercase tracking-wider animate-pulse">
                                    Active
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-gray-100 text-gray-700 uppercase tracking-wider">
                                    Completed
                                  </span>
                                )}
                              </td>
                              <td className="py-3.5 px-4 text-center whitespace-nowrap">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedShift(shift);
                                  }}
                                  className="p-1.5 bg-gray-100 hover:bg-blue-600 hover:text-white text-gray-600 rounded-lg transition-all cursor-pointer inline-flex items-center gap-1 text-xs font-semibold"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                  <span>View</span>
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB: TANK & STOCK RECONCILE */}
      {activeSubTab === 'tank-stock' && (
        <div className="space-y-6 animate-in fade-in duration-200">
          {/* Daily Dip vs. Meter Reconciliation */}
          <div className="bg-white rounded-2xl border border-gray-200/80 p-5 shadow-2xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-gray-100">
              <div>
                <h3 className="text-xs font-bold text-gray-900 uppercase tracking-wider flex items-center gap-2">
                  <Droplet className="w-4 h-4 text-blue-600" />
                  <span>Daily Dip vs. Meter Reconciliation</span>
                </h3>
                <p className="text-xs text-gray-500 mt-0.5 font-medium">
                  Audit underground tank physical dip levels against pump sales to calculate evaporation gain/loss variances.
                </p>
              </div>
              <div className="flex items-center gap-2 self-start sm:self-auto">
                <button
                  onClick={exportDipLogsCSV}
                  disabled={dipLogs.length === 0}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-800 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-2xs"
                >
                  <Download className="w-3.5 h-3.5 text-gray-600" />
                  <span>Export</span>
                </button>
              </div>
            </div>

            {isLoadingDipLogs ? (
              <div className="py-8 text-center text-xs text-gray-400 font-semibold animate-pulse">
                Loading daily dip logs from Supabase...
              </div>
            ) : dipLogs.length > 0 ? (
              <div className="overflow-x-auto border border-gray-100 rounded-xl">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-50 font-bold text-gray-500 text-[10px] uppercase border-b border-gray-100">
                    <tr>
                      <th className="p-3">Date</th>
                      <th className="p-3">Tank ID / Fuel Grade</th>
                      <th className="p-3 text-right">Opening Dip (L)</th>
                      <th className="p-3 text-right">Pump Sales (L)</th>
                      <th className="p-3 text-right">Expected Stock (L)</th>
                      <th className="p-3 text-right">Closing Dip (L)</th>
                      <th className="p-3 text-right">Gain / Loss Variance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 font-medium text-gray-800">
                    {dipLogs.map((log) => {
                      const isLoss = log.varianceLiters < 0;
                      return (
                        <tr key={log.id} className="hover:bg-gray-50/50 transition-colors">
                          <td className="p-3 font-semibold text-gray-700 whitespace-nowrap">{log.date}</td>
                          <td className="p-3 font-bold text-gray-900">
                            <span>{log.tankName}</span>
                            <span className="text-[10px] text-gray-500 font-normal ml-1.5">({log.fuelType})</span>
                          </td>
                          <td className="p-3 text-right text-gray-700">{log.openingDip.toLocaleString('en-LK')} L</td>
                          <td className="p-3 text-right text-blue-600 font-semibold">{log.pumpSales.toLocaleString('en-LK')} L</td>
                          <td className="p-3 text-right text-gray-700">{log.expectedStock.toLocaleString('en-LK')} L</td>
                          <td className="p-3 text-right font-bold text-gray-900">{log.closingDip.toLocaleString('en-LK')} L</td>
                          <td className="p-3 text-right whitespace-nowrap">
                            {isLoss ? (
                              <span className="inline-flex items-center gap-1 font-bold text-rose-600 bg-rose-50 px-2.5 py-0.5 rounded-md border border-rose-200">
                                <AlertTriangle className="w-3 h-3" />
                                <span>{log.varianceLiters.toFixed(2)} L ({log.variancePercentage.toFixed(2)}%)</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 font-bold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-md border border-emerald-200">
                                <TrendingUp className="w-3 h-3" />
                                <span>+{log.varianceLiters.toFixed(2)} L (+{log.variancePercentage.toFixed(2)}%)</span>
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="bg-gray-50/70 rounded-xl border border-dashed border-gray-200 p-8 text-center space-y-2">
                <div className="w-10 h-10 bg-blue-50 border border-blue-100 rounded-xl flex items-center justify-center mx-auto text-blue-600">
                  <Droplet className="w-5 h-5" />
                </div>
                <h4 className="text-xs font-bold text-gray-900">No Daily Dip Logs Recorded</h4>
                <p className="text-[11px] text-gray-500 max-w-sm mx-auto font-medium">
                  There are no dip reconciliation records in Supabase. Add your first daily dip reading to start auditing evaporation gain/loss.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUB-TAB: OIL MOVEMENT AUDIT REPORT */}
      {activeSubTab === 'oil-movement' && (
        <OilMovementReport
          oilTanks={oilTanks}
          employees={employees}
        />
      )}

      {/* RENDER FALLBACK EMPTY CONTAINERS FOR OTHER SUB-TABS */}
      {activeSubTab !== 'daily-sales' && activeSubTab !== 'shift-meter' && activeSubTab !== 'tank-stock' && activeSubTab !== 'oil-movement' && (
        <div className="bg-white rounded-2xl border border-gray-200/80 p-12 text-center shadow-2xs">
          {(() => {
            const details = subTabDetails[activeSubTab];
            const Icon = details.icon;
            return (
              <>
                <div className="w-12 h-12 bg-gray-50 border border-gray-100 rounded-2xl flex items-center justify-center mx-auto text-blue-600 mb-3">
                  <Icon className="w-6 h-6" />
                </div>
                <h3 className="text-sm font-bold text-[#1C1C1C]">{details.title}</h3>
                <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
                  {details.subtitle}
                </p>
              </>
            );
          })()}
        </div>
      )}

    </div>
  );
}
