/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useRef } from 'react';
import { 
  Search, Plus, Clock, Fuel, ArrowUpRight, DollarSign, 
  User, CheckCircle, AlertCircle, Sparkles, X, Download, RotateCcw,
  ShieldCheck, Check, Save, AlertTriangle, TrendingUp, RefreshCw,
  Lock, Unlock, Edit2, ArrowLeft, Users, Package, ChevronDown, CheckSquare, Square, Calendar, Droplet,
  ArrowRightLeft
} from 'lucide-react';
import { supabase, saveCreditSale, saveCardSale, syncCreditAndCardSales, upsertPumpReadings } from '../lib/supabaseClient';
import { Employee, FuelTank, OilTank, Pump, PumpMachine, PumpReading, Shift, FuelType, ChamberReading } from '../types';

interface ShiftManagementTabProps {
  employees: Employee[];
  tanks: FuelTank[];
  setTanks?: React.Dispatch<React.SetStateAction<FuelTank[]>>;
  oilTanks?: OilTank[];
  setOilTanks?: React.Dispatch<React.SetStateAction<OilTank[]>>;
  pumps?: Pump[];
  setPumps?: React.Dispatch<React.SetStateAction<Pump[]>>;
  pumpMachines?: PumpMachine[];
  activeShift: Shift | null;
  setActiveShift: React.Dispatch<React.SetStateAction<Shift | null>>;
  shiftHistory?: Shift[];
  onCloseShift: (closingShift: Shift) => void;
  onStartShift: (newShift: Omit<Shift, 'totalFuelSold' | 'totalNetSold' | 'totalNetSales'>) => void;
}

// Calculate sold liters supporting positive meter progression (closing > opening)
// and stock depletion mode (closing < opening when closing > 0)
export const calculateChamberSoldLiters = (opening: number, closing: number): number => {
  if (closing === undefined || closing === null || closing <= 0 || closing === opening) {
    return 0;
  }
  if (closing > opening) {
    // Meter progression mode (e.g. Opening: 50, Closing: 60 -> Sold: 10 L)
    return Number((closing - opening).toFixed(2));
  }
  // Stock depletion mode (e.g. Opening: 60 L, Closing: 50 L -> Sold: 10 L)
  return Number((opening - closing).toFixed(2));
};

export default function ShiftManagementTab({
  employees,
  tanks,
  setTanks,
  oilTanks = [],
  setOilTanks,
  pumps = [],
  setPumps,
  pumpMachines = [],
  activeShift,
  setActiveShift,
  shiftHistory,
  onCloseShift,
  onStartShift,
}: ShiftManagementTabProps) {
  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPastShift, setSelectedPastShift] = useState<Shift | null>(null);
  
  // Modals state
  const [isCloseConfirmOpen, setIsCloseConfirmOpen] = useState(false);
  const [isStartShiftOpen, setIsStartShiftOpen] = useState(false);
  
  // New Shift Setup Form State
  const [newShiftTemplate, setNewShiftTemplate] = useState<'Morning' | 'Evening' | 'Night' | 'Custom'>('Morning');
  const [shiftNameInput, setShiftNameInput] = useState('Morning Shift');
  const [startTimeInput, setStartTimeInput] = useState('06:00');
  const [endTimeInput, setEndTimeInput] = useState('14:00');
  const [newSupervisorId, setNewSupervisorId] = useState('');

  // Draft States for Active/Ongoing Shift (Phase 1 & 2)
  const [draftReadings, setDraftReadings] = useState<PumpReading[]>([]);
  const [draftSupervisorId, setDraftSupervisorId] = useState('');
  const [draftShiftName, setDraftShiftName] = useState('');
  const [draftStartTime, setDraftStartTime] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Pumper-Centric Architecture State
  const [selectedActivePumperIds, setSelectedActivePumperIds] = useState<string[]>([]);
  const [openPumpSelectorPumperId, setOpenPumpSelectorPumperId] = useState<string | null>(null);
  const [isAddPumperModalOpen, setIsAddPumperModalOpen] = useState(false);
  const [savedPumperIds, setSavedPumperIds] = useState<{ [key: string]: boolean }>({});
  const [savedPumperCards, setSavedPumperCards] = useState<{ [key: string]: boolean }>({});
  const [lockedStartMeters, setLockedStartMeters] = useState<Record<string, boolean>>({});
  const [lockedEndMeters, setLockedEndMeters] = useState<Record<string, boolean>>({});
  const [finalizedPumperCards, setFinalizedPumperCards] = useState<Record<string, boolean>>({});

  // Helper to retrieve locks from localStorage
  const getStoredLocks = (shiftId: string) => {
    try {
      const storedLocksStr = localStorage.getItem(`fuelflow_shift_locks_${shiftId}`);
      if (storedLocksStr) {
        return JSON.parse(storedLocksStr);
      }
    } catch (e) {
      console.warn('Could not read locks from localStorage', e);
    }
    return null;
  };

  // Helper to persist lock states to localStorage
  const saveLocksToStorage = (
    shiftId: string,
    starts: Record<string, boolean>,
    ends: Record<string, boolean>,
    finalized: Record<string, boolean>
  ) => {
    try {
      localStorage.setItem(`fuelflow_shift_locks_${shiftId}`, JSON.stringify({
        lockedStartMeters: starts,
        lockedEndMeters: ends,
        finalizedPumperCards: finalized
      }));
    } catch (err) {
      console.warn('Failed to save locks to localStorage', err);
    }
  };

  // Debounce timer store for remote database syncing
  const debounceTimersRef = useRef<{ [key: string]: NodeJS.Timeout }>({});

  // Mid-Shift Handover & Cash Collection state
  const [initialPumperCash, setInitialPumperCash] = useState<number | ''>(0);
  const [replacementPumperCash, setReplacementPumperCash] = useState<number | ''>(0);
  const [replacementPumperId, setReplacementPumperId] = useState<string>('');
  const [handoverNotes, setHandoverNotes] = useState<string>('');

  // Pump Transfer / Handover Modal State
  const [handoverPumpModal, setHandoverPumpModal] = useState<PumpReading | null>(null);
  const [modalHandoverMeter, setModalHandoverMeter] = useState<number | ''>(0);
  const [modalReplacementPumperId, setModalReplacementPumperId] = useState<string>('');
  const [modalOutgoingCash, setModalOutgoingCash] = useState<number | ''>(0);
  const [modalHandoverNotes, setModalHandoverNotes] = useState<string>('');

  // Handover Modal handlers
  const handleOpenHandoverModal = (reading: PumpReading) => {
    setHandoverPumpModal(reading);
    const fuelPrice = getPriceForFuelType(reading.fuelType);
    const currentEnd = reading.endMeter > reading.startMeter ? reading.endMeter : reading.startMeter;
    setModalHandoverMeter(currentEnd);
    
    const handoverLiters = Math.max(0, currentEnd - reading.startMeter);
    const netLiters = Math.max(0, handoverLiters - reading.testingQty);
    const defaultCash = netLiters * fuelPrice;
    setModalOutgoingCash(defaultCash);
    
    // Find other active pumpers in current shift
    const activeIds = new Set<string>();
    draftReadings.forEach(r => {
      if (r.assignedPumperId) activeIds.add(r.assignedPumperId);
    });
    selectedActivePumperIds.forEach(id => activeIds.add(id));
    const activeReceivers = employees.filter(e => activeIds.has(e.id) && e.id !== reading.assignedPumperId);

    if (reading.replacementPumperId) {
      setModalReplacementPumperId(reading.replacementPumperId);
    } else if (activeReceivers.length > 0) {
      setModalReplacementPumperId(activeReceivers[0].id);
    } else {
      setModalReplacementPumperId('');
    }
    setModalHandoverNotes(reading.handoverNotes || '');
  };

  const handleConfirmHandover = async () => {
    if (!handoverPumpModal || !activeShift) return;

    const hMeter = Number(modalHandoverMeter) || 0;
    if (hMeter < handoverPumpModal.startMeter) {
      setToastMessage(`Validation Error: Handover meter (${hMeter} L) cannot be less than Start meter (${handoverPumpModal.startMeter} L).`);
      setTimeout(() => setToastMessage(null), 4000);
      return;
    }

    if (!modalReplacementPumperId) {
      setToastMessage(`Validation Error: Please select a replacement pumper.`);
      setTimeout(() => setToastMessage(null), 4000);
      return;
    }

    const outgoingCash = Number(modalOutgoingCash) || 0;
    const outgoingPumpId = handoverPumpModal.pumpId;
    const outgoingPumperId = handoverPumpModal.assignedPumperId;

    // 1. Update outgoing pumper's reading for this pump: set endMeter = hMeter, lock their portion
    const updatedReadings = draftReadings.map(dr => {
      const isTarget = handoverPumpModal.id 
        ? dr.id === handoverPumpModal.id 
        : (dr.pumpId === outgoingPumpId && dr.assignedPumperId === outgoingPumperId);

      if (isTarget) {
        return {
          ...dr,
          endMeter: hMeter,
          replacementPumperId: modalReplacementPumperId,
          handoverMeter: hMeter,
          initialPumperCash: outgoingCash,
          handoverNotes: modalHandoverNotes,
          isCardFinalized: true,
          isLocked: true,
          status: 'Completed' as const
        };
      }
      return dr;
    });

    // 2. Append the transferred pump as a NEW separate pump entry under the receiving pumper's assignment list
    const sourcePumpReading = draftReadings.find(dr => (
      handoverPumpModal.id 
        ? dr.id === handoverPumpModal.id 
        : (dr.pumpId === outgoingPumpId && dr.assignedPumperId === outgoingPumperId)
    )) || handoverPumpModal;
    
    const newTransferredReading: PumpReading = {
      id: crypto.randomUUID ? crypto.randomUUID() : `transfer_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      pumpId: outgoingPumpId,
      pumpName: handoverPumpModal.pumpName,
      fuelType: handoverPumpModal.fuelType,
      tankId: sourcePumpReading.tankId || '',
      assignedPumperId: modalReplacementPumperId,
      startMeter: hMeter,
      endMeter: hMeter,
      testingQty: 0,
      status: 'Active' as const,
      isLocked: false,
      isStartSaved: true,
      isCardFinalized: false,
      unitPrice: sourcePumpReading.unitPrice || getPriceForFuelType(handoverPumpModal.fuelType),
      creditSalesAmount: 0,
      cardSalesAmount: 0,
      oilSalesAmount: 0,
      actualCash: 0
    };

    const finalReadings = [...updatedReadings, newTransferredReading];
    setDraftReadings(finalReadings);

    if (modalReplacementPumperId && !selectedActivePumperIds.includes(modalReplacementPumperId)) {
      setSelectedActivePumperIds(prev => Array.from(new Set([...prev, modalReplacementPumperId])));
    }

    let totalFuel = 0;
    let totalNet = 0;
    let totalSales = 0;
    finalReadings.forEach(dr => {
      const isOil = dr.pumpId === 'pump-oil-bay' || dr.fuelType === 'Oil & Lubricants' || dr.pumpName?.toLowerCase().includes('oil');
      const fuel = isOil ? 0 : Math.max(0, dr.endMeter - dr.startMeter);
      const net = isOil ? 0 : Math.max(0, fuel - dr.testingQty);
      totalFuel += fuel;
      totalNet += net;
      totalSales += (net * getPriceForFuelType(dr.fuelType)) + (dr.oilSalesAmount || 0);
    });

    setActiveShift({
      ...activeShift,
      pumpReadings: finalReadings,
      totalFuelSold: totalFuel,
      totalNetSold: totalNet,
      totalNetSales: totalSales,
      initialPumperCash: (activeShift.initialPumperCash || 0) + outgoingCash,
      replacementPumperId: modalReplacementPumperId
    });

    try {
      await upsertPumpReadings(supabase, finalReadings, activeShift.id);
    } catch (err) {
      console.warn('Error syncing handover readings to Supabase:', err);
    }

    const replacementPumperName = employees.find(e => e.id === modalReplacementPumperId)?.name || 'Replacement Pumper';
    setToastMessage(`Mid-shift transfer recorded for ${handoverPumpModal.pumpName}! Appended to ${replacementPumperName}.`);
    setTimeout(() => setToastMessage(null), 4000);

    setHandoverPumpModal(null);
  };
  
  // Track settled pumpers per active shift
  const [settledPumperIds, setSettledPumperIds] = useState<Record<string, boolean>>({});

// Default 4-chamber dispenser configuration helper
const getDefaultChambers = (oilTanksList?: OilTank[]): ChamberReading[] => {
  const chambers = (oilTanksList || []).filter(t => t.type === 'chamber' || t.name.toLowerCase().includes('chamber'));
  const defaultGrades = ['DS 40', 'DS 50', '2T', 'SP 4T'];
  const defaultRates = [1050, 1100, 950, 1200];

  if (chambers.length > 0) {
    // Sort chambers numerically by chamber number or natural name
    const sortedChambers = [...chambers].sort((a, b) => {
      const numA = a.chamberNumber || parseInt((a.name || '').replace(/\D/g, ''), 10) || 0;
      const numB = b.chamberNumber || parseInt((b.name || '').replace(/\D/g, ''), 10) || 0;
      return numA - numB;
    });

    return sortedChambers.map((ch, idx) => {
      const opLevel = ch.currentLevel !== undefined && ch.currentLevel > 0 ? ch.currentLevel : 60;
      return {
        chamberId: ch.id,
        chamberNumber: ch.chamberNumber || (idx + 1),
        grade: ch.grade || defaultGrades[idx % 4],
        openingLiters: opLevel,
        closingLiters: 0,
        openingLevel: opLevel,
        closingLevel: 0,
        soldLiters: 0,
        ratePerLiter: ch.pricePerLiter || defaultRates[idx % 4],
        totalAmount: 0
      };
    });
  }

  // Default 4 forecourt dispenser chambers (Ch 01 DS 40, Ch 02 DS 50, Ch 03 2T, Ch 04 SP 4T)
  const defaultForecourtChambers = [
    { id: 'ch-01', chamberNumber: 1, grade: 'DS 40', currentLevel: 60, pricePerLiter: 1050 },
    { id: 'ch-02', chamberNumber: 2, grade: 'DS 50', currentLevel: 60, pricePerLiter: 1100 },
    { id: 'ch-03', chamberNumber: 3, grade: '2T', currentLevel: 60, pricePerLiter: 950 },
    { id: 'ch-04', chamberNumber: 4, grade: 'SP 4T', currentLevel: 60, pricePerLiter: 1200 }
  ];

  return defaultForecourtChambers.map(ch => ({
    chamberId: ch.id,
    chamberNumber: ch.chamberNumber,
    grade: ch.grade,
    openingLiters: ch.currentLevel,
    closingLiters: 0,
    openingLevel: ch.currentLevel,
    closingLevel: 0,
    soldLiters: 0,
    ratePerLiter: ch.pricePerLiter,
    totalAmount: 0
  }));
};

  // Sync draft states when activeShift changes
  const lastSyncedShiftIdRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (activeShift) {
      if (lastSyncedShiftIdRef.current === activeShift.id) {
        return;
      }
      lastSyncedShiftIdRef.current = activeShift.id;
      const availablePumpsList = pumps || [];
      const availablePumps = availablePumpsList.some(p => p.id === 'pump-oil-bay')
        ? availablePumpsList
        : [...availablePumpsList, { id: 'pump-oil-bay', name: 'Forecourt Dispenser Station (4-Chamber Unit)', fuelType: 'Oil & Lubricants' as FuelType, tankId: '', status: 'Active' }];
      const currentReadings = activeShift.pumpReadings || [];
      const readingMap = new Map(currentReadings.map(r => [r.pumpId, r]));

      // Initialize stepwise locked meters & finalized pumper cards from active shift readings + localStorage
      const initialLockedStarts: Record<string, boolean> = {};
      const initialLockedEnds: Record<string, boolean> = {};
      const initialFinalized: Record<string, boolean> = {};

      const storedLocks = getStoredLocks(activeShift.id);
      if (storedLocks) {
        if (storedLocks.lockedStartMeters) Object.assign(initialLockedStarts, storedLocks.lockedStartMeters);
        if (storedLocks.lockedEndMeters) Object.assign(initialLockedEnds, storedLocks.lockedEndMeters);
        if (storedLocks.finalizedPumperCards) Object.assign(initialFinalized, storedLocks.finalizedPumperCards);
      }

      currentReadings.forEach(r => {
        if (r.isStartSaved || initialLockedStarts[r.pumpId] || (r.isLocked && r.startMeter !== undefined && r.startMeter >= 0)) {
          initialLockedStarts[r.pumpId] = true;
        }
        if (r.isCardFinalized || initialLockedEnds[r.pumpId] || (r.isLocked && r.endMeter !== undefined && r.endMeter > 0 && r.endMeter >= r.startMeter)) {
          initialLockedEnds[r.pumpId] = true;
        }
        if (r.assignedPumperId && (r.isCardFinalized || initialFinalized[r.assignedPumperId] || (r.isLocked && r.status === 'Completed'))) {
          initialFinalized[r.assignedPumperId] = true;
        }
      });

      const ensuredReadings: PumpReading[] = availablePumps.map(p => {
        const isOil = p.id === 'pump-oil-bay' || p.fuelType === 'Oil & Lubricants' || p.name.toLowerCase().includes('oil') || p.name.toLowerCase().includes('dispenser');
        
        if (readingMap.has(p.id)) {
          const existing = readingMap.get(p.id)!;
          const isStartSaved = !!(existing.isStartSaved || initialLockedStarts[p.id] || (existing.isLocked && existing.startMeter !== undefined && existing.startMeter >= 0));
          const isCardFinalized = !!(existing.isCardFinalized || (existing.assignedPumperId && initialFinalized[existing.assignedPumperId]) || (existing.isLocked && existing.status === 'Completed'));
          if (isOil) {
            let chReadings = existing.chamberReadings;
            if (!chReadings || chReadings.length === 0) {
              chReadings = getDefaultChambers(oilTanks);
            } else if (!isCardFinalized && existing.status !== 'Completed') {
              // Ensure closing stock defaults to 0 instead of defaulting to opening stock (60)
              chReadings = chReadings.map(ch => {
                const op = ch.openingLevel ?? ch.openingLiters ?? 0;
                const cl = ch.closingLevel ?? ch.closingLiters ?? 0;
                // If closing was defaulted to opening (old 60 default) with no sales, reset closing to 0
                const effectiveCl = (cl === op && (!ch.soldLiters || ch.soldLiters === 0)) ? 0 : cl;
                const sold = calculateChamberSoldLiters(op, effectiveCl);
                return {
                  ...ch,
                  openingLevel: op,
                  openingLiters: op,
                  closingLevel: effectiveCl,
                  closingLiters: effectiveCl,
                  soldLiters: sold,
                  totalAmount: sold * (ch.ratePerLiter || 0)
                };
              });
            }
            const forecourtOilTotal = (chReadings || []).reduce((sum, ch) => sum + (ch.totalAmount || 0), 0);
            return {
              ...existing,
              isStartSaved,
              isCardFinalized,
              isLocked: isCardFinalized || !!existing.isLocked,
              pumpName: 'Forecourt Dispenser Station (4-Chamber Unit)',
              chamberReadings: chReadings,
              oilSalesAmount: forecourtOilTotal
            };
          }
          return {
            ...existing,
            isStartSaved,
            isCardFinalized,
            isLocked: isCardFinalized || !!existing.isLocked
          };
        }

        const carryForward = getPreviousEndMeterForPump(p.id);
        const pStartMeter = (p as Pump).startMeter;
        const initialMeter = pStartMeter !== undefined && pStartMeter > 0 ? Math.max(carryForward, pStartMeter) : carryForward;
        const tank = tanks.find(t => t.id === p.tankId || t.fuelType === p.fuelType);
        return {
          pumpId: p.id,
          pumpName: isOil ? 'Forecourt Dispenser Station (4-Chamber Unit)' : p.name,
          fuelType: p.fuelType,
          tankId: p.tankId || tank?.id || '',
          assignedPumperId: null,
          startMeter: initialMeter,
          endMeter: 0,
          testingQty: 0,
          status: 'Idle',
          isLocked: false,
          isStartSaved: !!initialLockedStarts[p.id],
          isCardFinalized: false,
          unitPrice: tank ? tank.pricePerLiter : 355,
          chamberReadings: isOil ? getDefaultChambers(oilTanks) : undefined
        };
      });

      setDraftReadings(ensuredReadings);
      setDraftSupervisorId(activeShift.supervisorId);
      setDraftShiftName(activeShift.name);
      setDraftStartTime(activeShift.startTime);
      setInitialPumperCash(activeShift.initialPumperCash !== undefined ? activeShift.initialPumperCash : 0);
      setReplacementPumperCash(activeShift.replacementPumperCash !== undefined ? activeShift.replacementPumperCash : 0);
      setReplacementPumperId(activeShift.replacementPumperId || '');
      setHandoverNotes(activeShift.handoverNotes || '');
      
      const stored = localStorage.getItem(`fuelflow_settled_pumpers_${activeShift.id}`);
      setSettledPumperIds(stored ? JSON.parse(stored) : {});

      setLockedStartMeters(initialLockedStarts);
      setLockedEndMeters(initialLockedEnds);
      setFinalizedPumperCards(initialFinalized);
    } else {
      lastSyncedShiftIdRef.current = null;
      setDraftReadings([]);
      setDraftSupervisorId('');
      setDraftShiftName('');
      setDraftStartTime('');
      setInitialPumperCash(0);
      setReplacementPumperCash(0);
      setReplacementPumperId('');
      setHandoverNotes('');
      setSettledPumperIds({});
      setLockedStartMeters({});
      setLockedEndMeters({});
      setFinalizedPumperCards({});
    }
  }, [activeShift?.id, pumps, tanks, oilTanks]);

  // Fetch latest recorded end meters for pumps from Supabase for automatic start meter carryover
  const [supabaseLatestMeters, setSupabaseLatestMeters] = React.useState<Record<string, number>>({});
  
  // Closed shifts fetched from Supabase & local history for the Shift Ledger
  const [closedLedgerShifts, setClosedLedgerShifts] = useState<any[]>([]);
  const [isLoadingLedger, setIsLoadingLedger] = useState(false);

  React.useEffect(() => {
    const fetchClosedShiftsFromSupabase = async () => {
      setIsLoadingLedger(true);
      const isConfigured = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
      let fetched: any[] = [];

      if (isConfigured) {
        try {
          const { data, error } = await supabase
            .from('shifts')
            .select(`
              *,
              pumpReadings:pump_readings(*)
            `)
            .eq('isactive', false)
            .order('starttime', { ascending: false });

          if (data && !error && data.length > 0) {
            fetched = data.map((s: any) => ({
              id: s.id,
              name: s.name,
              supervisorId: s.supervisorid,
              supervisorName: employees.find(e => e.id === s.supervisorid)?.name || 'Unassigned',
              startTime: s.starttime,
              endTime: s.endtime,
              isActive: s.isactive,
              totalFuelSold: s.totalfuelsold || 0,
              totalNetSold: s.totalnetsold || 0,
              totalNetSales: s.totalnetsales || 0,
              initialPumperCash: s.initialpumpercash || s.initialPumperCash || 0,
              replacementPumperCash: s.replacementpumpercash || s.replacementPumperCash || 0,
              totalPhysicalCash: s.totalphysicalcash || s.totalPhysicalCash || 0,
              cashVariance: s.cashvariance !== undefined ? s.cashvariance : s.cashVariance,
              handoverNotes: s.handovernotes || s.handoverNotes || '',
              replacementPumperId: s.replacementpumperid || s.replacementPumperId || '',
              pumpReadings: (s.pumpReadings || []).map((r: any) => ({
                pumpId: r.pump_id || r.pumpid,
                pumpName: r.pump_name || r.pumpname,
                fuelType: r.fuel_type || r.fueltype,
                tankId: r.tank_id || r.tankid,
                assignedPumperId: r.assigned_pumper_id || r.assignedpumperid,
                startMeter: Number(r.start_meter !== undefined ? r.start_meter : r.startmeter) || 0,
                endMeter: Number(r.end_meter !== undefined ? r.end_meter : r.endmeter) || 0,
                testingQty: Number(r.testing_qty !== undefined ? r.testing_qty : r.testingqty) || 0,
                status: r.status,
                isLocked: r.is_locked !== undefined ? r.is_locked : r.islocked,
                unitPrice: Number(r.unit_price || r.unitprice) || 0,
                actualCash: Number(r.actual_cash ?? r.actualcash) || 0,
                cashVariance: Number(r.cash_variance ?? r.cashvariance) || 0,
                creditSalesAmount: Number(r.credit_sales_amount ?? r.creditsalesamount) || 0,
                cardSalesAmount: Number(r.card_sales_amount ?? r.cardsalesamount) || 0,
                oilSalesAmount: Number(r.oil_sales_amount ?? r.oilsalesamount) || 0,
                totalDispensed: Math.max(0, (Number(r.end_meter ?? r.endmeter) || 0) - (Number(r.start_meter ?? r.startmeter) || 0)),
                netSales: Math.max(0, ((Number(r.end_meter ?? r.endmeter) || 0) - (Number(r.start_meter ?? r.startmeter) || 0) - (Number(r.testing_qty ?? r.testingqty) || 0))) * (Number(r.unit_price || r.unitprice) || 0)
              }))
            }));
          }
        } catch (err) {
          console.warn("Notice: Error loading closed shifts from Supabase:", err);
        }
      }

      const combinedMap = new Map<string, any>();
      (shiftHistory || []).forEach(s => {
        if (!s.isActive) combinedMap.set(s.id, s);
      });
      fetched.forEach(s => {
        combinedMap.set(s.id, s);
      });

      const list = Array.from(combinedMap.values()).sort((a, b) => {
        const tA = new Date(b.startTime || b.endTime || 0).getTime();
        const tB = new Date(a.startTime || a.endTime || 0).getTime();
        return tA - tB;
      });

      setClosedLedgerShifts(list);
      setIsLoadingLedger(false);
    };

    fetchClosedShiftsFromSupabase();
  }, [shiftHistory, employees]);

  React.useEffect(() => {
    const fetchLatestReadingsFromSupabase = async () => {
      const isConfigured = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
      if (!isConfigured) return;

      try {
        const { data, error } = await supabase
          .from('pump_readings')
          .select('pumpid, endmeter')
          .order('id', { ascending: false });

        if (data && data.length > 0) {
          const metersMap: Record<string, number> = {};
          data.forEach((row: any) => {
            const pid = row.pumpid || row.pumpId;
            const endM = row.endmeter !== undefined ? row.endmeter : row.endMeter;
            if (pid && endM !== undefined && endM !== null && !metersMap[pid]) {
              metersMap[pid] = Number(endM);
            }
          });
          setSupabaseLatestMeters(metersMap);
        }
      } catch (err) {
        console.warn("Notice: Could not fetch latest pump readings from Supabase:", err);
      }
    };

    fetchLatestReadingsFromSupabase();
  }, []);

  // Helper: Retrieve previous shift's recorded endmeter for a given pump
  const getPreviousEndMeterForPump = (pumpId: string): number => {
    // 1. Check activeShift if it exists
    if (activeShift?.pumpReadings) {
      const reading = activeShift.pumpReadings.find(pr => pr.pumpId === pumpId);
      if (reading && reading.endMeter > 0) {
        return reading.endMeter;
      }
    }

    // 2. Check supabaseLatestMeters map
    if (supabaseLatestMeters[pumpId] !== undefined && supabaseLatestMeters[pumpId] > 0) {
      return supabaseLatestMeters[pumpId];
    }

    // 3. Check shiftHistory array passed in props
    const historyToSearch = shiftHistory || [];
    for (const shift of historyToSearch) {
      if (shift.pumpReadings) {
        const reading = shift.pumpReadings.find(pr => pr.pumpId === pumpId);
        if (reading && reading.endMeter !== undefined && reading.endMeter !== null && reading.endMeter > 0) {
          return reading.endMeter;
        }
      }
    }

    return 0;
  };

  // No unsaved changes since all edits are auto-saved in real-time to activeShift
  const hasUnsavedChanges = false;

  // Validation state
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [showValidationOverlay, setShowValidationOverlay] = useState(false);

  // Filtered employees list
  const supervisors = useMemo(() => {
    if (!employees || employees.length === 0) return [];
    const filtered = employees.filter(e => e.role?.toLowerCase() === 'supervisor');
    return filtered.length > 0 ? filtered : employees;
  }, [employees]);

  const pumpers = useMemo(() => {
    if (!employees || employees.length === 0) return [];
    const filtered = employees.filter(e => e.role?.toLowerCase() === 'pumper');
    return filtered.length > 0 ? filtered : employees;
  }, [employees]);

  // Read currency symbol from settings/localStorage
  // Format currency/liters helper
  const formatLiters = (val: number) => {
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val) + ' L';
  };

  const formatCurrency = (val: number) => {
    if (Math.abs(val) < 0.005) {
      return 'Rs. 0.00';
    }
    const isNegative = val < 0;
    const formatted = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(val));
    return isNegative ? `-Rs. ${formatted}` : `Rs. ${formatted}`;
  };

  const getPriceForFuelType = (type: string) => {
    if (type === 'Oil & Lubricants') return 0;
    const tank = tanks.find(t => t.fuelType === type);
    return tank ? tank.pricePerLiter : 0;
  };

  // Pre-populate supervisor
  React.useEffect(() => {
    if (supervisors.length > 0 && !newSupervisorId) {
      setNewSupervisorId(supervisors[0].id);
    }
  }, [supervisors, newSupervisorId]);

  // Handle template change
  const handleTemplateChange = (template: typeof newShiftTemplate) => {
    setNewShiftTemplate(template);
    if (template === 'Morning') {
      setShiftNameInput('Morning Shift');
      setStartTimeInput('06:00');
      setEndTimeInput('14:00');
    } else if (template === 'Evening') {
      setShiftNameInput('Evening Shift');
      setStartTimeInput('14:00');
      setEndTimeInput('22:00');
    } else if (template === 'Night') {
      setShiftNameInput('Night Shift');
      setStartTimeInput('22:00');
      setEndTimeInput('06:00');
    } else {
      setShiftNameInput('Custom Shift');
      setStartTimeInput('08:00');
      setEndTimeInput('16:00');
    }
  };

  // Active supervisor details based on draftSupervisorId
  const activeSupervisor = useMemo(() => {
    if (!activeShift) return null;
    return employees.find(e => e.id === draftSupervisorId) || null;
  }, [activeShift, draftSupervisorId, employees]);

  // Running totals calculations based on draftReadings (enables live calculation feedback)
  const stats = useMemo(() => {
    if (!activeShift || draftReadings.length === 0) {
      return { runningPumps: 0, totalFuelSold: 0, totalNetSold: 0, totalFuelSales: 0, totalOilSales: 0, totalNetSales: 0 };
    }
    
    let runningPumps = 0;
    let totalFuelSold = 0;
    let totalNetSold = 0;
    let totalFuelSales = 0;
    let totalOilSales = 0;

    draftReadings.forEach(r => {
      if (r.assignedPumperId) {
        runningPumps++;
      }
      const fuelSold = Math.max(0, r.endMeter - r.startMeter);
      const netSold = Math.max(0, fuelSold - r.testingQty);
      const rate = getPriceForFuelType(r.fuelType);
      const fuelRev = netSold * rate;
      const oilRev = r.oilSalesAmount || 0;
      
      totalFuelSold += fuelSold;
      totalNetSold += netSold;
      totalFuelSales += fuelRev;
      totalOilSales += oilRev;
    });

    const totalNetSales = totalFuelSales + totalOilSales;

    return {
      runningPumps,
      totalFuelSold,
      totalNetSold,
      totalFuelSales,
      totalOilSales,
      totalNetSales
    };
  }, [activeShift, draftReadings, tanks]);

  // Liters categorized by fuel type based on draftReadings
  const fuelTypeTotals = useMemo(() => {
    const totals: Record<string, { gross: number; net: number; sales: number }> = {
      'Petrol 92': { gross: 0, net: 0, sales: 0 },
      'Petrol 95': { gross: 0, net: 0, sales: 0 },
      'Auto Diesel': { gross: 0, net: 0, sales: 0 },
      'Super Diesel': { gross: 0, net: 0, sales: 0 }
    };

    if (activeShift && draftReadings.length > 0) {
      draftReadings.forEach(r => {
        const fuel = Math.max(0, r.endMeter - r.startMeter);
        const net = Math.max(0, fuel - r.testingQty);
        const rate = getPriceForFuelType(r.fuelType);
        if (totals[r.fuelType]) {
          totals[r.fuelType].gross += fuel;
          totals[r.fuelType].net += net;
          totals[r.fuelType].sales += (net * rate);
        }
      });
    }

    return totals;
  }, [activeShift, draftReadings, tanks]);

  // Fuel badge color helper function
  const getFuelBadgeStyles = (fuelType: string) => {
    if (fuelType.includes('Petrol 92') || fuelType.includes('92')) {
      return {
        badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        dot: 'bg-emerald-500',
      };
    }
    if (fuelType.includes('Petrol 95') || fuelType.includes('95')) {
      return {
        badge: 'bg-rose-50 text-rose-700 border-rose-200',
        dot: 'bg-rose-500',
      };
    }
    if (fuelType.includes('Super Diesel')) {
      return {
        badge: 'bg-sky-50 text-sky-700 border-sky-200',
        dot: 'bg-sky-500',
      };
    }
    if (fuelType.includes('Auto Diesel') || fuelType.includes('Diesel')) {
      return {
        badge: 'bg-amber-50 text-amber-700 border-amber-200',
        dot: 'bg-amber-500',
      };
    }
    return {
      badge: 'bg-slate-100 text-slate-700 border-slate-200',
      dot: 'bg-slate-500',
    };
  };

  // Group draft readings by assigned pumper for cash reconciliation
  const activePumpersData = useMemo(() => {
    const pumperGroups: Record<string, {
      pumperId: string;
      pumperName: string;
      avatarColor: string;
      readings: PumpReading[];
    }> = {};

    draftReadings.forEach(r => {
      if (r.assignedPumperId) {
        const emp = employees.find(e => e.id === r.assignedPumperId);
        if (emp) {
          if (!pumperGroups[emp.id]) {
            pumperGroups[emp.id] = {
              pumperId: emp.id,
              pumperName: emp.name,
              avatarColor: emp.avatarColor || 'bg-blue-600',
              readings: []
            };
          }
          pumperGroups[emp.id].readings.push(r);
        }
      }
    });

    return Object.values(pumperGroups);
  }, [draftReadings, employees]);

  // Filter pumpers assigned to 2 or more active/draft pumps for multi-pump consolidation
  const multiPumpersData = useMemo(() => {
    return activePumpersData.filter(p => p.readings.length >= 2);
  }, [activePumpersData]);

  // Compute consolidated totals for ALL active pumpers (whether 1 or multiple pumps)
  const allPumperStats = useMemo(() => {
    return activePumpersData.map(pumper => {
      let totalGrossRevenue = 0;
      let totalFuelRevenue = 0;
      let totalOilSales = 0;
      let totalNetLiters = 0;
      let totalCreditSales = 0;
      let totalCardSales = 0;
      let totalActualCash = 0;

      pumper.readings.forEach(r => {
        const fuelPrice = getPriceForFuelType(r.fuelType);
        const isOil = r.pumpId === 'pump-oil-bay' || r.fuelType === 'Oil & Lubricants' || r.pumpName?.toLowerCase().includes('oil');
        const fuelSold = isOil ? 0 : Math.max(0, r.endMeter - r.startMeter);
        const netSold = isOil ? 0 : Math.max(0, fuelSold - r.testingQty);
        const grossFuelRev = netSold * fuelPrice;
        const oilSales = r.oilSalesAmount || 0;
        const grossTotalRev = grossFuelRev + oilSales;
        const creditVal = r.creditSalesAmount || 0;
        const cardVal = r.cardSalesAmount || 0;
        const actCash = r.actualCash || 0;

        totalFuelRevenue += grossFuelRev;
        totalOilSales += oilSales;
        totalGrossRevenue += grossTotalRev;
        totalNetLiters += netSold;
        totalCreditSales += creditVal;
        totalCardSales += cardVal;
        totalActualCash += actCash;
      });

      const totalNonCash = totalCreditSales + totalCardSales;
      const totalNetExpCash = Math.max(0, totalGrossRevenue - totalNonCash);
      const totalCashVariance = totalActualCash - totalNetExpCash;

      return {
        ...pumper,
        totalGrossRevenue,
        totalFuelRevenue,
        totalOilSales,
        totalNetLiters,
        totalNonCash,
        totalCreditSales,
        totalCardSales,
        totalNetExpCash,
        totalActualCash,
        totalCashVariance,
        overallVariance: totalCashVariance
      };
    });
  }, [activePumpersData, activeShift, tanks]);

  // Alias pumperStats for widget rendering
  const pumperStats = allPumperStats;

  // Handle consolidated single cash handover entry for multi-pump assigned pumper
  const handleUpdateConsolidatedCashForPumper = (pumperId: string, newTotalCash: number) => {
    if (!activeShift) return;
    if (finalizedPumperCards[pumperId]) return;

    const pumperReadings = draftReadings.filter(r => r.assignedPumperId === pumperId);
    if (pumperReadings.length === 0) return;

    const pumpData = pumperReadings.map(r => {
      const fuelPrice = getPriceForFuelType(r.fuelType);
      const isOil = r.pumpId === 'pump-oil-bay' || r.fuelType === 'Oil & Lubricants' || r.pumpName?.toLowerCase().includes('oil');
      const fuelSold = isOil ? 0 : Math.max(0, r.endMeter - r.startMeter);
      const netSold = isOil ? 0 : Math.max(0, fuelSold - r.testingQty);
      const grossFuelRev = netSold * fuelPrice;
      const oilSales = r.oilSalesAmount || 0;
      const grossTotalRev = grossFuelRev + oilSales;
      const creditVal = r.creditSalesAmount || 0;
      const cardVal = r.cardSalesAmount || 0;
      const rawNetExpCash = grossTotalRev - (creditVal + cardVal);
      return { pumpId: r.pumpId, grossTotalRev, creditVal, cardVal, rawNetExpCash, status: r.status };
    });

    const totalGrossRevenue = pumpData.reduce((acc, p) => acc + p.grossTotalRev, 0);
    const totalNonCash = pumpData.reduce((acc, p) => acc + p.creditVal + p.cardVal, 0);
    const totalNetExpCash = Math.max(0, totalGrossRevenue - totalNonCash);

    let allocatedSoFar = 0;
    const newCashPerPump: Record<string, number> = {};

    pumpData.forEach((p, idx) => {
      if (idx === pumpData.length - 1) {
        newCashPerPump[p.pumpId] = Math.max(0, Math.round((newTotalCash - allocatedSoFar) * 100) / 100);
      } else {
        let allocated = 0;
        if (totalGrossRevenue > 0) {
          allocated = Math.round((p.grossTotalRev / totalGrossRevenue) * newTotalCash * 100) / 100;
        } else {
          allocated = Math.round((newTotalCash / pumpData.length) * 100) / 100;
        }
        newCashPerPump[p.pumpId] = allocated;
        allocatedSoFar += allocated;
      }
    });

    const pumperHasExcessRevenue = totalGrossRevenue > totalNonCash;

    const updatedReadings = draftReadings.map(r => {
      if (r.assignedPumperId === pumperId && newCashPerPump[r.pumpId] !== undefined) {
        const actCash = newCashPerPump[r.pumpId];
        const fuelPrice = getPriceForFuelType(r.fuelType);
        const isOil = r.pumpId === 'pump-oil-bay' || r.fuelType === 'Oil & Lubricants' || r.pumpName?.toLowerCase().includes('oil');
        const fuelSold = isOil ? 0 : Math.max(0, r.endMeter - r.startMeter);
        const netSold = isOil ? 0 : Math.max(0, fuelSold - r.testingQty);
        const grossFuelRev = netSold * fuelPrice;
        const oilSales = r.oilSalesAmount || 0;
        const grossTotalRev = grossFuelRev + oilSales;
        const creditVal = r.creditSalesAmount || 0;
        const cardVal = r.cardSalesAmount || 0;
        const rawNet = grossTotalRev - (creditVal + cardVal);
        const netExpCash = (rawNet < 0 && pumperHasExcessRevenue) ? rawNet : Math.max(0, rawNet);
        const computedVariance = actCash - netExpCash;

        return {
          ...r,
          actualCash: actCash,
          cashVariance: computedVariance
        };
      }
      return r;
    });

    setDraftReadings(updatedReadings);

    // Sync activeShift
    let totalFuel = 0;
    let totalNet = 0;
    let totalSales = 0;

    updatedReadings.forEach(dr => {
      const fuel = Math.max(0, dr.endMeter - dr.startMeter);
      const net = Math.max(0, fuel - dr.testingQty);
      totalFuel += fuel;
      totalNet += net;
      totalSales += (net * getPriceForFuelType(dr.fuelType));
    });

    setActiveShift({
      ...activeShift,
      pumpReadings: updatedReadings,
      totalFuelSold: totalFuel,
      totalNetSold: totalNet,
      totalNetSales: totalSales
    });
  };

  // Handle live updates to a specific pump's readings in local draft state
  const handleUpdateReading = (
    pumpId: string,
    field: 'assignedPumperId' | 'startMeter' | 'endMeter' | 'testingQty' | 'actualCash' | 'creditSalesAmount' | 'cardSalesAmount' | 'oilSalesAmount',
    value: any,
    targetReadingIdOrPumperId?: string
  ) => {
    if (!activeShift) return;

    const updatedReadings = draftReadings.map(r => {
      const isTarget = targetReadingIdOrPumperId 
        ? (r.id === targetReadingIdOrPumperId || (r.pumpId === pumpId && r.assignedPumperId === targetReadingIdOrPumperId))
        : (r.pumpId === pumpId);

      if (isTarget) {
        // Block editing if this entire pumper card is finalized
        if (r.assignedPumperId && finalizedPumperCards[r.assignedPumperId]) {
          return r;
        }

        // Block editing only if that specific meter field is explicitly locked
        if (field === 'startMeter' && lockedStartMeters[pumpId]) {
          return r;
        }
        if (field === 'endMeter' && lockedEndMeters[pumpId]) {
          return r;
        }

        const fuelPrice = getPriceForFuelType(r.fuelType);
        const startM = field === 'startMeter' ? (parseFloat(value) || 0) : r.startMeter;
        const endM = field === 'endMeter' ? (parseFloat(value) || 0) : r.endMeter;
        const testQ = field === 'testingQty' ? (parseFloat(value) || 0) : r.testingQty;
        const creditVal = field === 'creditSalesAmount' ? (parseFloat(value) || 0) : (r.creditSalesAmount ?? 0);
        const cardVal = field === 'cardSalesAmount' ? (parseFloat(value) || 0) : (r.cardSalesAmount ?? 0);
        const oilVal = field === 'oilSalesAmount' ? (parseFloat(value) || 0) : (r.oilSalesAmount ?? 0);
        const actCash = field === 'actualCash' ? (parseFloat(value) || 0) : (r.actualCash ?? 0);

        const fuelSold = Math.max(0, endM - startM);
        const netSold = Math.max(0, fuelSold - testQ);
        const grossFuelRevenue = netSold * fuelPrice;
        const totalGrossRevenue = grossFuelRevenue + oilVal;
        const rawNetExpCash = totalGrossRevenue - (creditVal + cardVal);
        let netExpectedCash = rawNetExpCash;
        if (rawNetExpCash < 0) {
          const otherPumpsExcess = draftReadings
            .filter(dr => dr.pumpId !== pumpId && dr.assignedPumperId && dr.assignedPumperId === r.assignedPumperId)
            .reduce((sum, dr) => {
              const oPrice = getPriceForFuelType(dr.fuelType);
              const oIsOil = dr.pumpId === 'pump-oil-bay' || dr.fuelType === 'Oil & Lubricants' || dr.pumpName?.toLowerCase().includes('oil');
              const oSold = oIsOil ? 0 : Math.max(0, dr.endMeter - dr.startMeter);
              const oNet = oIsOil ? 0 : Math.max(0, oSold - dr.testingQty);
              const oGross = (oNet * oPrice) + (dr.oilSalesAmount || 0);
              const oNonCash = (dr.creditSalesAmount || 0) + (dr.cardSalesAmount || 0);
              return sum + Math.max(0, oGross - oNonCash);
            }, 0);

          if (otherPumpsExcess <= 0) {
            netExpectedCash = 0;
          }
        }
        const computedVariance = actCash - netExpectedCash;

        const updated = {
          ...r,
          [field]: value,
          creditSalesAmount: creditVal,
          cardSalesAmount: cardVal,
          oilSalesAmount: oilVal,
          actualCash: actCash,
          cashVariance: computedVariance
        };

        // Debounce Supabase remote sync calls (500ms) to prevent database call spamming on every keystroke
        const syncKey = `${pumpId}_sync`;
        if (debounceTimersRef.current[syncKey]) {
          clearTimeout(debounceTimersRef.current[syncKey]);
        }

        debounceTimersRef.current[syncKey] = setTimeout(() => {
          if (field === 'creditSalesAmount' && creditVal > 0) {
            saveCreditSale(supabase, {
              shift_id: activeShift.id,
              pump_id: pumpId,
              customer_name: 'Credit Customer',
              fuel_type: r.fuelType || 'Fuel',
              liters: netSold,
              amount: Number(creditVal),
              status: 'Approved'
            });
          }

          if (field === 'cardSalesAmount' && cardVal > 0) {
            saveCardSale(supabase, {
              shift_id: activeShift.id,
              pump_id: pumpId,
              card_type: 'POS Card',
              amount: Number(cardVal),
              status: 'Settled'
            });
          }

          // Direct fallback write to pump_readings table so card_sales_amount & credit_sales_amount are updated
          upsertPumpReadings(supabase, [updated], activeShift.id);
        }, 500);
        
        return updated;
      }
      return r;
    });

    setDraftReadings(updatedReadings);

    // Persist immediately in the global activeShift state so no progress is lost
    let totalFuel = 0;
    let totalNet = 0;
    let totalSales = 0;

    updatedReadings.forEach(dr => {
      const isOil = dr.pumpId === 'pump-oil-bay' || dr.fuelType === 'Oil & Lubricants' || dr.pumpName?.toLowerCase().includes('dispenser') || dr.pumpName?.toLowerCase().includes('oil');
      const fuel = isOil ? 0 : Math.max(0, dr.endMeter - dr.startMeter);
      const net = isOil ? 0 : Math.max(0, fuel - dr.testingQty);
      const fuelRev = isOil ? 0 : (net * getPriceForFuelType(dr.fuelType));
      const oilRev = dr.oilSalesAmount || 0;
      totalFuel += fuel;
      totalNet += net;
      totalSales += (fuelRev + oilRev);
    });

    setActiveShift({
      ...activeShift,
      pumpReadings: updatedReadings,
      totalFuelSold: totalFuel,
      totalNetSold: totalNet,
      totalNetSales: totalSales
    });
  };

  // Handle live updates to a specific chamber's closing level in Forecourt Dispenser Station
  const handleUpdateChamberClosingLevel = (pumpId: string, chamberId: string, closingLevel: number) => {
    if (!activeShift) return;

    const updatedReadings = draftReadings.map(r => {
      if (r.pumpId === pumpId) {
        if (r.assignedPumperId && finalizedPumperCards[r.assignedPumperId]) return r;

        const currentChambers = r.chamberReadings && r.chamberReadings.length > 0
          ? r.chamberReadings
          : getDefaultChambers(oilTanks);

        const updatedChambers = currentChambers.map(ch => {
          if (ch.chamberId === chamberId) {
            const opLevel = ch.openingLevel ?? ch.openingLiters ?? 0;
            const soldLiters = calculateChamberSoldLiters(opLevel, closingLevel);
            const totalAmount = soldLiters * (ch.ratePerLiter || 0);
            return {
              ...ch,
              openingLiters: opLevel,
              closingLiters: closingLevel,
              openingLevel: opLevel,
              closingLevel,
              soldLiters,
              totalAmount
            };
          }
          return ch;
        });

        const totalOilSales = updatedChambers.reduce((sum, ch) => sum + ch.totalAmount, 0);
        const creditVal = r.creditSalesAmount || 0;
        const cardVal = r.cardSalesAmount || 0;
        const actCash = r.actualCash || 0;
        const netExpectedCash = Math.max(0, totalOilSales - (creditVal + cardVal));
        const computedVariance = actCash - netExpectedCash;

        const updatedReading: PumpReading = {
          ...r,
          chamberReadings: updatedChambers,
          oilSalesAmount: totalOilSales,
          cashVariance: computedVariance
        };

        // Remote sync debounce
        const syncKey = `${pumpId}_sync`;
        if (debounceTimersRef.current[syncKey]) {
          clearTimeout(debounceTimersRef.current[syncKey]);
        }
        debounceTimersRef.current[syncKey] = setTimeout(() => {
          upsertPumpReadings(supabase, [updatedReading], activeShift.id);
        }, 500);

        return updatedReading;
      }
      return r;
    });

    setDraftReadings(updatedReadings);

    let totalFuel = 0;
    let totalNet = 0;
    let totalSales = 0;

    updatedReadings.forEach(dr => {
      const isOil = dr.pumpId === 'pump-oil-bay' || dr.fuelType === 'Oil & Lubricants' || dr.pumpName?.toLowerCase().includes('dispenser') || dr.pumpName?.toLowerCase().includes('oil');
      const fuel = isOil ? 0 : Math.max(0, dr.endMeter - dr.startMeter);
      const net = isOil ? 0 : Math.max(0, fuel - dr.testingQty);
      const fuelRev = isOil ? 0 : (net * getPriceForFuelType(dr.fuelType));
      const oilRev = dr.oilSalesAmount || 0;
      totalFuel += fuel;
      totalNet += net;
      totalSales += (fuelRev + oilRev);
    });

    setActiveShift({
      ...activeShift,
      pumpReadings: updatedReadings,
      totalFuelSold: totalFuel,
      totalNetSold: totalNet,
      totalNetSales: totalSales
    });
  };

  // Handle live updates to a specific chamber's opening level in Forecourt Dispenser Station
  const handleUpdateChamberOpeningLevel = (pumpId: string, chamberId: string, openingLevel: number) => {
    if (!activeShift) return;

    const updatedReadings = draftReadings.map(r => {
      if (r.pumpId === pumpId) {
        if (lockedStartMeters[pumpId] || (r.assignedPumperId && finalizedPumperCards[r.assignedPumperId])) return r;

        const currentChambers = r.chamberReadings && r.chamberReadings.length > 0
          ? r.chamberReadings
          : getDefaultChambers(oilTanks);

        const updatedChambers = currentChambers.map(ch => {
          if (ch.chamberId === chamberId) {
            const clLevel = ch.closingLevel ?? ch.closingLiters ?? 0;
            const soldLiters = calculateChamberSoldLiters(openingLevel, clLevel);
            const totalAmount = soldLiters * (ch.ratePerLiter || 0);
            return {
              ...ch,
              openingLiters: openingLevel,
              closingLiters: clLevel,
              openingLevel,
              closingLevel: clLevel,
              soldLiters,
              totalAmount
            };
          }
          return ch;
        });

        const totalOilSales = updatedChambers.reduce((sum, ch) => sum + ch.totalAmount, 0);
        const creditVal = r.creditSalesAmount || 0;
        const cardVal = r.cardSalesAmount || 0;
        const actCash = r.actualCash || 0;
        const netExpectedCash = Math.max(0, totalOilSales - (creditVal + cardVal));
        const computedVariance = actCash - netExpectedCash;

        const updatedReading: PumpReading = {
          ...r,
          chamberReadings: updatedChambers,
          oilSalesAmount: totalOilSales,
          cashVariance: computedVariance
        };

        return updatedReading;
      }
      return r;
    });

    setDraftReadings(updatedReadings);

    let totalFuel = 0;
    let totalNet = 0;
    let totalSales = 0;

    updatedReadings.forEach(dr => {
      const isOil = dr.pumpId === 'pump-oil-bay' || dr.fuelType === 'Oil & Lubricants' || dr.pumpName?.toLowerCase().includes('dispenser') || dr.pumpName?.toLowerCase().includes('oil');
      const fuel = isOil ? 0 : Math.max(0, dr.endMeter - dr.startMeter);
      const net = isOil ? 0 : Math.max(0, fuel - dr.testingQty);
      const fuelRev = isOil ? 0 : (net * getPriceForFuelType(dr.fuelType));
      const oilRev = dr.oilSalesAmount || 0;
      totalFuel += fuel;
      totalNet += net;
      totalSales += (fuelRev + oilRev);
    });

    setActiveShift({
      ...activeShift,
      pumpReadings: updatedReadings,
      totalFuelSold: totalFuel,
      totalNetSold: totalNet,
      totalNetSales: totalSales
    });
  };

  // PHASE 1: Save Start Meter & Lock Only Start Meter for a Pumper's assigned pumps
  const handleSaveStartMeterForPumper = async (pumperId: string) => {
    if (!activeShift) return;

    const pumperObj = employees.find(e => e.id === pumperId);
    const pumperName = pumperObj?.name || 'Pumper';
    const pumperReadings = draftReadings.filter(r => r.assignedPumperId === pumperId);

    if (pumperReadings.length === 0) {
      setToastMessage(`No pumps assigned to ${pumperName}. Please assign pumps first.`);
      setTimeout(() => setToastMessage(null), 3000);
      return;
    }

    // Validate that Start Meters are non-negative
    const invalidStart = pumperReadings.find(r => r.startMeter === undefined || r.startMeter === null || r.startMeter < 0 || isNaN(r.startMeter));
    if (invalidStart) {
      setToastMessage(`Please enter a valid non-negative Start Meter for ${invalidStart.pumpName}.`);
      setTimeout(() => setToastMessage(null), 3000);
      return;
    }

    // Lock ONLY Start Meters
    const newLockedStarts = { ...lockedStartMeters };
    pumperReadings.forEach(r => {
      newLockedStarts[r.pumpId] = true;
    });
    setLockedStartMeters(newLockedStarts);
    saveLocksToStorage(activeShift.id, newLockedStarts, lockedEndMeters, finalizedPumperCards);

    // Update draftReadings with isStartSaved: true & status: Active
    const updatedDraftReadings = draftReadings.map(dr => {
      if (dr.assignedPumperId === pumperId) {
        return {
          ...dr,
          isStartSaved: true,
          status: dr.status === 'Completed' ? ('Completed' as const) : ('Active' as const)
        };
      }
      return dr;
    });
    setDraftReadings(updatedDraftReadings);

    // Save pump readings to Supabase
    try {
      await upsertPumpReadings(supabase, updatedDraftReadings.filter(r => r.assignedPumperId === pumperId), activeShift.id);
    } catch (err) {
      console.warn('Start meter sync note:', err);
    }

    // Update React activeShift state
    let totalFuel = 0;
    let totalNet = 0;
    let totalSales = 0;

    updatedDraftReadings.forEach(dr => {
      const isOil = dr.pumpId === 'pump-oil-bay' || dr.fuelType === 'Oil & Lubricants' || dr.pumpName?.toLowerCase().includes('dispenser') || dr.pumpName?.toLowerCase().includes('oil');
      const fuel = isOil ? 0 : Math.max(0, dr.endMeter - dr.startMeter);
      const net = isOil ? 0 : Math.max(0, fuel - dr.testingQty);
      const fuelRev = isOil ? 0 : (net * getPriceForFuelType(dr.fuelType));
      const oilRev = dr.oilSalesAmount || 0;
      totalFuel += fuel;
      totalNet += net;
      totalSales += (fuelRev + oilRev);
    });

    setActiveShift({
      ...activeShift,
      pumpReadings: updatedDraftReadings,
      totalFuelSold: totalFuel,
      totalNetSold: totalNet,
      totalNetSales: totalSales
    });

    setToastMessage(`Start Meter saved & locked for ${pumperName}. Shift operations are active!`);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // PHASE 2: Save & Finalize Pumper Record (Locks Start Meter, End Meter, Non-Cash, Test, Cash Handover)
  const handleFinalizePumperRecord = async (pumperId: string) => {
    if (!activeShift) return;

    const pumperObj = employees.find(e => e.id === pumperId);
    const pumperName = pumperObj?.name || 'Pumper';
    const pumperReadings = draftReadings.filter(r => r.assignedPumperId === pumperId);

    if (pumperReadings.length === 0) {
      setToastMessage(`No pumps assigned to ${pumperName}.`);
      setTimeout(() => setToastMessage(null), 3000);
      return;
    }

    // Validate that End Meter is entered and >= Start Meter for fuel pumps
    for (const r of pumperReadings) {
      const isOil = r.pumpId === 'pump-oil-bay' || r.fuelType === 'Oil & Lubricants' || r.pumpName?.toLowerCase().includes('dispenser') || r.pumpName?.toLowerCase().includes('oil');
      if (!isOil) {
        if (r.endMeter === undefined || r.endMeter === null || isNaN(r.endMeter)) {
          setToastMessage(`Please enter End Meter reading for ${r.pumpName}.`);
          setTimeout(() => setToastMessage(null), 3500);
          return;
        }
        if (r.endMeter < r.startMeter) {
          setToastMessage(`End Meter (${r.endMeter} L) on ${r.pumpName} cannot be less than Start Meter (${r.startMeter} L).`);
          setTimeout(() => setToastMessage(null), 4000);
          return;
        }
      }
    }

    // Lock Start Meters, End Meters, and the whole Pumper Card
    const newLockedStarts = { ...lockedStartMeters };
    const newLockedEnds = { ...lockedEndMeters };
    const newFinalized = { ...finalizedPumperCards, [pumperId]: true };
    pumperReadings.forEach(r => {
      newLockedStarts[r.pumpId] = true;
      newLockedEnds[r.pumpId] = true;
    });

    setLockedStartMeters(newLockedStarts);
    setLockedEndMeters(newLockedEnds);
    setFinalizedPumperCards(newFinalized);
    setSavedPumperCards(prev => ({ ...prev, [pumperId]: true }));
    setSavedPumperIds(prev => ({ ...prev, [pumperId]: true }));
    saveLocksToStorage(activeShift.id, newLockedStarts, newLockedEnds, newFinalized);

    // Update draftReadings with isStartSaved: true, isCardFinalized: true, isLocked: true and status: Completed
    const updatedDraftReadings = draftReadings.map(dr => {
      if (dr.assignedPumperId === pumperId) {
        return {
          ...dr,
          isStartSaved: true,
          isCardFinalized: true,
          isLocked: true,
          status: 'Completed' as const
        };
      }
      return dr;
    });
    setDraftReadings(updatedDraftReadings);

    // Save pump readings to Supabase
    try {
      await upsertPumpReadings(supabase, updatedDraftReadings.filter(r => r.assignedPumperId === pumperId), activeShift.id);
    } catch (err) {
      console.warn('Pump readings sync note:', err);
    }

    // Save pumper assignment & handed over cash summary to Supabase shift_pumper_assignments
    const pumperCard = pumperCardsData.find(p => p.pumperId === pumperId);
    const actualCash = pumperCard ? (pumperCard.totalActualCash || 0) : 0;
    const expCash = pumperCard ? (pumperCard.totalExpectedCash || 0) : 0;
    const variance = pumperCard ? (pumperCard.cashVariance || 0) : 0;

    try {
      const assignmentPayload = {
        id: `${activeShift.id}_${pumperId}`,
        shift_id: activeShift.id,
        pumper_id: pumperId,
        pumper_name: pumperName,
        actual_cash: actualCash,
        expected_cash: expCash,
        cash_variance: variance,
        assigned_pumps_count: pumperReadings.length,
        status: 'Completed',
        updated_at: new Date().toISOString()
      };

      const { error } = await supabase.from('shift_pumper_assignments').upsert([assignmentPayload]);
      if (error && (error.code === 'PGRST205' || error.message?.includes('schema cache') || error.message?.includes('Could not find'))) {
        await supabase.from('pumper_assignments').upsert([{
          id: `${activeShift.id}_${pumperId}`,
          shift_id: activeShift.id,
          pumper_id: pumperId,
          actual_cash: actualCash,
          status: 'Completed'
        }]);
      }
    } catch (err) {
      console.warn('shift_pumper_assignments sync note:', err);
    }

    // Update activeShift state in React
    let totalFuel = 0;
    let totalNet = 0;
    let totalSales = 0;

    updatedDraftReadings.forEach(dr => {
      const isOil = dr.pumpId === 'pump-oil-bay' || dr.fuelType === 'Oil & Lubricants' || dr.pumpName?.toLowerCase().includes('dispenser') || dr.pumpName?.toLowerCase().includes('oil');
      const fuel = isOil ? 0 : Math.max(0, dr.endMeter - dr.startMeter);
      const net = isOil ? 0 : Math.max(0, fuel - dr.testingQty);
      const fuelRev = isOil ? 0 : (net * getPriceForFuelType(dr.fuelType));
      const oilRev = dr.oilSalesAmount || 0;
      totalFuel += fuel;
      totalNet += net;
      totalSales += (fuelRev + oilRev);
    });

    setActiveShift({
      ...activeShift,
      pumpReadings: updatedDraftReadings,
      totalFuelSold: totalFuel,
      totalNetSold: totalNet,
      totalNetSales: totalSales
    });

    setToastMessage(`Pumper record for ${pumperName} finalized & locked!`);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Unlock pumper record for supervisor adjustments
  const handleUnlockPumperRecord = (pumperId: string) => {
    if (!activeShift) return;
    const pumperObj = employees.find(e => e.id === pumperId);
    const pumperName = pumperObj?.name || 'Pumper';

    const newFinalized = { ...finalizedPumperCards };
    delete newFinalized[pumperId];
    setFinalizedPumperCards(newFinalized);

    const newLockedEnds = { ...lockedEndMeters };
    draftReadings.filter(r => r.assignedPumperId === pumperId).forEach(r => {
      delete newLockedEnds[r.pumpId];
    });
    setLockedEndMeters(newLockedEnds);
    saveLocksToStorage(activeShift.id, lockedStartMeters, newLockedEnds, newFinalized);

    const updatedDraftReadings = draftReadings.map(dr => {
      if (dr.assignedPumperId === pumperId) {
        return {
          ...dr,
          isCardFinalized: false,
          isLocked: false,
          status: 'Active' as const
        };
      }
      return dr;
    });

    setDraftReadings(updatedDraftReadings);

    let totalFuel = 0;
    let totalNet = 0;
    let totalSales = 0;

    updatedDraftReadings.forEach(dr => {
      const isOil = dr.pumpId === 'pump-oil-bay' || dr.fuelType === 'Oil & Lubricants' || dr.pumpName?.toLowerCase().includes('dispenser') || dr.pumpName?.toLowerCase().includes('oil');
      const fuel = isOil ? 0 : Math.max(0, dr.endMeter - dr.startMeter);
      const net = isOil ? 0 : Math.max(0, fuel - dr.testingQty);
      const fuelRev = isOil ? 0 : (net * getPriceForFuelType(dr.fuelType));
      const oilRev = dr.oilSalesAmount || 0;
      totalFuel += fuel;
      totalNet += net;
      totalSales += (fuelRev + oilRev);
    });

    setActiveShift({
      ...activeShift,
      pumpReadings: updatedDraftReadings,
      totalFuelSold: totalFuel,
      totalNetSold: totalNet,
      totalNetSales: totalSales
    });

    setToastMessage(`Pumper record for ${pumperName} unlocked for adjustments.`);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Backwards-compatible alias for single-call invocation
  const handleSavePumperReadings = async (pumperId: string) => {
    const assignedReadings = draftReadings.filter(r => r.assignedPumperId === pumperId);
    const isStartSaved = assignedReadings.length > 0 && assignedReadings.every(r => !!r.isStartSaved || !!lockedStartMeters[r.pumpId]);
    if (!isStartSaved) {
      await handleSaveStartMeterForPumper(pumperId);
    } else {
      await handleFinalizePumperRecord(pumperId);
    }
  };

  // Save and lock a single pump's starting readings (Assigned Pumper & Start Meter), marking it Active
  const handleSavePumpData = (pumpId: string) => {
    if (!activeShift) return;
    const r = draftReadings.find(dr => dr.pumpId === pumpId);
    if (!r) return;

    const errors: string[] = [];
    if (!r.assignedPumperId) {
      errors.push("Please assign a Pumper to this pump before saving.");
    }
    if (r.startMeter === undefined || r.startMeter === null || r.startMeter < 0 || isNaN(r.startMeter)) {
      errors.push("Start Meter reading must be a non-negative number.");
    }

    if (errors.length > 0) {
      setToastMessage(`Validation Error: ${errors[0]}`);
      setTimeout(() => setToastMessage(null), 5000);
      return;
    }

    const updatedReadings = draftReadings.map(dr => {
      if (dr.pumpId === pumpId) {
        return { 
          ...dr, 
          endMeter: dr.endMeter || 0,
          isStartSaved: true,
          status: 'Active' as const 
        };
      }
      return dr;
    });

    setDraftReadings(updatedReadings);

    // Persist immediately in the global activeShift state
    let totalFuel = 0;
    let totalNet = 0;
    let totalSales = 0;

    updatedReadings.forEach(dr => {
      const fuel = Math.max(0, dr.endMeter - dr.startMeter);
      const net = Math.max(0, fuel - dr.testingQty);
      totalFuel += fuel;
      totalNet += net;
      totalSales += (net * getPriceForFuelType(dr.fuelType));
    });

    setActiveShift({
      ...activeShift,
      pumpReadings: updatedReadings,
      totalFuelSold: totalFuel,
      totalNetSold: totalNet,
      totalNetSales: totalSales
    });

    const newStarts = { ...lockedStartMeters, [pumpId]: true };
    setLockedStartMeters(newStarts);
    saveLocksToStorage(activeShift.id, newStarts, lockedEndMeters, finalizedPumperCards);
    setToastMessage(`${r.pumpName} start meter successfully saved! End Meter & Testing Quantity are now unlocked.`);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Dynamically update a pump's target underground storage tank mapping
  const handleUpdatePumpTankMapping = (pumpId: string, newTankId: string) => {
    const selectedTank = tanks.find(t => t.id === newTankId);
    if (!selectedTank) return;

    const updatedReadings = draftReadings.map(dr => {
      if (dr.pumpId === pumpId) {
        return {
          ...dr,
          tankId: newTankId,
          fuelType: selectedTank.fuelType
        };
      }
      return dr;
    });

    setDraftReadings(updatedReadings);

    if (activeShift) {
      let totalFuel = 0;
      let totalNet = 0;
      let totalSales = 0;

      updatedReadings.forEach(dr => {
        const fuel = Math.max(0, dr.endMeter - dr.startMeter);
        const net = Math.max(0, fuel - dr.testingQty);
        totalFuel += fuel;
        totalNet += net;
        totalSales += (net * getPriceForFuelType(dr.fuelType));
      });

      setActiveShift({
        ...activeShift,
        pumpReadings: updatedReadings,
        totalFuelSold: totalFuel,
        totalNetSold: totalNet,
        totalNetSales: totalSales
      });
    }

    if (setPumps) {
      setPumps(prev => prev.map(p => {
        if (p.id === pumpId) {
          return {
            ...p,
            tankId: newTankId,
            fuelType: selectedTank.fuelType
          };
        }
        return p;
      }));
    }

    setToastMessage(`Pump ${pumpId} successfully mapped to ${selectedTank.name} (${selectedTank.fuelType})`);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Unlock single pump's starting readings for adjustment, moving it back to Setup (Idle) mode
  const handleUnlockPumpData = (pumpId: string) => {
    if (!activeShift) return;
    const r = draftReadings.find(dr => dr.pumpId === pumpId);
    if (!r) return;

    const updatedReadings = draftReadings.map(dr => {
      if (dr.pumpId === pumpId) {
        return { ...dr, isLocked: false, status: 'Idle' as const };
      }
      return dr;
    });

    setDraftReadings(updatedReadings);

    // Add back the stock to the corresponding target tank since we are unlocking a completed shift
    if (r.status === 'Completed' && setTanks) {
       const grossSold = r.endMeter - r.startMeter;
       const netSold = Math.max(0, grossSold - r.testingQty);
       if (netSold > 0) {
         const targetTankId = r.tankId || (tanks.find(t => t.fuelType === r.fuelType)?.id);
         setTanks(prevTanks => prevTanks.map(tank => {
           if (tank.id === targetTankId || (!r.tankId && tank.fuelType === r.fuelType)) {
             return { ...tank, currentLevel: Math.min(tank.capacity, tank.currentLevel + netSold) };
           }
           return tank;
         }));
       }
    }

    // Persist the unlocked state immediately back to the global state
    let totalFuel = 0;
    let totalNet = 0;
    let totalSales = 0;

    updatedReadings.forEach(dr => {
      const fuel = Math.max(0, dr.endMeter - dr.startMeter);
      const net = Math.max(0, fuel - dr.testingQty);
      totalFuel += fuel;
      totalNet += net;
      totalSales += (net * getPriceForFuelType(dr.fuelType));
    });

    // If we unlock a pump, check if the corresponding pumper was marked as settled.
    // If so, we should remove their settled status since their pump is no longer locked!
    if (r.assignedPumperId && settledPumperIds[r.assignedPumperId]) {
      const nextSettled = { ...settledPumperIds };
      delete nextSettled[r.assignedPumperId];
      setSettledPumperIds(nextSettled);
      localStorage.setItem(`fuelflow_settled_pumpers_${activeShift.id}`, JSON.stringify(nextSettled));
    }

    setActiveShift({
      ...activeShift,
      pumpReadings: updatedReadings,
      totalFuelSold: totalFuel,
      totalNetSold: totalNet,
      totalNetSales: totalSales
    });

    setLockedStartMeters(prev => { const next = { ...prev }; delete next[pumpId]; return next; });
    setLockedEndMeters(prev => { const next = { ...prev }; delete next[pumpId]; return next; });
    setToastMessage(`${r.pumpName} unlocked. Start Meter and Pumper can now be adjusted.`);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Close shift and lock a single pump's readings permanently, marking it Completed
  const handleClosePumpShift = (pumpId: string) => {
    if (!activeShift) return;
    const r = draftReadings.find(dr => dr.pumpId === pumpId);
    if (!r) return;

    const isOilBay = r.pumpId === 'pump-oil-bay' || r.fuelType === 'Oil & Lubricants' || r.pumpName.toLowerCase().includes('oil');

    const errors: string[] = [];
    if (!isOilBay) {
      if (r.endMeter === undefined || r.endMeter === null || r.endMeter < 0 || isNaN(r.endMeter)) {
        errors.push("Please enter a valid End Meter reading.");
      } else {
        if (r.endMeter < r.startMeter) {
          errors.push(`End Meter (${r.endMeter} L) cannot be less than Start Meter (${r.startMeter} L).`);
        }
        const gross = r.endMeter - r.startMeter;
        if (r.testingQty < 0) {
          errors.push("Testing Quantity cannot be negative.");
        }
        if (gross < r.testingQty) {
          errors.push(`Testing Quantity (${r.testingQty} L) cannot exceed Gross Liters Sold (${gross.toFixed(2)} L).`);
        }
      }
    } else {
      if ((r.oilSalesAmount ?? 0) < 0) {
        errors.push("Oil & Lubricants sales amount cannot be negative.");
      }
    }

    if (errors.length > 0) {
      setToastMessage(`Validation Error: ${errors[0]}`);
      setTimeout(() => setToastMessage(null), 5000);
      return;
    }

    const updatedReadings = draftReadings.map(dr => {
      if (dr.pumpId === pumpId) {
        const price = getPriceForFuelType(dr.fuelType);
        const fuel = Math.max(0, dr.endMeter - dr.startMeter);
        const net = Math.max(0, fuel - dr.testingQty);
        const grossRev = net * price;
        const creditVal = dr.creditSalesAmount ?? 0;
        const cardVal = dr.cardSalesAmount ?? 0;
        const netExpCash = Math.max(0, grossRev - (creditVal + cardVal));
        const actCash = dr.actualCash ?? 0;
        const pVariance = dr.cashVariance ?? (actCash - netExpCash);

        return { 
          ...dr, 
          isLocked: true, 
          status: 'Completed' as const,
          unitPrice: price,
          creditSalesAmount: creditVal,
          cardSalesAmount: cardVal,
          actualCash: actCash,
          cashVariance: pVariance
        };
      }
      return dr;
    });

    setDraftReadings(updatedReadings);

    // Deduct stock from the corresponding tank immediately
    const grossSold = r.endMeter - r.startMeter;
    const netSold = Math.max(0, grossSold - r.testingQty);
    
    if (setTanks && netSold > 0) {
      const targetTankId = r.tankId || (tanks.find(t => t.fuelType === r.fuelType)?.id);
      setTanks(prevTanks => prevTanks.map(tank => {
        if (tank.id === targetTankId || (!r.tankId && tank.fuelType === r.fuelType)) {
          const newLevel = Math.max(0, tank.currentLevel - netSold);
          // Show low stock warning if dropped below 15%
          if (newLevel <= tank.capacity * 0.15) {
            setTimeout(() => {
              setToastMessage(`⚠️ Warning: ${tank.name} stock is running low (${newLevel.toFixed(0)} L remaining).`);
              setTimeout(() => setToastMessage(null), 5000);
            }, 3000);
          }
          return { ...tank, currentLevel: newLevel };
        }
        return tank;
      }));
    }

    // Persist immediately in the global activeShift state so no progress is lost
    let totalFuel = 0;
    let totalNet = 0;
    let totalSales = 0;

    updatedReadings.forEach(dr => {
      const fuel = Math.max(0, dr.endMeter - dr.startMeter);
      const net = Math.max(0, fuel - dr.testingQty);
      totalFuel += fuel;
      totalNet += net;
      totalSales += (net * getPriceForFuelType(dr.fuelType));
    });

    setActiveShift({
      ...activeShift,
      pumpReadings: updatedReadings,
      totalFuelSold: totalFuel,
      totalNetSold: totalNet,
      totalNetSales: totalSales
    });

    setLockedStartMeters(prev => ({ ...prev, [pumpId]: true }));
    setLockedEndMeters(prev => ({ ...prev, [pumpId]: true }));
    setToastMessage(`${r.pumpName} shift successfully completed and locked!`);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Toggle cash settled status for an active pumper
  const handleToggleSettlePumper = (pumperId: string) => {
    if (!activeShift) return;
    const next = { ...settledPumperIds, [pumperId]: !settledPumperIds[pumperId] };
    setSettledPumperIds(next);
    localStorage.setItem(`fuelflow_settled_pumpers_${activeShift.id}`, JSON.stringify(next));
    
    const pumperName = employees.find(e => e.id === pumperId)?.name || 'Pumper';
    if (next[pumperId]) {
      setToastMessage(`Cash collection for ${pumperName} successfully verified and settled.`);
    } else {
      setToastMessage(`Settle status cleared for ${pumperName}.`);
    }
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Handle Pump Assignment to Pumper
  const handleAssignPumpToPumper = (pumpId: string, pumperId: string | null) => {
    if (!activeShift) return;

    const updatedReadings = draftReadings.map(r => {
      if (r.pumpId === pumpId) {
        return {
          ...r,
          assignedPumperId: pumperId
        };
      }
      return r;
    });

    setDraftReadings(updatedReadings);

    if (pumperId && !selectedActivePumperIds.includes(pumperId)) {
      setSelectedActivePumperIds(prev => [...prev, pumperId]);
    }

    let totalFuel = 0;
    let totalNet = 0;
    let totalSales = 0;

    updatedReadings.forEach(dr => {
      const fuel = Math.max(0, dr.endMeter - dr.startMeter);
      const net = Math.max(0, fuel - dr.testingQty);
      totalFuel += fuel;
      totalNet += net;
      totalSales += (net * getPriceForFuelType(dr.fuelType));
    });

    setActiveShift({
      ...activeShift,
      pumpReadings: updatedReadings,
      totalFuelSold: totalFuel,
      totalNetSold: totalNet,
      totalNetSales: totalSales
    });

    const pumperObj = employees.find(e => e.id === pumperId);
    const pumpObj = draftReadings.find(r => r.pumpId === pumpId);
    if (pumperId && pumperObj && pumpObj) {
      setToastMessage(`Assigned ${pumpObj.pumpName} to ${pumperObj.name}`);
    } else if (pumpObj) {
      setToastMessage(`Unassigned ${pumpObj.pumpName}`);
    }
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleTogglePumperPumpAssignment = (pumperId: string, pumpId: string) => {
    const reading = draftReadings.find(r => r.pumpId === pumpId);
    if (!reading) return;

    if (reading.assignedPumperId === pumperId) {
      handleAssignPumpToPumper(pumpId, null);
    } else {
      handleAssignPumpToPumper(pumpId, pumperId);
    }
  };

  // Derive Unassigned Pumps
  const unassignedReadings = useMemo(() => {
    if (!activeShift || draftReadings.length === 0) return [];
    const query = searchQuery.trim().toLowerCase();

    return draftReadings.filter(r => {
      if (r.assignedPumperId) return false;
      if (!query) return true;
      return (
        r.pumpName.toLowerCase().includes(query) ||
        r.fuelType.toLowerCase().includes(query)
      );
    });
  }, [activeShift, draftReadings, searchQuery]);

  // Sync active pumper IDs from draft readings
  React.useEffect(() => {
    if (activeShift && draftReadings.length > 0) {
      const activePumperIds = Array.from(new Set(
        draftReadings
          .map(r => r.assignedPumperId)
          .filter((id): id is string => !!id)
      ));
      setSelectedActivePumperIds(prev => {
        const next = Array.from(new Set([...prev, ...activePumperIds]));
        if (next.length === prev.length && next.every(id => prev.includes(id))) {
          return prev;
        }
        return next;
      });
    }
  }, [activeShift?.id, draftReadings]);

  // Derive Pumper Cards Data
  const pumperCardsData = useMemo(() => {
    const pumperIdsSet = new Set<string>();

    draftReadings.forEach(r => {
      if (r.assignedPumperId) pumperIdsSet.add(r.assignedPumperId);
    });

    selectedActivePumperIds.forEach(id => pumperIdsSet.add(id));

    const pumperList = Array.from(pumperIdsSet);
    const query = searchQuery.trim().toLowerCase();

    return pumperList.map(pumperId => {
      const emp = employees.find(e => e.id === pumperId);
      const assignedReadings = draftReadings.filter(r => r.assignedPumperId === pumperId);

      let totalGrossRevenue = 0;
      let totalFuelRevenue = 0;
      let totalOilSales = 0;
      let totalNetLiters = 0;
      let totalCreditSales = 0;
      let totalCardSales = 0;
      let totalActualCash = 0;

      assignedReadings.forEach(r => {
        const fuelPrice = getPriceForFuelType(r.fuelType);
        const isOilBay = r.pumpId === 'pump-oil-bay' || r.fuelType === 'Oil & Lubricants' || r.pumpName?.toLowerCase().includes('dispenser') || r.pumpName?.toLowerCase().includes('oil');
        const fuelSold = isOilBay ? 0 : Math.max(0, r.endMeter - r.startMeter);
        const netSold = isOilBay ? 0 : Math.max(0, fuelSold - r.testingQty);
        const grossFuelRev = netSold * fuelPrice;
        const oilSales = r.oilSalesAmount || 0;
        const grossTotalRev = grossFuelRev + oilSales;
        const creditVal = r.creditSalesAmount || 0;
        const cardVal = r.cardSalesAmount || 0;
        const actCash = r.actualCash || 0;

        totalFuelRevenue += grossFuelRev;
        totalOilSales += oilSales;
        totalGrossRevenue += grossTotalRev;
        totalNetLiters += netSold;
        totalCreditSales += creditVal;
        totalCardSales += cardVal;
        totalActualCash += actCash;
      });

      const totalNonCash = totalCreditSales + totalCardSales;
      const totalExpectedCash = Math.max(0, totalGrossRevenue - totalNonCash);
      const cashVariance = totalActualCash - totalExpectedCash;

      return {
        pumperId,
        pumperName: emp?.name || 'Unassigned Pumper',
        avatarColor: emp?.avatarColor || 'bg-blue-600',
        assignedReadings,
        totalNetLiters,
        totalGrossRevenue,
        totalNonCash,
        totalCreditSales,
        totalCardSales,
        totalExpectedCash,
        totalActualCash,
        cashVariance
      };
    }).filter(p => {
      if (!query) return true;
      const matchPumper = p.pumperName.toLowerCase().includes(query);
      const matchPumps = p.assignedReadings.some(r =>
        r.pumpName.toLowerCase().includes(query) || r.fuelType.toLowerCase().includes(query)
      );
      return matchPumper || matchPumps;
    });
  }, [draftReadings, selectedActivePumperIds, employees, tanks, searchQuery]);

  // Filtered readings based on search and local draftReadings state
  const filteredReadings = useMemo(() => {
    if (!activeShift) return [];
    if (!draftReadings || draftReadings.length === 0) return [];

    const query = searchQuery.trim().toLowerCase();
    if (!query) return draftReadings;

    return draftReadings.filter(r => {
      const pumperName = r.assignedPumperId 
        ? employees.find(e => e.id === r.assignedPumperId)?.name || '' 
        : 'Unassigned';
      
      return (
        r.pumpName.toLowerCase().includes(query) ||
        r.fuelType.toLowerCase().includes(query) ||
        pumperName.toLowerCase().includes(query)
      );
    });
  }, [activeShift, draftReadings, searchQuery, employees]);

  // Handle opening shift submission
  const handleStartNewShiftSubmit = () => {
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randSuffix = Math.floor(10 + Math.random() * 90);
    const newShiftId = `SH-${dateStr}-${randSuffix}`;

    const pumpsListRaw = pumps || [];
    const pumpsList = pumpsListRaw.some(p => p.id === 'pump-oil-bay')
      ? pumpsListRaw
      : [...pumpsListRaw, { id: 'pump-oil-bay', name: 'Forecourt Dispenser Station (4-Chamber Unit)', fuelType: 'Oil & Lubricants' as FuelType, tankId: '', status: 'Active' }];

    const newPumpReadings: PumpReading[] = pumpsList.map((pump) => {
      const isOil = pump.id === 'pump-oil-bay' || pump.fuelType === 'Oil & Lubricants' || pump.name.toLowerCase().includes('dispenser') || pump.name.toLowerCase().includes('oil');
      // Automatically fetch previous shift's recorded endmeter for each pump
      const carryForwardStart = getPreviousEndMeterForPump(pump.id);

      return {
        pumpId: pump.id,
        pumpName: isOil ? 'Forecourt Dispenser Station (4-Chamber Unit)' : pump.name,
        fuelType: pump.fuelType,
        tankId: pump.tankId,
        assignedPumperId: null, // start as unassigned
        startMeter: carryForwardStart,
        endMeter: 0, // initially 0 until manually entered
        testingQty: 0,
        status: 'Idle',
        chamberReadings: isOil ? getDefaultChambers(oilTanks) : undefined
      };
    });

    const combinedShiftName = 'Full Day Shift (08:00 AM - 08:00 AM)';

    const now = new Date();
    const datePart = now.toISOString().slice(0, 10);
    const fullISOStart = `${datePart}T08:00:00`;

    onStartShift({
      id: newShiftId,
      name: combinedShiftName,
      supervisorId: newSupervisorId,
      startTime: fullISOStart,
      isActive: true,
      pumpReadings: newPumpReadings
    });

    setIsStartShiftOpen(false);
  };

  // Perform validation check and open closing modal
  const handleEndShiftClick = () => {
    if (!activeShift) return;

    const errors: string[] = [];

    // Ensure Supervisor is assigned
    if (!draftSupervisorId) {
      errors.push("A Station Supervisor must be assigned to the shift.");
    }

    // Ensure Shift Name is set
    if (!draftShiftName.trim()) {
      errors.push("Shift Name / Label cannot be empty.");
    }

    // Validate that all active pumps (assigned to a pumper) are saved / completed
    draftReadings.forEach(r => {
      if (r.assignedPumperId) {
        const isSaved = r.status === 'Completed' || r.isLocked || !!savedPumperCards[r.assignedPumperId] || !!savedPumperIds[r.assignedPumperId];
        if (!isSaved) {
          const pumperName = employees.find(e => e.id === r.assignedPumperId)?.name || 'Pumper';
          errors.push(`${r.pumpName}: Please click 'Save Pumper Readings' for ${pumperName} first.`);
        }
      }
    });

    if (errors.length > 0) {
      setValidationErrors(errors);
      setShowValidationOverlay(true);
    } else {
      setValidationErrors([]);
      setShowValidationOverlay(false);
      setIsCloseConfirmOpen(true);
    }
  };

  // Close shift permanently and lock ledger
  const handleConfirmCloseShift = () => {
    if (!activeShift) return;
    
    let totalFuel = 0;
    let totalNet = 0;
    let totalSales = 0;
    let totalPumpsActualCash = 0;

    const finalReadings = draftReadings.map(r => {
      const fuel = Math.max(0, r.endMeter - r.startMeter);
      const net = Math.max(0, fuel - r.testingQty);
      const price = getPriceForFuelType(r.fuelType);
      const grossFuelRev = net * price;
      const oilSales = r.oilSalesAmount ?? 0;
      const totalGrossRev = grossFuelRev + oilSales;
      const creditVal = r.creditSalesAmount ?? 0;
      const cardVal = r.cardSalesAmount ?? 0;
      const netExpCash = Math.max(0, totalGrossRev - (creditVal + cardVal));
      const actCash = r.actualCash ?? 0;
      const pVariance = r.cashVariance ?? (actCash - netExpCash);

      totalFuel += fuel;
      totalNet += net;
      totalSales += totalGrossRev;
      totalPumpsActualCash += actCash;
      
      return {
        ...r,
        status: 'Completed' as const,
        unitPrice: r.unitPrice || price,
        oilSalesAmount: oilSales,
        creditSalesAmount: creditVal,
        cardSalesAmount: cardVal,
        actualCash: actCash,
        cashVariance: pVariance
      };
    });

    const initCash = Number(initialPumperCash) || 0;
    const replCash = Number(replacementPumperCash) || 0;
    const physCash = totalPumpsActualCash > 0 ? totalPumpsActualCash : (initCash + replCash);
    const variance = physCash - totalSales;

    const closedShift: Shift = {
      ...activeShift,
      supervisorId: draftSupervisorId,
      name: draftShiftName,
      startTime: draftStartTime,
      isActive: false,
      endTime: new Date().toISOString(),
      pumpReadings: finalReadings,
      totalFuelSold: totalFuel,
      totalNetSold: totalNet,
      totalNetSales: totalSales,
      initialPumperCash: initCash,
      replacementPumperCash: replCash,
      totalPhysicalCash: physCash,
      cashVariance: variance,
      handoverNotes: handoverNotes,
      replacementPumperId: replacementPumperId
    };

    syncCreditAndCardSales(supabase, finalReadings, closedShift.id);

    onCloseShift(closedShift);
    setIsCloseConfirmOpen(false);
    setToastMessage('✓ Shift Closed Successfully');

    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  // Export current shift to CSV
  const exportShiftReport = () => {
    if (!activeShift) return;
    
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += `FuelFlow Shift Report - ${activeShift.id}\n`;
    csvContent += `Shift Name,${activeShift.name}\n`;
    csvContent += `Supervisor,${activeSupervisor?.name || 'N/A'}\n`;
    csvContent += `Started At,${new Date(activeShift.startTime).toLocaleString()}\n\n`;
    csvContent += "Pump,Fuel Type,Assigned Pumper,Start Meter (L),End Meter (L),Fuel Sold (L),Testing Deducted (L),Net Sold (L),Fuel Price (Per Liter),Fuel Revenue,Oil/Lube Sales,Total Revenue,Credit Sales,Card Sales,Actual Cash\n";

    activeShift.pumpReadings.forEach(r => {
      const pumperName = r.assignedPumperId 
        ? employees.find(e => e.id === r.assignedPumperId)?.name || 'N/A' 
        : 'Unassigned';
      const sold = Math.max(0, r.endMeter - r.startMeter);
      const net = Math.max(0, r.endMeter - r.startMeter - r.testingQty);
      const price = getPriceForFuelType(r.fuelType);
      const fuelRev = net * price;
      const oilRev = r.oilSalesAmount || 0;
      const totalRev = fuelRev + oilRev;
      const creditVal = r.creditSalesAmount || 0;
      const cardVal = r.cardSalesAmount || 0;
      const actCash = r.actualCash || 0;

      csvContent += `"${r.pumpName}","${r.fuelType}","${pumperName}",${r.startMeter},${r.endMeter},${sold},${r.testingQty},${net},${price},${fuelRev.toFixed(2)},${oilRev.toFixed(2)},${totalRev.toFixed(2)},${creditVal.toFixed(2)},${cardVal.toFixed(2)},${actCash.toFixed(2)}\n`;
    });

    csvContent += `\nTOTALS,,, , ,${stats.totalFuelSold.toFixed(2)}, ,${stats.totalNetSold.toFixed(2)}, ,${stats.totalNetSales.toFixed(2)}\n`;

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `FuelFlow_Report_${activeShift.id}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div id="shift-tab-root" className="space-y-4">
      
      {/* Control Header */}
      <div id="shift-header-section" className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 id="shift-title" className="text-lg font-bold text-slate-900 tracking-tight font-sans">
            Shift Management
          </h1>
          <p id="shift-subtitle" className="text-gray-500 text-xs sm:text-sm mt-0.5">
            Real-time digital ledger and active station control center
          </p>
        </div>

        {activeShift ? (
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <button
              id="btn-close-shift"
              onClick={handleEndShiftClick}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-red-600 to-red-500 hover:brightness-110 text-white font-bold text-xs sm:text-sm rounded-xl transition-all shadow-md cursor-pointer"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>Close Shift</span>
            </button>
          </div>
        ) : (
          <button
            id="btn-start-shift"
            onClick={() => setIsStartShiftOpen(true)}
            className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-500 text-white font-bold text-sm rounded-xl hover:brightness-110 transition-all shadow-md cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Open New Shift</span>
          </button>
        )}
      </div>

      {activeShift ? (
        <>
          {/* Active Summary Running Totals */}
          <div id="shift-summary-grid" className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Total Sales Large Bento */}
            <div className="bg-[#E8F1F5] p-6 rounded-2xl border border-[#D0E2EB] text-[#1C1C1C] shadow-sm flex flex-col justify-between font-sans">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 block">
                  Total Expected Cash Revenue
                </span>
                <span className="text-4xl tabular-nums font-extrabold mt-3 block tracking-tight">
                  {formatCurrency(stats.totalNetSales)}
                </span>
              </div>
              <div className="mt-6 pt-4 border-t border-gray-200 flex items-center justify-between text-xs text-gray-500">
                <span>Active Shift ID: <strong className="text-[#1C1C1C] tabular-nums font-semibold">{activeShift.id}</strong></span>
                <span className="bg-white px-2 py-0.5 rounded-lg text-[10px] font-semibold text-blue-600 animate-pulse uppercase border border-blue-100 shadow-sm">
                  Live Syncing
                </span>
              </div>
            </div>

            {/* Liters Sold Categorized by Fuel Type */}
            <div className="glass-panel p-5 rounded-2xl lg:col-span-2 flex flex-col justify-between font-sans">
              <div>
                <span className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-3">
                  Total Liters Sold (By Fuel Type)
                </span>
                
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {/* Petrol 92 */}
                  <div className="p-3 bg-blue-500/10 rounded-xl border border-blue-500/20">
                    <span className="text-[10px] font-bold text-blue-600 uppercase block">Petrol 92</span>
                    <span className="text-lg tabular-nums font-bold text-[#1C1C1C] mt-1 block">
                      {formatLiters(fuelTypeTotals['Petrol 92'].net)}
                    </span>
                    <span className="text-[10px] text-gray-500 tabular-nums mt-0.5 block">
                      {formatCurrency(fuelTypeTotals['Petrol 92'].sales)}
                    </span>
                  </div>

                  {/* Petrol 95 */}
                  <div className="p-3 bg-purple-500/10 rounded-xl border border-purple-500/20">
                    <span className="text-[10px] font-bold text-purple-400 uppercase block">Petrol 95</span>
                    <span className="text-lg tabular-nums font-bold text-[#1C1C1C] mt-1 block">
                      {formatLiters(fuelTypeTotals['Petrol 95'].net)}
                    </span>
                    <span className="text-[10px] text-gray-500 tabular-nums mt-0.5 block">
                      {formatCurrency(fuelTypeTotals['Petrol 95'].sales)}
                    </span>
                  </div>

                  {/* Auto Diesel */}
                  <div className="p-3 bg-amber-500/10 rounded-xl border border-amber-500/20">
                    <span className="text-[10px] font-bold text-amber-400 uppercase block">Auto Diesel</span>
                    <span className="text-lg tabular-nums font-bold text-[#1C1C1C] mt-1 block">
                      {formatLiters(fuelTypeTotals['Auto Diesel'].net)}
                    </span>
                    <span className="text-[10px] text-gray-500 tabular-nums mt-0.5 block">
                      {formatCurrency(fuelTypeTotals['Auto Diesel'].sales)}
                    </span>
                  </div>

                  {/* Super Diesel */}
                  <div className="p-3 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
                    <span className="text-[10px] font-bold text-emerald-400 uppercase block">Super Diesel</span>
                    <span className="text-lg tabular-nums font-bold text-[#1C1C1C] mt-1 block">
                      {formatLiters(fuelTypeTotals['Super Diesel'].net)}
                    </span>
                    <span className="text-[10px] text-gray-500 tabular-nums mt-0.5 block">
                      {formatCurrency(fuelTypeTotals['Super Diesel'].sales)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500 font-sans">
                <span className="flex items-center gap-1">
                  <Fuel className="w-3.5 h-3.5 text-blue-500" />
                  <span>Total Net Liters Sold: <strong className="text-[#1C1C1C] tabular-nums">{formatLiters(stats.totalNetSold)}</strong></span>
                </span>
                <span>Active Pumps: <strong className="text-[#1C1C1C] tabular-nums">{stats.runningPumps} of {activeShift.pumpReadings.length}</strong></span>
              </div>
            </div>
          </div>

          {/* Active Shift Details Banner (Ultra-Compact Single-Line Toolbar Strip) */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-slate-100/90 border border-slate-200/80 rounded-lg shadow-sm mb-4 font-sans">
            {/* Left Side: Small Supervisor static badge/chip with avatar pill */}
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider shrink-0">
                SUPERVISOR:
              </span>
              <div className="flex items-center gap-1.5 bg-white border border-slate-200/90 px-2.5 py-1 rounded-md shadow-2xs">
                <div className={`w-5 h-5 rounded-full ${
                  employees.find(e => e.id === draftSupervisorId)?.avatarColor || 'bg-blue-600'
                } text-white flex items-center justify-center font-bold text-[9px] shrink-0`}>
                  {employees.find(e => e.id === draftSupervisorId)?.name.split(' ').map(n => n[0]).join('') || 'SV'}
                </div>
                <span className="text-xs font-bold text-slate-800">
                  {employees.find(e => e.id === draftSupervisorId)?.name || 'Supervisor'}
                </span>
              </div>
            </div>

            {/* Center/Right: "Full Day Shift (08:00 AM - 08:00 AM)" & Start Date inline as subtle muted text chips */}
            <div className="flex items-center gap-2 flex-wrap text-xs text-slate-600 font-medium">
              <div className="flex items-center gap-1.5 bg-white/80 border border-slate-200/70 px-2.5 py-1 rounded-md">
                <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="font-semibold text-slate-700">Full Day Shift (08:00 AM - 08:00 AM)</span>
              </div>
              {draftStartTime && (
                <div className="flex items-center gap-1.5 bg-white/80 border border-slate-200/70 px-2.5 py-1 rounded-md">
                  <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span className="tabular-nums font-semibold text-slate-700">
                    {new Date(draftStartTime).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} {new Date(draftStartTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              )}
            </div>

            {/* Far Right: Minimal active pulse badge */}
            <div className="px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-800 text-[10px] font-extrabold uppercase tracking-wider rounded-md flex items-center gap-1.5 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" />
              <span>ACTIVE SHIFT</span>
            </div>
          </div>

          {/* INLINE LEDGER & PUMPER-CENTRIC MANAGEMENT */}
          <div className="space-y-4">
            {/* Top Toolbar */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h3 className="text-lg font-extrabold text-[#1C1C1C] tracking-tight">Active Shift Pumper Assignments</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Assign pumps, enter meter readings, record non-cash sales, and reconcile cash per pumper.
                </p>
              </div>

              <div className="flex items-center gap-2.5 w-full sm:w-auto">
                <div className="relative flex-1 sm:w-60">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    type="text"
                    placeholder="Search pumper or pump..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 bg-white border border-gray-200 rounded-xl text-[#1C1C1C] text-xs font-medium focus:outline-none focus:border-blue-500 transition-colors"
                  />
                </div>

                {/* Add Pumper Button */}
                <div className="relative">
                  <button
                    onClick={() => setIsAddPumperModalOpen(!isAddPumperModalOpen)}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-2xs flex items-center gap-1.5 cursor-pointer shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Pumper</span>
                  </button>

                  {/* Add Pumper Dropdown Menu (ONLY showing Pumpers) */}
                  {isAddPumperModalOpen && (
                    <div className="absolute right-0 mt-2 w-56 bg-white rounded-2xl shadow-xl border border-gray-200 p-2 z-30 space-y-1 animate-in fade-in zoom-in-95">
                      <div className="px-2 py-1.5 border-b border-gray-100 flex items-center justify-between">
                        <span className="text-[11px] font-extrabold text-gray-700 uppercase tracking-wider">
                          Select Available Pumper
                        </span>
                        <button
                          onClick={() => setIsAddPumperModalOpen(false)}
                          className="text-gray-400 hover:text-gray-600 p-0.5 cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="max-h-48 overflow-y-auto space-y-0.5">
                        {pumpers.map(emp => {
                          const isAlreadyActive = selectedActivePumperIds.includes(emp.id);
                          return (
                            <button
                              key={`add-pumper-opt-${emp.id}`}
                              disabled={isAlreadyActive}
                              onClick={() => {
                                if (!selectedActivePumperIds.includes(emp.id)) {
                                  setSelectedActivePumperIds(prev => [...prev, emp.id]);
                                }
                                setIsAddPumperModalOpen(false);
                                setToastMessage(`Added ${emp.name} to active pumper cards.`);
                                setTimeout(() => setToastMessage(null), 2500);
                              }}
                              className={`w-full text-left px-2.5 py-1.5 rounded-xl text-xs flex items-center justify-between transition-colors ${
                                isAlreadyActive
                                  ? 'opacity-50 bg-gray-50 cursor-not-allowed text-gray-400'
                                  : 'hover:bg-blue-50 text-gray-800 font-semibold cursor-pointer'
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <div className={`w-5 h-5 rounded-md text-white font-bold text-[10px] flex items-center justify-center ${emp.avatarColor || 'bg-blue-600'}`}>
                                  {emp.name.charAt(0)}
                                </div>
                                <span>{emp.name}</span>
                              </div>
                              {isAlreadyActive && <span className="text-[10px] font-bold text-gray-400">Added</span>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* PUMPER-CENTRIC CARDS GRID */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {pumperCardsData.length > 0 ? (
                pumperCardsData.map(p => {
                  const pumperId = p.pumperId;
                  const pumperName = p.pumperName;
                  const assignedReadings = p.assignedReadings;
                  const isPumperFinalized = !!finalizedPumperCards[pumperId] || (assignedReadings.length > 0 && assignedReadings.every(r => !!r.isCardFinalized));
                  const isPumperStartSaved = assignedReadings.length > 0 && assignedReadings.every(r => !!r.isStartSaved || !!lockedStartMeters[r.pumpId]);

                  return (
                    <div
                      key={`pumper-card-${pumperId}`}
                      className={`glass-panel p-4 rounded-xl space-y-3 border transition-all shadow-2xs flex flex-col justify-between ${
                        isPumperFinalized
                          ? 'border-emerald-200 bg-emerald-50/20'
                          : isPumperStartSaved
                          ? 'border-blue-200 bg-blue-50/10'
                          : 'border-gray-200/90 hover:border-blue-300'
                      }`}
                    >
                      <div className="space-y-3">
                        {/* Pumper Card Header */}
                        <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-gray-100">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className={`w-8 h-8 rounded-lg text-white font-bold text-xs flex items-center justify-center shadow-2xs shrink-0 ${p.avatarColor}`}>
                              {pumperName.split(' ').map(n => n[0]).join('')}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <h3 className="font-extrabold text-[#1C1C1C] text-sm truncate">{pumperName}</h3>
                                <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 border border-blue-100 text-[9px] font-extrabold uppercase rounded shrink-0">
                                  Pumper
                                </span>
                                {isPumperFinalized ? (
                                  <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-800 border border-emerald-300 text-[9px] font-extrabold uppercase rounded shrink-0 flex items-center gap-0.5">
                                    <Lock className="w-2.5 h-2.5" /> Reconciled
                                  </span>
                                ) : isPumperStartSaved ? (
                                  <span className="px-1.5 py-0.5 bg-blue-100 text-blue-800 border border-blue-300 text-[9px] font-extrabold uppercase rounded shrink-0 flex items-center gap-0.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-pulse" /> Active
                                  </span>
                                ) : (
                                  <span className="px-1.5 py-0.5 bg-amber-100 text-amber-800 border border-amber-300 text-[9px] font-extrabold uppercase rounded shrink-0">
                                    Pending Start
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-gray-500 font-medium truncate">
                                {assignedReadings.length} {assignedReadings.length === 1 ? 'Pump Assigned' : 'Pumps Assigned'}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {/* Dropdown Pump Assignment Menu */}
                            {!isPumperFinalized && (
                              <div className="relative">
                                <button
                                  onClick={() => setOpenPumpSelectorPumperId(openPumpSelectorPumperId === pumperId ? null : pumperId)}
                                  className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 text-xs font-bold rounded-lg flex items-center gap-1 transition-all cursor-pointer shadow-2xs"
                                >
                                  <Fuel className="w-3.5 h-3.5" />
                                  <span>Assign Pumps</span>
                                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${openPumpSelectorPumperId === pumperId ? 'rotate-180' : ''}`} />
                                </button>

                                {/* Dropdown Checklist */}
                                {openPumpSelectorPumperId === pumperId && (
                                  <div className="absolute right-0 mt-1.5 w-64 bg-white rounded-xl shadow-xl border border-gray-200 p-2.5 z-30 space-y-2 animate-in fade-in zoom-in-95">
                                    <div className="flex items-center justify-between pb-1.5 border-b border-gray-100">
                                      <span className="text-[11px] font-extrabold text-gray-800 uppercase tracking-wider">
                                        Assign Pumps: {pumperName.split(' ')[0]}
                                      </span>
                                      <button
                                        onClick={() => setOpenPumpSelectorPumperId(null)}
                                        className="text-gray-400 hover:text-gray-600 p-0.5 cursor-pointer"
                                      >
                                        <X className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                    <div className="max-h-56 overflow-y-auto space-y-1 pr-0.5">
                                      {draftReadings.map(pumpR => {
                                        const isAssignedToThis = pumpR.assignedPumperId === pumperId;
                                        const isAssignedToOther = pumpR.assignedPumperId && pumpR.assignedPumperId !== pumperId;
                                        const otherPumperName = isAssignedToOther ? employees.find(e => e.id === pumpR.assignedPumperId)?.name : null;

                                        return (
                                          <label
                                            key={`popover-pump-${pumpR.pumpId}`}
                                            className={`flex items-center justify-between p-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
                                              isAssignedToThis ? 'bg-blue-50 border border-blue-200 font-bold' : 'hover:bg-gray-50 border border-transparent'
                                            }`}
                                          >
                                            <div className="flex items-center gap-2 min-w-0">
                                              <input
                                                type="checkbox"
                                                checked={isAssignedToThis}
                                                onChange={() => handleTogglePumperPumpAssignment(pumperId, pumpR.pumpId)}
                                                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 w-3.5 h-3.5 cursor-pointer shrink-0"
                                              />
                                              <div className="min-w-0">
                                                <span className="font-extrabold text-gray-900 block truncate">{pumpR.pumpName}</span>
                                                <span className="text-[10px] text-gray-500 block truncate">{pumpR.fuelType}</span>
                                              </div>
                                            </div>
                                            {isAssignedToOther && (
                                              <span className="text-[9px] text-amber-600 font-semibold px-1.5 py-0.5 bg-amber-50 rounded shrink-0">
                                                {otherPumperName?.split(' ')[0]}
                                              </span>
                                            )}
                                          </label>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Assigned Pumps Meter Entry Cards */}
                        <div className="space-y-1">
                          {assignedReadings.length === 0 ? (
                            <div className="p-3 bg-gray-50/80 rounded-xl text-center text-xs text-gray-500 italic border border-dashed border-gray-200 space-y-1">
                              <p>No pumps assigned to {pumperName} yet.</p>
                              <p className="text-[11px] text-gray-400">
                                Click <strong>"Assign Pumps"</strong> above to select pumps for {pumperName}.
                              </p>
                            </div>
                          ) : (
                            assignedReadings.map((r, pumpIndex) => {
                              const isOilBay = r.pumpId === 'pump-oil-bay' || r.fuelType === 'Oil & Lubricants' || r.pumpName.toLowerCase().includes('oil');
                              const fuelPrice = getPriceForFuelType(r.fuelType);
                              const fuelSold = isOilBay ? 0 : Math.max(0, r.endMeter - r.startMeter);
                              const netSold = isOilBay ? 0 : Math.max(0, fuelSold - r.testingQty);
                              const fuelRevenue = netSold * fuelPrice;
                              const oilRevenue = r.oilSalesAmount || 0;
                              const totalPumpGross = fuelRevenue + oilRevenue;
                              const creditSales = r.creditSalesAmount || 0;
                              const cardSales = r.cardSalesAmount || 0;
                              const rawPumpExpCash = totalPumpGross - (creditSales + cardSales);

                              // Calculate if other pumps assigned to this pumper have excess revenue to offset non-cash deductions
                              const otherPumpsExcess = assignedReadings
                                .filter(other => other.pumpId !== r.pumpId)
                                .reduce((sum, other) => {
                                  const oPrice = getPriceForFuelType(other.fuelType);
                                  const oIsOil = other.pumpId === 'pump-oil-bay' || other.fuelType === 'Oil & Lubricants' || other.pumpName.toLowerCase().includes('oil');
                                  const oFuelSold = oIsOil ? 0 : Math.max(0, other.endMeter - other.startMeter);
                                  const oNetSold = oIsOil ? 0 : Math.max(0, oFuelSold - other.testingQty);
                                  const oGross = (oNetSold * oPrice) + (other.oilSalesAmount || 0);
                                  const oNonCash = (other.creditSalesAmount || 0) + (other.cardSalesAmount || 0);
                                  return sum + Math.max(0, oGross - oNonCash);
                                }, 0);

                              // Do not clip individual pump expected cash to zero prematurely if another pump in the same pumper's shift has excess revenue to offset non-cash deductions
                              const pumpExpCash = rawPumpExpCash < 0
                                ? (otherPumpsExcess > 0 ? rawPumpExpCash : 0)
                                : rawPumpExpCash;

                              const fuelBadge = getFuelBadgeStyles(r.fuelType);

                              return (
                                <React.Fragment key={`assigned-pump-frag-${r.pumpId}`}>
                                  {/* Visual Divider Between Multiple Pumps */}
                                  {pumpIndex > 0 && (
                                    <div className="relative py-1.5 flex items-center justify-center">
                                      <div className="w-full border-t border-dashed border-slate-300" />
                                      <span className="absolute px-2 bg-white text-[9px] font-extrabold uppercase text-slate-400 tracking-wider">
                                        Next Pump
                                      </span>
                                    </div>
                                  )}

                                  {/* Distinct Inner Pump Card Container */}
                                  <div
                                    key={`assigned-pump-${r.pumpId}`}
                                    className="bg-slate-50/90 border border-slate-200 rounded-xl p-3.5 mb-3 shadow-xs space-y-3 transition-all hover:border-slate-300"
                                  >
                                    {/* Pump Row Header with Prominent Fuel-Specific Badge */}
                                    <div className="flex items-center justify-between pb-2 border-b border-slate-200/80 gap-2">
                                      <div className="flex items-center gap-2 flex-wrap min-w-0">
                                        <div className={`px-2.5 py-1 rounded-lg border text-[11px] font-extrabold flex items-center gap-1.5 shadow-2xs ${fuelBadge.badge}`}>
                                          <Droplet className="w-3 h-3 shrink-0" />
                                          <span className="truncate">{r.pumpName.toUpperCase()} • {r.fuelType}</span>
                                        </div>
                                        {!isOilBay && (
                                          <span className="text-[11px] text-slate-500 tabular-nums font-bold ">
                                            (Rs. {fuelPrice.toFixed(2)}/L)
                                          </span>
                                        )}
                                      </div>
                                      <div className="flex items-center gap-1.5 shrink-0">
                                        {!isPumperFinalized && !r.isCardFinalized && (
                                          <button
                                            type="button"
                                            onClick={() => handleOpenHandoverModal(r)}
                                            className="flex items-center gap-1 text-xs bg-amber-500 hover:bg-amber-600 text-white px-2 py-1 rounded transition-colors shadow-2xs font-semibold cursor-pointer"
                                            title="Transfer / Handover Pump to another Pumper"
                                          >
                                            <ArrowRightLeft className="w-3 h-3" />
                                            <span>Handover</span>
                                          </button>
                                        )}
                                        {!isPumperFinalized && (
                                          <button
                                            onClick={() => handleAssignPumpToPumper(r.pumpId, null)}
                                            className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                                            title="Unassign Pump"
                                          >
                                            <X className="w-3.5 h-3.5" />
                                          </button>
                                        )}
                                      </div>
                                    </div>

                                    {/* Meter Inputs */}
                                    {!isOilBay ? (
                                      <div className="grid grid-cols-3 gap-2 text-xs">
                                        <div>
                                          {(() => {
                                            const isStartMeterLocked = !!r.isStartSaved || !!lockedStartMeters[r.pumpId] || isPumperFinalized;
                                            return (
                                              <>
                                                <label className="text-[10px] font-extrabold text-slate-600 mb-0.5 uppercase flex items-center justify-between">
                                                  <span>Start Meter</span>
                                                  {isStartMeterLocked && (
                                                    <span className="flex items-center gap-1">
                                                      <Lock className="w-2.5 h-2.5 text-slate-400 shrink-0" title="Start Meter Locked" />
                                                      {!isPumperFinalized && (
                                                        <button
                                                          type="button"
                                                          onClick={() => {
                                                            const newStarts = { ...lockedStartMeters };
                                                            delete newStarts[r.pumpId];
                                                            setLockedStartMeters(newStarts);
                                                            if (activeShift) {
                                                              saveLocksToStorage(activeShift.id, newStarts, lockedEndMeters, finalizedPumperCards);
                                                            }
                                                            setDraftReadings(prev => prev.map(dr => dr.pumpId === r.pumpId ? { ...dr, isStartSaved: false } : dr));
                                                          }}
                                                          className="text-[9px] text-blue-600 hover:text-blue-800 underline font-normal lowercase cursor-pointer"
                                                          title="Unlock Start Meter"
                                                        >
                                                          unlock
                                                        </button>
                                                      )}
                                                    </span>
                                                  )}
                                                </label>
                                                <input
                                                  type="number"
                                                  step="any"
                                                  value={r.startMeter ?? 0}
                                                  disabled={isStartMeterLocked}
                                                  onFocus={(e) => e.target.select()}
                                                  onChange={(e) => handleUpdateReading(r.pumpId, 'startMeter', parseFloat(e.target.value) || 0)}
                                                  className={`w-full px-2 py-1 border rounded-lg text-xs font-bold text-center tabular-nums transition-colors ${
                                                    isStartMeterLocked
                                                      ? 'bg-slate-100 border-slate-200 text-slate-500 cursor-not-allowed select-none'
                                                      : 'bg-white border-slate-200 text-slate-800 focus:bg-white focus:outline-none focus:border-blue-500'
                                                  }`}
                                                />
                                              </>
                                            );
                                          })()}
                                        </div>
                                        <div>
                                          {(() => {
                                            const isEndMeterLocked = !!r.isCardFinalized || !!lockedEndMeters[r.pumpId] || isPumperFinalized;
                                            return (
                                              <>
                                                <label className="text-[10px] font-extrabold text-slate-600 mb-0.5 uppercase flex items-center justify-between">
                                                  <span>End Meter</span>
                                                  {isEndMeterLocked && (
                                                    <span className="flex items-center gap-1">
                                                      <Lock className="w-2.5 h-2.5 text-slate-400 shrink-0" title="End Meter Locked" />
                                                      {!isPumperFinalized && (
                                                        <button
                                                          type="button"
                                                          onClick={() => {
                                                            const newEnds = { ...lockedEndMeters };
                                                            delete newEnds[r.pumpId];
                                                            setLockedEndMeters(newEnds);
                                                            if (activeShift) {
                                                              saveLocksToStorage(activeShift.id, lockedStartMeters, newEnds, finalizedPumperCards);
                                                            }
                                                            setDraftReadings(prev => prev.map(dr => dr.pumpId === r.pumpId ? { ...dr, isCardFinalized: false } : dr));
                                                          }}
                                                          className="text-[9px] text-blue-600 hover:text-blue-800 underline font-normal lowercase cursor-pointer"
                                                          title="Unlock End Meter"
                                                        >
                                                          unlock
                                                        </button>
                                                      )}
                                                    </span>
                                                  )}
                                                </label>
                                                <input
                                                  type="number"
                                                  step="any"
                                                  value={r.endMeter ?? 0}
                                                  disabled={isEndMeterLocked}
                                                  onFocus={(e) => e.target.select()}
                                                  onChange={(e) => handleUpdateReading(r.pumpId, 'endMeter', parseFloat(e.target.value) || 0)}
                                                  className={`w-full px-2 py-1 border rounded-lg text-xs font-bold text-center tabular-nums transition-colors ${
                                                    isEndMeterLocked
                                                      ? 'bg-slate-100 border-slate-200 text-slate-500 cursor-not-allowed select-none'
                                                      : 'bg-white border-slate-200 text-slate-800 focus:outline-none focus:border-blue-500'
                                                  }`}
                                                />
                                              </>
                                            );
                                          })()}
                                        </div>
                                        <div>
                                          <label className="text-[10px] font-extrabold text-slate-600 block mb-0.5 uppercase">Test (L)</label>
                                          <input
                                            type="number"
                                            step="any"
                                            value={r.testingQty ?? 0}
                                            disabled={isPumperFinalized}
                                            onFocus={(e) => e.target.select()}
                                            onChange={(e) => handleUpdateReading(r.pumpId, 'testingQty', parseFloat(e.target.value) || 0)}
                                            className={`w-full px-2 py-1 border rounded-lg text-xs font-bold text-center tabular-nums transition-colors ${
                                              isPumperFinalized
                                                ? 'bg-slate-100 border-slate-200 text-slate-500 cursor-not-allowed select-none'
                                                : 'bg-white border-slate-200 text-slate-800 focus:outline-none focus:border-blue-500'
                                            }`}
                                          />
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="space-y-2.5 text-xs">
                                        <div className="flex items-center justify-between bg-amber-50/80 px-3 py-1.5 rounded-lg border border-amber-200">
                                          <span className="font-extrabold text-amber-900 flex items-center gap-1.5 text-[11px]">
                                            <Droplet className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                                            <span>4-Chamber Forecourt Bulk Dispenser Reconcile</span>
                                          </span>
                                          <span className="text-[10px] font-bold text-amber-800 bg-amber-100/70 px-2 py-0.5 rounded border border-amber-300">
                                            Forecourt Unit
                                          </span>
                                        </div>

                                        <div className="overflow-x-auto rounded-xl border border-amber-200 bg-white">
                                          <table className="w-full text-left border-collapse text-[11px]">
                                            <thead>
                                              <tr className="bg-amber-50/60 border-b border-amber-200 text-[10px] text-amber-950 uppercase font-black tracking-wider">
                                                <th className="py-2 px-2.5">Chamber & Product</th>
                                                <th className="py-2 px-2 text-right">Opening (L)</th>
                                                <th className="py-2 px-2 text-right">Closing (L)</th>
                                                <th className="py-2 px-2 text-right">Sold (L)</th>
                                                <th className="py-2 px-2.5 text-right">Total (Rs.)</th>
                                              </tr>
                                            </thead>
                                            <tbody className="divide-y divide-amber-100/60">
                                              {(r.chamberReadings && r.chamberReadings.length > 0 ? r.chamberReadings : getDefaultChambers(oilTanks)).map((ch, chIdx) => {
                                                const chamberNum = ch.chamberNumber || chIdx + 1;
                                                const opLiters = ch.openingLevel ?? ch.openingLiters ?? 0;
                                                const clLiters = ch.closingLevel ?? ch.closingLiters ?? 0;
                                                const soldLiters = calculateChamberSoldLiters(opLiters, clLiters);
                                                const rowTotal = soldLiters * (ch.ratePerLiter || 0);
                                                const isChamberOpeningLocked = !!r.isStartSaved || !!lockedStartMeters[r.pumpId] || isPumperFinalized;

                                                return (
                                                  <tr key={ch.chamberId || `chamber-row-${chIdx}`} className="hover:bg-amber-50/40 transition-colors">
                                                    <td className="py-2 px-2.5 font-bold text-slate-800 whitespace-nowrap">
                                                      <div className="flex items-center gap-1.5">
                                                        <span className="inline-block px-1.5 py-0.5 rounded text-[9px] font-black bg-amber-100 text-amber-900 border border-amber-300">
                                                          Ch 0{chamberNum}
                                                        </span>
                                                        <span>{ch.grade}</span>
                                                        <span className="text-[10px] text-gray-500 font-medium">({formatCurrency(ch.ratePerLiter || 0)}/L)</span>
                                                      </div>
                                                    </td>
                                                    <td className="py-2 px-2 text-right">
                                                      <div className="flex items-center justify-end gap-1">
                                                        <input
                                                          type="number"
                                                          step="any"
                                                          disabled={isChamberOpeningLocked}
                                                          value={opLiters}
                                                          onFocus={(e) => e.target.select()}
                                                          onChange={(e) => handleUpdateChamberOpeningLevel(r.pumpId, ch.chamberId, parseFloat(e.target.value) || 0)}
                                                          className="w-16 px-1.5 py-0.5 bg-slate-50 border border-slate-200 rounded text-right font-bold text-slate-900 tabular-nums focus:bg-white focus:outline-none focus:border-amber-500 disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed text-[11px]"
                                                        />
                                                        {isChamberOpeningLocked && !isPumperFinalized && (
                                                          <button
                                                            type="button"
                                                            onClick={() => {
                                                              const newStarts = { ...lockedStartMeters };
                                                              delete newStarts[r.pumpId];
                                                              setLockedStartMeters(newStarts);
                                                              if (activeShift) {
                                                                saveLocksToStorage(activeShift.id, newStarts, lockedEndMeters, finalizedPumperCards);
                                                              }
                                                              setDraftReadings(prev => prev.map(dr => dr.pumpId === r.pumpId ? { ...dr, isStartSaved: false } : dr));
                                                            }}
                                                            className="text-[9px] text-blue-600 hover:text-blue-800 underline cursor-pointer"
                                                            title="Unlock Chamber Opening"
                                                          >
                                                            unlock
                                                          </button>
                                                        )}
                                                      </div>
                                                    </td>
                                                    <td className="py-2 px-2 text-right">
                                                      <input
                                                        type="number"
                                                        step="any"
                                                        disabled={isPumperFinalized}
                                                        value={clLiters}
                                                        onFocus={(e) => e.target.select()}
                                                        onChange={(e) => handleUpdateChamberClosingLevel(r.pumpId, ch.chamberId, parseFloat(e.target.value) || 0)}
                                                        className="w-16 px-1.5 py-0.5 bg-white border border-amber-300 rounded text-right font-bold text-slate-900 tabular-nums focus:outline-none focus:border-amber-600 disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed text-[11px]"
                                                      />
                                                    </td>
                                                    <td className="py-2 px-2 text-right font-bold text-amber-900 tabular-nums whitespace-nowrap">
                                                      {soldLiters.toFixed(2)} L
                                                    </td>
                                                    <td className="py-2 px-2.5 text-right font-extrabold text-emerald-700 tabular-nums whitespace-nowrap">
                                                      {formatCurrency(rowTotal)}
                                                    </td>
                                                  </tr>
                                                );
                                              })}
                                            </tbody>
                                            <tfoot>
                                              <tr className="bg-amber-50/80 border-t border-amber-200 text-xs font-bold">
                                                <td colSpan={3} className="py-2 px-2.5 text-amber-950 font-extrabold">
                                                  Total Forecourt Bulk Oil Sales:
                                                </td>
                                                <td className="py-2 px-2 text-right text-amber-950 font-extrabold tabular-nums">
                                                  {((r.chamberReadings || getDefaultChambers(oilTanks)).reduce((sum, ch) => {
                                                    const op = ch.openingLevel ?? ch.openingLiters ?? 0;
                                                    const cl = ch.closingLevel ?? ch.closingLiters ?? 0;
                                                    return sum + calculateChamberSoldLiters(op, cl);
                                                  }, 0)).toFixed(2)} L
                                                </td>
                                                <td className="py-2 px-2.5 text-right text-emerald-800 font-black tabular-nums text-xs">
                                                  {formatCurrency(r.oilSalesAmount || 0)}
                                                </td>
                                              </tr>
                                            </tfoot>
                                          </table>
                                        </div>
                                      </div>
                                    )}

                                    {/* Non-Cash Collections */}
                                    <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-slate-200/80">
                                      <div>
                                        <label className="text-[10px] font-extrabold text-purple-700 block mb-0.5 uppercase">Credit Sales (Rs.)</label>
                                        <input
                                          type="number"
                                          step="any"
                                          disabled={isPumperFinalized}
                                          value={r.creditSalesAmount ?? 0}
                                          onFocus={(e) => e.target.select()}
                                          onChange={(e) => handleUpdateReading(r.pumpId, 'creditSalesAmount', parseFloat(e.target.value) || 0)}
                                          className="w-full px-2 py-1 bg-white border border-purple-200 rounded-lg text-xs font-bold text-right tabular-nums focus:bg-white focus:outline-none focus:border-purple-500 text-purple-900 disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed"
                                        />
                                      </div>
                                      <div>
                                        <label className="text-[10px] font-extrabold text-indigo-700 block mb-0.5 uppercase">Card Sale (Rs.)</label>
                                        <input
                                          type="number"
                                          step="any"
                                          disabled={isPumperFinalized}
                                          value={r.cardSalesAmount ?? 0}
                                          onFocus={(e) => e.target.select()}
                                          onChange={(e) => handleUpdateReading(r.pumpId, 'cardSalesAmount', parseFloat(e.target.value) || 0)}
                                          className="w-full px-2 py-1 bg-white border border-indigo-200 rounded-lg text-xs font-bold text-right tabular-nums focus:outline-none focus:border-indigo-500 text-indigo-900 disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed"
                                        />
                                      </div>
                                    </div>

                                    {/* Pump Level Totals */}
                                    <div className="flex items-center justify-between pt-0.5 text-xs gap-2">
                                      <div className="flex items-center gap-3 text-[11px] flex-wrap">
                                        <span className="text-slate-500">
                                          Net Liters: <strong className="text-slate-900 tabular-nums">{netSold.toFixed(2)} L</strong>
                                        </span>
                                        <span className="text-slate-500">
                                          Expected Cash: <strong className="text-blue-700 tabular-nums">{formatCurrency(pumpExpCash)}</strong>
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                </React.Fragment>
                              );
                            })
                          )}
                        </div>
                      </div>

                      {/* Pumper Cash Reconciliation Footer */}
                      {assignedReadings.length > 0 && (
                        <div className="p-3 bg-gray-50/90 border border-gray-200/90 rounded-xl space-y-2.5 mt-3">
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-xs">
                            <div className="p-1.5 bg-white rounded-lg border border-gray-200">
                              <span className="text-[9px] font-extrabold text-gray-400 uppercase block">Total Net Fuel</span>
                              <span className="font-extrabold text-gray-900 tabular-nums text-xs">{p.totalNetLiters.toFixed(2)} L</span>
                            </div>
                            <div className="p-1.5 bg-white rounded-lg border border-gray-200">
                              <span className="text-[9px] font-extrabold text-gray-400 uppercase block">Gross Revenue</span>
                              <span className="font-extrabold text-gray-900 tabular-nums text-xs">{formatCurrency(p.totalGrossRevenue)}</span>
                            </div>
                            <div className="p-1.5 bg-purple-50 rounded-lg border border-purple-100">
                              <span className="text-[9px] font-extrabold text-purple-700 uppercase block">Non-Cash Deductions</span>
                              <span className="font-extrabold text-purple-900 tabular-nums text-xs">{formatCurrency(p.totalNonCash)}</span>
                            </div>
                            <div className="p-1.5 bg-blue-50 rounded-lg border border-blue-100">
                              <span className="text-[9px] font-extrabold text-blue-700 uppercase block">Expected Cash</span>
                              <span className="font-extrabold text-blue-900 tabular-nums text-xs">{formatCurrency(p.totalExpectedCash)}</span>
                            </div>
                          </div>

                          {/* Actual Cash Entry & Shortage/Excess */}
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1 border-t border-gray-200/60">
                            <div className="flex items-center gap-2 flex-1">
                              <label className="text-[11px] font-extrabold text-gray-700 uppercase tracking-wider shrink-0">
                                Handed Over Cash (Rs.):
                              </label>
                              <input
                                type="number"
                                step="any"
                                disabled={isPumperFinalized}
                                value={p.totalActualCash ?? 0}
                                onFocus={(e) => e.target.select()}
                                onChange={(e) => handleUpdateConsolidatedCashForPumper(pumperId, parseFloat(e.target.value) || 0)}
                                className="px-2.5 py-1 bg-white border border-gray-300 rounded-lg text-xs font-extrabold text-right tabular-nums text-gray-900 focus:outline-none focus:border-blue-600 w-32 disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed"
                                placeholder="0.00"
                              />
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="text-[10px] font-extrabold text-gray-500 uppercase">Variance:</span>
                              {p.cashVariance < -0.01 ? (
                                <span className="px-2 py-0.5 bg-red-100 text-red-700 border border-red-200 rounded-md text-[11px] font-black tabular-nums">
                                  - {formatCurrency(Math.abs(p.cashVariance))} (Shortage)
                                </span>
                              ) : p.cashVariance > 0.01 ? (
                                <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-md text-[11px] font-black tabular-nums">
                                  + {formatCurrency(p.cashVariance)} (Excess)
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 bg-gray-200 text-gray-700 border border-gray-300 rounded-md text-[11px] font-black tabular-nums">
                                  Rs. 0.00 (Balanced)
                                </span>
                              )}
                            </div>
                          </div>

                          {/* 2-Phase Save & Finalize Action Bar */}
                          <div className="pt-2 border-t border-gray-200/60 flex items-center justify-between gap-2">
                            {isPumperFinalized ? (
                              <>
                                <span className="text-[11px] font-extrabold text-emerald-800 flex items-center gap-1.5">
                                  <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                  <span>Shift Ended: Record reconciled</span>
                                </span>

                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleUnlockPumperRecord(pumperId)}
                                    className="text-[11px] text-slate-500 hover:text-blue-600 font-semibold underline cursor-pointer"
                                    title="Unlock record to make corrections"
                                  >
                                    Unlock Record
                                  </button>
                                  <div className="px-3 py-1.5 rounded-lg text-xs font-extrabold flex items-center gap-1.5 bg-emerald-100 text-emerald-800 border border-emerald-300 select-none">
                                    <Lock className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                                    <span>✓ Fully Reconciled & Locked</span>
                                  </div>
                                </div>
                              </>
                            ) : isPumperStartSaved ? (
                              <>
                                <span className="text-[11px] font-medium text-slate-600 flex items-center gap-1.5">
                                  <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                                  <span>Shift Active: Enter closing readings</span>
                                </span>

                                <button
                                  type="button"
                                  onClick={() => handleFinalizePumperRecord(pumperId)}
                                  className="px-3.5 py-1.5 rounded-lg text-xs font-extrabold transition-all flex items-center gap-1.5 shrink-0 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white shadow-2xs cursor-pointer"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                  <span>Save & Finalize Pumper Record</span>
                                </button>
                              </>
                            ) : (
                              <>
                                <span className="text-[11px] font-medium text-slate-500">
                                  Shift Start: Enter start meter readings
                                </span>

                                <button
                                  type="button"
                                  onClick={() => handleSaveStartMeterForPumper(pumperId)}
                                  className="px-3.5 py-1.5 rounded-lg text-xs font-extrabold transition-all flex items-center gap-1.5 shrink-0 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white shadow-2xs cursor-pointer"
                                >
                                  <Lock className="w-3.5 h-3.5" />
                                  <span>Save Start Meter</span>
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="col-span-full py-10 text-center text-gray-500 text-xs italic bg-gray-50 rounded-xl border border-dashed border-gray-200">
                  No active pumper cards match your search query. Click "+ Add Pumper" above to add pumpers to this shift.
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        /* Empty/Inactive state */
        (() => {
          if (selectedPastShift) {
            return (
              <div id="past-shift-detail" className="w-full max-w-6xl mx-auto space-y-6 animate-fade-in pb-12">
                <button
                  onClick={() => setSelectedPastShift(null)}
                  className="flex items-center gap-2 text-gray-500 hover:text-[#1C1C1C] transition-colors font-semibold text-sm cursor-pointer mb-2"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back to Shift List
                </button>
                
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                  <div className="px-6 py-5 border-b border-gray-100 bg-gray-50/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div>
                      <h2 className="text-xl font-bold text-[#1C1C1C] tracking-tight">Shift #{selectedPastShift.id}</h2>
                      <p className="text-sm text-gray-500 mt-1">Supervisor: <span className="font-semibold text-gray-700">{selectedPastShift.supervisorName}</span></p>
                    </div>
                    <div className="flex items-center gap-3 text-sm font-medium text-gray-600 bg-white px-4 py-2 rounded-xl border border-gray-100 shadow-sm tabular-nums">
                      <Clock className="w-4 h-4 text-gray-400" />
                      <span>{new Date(selectedPastShift.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      <span className="text-gray-300">→</span>
                      <span>{selectedPastShift.endTime ? new Date(selectedPastShift.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Ongoing'}</span>
                    </div>
                  </div>
                  
                  <div className="p-6 overflow-x-auto">
                    <h3 className="font-bold text-[#1C1C1C] text-sm uppercase tracking-wider mb-4">Pump Meter Breakdown</h3>
                    <table className="w-full text-left">
                      <thead className="bg-gray-50 border-b border-gray-100 text-gray-500 font-bold text-xs uppercase tracking-wider">
                        <tr>
                          <th className="py-3 px-4">Pump</th>
                          <th className="py-3 px-4">Product</th>
                          <th className="py-3 px-4 text-right">Start Meter</th>
                          <th className="py-3 px-4 text-right">End Meter</th>
                          <th className="py-3 px-4 text-right">Total Liters</th>
                          <th className="py-3 px-4 text-right">Net Sales (Rs.)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50 text-sm">
                        {selectedPastShift.pumpReadings.map((reading, idx) => {
                          const tank = tanks.find(t => t.id === reading.tankId);
                          return (
                            <tr key={idx} className="hover:bg-gray-50/50 transition-colors">
                              <td className="py-3 px-4 font-semibold text-[#1C1C1C]">{reading.pumpName}</td>
                              <td className="py-3 px-4">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${reading.fuelType === 'Petrol' ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-700'}`}>
                                  {reading.fuelType || 'Unknown'}
                                </span>
                              </td>
                              <td className="py-3 px-4 text-right font-medium text-gray-600 tabular-nums">{(reading.startMeter || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                              <td className="py-3 px-4 text-right font-medium text-gray-600 tabular-nums">{(reading.endMeter || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                              <td className="py-3 px-4 text-right font-bold text-blue-600 tabular-nums">{(reading.totalDispensed || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                              <td className="py-3 px-4 text-right font-bold text-[#1C1C1C] tabular-nums">{formatCurrency(reading.netSales || 0)}</td>
                            </tr>
                          );
                        })}
                        <tr className="bg-gray-50/50 border-t-2 border-gray-200">
                          <td colSpan={4} className="py-4 px-4 text-right font-bold text-[#1C1C1C] uppercase tracking-wider text-xs">Total</td>
                          <td className="py-4 px-4 text-right font-black text-blue-600 tabular-nums text-base">{(selectedPastShift.totalFuelSold || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          <td className="py-4 px-4 text-right font-black text-[#1C1C1C] tabular-nums text-base">{formatCurrency(selectedPastShift.totalNetSales || 0)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div className="p-6 bg-gray-50/30 border-t border-gray-100">
                    <h3 className="font-bold text-[#1C1C1C] text-sm uppercase tracking-wider mb-4">Financial Reconciliation</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Expected Cash</p>
                        <p className="text-lg font-bold text-[#1C1C1C] tabular-nums mt-1">{formatCurrency(selectedPastShift.totalNetSales || 0)}</p>
                      </div>
                      <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Actual Cash Collected (Placeholder)</p>
                        <p className="text-lg font-bold text-blue-600 tabular-nums mt-1">{formatCurrency(selectedPastShift.totalNetSales || 0)}</p>
                      </div>
                      <div className={`bg-white p-4 rounded-xl border shadow-sm border-emerald-200 bg-emerald-50/50`}>
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Shortage / Overage</p>
                        <p className={`text-lg font-bold tabular-nums mt-1 text-emerald-600`}>
                          {formatCurrency(0)}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          }

          // Compute fuel distributions & totals for completed shifts
          const productDistribution: Record<string, number> = {};
          let totalLiters = 0;
          let totalRevenue = 0;

          closedLedgerShifts.forEach(shift => {
            totalLiters += (shift.totalNetSold || shift.totalFuelSold || 0);
            totalRevenue += (shift.totalNetSales || 0);
            (shift.pumpReadings || []).forEach((reading: any) => {
               const fuel = reading.fuelType || reading.fueltype || 'Unknown';
               const start = reading.startMeter !== undefined ? reading.startMeter : reading.startmeter || 0;
               const end = reading.endMeter !== undefined ? reading.endMeter : reading.endmeter || 0;
               const dispensed = reading.totalDispensed !== undefined ? reading.totalDispensed : Math.max(0, end - start);
               productDistribution[fuel] = (productDistribution[fuel] || 0) + dispensed;
            });
          });

          return (
            <div id="no-shift-screen" className="w-full max-w-7xl mx-auto space-y-6 animate-fade-in pb-12">


              <div className="flex flex-col lg:flex-row gap-6">
                
                {/* LEFT COLUMN (70%): Shift Ledger */}
                <div className="lg:w-[70%] bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col h-[500px]">
                  <div className="px-5 py-3.5 border-b border-gray-100 bg-gray-50/80 shrink-0 flex items-center justify-between">
                     <div className="flex items-center gap-2">
                       <h3 className="font-bold text-[#1C1C1C] text-xs uppercase tracking-wider">Shift Ledger</h3>
                       <span className="px-2 py-0.5 rounded-full bg-gray-200/60 text-gray-600 text-[10px] font-semibold tabular-nums">
                         {closedLedgerShifts.length} {closedLedgerShifts.length === 1 ? 'Record' : 'Records'}
                       </span>
                     </div>
                     {isLoadingLedger && (
                       <span className="text-xs text-blue-600 font-medium flex items-center gap-1">
                         <RefreshCw className="w-3 h-3 animate-spin" /> Syncing...
                       </span>
                     )}
                  </div>
                  <div className="overflow-auto flex-1 relative">
                    <table className="w-full text-left border-collapse">
                      <thead className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 shadow-xs">
                        <tr className="text-gray-500 font-bold text-[11px] uppercase tracking-wider">
                          <th className="py-2.5 px-4">Shift ID / Name</th>
                          <th className="py-2.5 px-4">Supervisor</th>
                          <th className="py-2.5 px-4 text-right">Liters Sold</th>
                          <th className="py-2.5 px-4 text-right">Revenue (Rs.)</th>
                          <th className="py-2.5 px-4 text-right">Cash Rec. / Variance</th>
                          <th className="py-2.5 px-4">End Time & Date</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 text-xs">
                        {closedLedgerShifts.length > 0 ? (
                          closedLedgerShifts.map(shift => {
                            const supervisorName = employees.find(e => e.id === shift.supervisorId || e.id === shift.supervisorid)?.name || shift.supervisorName || 'Unassigned';
                            const liters = shift.totalNetSold || shift.totalFuelSold || 0;
                            const revenue = shift.totalNetSales || 0;
                            const physCash = shift.totalPhysicalCash !== undefined && shift.totalPhysicalCash > 0 
                              ? shift.totalPhysicalCash 
                              : ((shift.initialPumperCash || 0) + (shift.replacementPumperCash || 0));
                            const hasHandover = physCash > 0 || !!shift.handoverNotes || !!shift.replacementPumperId;
                            const variance = shift.cashVariance !== undefined ? shift.cashVariance : (physCash > 0 ? physCash - revenue : 0);

                            const formattedDate = shift.endTime 
                              ? new Date(shift.endTime).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                              : 'Completed';

                            return (
                              <tr 
                                key={shift.id} 
                                className="hover:bg-gray-50/70 transition-colors"
                              >
                                <td className="py-2.5 px-4 font-semibold text-[#1C1C1C] tabular-nums">
                                  {shift.id} {shift.name ? <span className="text-[11px] font-normal text-gray-500">({shift.name})</span> : ''}
                                  {hasHandover && (
                                    <span className="ml-1.5 px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-100 font-medium text-[9px] uppercase tracking-wider">
                                      Handover
                                    </span>
                                  )}
                                </td>
                                <td className="py-2.5 px-4 text-gray-600 font-medium">{supervisorName}</td>
                                <td className="py-2.5 px-4 text-right tabular-nums font-semibold text-gray-700">
                                  {liters.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} L
                                </td>
                                <td className="py-2.5 px-4 text-right tabular-nums font-bold text-[#1C1C1C]">
                                  {formatCurrency(revenue)}
                                </td>
                                <td className="py-2.5 px-4 text-right tabular-nums font-medium">
                                  {hasHandover ? (
                                    <div className="flex flex-col items-end">
                                      <span className="font-bold text-gray-800">{formatCurrency(physCash)}</span>
                                      {variance === 0 ? (
                                        <span className="text-[10px] text-emerald-600 font-semibold">Balanced</span>
                                      ) : variance > 0 ? (
                                        <span className="text-[10px] text-emerald-600 font-semibold">+{formatCurrency(variance)}</span>
                                      ) : (
                                        <span className="text-[10px] text-red-500 font-semibold">{formatCurrency(variance)}</span>
                                      )}
                                    </div>
                                  ) : (
                                    <span className="text-gray-400 font-normal text-[11px]">Match ({formatCurrency(revenue)})</span>
                                  )}
                                </td>
                                <td className="py-2.5 px-4 text-gray-500 tabular-nums font-medium text-[11px]">
                                  {formattedDate}
                                </td>
                              </tr>
                            );
                          })
                        ) : (
                          <tr>
                            <td colSpan={6} className="py-12 text-center text-gray-400 font-medium text-xs">
                              No shift logs found. Click '+ Open New Shift' to record your first shift
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* RIGHT COLUMN (30%): Mini Analytics Progress */}
                <div className="lg:w-[30%] bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-6 flex flex-col h-[500px] overflow-y-auto">
                   <div>
                     <h3 className="font-bold text-[#1C1C1C] text-sm uppercase tracking-wider mb-5">Today's Progress</h3>
                     
                     <div className="space-y-4">
                       <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Gross Revenue</p>
                          <p className="text-2xl font-extrabold text-[#1C1C1C] tabular-nums mt-1">{formatCurrency(totalRevenue)}</p>
                       </div>
                       <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Total Volume</p>
                          <p className="text-2xl font-extrabold text-[#1C1C1C] tabular-nums mt-1">{totalLiters.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} L</p>
                       </div>
                     </div>
                   </div>

                   <div>
                      <h4 className="font-semibold text-gray-700 text-xs uppercase tracking-wider mb-3">Volume Distribution</h4>
                      <div className="space-y-4">
                        {Object.keys(productDistribution).length > 0 ? (
                           Object.entries(productDistribution).map(([product, vol]) => {
                             const percentage = totalLiters > 0 ? ((vol / totalLiters) * 100).toFixed(1) : 0;
                             // Assign a color dynamically based on product name
                             const isPetrol = product.toLowerCase().includes('petrol');
                             const colorClass = isPetrol ? 'bg-orange-400' : 'bg-blue-500';
                             return (
                               <div key={product}>
                                 <div className="flex justify-between text-xs font-semibold mb-1">
                                   <span className="text-[#1C1C1C]">{product}</span>
                                   <span className="tabular-nums text-gray-600">{vol.toLocaleString(undefined, {minimumFractionDigits:1, maximumFractionDigits:1})} L ({percentage}%)</span>
                                 </div>
                                 <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                                    <div className={`${colorClass} h-2 rounded-full`} style={{ width: `${percentage}%` }}></div>
                                 </div>
                               </div>
                             );
                           })
                        ) : (
                           <p className="text-sm text-gray-400 italic">No fuel dispensed yet.</p>
                        )}
                      </div>
                   </div>
                </div>

              </div>
            </div>
          );
        })()
      )}

      {/* --- MODAL: START NEW SHIFT --- */}
      {isStartShiftOpen && (
        <div id="start-modal-overlay" className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-fade-in">
          <div id="start-modal-card" className="bg-gray-50 rounded-2xl max-w-md w-full shadow-2xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
              <h3 className="font-bold text-[#1C1C1C] text-lg">Initiate New Active Shift</h3>
              <button onClick={() => setIsStartShiftOpen(false)} className="text-gray-500 hover:text-[#1C1C1C] cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 font-sans">
              
              {/* Fixed 24-Hour Shift Cycle Banner */}
              <div className="p-3.5 bg-gray-100/90 border border-gray-200 rounded-xl text-xs space-y-1">
                <span className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider block">
                  Fixed Shift Cycle
                </span>
                <p className="font-extrabold text-gray-900 text-sm">
                  Full Day Shift (08:00 AM - 08:00 AM)
                </p>
                <p className="text-[11px] text-gray-500 font-medium">
                  Configured for a standard 24-hour continuous station cycle.
                </p>
              </div>

              {/* Supervisor selection */}
              <div>
                <label className="text-xs font-bold text-gray-600 uppercase tracking-wider block mb-1.5">
                  Assign Supervisor
                </label>
                <select
                  value={newSupervisorId}
                  onChange={(e) => setNewSupervisorId(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-white border border-gray-300 text-[#1C1C1C] rounded-xl text-sm font-semibold focus:outline-none focus:border-blue-500"
                >
                  <option value="" disabled>-- Select Station Supervisor --</option>
                  {supervisors.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Carry-Forward disclaimer */}
              <div className="p-3.5 bg-blue-500/10 border border-blue-500/20 text-blue-800 rounded-xl text-xs space-y-1">
                <div className="flex items-center gap-1.5 font-extrabold">
                  <Sparkles className="w-3.5 h-3.5 text-blue-600" />
                  <span>Fully Automated Carry-Forward</span>
                </div>
                <p className="leading-relaxed text-gray-600 font-medium">
                  Start meter values are carried forward automatically from the previous shift's closing values. You can modify these readings at any time during the shift.
                </p>
              </div>
            </div>

            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-end gap-3">
              <button
                onClick={() => setIsStartShiftOpen(false)}
                className="px-4 py-2 bg-transparent border border-gray-200 text-gray-600 font-medium text-xs rounded-lg hover:bg-gray-100 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleStartNewShiftSubmit}
                className="px-5 py-2 bg-gradient-to-r from-emerald-600 to-teal-500 text-white font-bold text-xs rounded-lg hover:brightness-110 transition-all cursor-pointer"
                disabled={!newSupervisorId}
              >
                Launch Shift
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- VALIDATION WARNING OVERLAY --- */}
      {showValidationOverlay && (
        <div id="validation-overlay" className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-fade-in">
          <div id="validation-card" className="bg-gray-50 rounded-2xl max-w-lg w-full shadow-2xl border border-red-500/20 overflow-hidden">
            <div className="p-6">
              <div className="w-12 h-12 bg-red-500/10 text-red-400 rounded-full flex items-center justify-center mb-4 border border-red-500/20">
                <AlertTriangle className="w-6 h-6 animate-bounce" />
              </div>
              <h3 className="font-extrabold text-[#1C1C1C] text-lg">Ledger Validation Errors</h3>
              <p className="text-gray-500 text-sm mt-1">
                Please correct the following errors before ending the shift to preserve ledger and database integrity:
              </p>

              <div className="mt-4 bg-red-500/5 border border-red-500/15 rounded-xl p-4 max-h-60 overflow-y-auto space-y-2.5">
                {validationErrors.map((err, index) => (
                  <div key={index} className="flex items-start gap-2 text-xs text-red-400 font-medium leading-relaxed">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 mt-1.5 flex-shrink-0" />
                    <span>{err}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end">
              <button
                onClick={() => setShowValidationOverlay(false)}
                className="px-5 py-2 bg-gradient-to-r from-red-600 to-red-500 text-[#1C1C1C] font-bold text-xs rounded-lg hover:brightness-110 transition-all cursor-pointer"
              >
                Dismiss & Review Ledger
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- CONFIRM CLOSE SHIFT MODAL --- */}
      {isCloseConfirmOpen && activeShift && (
        <div id="close-modal-overlay" className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-fade-in">
          <div id="close-modal-card" className="bg-gray-50 rounded-2xl max-w-2xl w-full shadow-2xl border border-gray-200 overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-6 text-center overflow-y-auto space-y-4">
              <div className="w-12 h-12 bg-red-500/10 text-red-500 rounded-full flex items-center justify-center mx-auto mb-2 border border-red-500/20">
                <AlertCircle className="w-6 h-6" />
              </div>
              <h3 className="font-extrabold text-[#1C1C1C] text-lg">End Shift & Lock Ledger?</h3>
              <p className="text-gray-500 text-xs">
                This action will lock current shift ledger (<strong className="text-[#1C1C1C] tabular-nums font-semibold">{activeShift.id}</strong>), save readings permanently, and deduct sold fuel from underground storage tanks.
              </p>
              
              {/* Overall Shift Revenue Summary Box */}
              <div className="bg-white p-4 rounded-xl text-left text-xs text-gray-600 space-y-2.5 border border-gray-200/80 shadow-xs">
                <div className="flex justify-between items-center pb-2 border-b border-gray-100">
                  <span className="font-bold text-gray-700">Supervisor: <strong className="text-[#1C1C1C]">{activeSupervisor?.name || 'N/A'}</strong></span>
                  <span className="font-bold text-gray-700">Shift: <strong className="text-[#1C1C1C]">{activeShift.name}</strong></span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <div className="bg-gray-50 p-2.5 rounded-xl border border-gray-100">
                    <span className="text-[10px] text-gray-500 uppercase font-bold block">Net Fuel Sold</span>
                    <span className="text-xs sm:text-sm font-extrabold text-[#1C1C1C] tabular-nums">{formatLiters(stats.totalNetSold)}</span>
                  </div>
                  <div className="bg-gray-50 p-2.5 rounded-xl border border-gray-100">
                    <span className="text-[10px] text-gray-500 uppercase font-bold block">Gross Fuel Revenue</span>
                    <span className="text-xs sm:text-sm font-extrabold text-[#1C1C1C] tabular-nums">{formatCurrency(stats.totalFuelSales)}</span>
                  </div>
                  <div className="bg-amber-50/60 p-2.5 rounded-xl border border-amber-100 col-span-2 sm:col-span-1">
                    <span className="text-[10px] text-amber-900 uppercase font-bold block">(+) Oil/Lube Sales</span>
                    <span className="text-xs sm:text-sm font-extrabold text-amber-700 tabular-nums">+{formatCurrency(stats.totalOilSales)}</span>
                  </div>
                </div>

                <div className="flex justify-between items-center pt-2 border-t border-gray-100 text-xs">
                  <span className="font-extrabold text-gray-800">Total Consolidated System Revenue:</span>
                  <span className="font-extrabold text-blue-600 tabular-nums text-base">{formatCurrency(stats.totalNetSales)}</span>
                </div>
              </div>

              {/* Pumper Consolidated Shift Summary */}
              {allPumperStats.length > 0 && (
                <div className="text-left space-y-2 pt-1">
                  <div className="flex items-center justify-between">
                    <h4 className="font-extrabold text-[#1C1C1C] text-xs uppercase tracking-wider flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-blue-600" />
                      Pumper Consolidated Shift Summary
                    </h4>
                    <span className="text-[10px] font-bold text-gray-500 bg-gray-200/60 px-2 py-0.5 rounded-full">
                      {allPumperStats.length} {allPumperStats.length === 1 ? 'Pumper Account' : 'Pumper Accounts'}
                    </span>
                  </div>

                  <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                    {allPumperStats.map((p) => {
                      const absVar = Math.abs(p.overallVariance);
                      const absVarFormatted = formatCurrency(absVar);

                      return (
                        <div key={`modal-pumper-${p.pumperId}`} className="bg-white p-3 rounded-xl border border-gray-200/90 shadow-2xs space-y-2 text-xs">
                          <div className="flex items-center justify-between gap-2 border-b border-gray-100 pb-2">
                            <div className="flex items-center gap-2">
                              <div className={`w-6 h-6 rounded-lg text-white font-bold text-xs flex items-center justify-center shrink-0 ${p.avatarColor}`}>
                                {p.pumperName.charAt(0)}
                              </div>
                              <span className="font-bold text-[#1C1C1C]">{p.pumperName}</span>
                            </div>
                            <div className="flex items-center gap-1 flex-wrap">
                              {p.readings.map(r => (
                                <span key={`m-pill-${r.pumpId}`} className="text-[9px] font-bold px-1.5 py-0.5 bg-gray-100 text-gray-700 rounded-md tabular-nums border border-gray-200/60">
                                  {r.pumpName}
                                </span>
                              ))}
                            </div>
                          </div>

                          {/* Financial Row */}
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] bg-gray-50/80 p-2 rounded-lg border border-gray-100">
                            <div>
                              <span className="text-[9px] font-semibold text-gray-400 block uppercase">Fuel Sales</span>
                              <span className="font-bold text-gray-700 tabular-nums">{formatCurrency(p.totalFuelRevenue)}</span>
                            </div>
                            <div>
                              <span className="text-[9px] font-semibold text-amber-700 block uppercase">Oil/Lube Sales</span>
                              <span className="font-bold text-amber-700 tabular-nums">+{formatCurrency(p.totalOilSales)}</span>
                            </div>
                            <div>
                              <span className="text-[9px] font-semibold text-purple-600 block uppercase">Non-Cash (Credit/Card)</span>
                              <span className="font-bold text-purple-700 tabular-nums">-{formatCurrency(p.totalCreditSales + p.totalCardSales)}</span>
                            </div>
                            <div>
                              <span className="text-[9px] font-extrabold text-blue-900 block uppercase">Net Cash Due</span>
                              <span className="font-extrabold text-blue-700 tabular-nums">{formatCurrency(p.totalNetExpCash)}</span>
                            </div>
                          </div>

                          {/* Cash Handover & Variance Status */}
                          <div className="flex items-center justify-between pt-1 text-xs">
                            <div className="flex items-center gap-1 text-gray-600">
                              <span className="font-medium">Actual Cash Handed Over:</span>
                              <span className="font-bold text-[#1C1C1C] tabular-nums">{formatCurrency(p.totalActualCash)}</span>
                            </div>
                            <div>
                              {p.overallVariance < -0.01 ? (
                                <span className="px-2 py-0.5 rounded-md font-extrabold text-[11px] bg-red-100 text-red-700 border border-red-200 tabular-nums">
                                  -{absVarFormatted} (Shortage)
                                </span>
                              ) : p.overallVariance > 0.01 ? (
                                <span className="px-2 py-0.5 rounded-md font-extrabold text-[11px] bg-emerald-100 text-emerald-800 border border-emerald-200 tabular-nums">
                                  +{absVarFormatted} (Excess)
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-md font-extrabold text-[11px] bg-gray-100 text-gray-700 border border-gray-200 tabular-nums">
                                  Rs. 0.00 (Balanced)
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex items-center justify-end gap-3 shrink-0">
              <button
                onClick={() => setIsCloseConfirmOpen(false)}
                className="px-4 py-2 bg-white border border-gray-200 text-gray-600 font-bold text-xs rounded-lg hover:bg-gray-100 cursor-pointer shadow-2xs transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmCloseShift}
                className="px-5 py-2 bg-gradient-to-r from-red-600 to-red-500 text-white font-bold text-xs rounded-lg hover:brightness-110 transition-all cursor-pointer shadow-sm"
              >
                Confirm & Lock Ledger
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MID-SHIFT PUMPER TRANSFER MODAL */}
      {handoverPumpModal && (
        <div id="handover-modal-overlay" className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-fade-in">
          <div id="handover-modal-card" className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-gray-100 overflow-hidden">
            {/* Header */}
            <div className="px-5 py-4 bg-gradient-to-r from-blue-600 to-[#00BFFF] text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-white/20 rounded-xl backdrop-blur-md">
                  <RefreshCw className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="font-extrabold text-base leading-tight">Mid-Shift Pumper Transfer</h3>
                  <p className="text-blue-100 text-xs">{handoverPumpModal.pumpName} • {handoverPumpModal.fuelType}</p>
                </div>
              </div>
              <button
                onClick={() => setHandoverPumpModal(null)}
                className="p-1 rounded-lg hover:bg-white/20 text-white/80 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 space-y-4">
              {/* Outgoing Pumper Summary */}
              <div className="p-3 bg-gray-50 rounded-xl border border-gray-200/80 flex items-center justify-between text-xs">
                <div>
                  <span className="text-[10px] font-bold text-gray-500 uppercase block">Outgoing Pumper</span>
                  <span className="font-bold text-[#1C1C1C] text-sm">
                    {employees.find(e => e.id === handoverPumpModal.assignedPumperId)?.name || 'Unassigned'}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-bold text-gray-500 uppercase block">Start Meter</span>
                  <span className="font-bold text-gray-700 tabular-nums">{handoverPumpModal.startMeter.toFixed(2)} L</span>
                </div>
              </div>

              {/* Handover Meter Reading */}
              <div>
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
                  Handover Meter Reading (L)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={modalHandoverMeter}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => {
                    const val = e.target.value === '' ? '' : parseFloat(e.target.value) || 0;
                    setModalHandoverMeter(val);
                    if (typeof val === 'number') {
                      const fuelPrice = getPriceForFuelType(handoverPumpModal.fuelType);
                      const hLiters = Math.max(0, val - handoverPumpModal.startMeter);
                      const netLiters = Math.max(0, hLiters - handoverPumpModal.testingQty);
                      setModalOutgoingCash(netLiters * fuelPrice);
                    }
                  }}
                  className="w-full px-3.5 py-2.5 bg-white border border-gray-300 rounded-xl text-sm font-bold text-[#1C1C1C] tabular-nums focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                />
                <p className="text-[10px] text-gray-500 mt-1">
                  Liters dispensed by outgoing pumper: <strong className="text-blue-600 tabular-nums font-bold">
                    {Math.max(0, (Number(modalHandoverMeter) || 0) - handoverPumpModal.startMeter).toFixed(2)} L
                  </strong>
                </p>
              </div>

              {/* Outgoing Pumper Cash Collected */}
              <div>
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
                  Outgoing Pumper Cash Collected (Rs.)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={modalOutgoingCash}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setModalOutgoingCash(e.target.value === '' ? '' : parseFloat(e.target.value) || 0)}
                  className="w-full px-3.5 py-2.5 bg-white border border-gray-300 rounded-xl text-sm font-bold text-[#1C1C1C] tabular-nums focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              {/* Replacement / Receiving Pumper Selection */}
              <div>
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
                  Select Receiving Pumper (Active in Shift)
                </label>
                {(() => {
                  const activeIds = new Set<string>();
                  draftReadings.forEach(r => {
                    if (r.assignedPumperId) activeIds.add(r.assignedPumperId);
                  });
                  selectedActivePumperIds.forEach(id => activeIds.add(id));
                  const activeShiftReceivers = employees.filter(e => activeIds.has(e.id) && e.id !== handoverPumpModal.assignedPumperId);
                  const availableOptions = activeShiftReceivers.length > 0
                    ? activeShiftReceivers
                    : pumpers.filter(p => p.id !== handoverPumpModal.assignedPumperId);

                  return (
                    <>
                      <select
                        value={modalReplacementPumperId}
                        onChange={(e) => setModalReplacementPumperId(e.target.value)}
                        className="w-full px-3.5 py-2.5 bg-white border border-gray-300 rounded-xl text-xs font-bold text-[#1C1C1C] focus:outline-none focus:border-blue-500"
                      >
                        <option value="">-- Select Receiving Pumper --</option>
                        {availableOptions.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} {activeShiftReceivers.some(ar => ar.id === p.id) ? '(Active in Shift)' : ''}
                          </option>
                        ))}
                      </select>
                      {activeShiftReceivers.length === 0 && (
                        <p className="text-[10px] text-amber-600 mt-1 font-medium">
                          Note: No other active pumpers added to shift yet. Showing available staff.
                        </p>
                      )}
                    </>
                  );
                })()}
              </div>

              {/* Handover / Reason Notes */}
              <div>
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
                  Transfer Notes
                </label>
                <input
                  type="text"
                  placeholder="e.g. Swapped for meal break (1:00 PM)"
                  value={modalHandoverNotes}
                  onChange={(e) => setModalHandoverNotes(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-white border border-gray-300 rounded-xl text-xs font-medium text-[#1C1C1C] focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-end gap-2">
              <button
                onClick={() => setHandoverPumpModal(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-gray-600 hover:bg-gray-200/60 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmHandover}
                className="px-5 py-2 rounded-xl text-xs font-extrabold bg-blue-600 hover:bg-blue-700 text-white transition-colors shadow-sm flex items-center gap-1.5 cursor-pointer"
              >
                <Check className="w-4 h-4" />
                <span>Confirm Transfer</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 bg-white text-[#1C1C1C] px-5 py-3 rounded-xl shadow-lg z-50 flex items-center gap-2 text-sm font-semibold animate-bounce shadow-emerald-500/10">
          <CheckCircle className="w-5 h-5 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

    </div>
  );
}
