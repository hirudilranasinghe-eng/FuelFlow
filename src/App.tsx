/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { useState, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Info, AlertCircle, Database, ShieldCheck, LogOut, Building2, Calendar } from 'lucide-react';

function getInitials(name?: string): string {
  if (!name) return 'RA';
  const parts = name.trim().split(' ').filter(Boolean);
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
import Sidebar from './components/Sidebar';
import DashboardTab from './components/DashboardTab';
import ShiftManagementTab from './components/ShiftManagementTab';
import FuelStockTab from './components/FuelStockTab';
import OilStorageTab from './components/OilStorageTab';
import LPGasInventoryTab from './components/LPGasInventoryTab';
import PurchasesTab from './components/PurchasesTab';
import DailySalesTab from './components/DailySalesTab';
import ReportsTab from './components/ReportsTab';
import ManualDipTab from './components/ManualDipTab';
import CustomersTab from './components/CustomersTab';
import EmployeesTab from './components/EmployeesTab';
import AdminControlTab from './components/AdminControlTab';
import PriceManagementTab from './components/PriceManagementTab';
import LoginPage from './components/LoginPage';
import { AuthUser, Employee, FuelTank, OilTank, Pump, PumpMachine, Shift, StockDelivery, PriceSchedule, Customer, CreditTransaction, CreditPayment, LPGasItem, resolveUserRole } from './types';
import { supabase, getTanksTableName, setTanksTableName } from './lib/supabase';
import { upsertPumpReadings, syncCreditAndCardSales, syncAllNonCashSales, updateNozzleMeterCarryover, saveOilTank, recordShiftBankDeposit, isPumpReadingActiveOrAssigned, saveShiftLogs } from './lib/supabaseClient';

export const defaultPumpMachines: PumpMachine[] = [];
export const defaultPumps: Pump[] = [];

export default function App() {
  // Auth state & session guard
  const [user, setUser] = useState<AuthUser | null>(() => {
    try {
      const stored = localStorage.getItem('fms_user');
      if (stored) return JSON.parse(stored);
    } catch (_) {}
    return null;
  });

  // Navigation active tab
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [reportSubTab, setReportSubTab] = useState<string>('daily-sales');
  const [adminSubTab, setAdminSubTab] = useState<'tanks' | 'oils' | 'mapping' | 'employees' | 'price' | 'system'>('tanks');
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);

  const handleSetActiveTab = (tab: string, subTab?: string) => {
    setActiveTab(tab);
    if (tab === 'reports') {
      setReportSubTab(subTab || 'daily-sales');
    } else if (tab === 'admin') {
      setAdminSubTab((subTab as any) || 'tanks');
    } else if (subTab) {
      setReportSubTab(subTab);
    }
  };
  const [dbError, setDbError] = useState<string | null>(null);
  const [isRlsActive, setIsRlsActive] = useState<boolean>(false);
  const isInitialLoad = useRef(true);

  // Sync Supabase Auth session if configured
  useEffect(() => {
    const checkSession = async () => {
      const isConfigured = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
      if (isConfigured) {
        try {
          const { data } = await supabase.auth.getSession();
          if (data?.session?.user) {
            const u = data.session.user;
            const userEmail = u.email || 'admin@fuelflow.lk';
            const { roleTitle } = resolveUserRole(userEmail, u.user_metadata?.role);

            const authUser: AuthUser = {
              id: u.id,
              email: userEmail,
              name: u.user_metadata?.full_name || u.user_metadata?.name || (roleTitle === 'System Admin' ? 'Rumesh Anjana' : 'Station User'),
              role: roleTitle,
              avatarColor: roleTitle === 'System Admin' ? 'bg-blue-600' : 'bg-purple-600',
            };
            setUser(authUser);
            localStorage.setItem('fms_user', JSON.stringify(authUser));
          }
        } catch (err) {
          console.warn("Supabase auth session check notice:", err);
        }
      }
    };

    checkSession();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        const u = session.user;
        const userEmail = u.email || 'admin@fuelflow.lk';
        const { roleTitle } = resolveUserRole(userEmail, u.user_metadata?.role);

        const authUser: AuthUser = {
          id: u.id,
          email: userEmail,
          name: u.user_metadata?.full_name || u.user_metadata?.name || (roleTitle === 'System Admin' ? 'Rumesh Anjana' : 'Station User'),
          role: roleTitle,
          avatarColor: roleTitle === 'System Admin' ? 'bg-blue-600' : 'bg-purple-600',
        };
        setUser(authUser);
        localStorage.setItem('fms_user', JSON.stringify(authUser));
      }
    });

    return () => {
      authListener?.subscription?.unsubscribe();
    };
  }, []);

  // Redirect non-admin users away from 'admin' tab if attempted
  useEffect(() => {
    if (user) {
      const { role } = resolveUserRole(user.email, user.role);
      if (role !== 'admin' && activeTab === 'admin') {
        setActiveTab('dashboard');
      }
    }
  }, [user, activeTab]);

  const handleLoginSuccess = (signedInUser: AuthUser) => {
    setUser(signedInUser);
    try {
      localStorage.setItem('fms_user', JSON.stringify(signedInUser));
    } catch (_) {}
  };

  const handleLogout = async () => {
    try {
      const isConfigured = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
      if (isConfigured) {
        await supabase.auth.signOut();
      }
    } catch (_) {}
    setUser(null);
    try {
      localStorage.removeItem('fms_user');
      localStorage.removeItem('fuelflow_user');
      localStorage.removeItem('supabase.auth.token');
      sessionStorage.clear();
    } catch (_) {}
  };

  // Clear stale cached shifts and legacy keys from localStorage on startup
  useEffect(() => {
    const shiftKeysToPurge = [
      'fms_shiftHistory', 
      'fms_shifts', 
      'fuelflow_history', 
      'fms_activeShift', 
      'active_shift_data', 
      'shift_history', 
      'fms_history'
    ];
    shiftKeysToPurge.forEach(key => {
      try {
        localStorage.removeItem(key);
      } catch (_) {}
    });

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('fuelflow_settled_pumpers_') || key.toLowerCase().includes('shift_history') || key.toLowerCase().includes('shifthistory'))) {
          localStorage.removeItem(key);
        }
      }
    } catch (_) {}

    const legacyKeys = ['fms_pump_machines', 'fms_pumps', 'fms_tanks', 'fms_customers', 'fms_creditTransactions', 'fms_creditPayments', 'fms_employees', 'fms_oil_tanks', 'dispenser_chambers', 'fms_dispenser_chambers', 'dispenserChambers'];
    legacyKeys.forEach(key => {
      try {
        if (key === 'dispenser_chambers' || key === 'fms_dispenser_chambers' || key === 'dispenserChambers' || key === 'fms_oil_tanks') {
          localStorage.removeItem(key);
          return;
        }
        const stored = localStorage.getItem(key);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed)) {
            const isLegacyDemo = parsed.some((item: any) => 
              ['mach-01', 'mach-02', 'noz-101', 'pump-101', 'tank-petrol92', 'CUST-101', 'TX-801', 'emp-101', 'PAY-501', 'chamber-1', 'oil-tank-01', 'oil-tank-02'].includes(item.id) ||
              item.name?.includes('Chamber 01') || item.grade?.includes('Lanka 2T Super')
            );
            if (isLegacyDemo) {
              localStorage.removeItem(key);
            }
          }
        }
      } catch (_) {}
    });
  }, []);

  // Core persisted states
  const [employees, setEmployees] = useState<Employee[]>(() => {
    try {
      const stored = localStorage.getItem('fms_employees');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && !parsed.some((e: any) => e.id === 'emp-101')) return parsed;
      }
    } catch (_) {}
    return [];
  });
  const sortTanksNaturally = (tankList: FuelTank[]): FuelTank[] => {
    return [...tankList].sort((a, b) => (a.name || a.id || '').localeCompare(b.name || b.id || '', undefined, { numeric: true, sensitivity: 'base' }));
  };

  const [tanks, setTanks] = useState<FuelTank[]>(() => {
    try {
      const stored = localStorage.getItem('fms_tanks');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && !parsed.some((t: any) => t.id === 'tank-petrol92')) {
          return [...parsed].sort((a: any, b: any) => (a.name || a.id || '').localeCompare(b.name || b.id || '', undefined, { numeric: true, sensitivity: 'base' }));
        }
      }
    } catch (_) {}
    return [];
  });

  const [oilTanks, setOilTanks] = useState<OilTank[]>([]);
  const [pumpMachines, setPumpMachines] = useState<PumpMachine[]>(() => {
    try {
      const stored = localStorage.getItem('fms_pump_machines');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && !parsed.some((m: any) => m.id === 'mach-01')) return parsed;
      }
    } catch (_) {}
    return [];
  });
  const [pumps, setPumps] = useState<Pump[]>(() => {
    try {
      const stored = localStorage.getItem('fms_pumps');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && !parsed.some((p: any) => ['noz-101', 'pump-101'].includes(p.id))) return parsed;
      }
    } catch (_) {}
    return [];
  });
  const [activeShift, setActiveShift] = useState<Shift | null>(null);
  const [shiftHistory, setShiftHistory] = useState<Shift[]>([]);
  const [deliveries, setDeliveries] = useState<StockDelivery[]>([]);
  const [priceSchedules, setPriceSchedules] = useState<PriceSchedule[]>([]);

  // Customer & Credit states
  const [customers, setCustomers] = useState<Customer[]>(() => {
    try {
      const stored = localStorage.getItem('fms_customers');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && !parsed.some((c: any) => c.id === 'CUST-101')) return parsed;
      }
    } catch (_) {}
    return [];
  });

  const [creditTransactions, setCreditTransactions] = useState<CreditTransaction[]>(() => {
    try {
      const stored = localStorage.getItem('fms_creditTransactions');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && !parsed.some((t: any) => t.id === 'TX-801')) return parsed;
      }
    } catch (_) {}
    return [];
  });

  const [payments, setPayments] = useState<CreditPayment[]>(() => {
    try {
      const stored = localStorage.getItem('fms_creditPayments');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && !parsed.some((p: any) => p.id === 'PAY-501')) return parsed;
      }
    } catch (_) {}
    return [];
  });

  // Global LP Gas Stock State
  const [gasStock, setGasStock] = useState<LPGasItem[]>(() => {
    try {
      const stored = localStorage.getItem('fuel_flow_gas_stock') || localStorage.getItem('fuel_flow_gas_inventory');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (_) {}
    return [
      { id: 'gas-12.5kg', size: '12.5 kg', full_count: 0, empty_count: 0, last_updated: new Date().toISOString() },
      { id: 'gas-37.5kg', size: '37.5 kg', full_count: 0, empty_count: 0, last_updated: new Date().toISOString() },
      { id: 'gas-5.0kg', size: '5.0 kg', full_count: 0, empty_count: 0, last_updated: new Date().toISOString() },
      { id: 'gas-2.3kg', size: '2.3 kg', full_count: 0, empty_count: 0, last_updated: new Date().toISOString() }
    ];
  });

  const handleUpdateGasStock = (updated: LPGasItem[]) => {
    setGasStock(updated);
    try {
      localStorage.setItem('fuel_flow_gas_stock', JSON.stringify(updated));
      localStorage.setItem('fuel_flow_gas_inventory', JSON.stringify(updated));
    } catch (_) {}
    window.dispatchEvent(new CustomEvent('gas-inventory-updated', {
      detail: { updatedInventory: updated }
    }));
  };

  useEffect(() => {
    const handleGasUpdate = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail && Array.isArray(customEvent.detail.updatedInventory)) {
        setGasStock(customEvent.detail.updatedInventory);
      }
    };

    const handleGasPricesUpdate = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail?.updatedPrices) {
        const pMap = customEvent.detail.updatedPrices;
        setGasStock(prev => prev.map(item => {
          if (item.size === '12.5 kg' || item.id === 'gas-12.5kg') return { ...item, selling_price: pMap['12.5kg'] || item.selling_price, unit_price: pMap['12.5kg'] || item.unit_price };
          if (item.size === '5.0 kg' || item.id === 'gas-5.0kg' || item.id === 'gas-5kg') return { ...item, selling_price: pMap['5kg'] || item.selling_price, unit_price: pMap['5kg'] || item.unit_price };
          if (item.size === '2.3 kg' || item.id === 'gas-2.3kg') return { ...item, selling_price: pMap['2.3kg'] || item.selling_price, unit_price: pMap['2.3kg'] || item.unit_price };
          return item;
        }));
      }
    };

    const handleFuelPricesUpdate = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail?.updatedTanks && Array.isArray(customEvent.detail.updatedTanks)) {
        setTanks(customEvent.detail.updatedTanks);
      } else if (customEvent.detail?.fuelType && customEvent.detail?.newPrice) {
        const newPrice = Number(customEvent.detail.newPrice);
        setTanks(prev => prev.map(t => t.fuelType === customEvent.detail.fuelType ? { ...t, pricePerLiter: newPrice } : t));
      }
    };

    const handleTanksUpdate = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail?.tanks && Array.isArray(customEvent.detail.tanks)) {
        setTanks(customEvent.detail.tanks);
      }
    };

    window.addEventListener('gas-inventory-updated', handleGasUpdate);
    window.addEventListener('gas-prices-updated', handleGasPricesUpdate);
    window.addEventListener('fuel-prices-updated', handleFuelPricesUpdate);
    window.addEventListener('tanks-updated', handleTanksUpdate);

    return () => {
      window.removeEventListener('gas-inventory-updated', handleGasUpdate);
      window.removeEventListener('gas-prices-updated', handleGasPricesUpdate);
      window.removeEventListener('fuel-prices-updated', handleFuelPricesUpdate);
      window.removeEventListener('tanks-updated', handleTanksUpdate);
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('fms_customers', JSON.stringify(customers));
    } catch (_) {}
  }, [customers]);

  useEffect(() => {
    try {
      localStorage.setItem('fms_pump_machines', JSON.stringify(pumpMachines));
    } catch (_) {}
  }, [pumpMachines]);

  useEffect(() => {
    try {
      localStorage.setItem('fms_creditTransactions', JSON.stringify(creditTransactions));
    } catch (_) {}
  }, [creditTransactions]);

  useEffect(() => {
    try {
      localStorage.setItem('fms_creditPayments', JSON.stringify(payments));
    } catch (_) {}
  }, [payments]);

  // Error handling for writing state back to Supabase (e.g. Row-Level Security policy violations)
  const handleSyncWriteError = (err: any) => {
    if (!err) return;
    const errMsg = err.message || String(err);
    if (
      errMsg.toLowerCase().includes('row-level security') ||
      errMsg.toLowerCase().includes('violates row-level security policy') ||
      errMsg.toLowerCase().includes('security policy') ||
      errMsg.toLowerCase().includes('policy') ||
      err.code === '42501'
    ) {
      setIsRlsActive(true);
      console.warn("Write blocked by Supabase Row-Level Security (RLS). Automatically falling back to secure offline local storage mode.");
    } else {
      console.warn("Supabase sync write warning:", errMsg);
    }
  };

  // Initialize data on component mount
  useEffect(() => {
    const isConfigured = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);

    const fetchAllData = async () => {

      const loadLocalStorageFallback = () => {
        try {
          const storedEmps = localStorage.getItem('fms_employees');
          const storedTanks = localStorage.getItem('fms_tanks');
          const storedPumps = localStorage.getItem('fms_pumps');
          const storedMachines = localStorage.getItem('fms_pump_machines');
          const storedHistory = localStorage.getItem('fms_shiftHistory');
          const storedDeliveries = localStorage.getItem('fms_deliveries');
          const storedSchedules = localStorage.getItem('fms_priceSchedules');

          if (storedEmps) {
            try {
              const p = JSON.parse(storedEmps);
              setEmployees(Array.isArray(p) && !p.some((e: any) => e.id === 'emp-101') ? p : []);
            } catch (_) { setEmployees([]); }
          } else { setEmployees([]); }

          if (storedTanks) {
            try {
              const p = JSON.parse(storedTanks);
              setTanks(Array.isArray(p) && !p.some((t: any) => t.id === 'tank-petrol92') ? p : []);
            } catch (_) { setTanks([]); }
          } else { setTanks([]); }

          if (storedPumps) {
            try {
              const p = JSON.parse(storedPumps);
              setPumps(Array.isArray(p) && !p.some((e: any) => ['noz-101', 'pump-101'].includes(e.id)) ? p : []);
            } catch (_) { setPumps([]); }
          } else { setPumps([]); }

          if (storedMachines) {
            try {
              const p = JSON.parse(storedMachines);
              setPumpMachines(Array.isArray(p) && !p.some((e: any) => e.id === 'mach-01') ? p : []);
            } catch (_) { setPumpMachines([]); }
          } else { setPumpMachines([]); }

          setActiveShift(null);
          setShiftHistory([]);
          if (storedDeliveries) {
            try {
              setDeliveries(JSON.parse(storedDeliveries));
            } catch (_) {}
          }
          if (storedSchedules) {
            try {
              setPriceSchedules(JSON.parse(storedSchedules));
            } catch (_) {}
          }
        } catch (e) {
          console.warn("Failed to load fallback from localStorage", e);
          setEmployees([]);
          setTanks([]);
          setPumps([]);
          setPumpMachines([]);
        }
      };

      if (!isConfigured) {
        setDbError('Missing Supabase environment variables on Vercel. Please add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your Vercel Project Settings. Running in Offline Demo Mode.');
        loadLocalStorageFallback();
        return;
      }

      const handleSupabaseError = (error: any) => {
        if (error) {
          if (
            error.code === '42P01' || 
            error.message?.includes('relation') || 
            error.message?.includes('does not exist') ||
            String(error).includes('42P01')
          ) {
            throw new Error('tables_missing');
          }
          if (
            error.message?.toLowerCase().includes('row-level security') ||
            error.message?.toLowerCase().includes('violates row-level security policy') ||
            error.message?.toLowerCase().includes('security policy') ||
            String(error).toLowerCase().includes('row-level security') ||
            String(error).toLowerCase().includes('policy')
          ) {
            throw new Error('rls_active');
          }
          throw error;
        }
      };

      try {
        // Fetch employees with explicit deterministic ordering
        const { data: employeesData, error: empError } = await supabase
          .from('employees')
          .select('*')
          .order('name', { ascending: true });
        if (empError) handleSupabaseError(empError);

        if (employeesData && employeesData.length > 0) {
          const mappedEmps = employeesData.map(e => ({
            id: e.id, name: e.name, role: e.role, phone: e.phone, status: e.status, avatarColor: e.avatarcolor
          }));
          setEmployees(mappedEmps.sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' })) as Employee[]);
        } else {
          setEmployees([]);
        }

        // Probe and fetch fuel tanks dynamically (supports plural/singular database configurations)
        let targetTbl = 'fuel_tanks';
        const { error: probeError } = await supabase.from('fuel_tanks').select('id').limit(1);
        if (probeError && (
          probeError.code === '42P01' || 
          probeError.message?.includes('relation') || 
          probeError.message?.includes('does not exist') ||
          String(probeError).includes('42P01')
        )) {
          const { error: probeError2 } = await supabase.from('fuel_tank').select('id').limit(1);
          if (!probeError2 || (probeError2.code !== '42P01' && !probeError2.message?.includes('relation') && !probeError2.message?.includes('does not exist'))) {
            targetTbl = 'fuel_tank';
            setTanksTableName('fuel_tank');
          }
        }

        const { data: tanksData, error: tankError } = await supabase.from(targetTbl).select('*');
        if (tankError) handleSupabaseError(tankError);

        if (tanksData && tanksData.length > 0) {
          const mappedTanks = tanksData.map(t => ({
            id: t.id,
            fuelType: t.fueltype || t.fuel_type || 'Petrol 92',
            name: t.name,
            capacity: Number(t.capacity) || 0,
            currentLevel: Number(t.current_volume ?? t.current_stock ?? t.currentlevel ?? t.current_level ?? 0),
            pricePerLiter: Number(t.priceperliter ?? t.price_per_liter ?? 0)
          }));
          setTanks(sortTanksNaturally(mappedTanks as FuelTank[]));
        } else {
          setTanks([]);
        }

        // Fetch oil tanks / bulk lubricants directly from Supabase
        try {
          let { data: oilTanksData, error: bulkError } = await supabase.from('bulk_lubricants').select('*');
          if (bulkError && (bulkError.code === '42P01' || bulkError.message?.includes('does not exist'))) {
            const { data: altOilData } = await supabase.from('oil_tanks').select('*');
            oilTanksData = altOilData;
          }
          if (oilTanksData && Array.isArray(oilTanksData) && oilTanksData.length > 0) {
            const mappedOilTanks: OilTank[] = oilTanksData.map((ot: any) => ({
              id: ot.id,
              name: ot.name,
              grade: ot.grade || ot.oil_grade || '',
              capacity: Number(ot.capacity) || 100,
              currentLevel: Number(ot.current_level ?? ot.currentlevel) || 0,
              pricePerLiter: Number(ot.price_per_liter ?? ot.priceperliter) || 0,
              type: ot.type || (ot.name?.toLowerCase().includes('chamber') ? 'chamber' : 'drum'),
              chamberNumber: ot.chamber_number ?? ot.chambernumber ?? undefined
            }));
            setOilTanks([...mappedOilTanks].sort((a, b) => (a.name || a.id || '').localeCompare(b.name || b.id || '', undefined, { numeric: true, sensitivity: 'base' })));
          } else {
            setOilTanks([]);
          }
        } catch (_) {
          setOilTanks([]);
        }

        // Fetch pump_machines / machines table if available with deterministic ordering
        try {
          let { data: machinesData } = await supabase.from('pump_machines').select('*').order('name', { ascending: true });
          if (!machinesData || machinesData.length === 0) {
            const { data: altMachData } = await supabase.from('machines').select('*').order('name', { ascending: true });
            machinesData = altMachData;
          }
          if (machinesData && machinesData.length > 0) {
            const mappedMachines = machinesData.map((m: any) => ({
              id: m.id,
              name: m.name,
              status: m.status || 'Active',
              location: m.location || ''
            }));
            setPumpMachines([...mappedMachines].sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id, undefined, { numeric: true, sensitivity: 'base' })) as PumpMachine[]);
          } else {
            setPumpMachines([]);
          }
        } catch (mErr) {
          console.warn("Supabase pump_machines query notice:", mErr);
          setPumpMachines([]);
        }

        // Fetch nozzles / pumps table with deterministic ordering
        let fetchedPumps: any[] | null = null;
        try {
          const { data: nozzlesData } = await supabase.from('nozzles').select('*').order('name', { ascending: true });
          if (nozzlesData && nozzlesData.length > 0) {
            fetchedPumps = nozzlesData;
          }
        } catch (_) {}

        if (!fetchedPumps || fetchedPumps.length === 0) {
          try {
            const { data: pumpsData } = await supabase.from('pumps').select('*').order('name', { ascending: true });
            if (pumpsData && pumpsData.length > 0) {
              fetchedPumps = pumpsData;
            }
          } catch (_) {}
        }

        if (fetchedPumps && fetchedPumps.length > 0) {
          const mappedPumps = fetchedPumps.map((p: any) => ({
            id: p.id,
            name: p.name,
            fuelType: p.fueltype || p.fuel_type || p.fuelType,
            tankId: p.tankid || p.tank_id || p.tankId || undefined,
            status: p.status || 'Active',
            machineId: p.machineid || p.machine_id || p.machineId || undefined,
            machineName: p.machinename || p.machine_name || p.machineName || undefined,
            startMeter: Number(p.startmeter ?? p.start_meter ?? p.startMeter) || 0
          }));
          setPumps([...mappedPumps].sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id, undefined, { numeric: true, sensitivity: 'base' })) as Pump[]);
        } else {
          setPumps([]);
        }

        // Fetch shifts with pump readings and bank deposits
        const { data: shiftsData, error: shiftError } = await supabase.from('shifts').select(`
          *,
          pumpReadings:pump_readings(*)
        `).order('starttime', { ascending: false });
        if (shiftError) handleSupabaseError(shiftError);

        // Fetch shift bank deposits to accurately calculate banked cash per shift
        let appDepositsByShift: Record<string, number> = {};
        try {
          const { data: depositsData } = await supabase
            .from('shift_bank_deposits')
            .select('shift_id, deposited_amount');
          if (depositsData && Array.isArray(depositsData)) {
            depositsData.forEach((d: any) => {
              const sId = d.shift_id || d.shiftId;
              const amt = Number(d.deposited_amount || d.depositedAmount || d.amount) || 0;
              if (sId) {
                appDepositsByShift[sId] = (appDepositsByShift[sId] || 0) + amt;
              }
            });
          }
        } catch (depErr) {
          console.warn('Notice loading shift_bank_deposits in App.tsx:', depErr);
        }

        if (shiftsData) {
          const mappedShifts = shiftsData.map(s => {
            const bankedAmount = appDepositsByShift[s.id] !== undefined
              ? appDepositsByShift[s.id]
              : Number(s.cash_banked ?? s.cashbanked ?? s.cashBanked) || 0;

            const mappedReadings = (s.pumpReadings || []).map((r: any) => ({
              id: r.id,
              pumpId: r.pump_id || r.pumpid || r.pumpId,
              pumpName: r.pump_name || r.pumpname || r.pumpName,
              fuelType: r.fuel_type || r.fueltype || r.fuelType,
              tankId: r.tank_id || r.tankid || r.tankId || (r.fueltype === 'Petrol 92' ? 'tank-petrol92' : r.fueltype === 'Petrol 95' ? 'tank-petrol95' : r.fueltype === 'Auto Diesel' ? 'tank-autodiesel' : 'tank-superdiesel'),
              assignedPumperId: r.assigned_pumper_id || r.assignedpumperid || r.assignedPumperId || null,
              replacementPumperId: r.replacement_pumper_id || r.replacementpumperid || r.replacementPumperId || null,
              initialPumperCash: Number(r.initial_pumper_cash || r.initialpumpercash || r.initialPumperCash) || 0,
              replacementPumperCash: Number(r.replacement_pumper_cash || r.replacementpumpercash || r.replacementPumperCash) || 0,
              handoverMeter: Number(r.handover_meter !== undefined ? r.handover_meter : r.handovermeter !== undefined ? r.handovermeter : r.handoverMeter) || 0,
              handoverNotes: r.handover_notes || r.handovernotes || r.handoverNotes || '',
              startMeter: Number(r.start_meter !== undefined ? r.start_meter : r.startmeter !== undefined ? r.startmeter : r.startMeter) || 0,
              endMeter: Number(r.end_meter !== undefined ? r.end_meter : r.endmeter !== undefined ? r.endmeter : r.endMeter) || 0,
              testingQty: Number(r.testing_qty !== undefined ? r.testing_qty : r.testingqty !== undefined ? r.testingqty : r.testingQty) || 0,
              status: r.status || 'Idle',
              isLocked: r.is_locked !== undefined ? r.is_locked : r.islocked !== undefined ? r.islocked : r.isLocked,
              isStartSaved: r.is_start_saved !== undefined ? r.is_start_saved : r.isstartsaved !== undefined ? r.isstartsaved : (r.is_locked || (Number(r.start_meter || r.startmeter || 0) > 0)),
              isCardFinalized: r.is_card_finalized !== undefined ? r.is_card_finalized : r.iscardfinalized !== undefined ? r.iscardfinalized : (r.status === 'Completed'),
              unitPrice: Number(r.unit_price || r.unitprice || r.unitPrice) || 0,
              actualCash: Number(r.actual_cash ?? r.actualcash ?? r.actualCash) || 0,
              cashVariance: Number(r.cash_variance ?? r.cashvariance ?? r.cashVariance) || 0,
              creditSalesAmount: Number(r.credit_sales_amount ?? r.creditsalesamount ?? r.creditSalesAmount) || 0,
              cardSalesAmount: Number(r.card_sales_amount ?? r.cardsalesamount ?? r.cardSalesAmount) || 0,
              touchCardSalesAmount: Number(r.touch_card_sales_amount ?? r.touchcardsalesamount ?? r.touchCardSalesAmount) || 0,
              voucherSalesAmount: Number(r.voucher_sales_amount ?? r.vouchersalesamount ?? r.voucherSalesAmount) || 0,
              oilSalesAmount: Number(r.oil_sales_amount ?? r.oilsalesamount ?? r.oilSalesAmount) || 0
            }));

            // Deterministic immutable sorting for pumpReadings
            const sortedReadings = mappedReadings.sort((a, b) => {
              const nameComp = (a.pumpName || a.pumpId || '').localeCompare(b.pumpName || b.pumpId || '', undefined, { numeric: true, sensitivity: 'base' });
              if (nameComp !== 0) return nameComp;
              return (a.startMeter || 0) - (b.startMeter || 0);
            });

            return {
              id: s.id,
              name: s.name,
              supervisorId: s.supervisorid,
              startTime: s.starttime,
              endTime: s.endtime,
              isActive: s.isactive,
              totalFuelSold: Number(s.totalfuelsold) || 0,
              totalNetSold: Number(s.totalnetsold) || 0,
              totalNetSales: Number(s.totalnetsales) || 0,
              initialPumperCash: Number(s.initialpumpercash || s.initialPumperCash) || 0,
              replacementPumperCash: Number(s.replacementpumpercash || s.replacementPumperCash) || 0,
              totalPhysicalCash: Number(s.totalphysicalcash || s.totalPhysicalCash) || 0,
              cashVariance: s.cashvariance,
              cashBanked: bankedAmount,
              cash_banked: bankedAmount,
              handoverNotes: s.handovernotes || '',
              replacementPumperId: s.replacementpumperid || '',
              pumpReadings: sortedReadings
            };
          });

          const dbActive = mappedShifts.find(s => s.isActive);
          const history = mappedShifts.filter(s => !s.isActive);

          if (dbActive) {
            setActiveShift(dbActive as unknown as Shift);
          } else {
            setActiveShift(null);
          }

          setShiftHistory(history as unknown as Shift[]);
        } else {
          setActiveShift(null);
          setShiftHistory([]);
        }

        // Fetch deliveries
        const { data: deliveriesData, error: deliveryError } = await supabase.from('stock_deliveries').select('*').order('date', { ascending: false });
        if (deliveryError) handleSupabaseError(deliveryError);

        if (deliveriesData) {
          const mappedDeliveries = deliveriesData.map(d => ({
            id: d.id, date: d.date, fuelType: d.fueltype, tankId: d.tankid, quantity: d.quantity, supplier: d.supplier, cost: d.cost
          }));
          setDeliveries(mappedDeliveries as StockDelivery[]);
        }

        // Fetch price schedules
        const { data: schedulesData, error: scheduleError } = await supabase.from('price_schedules').select('*').order('effectivedate', { ascending: false });
        if (scheduleError) handleSupabaseError(scheduleError);

        if (schedulesData) {
          const mappedSchedules = schedulesData.map(s => ({
            id: s.id, fuelType: s.fueltype, newPrice: s.newprice, effectiveDate: s.effectivedate, status: s.status
          }));
          setPriceSchedules(mappedSchedules as PriceSchedule[]);
        }

        // Fetch customers from Supabase
        try {
          let customersData: any[] | null = null;
          const { data: cData, error: custError } = await supabase.from('customers').select('*').order('created_at', { ascending: false });
          if (custError) {
            const { data: retryData } = await supabase.from('customers').select('*').order('name', { ascending: true });
            if (retryData) customersData = retryData;
          } else if (cData) {
            customersData = cData;
          }

          if (customersData && customersData.length > 0) {
            const mappedCustomers = customersData.map((c: any) => ({
              id: c.id,
              name: c.name,
              phone: c.phone || '',
              customerType: c.customer_type || c.customerType || 'Credit',
              category: c.category || 'Business',
              email: c.email || '',
              address: c.address || '',
              notes: c.notes || '',
              creditLimit: Number(c.credit_limit !== undefined ? c.credit_limit : c.creditLimit) || 0,
              currentBalance: Number(c.current_balance !== undefined ? c.current_balance : c.currentBalance) || 0,
              depositBalance: Number(c.deposit_balance !== undefined ? c.deposit_balance : c.depositBalance) || 0,
              allowedCreditDays: Number(c.allowed_days !== undefined ? c.allowed_days : c.allowedCreditDays) || 30,
              status: c.status || 'Active',
              vehicleNumbers: Array.isArray(c.vehicle_numbers) 
                ? c.vehicle_numbers 
                : (c.vehicle_numbers ? String(c.vehicle_numbers).split(',').map((s: string) => s.trim()).filter(Boolean) : []),
              createdAt: c.created_at || new Date().toISOString()
            }));
            setCustomers(mappedCustomers);
          }
        } catch (_) {}

        // Fetch LP Gas stock & persisted prices from Supabase
        try {
          const { data: gasData } = await supabase.from('gas_inventory').select('*');
          if (gasData && gasData.length > 0) {
            const mappedGas: LPGasItem[] = [
              { id: 'gas-12.5kg', size: '12.5 kg', full_count: 0, empty_count: 0, selling_price: 3690, last_updated: new Date().toISOString() },
              { id: 'gas-37.5kg', size: '37.5 kg', full_count: 0, empty_count: 0, selling_price: 11200, last_updated: new Date().toISOString() },
              { id: 'gas-5.0kg', size: '5.0 kg', full_count: 0, empty_count: 0, selling_price: 1482, last_updated: new Date().toISOString() },
              { id: 'gas-2.3kg', size: '2.3 kg', full_count: 0, empty_count: 0, selling_price: 694, last_updated: new Date().toISOString() }
            ].map(defItem => {
              const match = gasData.find((g: any) => g.id === defItem.id || g.size === defItem.size);
              if (match) {
                const price = Number(match.selling_price || match.unit_price || match.price) || defItem.selling_price;
                return {
                  ...defItem,
                  ...match,
                  full_count: Number(match.full_count) || 0,
                  empty_count: Number(match.empty_count) || 0,
                  selling_price: price,
                  unit_price: price
                };
              }
              return defItem;
            });
            setGasStock(mappedGas);
            localStorage.setItem('fuel_flow_gas_stock', JSON.stringify(mappedGas));
            localStorage.setItem('fuel_flow_gas_inventory', JSON.stringify(mappedGas));
          }
        } catch (_) {}

        setTimeout(() => {
          isInitialLoad.current = false;
        }, 1000);
      } catch (err: any) {
        if (err.message === 'tables_missing') {
          setDbError('Supabase tables do not exist. Please go to your Supabase Dashboard SQL Editor, paste and run the contents of `supabase_schema.sql` to initialize your database tables.');
          console.log("Supabase setup notice: tables_missing");
          loadLocalStorageFallback();
        } else if (err.message === 'rls_active' || String(err).toLowerCase().includes('row-level security') || String(err).toLowerCase().includes('policy')) {
          setIsRlsActive(true);
          console.warn("Supabase Row-Level Security (RLS) is active. Operating in fallback offline mode.");
          loadLocalStorageFallback();
        } else {
          console.warn("Database connection issue. Falling back to offline mode. Details:", err?.message || String(err));
          loadLocalStorageFallback();
        }
        setTimeout(() => {
          isInitialLoad.current = false;
        }, 1000);
      }
    };

    fetchAllData();

    // Set up Real-time Supabase subscription for underground fuel tanks and bulk lubricants
    let realtimeChannel: any = null;
    let bulkOilChannel: any = null;
    let shiftsChannel: any = null;

    if (isConfigured) {
      try {
        const targetTable = getTanksTableName();
        realtimeChannel = supabase
          .channel(`fuel_tanks_realtime_${Date.now()}`)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: targetTable },
            (payload) => {
              if (payload.eventType === 'INSERT') {
                const row = payload.new;
                const insertedTank: FuelTank = {
                  id: row.id,
                  name: row.name,
                  fuelType: row.fueltype || row.fuel_type || 'Petrol 92',
                  capacity: Number(row.capacity) || 0,
                  currentLevel: Number(row.current_volume ?? row.current_stock ?? row.currentlevel ?? row.current_level) || 0,
                  pricePerLiter: Number(row.priceperliter ?? row.price_per_liter) || 0,
                };
                setTanks((prev) => {
                  if (prev.some((t) => t.id === insertedTank.id)) {
                    return prev.map((t) => (t.id === insertedTank.id ? insertedTank : t));
                  }
                  return sortTanksNaturally([...prev, insertedTank]);
                });
              } else if (payload.eventType === 'UPDATE') {
                const row = payload.new;
                const updatedTank: FuelTank = {
                  id: row.id,
                  name: row.name,
                  fuelType: row.fueltype || row.fuel_type || 'Petrol 92',
                  capacity: Number(row.capacity) || 0,
                  currentLevel: Number(row.current_volume ?? row.current_stock ?? row.currentlevel ?? row.current_level) || 0,
                  pricePerLiter: Number(row.priceperliter ?? row.price_per_liter) || 0,
                };
                setTanks((prev) =>
                  sortTanksNaturally(prev.map((t) => (t.id === updatedTank.id ? updatedTank : t)))
                );
              } else if (payload.eventType === 'DELETE') {
                if (payload.old?.id) {
                  setTanks((prev) => prev.filter((t) => t.id !== payload.old.id));
                }
              }
            }
          )
          .subscribe();

        bulkOilChannel = supabase
          .channel(`bulk_lubricants_app_realtime_${Date.now()}`)
          .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'bulk_lubricants' }, (payload: any) => {
            if (payload?.old?.id) {
              setOilTanks(prev => prev.filter(t => t.id !== payload.old.id));
            }
          })
          .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'oil_tanks' }, (payload: any) => {
            if (payload?.old?.id) {
              setOilTanks(prev => prev.filter(t => t.id !== payload.old.id));
            }
          })
          .on('postgres_changes', { event: '*', schema: 'public', table: 'bulk_lubricants' }, async (payload: any) => {
            if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
              const row = payload.new;
              if (row && row.id) {
                const isChamber = row.type === 'chamber' || row.name?.toLowerCase().includes('chamber');
                const tank: OilTank = {
                  id: row.id,
                  name: row.name || 'Bulk Oil Unit',
                  grade: row.grade || row.oil_grade || '',
                  capacity: Number(row.capacity) || (isChamber ? 100 : 210),
                  currentLevel: Number(row.current_level ?? row.currentlevel ?? 0),
                  pricePerLiter: Number(row.price_per_liter ?? row.priceperliter ?? 0),
                  type: row.type || (isChamber ? 'chamber' : 'drum'),
                  chamberNumber: row.chamber_number ?? row.chambernumber ?? undefined
                };
                setOilTanks(prev => {
                  if (prev.some(t => t.id === tank.id)) {
                    return prev.map(t => t.id === tank.id ? tank : t);
                  }
                  return [...prev, tank].sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id, undefined, { numeric: true, sensitivity: 'base' }));
                });
              }
            }
          })
          .subscribe();

        // Shifts real-time channel
        shiftsChannel = supabase
          .channel(`shifts_app_realtime_${Date.now()}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'shifts' }, async () => {
            try {
              const { data: updatedShifts } = await supabase.from('shifts').select(`
                *,
                pumpReadings:pump_readings(*)
              `).order('starttime', { ascending: false });

              let realtimeDeposits: Record<string, number> = {};
              try {
                const { data: depositsData } = await supabase
                  .from('shift_bank_deposits')
                  .select('shift_id, deposited_amount');
                if (depositsData && Array.isArray(depositsData)) {
                  depositsData.forEach((d: any) => {
                    const sId = d.shift_id || d.shiftId;
                    const amt = Number(d.deposited_amount || d.depositedAmount || d.amount) || 0;
                    if (sId) {
                      realtimeDeposits[sId] = (realtimeDeposits[sId] || 0) + amt;
                    }
                  });
                }
              } catch (_) {}

              if (updatedShifts) {
                const mappedShifts = updatedShifts.map(s => {
                  const bankedAmount = realtimeDeposits[s.id] !== undefined
                    ? realtimeDeposits[s.id]
                    : Number(s.cash_banked ?? s.cashbanked ?? s.cashBanked) || 0;

                  const mappedReadings = (s.pumpReadings || []).map((r: any) => ({
                    id: r.id,
                    pumpId: r.pump_id || r.pumpid || r.pumpId,
                    pumpName: r.pump_name || r.pumpname || r.pumpName,
                    fuelType: r.fuel_type || r.fueltype || r.fuelType,
                    tankId: r.tank_id || r.tankid || r.tankId || (r.fueltype === 'Petrol 92' ? 'tank-petrol92' : r.fueltype === 'Petrol 95' ? 'tank-petrol95' : r.fueltype === 'Auto Diesel' ? 'tank-autodiesel' : 'tank-superdiesel'),
                    assignedPumperId: r.assigned_pumper_id || r.assignedpumperid || r.assignedPumperId || null,
                    replacementPumperId: r.replacement_pumper_id || r.replacementpumperid || r.replacementPumperId || null,
                    initialPumperCash: Number(r.initial_pumper_cash || r.initialpumpercash || r.initialPumperCash) || 0,
                    replacementPumperCash: Number(r.replacement_pumper_cash || r.replacementpumpercash || r.replacementPumperCash) || 0,
                    handoverMeter: Number(r.handover_meter !== undefined ? r.handover_meter : r.handovermeter !== undefined ? r.handovermeter : r.handoverMeter) || 0,
                    handoverNotes: r.handover_notes || r.handovernotes || r.handoverNotes || '',
                    startMeter: Number(r.start_meter !== undefined ? r.start_meter : r.startmeter !== undefined ? r.startmeter : r.startMeter) || 0,
                    endMeter: Number(r.end_meter !== undefined ? r.end_meter : r.endmeter !== undefined ? r.endmeter : r.endMeter) || 0,
                    testingQty: Number(r.testing_qty !== undefined ? r.testing_qty : r.testingqty !== undefined ? r.testingqty : r.testingQty) || 0,
                    status: r.status || 'Idle',
                    isLocked: r.is_locked !== undefined ? r.is_locked : r.islocked !== undefined ? r.islocked : r.isLocked,
                    isStartSaved: r.is_start_saved !== undefined ? r.is_start_saved : r.isstartsaved !== undefined ? r.isstartsaved : (r.is_locked || (Number(r.start_meter || r.startmeter || 0) > 0)),
                    isCardFinalized: r.is_card_finalized !== undefined ? r.is_card_finalized : r.iscardfinalized !== undefined ? r.iscardfinalized : (r.status === 'Completed'),
                    unitPrice: Number(r.unit_price || r.unitprice || r.unitPrice) || 0,
                    actualCash: Number(r.actual_cash ?? r.actualcash ?? r.actualCash) || 0,
                    cashVariance: Number(r.cash_variance ?? r.cashvariance ?? r.cashVariance) || 0,
                    creditSalesAmount: Number(r.credit_sales_amount ?? r.creditsalesamount ?? r.creditSalesAmount) || 0,
                    cardSalesAmount: Number(r.card_sales_amount ?? r.cardsalesamount ?? r.cardSalesAmount) || 0,
                    touchCardSalesAmount: Number(r.touch_card_sales_amount ?? r.touchcardsalesamount ?? r.touchCardSalesAmount) || 0,
                    voucherSalesAmount: Number(r.voucher_sales_amount ?? r.vouchersalesamount ?? r.voucherSalesAmount) || 0,
                    oilSalesAmount: Number(r.oil_sales_amount ?? r.oilsalesamount ?? r.oilSalesAmount) || 0
                  }));

                  const sortedReadings = mappedReadings.sort((a, b) => {
                    const nameComp = (a.pumpName || a.pumpId || '').localeCompare(b.pumpName || b.pumpId || '', undefined, { numeric: true, sensitivity: 'base' });
                    if (nameComp !== 0) return nameComp;
                    return (a.startMeter || 0) - (b.startMeter || 0);
                  });

                  return {
                    id: s.id,
                    name: s.name,
                    supervisorId: s.supervisorid,
                    startTime: s.starttime,
                    endTime: s.endtime,
                    isActive: s.isactive,
                    totalFuelSold: Number(s.totalfuelsold) || 0,
                    totalNetSold: Number(s.totalnetsold) || 0,
                    totalNetSales: Number(s.totalnetsales) || 0,
                    initialPumperCash: Number(s.initialpumpercash || s.initialPumperCash) || 0,
                    replacementPumperCash: Number(s.replacementpumpercash || s.replacementPumperCash) || 0,
                    totalPhysicalCash: Number(s.totalphysicalcash || s.totalPhysicalCash) || 0,
                    cashVariance: s.cashvariance,
                    cashBanked: bankedAmount,
                    cash_banked: bankedAmount,
                    handoverNotes: s.handovernotes || '',
                    replacementPumperId: s.replacementpumperid || '',
                    pumpReadings: sortedReadings
                  };
                });

                const dbActive = mappedShifts.find(s => s.isActive);
                const history = mappedShifts.filter(s => !s.isActive);

                if (dbActive) {
                  setActiveShift(dbActive as unknown as Shift);
                } else {
                  setActiveShift(null);
                }

                setShiftHistory(history as unknown as Shift[]);
              }
            } catch (err) {
              console.warn("Realtime shifts sync notice:", err);
            }
          })
          .subscribe();
      } catch (err) {
        console.warn("Realtime subscription setup notice:", err);
      }
    }

    return () => {
      if (realtimeChannel) {
        supabase.removeChannel(realtimeChannel);
      }
      if (bulkOilChannel) {
        supabase.removeChannel(bulkOilChannel);
      }
      if (shiftsChannel) {
        supabase.removeChannel(shiftsChannel);
      }
    };
  }, []);


  // Sync changes to Supabase and local storage upon state updates
  useEffect(() => {
    const isConfigured = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
    
    if (employees.length > 0) {
      localStorage.setItem('fms_employees', JSON.stringify(employees));
    }

    if (!isConfigured || isInitialLoad.current || dbError || isRlsActive) return;

    if (employees.length > 0) {
      const dbPayload = employees.map(e => ({
        id: e.id, name: e.name, role: e.role, phone: e.phone, status: e.status, avatarcolor: e.avatarColor
      }));
      supabase.from('employees').upsert(dbPayload).then(({ error }) => {
        if (error) handleSyncWriteError(error);
      });
    }
  }, [employees, dbError, isRlsActive]);

  useEffect(() => {
    const isConfigured = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
    
    if (tanks.length > 0) {
      localStorage.setItem('fms_tanks', JSON.stringify(tanks));
    }

    if (!isConfigured || isInitialLoad.current || dbError || isRlsActive) return;

    if (tanks.length > 0) {
      const dbPayload = tanks.map(t => ({
        id: t.id, fueltype: t.fuelType, name: t.name, capacity: t.capacity, currentlevel: t.currentLevel, priceperliter: t.pricePerLiter
      }));
      supabase.from(getTanksTableName()).upsert(dbPayload).then(({ error }) => {
        if (error) handleSyncWriteError(error);
      });
    }
  }, [tanks, dbError, isRlsActive]);

  useEffect(() => {
    const isConfigured = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
    
    // Always persist pumps array to localStorage
    localStorage.setItem('fms_pumps', JSON.stringify(pumps));

    if (!isConfigured || isInitialLoad.current || dbError || isRlsActive) return;

    if (pumps.length > 0) {
      const dbPayload = pumps.map(p => {
        const item: any = { id: p.id, name: p.name, fueltype: p.fuelType, status: p.status };
        if (p.tankId) item.tankid = p.tankId;
        return item;
      });
      supabase.from('pumps').upsert(dbPayload).then(async ({ error }) => {
        if (error && (error.message?.includes('tankid') || error.code === '42703' || error.message?.includes('schema cache'))) {
          // Fallback without tankid if column missing in Supabase schema cache
          const fallbackPayload = pumps.map(p => ({
            id: p.id, name: p.name, fueltype: p.fuelType, status: p.status
          }));
          const { error: fbErr } = await supabase.from('pumps').upsert(fallbackPayload);
          if (fbErr) handleSyncWriteError(fbErr);
        } else if (error) {
          handleSyncWriteError(error);
        }
      });
    }
  }, [pumps, dbError, isRlsActive]);

  useEffect(() => {
    const isConfigured = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
    
    if (activeShift) {
      localStorage.setItem('fms_activeShift', JSON.stringify(activeShift));
    } else {
      localStorage.removeItem('fms_activeShift');
    }

    if (!isConfigured || isInitialLoad.current || dbError || isRlsActive) return;

    const syncActiveShift = async () => {
      if (activeShift) {
        const { pumpReadings, ...shiftData } = activeShift;
        const { error: shiftErr } = await supabase.from('shifts').upsert({
          id: shiftData.id,
          name: shiftData.name,
          supervisorid: shiftData.supervisorId,
          starttime: shiftData.startTime,
          endtime: shiftData.endTime || null,
          isactive: shiftData.isActive,
          totalfuelsold: shiftData.totalFuelSold || 0,
          totalnetsold: shiftData.totalNetSold || 0,
          totalnetsales: shiftData.totalNetSales || 0,
          initialpumpercash: shiftData.initialPumperCash || 0,
          replacementpumpercash: shiftData.replacementPumperCash || 0,
          totalphysicalcash: shiftData.totalPhysicalCash || 0,
          cashvariance: shiftData.cashVariance || 0,
          handovernotes: shiftData.handoverNotes || '',
          replacementpumperid: shiftData.replacementPumperId || null
        });

        if (shiftErr) {
          if (shiftErr.code === '42703' || shiftErr.message?.includes('column')) {
            await supabase.from('shifts').upsert({
              id: shiftData.id,
              name: shiftData.name,
              supervisorid: shiftData.supervisorId,
              starttime: shiftData.startTime,
              endtime: shiftData.endTime || null,
              isactive: shiftData.isActive,
              totalfuelsold: shiftData.totalFuelSold || 0,
              totalnetsold: shiftData.totalNetSold || 0,
              totalnetsales: shiftData.totalNetSales || 0
            });
          } else {
            handleSyncWriteError(shiftErr);
            return;
          }
        }

        if (pumpReadings && pumpReadings.length > 0) {
          const { error: readingsErr } = await upsertPumpReadings(supabase, pumpReadings, activeShift.id);
          if (readingsErr) handleSyncWriteError(readingsErr);
        }
      }
    };
    syncActiveShift();
  }, [activeShift, dbError, isRlsActive]);

  useEffect(() => {
    const isConfigured = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
    
    if (shiftHistory.length > 0) {
      localStorage.setItem('fms_shiftHistory', JSON.stringify(shiftHistory));
    }

    if (!isConfigured || isInitialLoad.current || dbError || isRlsActive) return;

    const syncHistory = async () => {
      if (shiftHistory.length > 0) {
        for (const shift of shiftHistory) {
          const { pumpReadings, ...shiftData } = shift;
          const { error: shiftErr } = await supabase.from('shifts').upsert({
            id: shiftData.id, name: shiftData.name, supervisorid: shiftData.supervisorId, starttime: shiftData.startTime, endtime: shiftData.endTime, isactive: shiftData.isActive, totalfuelsold: shiftData.totalFuelSold, totalnetsold: shiftData.totalNetSold, totalnetsales: shiftData.totalNetSales
          });
          if (shiftErr) {
            handleSyncWriteError(shiftErr);
            continue;
          }
          if (pumpReadings && pumpReadings.length > 0) {
            const { error: readingsErr } = await upsertPumpReadings(supabase, pumpReadings, shift.id);
            if (readingsErr) handleSyncWriteError(readingsErr);
          }
        }
      }
    };
    syncHistory();
  }, [shiftHistory, dbError, isRlsActive]);

  useEffect(() => {
    const isConfigured = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
    
    if (deliveries.length > 0) {
      localStorage.setItem('fms_deliveries', JSON.stringify(deliveries));
    }

    if (!isConfigured || isInitialLoad.current || dbError || isRlsActive) return;

    if (deliveries.length > 0) {
      const dbPayload = deliveries.map(d => ({
        id: d.id, date: d.date, fueltype: d.fuelType, quantity: d.quantity, supplier: d.supplier
      }));
      supabase.from('stock_deliveries').upsert(dbPayload).then(({ error }) => {
        if (error) handleSyncWriteError(error);
      });
    }
  }, [deliveries, dbError, isRlsActive]);

  useEffect(() => {
    const isConfigured = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
    
    if (priceSchedules.length > 0) {
      localStorage.setItem('fms_priceSchedules', JSON.stringify(priceSchedules));
    }

    if (!isConfigured || isInitialLoad.current || dbError || isRlsActive) return;

    if (priceSchedules.length > 0) {
      const dbPayload = priceSchedules.map(p => ({
        id: p.id, fueltype: p.fuelType, newprice: p.newPrice, effectivedate: p.effectiveDate, status: p.status
      }));
      supabase.from('price_schedules').upsert(dbPayload).then(({ error }) => {
        if (error) handleSyncWriteError(error);
      });
    }
  }, [priceSchedules, dbError, isRlsActive]);

  // Automated Price Checker Engine
  useEffect(() => {
    const checkSchedules = () => {
      const now = new Date();
      let hasUpdates = false;
      let newTanks = [...tanks];
      let newSchedules = [...priceSchedules];

      newSchedules = newSchedules.map(schedule => {
        if (schedule.status === 'Pending' && new Date(schedule.effectiveDate) <= now) {
          hasUpdates = true;
          // Apply to tanks
          newTanks = newTanks.map(t => {
            if (t.fuelType === schedule.fuelType) {
              return { ...t, pricePerLiter: schedule.newPrice };
            }
            return t;
          });
          return { ...schedule, status: 'Applied' as const };
        }
        return schedule;
      });

      if (hasUpdates) {
        setTanks(newTanks);
        setPriceSchedules(newSchedules);
      }
    };

    // Check immediately and then every minute
    checkSchedules();
    const interval = setInterval(checkSchedules, 10000); // Check every 10s for demo purposes

    return () => clearInterval(interval);
  }, [tanks, priceSchedules]);

  // Action: Close operational shift and update stock levels automatically
  const handleCloseShift = (closedShift: Shift) => {
    // 1. Deduct Net Sold volume from fuel tanks (testing quantity is returned to underground tanks so 0 deduction for test fuel)
    const netSoldByTank: Record<string, number> = {};
    const netSoldByFuelType: Record<string, number> = {};

    closedShift.pumpReadings.forEach(r => {
      const gross = Math.max(0, r.endMeter - r.startMeter);
      const net = Math.max(0, gross - (r.testingQty || 0)); // Net Sold excludes testing quantity
      
      if (r.tankId) {
        netSoldByTank[r.tankId] = (netSoldByTank[r.tankId] || 0) + net;
      }
      if (r.fuelType) {
        netSoldByFuelType[r.fuelType] = (netSoldByFuelType[r.fuelType] || 0) + net;
      }
    });

    const updatedTanks = tanks.map(tank => {
      const netSold = netSoldByTank[tank.id] ?? netSoldByFuelType[tank.fuelType] ?? 0;
      if (netSold > 0) {
        const newLevel = Math.max(0, tank.currentLevel - netSold);
        return {
          ...tank,
          currentLevel: newLevel
        };
      }
      return tank;
    });

    setTanks(updatedTanks);
    try {
      localStorage.setItem('fms_tanks', JSON.stringify(updatedTanks));
    } catch (_) {}

    // Update local pumps / nozzles state with closing meter carry-over
    if (closedShift.pumpReadings && closedShift.pumpReadings.length > 0) {
      const updatedPumps = pumps.map(p => {
        const rd = closedShift.pumpReadings.find(r => r.pumpId === p.id);
        if (rd && rd.endMeter !== undefined && rd.endMeter > 0) {
          return { ...p, startMeter: rd.endMeter };
        }
        return p;
      });
      setPumps(updatedPumps);
      try {
        localStorage.setItem('fms_pumps', JSON.stringify(updatedPumps));
      } catch (_) {}
    }

    // Persist updated tank levels directly to Supabase fuel_tanks table
    const isConfigured = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
    if (isConfigured && !dbError && !isRlsActive) {
      const tankPayload = updatedTanks.map(t => ({
        id: t.id,
        fueltype: t.fuelType,
        name: t.name,
        capacity: t.capacity,
        currentlevel: t.currentLevel,
        priceperliter: t.pricePerLiter
      }));
      supabase.from(getTanksTableName()).upsert(tankPayload).then(({ error }) => {
        if (error) console.warn("Supabase tank level deduction update notice:", error?.message || error);
      });

      // Update nozzle carry-over start_meter directly in nozzles and pumps tables in Supabase
      if (closedShift.pumpReadings && closedShift.pumpReadings.length > 0) {
        updateNozzleMeterCarryover(supabase, closedShift.pumpReadings.map(r => ({ pumpId: r.pumpId, endMeter: r.endMeter })));
      }
    }

    // Deduct bulk oil dispenser chamber levels in real-time if chamberReadings are recorded
    if (closedShift.pumpReadings && closedShift.pumpReadings.length > 0) {
      const chamberSalesMap = new Map<string, number>();
      closedShift.pumpReadings.forEach(r => {
        if (r.chamberReadings && r.chamberReadings.length > 0) {
          r.chamberReadings.forEach(cr => {
            if (cr.soldLiters > 0) {
              const current = chamberSalesMap.get(cr.chamberId) || 0;
              chamberSalesMap.set(cr.chamberId, current + cr.soldLiters);
            }
          });
        }
      });

      if (chamberSalesMap.size > 0) {
        setOilTanks(prev => {
          const updated = prev.map(ot => {
            const sold = chamberSalesMap.get(ot.id) || 0;
            if (sold > 0) {
              const newLevel = Math.max(0, Number((ot.currentLevel - sold).toFixed(2)));
              saveOilTank({ ...ot, currentLevel: newLevel });
              return { ...ot, currentLevel: newLevel };
            }
            return ot;
          });
          try {
            localStorage.setItem('fms_oil_tanks', JSON.stringify(updated));
          } catch (_) {}
          return updated;
        });
      }
    }

    // 2. Add shift to completed history list
    const updatedHistory = [closedShift, ...shiftHistory];
    setShiftHistory(updatedHistory);

    // Explicitly update closed shift and completed pump readings in Supabase
    if (isConfigured) {
      const { pumpReadings, ...shiftData } = closedShift;
      const closedTime = shiftData.endTime || new Date().toISOString();
      
      const supervisorObj = employees.find(e => e.id === shiftData.supervisorId);
      const supervisorName = supervisorObj ? supervisorObj.name : 'Supervisor';
      const cashBankedVal = Number(shiftData.cashBanked ?? (shiftData as any).cash_banked) || 0;

      supabase.from('shifts').upsert({
        id: shiftData.id,
        name: shiftData.name,
        supervisorid: shiftData.supervisorId,
        starttime: shiftData.startTime,
        endtime: closedTime,
        isactive: false,
        totalfuelsold: shiftData.totalFuelSold || 0,
        totalnetsold: shiftData.totalNetSold || 0,
        totalnetsales: shiftData.totalNetSales || 0,
        initialpumpercash: shiftData.initialPumperCash || 0,
        replacementpumpercash: shiftData.replacementPumperCash || 0,
        totalphysicalcash: shiftData.totalPhysicalCash || 0,
        cashvariance: shiftData.cashVariance || 0,
        cash_banked: cashBankedVal,
        cashbanked: cashBankedVal,
        handovernotes: shiftData.handoverNotes || '',
        replacementpumperid: shiftData.replacementPumperId || null
      }).then(async ({ error: sErr }) => {
        if (sErr && (sErr.code === '42703' || sErr.message?.includes('column'))) {
          const { error: retryErr } = await supabase.from('shifts').upsert({
            id: shiftData.id,
            name: shiftData.name,
            supervisorid: shiftData.supervisorId,
            starttime: shiftData.startTime,
            endtime: closedTime,
            isactive: false,
            totalfuelsold: shiftData.totalFuelSold || 0,
            totalnetsold: shiftData.totalNetSold || 0,
            totalnetsales: shiftData.totalNetSales || 0,
            cash_banked: cashBankedVal
          });
          if (retryErr && (retryErr.code === '42703' || retryErr.message?.includes('column'))) {
            await supabase.from('shifts').upsert({
              id: shiftData.id,
              name: shiftData.name,
              supervisorid: shiftData.supervisorId,
              starttime: shiftData.startTime,
              endtime: closedTime,
              isactive: false,
              totalfuelsold: shiftData.totalFuelSold || 0,
              totalnetsold: shiftData.totalNetSold || 0,
              totalnetsales: shiftData.totalNetSales || 0
            });
          }
        } else if (sErr) {
          console.warn("Supabase shift close notice:", sErr?.message || sErr);
        }
      });

      // Record detailed shift bank deposit in shift_bank_deposits table
      if (cashBankedVal > 0) {
        try {
          recordShiftBankDeposit(supabase, {
            shift_id: closedShift.id,
            deposited_amount: cashBankedVal,
            deposited_by: supervisorName,
            deposit_date: new Date().toISOString(),
            notes: `End of shift deposit for ${closedShift.name || closedShift.id}`
          });
        } catch (depErr) {
          console.warn('shift_bank_deposits error in App.tsx:', depErr);
        }
      }

      if (pumpReadings && pumpReadings.length > 0) {
        // Filter out unassigned and inactive nozzles to prevent dummy records in shift_logs and pump_readings
        const activePumpReadings = pumpReadings.filter(isPumpReadingActiveOrAssigned);
        const completedReadings = activePumpReadings.map(r => ({ ...r, status: 'Completed' as const, isLocked: true }));

        if (completedReadings.length > 0) {
          upsertPumpReadings(supabase, completedReadings, closedShift.id).then(({ error: prErr }) => {
            if (prErr) console.warn("Supabase pump_readings close notice:", prErr?.message || prErr);
          });

          // Explicit direct inserts into credit_sales, card_sales, touch_card_sales, voucher_sales tables
          syncAllNonCashSales(supabase, activePumpReadings, closedShift.id);

          // Save detailed shift logs entry ONLY for active / assigned pumps
          saveShiftLogs(supabase, closedShift, activePumpReadings);
        }
      }
    }

    // 3. Reset assigned pumper states in the employees directory back to Active/Off-duty
    const updatedEmployees = employees.map(emp => {
      if (emp.status === 'On Shift') {
        return {
          ...emp,
          status: 'Active' as const
        };
      }
      return emp;
    });
    setEmployees(updatedEmployees);

    // 4. Set active shift to null
    setActiveShift(null);
  };

  // Action: Launch a new shift
  const handleStartShift = (newShiftData: Omit<Shift, 'totalFuelSold' | 'totalNetSold' | 'totalNetSales'>) => {
    const fullNewShift: Shift = {
      ...newShiftData,
      totalFuelSold: 0,
      totalNetSold: 0,
      totalNetSales: 0
    };

    setActiveShift(fullNewShift);

    // Update employees assigned to this new shift
    const updatedEmployees = employees.map(emp => {
      // Mark supervisor as on shift
      if (emp.id === newShiftData.supervisorId) {
        return { ...emp, status: 'On Shift' as const };
      }
      return emp;
    });
    setEmployees(updatedEmployees);
  };

  // Action: Diagnostic hard reset back to default demo database
  const handleResetAllData = () => {
    // Clear all offline local storage caches
    const fmsKeys = [
      'fms_employees',
      'fms_tanks',
      'fms_activeShift',
      'fms_shiftHistory',
      'fms_deliveries',
      'fms_priceSchedules',
      'fuelflow_station_name',
      'fuelflow_station_location',
      'fuelflow_station_currency'
    ];
    fmsKeys.forEach(k => localStorage.removeItem(k));
    console.log('Cleared all offline local caches to pull fresh from Supabase.');
  };

  const handleDeleteShift = async (shiftId: string) => {
    if (confirm(`Are you sure you want to delete shift record ${shiftId}? This will remove the shift and its associated pump readings.`)) {
      const isConfigured = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
      if (isConfigured) {
        try {
          await supabase.from('pump_readings').delete().eq('shift_id', shiftId);
          const { error } = await supabase.from('shifts').delete().eq('id', shiftId);
          if (error) console.warn("Supabase shift delete error:", error.message);
        } catch (err) {
          console.warn("Shift delete error:", err);
        }
      }
      const updated = shiftHistory.filter(s => s.id !== shiftId);
      setShiftHistory(updated);
      localStorage.setItem('fms_shiftHistory', JSON.stringify(updated));
    }
  };

  if (!user) {
    return <LoginPage onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div id="app-root-layout" className="flex min-h-screen bg-[#F4F7F6] text-[#1C1C1C] font-sans antialiased tabular-nums">
      {/* Sidebar - fixed left panel */}
      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={handleSetActiveTab} 
        activeReportSubTab={reportSubTab}
        activeAdminSubTab={adminSubTab}
        user={user} 
        onLogout={handleLogout} 
        isCollapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
      />

      {/* Main Panel Content Area */}
      <div id="main-content-panel" className={`flex-1 ${sidebarCollapsed ? 'ml-20' : 'ml-64'} px-6 pt-3 pb-8 min-h-screen overflow-x-hidden transition-all duration-300 ease-in-out`}>
        {/* Global Ultra-Compact Sticky Top Header */}
        <header id="app-top-header" className="sticky top-0 z-40 bg-[#F4F7F6]/95 backdrop-blur-sm border-b border-slate-200/80 pb-3 pt-2 px-6 -mx-6 mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-white border border-slate-200/90 rounded-lg shadow-2xs text-[11px] font-extrabold text-slate-800 font-sans">
              <Building2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>Samse Auto Mart (Pvt) Ltd</span>
            </div>

            {/* Date inline text */}
            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
              <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span>{new Date().toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}</span>
            </div>
          </div>

          {/* Ultra-Compact User Profile Badge Pill & Logout */}
          <div id="header-user-profile" className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 pl-1 pr-1.5 py-0.5 bg-white border border-slate-200/90 rounded-full shadow-2xs hover:border-slate-300 transition-all font-sans">
              <div className={`w-6 h-6 rounded-full ${user?.avatarColor || 'bg-emerald-600'} text-white flex items-center justify-center font-extrabold text-[10px] shrink-0 shadow-2xs`}>
                {getInitials(user?.name)}
              </div>
              <div className="flex flex-col text-left leading-none pr-0.5">
                <span className="font-extrabold text-slate-900 text-[11px]">{user?.name || 'Rumesh Anjana'}</span>
                <span className="text-[9px] font-semibold text-slate-500 mt-0.5">{user?.role || 'System Admin'}</span>
              </div>
              <div className="h-3.5 w-px bg-slate-200 mx-0.5" />
              <button
                onClick={handleLogout}
                className="p-0.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-all cursor-pointer"
                title="Sign Out"
              >
                <LogOut className="w-3 h-3" />
              </button>
            </div>
          </div>
        </header>

        {isRlsActive && (
          <div id="supabase-rls-alert" className="mb-6 p-4 bg-amber-50 border border-amber-200 text-amber-900 rounded-2xl text-xs flex items-start gap-3 animate-fade-in relative shadow-sm">
            <ShieldCheck className="w-4.5 h-4.5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <span className="font-bold block text-sm text-amber-950 font-sans">Supabase Row-Level Security (RLS) is Active</span>
              <p className="mt-1 text-xs text-amber-800 leading-relaxed font-sans">
                Your database queries succeeded, but write operations are blocked by active RLS security policies. To fix this and enable seamless cloud-mode saving:
                <br />
                1. Go to your <strong>Settings Tab</strong> below.
                <br />
                2. Click <strong>Copy SQL Script</strong>.
                <br />
                3. Go to your Supabase Dashboard <strong>SQL Editor</strong>, paste and run the query to configure appropriate write permissions.
                <br />
                <span className="font-bold text-amber-950 mt-1 block">Note: The app is operating in Local Storage offline fallback mode, so you will not lose any active work, added tanks, employees, or shift logs!</span>
              </p>
              <div className="mt-3 flex gap-3">
                <button 
                  onClick={() => setIsRlsActive(false)}
                  className="px-3 py-1.5 bg-amber-200/60 hover:bg-amber-200 text-amber-950 font-bold text-[11px] rounded-lg transition-all cursor-pointer"
                >
                  Dismiss Warning
                </button>
              </div>
            </div>
          </div>
        )}
        {dbError && (
          <div id="supabase-status-alert" className="mb-6 p-4 bg-amber-50 border border-amber-200 text-amber-900 rounded-2xl text-xs flex items-start gap-3 animate-fade-in relative shadow-sm">
            <Info className="w-4.5 h-4.5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <span className="font-bold block text-sm text-amber-950">Supabase Connection Notice</span>
              <p className="mt-1 text-xs text-amber-800 leading-relaxed">
                {dbError}
              </p>
              <div className="mt-3 flex gap-3">
                <button 
                  onClick={() => setDbError(null)}
                  className="px-3 py-1.5 bg-amber-200/60 hover:bg-amber-200 text-amber-900 font-bold text-[11px] rounded-lg transition-all cursor-pointer"
                >
                  Dismiss Notice
                </button>
              </div>
            </div>
          </div>
        )}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            id={`tab-content-wrapper-${activeTab}`}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="w-full h-full"
          >
            {activeTab === 'dashboard' && (
              <DashboardTab
                employees={employees}
                tanks={tanks}
                pumps={pumps}
                activeShift={activeShift}
                shiftHistory={shiftHistory}
                setActiveTab={setActiveTab}
              />
            )}

            {activeTab === 'shift' && (
              <ShiftManagementTab
                employees={employees}
                tanks={tanks}
                setTanks={setTanks}
                oilTanks={oilTanks}
                setOilTanks={setOilTanks}
                pumps={pumps}
                setPumps={setPumps}
                pumpMachines={pumpMachines}
                activeShift={activeShift}
                setActiveShift={setActiveShift}
                shiftHistory={shiftHistory}
                onCloseShift={handleCloseShift}
                onStartShift={handleStartShift}
              />
            )}

            {activeTab === 'stock' && (
              <FuelStockTab
                tanks={tanks}
                setTanks={setTanks}
                pumps={pumps}
                setPumps={setPumps}
                deliveries={deliveries}
                setDeliveries={setDeliveries}
                onNavigateToAdminTanks={() => {
                  setActiveTab('admin');
                  setAdminSubTab('tanks');
                }}
                setActiveTab={(tab, subTab) => {
                  setActiveTab(tab);
                  if (subTab) setAdminSubTab(subTab as any);
                }}
              />
            )}

            {activeTab === 'oil-storage' && (
              <OilStorageTab
                oilTanks={oilTanks}
                setOilTanks={setOilTanks}
                employees={employees}
                user={user}
              />
            )}

            {activeTab === 'gas-inventory' && (
              <LPGasInventoryTab 
                gasStock={gasStock}
                onUpdateGasStock={handleUpdateGasStock}
              />
            )}

            {activeTab === 'purchases' && (
              <PurchasesTab
                tanks={tanks}
                setTanks={setTanks}
                oilTanks={oilTanks}
                setOilTanks={setOilTanks}
                deliveries={deliveries}
                setDeliveries={setDeliveries}
                gasStock={gasStock}
                onUpdateGasStock={handleUpdateGasStock}
                employees={employees}
                user={user}
                userRole={user?.role}
              />
            )}

            {activeTab === 'sales' && (
              <DailySalesTab
                shiftHistory={shiftHistory}
                setShiftHistory={setShiftHistory}
                onDeleteShift={handleDeleteShift}
                employees={employees}
                tanks={tanks}
                oilTanks={oilTanks}
              />
            )}

            {activeTab === 'manual-dip-record' && (
              <ManualDipTab
                tanks={tanks}
              />
            )}

            {activeTab === 'reports' && (
              <ReportsTab
                activeSubTab={reportSubTab as any}
                onSubTabChange={setReportSubTab as any}
                shiftHistory={shiftHistory}
                deliveries={deliveries}
                tanks={tanks}
                oilTanks={oilTanks}
                pumps={pumps}
                employees={employees}
                customers={customers}
                creditTransactions={creditTransactions}
                payments={payments}
              />
            )}

            {activeTab === 'customers' && (
              <CustomersTab
                customers={customers}
                setCustomers={setCustomers}
                creditTransactions={creditTransactions}
                setCreditTransactions={setCreditTransactions}
                payments={payments}
                setPayments={setPayments}
                tanks={tanks}
                user={user}
                userRole={user?.role}
              />
            )}

            {activeTab === 'price' && (
              <AdminControlTab
                activeSubTab="price"
                onSubTabChange={(sub) => {
                  setActiveTab('admin');
                  setAdminSubTab(sub);
                }}
                tanks={tanks}
                setTanks={setTanks}
                oilTanks={oilTanks}
                setOilTanks={setOilTanks}
                pumps={pumps}
                setPumps={setPumps}
                pumpMachines={pumpMachines}
                setPumpMachines={setPumpMachines}
                employees={employees}
                setEmployees={setEmployees}
                priceSchedules={priceSchedules}
                setPriceSchedules={setPriceSchedules}
                onResetAllData={handleResetAllData}
                user={user}
                userRole={user?.role}
              />
            )}

            {activeTab === 'admin' && (
              <AdminControlTab
                activeSubTab={adminSubTab}
                onSubTabChange={setAdminSubTab}
                tanks={tanks}
                setTanks={setTanks}
                oilTanks={oilTanks}
                setOilTanks={setOilTanks}
                pumps={pumps}
                setPumps={setPumps}
                pumpMachines={pumpMachines}
                setPumpMachines={setPumpMachines}
                employees={employees}
                setEmployees={setEmployees}
                priceSchedules={priceSchedules}
                setPriceSchedules={setPriceSchedules}
                onResetAllData={handleResetAllData}
                user={user}
                userRole={user?.role}
              />
            )}

            {activeTab === 'employees' && (
              <AdminControlTab
                activeSubTab="employees"
                onSubTabChange={(sub) => {
                  setActiveTab('admin');
                  setAdminSubTab(sub);
                }}
                tanks={tanks}
                setTanks={setTanks}
                oilTanks={oilTanks}
                setOilTanks={setOilTanks}
                pumps={pumps}
                setPumps={setPumps}
                employees={employees}
                setEmployees={setEmployees}
                priceSchedules={priceSchedules}
                setPriceSchedules={setPriceSchedules}
                onResetAllData={handleResetAllData}
                user={user}
                userRole={user?.role}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
