/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Droplet, Plus, RefreshCw, Download, Search, AlertTriangle, 
  TrendingUp, TrendingDown, X, CheckCircle2, Eye, Calendar,
  Clock, User, FileText, Check, ArrowUpDown, ChevronRight,
  Truck, Layers, Gauge, ShieldCheck, Fuel, ArrowRight,
  Sparkles, CheckCircle, HelpCircle, Activity
} from 'lucide-react';
import { FuelTank, DailyDipSession, TankDipEntry, BowserDeliveryDipData } from '../types';
import { supabase } from '../lib/supabase';

interface ManualDipTabProps {
  tanks?: FuelTank[];
  setTanks?: React.Dispatch<React.SetStateAction<FuelTank[]>>;
}

const STORAGE_KEY_SESSIONS = 'fms_daily_dip_sessions';

/**
 * Standard reference depth in mm for underground cylindrical tanks based on capacity.
 */
export function getTankMaxDipMm(capacity: number): number {
  if (capacity <= 10000) return 1950;
  if (capacity <= 15000) return 2150;
  if (capacity <= 25000) return 2400;
  if (capacity <= 35000) return 2600;
  return 2800;
}

/**
 * Calculates fuel volume in Liters from a dip reading in mm for a horizontal cylindrical tank.
 * Uses exact geometric volume fraction.
 */
export function calculateDipVolume(dipMm: number, tankCapacity: number): number {
  if (isNaN(dipMm) || dipMm <= 0) return 0;
  const maxDipMm = getTankMaxDipMm(tankCapacity);
  if (dipMm >= maxDipMm) return tankCapacity;

  const f = Math.max(0, Math.min(1, dipMm / maxDipMm));
  // Exact geometric horizontal cylinder cross-section area formula:
  const fraction = (Math.acos(1 - 2 * f) - (1 - 2 * f) * Math.sqrt(4 * f * (1 - f))) / Math.PI;
  return Math.round(tankCapacity * fraction);
}

/**
 * Inverse calculation: estimates dip in mm from volume in Liters.
 */
export function estimateDipMm(volumeLiters: number, tankCapacity: number): number {
  if (isNaN(volumeLiters) || volumeLiters <= 0) return 0;
  const maxDipMm = getTankMaxDipMm(tankCapacity);
  if (volumeLiters >= tankCapacity) return maxDipMm;

  let low = 0;
  let high = maxDipMm;
  for (let i = 0; i < 20; i++) {
    const mid = (low + high) / 2;
    const v = calculateDipVolume(mid, tankCapacity);
    if (v < volumeLiters) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return Math.round((low + high) / 2);
}

export default function ManualDipTab({ tanks = [] }: ManualDipTabProps) {
  const [sessions, setSessions] = useState<DailyDipSession[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  // Modals state
  const [isDailyDipModalOpen, setIsDailyDipModalOpen] = useState<boolean>(false);
  const [isBowserDipModalOpen, setIsBowserDipModalOpen] = useState<boolean>(false);
  const [selectedDetailSession, setSelectedDetailSession] = useState<DailyDipSession | null>(null);
  
  // Search & Filter
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedShiftFilter, setSelectedShiftFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'daily_routine' | 'bowser_delivery'>('all');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Available Tanks (Naturally sorted in ascending order: Tank 01, Tank 02, etc.)
  const availableTanks = useMemo(() => {
    const rawList = tanks || [];
    return [...rawList].sort((a, b) => 
      (a.name || a.id || '').localeCompare(b.name || b.id || '', undefined, { numeric: true, sensitivity: 'base' })
    );
  }, [tanks]);

  // Form State for Multi-Tank Routine Entry Modal
  const [formData, setFormData] = useState({
    date: new Date().toISOString().slice(0, 10),
    time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
    shift: 'Morning (06:00 - 14:00)',
    supervisor: 'Supervisor',
    remarks: '',
  });

  // Physical dip inputs mapped by tankId: string
  const [dipInputs, setDipInputs] = useState<{ [tankId: string]: string }>({});

  // Form State for Bowser Delivery Unload Audit (Pre & Post Dip)
  const [bowserForm, setBowserForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
    supervisor: 'Supervisor',
    tankId: availableTanks[0]?.id || '',
    invoicedVolume: '6600',
    bowserNo: '',
    invoiceNo: '',
    driverName: '',
    sealIntact: true,
    waterTestNegative: true,
    density: '0.835',
    temperature: '29.5',
    remarks: '',
    
    // Pre-Unload Dip
    preDipMm: '',
    preDipLiters: '',
    
    // Post-Unload Dip
    postDipMm: '',
    postDipLiters: '',
  });

  // Selected tank for Bowser Delivery Audit
  const selectedBowserTank = useMemo(() => {
    return availableTanks.find(t => t.id === bowserForm.tankId) || availableTanks[0];
  }, [availableTanks, bowserForm.tankId]);

  // Open Daily Routine Dip Modal
  const handleOpenDailyDipModal = () => {
    const initialInputs: { [tankId: string]: string } = {};
    availableTanks.forEach(tank => {
      initialInputs[tank.id] = '';
    });
    setDipInputs(initialInputs);
    setFormData({
      date: new Date().toISOString().slice(0, 10),
      time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
      shift: 'Morning (06:00 - 14:00)',
      supervisor: 'Supervisor',
      remarks: '',
    });
    setIsDailyDipModalOpen(true);
  };

  // Open Bowser Delivery Unload Dip Modal
  const handleOpenBowserDipModal = () => {
    const defaultTank = availableTanks[0];
    
    setBowserForm({
      date: new Date().toISOString().slice(0, 10),
      time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
      supervisor: 'Supervisor',
      tankId: defaultTank?.id || '',
      invoicedVolume: '6600',
      bowserNo: '',
      invoiceNo: '',
      driverName: '',
      sealIntact: true,
      waterTestNegative: true,
      density: defaultTank?.fuelType.toLowerCase().includes('diesel') ? '0.835' : '0.745',
      temperature: '29.5',
      remarks: '',
      preDipMm: '',
      preDipLiters: '',
      postDipMm: '',
      postDipLiters: '',
    });

    setIsBowserDipModalOpen(true);
  };

  // When Bowser Tank changes, update tank selection without pre-filling dip inputs
  const handleBowserTankChange = (newTankId: string) => {
    const targetTank = availableTanks.find(t => t.id === newTankId);
    if (targetTank) {
      setBowserForm(prev => ({
        ...prev,
        tankId: newTankId,
        density: targetTank.fuelType.toLowerCase().includes('diesel') ? '0.835' : '0.745',
      }));
    } else {
      setBowserForm(prev => ({ ...prev, tankId: newTankId }));
    }
  };

  // Toast Notification Trigger
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Fetch Dip Sessions directly from Supabase
  const fetchDipSessions = async () => {
    setIsLoading(true);
    setErrorMsg(null);

    // 1. Try local storage first for cached rendering if valid
    try {
      const stored = localStorage.getItem(STORAGE_KEY_SESSIONS);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setSessions(parsed);
        }
      }
    } catch (_) {}

    // 2. Fetch from Supabase
    try {
      const isConfigured = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
      if (!isConfigured) {
        setIsLoading(false);
        return;
      }

      let dipData: any[] | null = null;
      const { data, error } = await supabase
        .from('daily_dip_sessions')
        .select('*')
        .order('date', { ascending: false });

      if (!error && data) {
        dipData = data;
      } else {
        // Fallback check on daily_dip_records if daily_dip_sessions table is named differently
        const { data: recData } = await supabase
          .from('daily_dip_records')
          .select('*')
          .order('date', { ascending: false });
        if (recData) {
          dipData = recData;
        }
      }

      if (dipData) {
        if (dipData.length > 0) {
          const mappedSessions: DailyDipSession[] = dipData.map((d: any) => {
            const rawEntries = Array.isArray(d.entries) ? d.entries : (typeof d.entries === 'string' ? JSON.parse(d.entries) : []);
            const bowserAuditData = d.bowser_audit || d.bowserAudit || (typeof d.bowser_audit === 'string' ? JSON.parse(d.bowser_audit) : undefined);
            
            return {
              id: d.id,
              date: d.date || new Date().toISOString().slice(0, 10),
              time: d.time || '08:00',
              shift: d.shift || (d.session_type === 'bowser_delivery' ? 'Bowser Delivery Unload Audit' : 'Morning (06:00 - 14:00)'),
              sessionType: d.session_type || d.sessionType || (d.shift?.includes('Bowser') || bowserAuditData ? 'bowser_delivery' : 'daily_routine'),
              supervisor: d.supervisor || d.recorded_by || 'Supervisor',
              remarks: d.remarks || d.notes || '',
              entries: rawEntries,
              totalSystemVolume: Number(d.total_system_volume ?? d.totalSystemVolume) || 0,
              totalPhysicalDip: Number(d.total_physical_dip ?? d.totalPhysicalDip) || 0,
              totalVarianceLiters: Number(d.total_variance_liters ?? d.totalVarianceLiters) || 0,
              tanksCount: Number(d.tanks_count ?? d.tanksCount) || 0,
              createdAt: d.created_at || d.createdAt,
              bowserAudit: bowserAuditData
            };
          });
          setSessions(mappedSessions);
          try {
            localStorage.setItem(STORAGE_KEY_SESSIONS, JSON.stringify(mappedSessions));
          } catch (_) {}
        } else {
          setSessions([]);
          try {
            localStorage.setItem(STORAGE_KEY_SESSIONS, JSON.stringify([]));
          } catch (_) {}
        }
      }
    } catch (err) {
      console.warn("Error fetching daily dip sessions:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDipSessions();

    // Subscribe to real-time changes on daily_dip_sessions
    let realtimeChannel: any = null;
    try {
      const isConfigured = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
      if (isConfigured) {
        realtimeChannel = supabase
          .channel('public:daily_dip_sessions_realtime')
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'daily_dip_sessions' },
            (payload) => {
              if (payload.eventType === 'INSERT') {
                const d = payload.new;
                const newSession: DailyDipSession = {
                  id: d.id,
                  date: d.date || new Date().toISOString().slice(0, 10),
                  time: d.time || '08:00',
                  shift: d.shift || 'Morning (06:00 - 14:00)',
                  sessionType: d.session_type || d.sessionType || 'daily_routine',
                  supervisor: d.supervisor || d.recorded_by || 'Supervisor',
                  remarks: d.remarks || d.notes || '',
                  entries: Array.isArray(d.entries) ? d.entries : (typeof d.entries === 'string' ? JSON.parse(d.entries) : []),
                  totalSystemVolume: Number(d.total_system_volume ?? d.totalSystemVolume) || 0,
                  totalPhysicalDip: Number(d.total_physical_dip ?? d.totalPhysicalDip) || 0,
                  totalVarianceLiters: Number(d.total_variance_liters ?? d.totalVarianceLiters) || 0,
                  tanksCount: Number(d.tanks_count ?? d.tanksCount) || 0,
                  createdAt: d.created_at || d.createdAt,
                  bowserAudit: d.bowser_audit || d.bowserAudit
                };
                setSessions(prev => {
                  if (prev.some(s => s.id === newSession.id)) {
                    return prev.map(s => s.id === newSession.id ? newSession : s);
                  }
                  return [newSession, ...prev];
                });
              } else if (payload.eventType === 'UPDATE') {
                const d = payload.new;
                const updatedSession: DailyDipSession = {
                  id: d.id,
                  date: d.date,
                  time: d.time || '08:00',
                  shift: d.shift || 'Morning (06:00 - 14:00)',
                  sessionType: d.session_type || d.sessionType || 'daily_routine',
                  supervisor: d.supervisor || d.recorded_by || 'Supervisor',
                  remarks: d.remarks || d.notes || '',
                  entries: Array.isArray(d.entries) ? d.entries : (typeof d.entries === 'string' ? JSON.parse(d.entries) : []),
                  totalSystemVolume: Number(d.total_system_volume ?? d.totalSystemVolume) || 0,
                  totalPhysicalDip: Number(d.total_physical_dip ?? d.totalPhysicalDip) || 0,
                  totalVarianceLiters: Number(d.total_variance_liters ?? d.totalVarianceLiters) || 0,
                  tanksCount: Number(d.tanks_count ?? d.tanksCount) || 0,
                  createdAt: d.created_at || d.createdAt,
                  bowserAudit: d.bowser_audit || d.bowserAudit
                };
                setSessions(prev => prev.map(s => s.id === updatedSession.id ? updatedSession : s));
              } else if (payload.eventType === 'DELETE') {
                if (payload.old?.id) {
                  setSessions(prev => prev.filter(s => s.id !== payload.old.id));
                }
              }
            }
          )
          .subscribe();
      }
    } catch (err) {
      console.warn("Realtime subscription setup notice:", err);
    }

    return () => {
      if (realtimeChannel) {
        supabase.removeChannel(realtimeChannel);
      }
    };
  }, []);

  // Compute live multi-tank calculations for routine entry modal
  const modalCalculations = useMemo(() => {
    let totalSys = 0;
    let totalPhys = 0;
    let totalVar = 0;
    let hasAnyInput = false;

    const tankRows = availableTanks.map(tank => {
      const sysVol = Number(tank.currentLevel) || 0;
      const rawInput = dipInputs[tank.id];
      const physVol = rawInput !== undefined && rawInput.trim() !== '' ? Number(rawInput) : sysVol;
      
      if (rawInput !== undefined && rawInput.trim() !== '') {
        hasAnyInput = true;
      }

      const varianceL = physVol - sysVol;
      const varPct = sysVol > 0 ? (varianceL / sysVol) * 100 : 0;
      
      let status: 'Normal' | 'Gain' | 'Loss' | 'Warning' = 'Normal';
      if (Math.abs(varPct) > 1.5) {
        status = 'Warning';
      } else if (varianceL > 0) {
        status = 'Gain';
      } else if (varianceL < 0) {
        status = 'Loss';
      }

      totalSys += sysVol;
      totalPhys += physVol;
      totalVar += varianceL;

      return {
        tankId: tank.id,
        tankName: tank.name,
        fuelType: tank.fuelType,
        systemVolume: sysVol,
        physicalDip: physVol,
        rawInput: rawInput || '',
        varianceLiters: varianceL,
        variancePercentage: varPct,
        status
      };
    });

    return {
      tankRows,
      totalSys,
      totalPhys,
      totalVar,
      hasAnyInput
    };
  }, [availableTanks, dipInputs]);

  // Compute live Bowser Delivery Unload Audit calculations
  const bowserAuditCalculations = useMemo(() => {
    if (!selectedBowserTank) {
      return {
        invoicedVol: 0,
        preLiters: 0,
        postLiters: 0,
        actualReceived: 0,
        varianceLiters: 0,
        variancePercentage: 0,
        status: 'Exact Match' as 'Exact Match' | 'Excess' | 'Shortage',
        preMm: 0,
        postMm: 0,
        maxCapacity: 10000,
      };
    }

    const maxCapacity = selectedBowserTank.capacity;
    const invoicedVol = parseFloat(bowserForm.invoicedVolume) || 0;
    
    const preMm = parseFloat(bowserForm.preDipMm) || 0;
    const preLiters = bowserForm.preDipLiters !== '' 
      ? parseFloat(bowserForm.preDipLiters) || 0 
      : (preMm > 0 ? calculateDipVolume(preMm, maxCapacity) : 0);

    const postMm = parseFloat(bowserForm.postDipMm) || 0;
    const postLiters = bowserForm.postDipLiters !== '' 
      ? parseFloat(bowserForm.postDipLiters) || 0 
      : (postMm > 0 ? calculateDipVolume(postMm, maxCapacity) : 0);

    const hasReadings = (bowserForm.preDipMm !== '' || bowserForm.preDipLiters !== '') &&
                        (bowserForm.postDipMm !== '' || bowserForm.postDipLiters !== '');

    const actualReceived = hasReadings ? Math.max(0, postLiters - preLiters) : 0;
    const varianceLiters = hasReadings ? (actualReceived - invoicedVol) : 0;
    const variancePercentage = (hasReadings && invoicedVol > 0) ? (varianceLiters / invoicedVol) * 100 : 0;

    let status: 'Exact Match' | 'Excess' | 'Shortage' = 'Exact Match';
    if (hasReadings) {
      if (Math.abs(varianceLiters) < 0.5) {
        status = 'Exact Match';
      } else if (varianceLiters > 0.5) {
        status = 'Excess';
      } else {
        status = 'Shortage';
      }
    }

    return {
      invoicedVol,
      preLiters,
      postLiters,
      actualReceived,
      varianceLiters,
      variancePercentage,
      status,
      hasReadings,
      preMm,
      postMm,
      maxCapacity,
    };
  }, [selectedBowserTank, bowserForm]);

  // Handle Save All-Tanks Daily Routine Dip Record
  const handleSaveDailyDip = async (e: React.FormEvent) => {
    e.preventDefault();

    const tankEntries: TankDipEntry[] = modalCalculations.tankRows.map(row => ({
      tankId: row.tankId,
      tankName: row.tankName,
      fuelType: row.fuelType,
      systemVolume: row.systemVolume,
      physicalDip: row.physicalDip,
      varianceLiters: row.varianceLiters,
      variancePercentage: row.variancePercentage,
      status: row.status
    }));

    const newSession: DailyDipSession = {
      id: `dip_session_${Date.now()}`,
      date: formData.date || new Date().toISOString().slice(0, 10),
      time: formData.time || '08:00',
      shift: formData.shift,
      sessionType: 'daily_routine',
      supervisor: formData.supervisor || 'Supervisor',
      remarks: formData.remarks,
      entries: tankEntries,
      totalSystemVolume: modalCalculations.totalSys,
      totalPhysicalDip: modalCalculations.totalPhys,
      totalVarianceLiters: modalCalculations.totalVar,
      tanksCount: tankEntries.length,
      createdAt: new Date().toISOString()
    };

    // Optimistic UI state update
    const updatedSessions = [newSession, ...sessions];
    setSessions(updatedSessions);
    try {
      localStorage.setItem(STORAGE_KEY_SESSIONS, JSON.stringify(updatedSessions));
    } catch (_) {}

    setIsDailyDipModalOpen(false);
    showToast(`Daily Dip Record (${tankEntries.length} tanks) saved successfully!`);

    // Sync to Supabase
    try {
      const payload = {
        id: newSession.id,
        date: newSession.date,
        time: newSession.time,
        shift: newSession.shift,
        session_type: 'daily_routine',
        supervisor: newSession.supervisor,
        remarks: newSession.remarks,
        entries: newSession.entries,
        total_system_volume: newSession.totalSystemVolume,
        total_physical_dip: newSession.totalPhysicalDip,
        total_variance_liters: newSession.totalVarianceLiters,
        tanks_count: newSession.tanksCount,
        created_at: newSession.createdAt
      };

      const { error } = await supabase.from('daily_dip_sessions').insert([payload]);
      if (error) {
        const { error: err2 } = await supabase.from('daily_dip_records').insert([payload]);
        if (err2) {
          console.warn("Supabase insert notice for dip records:", err2.message);
        }
      }
    } catch (err) {
      console.warn("Supabase dip insert error:", err);
    }
  };

  // Handle Save Bowser Delivery Unload Audit Record
  const handleSaveBowserDeliveryAudit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedBowserTank) {
      showToast("Please select a target fuel tank.");
      return;
    }

    const { 
      invoicedVol, preLiters, postLiters, actualReceived, 
      varianceLiters, variancePercentage, status, preMm, postMm 
    } = bowserAuditCalculations;

    if (invoicedVol <= 0) {
      showToast("Please enter a valid invoiced bowser delivery volume.");
      return;
    }

    if (postLiters <= preLiters && postMm <= preMm) {
      showToast("Post-unload dip reading must be greater than pre-unload dip reading.");
      return;
    }

    const bowserAuditData: BowserDeliveryDipData = {
      tankId: selectedBowserTank.id,
      tankName: selectedBowserTank.name,
      fuelType: selectedBowserTank.fuelType,
      invoicedVolume: invoicedVol,
      preDipMm: preMm,
      preDipLiters: preLiters,
      postDipMm: postMm,
      postDipLiters: postLiters,
      actualReceivedVolume: actualReceived,
      varianceLiters: varianceLiters,
      variancePercentage: variancePercentage,
      status: status,
      bowserNo: bowserForm.bowserNo.trim() || undefined,
      invoiceNo: bowserForm.invoiceNo.trim() || undefined,
      driverName: bowserForm.driverName.trim() || undefined,
      sealIntact: bowserForm.sealIntact,
      waterTestNegative: bowserForm.waterTestNegative,
      density: parseFloat(bowserForm.density) || undefined,
      temperature: parseFloat(bowserForm.temperature) || undefined,
    };

    const tankEntry: TankDipEntry = {
      tankId: selectedBowserTank.id,
      tankName: selectedBowserTank.name,
      fuelType: selectedBowserTank.fuelType,
      systemVolume: preLiters,
      physicalDip: postLiters,
      varianceLiters: varianceLiters,
      variancePercentage: variancePercentage,
      status: status === 'Exact Match' ? 'Normal' : status === 'Excess' ? 'Gain' : 'Loss',
      dipMm: postMm,
      notes: `Pre-Dip: ${preMm}mm (${preLiters.toLocaleString()}L) | Post-Dip: ${postMm}mm (${postLiters.toLocaleString()}L) | Invoiced: ${invoicedVol.toLocaleString()}L | Decanted: ${actualReceived.toLocaleString()}L`
    };

    const newSession: DailyDipSession = {
      id: `bowser_dip_${Date.now()}`,
      date: bowserForm.date || new Date().toISOString().slice(0, 10),
      time: bowserForm.time || '08:00',
      shift: 'Bowser Delivery Unload Audit',
      sessionType: 'bowser_delivery',
      supervisor: bowserForm.supervisor || 'Supervisor',
      remarks: bowserForm.remarks || `Bowser Unload Audit for ${selectedBowserTank.name} (${selectedBowserTank.fuelType}) - Invoiced: ${invoicedVol.toLocaleString()}L, Received: ${actualReceived.toLocaleString()}L, Variance: ${varianceLiters >= 0 ? '+' : ''}${varianceLiters.toFixed(1)}L`,
      entries: [tankEntry],
      totalSystemVolume: preLiters + invoicedVol,
      totalPhysicalDip: postLiters,
      totalVarianceLiters: varianceLiters,
      tanksCount: 1,
      createdAt: new Date().toISOString(),
      bowserAudit: bowserAuditData
    };

    // Optimistic UI state update
    const updatedSessions = [newSession, ...sessions];
    setSessions(updatedSessions);
    try {
      localStorage.setItem(STORAGE_KEY_SESSIONS, JSON.stringify(updatedSessions));
    } catch (_) {}

    setIsBowserDipModalOpen(false);
    showToast(`Bowser Unload Audit (${selectedBowserTank.name}) saved! Variance: ${varianceLiters >= 0 ? '+' : ''}${varianceLiters.toFixed(1)} L`);

    // Sync to Supabase
    try {
      const payload = {
        id: newSession.id,
        date: newSession.date,
        time: newSession.time,
        shift: newSession.shift,
        session_type: 'bowser_delivery',
        supervisor: newSession.supervisor,
        remarks: newSession.remarks,
        entries: newSession.entries,
        total_system_volume: newSession.totalSystemVolume,
        total_physical_dip: newSession.totalPhysicalDip,
        total_variance_liters: newSession.totalVarianceLiters,
        tanks_count: 1,
        created_at: newSession.createdAt,
        bowser_audit: bowserAuditData
      };

      const { error } = await supabase.from('daily_dip_sessions').insert([payload]);
      if (error) {
        const { error: err2 } = await supabase.from('daily_dip_records').insert([payload]);
        if (err2) {
          console.warn("Supabase insert notice for bowser dip audit:", err2.message);
        }
      }
    } catch (err) {
      console.warn("Supabase bowser dip insert error:", err);
    }
  };

  // Filtered Sessions with mode, search, and shift filter
  const filteredSessions = useMemo(() => {
    return sessions.filter(session => {
      const isBowser = session.sessionType === 'bowser_delivery' || !!session.bowserAudit || session.shift?.includes('Bowser');
      
      if (typeFilter === 'bowser_delivery' && !isBowser) return false;
      if (typeFilter === 'daily_routine' && isBowser) return false;

      const matchesSearch = 
        session.date.includes(searchQuery) ||
        session.supervisor.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (session.remarks || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        session.shift.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (session.bowserAudit?.bowserNo || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (session.bowserAudit?.invoiceNo || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (session.bowserAudit?.tankName || '').toLowerCase().includes(searchQuery.toLowerCase());

      const matchesShift = selectedShiftFilter === 'all' || session.shift === selectedShiftFilter;

      return matchesSearch && matchesShift;
    });
  }, [sessions, searchQuery, selectedShiftFilter, typeFilter]);

  // Master Export CSV Functionality
  const exportMasterCSV = () => {
    if (sessions.length === 0) {
      showToast("No dip records available to export.");
      return;
    }

    const headers = [
      'Audit Date', 'Audit Time', 'Audit Type', 'Shift/Session', 'Supervisor', 
      'Tanks Involved', 'Invoiced Vol (L)', 'Actual Received (L)', 'Pre-Dip (L)', 'Post-Dip (L)',
      'Net Variance (L)', 'Variance (%)', 'Status', 'Bowser No', 'Invoice No', 'Remarks'
    ];

    const rows = sessions.map(s => {
      const isBowser = s.sessionType === 'bowser_delivery' || !!s.bowserAudit;
      const b = s.bowserAudit;
      return [
        s.date,
        s.time,
        isBowser ? 'Bowser Delivery Unload Audit' : 'Daily Routine Audit',
        `"${s.shift}"`,
        `"${s.supervisor}"`,
        isBowser ? `"${b?.tankName || 'Tank'}"` : s.tanksCount,
        isBowser ? (b?.invoicedVolume || 0) : '-',
        isBowser ? (b?.actualReceivedVolume || 0) : '-',
        isBowser ? (b?.preDipLiters || 0) : s.totalSystemVolume.toFixed(2),
        isBowser ? (b?.postDipLiters || 0) : s.totalPhysicalDip.toFixed(2),
        s.totalVarianceLiters.toFixed(2),
        isBowser ? `${(b?.variancePercentage || 0).toFixed(2)}%` : `${s.totalSystemVolume > 0 ? ((s.totalVarianceLiters / s.totalSystemVolume) * 100).toFixed(2) : 0}%`,
        isBowser ? b?.status || 'Normal' : (s.totalVarianceLiters >= 0 ? 'Gain' : 'Loss'),
        `"${b?.bowserNo || ''}"`,
        `"${b?.invoiceNo || ''}"`,
        `"${(s.remarks || '').replace(/"/g, '""')}"`
      ];
    });

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Dip_Audit_Master_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("Dip Audit Records exported to CSV successfully.");
  };

  // Single Session CSV Export
  const exportSingleSessionCSV = (session: DailyDipSession) => {
    const isBowser = session.sessionType === 'bowser_delivery' || !!session.bowserAudit;
    const b = session.bowserAudit;

    if (isBowser && b) {
      const headers = ['Metric', 'Value'];
      const rows = [
        ['Audit Type', 'Bowser Delivery Unload Audit (Pre & Post Dip)'],
        ['Date', session.date],
        ['Time', session.time],
        ['Supervisor', session.supervisor],
        ['Tank', b.tankName],
        ['Fuel Grade', b.fuelType],
        ['Bowser Vehicle No', b.bowserNo || 'N/A'],
        ['Invoice / Ref No', b.invoiceNo || 'N/A'],
        ['Invoiced Bowser Volume (L)', b.invoicedVolume.toFixed(2)],
        ['Pre-Unload Dip (mm)', b.preDipMm.toString()],
        ['Pre-Unload Volume (L)', b.preDipLiters.toFixed(2)],
        ['Post-Unload Dip (mm)', b.postDipMm.toString()],
        ['Post-Unload Volume (L)', b.postDipLiters.toFixed(2)],
        ['Actual Received Volume (L)', b.actualReceivedVolume.toFixed(2)],
        ['Decanting Variance (L)', b.varianceLiters.toFixed(2)],
        ['Variance Percentage (%)', `${b.variancePercentage.toFixed(2)}%`],
        ['Audit Status', b.status],
        ['Free Water Test', b.waterTestNegative ? 'Negative (Passed)' : 'Failed'],
        ['Chamber Seal', b.sealIntact ? 'Intact & Verified' : 'Compromised'],
        ['Density (kg/L)', b.density ? b.density.toString() : 'N/A'],
        ['Temperature (°C)', b.temperature ? `${b.temperature}°C` : 'N/A'],
        ['Remarks', session.remarks || '']
      ];

      const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => `"${r[0]}","${(r[1] || '').toString().replace(/"/g, '""')}"`)].join('\n');
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement('a');
      link.setAttribute('href', encodedUri);
      link.setAttribute('download', `Bowser_Unload_Audit_${b.tankName.replace(/\s+/g, '_')}_${session.date}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return;
    }

    const headers = [
      'Audit Date', 'Shift', 'Tank Name', 'Fuel Grade', 
      'System Volume (L)', 'Physical Dip (L)', 'Variance (L)', 'Variance (%)', 'Status', 'Supervisor'
    ];

    const rows = session.entries.map(e => [
      session.date,
      `"${session.shift}"`,
      `"${e.tankName}"`,
      `"${e.fuelType}"`,
      e.systemVolume.toFixed(2),
      e.physicalDip.toFixed(2),
      e.varianceLiters.toFixed(2),
      `${e.variancePercentage.toFixed(2)}%`,
      e.status,
      `"${session.supervisor}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Dip_Breakdown_${session.date}_${session.shift.replace(/\s+/g, '_')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6 font-sans">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-5 right-5 z-50 bg-slate-900 text-white px-4 py-3 rounded-2xl shadow-xl flex items-center gap-2.5 text-xs font-semibold animate-in fade-in slide-in-from-top-2 duration-200">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Action Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-blue-50 text-blue-600 rounded-xl border border-blue-100">
              <Droplet className="w-4 h-4" />
            </div>
            <h1 className="text-lg font-bold text-slate-900 tracking-tight font-sans">Manual Dip Record &amp; Stock Audit</h1>
          </div>
          <p className="text-xs text-gray-500 font-medium pl-0.5">
            Record multi-tank daily routine physical dips or perform pre &amp; post bowser delivery unload tests to verify invoice quantities.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 self-start sm:self-auto w-full sm:w-auto justify-end">
          <button
            onClick={exportMasterCSV}
            disabled={sessions.length === 0}
            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-white hover:bg-gray-50 disabled:opacity-50 text-gray-700 border border-gray-200 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-2xs"
          >
            <Download className="w-3.5 h-3.5 text-gray-600" />
            <span>Export CSV</span>
          </button>

          {/* Grouped Dip Audit Buttons Side-by-Side */}
          <div className="flex flex-row items-center gap-2.5 sm:gap-3">
            {/* Button 1: Record Daily Dip Audit */}
            <button
              id="btn-add-daily-dip"
              onClick={handleOpenDailyDipModal}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 sm:px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-xs hover:shadow-sm active:scale-95 whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>+ Record Daily Dip Audit</span>
            </button>

            {/* Button 2: Bowser Unload Dip Audit */}
            <button
              id="btn-add-bowser-dip"
              onClick={handleOpenBowserDipModal}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 sm:px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-xs hover:shadow-sm active:scale-95 whitespace-nowrap"
            >
              <Truck className="w-4 h-4" />
              <span>+ Bowser Unload Dip Audit</span>
            </button>
          </div>
        </div>
      </div>

      {/* Master Daily Dip History List Table */}
      <div className="bg-white rounded-2xl border border-gray-200/80 p-5 shadow-2xs space-y-4">
        {/* Controls Header & Type Switcher */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-gray-100">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Type Filter Tabs */}
            <div className="inline-flex p-1 bg-gray-100 rounded-xl text-xs font-bold">
              <button
                onClick={() => setTypeFilter('all')}
                className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${typeFilter === 'all' ? 'bg-white text-blue-600 shadow-2xs' : 'text-gray-600 hover:text-gray-900'}`}
              >
                All Audits ({sessions.length})
              </button>
              <button
                onClick={() => setTypeFilter('daily_routine')}
                className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${typeFilter === 'daily_routine' ? 'bg-white text-blue-600 shadow-2xs' : 'text-gray-600 hover:text-gray-900'}`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Routine Dips</span>
              </button>
              <button
                onClick={() => setTypeFilter('bowser_delivery')}
                className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${typeFilter === 'bowser_delivery' ? 'bg-white text-amber-700 shadow-2xs' : 'text-gray-600 hover:text-gray-900'}`}
              >
                <Truck className="w-3.5 h-3.5" />
                <span>Bowser Unload Audits</span>
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2.5 flex-1 max-w-lg justify-end">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search by date, tank, bowser no, invoice..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>

            <select
              value={selectedShiftFilter}
              onChange={(e) => setSelectedShiftFilter(e.target.value)}
              className="px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 shrink-0"
            >
              <option value="all">All Shifts</option>
              <option value="Morning (06:00 - 14:00)">Morning</option>
              <option value="Evening (14:00 - 22:00)">Evening</option>
              <option value="Night (22:00 - 06:00)">Night</option>
              <option value="Bowser Delivery Unload Audit">Bowser Delivery</option>
              <option value="Daily Audit / Dip Reconciliation">Daily Reconciliation</option>
            </select>
          </div>
        </div>

        {/* Database Notice if error */}
        {errorMsg && (
          <div className="p-3 bg-amber-50 border border-amber-200 text-amber-900 rounded-xl text-xs font-medium flex items-center justify-between">
            <span>{errorMsg}</span>
            <button onClick={fetchDipSessions} className="underline font-bold text-amber-950 cursor-pointer">Retry</button>
          </div>
        )}

        {/* Master History Table */}
        {isLoading && sessions.length === 0 ? (
          <div className="py-12 text-center text-xs text-gray-400 font-semibold animate-pulse">
            Loading dip audit history...
          </div>
        ) : filteredSessions.length > 0 ? (
          <div className="overflow-x-auto border border-gray-100 rounded-xl">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 font-bold text-gray-500 text-[10px] uppercase border-b border-gray-100">
                <tr>
                  <th className="p-3.5">Audit Date &amp; Time</th>
                  <th className="p-3.5">Audit Type / Scope</th>
                  <th className="p-3.5">Supervisor / Driver</th>
                  <th className="p-3.5">Pre-Dip Level</th>
                  <th className="p-3.5">Post-Dip / Book Level</th>
                  <th className="p-3.5 text-right">Invoiced / Received</th>
                  <th className="p-3.5 text-right">Decanting Variance</th>
                  <th className="p-3.5 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 font-medium text-gray-800">
                {filteredSessions.map((session) => {
                  const isBowser = session.sessionType === 'bowser_delivery' || !!session.bowserAudit;
                  const b = session.bowserAudit;
                  const isLoss = session.totalVarianceLiters < -0.4;
                  const isGain = session.totalVarianceLiters > 0.4;
                  const varPct = isBowser && b?.invoicedVolume 
                    ? b.variancePercentage 
                    : (session.totalSystemVolume > 0 ? (session.totalVarianceLiters / session.totalSystemVolume) * 100 : 0);

                  return (
                    <tr 
                      key={session.id} 
                      className={`transition-colors group cursor-pointer ${isBowser ? 'hover:bg-amber-50/40 bg-amber-50/15' : 'hover:bg-blue-50/30'}`}
                      onClick={() => setSelectedDetailSession(session)}
                    >
                      <td className="p-3.5 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <Calendar className={`w-3.5 h-3.5 ${isBowser ? 'text-amber-600' : 'text-blue-600'}`} />
                          <span className="font-bold text-slate-900">{session.date}</span>
                          <span className="text-[11px] text-gray-400 font-medium">{session.time}</span>
                        </div>
                      </td>

                      <td className="p-3.5 whitespace-nowrap">
                        {isBowser ? (
                          <div className="flex items-center gap-1.5">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-100/80 text-amber-900 text-[11px] font-bold border border-amber-200">
                              <Truck className="w-3 h-3 text-amber-700" />
                              <span>Bowser Unload</span>
                            </span>
                            {b && (
                              <span className="text-[11px] font-semibold text-slate-700">
                                {b.tankName} ({b.fuelType})
                              </span>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 text-[11px] font-semibold border border-blue-100">
                              <Layers className="w-3 h-3" />
                              <span>Routine Audit</span>
                            </span>
                            <span className="text-[11px] text-gray-500 font-medium">
                              ({session.tanksCount || (session.entries?.length ?? 0)} Tanks)
                            </span>
                          </div>
                        )}
                      </td>

                      <td className="p-3.5 text-gray-700 font-semibold whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5 text-gray-400" />
                          <span>{session.supervisor}</span>
                        </div>
                        {isBowser && b?.bowserNo && (
                          <div className="text-[10px] text-amber-800 font-medium pl-5">
                            Bowser: {b.bowserNo} {b.driverName ? `• ${b.driverName}` : ''}
                          </div>
                        )}
                      </td>

                      {/* Pre-Dip */}
                      <td className="p-3.5 whitespace-nowrap">
                        {isBowser && b ? (
                          <div>
                            <span className="font-bold text-slate-900 tabular-nums">
                              {b.preDipLiters.toLocaleString('en-LK', { maximumFractionDigits: 1 })} L
                            </span>
                            <span className="text-[10px] text-gray-400 font-medium ml-1">
                              ({b.preDipMm} mm)
                            </span>
                          </div>
                        ) : (
                          <span className="text-gray-500 font-medium text-[11px]">
                            Opening Book: {session.totalSystemVolume.toLocaleString('en-LK', { maximumFractionDigits: 1 })} L
                          </span>
                        )}
                      </td>

                      {/* Post-Dip */}
                      <td className="p-3.5 whitespace-nowrap">
                        {isBowser && b ? (
                          <div>
                            <span className="font-bold text-slate-900 tabular-nums">
                              {b.postDipLiters.toLocaleString('en-LK', { maximumFractionDigits: 1 })} L
                            </span>
                            <span className="text-[10px] text-gray-400 font-medium ml-1">
                              ({b.postDipMm} mm)
                            </span>
                          </div>
                        ) : (
                          <span className="font-bold text-slate-900 tabular-nums">
                            {session.totalPhysicalDip.toLocaleString('en-LK', { maximumFractionDigits: 1 })} L
                          </span>
                        )}
                      </td>

                      {/* Invoiced vs Received */}
                      <td className="p-3.5 text-right whitespace-nowrap">
                        {isBowser && b ? (
                          <div className="text-right">
                            <div className="font-bold text-slate-900 tabular-nums">
                              {b.actualReceivedVolume.toLocaleString('en-LK', { maximumFractionDigits: 1 })} L
                            </div>
                            <div className="text-[10px] text-gray-400 font-medium">
                              Inv: {b.invoicedVolume.toLocaleString()} L
                            </div>
                          </div>
                        ) : (
                          <span className="text-gray-600 font-semibold tabular-nums">
                            {session.totalPhysicalDip.toLocaleString('en-LK', { maximumFractionDigits: 1 })} L
                          </span>
                        )}
                      </td>

                      {/* Decanting Variance Badge */}
                      <td className="p-3.5 text-right whitespace-nowrap">
                        {isBowser && b ? (
                          b.status === 'Exact Match' || Math.abs(b.varianceLiters) < 0.5 ? (
                            <span className="inline-flex items-center gap-1 font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200 text-[11px]">
                              <CheckCircle className="w-3 h-3 text-emerald-600" />
                              <span>Exact Match (0L)</span>
                            </span>
                          ) : b.status === 'Excess' || b.varianceLiters > 0 ? (
                            <span className="inline-flex items-center gap-1 font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200 text-[11px]">
                              <TrendingUp className="w-3 h-3 shrink-0" />
                              <span>Excess (+{b.varianceLiters.toFixed(1)}L)</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-md border border-rose-200 text-[11px]">
                              <TrendingDown className="w-3 h-3 shrink-0" />
                              <span>Shortage ({b.varianceLiters.toFixed(1)}L)</span>
                            </span>
                          )
                        ) : (
                          isLoss ? (
                            <span className="inline-flex items-center gap-1 font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-md border border-rose-200 text-[11px]">
                              <TrendingDown className="w-3 h-3 shrink-0" />
                              <span>{session.totalVarianceLiters.toFixed(1)} L ({varPct.toFixed(2)}%)</span>
                            </span>
                          ) : isGain ? (
                            <span className="inline-flex items-center gap-1 font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200 text-[11px]">
                              <TrendingUp className="w-3 h-3 shrink-0" />
                              <span>+{session.totalVarianceLiters.toFixed(1)} L (+{varPct.toFixed(2)}%)</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 font-semibold text-gray-600 bg-gray-50 px-2 py-0.5 rounded-md border border-gray-200 text-[11px]">
                              <span>0.0 L (0.00%)</span>
                            </span>
                          )
                        )}
                      </td>

                      <td className="p-3.5 text-center whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => setSelectedDetailSession(session)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-[11px] font-bold transition-all cursor-pointer"
                            title="View Full Breakdown & Audit Details"
                          >
                            <Eye className="w-3 h-3" />
                            <span>Audit Details</span>
                          </button>

                          <button
                            onClick={() => exportSingleSessionCSV(session)}
                            className="p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
                            title="Export CSV"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : sessions.length === 0 ? (
          <div id="no-dip-records-empty-card" className="bg-gray-50/70 rounded-2xl border border-dashed border-gray-200 p-10 text-center space-y-3">
            <div className="w-12 h-12 bg-blue-50 border border-blue-100 rounded-2xl flex items-center justify-center mx-auto text-blue-600">
              <Droplet className="w-6 h-6" />
            </div>
            <h4 className="text-sm font-bold text-gray-900 font-sans">No Dip Records Found</h4>
            <p className="text-xs text-gray-500 max-w-md mx-auto font-medium leading-relaxed font-sans">
              No dip records found. Choose an action below to record routine tank dips or perform a bowser unloading audit.
            </p>
            <div className="pt-2 flex items-center justify-center gap-2 flex-wrap">
              <button
                onClick={handleOpenDailyDipModal}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-sm active:scale-95"
              >
                <Plus className="w-4 h-4" />
                <span>+ Record Daily Dip Audit</span>
              </button>
              <button
                onClick={handleOpenBowserDipModal}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-sm active:scale-95"
              >
                <Truck className="w-4 h-4" />
                <span>+ Bowser Unload Dip Audit</span>
              </button>
            </div>
          </div>
        ) : (
          <div id="no-filtered-dips-card" className="bg-gray-50/70 rounded-2xl border border-dashed border-gray-200 p-10 text-center space-y-3">
            <div className="w-12 h-12 bg-gray-100 border border-gray-200 rounded-2xl flex items-center justify-center mx-auto text-gray-500">
              <Search className="w-6 h-6" />
            </div>
            <h4 className="text-sm font-bold text-gray-900 font-sans">No Matching Dip Records</h4>
            <p className="text-xs text-gray-500 max-w-md mx-auto font-medium font-sans">
              No daily dip records match your current search, mode, or shift filter.
            </p>
            <div className="pt-2">
              <button
                onClick={() => {
                  setSearchQuery('');
                  setSelectedShiftFilter('all');
                  setTypeFilter('all');
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-xl text-xs font-semibold transition-all cursor-pointer"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Clear Filters</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* 1. DEDICATED DAILY ROUTINE DIP AUDIT MODAL (ALL TANKS)                    */}
      {/* ========================================================================= */}
      {isDailyDipModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-4xl w-full p-5 sm:p-7 shadow-2xl border border-gray-200 my-auto max-h-[92vh] flex flex-col">
            {/* Modal Header */}
            <div className="pb-4 border-b border-gray-100 shrink-0 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-blue-50 text-blue-600 rounded-xl border border-blue-100">
                  <Droplet className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 tracking-tight font-sans">
                    Record All-Tanks Daily Dip Audit
                  </h3>
                  <p className="text-xs text-gray-500 font-medium">
                    Simultaneously enter physical measured dip volumes across all registered underground tanks.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsDailyDipModalOpen(false)}
                className="p-1.5 hover:bg-gray-100 text-gray-400 hover:text-gray-600 rounded-xl transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Daily Routine Form */}
            <form onSubmit={handleSaveDailyDip} className="space-y-5 overflow-y-auto pt-4 flex-1 pr-1">
              {/* Global Metadata Inputs */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 bg-slate-50/80 p-3.5 rounded-2xl border border-slate-200/80 text-xs">
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">Audit Date</label>
                  <input
                    type="date"
                    required
                    value={formData.date}
                    onChange={(e) => setFormData(p => ({ ...p, date: e.target.value }))}
                    className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-semibold"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-gray-700 mb-1">Time</label>
                  <input
                    type="time"
                    required
                    value={formData.time}
                    onChange={(e) => setFormData(p => ({ ...p, time: e.target.value }))}
                    className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-semibold"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-gray-700 mb-1">Shift / Session</label>
                  <select
                    value={formData.shift}
                    onChange={(e) => setFormData(p => ({ ...p, shift: e.target.value }))}
                    className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-semibold"
                  >
                    <option value="Morning (06:00 - 14:00)">Morning (06:00 - 14:00)</option>
                    <option value="Evening (14:00 - 22:00)">Evening (14:00 - 22:00)</option>
                    <option value="Night (22:00 - 06:00)">Night (22:00 - 06:00)</option>
                    <option value="Daily Audit / Dip Reconciliation">Daily Audit / Dip Reconciliation</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-gray-700 mb-1">Supervisor Name</label>
                  <input
                    type="text"
                    required
                    placeholder="Supervisor"
                    value={formData.supervisor}
                    onChange={(e) => setFormData(p => ({ ...p, supervisor: e.target.value }))}
                    className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-semibold"
                  />
                </div>
              </div>

              {/* Tank-by-Tank Multi-Entry Table */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                    Underground Storage Tanks Dip Measurements ({availableTanks.length} Tanks)
                  </h4>
                  <span className="text-[11px] text-gray-500 font-medium">
                    Auto-calculates variance = (Physical Dip - System Book Volume)
                  </span>
                </div>

                <div className="border border-gray-200 rounded-xl overflow-x-auto shadow-2xs">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100 text-slate-700 font-bold uppercase text-[10px] border-b border-gray-200">
                      <tr>
                        <th className="p-3">#</th>
                        <th className="p-3">Tank Identifier &amp; Grade</th>
                        <th className="p-3 text-right">System Book Volume (L)</th>
                        <th className="p-3 text-right w-44">Physical Dip Input (L)</th>
                        <th className="p-3 text-right">Live Variance (L)</th>
                        <th className="p-3 text-center">Variance % &amp; Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 font-medium text-slate-800">
                      {modalCalculations.tankRows.map((row, idx) => {
                        const isLoss = row.varianceLiters < 0;
                        const isGain = row.varianceLiters > 0;
                        return (
                          <tr key={row.tankId} className="hover:bg-slate-50/60 transition-colors">
                            <td className="p-3 text-center text-gray-400 font-bold">{idx + 1}</td>
                            <td className="p-3">
                              <div className="font-bold text-slate-900">{row.tankName}</div>
                              <div className="text-[11px] text-gray-500">{row.fuelType}</div>
                            </td>

                            <td className="p-3 text-right text-slate-600 font-semibold tabular-nums">
                              {row.systemVolume.toLocaleString('en-LK', { maximumFractionDigits: 1 })} L
                            </td>

                            <td className="p-3 text-right">
                              <div className="relative">
                                <input
                                  type="number"
                                  step="any"
                                  min="0"
                                  placeholder={row.systemVolume.toString()}
                                  value={dipInputs[row.tankId] ?? ''}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setDipInputs(prev => ({ ...prev, [row.tankId]: val }));
                                  }}
                                  className="w-full px-3 py-1.5 text-right font-bold text-slate-900 bg-white border border-blue-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 tabular-nums text-xs"
                                />
                              </div>
                            </td>

                            <td className="p-3 text-right whitespace-nowrap tabular-nums">
                              {isLoss ? (
                                <span className="font-bold text-rose-600">
                                  {row.varianceLiters.toFixed(1)} L
                                </span>
                              ) : isGain ? (
                                <span className="font-bold text-emerald-600">
                                  +{row.varianceLiters.toFixed(1)} L
                                </span>
                              ) : (
                                <span className="font-semibold text-gray-500">0.0 L</span>
                              )}
                            </td>

                            <td className="p-3 text-center whitespace-nowrap">
                              {row.status === 'Warning' ? (
                                <span className="inline-flex items-center gap-1 font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200 text-[10px]">
                                  <AlertTriangle className="w-3 h-3" />
                                  <span>{row.variancePercentage.toFixed(2)}% (High Deviation)</span>
                                </span>
                              ) : isLoss ? (
                                <span className="inline-flex items-center gap-1 font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-md border border-rose-200 text-[10px]">
                                  <TrendingDown className="w-3 h-3" />
                                  <span>{row.variancePercentage.toFixed(2)}% Loss</span>
                                </span>
                              ) : isGain ? (
                                <span className="inline-flex items-center gap-1 font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200 text-[10px]">
                                  <TrendingUp className="w-3 h-3" />
                                  <span>+{row.variancePercentage.toFixed(2)}% Gain</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 font-semibold text-gray-600 bg-gray-50 px-2 py-0.5 rounded-md text-[10px]">
                                  <span>0.00% Balanced</span>
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    {/* Multi-Tank Totals Summary Footer */}
                    <tfoot className="bg-slate-50 border-t-2 border-slate-300 font-bold text-xs">
                      <tr>
                        <td colSpan={2} className="p-3 text-slate-800 uppercase tracking-wider font-extrabold">
                          Total All Tanks:
                        </td>
                        <td className="p-3 text-right text-slate-700 tabular-nums">
                          {modalCalculations.totalSys.toLocaleString('en-LK', { maximumFractionDigits: 1 })} L
                        </td>
                        <td className="p-3 text-right text-slate-900 font-extrabold tabular-nums">
                          {modalCalculations.totalPhys.toLocaleString('en-LK', { maximumFractionDigits: 1 })} L
                        </td>
                        <td className="p-3 text-right tabular-nums">
                          <span className={modalCalculations.totalVar >= 0 ? 'text-emerald-700 font-extrabold' : 'text-rose-600 font-extrabold'}>
                            {modalCalculations.totalVar >= 0 ? `+${modalCalculations.totalVar.toFixed(1)} L` : `${modalCalculations.totalVar.toFixed(1)} L`}
                          </span>
                        </td>
                        <td className="p-3 text-center">
                          <span className={`text-[11px] font-extrabold ${modalCalculations.totalVar >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                            {modalCalculations.totalSys > 0 ? ((modalCalculations.totalVar / modalCalculations.totalSys) * 100).toFixed(2) : '0.00'}% Net
                          </span>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* General Remarks Input */}
              <div className="text-xs">
                <label className="block font-semibold text-gray-700 mb-1">Audit Remarks &amp; Observations (Optional)</label>
                <textarea
                  rows={2}
                  placeholder="e.g., Dip measurements recorded after shift changeover. Calibration dip rod verified clean with water-finding paste..."
                  value={formData.remarks}
                  onChange={(e) => setFormData(p => ({ ...p, remarks: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-medium"
                />
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-gray-100 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsDailyDipModalOpen(false)}
                  className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-sm hover:shadow-md active:scale-95"
                >
                  <Check className="w-4 h-4" />
                  <span>Save Daily Dip Record</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. DEDICATED BOWSER UNLOADING DIP AUDIT MODAL (MINIMAL & ULTRA FAST)      */}
      {/* ========================================================================= */}
      {isBowserDipModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-xl w-full p-5 sm:p-6 shadow-2xl border border-gray-200 my-auto flex flex-col space-y-4">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-gray-100 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-amber-50 text-amber-700 rounded-xl border border-amber-200">
                  <Truck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 tracking-tight font-sans">
                    Bowser Unload Dip Audit
                  </h3>
                  <p className="text-xs text-gray-500 font-medium">
                    Verify bowser delivery invoice vs. physical dip changes.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsBowserDipModalOpen(false)}
                className="p-1.5 hover:bg-gray-100 text-gray-400 hover:text-gray-600 rounded-xl transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Bowser Form Content */}
            <form onSubmit={handleSaveBowserDeliveryAudit} className="space-y-4">
              {/* 1. Tank Selection & Invoiced Quantity */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200/80">
                {/* Tank Select */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1">
                    <Fuel className="w-3.5 h-3.5 text-amber-600" />
                    <span>Select Tank</span>
                  </label>
                  <select
                    value={bowserForm.tankId}
                    onChange={(e) => handleBowserTankChange(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-gray-300 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                  >
                    {availableTanks.map(tank => (
                      <option key={tank.id} value={tank.id}>
                        {tank.name} ({tank.fuelType}) — Cap: {tank.capacity.toLocaleString()} L
                      </option>
                    ))}
                  </select>
                </div>

                {/* Invoiced Bowser Volume */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Invoiced Volume (Liters) *
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      step="any"
                      required
                      min="1"
                      placeholder="e.g. 6600"
                      value={bowserForm.invoicedVolume}
                      onChange={(e) => setBowserForm(p => ({ ...p, invoicedVolume: e.target.value }))}
                      className="w-full px-3 py-2 bg-white border border-amber-300 rounded-xl text-xs font-extrabold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 tabular-nums"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 font-semibold text-[11px]">
                      L
                    </span>
                  </div>
                  {/* Quick CPC standard preset buttons */}
                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    {['6600', '13200', '19800', '33000'].map(vol => (
                      <button
                        key={vol}
                        type="button"
                        onClick={() => setBowserForm(p => ({ ...p, invoicedVolume: vol }))}
                        className={`px-2 py-0.5 text-[10px] font-bold rounded-md transition-colors cursor-pointer ${
                          bowserForm.invoicedVolume === vol
                            ? 'bg-amber-600 text-white'
                            : 'bg-white border border-gray-200 text-slate-700 hover:bg-gray-100'
                        }`}
                      >
                        {vol === '6600' ? '6.6k L' : vol === '13200' ? '13.2k L' : vol === '19800' ? '19.8k L' : '33k L'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* 2. Before & After Dip Reading Inputs (Side-by-Side) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* BEFORE UNLOAD */}
                <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                      <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-extrabold flex items-center justify-center">1</span>
                      BEFORE UNLOAD
                    </span>
                    <span className="text-[10px] font-semibold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100">
                      Pre-Dip
                    </span>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-gray-600 mb-1">
                      Dip Reading (mm) *
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        step="any"
                        min="0"
                        placeholder="e.g. 850"
                        value={bowserForm.preDipMm}
                        onChange={(e) => {
                          const mmVal = e.target.value;
                          const numMm = parseFloat(mmVal) || 0;
                          const calcLiters = selectedBowserTank ? calculateDipVolume(numMm, selectedBowserTank.capacity) : 0;
                          setBowserForm(p => ({
                            ...p,
                            preDipMm: mmVal,
                            preDipLiters: mmVal !== '' ? calcLiters.toString() : ''
                          }));
                        }}
                        className="w-full px-3 py-2 bg-white border border-gray-300 rounded-xl text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 tabular-nums"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 font-semibold text-xs">
                        mm
                      </span>
                    </div>
                  </div>

                  <div className="bg-white p-2 rounded-lg border border-slate-200/80 flex items-center justify-between text-xs">
                    <span className="text-gray-500 font-medium text-[11px]">Calculated Volume:</span>
                    <span className="font-bold text-blue-700 tabular-nums">
                      {bowserAuditCalculations.preLiters.toLocaleString('en-LK', { maximumFractionDigits: 1 })} L
                    </span>
                  </div>
                </div>

                {/* AFTER UNLOAD */}
                <div className="bg-amber-50/50 p-3.5 rounded-xl border border-amber-200/80 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                      <span className="w-5 h-5 rounded-full bg-amber-500 text-white text-[10px] font-extrabold flex items-center justify-center">2</span>
                      AFTER UNLOAD
                    </span>
                    <span className="text-[10px] font-semibold text-amber-800 bg-amber-100/70 px-1.5 py-0.5 rounded border border-amber-200">
                      Post-Dip
                    </span>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-gray-600 mb-1">
                      Dip Reading (mm) *
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        step="any"
                        min="0"
                        placeholder="e.g. 1650"
                        value={bowserForm.postDipMm}
                        onChange={(e) => {
                          const mmVal = e.target.value;
                          const numMm = parseFloat(mmVal) || 0;
                          const calcLiters = selectedBowserTank ? calculateDipVolume(numMm, selectedBowserTank.capacity) : 0;
                          setBowserForm(p => ({
                            ...p,
                            postDipMm: mmVal,
                            postDipLiters: mmVal !== '' ? calcLiters.toString() : ''
                          }));
                        }}
                        className="w-full px-3 py-2 bg-white border border-amber-300 rounded-xl text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500 tabular-nums"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 font-semibold text-xs">
                        mm
                      </span>
                    </div>
                  </div>

                  <div className="bg-white p-2 rounded-lg border border-amber-200/80 flex items-center justify-between text-xs">
                    <span className="text-gray-500 font-medium text-[11px]">Calculated Volume:</span>
                    <span className="font-bold text-amber-900 tabular-nums">
                      {bowserAuditCalculations.postLiters.toLocaleString('en-LK', { maximumFractionDigits: 1 })} L
                    </span>
                  </div>
                </div>
              </div>

              {/* 3. Instant Result Summary Box */}
              <div className="bg-slate-900 text-white p-3.5 sm:p-4 rounded-xl shadow-xs space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                    Live Audit Result
                  </span>
                  {bowserAuditCalculations.hasReadings && bowserAuditCalculations.invoicedVol > 0 && (
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-bold ${
                      bowserAuditCalculations.status === 'Shortage'
                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                        : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    }`}>
                      {bowserAuditCalculations.status === 'Shortage' ? (
                        <>
                          <AlertTriangle className="w-3.5 h-3.5" />
                          <span>Shortage</span>
                        </>
                      ) : bowserAuditCalculations.status === 'Excess' ? (
                        <>
                          <TrendingUp className="w-3.5 h-3.5" />
                          <span>Gain (Excess)</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle className="w-3.5 h-3.5" />
                          <span>Balanced</span>
                        </>
                      )}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="bg-slate-800/80 p-2.5 rounded-lg border border-slate-700/60">
                    <span className="text-[10px] text-slate-400 uppercase font-semibold block mb-0.5">
                      Net Received (After - Before)
                    </span>
                    <span className="text-base font-extrabold text-amber-400 tabular-nums">
                      {bowserAuditCalculations.actualReceived.toLocaleString('en-LK', { maximumFractionDigits: 1 })} L
                    </span>
                  </div>

                  <div className={`p-2.5 rounded-lg border ${
                    bowserAuditCalculations.varianceLiters < 0
                      ? 'bg-rose-950/40 border-rose-800/60'
                      : 'bg-emerald-950/40 border-emerald-800/60'
                  }`}>
                    <span className="text-[10px] text-slate-300 uppercase font-semibold block mb-0.5">
                      Variance (Received - Invoiced)
                    </span>
                    <span className={`text-base font-extrabold tabular-nums ${
                      bowserAuditCalculations.varianceLiters < 0 ? 'text-rose-400' : 'text-emerald-400'
                    }`}>
                      {bowserAuditCalculations.varianceLiters >= 0 
                        ? `+${bowserAuditCalculations.varianceLiters.toFixed(1)} L` 
                        : `${bowserAuditCalculations.varianceLiters.toFixed(1)} L`}
                    </span>
                    <span className="text-[10px] text-slate-300 block mt-0.5">
                      {bowserAuditCalculations.variancePercentage >= 0 ? '+' : ''}
                      {bowserAuditCalculations.variancePercentage.toFixed(2)}%
                    </span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-gray-100 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsBowserDipModalOpen(false)}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-xs active:scale-95"
                >
                  <Check className="w-4 h-4" />
                  <span>Save Bowser Audit</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* DETAILED SINGLE RECORD BREAKDOWN VIEW MODAL                                */}
      {/* ========================================================================= */}
      {selectedDetailSession && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-3xl w-full p-6 shadow-2xl border border-gray-200 my-auto max-h-[92vh] flex flex-col space-y-5">
            {/* Breakdown Header */}
            <div className="flex items-center justify-between pb-3 border-b border-gray-100 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className={`p-2 rounded-xl border ${selectedDetailSession.sessionType === 'bowser_delivery' || !!selectedDetailSession.bowserAudit ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-blue-50 text-blue-600 border-blue-100'}`}>
                  {selectedDetailSession.sessionType === 'bowser_delivery' || !!selectedDetailSession.bowserAudit ? (
                    <Truck className="w-5 h-5" />
                  ) : (
                    <FileText className="w-5 h-5" />
                  )}
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 tracking-tight font-sans">
                    {selectedDetailSession.sessionType === 'bowser_delivery' || !!selectedDetailSession.bowserAudit 
                      ? 'Bowser Unloading Dip Audit Report' 
                      : 'Daily Dip Audit Breakdown'}
                  </h3>
                  <div className="flex items-center gap-2 text-xs text-gray-500 font-medium">
                    <span>{selectedDetailSession.date}</span>
                    <span>•</span>
                    <span>{selectedDetailSession.time}</span>
                    <span>•</span>
                    <span className={`font-semibold ${selectedDetailSession.sessionType === 'bowser_delivery' || !!selectedDetailSession.bowserAudit ? 'text-amber-800' : 'text-blue-700'}`}>
                      {selectedDetailSession.shift}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => exportSingleSessionCSV(selectedDetailSession)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-bold transition-all cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export CSV</span>
                </button>
                <button
                  onClick={() => setSelectedDetailSession(null)}
                  className="p-1.5 hover:bg-gray-100 text-gray-400 hover:text-gray-600 rounded-xl transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* BOWSER DELIVERY DETAILED REPORT */}
            {selectedDetailSession.sessionType === 'bowser_delivery' || !!selectedDetailSession.bowserAudit ? (
              <div className="space-y-4 overflow-y-auto flex-1 pr-1">
                {/* Bowser Audit KPI Card */}
                {(() => {
                  const b = selectedDetailSession.bowserAudit || {
                    tankId: '',
                    tankName: selectedDetailSession.entries[0]?.tankName || 'Tank 01',
                    fuelType: selectedDetailSession.entries[0]?.fuelType || 'Fuel',
                    invoicedVolume: selectedDetailSession.totalSystemVolume || 6600,
                    preDipMm: 0,
                    preDipLiters: selectedDetailSession.totalSystemVolume,
                    postDipMm: selectedDetailSession.entries[0]?.dipMm || 0,
                    postDipLiters: selectedDetailSession.totalPhysicalDip,
                    actualReceivedVolume: selectedDetailSession.totalPhysicalDip,
                    varianceLiters: selectedDetailSession.totalVarianceLiters,
                    variancePercentage: (selectedDetailSession.totalVarianceLiters / 6600) * 100,
                    status: selectedDetailSession.totalVarianceLiters >= 0 ? 'Excess' : 'Shortage',
                  };

                  return (
                    <div className="space-y-4 text-xs">
                      {/* Top Metric Cards */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-900 text-white p-4 rounded-2xl shadow-xs">
                        <div>
                          <span className="text-[10px] text-slate-400 uppercase font-bold block">Target Tank</span>
                          <span className="font-extrabold text-amber-400 text-sm block mt-0.5">{b.tankName}</span>
                          <span className="text-[11px] text-slate-300 font-medium">{b.fuelType}</span>
                        </div>

                        <div>
                          <span className="text-[10px] text-slate-400 uppercase font-bold block">Invoiced Bowser Vol</span>
                          <span className="font-extrabold text-white text-sm tabular-nums block mt-0.5">{b.invoicedVolume.toLocaleString()} L</span>
                          <span className="text-[10px] text-slate-400">Supplier Invoice</span>
                        </div>

                        <div>
                          <span className="text-[10px] text-slate-400 uppercase font-bold block">Actual Decanted Vol</span>
                          <span className="font-extrabold text-amber-400 text-sm tabular-nums block mt-0.5">{b.actualReceivedVolume.toLocaleString()} L</span>
                          <span className="text-[10px] text-slate-400">Post - Pre Dip</span>
                        </div>

                        <div>
                          <span className="text-[10px] text-slate-400 uppercase font-bold block">Variance &amp; Status</span>
                          <span className={`font-extrabold text-sm tabular-nums block mt-0.5 ${b.varianceLiters >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {b.varianceLiters >= 0 ? `+${b.varianceLiters.toFixed(1)} L` : `${b.varianceLiters.toFixed(1)} L`}
                          </span>
                          <span className={`text-[10px] font-bold ${b.varianceLiters >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {b.status} ({b.variancePercentage >= 0 ? '+' : ''}{b.variancePercentage.toFixed(2)}%)
                          </span>
                        </div>
                      </div>

                      {/* Decanting Pre vs Post Dip Details */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-100 inline-block">
                            Pre-Unload Dip (Before Decanting)
                          </span>
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-gray-500 font-medium">Dip Rod Reading:</span>
                            <span className="font-bold text-slate-900">{b.preDipMm} mm</span>
                          </div>
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-gray-500 font-medium">Underground Volume:</span>
                            <span className="font-extrabold text-blue-700 tabular-nums">{b.preDipLiters.toLocaleString()} Liters</span>
                          </div>
                        </div>

                        <div className="bg-amber-50/50 p-3.5 rounded-xl border border-amber-200/80 space-y-2">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800 bg-amber-100/70 px-2 py-0.5 rounded border border-amber-200 inline-block">
                            Post-Unload Dip (After Decanting)
                          </span>
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-gray-500 font-medium">Dip Rod Reading:</span>
                            <span className="font-bold text-slate-900">{b.postDipMm} mm</span>
                          </div>
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-gray-500 font-medium">Underground Volume:</span>
                            <span className="font-extrabold text-amber-900 tabular-nums">{b.postDipLiters.toLocaleString()} Liters</span>
                          </div>
                        </div>
                      </div>

                      {/* Delivery Verification Credentials */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 bg-gray-50 p-3 rounded-xl border border-gray-200 text-xs">
                        <div>
                          <span className="text-[10px] text-gray-400 font-bold block uppercase">Bowser Vehicle</span>
                          <span className="font-bold text-slate-800">{b.bowserNo || 'Not Logged'}</span>
                        </div>
                        <div>
                          <span className="text-[10px] text-gray-400 font-bold block uppercase">Invoice / Ref</span>
                          <span className="font-bold text-slate-800">{b.invoiceNo || 'Not Logged'}</span>
                        </div>
                        <div>
                          <span className="text-[10px] text-gray-400 font-bold block uppercase">Driver Name</span>
                          <span className="font-bold text-slate-800">{b.driverName || 'N/A'}</span>
                        </div>
                        <div>
                          <span className="text-[10px] text-gray-400 font-bold block uppercase">Supervisor</span>
                          <span className="font-bold text-slate-800">{selectedDetailSession.supervisor}</span>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Remarks */}
                {selectedDetailSession.remarks && (
                  <div className="bg-amber-50/70 p-3 rounded-xl border border-amber-200 text-xs">
                    <span className="font-bold text-amber-950 block mb-0.5">Decanting &amp; Audit Notes:</span>
                    <p className="text-slate-700 leading-relaxed font-medium">{selectedDetailSession.remarks}</p>
                  </div>
                )}
              </div>
            ) : (
              /* ROUTINE AUDIT MULTI-TANK BREAKDOWN */
              <div className="space-y-4 overflow-y-auto flex-1 pr-1">
                {/* Summary Strip */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200/80 text-xs">
                  <div>
                    <span className="text-[10px] text-gray-400 uppercase font-bold block">Supervisor</span>
                    <span className="font-bold text-slate-800">{selectedDetailSession.supervisor}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-gray-400 uppercase font-bold block">Total System (L)</span>
                    <span className="font-bold text-slate-800 tabular-nums">
                      {selectedDetailSession.totalSystemVolume.toLocaleString('en-LK', { maximumFractionDigits: 1 })} L
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-gray-400 uppercase font-bold block">Total Physical Dip (L)</span>
                    <span className="font-bold text-slate-900 tabular-nums">
                      {selectedDetailSession.totalPhysicalDip.toLocaleString('en-LK', { maximumFractionDigits: 1 })} L
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-gray-400 uppercase font-bold block">Net Variance</span>
                    <span className={`font-extrabold tabular-nums ${selectedDetailSession.totalVarianceLiters >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                      {selectedDetailSession.totalVarianceLiters >= 0 ? `+${selectedDetailSession.totalVarianceLiters.toFixed(1)} L` : `${selectedDetailSession.totalVarianceLiters.toFixed(1)} L`}
                    </span>
                  </div>
                </div>

                {/* Tank-by-Tank Detailed Breakdown Table */}
                <div className="border border-gray-200 rounded-xl overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-gray-100 font-bold uppercase text-[10px] text-slate-600 border-b border-gray-200 sticky top-0">
                      <tr>
                        <th className="p-3">#</th>
                        <th className="p-3">Tank &amp; Fuel Grade</th>
                        <th className="p-3 text-right">System Book (L)</th>
                        <th className="p-3 text-right">Physical Dip (L)</th>
                        <th className="p-3 text-right">Variance (L)</th>
                        <th className="p-3 text-right">Variance (%)</th>
                        <th className="p-3 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 font-medium text-slate-800">
                      {selectedDetailSession.entries.map((entry, idx) => {
                        const isLoss = entry.varianceLiters < 0;
                        const isGain = entry.varianceLiters > 0;
                        return (
                          <tr key={entry.tankId || idx} className="hover:bg-slate-50/50">
                            <td className="p-3 text-center text-gray-400 font-bold">{idx + 1}</td>
                            <td className="p-3 font-bold text-slate-900">
                              <div>{entry.tankName}</div>
                              <div className="text-[10px] text-gray-500 font-normal">{entry.fuelType}</div>
                            </td>
                            <td className="p-3 text-right text-gray-600 tabular-nums">
                              {entry.systemVolume.toLocaleString('en-LK', { maximumFractionDigits: 1 })} L
                            </td>
                            <td className="p-3 text-right font-bold text-slate-900 tabular-nums">
                              {entry.physicalDip.toLocaleString('en-LK', { maximumFractionDigits: 1 })} L
                            </td>
                            <td className="p-3 text-right font-bold tabular-nums whitespace-nowrap">
                              <span className={isLoss ? 'text-rose-600' : isGain ? 'text-emerald-700' : 'text-gray-500'}>
                                {isGain ? '+' : ''}{entry.varianceLiters.toFixed(1)} L
                              </span>
                            </td>
                            <td className="p-3 text-right font-semibold tabular-nums whitespace-nowrap">
                              <span className={isLoss ? 'text-rose-600' : isGain ? 'text-emerald-700' : 'text-gray-500'}>
                                {entry.variancePercentage >= 0 ? '+' : ''}{entry.variancePercentage.toFixed(2)}%
                              </span>
                            </td>
                            <td className="p-3 text-center whitespace-nowrap">
                              {entry.status === 'Warning' ? (
                                <span className="px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-md font-bold text-[10px]">
                                  High Deviation
                                </span>
                              ) : isLoss ? (
                                <span className="px-2 py-0.5 bg-rose-50 text-rose-700 border border-rose-200 rounded-md font-bold text-[10px]">
                                  Loss
                                </span>
                              ) : isGain ? (
                                <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md font-bold text-[10px]">
                                  Gain
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 bg-gray-50 text-gray-600 border border-gray-200 rounded-md font-semibold text-[10px]">
                                  Balanced
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Remarks Section */}
                {selectedDetailSession.remarks && (
                  <div className="bg-blue-50/60 p-3 rounded-xl border border-blue-100 text-xs">
                    <span className="font-bold text-blue-950 block mb-0.5">Audit Remarks:</span>
                    <p className="text-slate-700 leading-relaxed font-medium">{selectedDetailSession.remarks}</p>
                  </div>
                )}
              </div>
            )}

            {/* Close Button */}
            <div className="flex items-center justify-end pt-3 border-t border-gray-100 shrink-0">
              <button
                onClick={() => setSelectedDetailSession(null)}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                Close Report
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
