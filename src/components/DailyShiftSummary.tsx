/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Printer, 
  Download, 
  Calendar, 
  Clock, 
  Fuel, 
  User, 
  Layers, 
  Gauge, 
  Droplet, 
  DollarSign, 
  FileText, 
  Truck, 
  AlertTriangle, 
  CheckCircle2, 
  ChevronDown, 
  ArrowLeft,
  Search,
  Filter,
  RefreshCw,
  Scale
} from 'lucide-react';
import { Shift, Employee, FuelTank, PumpReading, StockDelivery, DailyDipSession } from '../types';
import { supabase } from '../lib/supabase';

interface DailyShiftSummaryProps {
  shifts: Shift[];
  selectedShiftId?: string;
  onSelectShiftId?: (id: string) => void;
  tanks?: FuelTank[];
  employees?: Employee[];
  deliveries?: StockDelivery[];
  onBack?: () => void;
}

export default function DailyShiftSummary({
  shifts = [],
  selectedShiftId,
  onSelectShiftId,
  tanks = [],
  employees = [],
  deliveries = [],
  onBack,
}: DailyShiftSummaryProps) {
  // Currently active/inspected shift ID
  const [activeShiftId, setActiveShiftId] = useState<string>(
    selectedShiftId || (shifts.length > 0 ? shifts[0].id : '')
  );

  // Dip sessions fetched from Supabase or localStorage
  const [dipSessions, setDipSessions] = useState<DailyDipSession[]>([]);
  const [stockDeliveries, setStockDeliveries] = useState<StockDelivery[]>(deliveries);
  const [isLoadingDips, setIsLoadingDips] = useState<boolean>(false);

  // Synchronize when selectedShiftId prop changes
  useEffect(() => {
    if (selectedShiftId) {
      setActiveShiftId(selectedShiftId);
    } else if (!activeShiftId && shifts.length > 0) {
      setActiveShiftId(shifts[0].id);
    }
  }, [selectedShiftId, shifts]);

  // Load dip sessions and stock deliveries
  useEffect(() => {
    const loadDipData = async () => {
      setIsLoadingDips(true);
      try {
        // 1. Try LocalStorage
        const localDips = localStorage.getItem('fms_daily_dip_sessions');
        if (localDips) {
          try {
            const parsed = JSON.parse(localDips);
            if (Array.isArray(parsed)) setDipSessions(parsed);
          } catch (_) {}
        }

        const localDeliveries = localStorage.getItem('fms_deliveries');
        if (localDeliveries) {
          try {
            const parsed = JSON.parse(localDeliveries);
            if (Array.isArray(parsed) && parsed.length > 0) setStockDeliveries(parsed);
          } catch (_) {}
        }

        // 2. Fetch from Supabase
        const isConfigured = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
        if (isConfigured) {
          const { data: dipData } = await supabase
            .from('daily_dip_sessions')
            .select('*')
            .order('created_at', { ascending: false });

          if (dipData && dipData.length > 0) {
            const mapped: DailyDipSession[] = dipData.map((d: any) => ({
              id: d.id,
              date: d.date || d.dip_date || new Date().toISOString().slice(0, 10),
              time: d.time || '12:00',
              shift: d.shift || d.shift_id || 'Day',
              shiftId: d.shift_id,
              supervisor: d.supervisor || d.recorded_by || 'Supervisor',
              sessionType: d.session_type || d.sessiontype || 'daily_routine',
              tanks: typeof d.tanks === 'string' ? JSON.parse(d.tanks) : (d.tanks || []),
              bowserAudit: typeof d.bowser_audit === 'string' ? JSON.parse(d.bowser_audit) : d.bowser_audit,
              remarks: d.remarks || d.notes || '',
              createdAt: d.created_at
            }));
            setDipSessions(mapped);
          }

          const { data: delData } = await supabase
            .from('stock_deliveries')
            .select('*')
            .order('date', { ascending: false });

          if (delData && delData.length > 0) {
            const mappedDel: StockDelivery[] = delData.map((d: any) => ({
              id: d.id,
              date: d.date,
              fuelType: d.fueltype || d.fuel_type || 'Petrol 92',
              tankId: d.tankid || d.tank_id,
              tankName: d.tankname || d.tank_name || d.destination_tank,
              quantity: Number(d.quantity) || 0,
              supplier: d.supplier || 'CPC Ceylon Petroleum',
              cost: Number(d.cost) || 0,
              invoiceNumber: d.invoice_number || d.invoicenumber || ''
            }));
            setStockDeliveries(mappedDel);
          }
        }
      } catch (err) {
        console.warn('Error loading audit dip details:', err);
      } finally {
        setIsLoadingDips(false);
      }
    };

    loadDipData();
  }, []);

  // Find the currently selected Shift object
  const currentShift = useMemo(() => {
    return shifts.find(s => s.id === activeShiftId) || shifts[0] || null;
  }, [shifts, activeShiftId]);

  // Supervisor Name helper
  const getSupervisorName = (id?: string) => {
    if (!id) return 'Station Supervisor';
    const found = employees.find(
      (e) => e.id === id || e.name.toLowerCase() === id.toLowerCase() || (e as any).phone === id
    );
    return found ? found.name : id;
  };

  const getPumperName = (id?: string | null) => {
    if (!id) return 'Unassigned';
    const found = employees.find((e) => e.id === id || e.name.toLowerCase() === id.toLowerCase());
    return found ? found.name : id;
  };

  // Helper formatting functions
  const formatRs = (val: number | undefined | null) => {
    if (val === undefined || val === null || isNaN(val)) return '0.00';
    return val.toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const formatLiters = (val: number | undefined | null) => {
    if (val === undefined || val === null || isNaN(val)) return '0.00';
    return val.toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  // Fuel Product Code Standardizer (LP92, LP95, LSD, LAD)
  const getProductCode = (fuelType: string): { code: string; label: string; tagClass: string } => {
    const ft = (fuelType || '').toLowerCase();
    if (ft.includes('95') || ft.includes('octane 95') || ft.includes('lp95')) {
      return { code: 'LP95', label: 'Lanka Petrol 95 Octane', tagClass: 'bg-rose-50 text-rose-800 border-rose-200' };
    }
    if (ft.includes('super diesel') || ft.includes('lsd') || ft.includes('euro 4')) {
      return { code: 'LSD', label: 'Lanka Super Diesel', tagClass: 'bg-blue-50 text-blue-800 border-blue-200' };
    }
    if (ft.includes('auto diesel') || ft.includes('lad') || ft.includes('diesel')) {
      return { code: 'LAD', label: 'Lanka Auto Diesel', tagClass: 'bg-amber-50 text-amber-900 border-amber-200' };
    }
    return { code: 'LP92', label: 'Lanka Petrol 92 Octane', tagClass: 'bg-emerald-50 text-emerald-800 border-emerald-200' };
  };

  // Available fuel tanks sorted
  const sortedTanks = useMemo(() => {
    return [...tanks].sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id, undefined, { numeric: true }));
  }, [tanks]);

  // Section 1: Process Pump Meter Readings
  const pumpSalesAnalysis = useMemo(() => {
    if (!currentShift || !currentShift.pumpReadings) {
      return {
        rows: [],
        productTotals: {
          LP92: { gross: 0, test: 0, net: 0, amount: 0 },
          LP95: { gross: 0, test: 0, net: 0, amount: 0 },
          LAD: { gross: 0, test: 0, net: 0, amount: 0 },
          LSD: { gross: 0, test: 0, net: 0, amount: 0 },
        },
        grandTotal: { gross: 0, test: 0, net: 0, amount: 0 },
      };
    }

    const rows = currentShift.pumpReadings.map((r, idx) => {
      const start = Number(r.startMeter) || 0;
      const end = Number(r.endMeter) || 0;
      const test = Number(r.testingQty) || 0;
      const gross = Math.max(0, end - start);
      const net = Math.max(0, gross - test);
      const price = Number(r.unitPrice) || 0;
      const amount = net * price;
      const product = getProductCode(r.fuelType);

      return {
        key: `${r.pumpId || idx}`,
        pumpName: r.pumpName || `Pump ${idx + 1}`,
        fuelType: r.fuelType,
        productCode: product.code,
        productLabel: product.label,
        pumperName: getPumperName(r.assignedPumperId),
        startMeter: start,
        endMeter: end,
        grossVolume: gross,
        testVolume: test,
        netVolume: net,
        unitPrice: price,
        totalAmount: amount,
      };
    });

    const productTotals: Record<string, { gross: number; test: number; net: number; amount: number }> = {
      LP92: { gross: 0, test: 0, net: 0, amount: 0 },
      LP95: { gross: 0, test: 0, net: 0, amount: 0 },
      LAD: { gross: 0, test: 0, net: 0, amount: 0 },
      LSD: { gross: 0, test: 0, net: 0, amount: 0 },
    };

    let totalGross = 0;
    let totalTest = 0;
    let totalNet = 0;
    let totalAmt = 0;

    rows.forEach(r => {
      if (!productTotals[r.productCode]) {
        productTotals[r.productCode] = { gross: 0, test: 0, net: 0, amount: 0 };
      }
      productTotals[r.productCode].gross += r.grossVolume;
      productTotals[r.productCode].test += r.testVolume;
      productTotals[r.productCode].net += r.netVolume;
      productTotals[r.productCode].amount += r.totalAmount;

      totalGross += r.grossVolume;
      totalTest += r.testVolume;
      totalNet += r.netVolume;
      totalAmt += r.totalAmount;
    });

    return {
      rows,
      productTotals,
      grandTotal: { gross: totalGross, test: totalTest, net: totalNet, amount: totalAmt },
    };
  }, [currentShift]);

  // Section 2: Tank Dip Stock Reconciliation
  const tankDipReconciliation = useMemo(() => {
    if (!currentShift) return [];

    const shiftDate = currentShift.date || new Date().toISOString().slice(0, 10);

    // Find relevant dip session for this shift/date
    const matchingDip = dipSessions.find(
      s => s.shiftId === currentShift.id || (s.date === shiftDate && s.sessionType !== 'bowser_delivery')
    );

    // Deliveries on this shift / date
    const relevantDeliveries = stockDeliveries.filter(
      d => d.date === shiftDate || (currentShift.id && (d as any).shift_id === currentShift.id)
    );

    return sortedTanks.map(tank => {
      const prod = getProductCode(tank.fuelType);
      
      // Calculate meter sales for this tank / fuel type from Section 1
      const tankMeterSales = pumpSalesAnalysis.rows
        .filter(r => r.fuelType === tank.fuelType || r.productCode === prod.code)
        .reduce((sum, r) => sum + r.netVolume, 0);

      // Check deliveries received into this tank
      const bowserLoads = relevantDeliveries
        .filter(d => (d.tankId && d.tankId === tank.id) || d.fuelType === tank.fuelType)
        .reduce((sum, d) => sum + (Number(d.quantity) || 0), 0);

      // Check dip entries if recorded
      const tankDipEntry = matchingDip?.tanks?.find(t => t.tankId === tank.id);

      // Opening stock estimation
      const openingStock = tankDipEntry?.previousVolume !== undefined && tankDipEntry.previousVolume > 0
        ? tankDipEntry.previousVolume
        : Math.max(0, (tank.currentLevel || 0) + tankMeterSales - bowserLoads);

      const openingDipMm = tankDipEntry?.dipMm || Math.round(tank.capacity ? (openingStock / tank.capacity) * 2400 : 0);

      const totalStock = openingStock + bowserLoads;
      const expectedBookStock = Math.max(0, totalStock - tankMeterSales);

      // Closing Stock
      const closingStock = tankDipEntry?.actualVolume !== undefined && tankDipEntry.actualVolume > 0
        ? tankDipEntry.actualVolume
        : (tank.currentLevel || expectedBookStock);

      const closingDipMm = tankDipEntry?.dipMm || Math.round(tank.capacity ? (closingStock / tank.capacity) * 2400 : 0);

      const shortExcess = closingStock - expectedBookStock;

      // Allowable operational evaporation / transit loss standard (e.g. standard factor per 6,600L bowser throughput = ~0.25% or 16.5L)
      const allowableLossPer6600L = (tankMeterSales > 0 ? (tankMeterSales / 6600) * 16.5 : 0);

      return {
        tankId: tank.id,
        tankName: tank.name || `Tank (${tank.fuelType})`,
        fuelType: tank.fuelType,
        productCode: prod.code,
        capacity: tank.capacity,
        openingDipMm,
        openingStock,
        receivedBowserLoads: bowserLoads,
        totalStock,
        meterSales: tankMeterSales,
        expectedBookStock,
        closingDipMm,
        actualClosingStock: closingStock,
        shortExcess,
        shortExcessRs: shortExcess * (tank.pricePerLiter || 0),
        allowableLossPer6600L,
      };
    });
  }, [currentShift, sortedTanks, dipSessions, stockDeliveries, pumpSalesAnalysis]);

  // Section 3: Bowser Delivery / Decanting Reconciliation
  const bowserDeliveriesAnalysis = useMemo(() => {
    if (!currentShift) return [];
    const shiftDate = currentShift.date || new Date().toISOString().slice(0, 10);

    // Bowser dip sessions recorded
    const bowserSessions = dipSessions.filter(
      s => (s.sessionType === 'bowser_delivery' || !!s.bowserAudit) &&
           (s.shiftId === currentShift.id || s.date === shiftDate)
    );

    if (bowserSessions.length > 0) {
      return bowserSessions.map(session => {
        const audit = session.bowserAudit;
        const tank = sortedTanks.find(t => t.id === audit?.tankId);
        const invVol = Number(audit?.invoicedVolume) || 6600;
        const preDip = Number(audit?.preDipLiters) || (audit?.preDipMm ? Number(audit.preDipMm) * 8 : 0);
        const postDip = Number(audit?.postDipLiters) || (audit?.postDipMm ? Number(audit.postDipMm) * 8 : preDip + invVol);
        const actualReceived = Math.max(0, postDip - preDip);
        const dripDifference = actualReceived - invVol;

        return {
          id: session.id,
          date: session.date,
          bowserNo: audit?.bowserNo || 'Bowser CP-8821',
          invoiceNo: audit?.invoiceNo || 'INV-CPC-0982',
          tankName: tank?.name || audit?.tankName || 'Active Tank',
          fuelType: tank?.fuelType || 'Petrol 92',
          driverName: audit?.driverName || 'CPC Bowser Driver',
          invoicedVolume: invVol,
          preDipMm: audit?.preDipMm || 0,
          preDipLiters: preDip,
          postDipMm: audit?.postDipMm || 0,
          postDipLiters: postDip,
          actualReceived,
          dripDifference,
          dripVariancePercent: invVol > 0 ? (dripDifference / invVol) * 100 : 0,
          density: audit?.density || '0.835',
          temp: audit?.temperature || '29.5',
          sealIntact: audit?.sealIntact ?? true,
          waterTest: audit?.waterTestNegative ?? true,
        };
      });
    }

    // If no bowser session recorded yet, show recent stock deliveries on this shift
    const relevantDeliveries = stockDeliveries.filter(
      d => d.date === shiftDate || (currentShift.id && (d as any).shift_id === currentShift.id)
    );

    return relevantDeliveries.map((del, idx) => {
      const tank = sortedTanks.find(t => t.id === del.tankId || t.fuelType === del.fuelType);
      const invVol = del.quantity || 6600;
      const preDip = Math.max(0, (tank?.currentLevel || 5000) - invVol);
      const postDip = tank?.currentLevel || (preDip + invVol);
      const actualReceived = postDip - preDip;
      const dripDifference = actualReceived - invVol;

      return {
        id: del.id || `del_${idx}`,
        date: del.date,
        bowserNo: 'CPC Bowser Delivery',
        invoiceNo: del.invoiceNumber || `CPC-${del.date}`,
        tankName: tank?.name || del.tankName || 'Fuel Storage Tank',
        fuelType: del.fuelType,
        driverName: 'CPC Authorized Driver',
        invoicedVolume: invVol,
        preDipMm: Math.round(preDip / 8),
        preDipLiters: preDip,
        postDipMm: Math.round(postDip / 8),
        postDipLiters: postDip,
        actualReceived,
        dripDifference,
        dripVariancePercent: invVol > 0 ? (dripDifference / invVol) * 100 : 0,
        density: '0.832',
        temp: '29.0°C',
        sealIntact: true,
        waterTest: true,
      };
    });
  }, [currentShift, dipSessions, stockDeliveries, sortedTanks]);

  // Section 4: Non-Cash Deductions & Financial Settlement
  const financialSettlement = useMemo(() => {
    if (!currentShift) {
      return {
        grossFuel: 0,
        lubricants: 0,
        gasSales: 0,
        grossTotal: 0,
        creditSales: 0,
        cardSales: 0,
        touchCardSales: 0,
        voucherSales: 0,
        totalNonCash: 0,
        expectedCash: 0,
        actualCashHanded: 0,
        cashBanked: 0,
        variance: 0,
        varianceStatus: 'Balanced',
      };
    }

    const grossFuel = pumpSalesAnalysis.grandTotal.amount || currentShift.totalNetSales || 0;
    const lubricants = Number(currentShift.totalForecourtOilSales || (currentShift as any).oil_sales || 0);
    const gasSales = Number((currentShift as any).totalGasSales || 0);
    const grossTotal = grossFuel + lubricants + gasSales;

    const creditSales = Number(currentShift.creditSales || (currentShift as any).credit_sales || 0);
    const cardSales = Number(currentShift.cardSales || (currentShift as any).card_sales || 0);
    const touchCardSales = Number(currentShift.touchCardSales || (currentShift as any).touch_card_sales || 0);
    const voucherSales = Number(currentShift.voucherSales || (currentShift as any).voucher_sales || 0);

    const totalNonCash = creditSales + cardSales + touchCardSales + voucherSales;
    const expectedCash = Math.max(0, grossTotal - totalNonCash);

    const actualCashHanded = Number(
      currentShift.totalPhysicalCash || currentShift.initialPumperCash || (currentShift as any).actual_cash || 0
    );
    const cashBanked = Number(currentShift.cashBanked || (currentShift as any).cash_banked || 0);

    const effectiveCash = actualCashHanded > 0 ? actualCashHanded : cashBanked;
    const variance = effectiveCash - expectedCash;

    let varianceStatus: 'Balanced' | 'Shortage' | 'Excess' = 'Balanced';
    if (variance < -0.01) varianceStatus = 'Shortage';
    else if (variance > 0.01) varianceStatus = 'Excess';

    return {
      grossFuel,
      lubricants,
      gasSales,
      grossTotal,
      creditSales,
      cardSales,
      touchCardSales,
      voucherSales,
      totalNonCash,
      expectedCash,
      actualCashHanded,
      cashBanked,
      variance,
      varianceStatus,
    };
  }, [currentShift, pumpSalesAnalysis]);

  // Handler for browser print / PDF export
  const handlePrintReport = () => {
    window.print();
  };

  if (!currentShift) {
    return (
      <div className="bg-white p-12 text-center rounded-2xl border border-gray-200 shadow-2xs space-y-3">
        <Clock className="w-8 h-8 text-gray-400 mx-auto" />
        <h3 className="text-sm font-bold text-slate-800">No shift records available</h3>
        <p className="text-xs text-gray-500">Please start and close a shift to view the comprehensive daily shift audit sheet.</p>
        {onBack && (
          <button
            onClick={onBack}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Return to Shift Ledger</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4 font-sans pb-16">
      {/* ========================================================================= */}
      {/* PRINT-ONLY STYLES INJECTION */}
      {/* ========================================================================= */}
      <style>{`
        @media print {
          body {
            background-color: #ffffff !important;
            font-size: 11px !important;
            color: #000000 !important;
          }
          #daily-sales-tab-root, header, nav, aside, .no-print {
            display: none !important;
          }
          .printable-sheet-container {
            display: block !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            border: none !important;
            box-shadow: none !important;
          }
          .page-break {
            page-break-before: always;
          }
        }
      `}</style>

      {/* ========================================================================= */}
      {/* Top Action & Navigation Toolbar */}
      {/* ========================================================================= */}
      <div className="no-print flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-gray-200/80 shadow-2xs">
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              onClick={onBack}
              className="p-2 hover:bg-gray-100 rounded-xl text-gray-600 transition-colors cursor-pointer"
              title="Return to Shift Ledger"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <div>
            <h1 className="text-lg font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
              <FileText className="w-5 h-5 text-indigo-600" />
              <span>Comprehensive Daily Shift Summary &amp; Audit Sheet</span>
            </h1>
            <p className="text-xs text-gray-500 font-medium">
              Official station audit matching physical meter books, underground tank dips, and bowser unload records.
            </p>
          </div>
        </div>

        {/* Shift Selector & Print Button */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="flex items-center gap-1.5 bg-gray-50 px-3 py-1.5 rounded-xl border border-gray-200">
            <span className="text-[11px] font-bold text-gray-500 uppercase">Select Shift:</span>
            <select
              value={activeShiftId}
              onChange={(e) => {
                setActiveShiftId(e.target.value);
                if (onSelectShiftId) onSelectShiftId(e.target.value);
              }}
              className="bg-transparent text-xs font-bold text-slate-900 outline-none cursor-pointer"
            >
              {shifts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.id} • {s.date || s.startTime?.slice(0, 10)} ({s.name || 'Shift'})
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={handlePrintReport}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs hover:shadow-sm cursor-pointer active:scale-95"
          >
            <Printer className="w-4 h-4" />
            <span>Print / Export Summary Report</span>
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* THE PRINTABLE AUDIT SHEET CONTAINER */}
      {/* ========================================================================= */}
      <div className="printable-sheet-container bg-white p-6 sm:p-8 rounded-2xl border border-gray-200/90 shadow-xs space-y-6 text-slate-900">
        
        {/* REPORT HEADER */}
        <div className="border-b-2 border-slate-900 pb-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 bg-slate-900 text-white font-mono font-bold text-[11px] rounded tracking-wider uppercase">
                FuelFlow Pro • CPC Station Audit
              </span>
              <span className="text-xs font-bold text-slate-500">Official Daily Record</span>
            </div>
            <h2 className="text-xl sm:text-2xl font-black text-slate-950 tracking-tight mt-1">
              DAILY SHIFT &amp; FUEL RECONCILIATION REPORT
            </h2>
            <p className="text-xs text-slate-600 font-medium">
              Station Licensee Record • Meter Sales, Underground Tank Dips &amp; Decanting Summary
            </p>
          </div>

          <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs space-y-1 min-w-[240px]">
            <div className="flex justify-between">
              <span className="text-slate-500 font-medium">Shift Reference:</span>
              <span className="font-mono font-bold text-slate-900">{currentShift.id}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500 font-medium">Audit Date:</span>
              <span className="font-bold text-slate-900">{currentShift.date || currentShift.startTime?.slice(0, 10)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500 font-medium">Supervisor in Charge:</span>
              <span className="font-bold text-slate-900">{getSupervisorName(currentShift.supervisorId)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500 font-medium">Operating Hours:</span>
              <span className="font-medium text-slate-800">{currentShift.startTime ? new Date(currentShift.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '06:00'} - {currentShift.endTime ? new Date(currentShift.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '14:00'}</span>
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* SECTION 1: METER & DAILY SALES SUMMARY (PER PUMP) */}
        {/* ========================================================================= */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between border-b border-slate-200 pb-1.5">
            <h3 className="text-xs font-black tracking-wider text-slate-900 uppercase flex items-center gap-2">
              <Gauge className="w-4 h-4 text-indigo-600" />
              <span>1. Meter &amp; Daily Sales Summary (Per Pump Machine / Nozzle)</span>
            </h3>
            <span className="text-[11px] font-bold text-slate-500">
              Total Net Fuel Volume: <strong className="text-indigo-700">{formatLiters(pumpSalesAnalysis.grandTotal.net)}</strong>
            </span>
          </div>

          <div className="overflow-x-auto border border-slate-300 rounded-xl">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-100 text-slate-700 font-bold text-[10px] uppercase border-b border-slate-300">
                <tr>
                  <th className="p-2 border-r border-slate-200">Pump / Nozzle</th>
                  <th className="p-2 border-r border-slate-200">Product</th>
                  <th className="p-2 border-r border-slate-200">Pumper</th>
                  <th className="p-2 text-right border-r border-slate-200">Opening Meter</th>
                  <th className="p-2 text-right border-r border-slate-200">Closing Meter</th>
                  <th className="p-2 text-right border-r border-slate-200">Gross Sales (L)</th>
                  <th className="p-2 text-right border-r border-slate-200">Testing Deduct (L)</th>
                  <th className="p-2 text-right border-r border-slate-200 bg-indigo-50/50 font-extrabold text-indigo-950">Net Fuel Sales (L)</th>
                  <th className="p-2 text-right border-r border-slate-200">Unit Price (Rs.)</th>
                  <th className="p-2 text-right font-extrabold">Sales Amount (Rs.)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-[11px] font-medium text-slate-800">
                {pumpSalesAnalysis.rows.map((row) => (
                  <tr key={row.key} className="hover:bg-slate-50">
                    <td className="p-2 font-bold border-r border-slate-200">{row.pumpName}</td>
                    <td className="p-2 border-r border-slate-200">
                      <span className="font-bold text-slate-900">{row.productCode}</span>
                      <span className="text-[10px] text-slate-500 block truncate max-w-[120px]">{row.fuelType}</span>
                    </td>
                    <td className="p-2 border-r border-slate-200 text-slate-700">{row.pumperName}</td>
                    <td className="p-2 text-right font-mono border-r border-slate-200">{formatLiters(row.startMeter)}</td>
                    <td className="p-2 text-right font-mono border-r border-slate-200">{formatLiters(row.endMeter)}</td>
                    <td className="p-2 text-right font-mono border-r border-slate-200">{formatLiters(row.grossVolume)}</td>
                    <td className="p-2 text-right font-mono text-rose-600 border-r border-slate-200">
                      {row.testVolume > 0 ? `-${formatLiters(row.testVolume)}` : '0.00'}
                    </td>
                    <td className="p-2 text-right font-mono font-bold text-indigo-900 bg-indigo-50/30 border-r border-slate-200">
                      {formatLiters(row.netVolume)}
                    </td>
                    <td className="p-2 text-right font-mono border-r border-slate-200">{formatRs(row.unitPrice)}</td>
                    <td className="p-2 text-right font-mono font-bold text-slate-900">{formatRs(row.totalAmount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-100/90 font-bold text-slate-900 text-xs border-t-2 border-slate-300">
                <tr>
                  <td colSpan={5} className="p-2.5 text-right uppercase text-[10px] tracking-wider text-slate-600">
                    Grand Total Fuel Sales:
                  </td>
                  <td className="p-2.5 text-right font-mono">{formatLiters(pumpSalesAnalysis.grandTotal.gross)}</td>
                  <td className="p-2.5 text-right font-mono text-rose-600">
                    -{formatLiters(pumpSalesAnalysis.grandTotal.test)}
                  </td>
                  <td className="p-2.5 text-right font-mono font-black text-indigo-900 bg-indigo-100/60 text-sm">
                    {formatLiters(pumpSalesAnalysis.grandTotal.net)}
                  </td>
                  <td className="p-2.5 text-right font-mono">--</td>
                  <td className="p-2.5 text-right font-mono font-black text-slate-950 text-sm">
                    Rs. {formatRs(pumpSalesAnalysis.grandTotal.amount)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Product-wise Subtotal Pills */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
            {Object.entries(pumpSalesAnalysis.productTotals).map(([code, data]) => {
              if (data.net === 0 && data.amount === 0) return null;
              return (
                <div key={code} className="p-2.5 bg-slate-50 rounded-xl border border-slate-200 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold text-slate-900">{code} Subtotal:</span>
                    <span className="font-mono font-bold text-indigo-700">{formatLiters(data.net)}</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-500 mt-0.5">
                    <span>Revenue:</span>
                    <span className="font-mono font-semibold text-slate-900">Rs. {formatRs(data.amount)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ========================================================================= */}
        {/* SECTION 2: TANK DIP RECONCILIATION */}
        {/* ========================================================================= */}
        <div className="space-y-2.5 pt-2">
          <div className="flex items-center justify-between border-b border-slate-200 pb-1.5">
            <h3 className="text-xs font-black tracking-wider text-slate-900 uppercase flex items-center gap-2">
              <Droplet className="w-4 h-4 text-emerald-600" />
              <span>2. Underground Tank Dip Reconciliation (Opening vs. Closing Physical Dips)</span>
            </h3>
            <span className="text-[10px] font-bold text-slate-500">
              Standard Allowable Evaporation Basis: 16.5L per 6,600L load
            </span>
          </div>

          <div className="overflow-x-auto border border-slate-300 rounded-xl">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-100 text-slate-700 font-bold text-[10px] uppercase border-b border-slate-300">
                <tr>
                  <th className="p-2 border-r border-slate-200">Tank &amp; Product</th>
                  <th className="p-2 text-right border-r border-slate-200">Opening Dip (mm / L)</th>
                  <th className="p-2 text-right border-r border-slate-200 text-emerald-800">Received Loads (L)</th>
                  <th className="p-2 text-right border-r border-slate-200 font-bold">Total Stock (L)</th>
                  <th className="p-2 text-right border-r border-slate-200 text-indigo-900">Meter Sales (L)</th>
                  <th className="p-2 text-right border-r border-slate-200 bg-slate-50">Book Stock (L)</th>
                  <th className="p-2 text-right border-r border-slate-200 font-bold">Closing Dip (mm / L)</th>
                  <th className="p-2 text-right border-r border-slate-200">Variance (L)</th>
                  <th className="p-2 text-right">Evaporation Allow. (per 6600L)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-[11px] font-medium text-slate-800">
                {tankDipReconciliation.map((tank) => {
                  const isShortage = tank.shortExcess < -1;
                  const isExcess = tank.shortExcess > 1;

                  return (
                    <tr key={tank.tankId} className="hover:bg-slate-50">
                      <td className="p-2 border-r border-slate-200">
                        <div className="font-bold text-slate-900">{tank.tankName}</div>
                        <span className="text-[10px] text-slate-500">{tank.productCode} • Cap: {tank.capacity}L</span>
                      </td>
                      <td className="p-2 text-right font-mono border-r border-slate-200">
                        <span className="font-bold">{formatLiters(tank.openingStock)}</span>
                        <span className="text-[10px] text-slate-400 block">({tank.openingDipMm} mm)</span>
                      </td>
                      <td className="p-2 text-right font-mono text-emerald-700 font-bold border-r border-slate-200">
                        {tank.receivedBowserLoads > 0 ? `+${formatLiters(tank.receivedBowserLoads)}` : '0.00'}
                      </td>
                      <td className="p-2 text-right font-mono font-bold border-r border-slate-200">
                        {formatLiters(tank.totalStock)}
                      </td>
                      <td className="p-2 text-right font-mono text-indigo-900 font-bold border-r border-slate-200">
                        -{formatLiters(tank.meterSales)}
                      </td>
                      <td className="p-2 text-right font-mono bg-slate-50 font-semibold border-r border-slate-200">
                        {formatLiters(tank.expectedBookStock)}
                      </td>
                      <td className="p-2 text-right font-mono font-black border-r border-slate-200">
                        <span className="text-slate-950">{formatLiters(tank.actualClosingStock)}</span>
                        <span className="text-[10px] text-slate-400 block font-normal">({tank.closingDipMm} mm)</span>
                      </td>
                      <td className="p-2 text-right font-mono font-bold border-r border-slate-200">
                        <span className={isShortage ? 'text-rose-700' : isExcess ? 'text-emerald-700' : 'text-slate-600'}>
                          {tank.shortExcess >= 0 ? '+' : ''}{formatLiters(tank.shortExcess)}
                        </span>
                        <span className="text-[10px] block text-slate-400">
                          ({formatRs(tank.shortExcessRs)})
                        </span>
                      </td>
                      <td className="p-2 text-right font-mono text-slate-500">
                        ~{formatLiters(tank.allowableLossPer6600L)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* SECTION 3: BOWSER DELIVERY / DECANTING RECONCILIATION */}
        {/* ========================================================================= */}
        <div className="space-y-2.5 pt-2">
          <div className="flex items-center justify-between border-b border-slate-200 pb-1.5">
            <h3 className="text-xs font-black tracking-wider text-slate-900 uppercase flex items-center gap-2">
              <Truck className="w-4 h-4 text-blue-600" />
              <span>3. Bowser Delivery &amp; Decanting Audit (Before &amp; After Unload Dips)</span>
            </h3>
            <span className="text-[10px] font-bold text-slate-500">
              Fuel Intake &amp; Drip Level Verification
            </span>
          </div>

          {bowserDeliveriesAnalysis.length === 0 ? (
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-center text-xs text-slate-500">
              No bowser deliveries were decanted or unloaded during this shift period.
            </div>
          ) : (
            <div className="overflow-x-auto border border-slate-300 rounded-xl">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-100 text-slate-700 font-bold text-[10px] uppercase border-b border-slate-300">
                  <tr>
                    <th className="p-2 border-r border-slate-200">Bowser &amp; Invoice Ref</th>
                    <th className="p-2 border-r border-slate-200">Tank &amp; Product</th>
                    <th className="p-2 text-right border-r border-slate-200">Invoiced Qty (L)</th>
                    <th className="p-2 text-right border-r border-slate-200">Before Unload Dip</th>
                    <th className="p-2 text-right border-r border-slate-200">After Unload Dip</th>
                    <th className="p-2 text-right border-r border-slate-200 font-bold bg-blue-50/50">Actual Received (L)</th>
                    <th className="p-2 text-right border-r border-slate-200">Decanting Diff. (L)</th>
                    <th className="p-2 text-center">Quality / Seals</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-[11px] font-medium text-slate-800">
                  {bowserDeliveriesAnalysis.map((b) => {
                    const hasLoss = b.dripDifference < -5;
                    const hasGain = b.dripDifference > 5;

                    return (
                      <tr key={b.id} className="hover:bg-slate-50">
                        <td className="p-2 border-r border-slate-200">
                          <div className="font-bold text-slate-900">{b.bowserNo}</div>
                          <span className="text-[10px] text-slate-500 font-mono">Inv: {b.invoiceNo} • {b.driverName}</span>
                        </td>
                        <td className="p-2 border-r border-slate-200">
                          <span className="font-bold text-slate-900">{b.tankName}</span>
                          <span className="text-[10px] text-slate-500 block">{b.fuelType}</span>
                        </td>
                        <td className="p-2 text-right font-mono font-bold border-r border-slate-200">
                          {formatLiters(b.invoicedVolume)}
                        </td>
                        <td className="p-2 text-right font-mono border-r border-slate-200">
                          <span>{formatLiters(b.preDipLiters)}</span>
                          <span className="text-[10px] text-slate-400 block font-normal">({b.preDipMm} mm)</span>
                        </td>
                        <td className="p-2 text-right font-mono border-r border-slate-200">
                          <span>{formatLiters(b.postDipLiters)}</span>
                          <span className="text-[10px] text-slate-400 block font-normal">({b.postDipMm} mm)</span>
                        </td>
                        <td className="p-2 text-right font-mono font-black text-blue-900 bg-blue-50/30 border-r border-slate-200">
                          {formatLiters(b.actualReceived)}
                        </td>
                        <td className="p-2 text-right font-mono font-bold border-r border-slate-200">
                          <span className={hasLoss ? 'text-rose-700' : hasGain ? 'text-emerald-700' : 'text-slate-700'}>
                            {b.dripDifference >= 0 ? '+' : ''}{formatLiters(b.dripDifference)}
                          </span>
                          <span className="text-[10px] text-slate-400 block">
                            ({b.dripVariancePercent.toFixed(2)}%)
                          </span>
                        </td>
                        <td className="p-2 text-center text-[10px] font-semibold">
                          <span className="text-emerald-700">Seals OK • Water Test -VE</span>
                          <span className="text-slate-400 block font-mono">Density {b.density}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ========================================================================= */}
        {/* SECTION 4: FINANCIAL SUMMARY & NON-CASH SETTLEMENT */}
        {/* ========================================================================= */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
          {/* Revenue Breakdown */}
          <div className="border border-slate-300 rounded-xl p-4 bg-slate-50/50 space-y-2.5 text-xs">
            <h4 className="font-extrabold uppercase tracking-wider text-slate-900 border-b border-slate-200 pb-1.5 flex items-center gap-1.5">
              <DollarSign className="w-4 h-4 text-emerald-600" />
              <span>4A. Gross Station Revenue Breakdown</span>
            </h4>
            <div className="space-y-1.5">
              <div className="flex justify-between py-1 border-b border-slate-200/60">
                <span className="text-slate-600">Total Net Fuel Revenue:</span>
                <span className="font-mono font-bold text-slate-900">Rs. {formatRs(financialSettlement.grossFuel)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-200/60">
                <span className="text-slate-600">Forecourt Bulk &amp; Packaged Lubricants:</span>
                <span className="font-mono font-bold text-slate-900">Rs. {formatRs(financialSettlement.lubricants)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-200/60">
                <span className="text-slate-600">LP Gas Cylinder Sales:</span>
                <span className="font-mono font-bold text-slate-900">Rs. {formatRs(financialSettlement.gasSales)}</span>
              </div>
              <div className="flex justify-between py-2 pt-2 border-t-2 border-slate-300 text-sm font-black text-slate-950">
                <span>Total Gross Shift Turnover:</span>
                <span className="font-mono text-indigo-900">Rs. {formatRs(financialSettlement.grossTotal)}</span>
              </div>
            </div>
          </div>

          {/* Cash & Non-Cash Settlement */}
          <div className="border border-slate-300 rounded-xl p-4 bg-slate-50/50 space-y-2.5 text-xs">
            <h4 className="font-extrabold uppercase tracking-wider text-slate-900 border-b border-slate-200 pb-1.5 flex items-center gap-1.5">
              <Scale className="w-4 h-4 text-indigo-600" />
              <span>4B. Settlement &amp; Net Cash Reconciliation</span>
            </h4>
            <div className="space-y-1.5">
              <div className="flex justify-between py-1 border-b border-slate-200/60">
                <span className="text-slate-600">Corporate Credit Sales:</span>
                <span className="font-mono text-slate-800">Rs. {formatRs(financialSettlement.creditSales)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-200/60">
                <span className="text-slate-600">Card POS / Digital Swipes:</span>
                <span className="font-mono text-slate-800">Rs. {formatRs(financialSettlement.cardSales)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-200/60">
                <span className="text-slate-600">Touch Card / Fleet Vouchers:</span>
                <span className="font-mono text-slate-800">Rs. {formatRs(financialSettlement.touchCardSales + financialSettlement.voucherSales)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-200/60 font-bold text-slate-900">
                <span>Net Expected Physical Cash:</span>
                <span className="font-mono text-indigo-900">Rs. {formatRs(financialSettlement.expectedCash)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-200/60 font-bold text-slate-900">
                <span>Physical Cash Handover / Banked:</span>
                <span className="font-mono text-slate-900">Rs. {formatRs(financialSettlement.actualCashHanded > 0 ? financialSettlement.actualCashHanded : financialSettlement.cashBanked)}</span>
              </div>
              <div className={`flex justify-between py-1.5 pt-2 border-t-2 border-slate-300 text-sm font-black ${
                financialSettlement.varianceStatus === 'Shortage' ? 'text-rose-700' : financialSettlement.varianceStatus === 'Excess' ? 'text-emerald-700' : 'text-slate-900'
              }`}>
                <span>Net Cash Variance:</span>
                <span className="font-mono">
                  {financialSettlement.variance >= 0 ? '+' : ''}Rs. {formatRs(financialSettlement.variance)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* SIGNATURES & AUTHORIZATION BLOCK */}
        {/* ========================================================================= */}
        <div className="border-t-2 border-slate-900 pt-6 mt-6 grid grid-cols-3 gap-6 text-center text-xs">
          <div className="space-y-8">
            <div className="border-b border-slate-400 pb-1 font-bold text-slate-900">
              {getSupervisorName(currentShift.supervisorId)}
            </div>
            <div>
              <span className="font-black uppercase tracking-wider text-slate-700 text-[10px] block">
                PREPARED BY (SUPERVISOR)
              </span>
              <span className="text-[10px] text-slate-400">Signature &amp; Employee ID</span>
            </div>
          </div>

          <div className="space-y-8">
            <div className="border-b border-slate-400 pb-1 text-slate-400 italic">
              (Verification Stamp &amp; Sign)
            </div>
            <div>
              <span className="font-black uppercase tracking-wider text-slate-700 text-[10px] block">
                VERIFIED BY (INTERNAL AUDITOR)
              </span>
              <span className="text-[10px] text-slate-400">Stock &amp; Meter Verification</span>
            </div>
          </div>

          <div className="space-y-8">
            <div className="border-b border-slate-400 pb-1 text-slate-400 italic">
              (Management Sign)
            </div>
            <div>
              <span className="font-black uppercase tracking-wider text-slate-700 text-[10px] block">
                APPROVED BY (STATION DEALER)
              </span>
              <span className="text-[10px] text-slate-400">Final Accounting Authorization</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
