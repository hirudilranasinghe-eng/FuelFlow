/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Download, 
  FileSpreadsheet,
  Calendar, 
  Clock, 
  Fuel, 
  User, 
  Layers, 
  Gauge, 
  Droplet, 
  DollarSign, 
  Truck, 
  AlertTriangle, 
  CheckCircle2, 
  ChevronDown, 
  ArrowLeft,
  Search,
  Filter,
  RefreshCw,
  Scale,
  Package,
  Flame
} from 'lucide-react';
import { 
  Shift, 
  Employee, 
  FuelTank, 
  PumpReading, 
  StockDelivery, 
  DailyDipSession,
  ShiftCounterSales,
  ShiftGasSale,
  ShiftLubeSale
} from '../types';
import { supabase } from '../lib/supabase';

export interface ItemizedLubeSale {
  id: string;
  name: string;
  category: 'Packaged Lubricant' | 'Bulk Oil Dispenser';
  packSize: string;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
}

export interface ItemizedGasSale {
  id: string;
  name: string;
  size: string;
  type: string;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
}

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
            const mapped: DailyDipSession[] = dipData.map((d: any) => {
              const parsedEntries = typeof d.entries === 'string' 
                ? JSON.parse(d.entries) 
                : (d.entries || (typeof d.tanks === 'string' ? JSON.parse(d.tanks) : d.tanks) || []);
              return {
                id: d.id,
                date: d.date || d.dip_date || new Date().toISOString().slice(0, 10),
                time: d.time || '12:00',
                shift: d.shift || d.shift_id || 'Day',
                shiftId: d.shift_id,
                supervisor: d.supervisor || d.recorded_by || 'Supervisor',
                sessionType: d.session_type || d.sessiontype || 'daily_routine',
                entries: parsedEntries,
                totalSystemVolume: Number(d.total_system_volume || d.totalSystemVolume) || 0,
                totalPhysicalDip: Number(d.total_physical_dip || d.totalPhysicalDip) || 0,
                totalVarianceLiters: Number(d.total_variance_liters || d.totalVarianceLiters) || 0,
                tanksCount: Number(d.tanks_count || d.tanksCount) || parsedEntries.length,
                bowserAudit: typeof d.bowser_audit === 'string' ? JSON.parse(d.bowser_audit) : d.bowser_audit,
                remarks: d.remarks || d.notes || '',
                createdAt: d.created_at
              };
            });
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

  // Non-fuel counter sales state (LP Gas & Lubricants)
  const [counterSalesData, setCounterSalesData] = useState<ShiftCounterSales | null>(null);

  // Fetch & Map counter sales (LP Gas & Lubricants) for the selected shift
  useEffect(() => {
    if (!currentShift) {
      setCounterSalesData(null);
      return;
    }

    // 1. Check if currentShift object already has counterSales
    let initialSales: ShiftCounterSales | null = null;
    if (currentShift.counterSales) {
      initialSales = currentShift.counterSales;
    } else if ((currentShift as any).counter_sales || (currentShift as any).countersales) {
      const raw = (currentShift as any).counter_sales || (currentShift as any).countersales;
      try {
        initialSales = typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch (_) {}
    }

    // 2. Check localStorage
    if (!initialSales) {
      try {
        const local = localStorage.getItem(`fuelflow_counter_sales_${currentShift.id}`) ||
                      localStorage.getItem(`fuelflow_counter_committed_${currentShift.id}`);
        if (local) {
          initialSales = JSON.parse(local);
        }
      } catch (_) {}
    }

    setCounterSalesData(initialSales);

    // 3. Query Supabase shifts table for live counter_sales
    const fetchDbCounterSales = async () => {
      try {
        const isConfigured = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
        if (!isConfigured) return;

        const { data, error } = await supabase
          .from('shifts')
          .select('counter_sales, countersales')
          .eq('id', currentShift.id)
          .maybeSingle();

        if (data && !error) {
          const raw = data.counter_sales || data.countersales;
          if (raw) {
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (parsed && (parsed.gasSales || parsed.lubeSales)) {
              setCounterSalesData(parsed);
            }
          }
        }
      } catch (err) {
        console.warn('Notice loading counter sales in DailyShiftSummary:', err);
      }
    };

    fetchDbCounterSales();
  }, [currentShift?.id]);

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

  // Helper to map and resolve assigned pumper from reading or shift-level pumper assignments
  const resolvePumperForReading = (reading: PumpReading, shift: Shift | null): string => {
    // 1. Direct assigned pumper on reading
    if (reading.assignedPumperId) {
      const pName = getPumperName(reading.assignedPumperId);
      if (reading.replacementPumperId) {
        const replName = getPumperName(reading.replacementPumperId);
        return `${pName} (➔ ${replName})`;
      }
      return pName;
    }

    // 2. Check shift-level pumper_assignments or pumperAssignments array
    const assignments: any[] = 
      (shift as any)?.pumper_assignments || 
      (shift as any)?.pumperAssignments || 
      [];
    
    if (Array.isArray(assignments) && assignments.length > 0) {
      const matched = assignments.find(a => 
        (a.pump_ids && Array.isArray(a.pump_ids) && a.pump_ids.includes(reading.pumpId)) || 
        (a.pumpIds && Array.isArray(a.pumpIds) && a.pumpIds.includes(reading.pumpId))
      );
      if (matched) {
        return matched.pumper_name || getPumperName(matched.pumper_id || matched.pumperId);
      }
    }

    return 'Unassigned';
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

  const PRODUCT_DISPLAY_ORDER: Record<string, number> = {
    LP92: 1,
    LP95: 2,
    LSD: 3,
    LAD: 4,
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
        productGroups: [],
        productTotals: {
          LP92: { gross: 0, test: 0, net: 0, amount: 0, pumpers: [] },
          LP95: { gross: 0, test: 0, net: 0, amount: 0, pumpers: [] },
          LSD: { gross: 0, test: 0, net: 0, amount: 0, pumpers: [] },
          LAD: { gross: 0, test: 0, net: 0, amount: 0, pumpers: [] },
        },
        grandTotal: { gross: 0, test: 0, net: 0, amount: 0 },
        activePumpsCount: 0,
        totalPumpsCount: 0,
      };
    }

    // 1. Process all raw pump readings
    const allProcessedRows = currentShift.pumpReadings.map((r, idx) => {
      const start = Number(r.startMeter) || 0;
      const end = Number(r.endMeter) || 0;
      const test = Number(r.testingQty) || 0;
      const gross = Math.max(0, end - start);
      const net = Math.max(0, gross - test);
      const price = Number(r.unitPrice) || 0;
      const amount = net * price;
      const product = getProductCode(r.fuelType);
      const pumperName = resolvePumperForReading(r, currentShift);
      const isAssigned = pumperName !== 'Unassigned' && pumperName.trim().length > 0;
      const hasVolumeActivity = gross > 0 || test > 0;
      const hasCashOrSales = (Number(r.actualCash) || 0) > 0 || (Number(r.creditSalesAmount) || 0) > 0 || (Number(r.cardSalesAmount) || 0) > 0;
      const isStatusActive = r.status === 'Active' || r.isCardFinalized === true || r.isStartSaved === true;

      // Active / Assigned condition: pump was assigned or had sales/volume activity during this shift
      const isActiveOrAssigned = isAssigned || hasVolumeActivity || hasCashOrSales || isStatusActive;

      return {
        key: `${r.pumpId || idx}`,
        pumpId: r.pumpId,
        pumpName: r.pumpName || `Pump ${idx + 1}`,
        fuelType: r.fuelType,
        productCode: product.code,
        productLabel: product.label,
        productTagClass: product.tagClass,
        pumperName,
        isAssigned,
        isActiveOrAssigned,
        startMeter: start,
        endMeter: end,
        grossVolume: gross,
        testVolume: test,
        netVolume: net,
        unitPrice: price,
        totalAmount: amount,
      };
    });

    // 2. Filter Active Shift Pumps Only (exclude unassigned zero-activity pumps)
    const activeRows = allProcessedRows.filter(r => r.isActiveOrAssigned);
    // If every pump has zero readings & no pumper assigned, fallback gracefully to all processed
    const filteredRows = activeRows.length > 0 ? activeRows : allProcessedRows;

    // 3. Map & Group Pumpers by Fuel Type (LP92, LP95, LSD, LAD)
    const groupsMap = new Map<string, typeof filteredRows>();
    filteredRows.forEach(r => {
      const list = groupsMap.get(r.productCode) || [];
      list.push(r);
      groupsMap.set(r.productCode, list);
    });

    // Sort product groups according to standard sequence (LP92, LP95, LSD, LAD)
    const sortedProductCodes = Array.from(groupsMap.keys()).sort((a, b) => {
      const ordA = PRODUCT_DISPLAY_ORDER[a] || 99;
      const ordB = PRODUCT_DISPLAY_ORDER[b] || 99;
      return ordA - ordB;
    });

    const productGroups = sortedProductCodes.map(code => {
      const groupRows = groupsMap.get(code) || [];
      // Sort rows within the group by pump name naturally
      groupRows.sort((a, b) => a.pumpName.localeCompare(b.pumpName, undefined, { numeric: true, sensitivity: 'base' }));

      // Extract unique assigned pumpers for this fuel type
      const pumperSet = new Set<string>();
      groupRows.forEach(r => {
        if (r.pumperName && r.pumperName !== 'Unassigned') {
          pumperSet.add(r.pumperName);
        }
      });
      const assignedPumpers = Array.from(pumperSet);

      const subtotalGross = groupRows.reduce((sum, r) => sum + r.grossVolume, 0);
      const subtotalTest = groupRows.reduce((sum, r) => sum + r.testVolume, 0);
      const subtotalNet = groupRows.reduce((sum, r) => sum + r.netVolume, 0);
      const subtotalAmount = groupRows.reduce((sum, r) => sum + r.totalAmount, 0);

      const first = groupRows[0];
      return {
        productCode: code,
        productLabel: first ? first.productLabel : code,
        productTagClass: first ? first.productTagClass : 'bg-gray-100 text-gray-800 border-gray-200',
        assignedPumpers,
        subtotalGross,
        subtotalTest,
        subtotalNet,
        subtotalAmount,
        rows: groupRows,
      };
    });

    const productTotals: Record<string, { gross: number; test: number; net: number; amount: number; pumpers: string[] }> = {
      LP92: { gross: 0, test: 0, net: 0, amount: 0, pumpers: [] },
      LP95: { gross: 0, test: 0, net: 0, amount: 0, pumpers: [] },
      LSD: { gross: 0, test: 0, net: 0, amount: 0, pumpers: [] },
      LAD: { gross: 0, test: 0, net: 0, amount: 0, pumpers: [] },
    };

    productGroups.forEach(g => {
      productTotals[g.productCode] = {
        gross: g.subtotalGross,
        test: g.subtotalTest,
        net: g.subtotalNet,
        amount: g.subtotalAmount,
        pumpers: g.assignedPumpers,
      };
    });

    const totalGross = filteredRows.reduce((sum, r) => sum + r.grossVolume, 0);
    const totalTest = filteredRows.reduce((sum, r) => sum + r.testVolume, 0);
    const totalNet = filteredRows.reduce((sum, r) => sum + r.netVolume, 0);
    const totalAmt = filteredRows.reduce((sum, r) => sum + r.totalAmount, 0);

    return {
      rows: filteredRows,
      productGroups,
      productTotals,
      grandTotal: { gross: totalGross, test: totalTest, net: totalNet, amount: totalAmt },
      activePumpsCount: activeRows.length,
      totalPumpsCount: allProcessedRows.length,
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

  // Extract and process Itemized LP Gas and Forecourt Lubricant / Oil Sales
  const nonFuelSalesAnalysis = useMemo(() => {
    if (!currentShift) {
      return {
        gasItems: [] as ItemizedGasSale[],
        lubeItems: [] as ItemizedLubeSale[],
        totalGasQty: 0,
        totalGasAmount: 0,
        totalLubeQty: 0,
        totalLubeAmount: 0,
        totalNonFuelAmount: 0,
      };
    }

    // 1. Extract Gas Sales
    let rawGas: ShiftGasSale[] = [];
    if (counterSalesData?.gasSales && Array.isArray(counterSalesData.gasSales) && counterSalesData.gasSales.length > 0) {
      rawGas = counterSalesData.gasSales;
    } else if (currentShift.counterSales?.gasSales && Array.isArray(currentShift.counterSales.gasSales) && currentShift.counterSales.gasSales.length > 0) {
      rawGas = currentShift.counterSales.gasSales;
    } else {
      const rawCounter = (currentShift as any).counter_sales || (currentShift as any).countersales;
      if (rawCounter) {
        try {
          const parsed = typeof rawCounter === 'string' ? JSON.parse(rawCounter) : rawCounter;
          if (parsed?.gasSales && Array.isArray(parsed.gasSales)) rawGas = parsed.gasSales;
        } catch (_) {}
      }
    }

    if (rawGas.length === 0) {
      try {
        const local = localStorage.getItem(`fuelflow_counter_sales_${currentShift.id}`);
        if (local) {
          const parsed = JSON.parse(local);
          if (parsed?.gasSales && Array.isArray(parsed.gasSales)) rawGas = parsed.gasSales;
        }
      } catch (_) {}
    }

    // Standard fallback gas items if no sales were ever initialized
    if (rawGas.length === 0) {
      rawGas = [
        { gasItemId: 'gas-12.5kg', size: '12.5 kg', type: '12.5kg', quantity: 0, unitPrice: 3690, totalAmount: 0 },
        { gasItemId: 'gas-5kg', size: '5.0 kg', type: '5kg', quantity: 0, unitPrice: 1482, totalAmount: 0 },
        { gasItemId: 'gas-2.3kg', size: '2.3 kg', type: '2.3kg', quantity: 0, unitPrice: 694, totalAmount: 0 },
      ];
    }

    const gasItems: ItemizedGasSale[] = rawGas.map((g, idx) => {
      const qty = Number(g.quantity) || 0;
      const price = Number(g.unitPrice) || 0;
      const total = Number(g.totalAmount) || (qty * price);
      const sizeLabel = g.size || (g.type === '12.5kg' ? '12.5 kg' : g.type === '5kg' ? '5.0 kg' : g.type === '2.3kg' ? '2.3 kg' : 'Standard');
      
      let name = `Litro Gas ${sizeLabel} Cylinder`;
      if (sizeLabel.toLowerCase().includes('refill')) {
        name = `Litro Gas ${sizeLabel}`;
      } else {
        name = `Litro Gas ${sizeLabel} (Refill / New Set)`;
      }

      return {
        id: g.gasItemId || g.type || `gas_${idx}`,
        name,
        size: sizeLabel,
        type: g.type || sizeLabel,
        quantity: qty,
        unitPrice: price,
        totalAmount: total,
      };
    });

    // 2. Extract Packaged Lubricants & Forecourt Bulk Oil Sales
    const lubeItems: ItemizedLubeSale[] = [];

    // A. Packaged Lubes from Counter Sales
    let rawPackaged: ShiftLubeSale[] = [];
    if (counterSalesData?.lubeSales && Array.isArray(counterSalesData.lubeSales) && counterSalesData.lubeSales.length > 0) {
      rawPackaged = counterSalesData.lubeSales;
    } else if (currentShift.counterSales?.lubeSales && Array.isArray(currentShift.counterSales.lubeSales) && currentShift.counterSales.lubeSales.length > 0) {
      rawPackaged = currentShift.counterSales.lubeSales;
    } else {
      const rawCounter = (currentShift as any).counter_sales || (currentShift as any).countersales;
      if (rawCounter) {
        try {
          const parsed = typeof rawCounter === 'string' ? JSON.parse(rawCounter) : rawCounter;
          if (parsed?.lubeSales && Array.isArray(parsed.lubeSales)) rawPackaged = parsed.lubeSales;
        } catch (_) {}
      }
    }

    if (rawPackaged.length === 0) {
      try {
        const local = localStorage.getItem(`fuelflow_counter_sales_${currentShift.id}`);
        if (local) {
          const parsed = JSON.parse(local);
          if (parsed?.lubeSales && Array.isArray(parsed.lubeSales)) rawPackaged = parsed.lubeSales;
        }
      } catch (_) {}
    }

    rawPackaged.forEach((l, idx) => {
      const qty = Number(l.quantity ?? (l as any).quantitySold) || 0;
      const price = Number(l.unitPrice) || 0;
      const total = Number(l.totalAmount) || (qty * price);
      
      lubeItems.push({
        id: l.id || `lube_${idx}`,
        name: l.name || (l as any).itemName || `Packaged Lubricant ${idx + 1}`,
        category: 'Packaged Lubricant',
        packSize: l.packSize || (l as any).packageSize || 'Bottle / Can',
        quantity: qty,
        unitPrice: price,
        totalAmount: total,
      });
    });

    // B. Bulk Oil from Forecourt 4-Chamber Dispenser or Oil Bay pump readings
    const readings = currentShift.pumpReadings || [];
    readings.forEach((r, rIdx) => {
      const isOilBay =
        r.pumpId === 'pump-oil-bay' ||
        r.fuelType === 'Oil & Lubricants' ||
        (r.pumpName && r.pumpName.toLowerCase().includes('oil'));

      if (r.chamberReadings && Array.isArray(r.chamberReadings) && r.chamberReadings.length > 0) {
        r.chamberReadings.forEach((ch, chIdx) => {
          const sold = Number(ch.soldLiters) || 0;
          const rate = Number(ch.ratePerLiter) || 0;
          const amt = Number(ch.totalAmount) || (sold * rate);
          if (sold > 0 || amt > 0) {
            lubeItems.push({
              id: `chamber_${ch.chamberNumber || chIdx + 1}`,
              name: `Forecourt Bulk Oil - Chamber ${ch.chamberNumber || chIdx + 1} (${ch.grade || 'Engine Oil'})`,
              category: 'Bulk Oil Dispenser',
              packSize: 'Loose (L)',
              quantity: sold,
              unitPrice: rate,
              totalAmount: amt,
            });
          }
        });
      } else if (isOilBay && Number(r.oilSalesAmount) > 0) {
        lubeItems.push({
          id: `oil_bay_${rIdx}`,
          name: r.pumpName || 'Forecourt Loose Engine Oil Dispenser',
          category: 'Bulk Oil Dispenser',
          packSize: 'Loose (L)',
          quantity: 1,
          unitPrice: Number(r.oilSalesAmount) || 0,
          totalAmount: Number(r.oilSalesAmount) || 0,
        });
      }
    });

    const totalGasQty = gasItems.reduce((sum, g) => sum + g.quantity, 0);
    const totalGasAmount = gasItems.reduce((sum, g) => sum + g.totalAmount, 0);
    const totalLubeQty = lubeItems.reduce((sum, l) => sum + l.quantity, 0);
    const totalLubeAmount = lubeItems.reduce((sum, l) => sum + l.totalAmount, 0);

    return {
      gasItems,
      lubeItems,
      totalGasQty,
      totalGasAmount,
      totalLubeQty,
      totalLubeAmount,
      totalNonFuelAmount: totalGasAmount + totalLubeAmount,
    };
  }, [currentShift, counterSalesData]);

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
    
    // Non-fuel sales from itemized analysis, with fallbacks to shift properties
    const lubricants = nonFuelSalesAnalysis.totalLubeAmount > 0
      ? nonFuelSalesAnalysis.totalLubeAmount
      : Number(currentShift.totalForecourtOilSales || (currentShift as any).oil_sales || 0);

    const gasSales = nonFuelSalesAnalysis.totalGasAmount > 0
      ? nonFuelSalesAnalysis.totalGasAmount
      : Number((currentShift as any).totalGasSales || 0);

    // Reconcile Total Gross Revenue:
    // Total Gross Shift Turnover correctly sums: Total Fuel Revenue + Oil Sales Total + LP Gas Sales Total
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
  }, [currentShift, pumpSalesAnalysis, nonFuelSalesAnalysis]);

  // Handler for exporting comprehensive daily shift summary as an Exact HTML-Structured Excel File (.xls)
  const handleExportExcel = () => {
    if (!currentShift) return;

    const escapeHtml = (str: any) => {
      if (str === undefined || str === null) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    };

    const fNum = (val: number | undefined | null) => {
      if (val === undefined || val === null || isNaN(val)) return '0.00';
      return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    const shiftDate = (currentShift as any).date || currentShift.startTime?.slice(0, 10) || new Date().toISOString().slice(0, 10);
    const supervisorName = getSupervisorName(currentShift.supervisorId);
    const startTimeStr = currentShift.startTime ? currentShift.startTime.slice(11, 16) : '06:00';
    const endTimeStr = currentShift.endTime ? currentShift.endTime.slice(11, 16) : 'Active';
    const hours = `${startTimeStr} - ${endTimeStr}`;
    const durationHrs = currentShift.startTime && currentShift.endTime 
      ? Math.max(0, (new Date(currentShift.endTime).getTime() - new Date(currentShift.startTime).getTime()) / (1000 * 60 * 60)).toFixed(1) + ' hrs'
      : 'Ongoing';
    const auditRemarks = currentShift.notes || (currentShift as any).handoverNotes || 'Station Shift Reconciled & Audited';

    // Totals for Underground Tank Dip Reconciliation
    const sumOpening = tankDipReconciliation.reduce((s, t) => s + t.openingStock, 0);
    const sumReceived = tankDipReconciliation.reduce((s, t) => s + t.receivedBowserLoads, 0);
    const sumTotalStock = tankDipReconciliation.reduce((s, t) => s + t.totalStock, 0);
    const sumMeterSales = tankDipReconciliation.reduce((s, t) => s + t.meterSales, 0);
    const sumExpected = tankDipReconciliation.reduce((s, t) => s + t.expectedBookStock, 0);
    const sumClosing = tankDipReconciliation.reduce((s, t) => s + t.actualClosingStock, 0);
    const sumVariance = tankDipReconciliation.reduce((s, t) => s + t.shortExcess, 0);
    const sumVarianceRs = tankDipReconciliation.reduce((s, t) => s + t.shortExcessRs, 0);

    const htmlContent = `
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
  <!--[if gte mso 9]>
  <xml>
    <x:ExcelWorkbook>
      <x:ExcelWorksheets>
        <x:ExcelWorksheet>
          <x:Name>Shift Summary Audit</x:Name>
          <x:WorksheetOptions>
            <x:DisplayGridlines/>
          </x:WorksheetOptions>
        </x:ExcelWorksheet>
      </x:ExcelWorksheets>
    </x:ExcelWorkbook>
  </xml>
  <![endif]-->
  <style>
    body { font-family: Calibri, 'Segoe UI', Arial, sans-serif; font-size: 11pt; color: #0f172a; margin: 0; padding: 20px; }
    table { border-collapse: collapse; margin-bottom: 25px; width: 100%; mso-displayed-decimal-separator: "."; mso-displayed-thousand-separator: ","; }
    th { border: 1px solid #94a3b8; background-color: #f1f5f9; color: #1e293b; font-weight: bold; padding: 7px 10px; font-size: 10pt; }
    td { border: 1px solid #cbd5e1; padding: 6px 9px; font-size: 10pt; vertical-align: middle; }
    .num { mso-number-format: "#,##0.00"; text-align: right; }
    .num-bold { mso-number-format: "#,##0.00"; text-align: right; font-weight: bold; }
    .text-cell { mso-number-format: "\@"; }
    .bold { font-weight: bold; }
    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .header-banner { background-color: #0f172a; color: #ffffff; font-weight: bold; text-align: center; font-size: 14pt; padding: 12px; }
    .section-title { background-color: #312e81; color: #ffffff; font-weight: bold; font-size: 11pt; padding: 8px 12px; }
    .group-hdr { background-color: #f1f5f9; font-weight: bold; color: #0f172a; }
    .subtotal-row { background-color: #f8fafc; font-weight: bold; border-top: 1px solid #94a3b8; border-bottom: 1px solid #94a3b8; }
    .grand-total-row { background-color: #e0e7ff; color: #1e1b4b; font-weight: bold; font-size: 11pt; border-top: 2px solid #312e81; border-bottom: 2px solid #312e81; }
  </style>
</head>
<body>

  <!-- MASTER REPORT HEADER -->
  <table style="width: 100%; border: none;">
    <tr>
      <td colspan="10" class="header-banner" style="background-color: #0f172a; color: #ffffff; text-align: center; font-size: 15pt; font-weight: bold; padding: 14px;">
        FUELFLOW PRO • CPC DAILY SHIFT AUDIT &amp; FUEL RECONCILIATION REPORT
      </td>
    </tr>
    <tr>
      <td colspan="10" style="text-align: center; color: #475569; font-size: 10pt; padding: 5px; border: none;">
        Official Station Licensee Record • Meter Sales, Tank Dips, Inventory &amp; Cash Reconciliation
      </td>
    </tr>
  </table>

  <!-- SECTION 1: SHIFT INFORMATION & METADATA -->
  <table style="width: 100%;">
    <thead>
      <tr>
        <th colspan="6" class="section-title" style="background-color: #1e1b4b; color: #ffffff; text-align: left; padding: 8px 12px; font-size: 11pt;">
          SECTION 1: SHIFT INFORMATION &amp; METADATA
        </th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <th style="width: 16%; background-color: #f8fafc; text-align: left;">Shift Reference ID</th>
        <td style="width: 18%; font-weight: bold; font-family: Consolas, monospace;">${escapeHtml(currentShift.id)}</td>
        <th style="width: 15%; background-color: #f8fafc; text-align: left;">Audit Date</th>
        <td style="width: 18%; font-weight: bold;">${escapeHtml(shiftDate)}</td>
        <th style="width: 15%; background-color: #f8fafc; text-align: left;">Operating Hours</th>
        <td style="width: 18%; font-weight: bold;">${escapeHtml(hours)} (${escapeHtml(durationHrs)})</td>
      </tr>
      <tr>
        <th style="background-color: #f8fafc; text-align: left;">Shift Name</th>
        <td>${escapeHtml(currentShift.name || `Shift ${currentShift.id}`)}</td>
        <th style="background-color: #f8fafc; text-align: left;">Supervisor in Charge</th>
        <td style="font-weight: bold; color: #312e81;">${escapeHtml(supervisorName)}</td>
        <th style="background-color: #f8fafc; text-align: left;">Shift Status</th>
        <td style="font-weight: bold; color: ${currentShift.isActive ? '#047857' : '#0f172a'};">${currentShift.isActive ? 'ACTIVE' : 'COMPLETED'}</td>
      </tr>
      <tr>
        <th style="background-color: #f8fafc; text-align: left;">Station Facility</th>
        <td>CPC Retail Petroleum Station #442</td>
        <th style="background-color: #f8fafc; text-align: left;">Active Nozzles</th>
        <td>${pumpSalesAnalysis.rows.length} Active Dispensers</td>
        <th style="background-color: #f8fafc; text-align: left;">Audit Remarks</th>
        <td>${escapeHtml(auditRemarks)}</td>
      </tr>
    </tbody>
  </table>

  <!-- SECTION 2: METER & DAILY SALES SUMMARY (PER PUMP / NOZZLE) -->
  <table style="width: 100%;">
    <thead>
      <tr>
        <th colspan="10" class="section-title" style="background-color: #312e81; color: #ffffff; text-align: left; padding: 8px 12px; font-size: 11pt;">
          SECTION 2: METER &amp; DAILY SALES SUMMARY (PER PUMP MACHINE / NOZZLE)
        </th>
      </tr>
      <tr style="background-color: #f1f5f9; font-weight: bold;">
        <th style="text-align: left; width: 14%;">Pump / Nozzle</th>
        <th style="text-align: left; width: 10%;">Product</th>
        <th style="text-align: left; width: 14%;">Assigned Pumper</th>
        <th style="text-align: right; width: 10%;">Opening Meter (L)</th>
        <th style="text-align: right; width: 10%;">Closing Meter (L)</th>
        <th style="text-align: right; width: 9%;">Gross Sales (L)</th>
        <th style="text-align: right; width: 8%;">Testing Deduct (L)</th>
        <th style="text-align: right; width: 9%; background-color: #e0e7ff; font-weight: bold;">Net Fuel Sales (L)</th>
        <th style="text-align: right; width: 8%;">Unit Price (Rs.)</th>
        <th style="text-align: right; width: 8%;">Sales Amount (Rs.)</th>
      </tr>
    </thead>
    <tbody>
      ${pumpSalesAnalysis.productGroups.length === 0 ? `
        <tr><td colspan="10" style="text-align: center; color: #64748b; padding: 12px;">No active pump machines recorded for this shift.</td></tr>
      ` : pumpSalesAnalysis.productGroups.map(group => `
        <tr style="background-color: #f8fafc; font-weight: bold; border-top: 2px solid #cbd5e1;">
          <td colspan="10" style="padding: 7px 10px; background-color: #f1f5f9;">
            <strong style="color: #1e1b4b;">[${escapeHtml(group.productCode)}] ${escapeHtml(group.productLabel)}</strong>
            (${group.rows.length} Active Nozzle${group.rows.length === 1 ? '' : 's'}) &nbsp;&nbsp;|&nbsp;&nbsp; 
            Assigned Pumper(s): <strong>${escapeHtml(group.assignedPumpers.join(', ') || 'Unassigned')}</strong>
          </td>
        </tr>
        ${group.rows.map(row => `
          <tr>
            <td style="font-weight: bold;">${escapeHtml(row.pumpName)}</td>
            <td>${escapeHtml(row.productCode)}</td>
            <td>${escapeHtml(row.pumperName)}</td>
            <td class="num">${fNum(row.startMeter)}</td>
            <td class="num">${fNum(row.endMeter)}</td>
            <td class="num">${fNum(row.grossVolume)}</td>
            <td class="num" style="color: #dc2626;">${row.testVolume > 0 ? `-${fNum(row.testVolume)}` : '0.00'}</td>
            <td class="num-bold" style="background-color: #f0f4ff; color: #1e1b4b;">${fNum(row.netVolume)}</td>
            <td class="num">${fNum(row.unitPrice)}</td>
            <td class="num-bold">${fNum(row.totalAmount)}</td>
          </tr>
        `).join('')}
        <tr class="subtotal-row" style="background-color: #f8fafc; font-weight: bold;">
          <td colspan="3" style="text-align: right;">Subtotal ${escapeHtml(group.productCode)} (${group.rows.length} Nozzles):</td>
          <td colspan="2" style="text-align: center; color: #94a3b8;">--</td>
          <td class="num">${fNum(group.subtotalGross)}</td>
          <td class="num" style="color: #dc2626;">${group.subtotalTest > 0 ? `-${fNum(group.subtotalTest)}` : '0.00'}</td>
          <td class="num-bold" style="background-color: #e0e7ff; color: #1e1b4b;">${fNum(group.subtotalNet)}</td>
          <td style="text-align: center; color: #94a3b8;">--</td>
          <td class="num-bold" style="color: #0f172a;">${fNum(group.subtotalAmount)}</td>
        </tr>
      `).join('')}
    </tbody>
    <tfoot>
      <tr class="grand-total-row">
        <td colspan="5" style="text-align: right; text-transform: uppercase;">GRAND TOTAL FUEL SALES:</td>
        <td class="num">${fNum(pumpSalesAnalysis.grandTotal.gross)}</td>
        <td class="num" style="color: #dc2626;">-${fNum(pumpSalesAnalysis.grandTotal.test)}</td>
        <td class="num-bold" style="background-color: #c7d2fe; font-size: 12pt; color: #1e1b4b;">${fNum(pumpSalesAnalysis.grandTotal.net)}</td>
        <td style="text-align: center;">--</td>
        <td class="num-bold" style="font-size: 12pt; color: #0f172a;">${fNum(pumpSalesAnalysis.grandTotal.amount)}</td>
      </tr>
    </tfoot>
  </table>

  <!-- SECTION 3: UNDERGROUND TANK DIP RECONCILIATION -->
  <table style="width: 100%;">
    <thead>
      <tr>
        <th colspan="9" class="section-title" style="background-color: #047857; color: #ffffff; text-align: left; padding: 8px 12px; font-size: 11pt;">
          SECTION 3: UNDERGROUND TANK DIP RECONCILIATION (OPENING VS. CLOSING PHYSICAL DIPS)
        </th>
      </tr>
      <tr style="background-color: #f1f5f9; font-weight: bold;">
        <th style="text-align: left; width: 18%;">Tank &amp; Product</th>
        <th style="text-align: right; width: 11%;">Opening Stock (L)</th>
        <th style="text-align: right; width: 11%;">Received Bowser Loads (L)</th>
        <th style="text-align: right; width: 10%;">Total Stock (L)</th>
        <th style="text-align: right; width: 10%;">Meter Sales (L)</th>
        <th style="text-align: right; width: 10%;">Book Stock (L)</th>
        <th style="text-align: right; width: 11%;">Closing Stock (L)</th>
        <th style="text-align: right; width: 9%;">Variance (L)</th>
        <th style="text-align: right; width: 10%;">Variance Value (Rs.)</th>
      </tr>
    </thead>
    <tbody>
      ${tankDipReconciliation.map(tank => `
        <tr>
          <td>
            <strong>${escapeHtml(tank.tankName)}</strong><br/>
            <span style="font-size: 8.5pt; color: #64748b;">${escapeHtml(tank.productCode)} • Capacity: ${tank.capacity}L</span>
          </td>
          <td class="num">
            <strong>${fNum(tank.openingStock)}</strong><br/>
            <span style="font-size: 8pt; color: #94a3b8;">(${tank.openingDipMm} mm)</span>
          </td>
          <td class="num" style="color: #047857; font-weight: bold;">
            ${tank.receivedBowserLoads > 0 ? `+${fNum(tank.receivedBowserLoads)}` : '0.00'}
          </td>
          <td class="num-bold">${fNum(tank.totalStock)}</td>
          <td class="num" style="color: #312e81; font-weight: bold;">-${fNum(tank.meterSales)}</td>
          <td class="num">${fNum(tank.expectedBookStock)}</td>
          <td class="num">
            <strong>${fNum(tank.actualClosingStock)}</strong><br/>
            <span style="font-size: 8pt; color: #94a3b8;">(${tank.closingDipMm} mm)</span>
          </td>
          <td class="num-bold" style="color: ${tank.shortExcess < -1 ? '#dc2626' : tank.shortExcess > 1 ? '#047857' : '#334155'};">
            ${tank.shortExcess >= 0 ? '+' : ''}${fNum(tank.shortExcess)}
          </td>
          <td class="num-bold" style="color: ${tank.shortExcess < -1 ? '#dc2626' : tank.shortExcess > 1 ? '#047857' : '#334155'};">
            ${fNum(tank.shortExcessRs)}
          </td>
        </tr>
      `).join('')}
    </tbody>
    <tfoot>
      <tr style="background-color: #f1f5f9; font-weight: bold; border-top: 2px solid #047857;">
        <td style="text-align: right; text-transform: uppercase;">TOTAL TANK RECONCILIATION:</td>
        <td class="num">${fNum(sumOpening)}</td>
        <td class="num" style="color: #047857;">+${fNum(sumReceived)}</td>
        <td class="num-bold">${fNum(sumTotalStock)}</td>
        <td class="num" style="color: #312e81;">-${fNum(sumMeterSales)}</td>
        <td class="num">${fNum(sumExpected)}</td>
        <td class="num-bold">${fNum(sumClosing)}</td>
        <td class="num-bold" style="font-size: 11pt; color: ${sumVariance < -1 ? '#dc2626' : sumVariance > 1 ? '#047857' : '#334155'};">
          ${sumVariance >= 0 ? '+' : ''}${fNum(sumVariance)}
        </td>
        <td class="num-bold" style="font-size: 11pt; color: ${sumVariance < -1 ? '#dc2626' : sumVariance > 1 ? '#047857' : '#334155'};">
          ${fNum(sumVarianceRs)}
        </td>
      </tr>
    </tfoot>
  </table>

  <!-- SECTION 4A: FORECOURT PACKAGED LUBRICANTS & OIL SALES BREAKDOWN -->
  <table style="width: 100%;">
    <thead>
      <tr>
        <th colspan="5" class="section-title" style="background-color: #b45309; color: #ffffff; text-align: left; padding: 8px 12px; font-size: 11pt;">
          SECTION 4A: FORECOURT PACKAGED LUBRICANTS &amp; OIL SALES BREAKDOWN
        </th>
      </tr>
      <tr style="background-color: #f1f5f9; font-weight: bold;">
        <th style="text-align: left; width: 40%;">Item Description &amp; Brand</th>
        <th style="text-align: left; width: 22%;">Category / Pack Size</th>
        <th style="text-align: right; width: 12%;">Qty Sold</th>
        <th style="text-align: right; width: 13%;">Unit Price (Rs.)</th>
        <th style="text-align: right; width: 13%;">Total Amount (Rs.)</th>
      </tr>
    </thead>
    <tbody>
      ${nonFuelSalesAnalysis.lubeItems.length === 0 ? `
        <tr><td colspan="5" style="text-align: center; color: #94a3b8; padding: 12px;">No packaged lubricant or forecourt oil sales recorded for this shift (Rs. 0.00)</td></tr>
      ` : nonFuelSalesAnalysis.lubeItems.map(item => `
        <tr>
          <td style="font-weight: bold;">${escapeHtml(item.name)}</td>
          <td>${escapeHtml(item.packSize)}</td>
          <td class="num">${item.quantity > 0 ? (item.category === 'Bulk Oil Dispenser' ? `${item.quantity.toFixed(2)} L` : String(item.quantity)) : '0'}</td>
          <td class="num">${fNum(item.unitPrice)}</td>
          <td class="num-bold">${fNum(item.totalAmount)}</td>
        </tr>
      `).join('')}
    </tbody>
    <tfoot>
      <tr style="background-color: #fef3c7; font-weight: bold; border-top: 2px solid #b45309;">
        <td colspan="2" style="text-align: right; text-transform: uppercase;">Subtotal - Forecourt Packaged Lubricants &amp; Oil:</td>
        <td class="num">${nonFuelSalesAnalysis.totalLubeQty}</td>
        <td style="text-align: center; color: #94a3b8;">--</td>
        <td class="num-bold" style="font-size: 11pt; color: #78350f;">${fNum(financialSettlement.lubricants)}</td>
      </tr>
    </tfoot>
  </table>

  <!-- SECTION 4B: LP GAS CYLINDER SALES BREAKDOWN -->
  <table style="width: 100%;">
    <thead>
      <tr>
        <th colspan="5" class="section-title" style="background-color: #be123c; color: #ffffff; text-align: left; padding: 8px 12px; font-size: 11pt;">
          SECTION 4B: LP GAS CYLINDER SALES BREAKDOWN (REFILLS / NEW SETS)
        </th>
      </tr>
      <tr style="background-color: #f1f5f9; font-weight: bold;">
        <th style="text-align: left; width: 40%;">Cylinder Specification &amp; Size</th>
        <th style="text-align: left; width: 22%;">Category / Refill Type</th>
        <th style="text-align: right; width: 12%;">Qty Sold (Cylinders)</th>
        <th style="text-align: right; width: 13%;">Unit Price (Rs.)</th>
        <th style="text-align: right; width: 13%;">Total Amount (Rs.)</th>
      </tr>
    </thead>
    <tbody>
      ${nonFuelSalesAnalysis.gasItems.length === 0 ? `
        <tr><td colspan="5" style="text-align: center; color: #94a3b8; padding: 12px;">No LP Gas cylinder sales recorded for this shift (Rs. 0.00)</td></tr>
      ` : nonFuelSalesAnalysis.gasItems.map(item => `
        <tr>
          <td style="font-weight: bold;">${escapeHtml(item.name)}</td>
          <td>${escapeHtml(item.size)} Cylinder / Refill</td>
          <td class="num">${item.quantity}</td>
          <td class="num">${fNum(item.unitPrice)}</td>
          <td class="num-bold">${fNum(item.totalAmount)}</td>
        </tr>
      `).join('')}
    </tbody>
    <tfoot>
      <tr style="background-color: #ffe4e6; font-weight: bold; border-top: 2px solid #be123c;">
        <td colspan="2" style="text-align: right; text-transform: uppercase;">Subtotal - LP Gas Cylinder Sales:</td>
        <td class="num">${nonFuelSalesAnalysis.totalGasQty}</td>
        <td style="text-align: center; color: #94a3b8;">--</td>
        <td class="num-bold" style="font-size: 11pt; color: #881337;">${fNum(financialSettlement.gasSales)}</td>
      </tr>
    </tfoot>
  </table>

  <!-- SECTION 5: FINANCIAL SETTLEMENT & CASH HANDOVER RECONCILIATION -->
  <table style="width: 100%;">
    <thead>
      <tr>
        <th colspan="4" class="section-title" style="background-color: #0f172a; color: #ffffff; text-align: left; padding: 8px 12px; font-size: 11pt;">
          SECTION 5: FINANCIAL SETTLEMENT &amp; REVENUE RECONCILIATION
        </th>
      </tr>
    </thead>
    <tbody>
      <!-- Sub-block 1: Gross Station Revenue -->
      <tr style="background-color: #f1f5f9; font-weight: bold;">
        <td colspan="3" style="font-weight: bold; text-transform: uppercase; width: 75%;">Gross Station Revenue Streams</td>
        <td style="text-align: right; font-weight: bold; width: 25%;">Amount (Rs.)</td>
      </tr>
      <tr>
        <td colspan="3">1. Forecourt Net Fuel Sales (Dispenser Meters)</td>
        <td class="num">${fNum(financialSettlement.grossFuel)}</td>
      </tr>
      <tr>
        <td colspan="3">2. Packaged Lubricants &amp; Forecourt Bulk Oil Sales</td>
        <td class="num">${fNum(financialSettlement.lubricants)}</td>
      </tr>
      <tr>
        <td colspan="3">3. Litro LP Gas Cylinder Sales</td>
        <td class="num">${fNum(financialSettlement.gasSales)}</td>
      </tr>
      <tr style="background-color: #e0e7ff; font-weight: bold; border-top: 2px solid #4338ca;">
        <td colspan="3" style="font-weight: bold; text-transform: uppercase;">TOTAL GROSS SHIFT TURNOVER:</td>
        <td class="num-bold" style="font-size: 12pt; color: #1e1b4b;">${fNum(financialSettlement.grossTotal)}</td>
      </tr>

      <!-- Sub-block 2: Non-Cash Deductions -->
      <tr style="background-color: #f1f5f9; font-weight: bold;">
        <td colspan="3" style="font-weight: bold; text-transform: uppercase;">Non-Cash Revenue Deductions</td>
        <td style="text-align: right; font-weight: bold;">Amount (Rs.)</td>
      </tr>
      <tr>
        <td colspan="3">Corporate Credit Sales (Invoiced Debtors)</td>
        <td class="num">${fNum(financialSettlement.creditSales)}</td>
      </tr>
      <tr>
        <td colspan="3">Card POS / Digital Swipes (Bank Merchant Terminals)</td>
        <td class="num">${fNum(financialSettlement.cardSales)}</td>
      </tr>
      <tr>
        <td colspan="3">Touch Card (IOC/Fleet) &amp; Physical Station Vouchers</td>
        <td class="num">${fNum(financialSettlement.touchCardSales + financialSettlement.voucherSales)}</td>
      </tr>
      <tr style="background-color: #fee2e2; font-weight: bold; border-top: 1px solid #ef4444;">
        <td colspan="3" style="font-weight: bold; text-transform: uppercase;">TOTAL NON-CASH DEDUCTIONS:</td>
        <td class="num-bold" style="font-size: 11pt; color: #991b1b;">${fNum(financialSettlement.totalNonCash)}</td>
      </tr>

      <!-- Sub-block 3: Net Cash Reconciliation -->
      <tr style="background-color: #f1f5f9; font-weight: bold;">
        <td colspan="3" style="font-weight: bold; text-transform: uppercase;">Cash Reconciliation &amp; Shift Variance</td>
        <td style="text-align: right; font-weight: bold;">Amount (Rs.)</td>
      </tr>
      <tr style="font-weight: bold;">
        <td colspan="3">Net Expected Physical Cash (Gross Turnover minus Non-Cash)</td>
        <td class="num-bold" style="color: #312e81; font-size: 11pt;">${fNum(financialSettlement.expectedCash)}</td>
      </tr>
      <tr style="font-weight: bold;">
        <td colspan="3">Physical Cash Handover / Banked (Pumper Collection &amp; Safe Drop)</td>
        <td class="num-bold" style="font-size: 11pt;">${fNum(financialSettlement.actualCashHanded > 0 ? financialSettlement.actualCashHanded : financialSettlement.cashBanked)}</td>
      </tr>
      <tr style="background-color: ${financialSettlement.varianceStatus === 'Shortage' ? '#fef2f2' : financialSettlement.varianceStatus === 'Excess' ? '#f0fdf4' : '#f8fafc'}; border-top: 2px solid #0f172a; border-bottom: 2px solid #0f172a;">
        <td colspan="2" style="font-size: 11pt; font-weight: bold;">NET CASH VARIANCE:</td>
        <td style="font-weight: bold; color: ${financialSettlement.varianceStatus === 'Shortage' ? '#dc2626' : financialSettlement.varianceStatus === 'Excess' ? '#047857' : '#0f172a'};">${financialSettlement.varianceStatus.toUpperCase()}</td>
        <td class="num-bold" style="font-size: 12pt; color: ${financialSettlement.varianceStatus === 'Shortage' ? '#dc2626' : financialSettlement.varianceStatus === 'Excess' ? '#047857' : '#0f172a'};">
          ${financialSettlement.variance >= 0 ? '+' : ''}${fNum(financialSettlement.variance)}
        </td>
      </tr>
    </tbody>
  </table>

  <!-- SIGNATURES & AUDIT AUTHORIZATION -->
  <table style="width: 100%; margin-top: 30px; border: none;">
    <tr>
      <td style="width: 33%; text-align: center; padding: 25px 15px 15px; border: 1px solid #cbd5e1; background-color: #ffffff;">
        <div style="font-weight: bold; color: #0f172a; padding-bottom: 30px;">${escapeHtml(supervisorName)}</div>
        <div style="border-top: 1px solid #94a3b8; padding-top: 6px; font-weight: bold; font-size: 9.5pt;">PREPARED BY (SHIFT SUPERVISOR)</div>
        <div style="font-size: 8.5pt; color: #64748b;">Signature &amp; Verification</div>
      </td>
      <td style="width: 33%; text-align: center; padding: 25px 15px 15px; border: 1px solid #cbd5e1; background-color: #ffffff;">
        <div style="font-style: italic; color: #94a3b8; padding-bottom: 30px;">(Internal Audit Stamp)</div>
        <div style="border-top: 1px solid #94a3b8; padding-top: 6px; font-weight: bold; font-size: 9.5pt;">VERIFIED BY (INTERNAL AUDITOR)</div>
        <div style="font-size: 8.5pt; color: #64748b;">Stock &amp; Meter Verification</div>
      </td>
      <td style="width: 34%; text-align: center; padding: 25px 15px 15px; border: 1px solid #cbd5e1; background-color: #ffffff;">
        <div style="font-style: italic; color: #94a3b8; padding-bottom: 30px;">(Management Approval)</div>
        <div style="border-top: 1px solid #94a3b8; padding-top: 6px; font-weight: bold; font-size: 9.5pt;">APPROVED BY (STATION DEALER)</div>
        <div style="font-size: 8.5pt; color: #64748b;">Final Accounting Authorization</div>
      </td>
    </tr>
  </table>

</body>
</html>
    `;

    // Create Blob and trigger download as HTML-Structured Excel File (.xls)
    const blob = new Blob([htmlContent], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeShiftId = currentShift.id.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeDate = shiftDate.replace(/[^a-zA-Z0-9_-]/g, '_');
    link.setAttribute('href', url);
    link.setAttribute('download', `Daily_Shift_Summary_${safeShiftId}_${safeDate}.xls`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Backwards compatibility alias
  const handleExportCSV = handleExportExcel;

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
    <div className="font-sans pb-16">
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
      {/* THE PRINTABLE AUDIT SHEET CONTAINER */}
      {/* ========================================================================= */}
      <div className="printable-sheet-container bg-white p-6 sm:p-8 rounded-2xl border border-gray-200/90 shadow-xs space-y-6 text-slate-900">
        
        {/* REPORT HEADER */}
        <div className="border-b-2 border-slate-900 pb-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {onBack && (
              <button
                onClick={onBack}
                className="no-print p-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition-all border border-slate-200 shadow-2xs cursor-pointer shrink-0"
                title="Return to Shift Ledger"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <div>
              <h2 className="text-xl sm:text-2xl font-black text-slate-950 tracking-tight">
                DAILY SHIFT &amp; FUEL RECONCILIATION REPORT
              </h2>
              <p className="text-xs text-slate-600 font-medium mt-0.5">
                Station Licensee Record • Meter Sales, Underground Tank Dips &amp; Decanting Summary
              </p>
            </div>
          </div>

          <div className="flex flex-wrap sm:flex-nowrap items-center gap-3">
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs space-y-1 min-w-[240px] flex-1 sm:flex-initial">
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

            <div className="no-print flex items-center shrink-0">
              <button
                onClick={handleExportExcel}
                className="inline-flex items-center gap-2 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs hover:shadow-sm cursor-pointer active:scale-95 shrink-0"
                title="Download Comprehensive Shift Summary as Structured Excel (.xls)"
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>Export Excel (.xls)</span>
              </button>
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
            <div className="flex items-center gap-3 text-[11px] font-bold text-slate-500">
              <span>
                Active Nozzles: <strong className="text-slate-900">{pumpSalesAnalysis.rows.length}</strong>
                {pumpSalesAnalysis.totalPumpsCount > pumpSalesAnalysis.rows.length && (
                  <span className="text-[10px] text-slate-400 font-normal"> (of {pumpSalesAnalysis.totalPumpsCount})</span>
                )}
              </span>
              <span>•</span>
              <span>
                Total Net Fuel Volume: <strong className="text-indigo-700">{formatLiters(pumpSalesAnalysis.grandTotal.net)}</strong>
              </span>
            </div>
          </div>

          <div className="overflow-x-auto border border-slate-300 rounded-xl">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-100 text-slate-700 font-bold text-[10px] uppercase border-b border-slate-300">
                <tr>
                  <th className="p-2 border-r border-slate-200">Pump / Nozzle</th>
                  <th className="p-2 border-r border-slate-200">Product</th>
                  <th className="p-2 border-r border-slate-200">Assigned Pumper</th>
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
                {pumpSalesAnalysis.productGroups.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="p-6 text-center text-slate-500 font-medium">
                      No active pump machines or dispenser readings recorded for this shift.
                    </td>
                  </tr>
                ) : (
                  pumpSalesAnalysis.productGroups.map((group) => (
                    <React.Fragment key={group.productCode}>
                      {/* Group Header Row */}
                      <tr className="bg-slate-100/95 border-t-2 border-b border-slate-300 font-sans">
                        <td colSpan={10} className="py-2 px-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className={`px-2 py-0.5 rounded font-black text-xs border uppercase tracking-wider ${group.productTagClass}`}>
                                {group.productCode}
                              </span>
                              <span className="font-extrabold text-slate-900 text-xs">
                                {group.productLabel}
                              </span>
                              <span className="text-[10px] text-slate-500 font-semibold">
                                ({group.rows.length} Active Nozzle{group.rows.length === 1 ? '' : 's'})
                              </span>
                            </div>

                            {/* Assigned Pumpers for this Fuel Type */}
                            <div className="flex items-center gap-1.5 text-xs">
                              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">
                                Assigned Pumper{group.assignedPumpers.length > 1 ? 's' : ''}:
                              </span>
                              {group.assignedPumpers.length > 0 ? (
                                <div className="flex items-center gap-1 flex-wrap">
                                  {group.assignedPumpers.map((pName, pIdx) => (
                                    <span
                                      key={pIdx}
                                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white border border-slate-300 text-slate-900 font-bold text-[11px] shadow-2xs"
                                    >
                                      <User className="w-3 h-3 text-indigo-600 shrink-0" />
                                      <span>{pName}</span>
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-slate-400 font-medium italic text-[11px]">None Assigned</span>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>

                      {/* Nozzle Rows for this Fuel Product */}
                      {group.rows.map((row) => (
                        <tr key={row.key} className="hover:bg-slate-50 transition-colors">
                          <td className="p-2 font-bold border-r border-slate-200">
                            <div className="flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />
                              <span>{row.pumpName}</span>
                            </div>
                          </td>
                          <td className="p-2 border-r border-slate-200 font-semibold text-slate-800">
                            <span className="font-bold text-slate-900">{row.productCode}</span>
                          </td>
                          <td className="p-2 border-r border-slate-200">
                            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-bold ${
                              row.isAssigned
                                ? 'bg-indigo-50 text-indigo-900 border border-indigo-200'
                                : 'text-slate-400 italic'
                            }`}>
                              <User className="w-2.5 h-2.5 text-indigo-600 shrink-0" />
                              <span>{row.pumperName}</span>
                            </span>
                          </td>
                          <td className="p-2 text-right font-mono border-r border-slate-200">{formatLiters(row.startMeter)}</td>
                          <td className="p-2 text-right font-mono border-r border-slate-200">{formatLiters(row.endMeter)}</td>
                          <td className="p-2 text-right font-mono border-r border-slate-200">{formatLiters(row.grossVolume)}</td>
                          <td className="p-2 text-right font-mono text-rose-600 border-r border-slate-200">
                            {row.testVolume > 0 ? `-${formatLiters(row.testVolume)}` : '0.00'}
                          </td>
                          <td className="p-2 text-right font-mono font-bold text-indigo-950 bg-indigo-50/30 border-r border-slate-200">
                            {formatLiters(row.netVolume)}
                          </td>
                          <td className="p-2 text-right font-mono border-r border-slate-200">{formatRs(row.unitPrice)}</td>
                          <td className="p-2 text-right font-mono font-bold text-slate-900">{formatRs(row.totalAmount)}</td>
                        </tr>
                      ))}

                      {/* Product Group Subtotal */}
                      <tr className="bg-slate-50 font-bold border-b border-slate-300 text-[11px]">
                        <td colSpan={3} className="p-2 text-right text-slate-600 border-r border-slate-200">
                          Subtotal {group.productCode} ({group.rows.length} Nozzle{group.rows.length === 1 ? '' : 's'}):
                        </td>
                        <td colSpan={2} className="p-2 text-center text-slate-400 border-r border-slate-200">--</td>
                        <td className="p-2 text-right font-mono border-r border-slate-200 text-slate-700">{formatLiters(group.subtotalGross)}</td>
                        <td className="p-2 text-right font-mono text-rose-600 border-r border-slate-200">
                          {group.subtotalTest > 0 ? `-${formatLiters(group.subtotalTest)}` : '0.00'}
                        </td>
                        <td className="p-2 text-right font-mono font-black text-indigo-900 bg-indigo-100/50 border-r border-slate-200">
                          {formatLiters(group.subtotalNet)}
                        </td>
                        <td className="p-2 text-right font-mono border-r border-slate-200">--</td>
                        <td className="p-2 text-right font-mono font-black text-slate-900">
                          Rs. {formatRs(group.subtotalAmount)}
                        </td>
                      </tr>
                    </React.Fragment>
                  ))
                )}
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

          {/* Product-wise Subtotal Pills with Assigned Pumpers */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 pt-1">
            {pumpSalesAnalysis.productGroups.map((group) => (
              <div key={group.productCode} className="p-2.5 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className={`px-1.5 py-0.2 rounded font-black text-[10px] border uppercase ${group.productTagClass}`}>
                      {group.productCode}
                    </span>
                    <span className="font-extrabold text-slate-900">{group.productCode} Subtotal</span>
                  </div>
                  <span className="font-mono font-bold text-indigo-700">{formatLiters(group.subtotalNet)}</span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <span className="truncate max-w-[140px] text-slate-600" title={group.assignedPumpers.join(', ')}>
                    Pumper{group.assignedPumpers.length > 1 ? 's' : ''}: <strong className="text-slate-900">{group.assignedPumpers.join(', ') || 'Unassigned'}</strong>
                  </span>
                  <span className="font-mono font-semibold text-slate-900">Rs. {formatRs(group.subtotalAmount)}</span>
                </div>
              </div>
            ))}
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
        <div className="space-y-4 pt-2">
          {/* SECTION 4A: GROSS STATION REVENUE BREAKDOWN */}
          <div className="border border-slate-300 rounded-xl p-4 sm:p-5 bg-slate-50/50 space-y-4 text-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-2 border-b border-slate-200 gap-2">
              <h4 className="font-extrabold uppercase tracking-wider text-slate-900 flex items-center gap-2 text-xs">
                <DollarSign className="w-4 h-4 text-emerald-600" />
                <span>4A. Gross Station Revenue Breakdown (Fuel, Lubricants &amp; LP Gas)</span>
              </h4>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-slate-500 uppercase">Gross Shift Turnover:</span>
                <span className="font-mono text-sm font-black text-indigo-950 bg-indigo-50 border border-indigo-200 px-2.5 py-0.5 rounded-lg">
                  Rs. {formatRs(financialSettlement.grossTotal)}
                </span>
              </div>
            </div>

            {/* Top 4 KPI Summary Cards for Revenue */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
              <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-2xs">
                <div className="flex items-center gap-1.5 text-slate-500 font-bold text-[10px] uppercase">
                  <Fuel className="w-3.5 h-3.5 text-blue-600" />
                  <span>Net Fuel Revenue</span>
                </div>
                <div className="font-mono font-bold text-slate-900 text-xs sm:text-sm mt-1">
                  Rs. {formatRs(financialSettlement.grossFuel)}
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">
                  Vol: {formatLiters(pumpSalesAnalysis.grandTotal.net)}
                </div>
              </div>

              <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-2xs">
                <div className="flex items-center gap-1.5 text-slate-500 font-bold text-[10px] uppercase">
                  <Package className="w-3.5 h-3.5 text-amber-600" />
                  <span>Oil &amp; Lubricants</span>
                </div>
                <div className="font-mono font-bold text-slate-900 text-xs sm:text-sm mt-1">
                  Rs. {formatRs(financialSettlement.lubricants)}
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">
                  {nonFuelSalesAnalysis.totalLubeQty} item(s) / L sold
                </div>
              </div>

              <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-2xs">
                <div className="flex items-center gap-1.5 text-slate-500 font-bold text-[10px] uppercase">
                  <Flame className="w-3.5 h-3.5 text-rose-600" />
                  <span>LP Gas Cylinders</span>
                </div>
                <div className="font-mono font-bold text-slate-900 text-xs sm:text-sm mt-1">
                  Rs. {formatRs(financialSettlement.gasSales)}
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">
                  {nonFuelSalesAnalysis.totalGasQty} cylinder(s) sold
                </div>
              </div>

              <div className="p-3 bg-indigo-50/70 rounded-xl border border-indigo-200 shadow-2xs">
                <div className="flex items-center gap-1.5 text-indigo-800 font-black text-[10px] uppercase">
                  <CheckCircle2 className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Total Gross Turnover</span>
                </div>
                <div className="font-mono font-black text-indigo-950 text-xs sm:text-sm mt-1">
                  Rs. {formatRs(financialSettlement.grossTotal)}
                </div>
                <div className="text-[10px] text-indigo-600 font-semibold mt-0.5">
                  All streams reconciled
                </div>
              </div>
            </div>

            {/* Detailed Table Block 1: Forecourt Packaged Lubricants & Oil Sales */}
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between">
                <h5 className="font-bold text-[11px] uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                  <Droplet className="w-3.5 h-3.5 text-amber-600" />
                  <span>Forecourt Packaged Lubricants &amp; Oil Sales Breakdown</span>
                </h5>
                <span className="text-[10px] font-mono font-bold text-slate-600">
                  Subtotal: Rs. {formatRs(financialSettlement.lubricants)}
                </span>
              </div>

              <div className="overflow-x-auto border border-slate-300 rounded-xl">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-100 text-slate-700 font-bold text-[10px] uppercase border-b border-slate-300">
                    <tr>
                      <th className="p-2 border-r border-slate-200">Item Description &amp; Brand</th>
                      <th className="p-2 border-r border-slate-200">Category / Pack Size</th>
                      <th className="p-2 text-right border-r border-slate-200">Qty Sold</th>
                      <th className="p-2 text-right border-r border-slate-200">Unit Price (Rs.)</th>
                      <th className="p-2 text-right">Total Amount (Rs.)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-[11px] font-medium text-slate-800">
                    {nonFuelSalesAnalysis.lubeItems.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="p-3 text-center text-slate-400 italic">
                          No packaged lubricant or forecourt oil sales recorded for this shift (Rs. 0.00)
                        </td>
                      </tr>
                    ) : (
                      nonFuelSalesAnalysis.lubeItems.map((item) => (
                        <tr key={item.id} className="hover:bg-slate-50">
                          <td className="p-2 border-r border-slate-200 font-semibold text-slate-900">
                            {item.name}
                          </td>
                          <td className="p-2 border-r border-slate-200">
                            <span className="px-1.5 py-0.5 bg-amber-50 text-amber-900 border border-amber-200 rounded text-[10px] font-semibold">
                              {item.packSize}
                            </span>
                          </td>
                          <td className="p-2 text-right font-mono font-bold text-slate-900 border-r border-slate-200">
                            {item.quantity > 0 ? (
                              item.category === 'Bulk Oil Dispenser' ? `${item.quantity.toFixed(2)} L` : `${item.quantity} ${item.quantity === 1 ? 'unit' : 'units'}`
                            ) : (
                              <span className="text-slate-400">0</span>
                            )}
                          </td>
                          <td className="p-2 text-right font-mono border-r border-slate-200">
                            {formatRs(item.unitPrice)}
                          </td>
                          <td className="p-2 text-right font-mono font-bold text-slate-900">
                            {formatRs(item.totalAmount)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  {nonFuelSalesAnalysis.lubeItems.length > 0 && (
                    <tfoot className="bg-slate-100 font-bold text-[11px] text-slate-900 border-t-2 border-slate-300">
                      <tr>
                        <td colSpan={2} className="p-2 text-right uppercase tracking-wider text-[10px] text-slate-600">
                          Subtotal - Forecourt Packaged Lubricants &amp; Oil:
                        </td>
                        <td className="p-2 text-right font-mono">
                          {nonFuelSalesAnalysis.totalLubeQty}
                        </td>
                        <td className="p-2 text-right border-r border-slate-200 text-slate-400 font-mono text-[10px]">
                          -
                        </td>
                        <td className="p-2 text-right font-mono font-black text-amber-900">
                          Rs. {formatRs(financialSettlement.lubricants)}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>

            {/* Detailed Table Block 2: LP Gas Cylinder Sales (Refills / New Sets) */}
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between">
                <h5 className="font-bold text-[11px] uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                  <Flame className="w-3.5 h-3.5 text-rose-600" />
                  <span>LP Gas Cylinder Sales Breakdown (Refills / New Sets)</span>
                </h5>
                <span className="text-[10px] font-mono font-bold text-slate-600">
                  Subtotal: Rs. {formatRs(financialSettlement.gasSales)}
                </span>
              </div>

              <div className="overflow-x-auto border border-slate-300 rounded-xl">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-100 text-slate-700 font-bold text-[10px] uppercase border-b border-slate-300">
                    <tr>
                      <th className="p-2 border-r border-slate-200">Cylinder Specification &amp; Size</th>
                      <th className="p-2 border-r border-slate-200">Category / Refill Type</th>
                      <th className="p-2 text-right border-r border-slate-200">Qty Sold (Cylinders)</th>
                      <th className="p-2 text-right border-r border-slate-200">Unit Price (Rs.)</th>
                      <th className="p-2 text-right">Total Amount (Rs.)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-[11px] font-medium text-slate-800">
                    {nonFuelSalesAnalysis.gasItems.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="p-3 text-center text-slate-400 italic">
                          No LP Gas cylinder sales recorded for this shift (Rs. 0.00)
                        </td>
                      </tr>
                    ) : (
                      nonFuelSalesAnalysis.gasItems.map((item) => (
                        <tr key={item.id} className="hover:bg-slate-50">
                          <td className="p-2 border-r border-slate-200 font-semibold text-slate-900">
                            {item.name}
                          </td>
                          <td className="p-2 border-r border-slate-200">
                            <span className="px-1.5 py-0.5 bg-rose-50 text-rose-900 border border-rose-200 rounded text-[10px] font-semibold">
                              {item.size} Cylinder / Refill
                            </span>
                          </td>
                          <td className="p-2 text-right font-mono font-bold text-slate-900 border-r border-slate-200">
                            {item.quantity > 0 ? `${item.quantity}` : <span className="text-slate-400">0</span>}
                          </td>
                          <td className="p-2 text-right font-mono border-r border-slate-200">
                            {formatRs(item.unitPrice)}
                          </td>
                          <td className="p-2 text-right font-mono font-bold text-slate-900">
                            {formatRs(item.totalAmount)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  {nonFuelSalesAnalysis.gasItems.length > 0 && (
                    <tfoot className="bg-slate-100 font-bold text-[11px] text-slate-900 border-t-2 border-slate-300">
                      <tr>
                        <td colSpan={2} className="p-2 text-right uppercase tracking-wider text-[10px] text-slate-600">
                          Subtotal - LP Gas Cylinder Sales:
                        </td>
                        <td className="p-2 text-right font-mono">
                          {nonFuelSalesAnalysis.totalGasQty}
                        </td>
                        <td className="p-2 text-right border-r border-slate-200 text-slate-400 font-mono text-[10px]">
                          -
                        </td>
                        <td className="p-2 text-right font-mono font-black text-rose-900">
                          Rs. {formatRs(financialSettlement.gasSales)}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>

            {/* Reconciled Gross Turnover Summary Banner */}
            <div className="flex flex-col sm:flex-row items-center justify-between p-3.5 bg-indigo-50 border-2 border-indigo-200 rounded-xl text-xs font-bold text-indigo-950">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-indigo-600 shrink-0" />
                <span>Total Gross Shift Turnover (Fuel + Forecourt Oil/Lubricants + LP Gas):</span>
              </div>
              <div className="font-mono text-base font-black text-indigo-950 mt-1 sm:mt-0">
                Rs. {formatRs(financialSettlement.grossTotal)}
              </div>
            </div>
          </div>

          {/* SECTION 4B: SETTLEMENT & NET CASH RECONCILIATION */}
          <div className="border border-slate-300 rounded-xl p-4 sm:p-5 bg-slate-50/50 space-y-3 text-xs">
            <h4 className="font-extrabold uppercase tracking-wider text-slate-900 border-b border-slate-200 pb-2 flex items-center gap-1.5">
              <Scale className="w-4 h-4 text-indigo-600" />
              <span>4B. Settlement &amp; Net Cash Reconciliation</span>
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Left Column: Non-Cash Deductions Breakdown */}
              <div className="space-y-1.5 bg-white p-3.5 rounded-xl border border-slate-200">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 pb-1 border-b border-slate-100">
                  Non-Cash Revenue Deductions
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-600">Corporate Credit Sales:</span>
                  <span className="font-mono text-slate-800">Rs. {formatRs(financialSettlement.creditSales)}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-600">Card POS / Digital Swipes:</span>
                  <span className="font-mono text-slate-800">Rs. {formatRs(financialSettlement.cardSales)}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-600">Touch Card / Fleet Vouchers:</span>
                  <span className="font-mono text-slate-800">Rs. {formatRs(financialSettlement.touchCardSales + financialSettlement.voucherSales)}</span>
                </div>
                <div className="flex justify-between pt-2 border-t border-slate-200 font-bold text-slate-900">
                  <span>Total Non-Cash Deductions:</span>
                  <span className="font-mono text-slate-900">Rs. {formatRs(financialSettlement.totalNonCash)}</span>
                </div>
              </div>

              {/* Right Column: Physical Cash Handover & Net Variance */}
              <div className="space-y-1.5 bg-white p-3.5 rounded-xl border border-slate-200">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 pb-1 border-b border-slate-100">
                  Cash Reconciliation &amp; Shift Variance
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100 font-semibold text-slate-900">
                  <span>Net Expected Physical Cash:</span>
                  <span className="font-mono text-indigo-900">Rs. {formatRs(financialSettlement.expectedCash)}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100 font-semibold text-slate-900">
                  <span>Physical Cash Handover / Banked:</span>
                  <span className="font-mono text-slate-900">
                    Rs. {formatRs(financialSettlement.actualCashHanded > 0 ? financialSettlement.actualCashHanded : financialSettlement.cashBanked)}
                  </span>
                </div>
                <div className={`flex justify-between pt-2 border-t border-slate-200 text-sm font-black ${
                  financialSettlement.varianceStatus === 'Shortage' ? 'text-rose-700' : financialSettlement.varianceStatus === 'Excess' ? 'text-emerald-700' : 'text-slate-900'
                }`}>
                  <span>Net Cash Variance:</span>
                  <span className="font-mono">
                    {financialSettlement.variance >= 0 ? '+' : ''}Rs. {formatRs(financialSettlement.variance)} ({financialSettlement.varianceStatus})
                  </span>
                </div>
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
