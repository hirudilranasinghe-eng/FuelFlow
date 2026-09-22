/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Calendar, Download, Search, RefreshCw, Eye, X, Fuel, Droplet, 
  DollarSign, TrendingUp, AlertTriangle, CheckCircle2, ChevronRight,
  Clock, User, Layers, Receipt, ArrowUpDown, Filter, BarChart3,
  CreditCard, ShieldAlert, Sparkles, FileText, ChevronDown, Check,
  ArrowLeft, Landmark, UserCheck
} from 'lucide-react';
import { Shift, Employee, FuelTank, OilTank, PumpReading, ChamberReading, ShiftCounterSales } from '../types';
import { supabase } from '../lib/supabase';

interface DailySalesTabProps {
  shiftHistory?: Shift[];
  setShiftHistory?: React.Dispatch<React.SetStateAction<Shift[]>>;
  onDeleteShift?: (shiftId: string) => void;
  employees?: Employee[];
  tanks?: FuelTank[];
  oilTanks?: OilTank[];
}

export interface DailyFuelProductSummary {
  fuelType: string;
  litersSold: number;
  ratePerLiter: number;
  revenue: number;
  volumePercentage: number;
}

export interface DailyChamberSummary {
  chamberNumber: number;
  chamberId?: string;
  grade: string;
  openingLevel: number;
  closingLevel: number;
  soldLiters: number;
  ratePerLiter: number;
  totalAmount: number;
}

export interface IndividualShiftRecord {
  id: string;
  name: string;
  supervisorId: string;
  supervisorName: string;
  startTime: string;
  endTime?: string;
  formattedDate: string;
  formattedTimeWindow: string;
  durationText: string;
  isActive: boolean;
  totalFuelVolume: number;
  totalForecourtOilSales: number;
  totalGasSales: number;
  totalPackagedLubeSales: number;
  grossFuelRevenue: number;
  grossRevenue: number;
  creditSales: number;
  cardSales: number;
  touchCardSales: number;
  voucherSales: number;
  totalNonCash: number;
  expectedCash: number;
  handedOverCash: number;
  cashBanked: number;
  variance: number;
  varianceStatus: 'Balanced' | 'Shortage' | 'Excess';
  pumperCount: number;
  pumperNames: string[];
  handoverNotes?: string;
  replacementPumperId?: string;
  fuelBreakdown: Record<string, DailyFuelProductSummary>;
  chamberBreakdown: DailyChamberSummary[];
  pumpReadings: PumpReading[];
  rawShift: Shift;
}

export default function DailySalesTab({
  shiftHistory = [],
  employees = [],
  tanks = [],
  oilTanks = [],
}: DailySalesTabProps) {
  // Live Supabase shifts state
  const [supabaseShifts, setSupabaseShifts] = useState<Shift[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Filters state
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'active'>('all');

  // Slide-over / modal state for single shift audit
  const [selectedShiftRecord, setSelectedShiftRecord] = useState<IndividualShiftRecord | null>(null);

  // Helper for Sri Lankan Rupee currency formatting
  const formatRs = (amount: number | undefined | null): string => {
    if (amount === undefined || amount === null || isNaN(amount)) return 'Rs. 0.00';
    const isNegative = amount < -0.001;
    const absVal = Math.abs(amount).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${isNegative ? '-' : ''}Rs. ${absVal}`;
  };

  const formatLiters = (liters: number | undefined | null): string => {
    if (liters === undefined || liters === null || isNaN(liters)) return '0.00 L';
    return `${liters.toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} L`;
  };

  // Name resolution helpers
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

  // Tank price lookup map
  const tankPriceMap = useMemo(() => {
    const map = new Map<string, number>();
    tanks.forEach((t) => {
      if (t.fuelType && t.pricePerLiter) {
        map.set(t.fuelType, t.pricePerLiter);
      }
    });
    return map;
  }, [tanks]);

  // Fetch shifts directly from Supabase for real-time audit accuracy
  const fetchShifts = async (showRefreshIndicator = false) => {
    if (showRefreshIndicator) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setErrorMessage(null);

    try {
      const isConfigured = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
      if (!isConfigured) {
        setSupabaseShifts([]);
        setIsLoading(false);
        setIsRefreshing(false);
        return;
      }

      // 1. Fetch all shifts and their pump readings
      const { data: shiftsData, error } = await supabase
        .from('shifts')
        .select(`
          *,
          pumpReadings:pump_readings(*)
        `)
        .order('starttime', { ascending: false });

      if (error) {
        console.warn('Supabase fetch error in DailySalesTab:', error.message);
        setErrorMessage(error.message);
        setSupabaseShifts([]);
        setIsLoading(false);
        setIsRefreshing(false);
        return;
      }

      if (!shiftsData || shiftsData.length === 0) {
        setSupabaseShifts([]);
        setIsLoading(false);
        setIsRefreshing(false);
        return;
      }

      // 2. Query shift_bank_deposits to get exact banked amounts per shift
      let depositsByShift: Record<string, number> = {};
      try {
        const { data: depositsData } = await supabase
          .from('shift_bank_deposits')
          .select('shift_id, deposited_amount');
        if (depositsData && Array.isArray(depositsData)) {
          depositsData.forEach((d: any) => {
            const sId = d.shift_id || d.shiftId;
            const amt = Number(d.deposited_amount || d.depositedAmount || d.amount) || 0;
            if (sId) {
              depositsByShift[sId] = (depositsByShift[sId] || 0) + amt;
            }
          });
        }
      } catch (depErr) {
        console.warn('Notice loading shift_bank_deposits in DailySalesTab:', depErr);
      }

      // 3. Query all non-cash tables (credit_transactions, credit_sales, card_sales, touch_card_sales, voucher_sales)
      let creditByShift: Record<string, number> = {};
      let cardByShift: Record<string, number> = {};
      let touchCardByShift: Record<string, number> = {};
      let voucherByShift: Record<string, number> = {};

      try {
        const { data: creditData } = await supabase
          .from('credit_transactions')
          .select('shift_id, amount');
        if (creditData && Array.isArray(creditData)) {
          creditData.forEach((c: any) => {
            const sId = c.shift_id;
            const amt = Number(c.amount) || 0;
            if (sId) {
              creditByShift[sId] = (creditByShift[sId] || 0) + amt;
            }
          });
        }
      } catch (cErr) {
        console.warn('Notice loading credit_transactions in DailySalesTab:', cErr);
      }

      try {
        const { data: csData } = await supabase
          .from('credit_sales')
          .select('shift_id, amount, credit_amount, total_amount');
        if (csData && Array.isArray(csData)) {
          let csSumByShift: Record<string, number> = {};
          csData.forEach((c: any) => {
            const sId = c.shift_id || c.shiftId;
            const amt = Number(c.amount || c.credit_amount || c.total_amount) || 0;
            if (sId) {
              csSumByShift[sId] = (csSumByShift[sId] || 0) + amt;
            }
          });
          Object.entries(csSumByShift).forEach(([sId, sumAmt]) => {
            creditByShift[sId] = Math.max(creditByShift[sId] || 0, sumAmt);
          });
        }
      } catch (_) {}

      try {
        const { data: cardData } = await supabase
          .from('card_sales')
          .select('shift_id, amount, card_amount, total_amount');
        if (cardData && Array.isArray(cardData)) {
          cardData.forEach((c: any) => {
            const sId = c.shift_id || c.shiftId;
            const amt = Number(c.amount || c.card_amount || c.total_amount) || 0;
            if (sId) {
              cardByShift[sId] = (cardByShift[sId] || 0) + amt;
            }
          });
        }
      } catch (_) {}

      try {
        const { data: tcData } = await supabase
          .from('touch_card_sales')
          .select('shift_id, amount, touch_card_amount, total_amount');
        if (tcData && Array.isArray(tcData)) {
          tcData.forEach((c: any) => {
            const sId = c.shift_id || c.shiftId;
            const amt = Number(c.amount || c.touch_card_amount || c.total_amount) || 0;
            if (sId) {
              touchCardByShift[sId] = (touchCardByShift[sId] || 0) + amt;
            }
          });
        }
      } catch (_) {}

      try {
        const { data: vData } = await supabase
          .from('voucher_sales')
          .select('shift_id, amount, voucher_amount, total_amount');
        if (vData && Array.isArray(vData)) {
          vData.forEach((c: any) => {
            const sId = c.shift_id || c.shiftId;
            const amt = Number(c.amount || c.voucher_amount || c.total_amount) || 0;
            if (sId) {
              voucherByShift[sId] = (voucherByShift[sId] || 0) + amt;
            }
          });
        }
      } catch (_) {}

      const mapped: Shift[] = shiftsData.map((s: any) => {
        const bankedFromDb = depositsByShift[s.id];
        const shiftBanked = bankedFromDb !== undefined 
          ? bankedFromDb 
          : Number(s.cash_banked ?? s.cashbanked ?? s.cashBanked) || 0;

        const shiftCreditSum = creditByShift[s.id] || Number(s.credit_sales ?? s.creditsales ?? s.creditSales ?? s.total_credit_sales) || 0;
        const shiftCardSum = cardByShift[s.id] || Number(s.card_sales ?? s.cardsales ?? s.cardSales ?? s.total_card_sales) || 0;
        const shiftTouchCardSum = touchCardByShift[s.id] || Number(s.touch_card_sales ?? s.touchcardsales ?? s.touchCardSales ?? s.total_touch_card_sales) || 0;
        const shiftVoucherSum = voucherByShift[s.id] || Number(s.voucher_sales ?? s.vouchersales ?? s.voucherSales ?? s.total_voucher_sales) || 0;

        let parsedCounterSales: ShiftCounterSales | undefined = undefined;
        if (s.counter_sales || s.countersales || s.counterSales) {
          try {
            const raw = s.counter_sales || s.countersales || s.counterSales;
            parsedCounterSales = typeof raw === 'string' ? JSON.parse(raw) : raw;
          } catch (_) {}
        }
        if (!parsedCounterSales) {
          try {
            const local = localStorage.getItem(`fuelflow_counter_sales_${s.id}`);
            if (local) parsedCounterSales = JSON.parse(local);
          } catch (_) {}
        }

        return {
          id: s.id,
          name: s.name || `Shift ${s.id}`,
          supervisorId: s.supervisorid || s.supervisor_id || s.supervisorId || 'Supervisor',
          startTime: s.starttime || s.start_time || s.startTime || new Date().toISOString(),
          endTime: s.endtime || s.end_time || s.endTime,
          isActive: s.isactive ?? s.is_active ?? false,
          totalFuelSold: Number(s.totalfuelsold || s.total_fuel_sold) || 0,
          totalNetSold: Number(s.totalnetsold || s.total_net_sold) || 0,
          totalNetSales: Number(s.totalnetsales || s.total_net_sales) || 0,
          counterSales: parsedCounterSales,
          initialPumperCash: Number(s.initialpumpercash || s.initial_pumper_cash) || 0,
          replacementPumperCash: Number(s.replacementpumpercash || s.replacement_pumper_cash) || 0,
          totalPhysicalCash: Number(s.totalphysicalcash || s.total_physical_cash) || 0,
          cashVariance: Number(s.cashvariance || s.cash_variance) || 0,
          cashBanked: shiftBanked,
          cash_banked: shiftBanked,
          credit_sales: shiftCreditSum,
          card_sales: shiftCardSum,
          touch_card_sales: shiftTouchCardSum,
          voucher_sales: shiftVoucherSum,
          creditSales: shiftCreditSum,
          cardSales: shiftCardSum,
          touchCardSales: shiftTouchCardSum,
          voucherSales: shiftVoucherSum,
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
            creditSalesAmount: Number(r.credit_sales_amount ?? r.creditsalesamount ?? r.creditSalesAmount) || 0,
            cardSalesAmount: Number(r.card_sales_amount ?? r.cardsalesamount ?? r.cardSalesAmount) || 0,
            touchCardSalesAmount: Number(r.touch_card_sales_amount ?? r.touchcardsalesamount ?? r.touchCardSalesAmount) || 0,
            voucherSalesAmount: Number(r.voucher_sales_amount ?? r.vouchersalesamount ?? r.voucherSalesAmount) || 0,
            oilSalesAmount: Number(r.oil_sales_amount ?? r.oilsalesamount ?? r.oilSalesAmount) || 0,
            chamberReadings: r.chamber_readings || r.chamberReadings || undefined,
          })),
        };
      });

      setSupabaseShifts(mapped);
    } catch (err: any) {
      console.error('Error fetching shifts in DailySalesTab:', err);
      setErrorMessage(err?.message || 'Database query error');
      setSupabaseShifts([]);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchShifts();

    // Setup real-time listener for shifts and deposits updates
    const isConfigured = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
    if (!isConfigured) return;

    const channel = supabase
      .channel(`daily_sales_shifts_live_${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shifts' }, () => {
        fetchShifts(true);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shift_bank_deposits' }, () => {
        fetchShifts(true);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Convert EVERY individual shift into an independent record (1 Shift = 1 Row)
  const allIndividualShiftRecords = useMemo(() => {
    const records: IndividualShiftRecord[] = supabaseShifts.map((shift) => {
      const supervisorName = getSupervisorName(shift.supervisorId);

      // Date and time formatting
      let formattedDate = '';
      let formattedTimeWindow = '';
      let durationText = '';

      if (shift.startTime) {
        try {
          const startD = new Date(shift.startTime);
          formattedDate = startD.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          });
          const startStr = startD.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          if (shift.endTime) {
            const endD = new Date(shift.endTime);
            const endStr = endD.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            formattedTimeWindow = `${startStr} → ${endStr}`;
            
            const diffMs = endD.getTime() - startD.getTime();
            if (diffMs > 0) {
              const hours = Math.floor(diffMs / (1000 * 60 * 60));
              const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
              durationText = `${hours}h ${mins}m`;
            }
          } else {
            formattedTimeWindow = `${startStr} (Active)`;
            durationText = 'In Progress';
          }
        } catch (_) {
          formattedDate = shift.startTime.slice(0, 10);
          formattedTimeWindow = 'Active';
        }
      } else {
        formattedDate = 'N/A';
        formattedTimeWindow = 'Active';
      }

      // Fuel breakdown accumulator for this specific shift
      const fuelBreakdownAcc: Record<string, { liters: number; rateSum: number; count: number; revenue: number }> = {
        'Petrol 92': { liters: 0, rateSum: 0, count: 0, revenue: 0 },
        'Petrol 95': { liters: 0, rateSum: 0, count: 0, revenue: 0 },
        'Auto Diesel': { liters: 0, rateSum: 0, count: 0, revenue: 0 },
        'Super Diesel': { liters: 0, rateSum: 0, count: 0, revenue: 0 },
      };

      const chamberMap = new Map<number, DailyChamberSummary>();
      const pumperIdsSet = new Set<string>();

      let shiftFuelVol = 0;
      let shiftFuelRev = 0;
      let shiftOilRev = 0;
      let shiftCredit = 0;
      let shiftCard = 0;
      let shiftTouchCard = 0;
      let shiftVoucher = 0;
      let shiftActualCashSum = 0;

      const readings = shift.pumpReadings || [];
      readings.forEach((r) => {
        if (r.assignedPumperId) pumperIdsSet.add(r.assignedPumperId);
        if (r.replacementPumperId) pumperIdsSet.add(r.replacementPumperId);

        const isOilBay =
          r.pumpId === 'pump-oil-bay' ||
          r.fuelType === 'Oil & Lubricants' ||
          (r.pumpName && r.pumpName.toLowerCase().includes('oil'));

        if (isOilBay) {
          const oilAmount = r.oilSalesAmount || 0;
          shiftOilRev += oilAmount;

          if (r.chamberReadings && Array.isArray(r.chamberReadings)) {
            r.chamberReadings.forEach((ch) => {
              const chNum = ch.chamberNumber || 1;
              const op = ch.openingLevel ?? ch.openingLiters ?? 0;
              const cl = ch.closingLevel ?? ch.closingLiters ?? 0;
              const sold = ch.soldLiters !== undefined 
                ? ch.soldLiters 
                : (!cl || cl <= 0 || cl === op ? 0 : (cl > op ? (cl - op) : (op - cl)));
              const amt = ch.totalAmount || sold * (ch.ratePerLiter || 0);

              if (!chamberMap.has(chNum)) {
                chamberMap.set(chNum, {
                  chamberNumber: chNum,
                  chamberId: ch.chamberId,
                  grade: ch.grade || `Chamber ${chNum}`,
                  openingLevel: ch.openingLevel || 0,
                  closingLevel: ch.closingLevel || 0,
                  soldLiters: 0,
                  ratePerLiter: ch.ratePerLiter || 0,
                  totalAmount: 0,
                });
              }
              const exist = chamberMap.get(chNum)!;
              exist.soldLiters += sold;
              exist.totalAmount += amt;
              if (ch.ratePerLiter > 0) exist.ratePerLiter = ch.ratePerLiter;
              exist.closingLevel = ch.closingLevel || exist.closingLevel;
            });
          }
        } else {
          const soldLiters = Math.max(0, (r.endMeter || 0) - (r.startMeter || 0) - (r.testingQty || 0));
          const unitPrice = (r.unitPrice && r.unitPrice > 0) ? r.unitPrice : (tankPriceMap.get(r.fuelType) || 0);
          const fuelRev = soldLiters * unitPrice;

          shiftFuelVol += soldLiters;
          shiftFuelRev += fuelRev;

          if (!fuelBreakdownAcc[r.fuelType]) {
            fuelBreakdownAcc[r.fuelType] = { liters: 0, rateSum: 0, count: 0, revenue: 0 };
          }
          fuelBreakdownAcc[r.fuelType].liters += soldLiters;
          fuelBreakdownAcc[r.fuelType].revenue += fuelRev;
          if (unitPrice > 0) {
            fuelBreakdownAcc[r.fuelType].rateSum += unitPrice;
            fuelBreakdownAcc[r.fuelType].count += 1;
          }
        }

        shiftCredit += (Number(r.creditSalesAmount ?? (r as any).credit_sales_amount ?? (r as any).creditsalesamount) || 0);
        shiftCard += (Number(r.cardSalesAmount ?? (r as any).card_sales_amount ?? (r as any).cardsalesamount) || 0);
        shiftTouchCard += (Number(r.touchCardSalesAmount ?? (r as any).touch_card_sales_amount ?? (r as any).touchcardsalesamount) || 0);
        shiftVoucher += (Number(r.voucherSalesAmount ?? (r as any).voucher_sales_amount ?? (r as any).vouchersalesamount) || 0);
        shiftActualCashSum += (Number(r.actualCash ?? (r as any).actual_cash ?? (r as any).actualcash) || 0);
      });

      // Counter sales (LP Gas & Packaged Lubricant Sales)
      let shiftGasSales = 0;
      let shiftPackagedLubeSales = 0;

      const cs = shift.counterSales;
      if (cs) {
        shiftGasSales = cs.totalGasSales !== undefined 
          ? cs.totalGasSales 
          : (cs.gasSales || []).reduce((sum, g) => sum + (Number(g.totalAmount) || 0), 0);
        shiftPackagedLubeSales = cs.totalLubeSales !== undefined 
          ? cs.totalLubeSales 
          : (cs.lubeSales || []).reduce((sum, l) => sum + (Number(l.totalAmount) || 0), 0);
      } else {
        const rawCounter = (shift as any).counter_sales || (shift as any).countersales;
        if (rawCounter) {
          try {
            const parsed = typeof rawCounter === 'string' ? JSON.parse(rawCounter) : rawCounter;
            shiftGasSales = parsed.totalGasSales !== undefined 
              ? parsed.totalGasSales 
              : (parsed.gasSales || []).reduce((sum: number, g: any) => sum + (Number(g.totalAmount) || 0), 0);
            shiftPackagedLubeSales = parsed.totalLubeSales !== undefined 
              ? parsed.totalLubeSales 
              : (parsed.lubeSales || []).reduce((sum: number, l: any) => sum + (Number(l.totalAmount) || 0), 0);
          } catch (_) {}
        }
        if (shiftGasSales === 0 && shiftPackagedLubeSales === 0) {
          try {
            const local = localStorage.getItem(`fuelflow_counter_sales_${shift.id}`);
            if (local) {
              const parsed = JSON.parse(local);
              shiftGasSales = parsed.totalGasSales !== undefined 
                ? parsed.totalGasSales 
                : (parsed.gasSales || []).reduce((sum: number, g: any) => sum + (Number(g.totalAmount) || 0), 0);
              shiftPackagedLubeSales = parsed.totalLubeSales !== undefined 
                ? parsed.totalLubeSales 
                : (parsed.lubeSales || []).reduce((sum: number, l: any) => sum + (Number(l.totalAmount) || 0), 0);
            }
          } catch (_) {}
        }
      }

      // Shift Gross Revenue calculation:
      // Total Gross Revenue = Gross Fuel Sales + Loose Oil Sales + LP Gas Sales + Packaged Lubricant Sales
      let shiftGross = shiftFuelRev + shiftOilRev + shiftGasSales + shiftPackagedLubeSales;
      if (shiftGross === 0 && (shift.totalNetSales || 0) > 0) {
        shiftGross = shift.totalNetSales;
      }

      if (shiftFuelVol === 0 && (shift.totalNetSold || shift.totalFuelSold || 0) > 0) {
        shiftFuelVol = shift.totalNetSold || shift.totalFuelSold || 0;
      }

      // Non-cash summation: ensure Credit, Card POS, Touch Card, and Voucher sales correctly sum and reflect in Non-Cash Deductions
      const finalShiftCredit = Math.max(
        shiftCredit,
        Number((shift as any).creditSales ?? (shift as any).credit_sales ?? (shift as any).creditsales ?? (shift as any).total_credit_sales ?? 0)
      );
      const finalShiftCard = Math.max(
        shiftCard,
        Number((shift as any).cardSales ?? (shift as any).card_sales ?? (shift as any).cardsales ?? (shift as any).total_card_sales ?? 0)
      );
      const finalShiftTouchCard = Math.max(
        shiftTouchCard,
        Number((shift as any).touchCardSales ?? (shift as any).touch_card_sales ?? (shift as any).touchcardsales ?? (shift as any).total_touch_card_sales ?? 0)
      );
      const finalShiftVoucher = Math.max(
        shiftVoucher,
        Number((shift as any).voucherSales ?? (shift as any).voucher_sales ?? (shift as any).vouchersales ?? (shift as any).total_voucher_sales ?? 0)
      );

      // Itemized Non-Cash Sales & Net Expected Physical Cash
      const totalNonCash = finalShiftCredit + finalShiftCard + finalShiftTouchCard + finalShiftVoucher;
      const expectedCash = Math.max(0, shiftGross - totalNonCash);

      const cashBanked = Number(shift.cashBanked ?? (shift as any).cash_banked ?? (shift as any).cashbanked) || 0;

      let handedOverCash = shiftActualCashSum;
      if (handedOverCash === 0 && shift.totalPhysicalCash !== undefined && shift.totalPhysicalCash > 0) {
        handedOverCash = shift.totalPhysicalCash;
      } else if (
        handedOverCash === 0 &&
        (shift.initialPumperCash || 0) + (shift.replacementPumperCash || 0) > 0
      ) {
        handedOverCash = (shift.initialPumperCash || 0) + (shift.replacementPumperCash || 0);
      }

      // If Physical Cash Handed Over (cash_handed_over) is 0 or undefined, automatically fallback to cash_banked or total collected pumper cash
      if (handedOverCash === 0 && cashBanked > 0) {
        handedOverCash = cashBanked;
      }

      // Calculate Variance as: (Physical Cash Handed Over > 0 ? Physical Cash Handed Over : Cash Banked) - Net Expected Physical Cash
      const effectivePhysicalCash = handedOverCash > 0 ? handedOverCash : cashBanked;
      const variance = effectivePhysicalCash - expectedCash;

      let varianceStatus: 'Balanced' | 'Shortage' | 'Excess' = 'Balanced';
      if (variance < -0.01) varianceStatus = 'Shortage';
      else if (variance > 0.01) varianceStatus = 'Excess';

      // Finalize Fuel Breakdown for this shift
      const finalFuelBreakdown: Record<string, DailyFuelProductSummary> = {};
      Object.entries(fuelBreakdownAcc).forEach(([fuelType, data]) => {
        const avgRate = data.count > 0 ? data.rateSum / data.count : (tankPriceMap.get(fuelType) || 0);
        const volumePct = shiftFuelVol > 0 ? (data.liters / shiftFuelVol) * 100 : 0;

        finalFuelBreakdown[fuelType] = {
          fuelType,
          litersSold: data.liters,
          ratePerLiter: avgRate,
          revenue: data.revenue,
          volumePercentage: volumePct,
        };
      });

      const pumperNames = Array.from(pumperIdsSet).map(id => getPumperName(id));

      return {
        id: shift.id,
        name: shift.name || `Shift ${shift.id}`,
        supervisorId: shift.supervisorId,
        supervisorName,
        startTime: shift.startTime,
        endTime: shift.endTime,
        formattedDate,
        formattedTimeWindow,
        durationText,
        isActive: shift.isActive,
        totalFuelVolume: shiftFuelVol,
        totalForecourtOilSales: shiftOilRev,
        totalGasSales: shiftGasSales,
        totalPackagedLubeSales: shiftPackagedLubeSales,
        grossFuelRevenue: shiftFuelRev,
        grossRevenue: shiftGross,
        creditSales: finalShiftCredit,
        cardSales: finalShiftCard,
        touchCardSales: finalShiftTouchCard,
        voucherSales: finalShiftVoucher,
        totalNonCash,
        expectedCash,
        handedOverCash,
        cashBanked,
        variance,
        varianceStatus,
        pumperCount: Math.max(1, pumperIdsSet.size),
        pumperNames,
        handoverNotes: shift.handoverNotes,
        replacementPumperId: shift.replacementPumperId,
        fuelBreakdown: finalFuelBreakdown,
        chamberBreakdown: Array.from(chamberMap.values()).sort((a, b) => a.chamberNumber - b.chamberNumber),
        pumpReadings: shift.pumpReadings || [],
        rawShift: shift,
      };
    });

    // Sort descending by start time
    return records.sort((a, b) => {
      const tA = new Date(b.startTime || 0).getTime();
      const tB = new Date(a.startTime || 0).getTime();
      return tA - tB;
    });
  }, [supabaseShifts, tankPriceMap, employees]);

  // Date constants for quick reference
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // Filtered shift rows based on user filters
  const filteredShiftRecords = useMemo(() => {
    return allIndividualShiftRecords.filter((record) => {
      // 1. Status filter
      if (statusFilter === 'completed' && record.isActive) return false;
      if (statusFilter === 'active' && !record.isActive) return false;

      // 2. Date Range Filtering (based on shift start date)
      const recordDate = record.startTime ? record.startTime.slice(0, 10) : '';
      if (startDate && recordDate < startDate) return false;
      if (endDate && recordDate > endDate) return false;

      // 3. Search Query Filtering
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesId = record.id.toLowerCase().includes(q);
        const matchesName = record.name.toLowerCase().includes(q);
        const matchesSupervisor = record.supervisorName.toLowerCase().includes(q);
        const matchesPumper = record.pumperNames.some(p => p.toLowerCase().includes(q));
        const matchesDate = record.formattedDate.toLowerCase().includes(q) || (record.startTime && record.startTime.includes(q));
        const matchesFuel = Object.keys(record.fuelBreakdown).some(
          (f) => f.toLowerCase().includes(q) && record.fuelBreakdown[f].litersSold > 0
        );

        if (!matchesId && !matchesName && !matchesSupervisor && !matchesPumper && !matchesDate && !matchesFuel) {
          return false;
        }
      }

      return true;
    });
  }, [allIndividualShiftRecords, startDate, endDate, searchQuery, statusFilter]);

  // High-level KPI aggregations across filtered shifts
  const kpiTotals = useMemo(() => {
    let totalShifts = filteredShiftRecords.length;
    let totalFuelVolume = 0;
    let totalGrossRevenue = 0;
    let totalHandedOverCash = 0;
    let totalExpectedCash = 0;
    let totalCreditSales = 0;
    let totalCardSales = 0;
    let totalTouchCardSales = 0;
    let totalVoucherSales = 0;
    let totalNonCashSales = 0;
    let totalOilSales = 0;
    let totalCashBanked = 0;

    let totalEffectivePhysical = 0;

    filteredShiftRecords.forEach((r) => {
      totalFuelVolume += r.totalFuelVolume;
      totalGrossRevenue += r.grossRevenue;
      totalHandedOverCash += r.handedOverCash;
      totalExpectedCash += r.expectedCash;
      totalCreditSales += r.creditSales;
      totalCardSales += r.cardSales;
      totalTouchCardSales += r.touchCardSales;
      totalVoucherSales += r.voucherSales;
      totalNonCashSales += r.totalNonCash;
      totalOilSales += r.totalForecourtOilSales;
      totalCashBanked += r.cashBanked;
      totalEffectivePhysical += (r.handedOverCash > 0 ? r.handedOverCash : r.cashBanked);
    });

    const netVariance = totalEffectivePhysical - totalExpectedCash;
    let varianceStatus: 'Balanced' | 'Shortage' | 'Excess' = 'Balanced';
    if (netVariance < -0.01) varianceStatus = 'Shortage';
    else if (netVariance > 0.01) varianceStatus = 'Excess';

    return {
      totalShifts,
      totalFuelVolume,
      totalGrossRevenue,
      totalHandedOverCash,
      totalExpectedCash,
      totalCreditSales,
      totalCardSales,
      totalTouchCardSales,
      totalVoucherSales,
      totalNonCashSales,
      totalOilSales,
      totalCashBanked,
      netVariance,
      varianceStatus,
    };
  }, [filteredShiftRecords]);

  // CSV Export Utility
  const downloadCSV = (filename: string, headers: string[], rows: (string | number)[][]) => {
    const csvContent = [
      headers.map((h) => `"${h.replace(/"/g, '""')}"`).join(','),
      ...rows.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')),
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

  // Export all individual shift rows to CSV
  const exportMasterShiftsCSV = () => {
    if (filteredShiftRecords.length === 0) return;

    const headers = [
      'Shift ID',
      'Shift Name',
      'Status',
      'Date',
      'Start Time',
      'End Time',
      'Supervisor',
      'Pumpers Count',
      'Petrol 92 (L)',
      'Petrol 95 (L)',
      'Auto Diesel (L)',
      'Super Diesel (L)',
      'Total Fuel Volume (L)',
      'Oil Sales (Rs.)',
      'Gross Revenue (Rs.)',
      'Corporate Credit (Rs.)',
      'Card POS (Rs.)',
      'Touch Card (Rs.)',
      'Vouchers (Rs.)',
      'Total Non-Cash (Rs.)',
      'Expected Cash (Rs.)',
      'Handed Over Cash (Rs.)',
      'Cash Banked (Rs.)',
      'Cash Variance (Rs.)',
      'Variance Status',
    ];

    const rows = filteredShiftRecords.map((r) => {
      const p92 = r.fuelBreakdown['Petrol 92']?.litersSold || 0;
      const p95 = r.fuelBreakdown['Petrol 95']?.litersSold || 0;
      const ad = r.fuelBreakdown['Auto Diesel']?.litersSold || 0;
      const sd = r.fuelBreakdown['Super Diesel']?.litersSold || 0;

      return [
        r.id,
        r.name,
        r.isActive ? 'Active' : 'Completed',
        r.formattedDate,
        r.startTime || '',
        r.endTime || 'Active',
        r.supervisorName,
        r.pumperCount,
        p92.toFixed(2),
        p95.toFixed(2),
        ad.toFixed(2),
        sd.toFixed(2),
        r.totalFuelVolume.toFixed(2),
        r.totalForecourtOilSales.toFixed(2),
        r.grossRevenue.toFixed(2),
        r.creditSales.toFixed(2),
        r.cardSales.toFixed(2),
        r.touchCardSales.toFixed(2),
        r.voucherSales.toFixed(2),
        r.totalNonCash.toFixed(2),
        r.expectedCash.toFixed(2),
        r.handedOverCash.toFixed(2),
        r.cashBanked.toFixed(2),
        r.variance.toFixed(2),
        r.varianceStatus,
      ];
    });

    const fileDate = startDate && endDate ? `${startDate}_to_${endDate}` : todayStr;
    downloadCSV(`FuelFlow_Shift_Ledger_Master_${fileDate}.csv`, headers, rows);
  };

  // Export single shift detailed breakdown
  const exportSingleShiftDetailCSV = (shift: IndividualShiftRecord) => {
    const headers = [
      'Section',
      'Item / Parameter',
      'Details',
      'Volume (L)',
      'Rate (Rs.)',
      'Amount (Rs.)',
      'Notes / Status',
    ];

    const rows: (string | number)[][] = [
      ['METADATA', 'Shift ID', shift.id, '', '', '', ''],
      ['METADATA', 'Shift Name', shift.name, '', '', '', shift.isActive ? 'ACTIVE' : 'COMPLETED'],
      ['METADATA', 'Date & Time', `${shift.formattedDate} (${shift.formattedTimeWindow})`, '', '', '', ''],
      ['METADATA', 'Supervisor', shift.supervisorName, '', '', '', ''],
      ['METADATA', 'Pumpers', shift.pumperNames.join(', '), '', '', '', `${shift.pumperCount} Pumper(s)`],
      ['', '', '', '', '', '', ''],
      ['FUEL SALES', 'Petrol 92', 'Liters Sold & Revenue', shift.fuelBreakdown['Petrol 92']?.litersSold.toFixed(2) || '0', shift.fuelBreakdown['Petrol 92']?.ratePerLiter.toFixed(2) || '0', shift.fuelBreakdown['Petrol 92']?.revenue.toFixed(2) || '0', `${shift.fuelBreakdown['Petrol 92']?.volumePercentage.toFixed(1)}% share`],
      ['FUEL SALES', 'Petrol 95', 'Liters Sold & Revenue', shift.fuelBreakdown['Petrol 95']?.litersSold.toFixed(2) || '0', shift.fuelBreakdown['Petrol 95']?.ratePerLiter.toFixed(2) || '0', shift.fuelBreakdown['Petrol 95']?.revenue.toFixed(2) || '0', `${shift.fuelBreakdown['Petrol 95']?.volumePercentage.toFixed(1)}% share`],
      ['FUEL SALES', 'Auto Diesel', 'Liters Sold & Revenue', shift.fuelBreakdown['Auto Diesel']?.litersSold.toFixed(2) || '0', shift.fuelBreakdown['Auto Diesel']?.ratePerLiter.toFixed(2) || '0', shift.fuelBreakdown['Auto Diesel']?.revenue.toFixed(2) || '0', `${shift.fuelBreakdown['Auto Diesel']?.volumePercentage.toFixed(1)}% share`],
      ['FUEL SALES', 'Super Diesel', 'Liters Sold & Revenue', shift.fuelBreakdown['Super Diesel']?.litersSold.toFixed(2) || '0', shift.fuelBreakdown['Super Diesel']?.ratePerLiter.toFixed(2) || '0', shift.fuelBreakdown['Super Diesel']?.revenue.toFixed(2) || '0', `${shift.fuelBreakdown['Super Diesel']?.volumePercentage.toFixed(1)}% share`],
      ['FUEL SALES TOTAL', 'All Fuel Products', 'Combined Fuel Volume & Revenue', shift.totalFuelVolume.toFixed(2), '', shift.grossFuelRevenue.toFixed(2), ''],
      ['', '', '', '', '', '', ''],
      ['LUBRICANTS', 'Forecourt Bulk Oil', 'Bay & Chamber Sales', '', '', shift.totalForecourtOilSales.toFixed(2), ''],
      ['COUNTER SALES', 'LP Gas Sales', 'Gas Cylinder Sales', '', '', shift.totalGasSales.toFixed(2), ''],
      ['COUNTER SALES', 'Packaged Lubricant Sales', 'Bottled Lubricants', '', '', shift.totalPackagedLubeSales.toFixed(2), ''],
      ['', '', '', '', '', '', ''],
      ...shift.pumpReadings.map((r) => {
        const sold = Math.max(0, (r.endMeter || 0) - (r.startMeter || 0) - (r.testingQty || 0));
        const price = r.unitPrice || 0;
        const rev = sold * price;
        return [
          'PUMP READING',
          r.pumpName || r.pumpId,
          `${r.fuelType} | Pumper: ${getPumperName(r.assignedPumperId)}`,
          sold.toFixed(2),
          price.toFixed(2),
          rev.toFixed(2),
          `Start: ${r.startMeter || 0} | End: ${r.endMeter || 0} | Test: ${r.testingQty || 0}`,
        ];
      }),
      ['', '', '', '', '', '', ''],
      ['FINANCIAL SETTLEMENT', 'Gross Total Revenue', 'Fuel + Lubes + Gas + Bottles', '', '', shift.grossRevenue.toFixed(2), ''],
      ['FINANCIAL SETTLEMENT', '(-) Corporate Credit Sales', 'Corporate Account Receivables', '', '', shift.creditSales.toFixed(2), 'Non-Cash Deduction'],
      ['FINANCIAL SETTLEMENT', '(-) Card POS / Digital Swipes', 'Debit/Credit POS Swipes', '', '', shift.cardSales.toFixed(2), 'Non-Cash Deduction'],
      ['FINANCIAL SETTLEMENT', '(-) Touch Card Sales', 'Prepaid Touch Cards', '', '', shift.touchCardSales.toFixed(2), 'Non-Cash Deduction'],
      ['FINANCIAL SETTLEMENT', '(-) Voucher / Coupon Sales', 'Fuel & Fleet Vouchers', '', '', shift.voucherSales.toFixed(2), 'Non-Cash Deduction'],
      ['FINANCIAL SETTLEMENT', 'Total Non-Cash Deductions', 'Credit + Card + Touch Card + Voucher', '', '', shift.totalNonCash.toFixed(2), 'Total Non-Cash'],
      ['FINANCIAL SETTLEMENT', 'Net Expected Physical Cash', 'Gross Revenue - Non-Cash Deductions', '', '', shift.expectedCash.toFixed(2), 'Expected Handover'],
      ['FINANCIAL SETTLEMENT', 'Physical Cash Handed Over', 'Actual Cash from Pumpers', '', '', shift.handedOverCash.toFixed(2), 'Actual Handover'],
      ['FINANCIAL SETTLEMENT', 'Cash Banked / Deposit', 'Deposited to Bank', '', '', shift.cashBanked.toFixed(2), 'Banked'],
      ['FINANCIAL SETTLEMENT', 'Cash Variance', 'Actual Handover - Expected Cash', '', '', shift.variance.toFixed(2), shift.varianceStatus],
    ];

    downloadCSV(`Shift_Audit_${shift.id}.csv`, headers, rows);
  };

  // Color helper for fuel types
  const getFuelColorTag = (fuelType: string) => {
    switch (fuelType) {
      case 'Petrol 92':
        return {
          bg: 'bg-emerald-50 text-emerald-800 border-emerald-200',
          dot: 'bg-emerald-500',
          bar: 'bg-emerald-500',
        };
      case 'Petrol 95':
        return {
          bg: 'bg-rose-50 text-rose-800 border-rose-200',
          dot: 'bg-rose-500',
          bar: 'bg-rose-500',
        };
      case 'Auto Diesel':
        return {
          bg: 'bg-amber-50 text-amber-900 border-amber-200',
          dot: 'bg-amber-500',
          bar: 'bg-amber-500',
        };
      case 'Super Diesel':
        return {
          bg: 'bg-blue-50 text-blue-900 border-blue-200',
          dot: 'bg-blue-600',
          bar: 'bg-blue-600',
        };
      default:
        return {
          bg: 'bg-gray-100 text-gray-800 border-gray-200',
          dot: 'bg-gray-500',
          bar: 'bg-gray-500',
        };
    }
  };

  return (
    <div id="daily-sales-tab-root" className="space-y-5 animate-fade-in pb-12">
      {/* ========================================================================= */}
      {/* 1. TOP HEADER & FILTER BAR */}
      {/* ========================================================================= */}
      <div className="flex flex-col gap-4">
        {/* Title and Top Right Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-slate-900 tracking-tight font-sans flex items-center gap-2">
              <BarChart3 className="w-4.5 h-4.5 text-blue-600 shrink-0" />
              <span>Shift Sales History &amp; Settlement Ledger</span>
            </h1>
            <p className="text-slate-500 text-xs mt-0.5 font-sans">
              Individual shift-by-shift records with distinct Shift IDs, fuel volumes, oil sales, credit/card deductions, and cash reconciliations
            </p>
          </div>

          {/* Action buttons (Export) */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              id="btn-export-daily-sales-csv"
              onClick={exportMasterShiftsCSV}
              disabled={filteredShiftRecords.length === 0}
              className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-slate-900 hover:bg-black text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5 text-emerald-400" />
              <span>Export</span>
            </button>
          </div>
        </div>

        {/* Date Filter, Status Toggle & Search Controls Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-2.5 sm:p-3 rounded-2xl border border-gray-200/80 shadow-2xs">
          {/* Left: Date Range Filter & Status Filter */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Dual Date Picker */}
            <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200/80 rounded-xl px-2.5 py-1">
              <Calendar className="w-3.5 h-3.5 text-gray-400 shrink-0" />
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-transparent text-gray-700 text-xs font-medium outline-none cursor-pointer"
                title="Start Date"
              />
              <span className="text-gray-400 font-bold text-[10px] px-0.5">TO</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-transparent text-gray-700 text-xs font-medium outline-none cursor-pointer"
                title="End Date"
              />
              {(startDate || endDate) && (
                <button
                  onClick={() => {
                    setStartDate('');
                    setEndDate('');
                  }}
                  className="p-0.5 hover:bg-gray-200 rounded text-gray-400 hover:text-gray-600 transition-colors ml-0.5"
                  title="Clear Dates"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Status Filter Pill */}
            <div className="inline-flex rounded-xl bg-gray-100 p-0.5 text-xs font-medium">
              <button
                onClick={() => setStatusFilter('all')}
                className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                  statusFilter === 'all'
                    ? 'bg-white text-slate-900 font-bold shadow-2xs'
                    : 'text-gray-500 hover:text-gray-900'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setStatusFilter('completed')}
                className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                  statusFilter === 'completed'
                    ? 'bg-white text-slate-900 font-bold shadow-2xs'
                    : 'text-gray-500 hover:text-gray-900'
                }`}
              >
                Completed
              </button>
              <button
                onClick={() => setStatusFilter('active')}
                className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                  statusFilter === 'active'
                    ? 'bg-white text-emerald-700 font-bold shadow-2xs'
                    : 'text-gray-500 hover:text-gray-900'
                }`}
              >
                Active
              </button>
            </div>

            {(startDate || endDate) && (
              <span className="text-[11px] text-blue-700 font-semibold bg-blue-50 px-2 py-0.5 rounded-lg border border-blue-200 hidden md:inline">
                {startDate && endDate ? `${startDate} to ${endDate}` : startDate ? `From ${startDate}` : `Until ${endDate}`}
              </span>
            )}
          </div>

          {/* Right: Search Box */}
          <div className="relative min-w-[220px] flex-1 sm:flex-initial">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search Shift ID, supervisor, pumper..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8.5 pr-8 py-1.5 bg-gray-50 border border-gray-200/80 rounded-xl text-xs text-gray-800 placeholder-gray-400 outline-none focus:bg-white focus:ring-1 focus:ring-blue-500 transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-600 cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* High-Level Overview Metrics Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          <div className="p-3 bg-white rounded-xl border border-gray-200/80 shadow-2xs">
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block">Total Shifts</span>
            <span className="text-sm font-extrabold text-slate-900 tabular-nums mt-0.5 block">
              {kpiTotals.totalShifts} {kpiTotals.totalShifts === 1 ? 'Shift' : 'Shifts'}
            </span>
          </div>

          <div className="p-3 bg-white rounded-xl border border-gray-200/80 shadow-2xs">
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block">Total Fuel Sold</span>
            <span className="text-sm font-extrabold text-blue-600 tabular-nums mt-0.5 block">
              {formatLiters(kpiTotals.totalFuelVolume)}
            </span>
          </div>

          <div className="p-3 bg-white rounded-xl border border-gray-200/80 shadow-2xs">
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block">Total Gross Sales</span>
            <span className="text-sm font-extrabold text-slate-900 tabular-nums mt-0.5 block">
              {formatRs(kpiTotals.totalGrossRevenue)}
            </span>
          </div>

          <div className="p-3 bg-white rounded-xl border border-gray-200/80 shadow-2xs">
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block">Non-Cash (Credit/POS)</span>
            <span className="text-sm font-bold text-amber-700 tabular-nums mt-0.5 block">
              {formatRs(kpiTotals.totalCreditSales + kpiTotals.totalCardSales)}
            </span>
          </div>

          <div className="p-3 bg-white rounded-xl border border-gray-200/80 shadow-2xs">
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block">Cash Banked</span>
            <span className="text-sm font-extrabold text-purple-700 tabular-nums mt-0.5 block">
              {formatRs(kpiTotals.totalCashBanked)}
            </span>
          </div>

          <div className="p-3 bg-white rounded-xl border border-gray-200/80 shadow-2xs">
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block">Net Cash Variance</span>
            <span className={`text-sm font-extrabold tabular-nums mt-0.5 block ${
              kpiTotals.varianceStatus === 'Shortage' ? 'text-rose-600' : kpiTotals.varianceStatus === 'Excess' ? 'text-amber-600' : 'text-emerald-600'
            }`}>
              {kpiTotals.netVariance >= 0 && kpiTotals.netVariance > 0.01 ? '+' : ''}
              {formatRs(kpiTotals.netVariance)}
            </span>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. INDIVIDUAL SHIFT LEDGER TABLE (1 Shift = 1 Distinct Row) */}
      {/* ========================================================================= */}
      <div className="bg-white rounded-2xl border border-gray-200/80 shadow-2xs overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-xs font-bold text-gray-900 uppercase tracking-wider">
              Shift Records Ledger ({filteredShiftRecords.length})
            </h2>
            {(startDate || endDate || statusFilter !== 'all' || searchQuery) && (
              <span className="bg-blue-50 text-blue-700 text-[10px] font-bold px-2 py-0.5 rounded-md border border-blue-200">
                Filtered View
              </span>
            )}
          </div>
          <span className="text-[11px] text-gray-400 font-medium hidden sm:inline">
            Each row represents a distinct shift record. Click any row for the complete pump &amp; financial audit.
          </span>
        </div>

        {isLoading ? (
          <div className="p-12 text-center space-y-3">
            <RefreshCw className="w-6 h-6 text-blue-600 animate-spin mx-auto" />
            <p className="text-xs text-gray-700 font-semibold">Loading shifts directly from Supabase...</p>
            <p className="text-[11px] text-gray-400">Fetching live shift records, pump readings, and bank deposits.</p>
          </div>
        ) : filteredShiftRecords.length === 0 ? (
          <div className="p-12 text-center space-y-2.5">
            <Clock className="w-8 h-8 text-gray-300 mx-auto" />
            <p className="text-xs text-gray-800 font-bold">
              {supabaseShifts.length === 0 ? 'No shifts recorded yet' : 'No matching shift records found'}
            </p>
            <p className="text-[11px] text-gray-500 max-w-sm mx-auto">
              {supabaseShifts.length === 0
                ? 'No shift data found in the Supabase database. Start and complete a shift from the Shift Management tab to populate this ledger.'
                : 'No shifts match your selected filter criteria. Try adjusting your date range, status, or search query.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-sans">
              <thead className="bg-gray-50/90 text-gray-500 font-bold text-[10px] uppercase tracking-wider border-b border-gray-200/90 select-none">
                <tr>
                  <th className="py-1.5 px-3">Shift ID &amp; Status</th>
                  <th className="py-1.5 px-3">Date, Time &amp; Duration</th>
                  <th className="py-1.5 px-3">Supervisor</th>
                  <th className="py-1.5 px-3 text-right">Fuel Sold</th>
                  <th className="py-1.5 px-3 text-right">Oil Sales</th>
                  <th className="py-1.5 px-3 text-right">Gross Rev.</th>
                  <th className="py-1.5 px-3 text-right">Handed Cash</th>
                  <th className="py-1.5 px-3 text-right">Banked</th>
                  <th className="py-1.5 px-2 text-center">Variance</th>
                  <th className="py-1.5 px-2 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-xs">
                {filteredShiftRecords.map((shift) => {
                  return (
                    <tr
                      key={shift.id}
                      onClick={() => setSelectedShiftRecord(shift)}
                      className="hover:bg-blue-50/40 transition-colors cursor-pointer group"
                    >
                      {/* Shift ID & Status Pill */}
                      <td className="py-1.5 px-3">
                        <div className="flex items-center gap-1.5 leading-tight">
                          <span className="font-mono font-bold text-slate-900 text-xs">{shift.id}</span>
                          {shift.isActive ? (
                            <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-800 border border-emerald-200 rounded text-[9px] font-bold uppercase leading-none animate-pulse">
                              Active
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 bg-gray-100 text-gray-700 border border-gray-200 rounded text-[9px] font-semibold uppercase leading-none">
                              Done
                            </span>
                          )}
                          {shift.name && shift.name !== shift.id && (
                            <span className="text-[10px] text-gray-400 truncate max-w-[110px]" title={shift.name}>
                              · {shift.name}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Date, Time Window & Duration */}
                      <td className="py-1.5 px-3">
                        <div className="text-[11px] leading-tight text-gray-800 flex items-center gap-1.5 flex-wrap">
                          <span className="font-semibold text-slate-900">{shift.formattedDate}</span>
                          <span className="text-[10px] text-gray-500 font-mono">({shift.formattedTimeWindow})</span>
                          {shift.durationText && (
                            <span className="text-[9px] text-gray-400 bg-gray-100 px-1 py-0.2 rounded font-normal">
                              {shift.durationText}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Supervisor */}
                      <td className="py-1.5 px-3">
                        <div className="flex items-center gap-1 leading-tight text-[11px]">
                          <span className="font-medium text-gray-800 truncate max-w-[120px]">
                            {shift.supervisorName}
                          </span>
                          <span className="text-[10px] text-gray-400 shrink-0">
                            ({shift.pumperCount}p)
                          </span>
                        </div>
                      </td>

                      {/* Total Fuel Volume */}
                      <td className="py-1.5 px-3 text-right font-bold text-blue-600 tabular-nums text-xs leading-tight">
                        {formatLiters(shift.totalFuelVolume)}
                      </td>

                      {/* Forecourt Oil Sales */}
                      <td className="py-1.5 px-3 text-right font-medium text-gray-600 tabular-nums text-xs leading-tight">
                        {formatRs(shift.totalForecourtOilSales)}
                      </td>

                      {/* Gross Revenue */}
                      <td className="py-1.5 px-3 text-right font-bold text-slate-900 tabular-nums text-xs leading-tight">
                        {formatRs(shift.grossRevenue)}
                      </td>

                      {/* Handed Over Physical Cash */}
                      <td className="py-1.5 px-3 text-right font-semibold text-gray-900 tabular-nums text-xs leading-tight">
                        {formatRs(shift.handedOverCash)}
                      </td>

                      {/* Cash Banked */}
                      <td className="py-1.5 px-3 text-right font-semibold text-purple-800 tabular-nums text-xs leading-tight">
                        {shift.cashBanked > 0 ? formatRs(shift.cashBanked) : <span className="text-gray-300">-</span>}
                      </td>

                      {/* Cash Variance Status Badge */}
                      <td className="py-1.5 px-2 text-center leading-tight">
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border tabular-nums leading-none ${
                            shift.varianceStatus === 'Shortage'
                              ? 'bg-rose-50 text-rose-700 border-rose-200'
                              : shift.varianceStatus === 'Excess'
                              ? 'bg-amber-50 text-amber-700 border-amber-200'
                              : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          }`}
                        >
                          {shift.variance >= 0 && shift.variance > 0.01 ? '+' : ''}
                          {formatRs(shift.variance)}
                        </span>
                      </td>

                      {/* Action Button */}
                      <td className="py-1.5 px-2 text-center leading-tight">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedShiftRecord(shift);
                          }}
                          className="inline-flex items-center gap-1 px-2 py-0.5 bg-white group-hover:bg-blue-600 group-hover:text-white text-gray-700 border border-gray-200 rounded text-[10px] font-bold transition-all shadow-2xs cursor-pointer leading-none"
                        >
                          <Eye className="w-2.5 h-2.5" />
                          <span>Audit</span>
                        </button>
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
      {/* 3. FULL-SCREEN INDIVIDUAL SHIFT BREAKDOWN VIEW (Single Shift Audit) */}
      {/* ========================================================================= */}
      {selectedShiftRecord && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-50 flex flex-col animate-in fade-in duration-200">
          {/* Top Navigation & Action Bar */}
          <div className="sticky top-0 z-20 bg-white/95 backdrop-blur-xs border-b border-gray-200/90 px-4 sm:px-6 lg:px-8 py-3.5 flex items-center justify-between shadow-2xs">
            <div className="flex items-center gap-3 sm:gap-4">
              <button
                onClick={() => setSelectedShiftRecord(null)}
                className="inline-flex items-center gap-2 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-2xs"
                title="Return to Shift Ledger"
              >
                <ArrowLeft className="w-4 h-4 text-gray-700" />
                <span>Back to Shift Ledger</span>
              </button>

              <div className="h-5 w-px bg-gray-200 hidden sm:block" />

              <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2.5">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-slate-900 font-sans tracking-tight flex items-center gap-2">
                    <span className="font-mono">{selectedShiftRecord.id}</span>
                    <span className="text-gray-400 font-normal">({selectedShiftRecord.name})</span>
                  </h2>
                  <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${
                    selectedShiftRecord.isActive 
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200' 
                      : 'bg-gray-100 text-gray-700 border-gray-200'
                  }`}>
                    {selectedShiftRecord.isActive ? 'ACTIVE SHIFT' : 'COMPLETED SHIFT'}
                  </span>
                </div>
                <span className="text-xs text-slate-500 hidden md:inline">
                  • Supervisor: <strong className="text-slate-700 font-semibold">{selectedShiftRecord.supervisorName}</strong>
                  {selectedShiftRecord.startTime && ` • ${selectedShiftRecord.formattedDate} (${selectedShiftRecord.formattedTimeWindow})`}
                </span>
              </div>
            </div>

            {/* Top Right Actions */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => exportSingleShiftDetailCSV(selectedShiftRecord)}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-slate-900 hover:bg-black text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
                title="Export shift audit to CSV"
              >
                <Download className="w-3.5 h-3.5 text-emerald-400" />
                <span>Export CSV</span>
              </button>

              <button
                onClick={() => setSelectedShiftRecord(null)}
                className="p-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-xl transition-all cursor-pointer"
                title="Close breakdown"
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </div>
          </div>

          {/* Main Content Area for Single Shift Audit */}
          <div className="flex-1 w-full max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
            {/* ------------------------------------------------------------- */}
            {/* SECTION 1: SHIFT FINANCIAL RECONCILIATION SUMMARY */}
            {/* ------------------------------------------------------------- */}
            <div className="bg-white rounded-2xl border border-gray-200/80 p-5 shadow-2xs space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-gray-900 uppercase tracking-wider flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-emerald-600" />
                  <span>Financial Settlement &amp; Reconciliation</span>
                </h3>
                <span className={`px-2.5 py-1 rounded-full text-xs font-bold border tabular-nums ${
                  selectedShiftRecord.varianceStatus === 'Shortage'
                    ? 'bg-rose-50 text-rose-700 border-rose-200'
                    : selectedShiftRecord.varianceStatus === 'Excess'
                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                }`}>
                  Variance: {selectedShiftRecord.variance >= 0 && selectedShiftRecord.variance > 0.01 ? '+' : ''}
                  {formatRs(selectedShiftRecord.variance)} ({selectedShiftRecord.varianceStatus})
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Left: Gross Sales & Non-Cash Deductions */}
                <div className="p-4 bg-gray-50 rounded-xl border border-gray-200/80 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-600">Gross Fuel Sales:</span>
                    <span className="font-bold text-gray-900 tabular-nums">
                      {formatRs(selectedShiftRecord.grossFuelRevenue)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-600">(+) Loose Oil Sales:</span>
                    <span className="font-bold text-gray-900 tabular-nums">
                      {formatRs(selectedShiftRecord.totalForecourtOilSales)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-amber-900">
                    <span className="text-amber-800 font-medium">(+) LP Gas Sales:</span>
                    <span className="font-bold tabular-nums">
                      {formatRs(selectedShiftRecord.totalGasSales)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-teal-900">
                    <span className="text-teal-800 font-medium">(+) Packaged Lubricant Bottle Sales:</span>
                    <span className="font-bold tabular-nums">
                      {formatRs(selectedShiftRecord.totalPackagedLubeSales)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-gray-200 font-bold">
                    <span className="text-slate-900">Total Gross Shift Revenue:</span>
                    <span className="text-slate-900 text-sm tabular-nums">
                      {formatRs(selectedShiftRecord.grossRevenue)}
                    </span>
                  </div>

                  <div className="pt-2 border-t border-gray-200/60 space-y-1.5">
                    <div className="flex items-center justify-between text-amber-800">
                      <span>(-) Corporate Credit Sales:</span>
                      <span className="font-bold tabular-nums">
                        {formatRs(selectedShiftRecord.creditSales)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-blue-800">
                      <span>(-) Card POS / Digital Swipes:</span>
                      <span className="font-bold tabular-nums">
                        {formatRs(selectedShiftRecord.cardSales)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-purple-800">
                      <span>(-) Touch Card Sales:</span>
                      <span className="font-bold tabular-nums">
                        {formatRs(selectedShiftRecord.touchCardSales)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-rose-800">
                      <span>(-) Voucher / Coupon Sales:</span>
                      <span className="font-bold tabular-nums">
                        {formatRs(selectedShiftRecord.voucherSales)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between pt-1.5 border-t border-dashed border-gray-200 text-gray-700 font-semibold">
                      <span>Total Non-Cash Deductions:</span>
                      <span className="font-bold text-gray-900 tabular-nums">
                        {formatRs(selectedShiftRecord.totalNonCash)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Right: Cash Reconciliation & Banking */}
                <div className="p-4 bg-emerald-50/40 rounded-xl border border-emerald-200/80 space-y-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-700 font-medium">Net Expected Physical Cash:</span>
                    <span className="font-bold text-gray-900 text-sm tabular-nums">
                      {formatRs(selectedShiftRecord.expectedCash)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-700 font-medium">Physical Cash Handed Over:</span>
                    <span className="font-bold text-emerald-800 text-sm tabular-nums">
                      {formatRs(selectedShiftRecord.handedOverCash)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-purple-900 bg-purple-50 px-2.5 py-1.5 rounded-lg border border-purple-200/80">
                    <span className="font-bold flex items-center gap-1.5">
                      <Landmark className="w-3.5 h-3.5 text-purple-600" />
                      Cash Banked / Deposit:
                    </span>
                    <span className="font-extrabold text-sm tabular-nums">
                      {formatRs(selectedShiftRecord.cashBanked)}
                    </span>
                  </div>

                  <div className="pt-2 border-t border-emerald-200">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-gray-900">Shift Cash Variance:</span>
                      <div className="text-right">
                        <span
                          className={`text-base font-bold tabular-nums block ${
                            selectedShiftRecord.varianceStatus === 'Shortage'
                              ? 'text-rose-600'
                              : selectedShiftRecord.varianceStatus === 'Excess'
                              ? 'text-amber-600'
                              : 'text-emerald-700'
                          }`}
                        >
                          {selectedShiftRecord.variance >= 0 && selectedShiftRecord.variance > 0.01 ? '+' : ''}
                          {formatRs(selectedShiftRecord.variance)}
                        </span>
                        <span className="text-[10px] font-extrabold uppercase tracking-wide opacity-80">
                          ({selectedShiftRecord.varianceStatus})
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {selectedShiftRecord.handoverNotes && (
                <div className="p-3 bg-amber-50 rounded-xl border border-amber-200/80 text-xs text-amber-900">
                  <strong>Supervisor Handover Notes:</strong> {selectedShiftRecord.handoverNotes}
                </div>
              )}
            </div>

            {/* ------------------------------------------------------------- */}
            {/* SECTION 2: FUEL PRODUCT SALES BREAKDOWN */}
            {/* ------------------------------------------------------------- */}
            <div className="bg-white rounded-2xl border border-gray-200/80 p-5 shadow-2xs space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-gray-900 uppercase tracking-wider flex items-center gap-2">
                  <Fuel className="w-4 h-4 text-blue-600" />
                  <span>Fuel Product Sales Breakdown</span>
                </h3>
                <span className="text-xs font-bold text-gray-500 tabular-nums">
                  Total Volume: {formatLiters(selectedShiftRecord.totalFuelVolume)}
                </span>
              </div>

              <div className="overflow-x-auto border border-gray-100 rounded-xl">
                <table className="w-full text-left text-xs font-sans">
                  <thead className="bg-gray-50 font-bold text-gray-500 text-[10px] uppercase border-b border-gray-100">
                    <tr>
                      <th className="py-2.5 px-3">Product Name</th>
                      <th className="py-2.5 px-3 text-right">Liters Sold (L)</th>
                      <th className="py-2.5 px-3 text-right">Unit Rate (Rs.)</th>
                      <th className="py-2.5 px-3 text-right">Gross Revenue (Rs.)</th>
                      <th className="py-2.5 px-3 text-center">Volume Share</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(Object.values(selectedShiftRecord.fuelBreakdown) as DailyFuelProductSummary[]).map((f) => {
                      const tag = getFuelColorTag(f.fuelType);
                      return (
                        <tr key={f.fuelType} className="hover:bg-gray-50">
                          <td className="py-3 px-3">
                            <div className="flex items-center gap-2">
                              <span className={`w-2.5 h-2.5 rounded-full ${tag.dot}`} />
                              <span className="font-bold text-slate-900">{f.fuelType}</span>
                            </div>
                          </td>
                          <td className="py-3 px-3 text-right font-bold text-blue-600 tabular-nums">
                            {formatLiters(f.litersSold)}
                          </td>
                          <td className="py-3 px-3 text-right text-gray-600 tabular-nums">
                            {formatRs(f.ratePerLiter)}
                          </td>
                          <td className="py-3 px-3 text-right font-bold text-slate-900 tabular-nums">
                            {formatRs(f.revenue)}
                          </td>
                          <td className="py-3 px-3 text-center">
                            <div className="flex items-center justify-center gap-2 min-w-[100px]">
                              <div className="w-16 h-2 bg-gray-100 rounded-full overflow-hidden">
                                <div
                                  className={`h-full ${tag.bar}`}
                                  style={{ width: `${Math.min(100, f.volumePercentage)}%` }}
                                />
                              </div>
                              <span className="text-[10px] font-bold text-gray-500 tabular-nums">
                                {f.volumePercentage.toFixed(1)}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-gray-50/80 font-bold border-t border-gray-200">
                    <tr>
                      <td className="py-2.5 px-3 text-slate-900">Total Fuel Volume</td>
                      <td className="py-2.5 px-3 text-right text-blue-600 tabular-nums">
                        {formatLiters(selectedShiftRecord.totalFuelVolume)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-gray-400">-</td>
                      <td className="py-2.5 px-3 text-right text-slate-900 tabular-nums">
                        {formatRs(selectedShiftRecord.grossFuelRevenue)}
                      </td>
                      <td className="py-2.5 px-3 text-center text-gray-500">100.0%</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* ------------------------------------------------------------- */}
            {/* SECTION 3: DETAILED PUMP READINGS & DISPENSERS */}
            {/* ------------------------------------------------------------- */}
            <div className="bg-white rounded-2xl border border-gray-200/80 p-5 shadow-2xs space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-gray-900 uppercase tracking-wider flex items-center gap-2">
                  <Layers className="w-4 h-4 text-purple-600" />
                  <span>Pump Dispenser Readings &amp; Pumper Collections ({selectedShiftRecord.pumpReadings.length})</span>
                </h3>
              </div>

              {selectedShiftRecord.pumpReadings.length > 0 ? (
                <div className="overflow-x-auto border border-gray-100 rounded-xl">
                  <table className="w-full text-left text-xs font-sans">
                    <thead className="bg-gray-50 font-bold text-gray-500 text-[10px] uppercase border-b border-gray-100">
                      <tr>
                        <th className="py-2.5 px-3">Pump &amp; Fuel</th>
                        <th className="py-2.5 px-3">Assigned Pumper</th>
                        <th className="py-2.5 px-3 text-right">Start Meter</th>
                        <th className="py-2.5 px-3 text-right">End Meter</th>
                        <th className="py-2.5 px-3 text-right">Testing (L)</th>
                        <th className="py-2.5 px-3 text-right">Sold Volume (L)</th>
                        <th className="py-2.5 px-3 text-right">Rate (Rs.)</th>
                        <th className="py-2.5 px-3 text-right">Total Sales (Rs.)</th>
                        <th className="py-2.5 px-3 text-right">Actual Cash</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {selectedShiftRecord.pumpReadings.map((r, idx) => {
                        const isOil = r.pumpId === 'pump-oil-bay' || r.fuelType === 'Oil & Lubricants';
                        const sold = isOil ? 0 : Math.max(0, (r.endMeter || 0) - (r.startMeter || 0) - (r.testingQty || 0));
                        const price = r.unitPrice || tankPriceMap.get(r.fuelType) || 0;
                        const salesAmt = isOil ? (r.oilSalesAmount || 0) : sold * price;
                        const pumperName = getPumperName(r.assignedPumperId);

                        return (
                          <tr key={r.pumpId || idx} className="hover:bg-gray-50">
                            <td className="py-2.5 px-3">
                              <div className="font-bold text-slate-900">{r.pumpName || r.pumpId}</div>
                              <div className="text-[10px] text-gray-500">{r.fuelType}</div>
                            </td>
                            <td className="py-2.5 px-3">
                              <div className="font-medium text-gray-800">{pumperName}</div>
                            </td>
                            <td className="py-2.5 px-3 text-right text-gray-500 tabular-nums">
                              {isOil ? '-' : (r.startMeter || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </td>
                            <td className="py-2.5 px-3 text-right text-gray-800 tabular-nums font-semibold">
                              {isOil ? '-' : (r.endMeter || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </td>
                            <td className="py-2.5 px-3 text-right text-gray-500 tabular-nums">
                              {isOil ? '-' : (r.testingQty || 0).toFixed(2)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-bold text-blue-600 tabular-nums">
                              {isOil ? '-' : `${sold.toFixed(2)} L`}
                            </td>
                            <td className="py-2.5 px-3 text-right text-gray-600 tabular-nums">
                              {isOil ? '-' : formatRs(price)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-bold text-slate-900 tabular-nums">
                              {formatRs(salesAmt)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-bold text-emerald-700 tabular-nums">
                              {formatRs(r.actualCash || 0)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-4 bg-gray-50 rounded-xl text-center text-xs text-gray-500">
                  No individual pump meter readings recorded for this shift.
                </div>
              )}
            </div>

            {/* ------------------------------------------------------------- */}
            {/* SECTION 4: LUBRICANTS & BULK OIL SUMMARY */}
            {/* ------------------------------------------------------------- */}
            {selectedShiftRecord.totalForecourtOilSales > 0 && (
              <div className="bg-white rounded-2xl border border-gray-200/80 p-5 shadow-2xs space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-gray-900 uppercase tracking-wider flex items-center gap-2">
                    <Droplet className="w-4 h-4 text-amber-600" />
                    <span>Lubricants &amp; Forecourt Bulk Oil Breakdown</span>
                  </h3>
                  <span className="text-xs font-bold text-amber-700">
                    Total Oil Sales: {formatRs(selectedShiftRecord.totalForecourtOilSales)}
                  </span>
                </div>

                {selectedShiftRecord.chamberBreakdown.length > 0 ? (
                  <div className="overflow-x-auto border border-gray-100 rounded-xl">
                    <table className="w-full text-left text-xs font-sans">
                      <thead className="bg-gray-50 font-bold text-gray-500 text-[10px] uppercase border-b border-gray-100">
                        <tr>
                          <th className="py-2 px-3">Chamber #</th>
                          <th className="py-2 px-3">Oil Grade</th>
                          <th className="py-2 px-3 text-right">Opening Level</th>
                          <th className="py-2 px-3 text-right">Closing Level</th>
                          <th className="py-2 px-3 text-right">Sold Liters</th>
                          <th className="py-2 px-3 text-right">Rate (Rs./L)</th>
                          <th className="py-2 px-3 text-right">Revenue (Rs.)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {selectedShiftRecord.chamberBreakdown.map((ch) => (
                          <tr key={ch.chamberNumber} className="hover:bg-gray-50">
                            <td className="py-2.5 px-3 font-bold text-slate-900">
                              Chamber {ch.chamberNumber}
                            </td>
                            <td className="py-2.5 px-3 font-semibold text-gray-700">{ch.grade}</td>
                            <td className="py-2.5 px-3 text-right text-gray-500 tabular-nums">
                              {ch.openingLevel.toFixed(2)} L
                            </td>
                            <td className="py-2.5 px-3 text-right text-gray-800 tabular-nums">
                              {ch.closingLevel.toFixed(2)} L
                            </td>
                            <td className="py-2.5 px-3 text-right font-bold text-amber-600 tabular-nums">
                              {ch.soldLiters.toFixed(2)} L
                            </td>
                            <td className="py-2.5 px-3 text-right text-gray-600 tabular-nums">
                              {formatRs(ch.ratePerLiter)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-bold text-slate-900 tabular-nums">
                              {formatRs(ch.totalAmount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="p-4 bg-amber-50/50 rounded-xl border border-amber-200/60 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <Droplet className="w-4 h-4 text-amber-600" />
                      <span className="text-amber-900 font-medium">
                        Forecourt Lubricant &amp; Oil Sales:
                      </span>
                    </div>
                    <span className="font-bold text-amber-900 tabular-nums">
                      {formatRs(selectedShiftRecord.totalForecourtOilSales)}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
