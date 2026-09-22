/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { 
  ShieldCheck, Fuel, Users, Sliders, Plus, Trash2, 
  CheckCircle2, AlertTriangle, Database, Copy, Check,
  Landmark, Edit2, Search, Phone, X, RefreshCcw,
  Layers, Info, Tag, Calendar, Clock, Save, Gauge, Droplets, Flame
} from 'lucide-react';
import { Employee, FuelTank, FuelType, Pump, PumpMachine, PriceSchedule, OilTank, AuthUser } from '../types';
import { supabase, getTanksTableName } from '../lib/supabase';
import { savePumpMachine, deletePumpMachine, saveNozzle, deleteNozzle, saveFuelTank, deleteFuelTank, saveOilTank, deleteOilTank } from '../lib/supabaseClient';
import { saveBulkLubricant, deleteBulkLubricant } from '../lib/lubricantsClient';
import { SUPABASE_SQL } from '../lib/sqlSchema';
import { isAdmin } from '../lib/auth';
import LubricantStorageTab from './admin/LubricantStorageTab';
import UndergroundTanksTab from './admin/UndergroundTanksTab';

interface AdminControlTabProps {
  activeSubTab?: 'tanks' | 'oils' | 'mapping' | 'employees' | 'price' | 'system';
  onSubTabChange?: (tab: 'tanks' | 'oils' | 'mapping' | 'employees' | 'price' | 'system') => void;
  tanks: FuelTank[];
  setTanks: React.Dispatch<React.SetStateAction<FuelTank[]>>;
  oilTanks?: OilTank[];
  setOilTanks?: React.Dispatch<React.SetStateAction<OilTank[]>>;
  pumps: Pump[];
  setPumps: React.Dispatch<React.SetStateAction<Pump[]>>;
  pumpMachines?: PumpMachine[];
  setPumpMachines?: React.Dispatch<React.SetStateAction<PumpMachine[]>>;
  employees: Employee[];
  setEmployees: React.Dispatch<React.SetStateAction<Employee[]>>;
  priceSchedules?: PriceSchedule[];
  setPriceSchedules?: React.Dispatch<React.SetStateAction<PriceSchedule[]>>;
  onResetAllData: () => void;
  user?: AuthUser | null;
  userRole?: string;
}

export default function AdminControlTab({
  activeSubTab,
  onSubTabChange,
  tanks,
  setTanks,
  oilTanks,
  setOilTanks,
  pumps,
  setPumps,
  pumpMachines = [],
  setPumpMachines,
  employees,
  setEmployees,
  priceSchedules = [],
  setPriceSchedules,
  onResetAllData,
  user,
  userRole
}: AdminControlTabProps) {
  // Active sub-tab inside Admin Control: 'tanks' | 'oils' | 'mapping' | 'employees' | 'price' | 'system'
  const [internalAdminSection, setInternalAdminSection] = useState<'tanks' | 'oils' | 'mapping' | 'employees' | 'price' | 'system'>('tanks');
  
  const adminSection = activeSubTab || internalAdminSection;
  const setAdminSection = (tab: 'tanks' | 'oils' | 'mapping' | 'employees' | 'price' | 'system') => {
    if (onSubTabChange) {
      onSubTabChange(tab);
    }
    setInternalAdminSection(tab);
  };

  // Global Toast Notification
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const formatCurrency = (val: number) => {
    return `Rs. ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val)}`;
  };

  // Natural numerical sorting of tanks (Tank 01, Tank 02, etc.)
  const sortedTanks = useMemo(() => {
    return [...tanks].sort((a, b) => (a.name || a.id || '').localeCompare(b.name || b.id || '', undefined, { numeric: true, sensitivity: 'base' }));
  }, [tanks]);

  // Local oil tanks state fallback if not passed from parent
  const [localOilTanks, setLocalOilTanks] = useState<OilTank[]>([]);

  const effectiveOilTanks = oilTanks ?? localOilTanks;
  const setEffectiveOilTanks = setOilTanks ?? setLocalOilTanks;

  // -------------------------------------------------------------
  // A) UNDERGROUND TANKS MANAGEMENT (Add, Edit, Delete)
  // -------------------------------------------------------------
  const [isAddTankModalOpen, setIsAddTankModalOpen] = useState(false);
  const [editingTank, setEditingTank] = useState<FuelTank | null>(null);

  // Form fields for Tank Add/Edit
  const [tankFormName, setTankFormName] = useState('');
  const [tankFormFuelType, setTankFormFuelType] = useState<FuelType>('Petrol 92');
  const [tankFormCapacity, setTankFormCapacity] = useState<number>(15000);
  const [tankFormCurrentLevel, setTankFormCurrentLevel] = useState<number>(0);
  const [tankFormPrice, setTankFormPrice] = useState<number>(0);
  const [tankModalError, setTankModalError] = useState<string | null>(null);

  const handleOpenAddTankModal = () => {
    setEditingTank(null);
    setTankFormName('');
    setTankFormFuelType('Petrol 92');
    setTankFormCapacity(15000);
    setTankFormCurrentLevel(0);
    setTankFormPrice(0);
    setTankModalError(null);
    setIsAddTankModalOpen(true);
  };

  const handleOpenEditTankModal = (tank: FuelTank) => {
    setEditingTank(tank);
    setTankFormName(tank.name);
    setTankFormFuelType(tank.fuelType);
    setTankFormCapacity(tank.capacity);
    setTankFormCurrentLevel(tank.currentLevel);
    setTankFormPrice(tank.pricePerLiter);
    setTankModalError(null);
    setIsAddTankModalOpen(true);
  };

  const handleSaveTankSubmit = async () => {
    if (!tankFormName.trim()) {
      setTankModalError('Tank name is required (e.g. Tank 01 - Petrol 92).');
      return;
    }
    if (tankFormCapacity <= 0) {
      setTankModalError('Tank capacity must be greater than 0 liters.');
      return;
    }

    const capVal = Number(tankFormCapacity) || 0;

    if (editingTank) {
      // Update existing tank
      const updatedTank: FuelTank = {
        ...editingTank,
        name: tankFormName.trim(),
        fuelType: tankFormFuelType,
        capacity: capVal,
        currentLevel: Math.min(editingTank.currentLevel, capVal),
        pricePerLiter: editingTank.pricePerLiter || 0
      };

      const nextTanks = tanks.map(t => t.id === editingTank.id ? updatedTank : t);
      setTanks(nextTanks);
      try { localStorage.setItem('fms_tanks', JSON.stringify(nextTanks)); } catch (_) {}

      await saveFuelTank(supabase, updatedTank);

      setIsAddTankModalOpen(false);
      showToast(`Underground Tank "${updatedTank.name}" updated successfully.`);
    } else {
      // Create new tank - default initial volume strictly 0 L, default unit price strictly 0.00
      const newTank: FuelTank = {
        id: `tank-${Date.now().toString().slice(-6)}`,
        name: tankFormName.trim(),
        fuelType: tankFormFuelType,
        capacity: capVal,
        currentLevel: 0,
        pricePerLiter: 0
      };

      const nextTanks = [...tanks, newTank];
      setTanks(nextTanks);
      try { localStorage.setItem('fms_tanks', JSON.stringify(nextTanks)); } catch (_) {}

      await saveFuelTank(supabase, newTank);

      setIsAddTankModalOpen(false);
      showToast(`Underground Tank "${newTank.name}" created successfully.`);
    }
  };

  const handleDeleteTank = async (tankId: string) => {
    const targetTank = tanks.find(t => t.id === tankId);
    if (!targetTank) return;

    const mappedPumps = pumps.filter(p => p.tankId === tankId);
    if (mappedPumps.length > 0) {
      if (!confirm(`Warning: ${mappedPumps.length} pump(s) (${mappedPumps.map(p => p.name).join(', ')}) are currently mapped to this tank. Deleting it will unmap those pumps. Continue?`)) {
        return;
      }
    } else {
      if (!confirm(`Are you sure you want to delete "${targetTank.name}"? This action cannot be undone.`)) {
        return;
      }
    }

    const nextTanks = tanks.filter(t => t.id !== tankId);
    setTanks(nextTanks);
    try { localStorage.setItem('fms_tanks', JSON.stringify(nextTanks)); } catch (_) {}

    await deleteFuelTank(supabase, tankId);

    showToast(`Storage Tank "${targetTank.name}" deleted.`);
  };

  // -------------------------------------------------------------
  // C) FUEL NOZZLES MANAGEMENT (Add, Edit, Save, Delete)
  // -------------------------------------------------------------
  // Nozzle Modal State
  const [isAddNozzleModalOpen, setIsAddNozzleModalOpen] = useState(false);
  const [editingNozzle, setEditingNozzle] = useState<Pump | null>(null);
  const [nozzleFormName, setNozzleFormName] = useState('');
  const [nozzleFormFuelType, setNozzleFormFuelType] = useState<FuelType>('Petrol 92');
  const [nozzleFormTankId, setNozzleFormTankId] = useState('');
  const [nozzleFormStartMeter, setNozzleFormStartMeter] = useState<number>(10000);
  const [nozzleFormStatus, setNozzleFormStatus] = useState<'Active' | 'Idle' | 'Maintenance'>('Active');
  const [nozzleModalError, setNozzleModalError] = useState<string | null>(null);

  // --- NOZZLE HANDLERS ---
  const handleOpenAddNozzleModal = (parentTankId?: string) => {
    setEditingNozzle(null);
    setNozzleFormName('');
    const targetTank = tanks.find(t => t.id === parentTankId) || tanks[0];
    setNozzleFormTankId(targetTank?.id || '');
    setNozzleFormFuelType(targetTank?.fuelType || 'Petrol 92');
    setNozzleFormStartMeter(0);
    setNozzleFormStatus('Active');
    setNozzleModalError(null);
    setIsAddNozzleModalOpen(true);
  };

  const handleOpenEditNozzleModal = (nozzle: Pump) => {
    setEditingNozzle(nozzle);
    setNozzleFormName(nozzle.name);
    setNozzleFormFuelType(nozzle.fuelType);
    setNozzleFormTankId(nozzle.tankId || '');
    setNozzleFormStartMeter(nozzle.startMeter || 0);
    setNozzleFormStatus(nozzle.status || 'Active');
    setNozzleModalError(null);
    setIsAddNozzleModalOpen(true);
  };

  const handleSaveNozzleSubmit = async () => {
    if (!nozzleFormName.trim()) {
      setNozzleModalError('Pump name is required (e.g. Pump 01 - Petrol 92).');
      return;
    }
    if (!nozzleFormTankId) {
      setNozzleModalError('Please select a target underground storage tank.');
      return;
    }

    const selectedTank = tanks.find(t => t.id === nozzleFormTankId);
    const resolvedFuelType = selectedTank ? selectedTank.fuelType : nozzleFormFuelType;

    if (editingNozzle) {
      const updatedNozzle: Pump = {
        ...editingNozzle,
        name: nozzleFormName.trim(),
        fuelType: resolvedFuelType,
        tankId: nozzleFormTankId,
        startMeter: Number(nozzleFormStartMeter) || 0,
        status: nozzleFormStatus || 'Active'
      };

      const nextPumps = pumps.map(p => p.id === editingNozzle.id ? updatedNozzle : p);
      setPumps(nextPumps);
      try { localStorage.setItem('fms_pumps', JSON.stringify(nextPumps)); } catch (_) {}

      await saveNozzle(supabase, updatedNozzle);

      setIsAddNozzleModalOpen(false);
      showToast(`Pump "${updatedNozzle.name}" updated successfully.`);
    } else {
      const newNozzle: Pump = {
        id: `noz-${Date.now().toString().slice(-4)}`,
        name: nozzleFormName.trim(),
        fuelType: resolvedFuelType,
        tankId: nozzleFormTankId,
        startMeter: 0,
        status: 'Active'
      };

      const nextPumps = [...pumps, newNozzle];
      setPumps(nextPumps);
      try { localStorage.setItem('fms_pumps', JSON.stringify(nextPumps)); } catch (_) {}

      await saveNozzle(supabase, newNozzle);

      setIsAddNozzleModalOpen(false);
      showToast(`New Nozzle "${newNozzle.name}" added directly to ${selectedTank?.name || 'Storage Tank'}.`);
    }
  };

  const handleDeleteNozzle = async (nozzleId: string) => {
    const target = pumps.find(p => p.id === nozzleId);
    if (!target) return;

    if (!window.confirm(`Are you sure you want to delete nozzle "${target.name}"?`)) {
      return;
    }

    const nextPumps = pumps.filter(p => p.id !== nozzleId);
    setPumps(nextPumps);
    try { localStorage.setItem('fms_pumps', JSON.stringify(nextPumps)); } catch (_) {}

    await deleteNozzle(supabase, nozzleId);

    showToast(`Nozzle "${target.name}" deleted.`);
  };

  const handleDeletePump = async (pumpId: string) => {
    const pump = pumps.find(p => p.id === pumpId);
    if (!pump) return;

    if (window.confirm(`Are you sure you want to delete "${pump.name}" (${pump.id})?`)) {
      try {
        const { error } = await supabase.from('pumps').delete().eq('id', pumpId);
        if (error) console.warn("Supabase delete pump error:", error);

        const nextPumps = pumps.filter(p => p.id !== pumpId);
        setPumps(nextPumps);
        localStorage.setItem('fms_pumps', JSON.stringify(nextPumps));

        showToast(`Pump "${pump.name}" permanently deleted.`);
      } catch (err) {
        console.warn("Supabase delete pump error:", err);
        const nextPumps = pumps.filter(p => p.id !== pumpId);
        setPumps(nextPumps);
        localStorage.setItem('fms_pumps', JSON.stringify(nextPumps));
        showToast(`Pump "${pump.name}" removed locally.`);
      }
    }
  };

  // -------------------------------------------------------------
  // C) EMPLOYEE / STAFF DIRECTORY (Add, Edit, Delete, Status Toggle)
  // -------------------------------------------------------------
  const [empSearchQuery, setEmpSearchQuery] = useState('');
  const [isAddEmpModalOpen, setIsAddEmpModalOpen] = useState(false);
  const [editingEmp, setEditingEmp] = useState<Employee | null>(null);

  const [empFormName, setEmpFormName] = useState('');
  const [empFormRole, setEmpFormRole] = useState<'Supervisor' | 'Pumper'>('Pumper');
  const [empFormPhone, setEmpFormPhone] = useState('');
  const [empFormStatus, setEmpFormStatus] = useState<'Active' | 'Inactive'>('Active');
  const [empModalError, setEmpModalError] = useState<string | null>(null);

  const avatarColors = [
    'bg-blue-500', 'bg-emerald-500', 'bg-pink-500', 
    'bg-purple-500', 'bg-indigo-500', 'bg-amber-500', 
    'bg-teal-500', 'bg-orange-500'
  ];

  const filteredEmployees = employees.filter(emp => {
    const q = empSearchQuery.toLowerCase();
    return (
      emp.name.toLowerCase().includes(q) ||
      emp.role.toLowerCase().includes(q) ||
      emp.phone.toLowerCase().includes(q) ||
      emp.status.toLowerCase().includes(q)
    );
  });

  const handleOpenAddEmpModal = () => {
    setEditingEmp(null);
    setEmpFormName('');
    setEmpFormRole('Pumper');
    setEmpFormPhone('');
    setEmpFormStatus('Active');
    setEmpModalError(null);
    setIsAddEmpModalOpen(true);
  };

  const handleOpenEditEmpModal = (emp: Employee) => {
    setEditingEmp(emp);
    setEmpFormName(emp.name);
    setEmpFormRole(emp.role);
    setEmpFormPhone(emp.phone);
    setEmpFormStatus(emp.status);
    setEmpModalError(null);
    setIsAddEmpModalOpen(true);
  };

  const handleSaveEmpSubmit = async () => {
    if (!empFormName.trim()) {
      setEmpModalError('Staff member name is required.');
      return;
    }
    if (!empFormPhone.trim()) {
      setEmpModalError('Contact phone number is required.');
      return;
    }

    if (editingEmp) {
      // Edit Employee
      const updatedEmp: Employee = {
        ...editingEmp,
        name: empFormName.trim(),
        role: empFormRole,
        phone: empFormPhone.trim(),
        status: empFormStatus
      };

      setEmployees(prev => prev.map(e => e.id === editingEmp.id ? updatedEmp : e));

      try {
        await supabase.from('employees').upsert({
          id: updatedEmp.id,
          name: updatedEmp.name,
          role: updatedEmp.role,
          phone: updatedEmp.phone,
          status: updatedEmp.status,
          avatarcolor: updatedEmp.avatarColor || 'bg-blue-500'
        });
      } catch (err) {
        console.warn("Supabase edit employee error:", err);
      }

      setIsAddEmpModalOpen(false);
      showToast(`Staff member ${updatedEmp.name} updated.`);
    } else {
      // Add Employee
      const randomColor = avatarColors[Math.floor(Math.random() * avatarColors.length)];
      const newEmp: Employee = {
        id: `emp-${Date.now().toString().slice(-4)}`,
        name: empFormName.trim(),
        role: empFormRole,
        phone: empFormPhone.trim(),
        status: 'Active',
        avatarColor: randomColor
      };

      setEmployees(prev => [...prev, newEmp]);

      try {
        await supabase.from('employees').insert([{
          id: newEmp.id,
          name: newEmp.name,
          role: newEmp.role,
          phone: newEmp.phone,
          status: newEmp.status,
          avatarcolor: newEmp.avatarColor
        }]);
      } catch (err) {
        console.warn("Supabase emp insert error:", err);
      }

      setIsAddEmpModalOpen(false);
      showToast(`Registered staff member ${newEmp.name}.`);
    }
  };

  const handleToggleEmpStatus = async (empId: string) => {
    const emp = employees.find(e => e.id === empId);
    if (!emp) return;

    const nextStatus = emp.status === 'Active' ? 'Inactive' : 'Active';
    setEmployees(prev => prev.map(e => e.id === empId ? { ...e, status: nextStatus as 'Active' | 'Inactive' } : e));

    try {
      await supabase.from('employees').update({ status: nextStatus }).eq('id', empId);
    } catch (err) {
      console.warn("Error updating employee status:", err);
    }

    showToast(`${emp.name} set to ${nextStatus}.`);
  };

  const handleDeleteEmployee = async (empId: string) => {
    const emp = employees.find(e => e.id === empId);
    if (!emp) return;

    if (window.confirm(`Are you sure you want to remove staff member "${emp.name}"?`)) {
      setEmployees(prev => prev.filter(e => e.id !== empId));
      try {
        await supabase.from('employees').delete().eq('id', empId);
      } catch (err) {
        console.warn("Error deleting employee:", err);
      }
      showToast(`Removed ${emp.name} from staff directory.`);
    }
  };

  // -------------------------------------------------------------
  // D) PRICE & TARIFF MANAGEMENT (Retail prices & Pending schedules)
  // -------------------------------------------------------------
  const [editingTankPriceId, setEditingTankPriceId] = useState<string | null>(null);
  const [tempPriceVal, setTempPriceVal] = useState<number>(0);

  const [schedFuelType, setSchedFuelType] = useState<FuelType>('Petrol 92');
  const [schedPrice, setSchedPrice] = useState<number>(0);
  const [schedDate, setSchedDate] = useState<string>('');

  const handleStartPriceEdit = (tank: FuelTank) => {
    setEditingTankPriceId(tank.id);
    setTempPriceVal(tank.pricePerLiter);
  };

  const handleSavePriceEdit = async (tankId: string) => {
    if (tempPriceVal <= 0) return;

    const updatedTanks = tanks.map(t => {
      if (t.id === tankId) {
        return { ...t, pricePerLiter: tempPriceVal };
      }
      return t;
    });

    setTanks(updatedTanks);
    setEditingTankPriceId(null);

    const targetTank = updatedTanks.find(t => t.id === tankId);
    if (targetTank) {
      try {
        const tableName = getTanksTableName();
        await supabase.from(tableName).update({ priceperliter: tempPriceVal }).eq('id', tankId);
      } catch (err) {
        console.warn("Supabase update price error:", err);
      }
      showToast(`Retail price for ${targetTank.name} updated to Rs. ${tempPriceVal.toFixed(2)}.`);
    }
  };

  const handleAddSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!schedDate || schedPrice <= 0) return;

    const newSchedule: PriceSchedule = {
      id: `sched-${Date.now()}`,
      fuelType: schedFuelType,
      newPrice: schedPrice,
      effectiveDate: schedDate,
      status: 'Pending'
    };

    if (setPriceSchedules) {
      setPriceSchedules(prev => [...prev, newSchedule]);
    }

    try {
      await supabase.from('price_schedules').insert([{
        id: newSchedule.id,
        fueltype: newSchedule.fuelType,
        newprice: newSchedule.newPrice,
        effectivedate: newSchedule.effectiveDate,
        status: newSchedule.status
      }]);
    } catch (err) {
      console.warn("Supabase price schedule insert warning:", err);
    }

    setSchedPrice(0);
    setSchedDate('');
    showToast(`Price schedule logged for ${newSchedule.fuelType} effective ${new Date(schedDate).toLocaleString()}.`);
  };

  const handleCancelSchedule = async (id: string) => {
    if (!window.confirm("Are you sure you want to cancel this pending price schedule?")) return;

    try {
      await supabase.from('price_schedules').delete().eq('id', id);
    } catch (err) {
      console.warn("Supabase schedule delete error:", err);
    }

    if (setPriceSchedules) {
      setPriceSchedules(prev => prev.filter(s => s.id !== id));
    }

    showToast("Pending price schedule cancelled.");
  };

  // -------------------------------------------------------------
  // D2) LP GAS TARIFF & CYLINDER PRICES MANAGEMENT
  // -------------------------------------------------------------
  const [gasPrices, setGasPrices] = useState<{ [key: string]: number }>(() => {
    try {
      const storedPrices = localStorage.getItem('fuel_flow_gas_prices');
      if (storedPrices) {
        return JSON.parse(storedPrices);
      }
      const storedInv = localStorage.getItem('fuel_flow_gas_stock') || localStorage.getItem('fuel_flow_gas_inventory');
      if (storedInv) {
        const parsed = JSON.parse(storedInv);
        if (Array.isArray(parsed)) {
          const pMap: { [key: string]: number } = {};
          parsed.forEach((item: any) => {
            if (item.size === '12.5 kg' || item.id === 'gas-12.5kg') pMap['12.5kg'] = item.selling_price || item.unit_price || 3690;
            if (item.size === '5.0 kg' || item.id === 'gas-5.0kg' || item.id === 'gas-5kg') pMap['5kg'] = item.selling_price || item.unit_price || 1482;
            if (item.size === '2.3 kg' || item.id === 'gas-2.3kg') pMap['2.3kg'] = item.selling_price || item.unit_price || 694;
          });
          return {
            '12.5kg': pMap['12.5kg'] || 3690,
            '5kg': pMap['5kg'] || 1482,
            '2.3kg': pMap['2.3kg'] || 694
          };
        }
      }
    } catch (_) {}
    return {
      '12.5kg': 3690,
      '5kg': 1482,
      '2.3kg': 694
    };
  });

  const [isUpdatingGasPrices, setIsUpdatingGasPrices] = useState(false);

  const handleUpdateGasPrices = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsUpdatingGasPrices(true);
    try {
      // 1. Save to LocalStorage key 'fuel_flow_gas_prices'
      localStorage.setItem('fuel_flow_gas_prices', JSON.stringify(gasPrices));

      // 2. Update existing gas inventory items in LocalStorage
      const gasKey = 'fuel_flow_gas_stock';
      const altGasKey = 'fuel_flow_gas_inventory';
      let currentGasList: any[] = [];
      try {
        const stored = localStorage.getItem(gasKey) || localStorage.getItem(altGasKey);
        if (stored) {
          currentGasList = JSON.parse(stored);
        }
      } catch (_) {}

      if (!Array.isArray(currentGasList) || currentGasList.length === 0) {
        currentGasList = [
          { id: 'gas-12.5kg', size: '12.5 kg', full_count: 0, empty_count: 0, selling_price: gasPrices['12.5kg'], last_updated: new Date().toISOString() },
          { id: 'gas-37.5kg', size: '37.5 kg', full_count: 0, empty_count: 0, selling_price: 11200, last_updated: new Date().toISOString() },
          { id: 'gas-5.0kg', size: '5.0 kg', full_count: 0, empty_count: 0, selling_price: gasPrices['5kg'], last_updated: new Date().toISOString() },
          { id: 'gas-2.3kg', size: '2.3 kg', full_count: 0, empty_count: 0, selling_price: gasPrices['2.3kg'], last_updated: new Date().toISOString() }
        ];
      } else {
        currentGasList = currentGasList.map(item => {
          if (item.size === '12.5 kg' || item.id === 'gas-12.5kg') {
            return { ...item, selling_price: gasPrices['12.5kg'], unit_price: gasPrices['12.5kg'], last_updated: new Date().toISOString() };
          }
          if (item.size === '5.0 kg' || item.id === 'gas-5.0kg' || item.id === 'gas-5kg') {
            return { ...item, selling_price: gasPrices['5kg'], unit_price: gasPrices['5kg'], last_updated: new Date().toISOString() };
          }
          if (item.size === '2.3 kg' || item.id === 'gas-2.3kg') {
            return { ...item, selling_price: gasPrices['2.3kg'], unit_price: gasPrices['2.3kg'], last_updated: new Date().toISOString() };
          }
          return item;
        });
      }

      localStorage.setItem(gasKey, JSON.stringify(currentGasList));
      localStorage.setItem(altGasKey, JSON.stringify(currentGasList));
      localStorage.setItem('fuelflow_lpgas_inventory', JSON.stringify(currentGasList));

      // 3. Dispatch global custom events so Shift Management & Inventory tab react immediately
      window.dispatchEvent(new CustomEvent('gas-prices-updated', {
        detail: { updatedPrices: gasPrices, updatedInventory: currentGasList }
      }));
      window.dispatchEvent(new CustomEvent('gas-inventory-updated', {
        detail: { updatedInventory: currentGasList }
      }));

      // 4. Update Supabase gas_inventory table
      try {
        const upsertPayload = [
          { id: 'gas-12.5kg', size: '12.5 kg', selling_price: gasPrices['12.5kg'], last_updated: new Date().toISOString() },
          { id: 'gas-5.0kg', size: '5.0 kg', selling_price: gasPrices['5kg'], last_updated: new Date().toISOString() },
          { id: 'gas-2.3kg', size: '2.3 kg', selling_price: gasPrices['2.3kg'], last_updated: new Date().toISOString() }
        ];
        await supabase.from('gas_inventory').upsert(upsertPayload);
      } catch (sbErr) {
        console.warn('Supabase gas_inventory price sync notice:', sbErr);
      }

      showToast('✓ LP Gas Cylinder Selling Prices Updated Successfully!');
    } catch (err) {
      console.error('Error updating gas prices:', err);
      showToast('Error updating LP gas prices');
    } finally {
      setIsUpdatingGasPrices(false);
    }
  };

  // -------------------------------------------------------------
  // E) SYSTEM DIAGNOSTICS & SETUP
  // -------------------------------------------------------------
  const [stationName, setStationName] = useState(() => localStorage.getItem('fuelflow_station_name') || 'FuelFlow Station - Colombo 07');
  const [stationLocation, setStationLocation] = useState(() => localStorage.getItem('fuelflow_station_location') || 'Albert Crescent, Colombo, Sri Lanka');
  const [copied, setCopied] = useState(false);
  const [checkingConnection, setCheckingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'success' | 'error' | 'missing_tables'>('idle');
  const [connectionMessage, setConnectionMessage] = useState('');

  const handleCopySQL = () => {
    navigator.clipboard.writeText(SUPABASE_SQL);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const checkSupabaseConnection = async () => {
    setCheckingConnection(true);
    setConnectionStatus('idle');
    setConnectionMessage('');
    try {
      const { error } = await supabase.from('employees').select('id').limit(1);
      if (error) {
        if (
          error.code === '42P01' || 
          error.message?.includes('relation') || 
          error.message?.includes('does not exist')
        ) {
          setConnectionStatus('missing_tables');
          setConnectionMessage('Connected to Supabase, but database tables do not exist yet. Run the SQL schema in Supabase SQL Editor.');
        } else {
          setConnectionStatus('error');
          setConnectionMessage(error.message || 'Error communicating with Supabase API.');
        }
      } else {
        setConnectionStatus('success');
        setConnectionMessage('Success! Connected to Supabase and database tables are verified.');
      }
    } catch (err: any) {
      setConnectionStatus('error');
      setConnectionMessage(err.message || 'Network error connecting to Supabase.');
    } finally {
      setCheckingConnection(false);
    }
  };

  const handleSaveStationInfo = (e: React.FormEvent) => {
    e.preventDefault();
    localStorage.setItem('fuelflow_station_name', stationName);
    localStorage.setItem('fuelflow_station_location', stationLocation);
    showToast('Station metadata saved.');
  };

  // Dynamic Sub-Page Headers
  const getSubPageHeader = () => {
    switch (adminSection) {
      case 'tanks':
        return {
          icon: Fuel,
          title: 'Underground Tanks',
          subtitle: `Underground fuel storage tanks & volumetric inventories (${tanks.length} Tanks Configured)`
        };
      case 'mapping':
        return {
          icon: Gauge,
          title: 'Dispenser Nozzles & Pumps',
          subtitle: `Dispenser pump machines, meters, and nozzle-to-tank routing (${pumps.length} Nozzles Mapped)`
        };
      case 'oils':
        return {
          icon: Droplets,
          title: 'Bulk Oil & Lubricant Storage',
          subtitle: `Forecourt dispenser chamber units and lubricant storage setup`
        };
      case 'employees':
        return {
          icon: Users,
          title: 'Staff Directory & Roles',
          subtitle: `Pump operators, shift supervisors, contact details, and access control (${employees.length} Staff)`
        };
      case 'price':
        return {
          icon: Tag,
          title: 'Fuel Tariff & Price Management',
          subtitle: 'Active retail rates per liter and scheduled price revisions'
        };
      case 'system':
      default:
        return {
          icon: ShieldCheck,
          title: 'Admin Control Panel',
          subtitle: 'Centralized station configuration, database diagnostics, and system setup'
        };
    }
  };

  const headerInfo = getSubPageHeader();
  const HeaderIcon = headerInfo.icon;

  return (
    <div id="admin-control-root" className="space-y-4 max-w-7xl mx-auto pb-12 animate-fade-in">
      {/* Page Header */}
      <div id="admin-header" className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-blue-600/10 text-blue-600 rounded-xl">
              <HeaderIcon className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 tracking-tight font-sans">
                {headerInfo.title}
              </h1>
              <p className="text-gray-500 text-xs mt-0.5">
                {headerInfo.subtitle}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Global Toast Banner */}
      {toastMessage && (
        <div className="p-4 bg-emerald-500/15 text-emerald-800 border border-emerald-500/20 rounded-2xl text-xs flex items-center justify-between gap-2.5 animate-fade-in shadow-sm">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            <span className="font-semibold text-emerald-900">{toastMessage}</span>
          </div>
          <button onClick={() => setToastMessage(null)} className="text-emerald-700 hover:text-emerald-900">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SECTION A: UNDERGROUND FUEL TANKS MANAGEMENT */}
      {/* ========================================================================= */}
      {adminSection === 'tanks' && (
        <UndergroundTanksTab
          tanks={tanks}
          setTanks={setTanks}
          pumps={pumps}
          setPumps={setPumps}
          showToast={showToast}
          formatCurrency={formatCurrency}
          user={user}
          userRole={userRole}
        />
      )}

      {/* ========================================================================= */}
      {/* SECTION: OIL (LUBRICANT) STORAGE TANKS MANAGEMENT */}
      {/* ========================================================================= */}
      {adminSection === 'oils' && (
        <LubricantStorageTab
          oilTanks={effectiveOilTanks}
          setOilTanks={setEffectiveOilTanks}
          showToast={showToast}
          formatCurrency={formatCurrency}
          user={user}
          userRole={userRole}
        />
      )}

      {/* ========================================================================= */}
      {/* SECTION B: STORAGE TANKS & FUEL NOZZLES DIRECT MAPPING */}
      {/* ========================================================================= */}
      {adminSection === 'mapping' && (
        <div className="space-y-6">
          {/* Tanks with Attached Nozzles List */}
          {tanks.length === 0 ? (
            <div className="bg-white p-12 text-center rounded-2xl border border-gray-100 space-y-4 shadow-sm">
              <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto">
                <Database className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-[#1C1C1C]">No Underground Storage Tanks Configured</h3>
                <p className="text-xs text-gray-500 max-w-sm mx-auto">
                  Create storage tanks first in the "Underground Storage Tanks" tab before attaching fuel nozzles.
                </p>
              </div>
              <button
                onClick={() => setAdminSection('tanks')}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-colors shadow-sm"
              >
                <Plus className="w-4 h-4" />
                <span>Go to Storage Tanks Tab</span>
              </button>
            </div>
          ) : (
            <div className="space-y-5">
              {sortedTanks.map((tank) => {
                const attachedNozzles = pumps.filter(p => p.tankId === tank.id || (!p.tankId && p.fuelType === tank.fuelType));

                const getFuelTypeBadgeStyle = (fuelType: string) => {
                  if (fuelType.includes('92')) return 'bg-amber-500/10 text-amber-700 border-amber-500/20';
                  if (fuelType.includes('95')) return 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20';
                  if (fuelType.includes('Super Diesel')) return 'bg-purple-500/10 text-purple-700 border-purple-500/20';
                  if (fuelType.includes('Auto Diesel')) return 'bg-blue-500/10 text-blue-700 border-blue-500/20';
                  if (fuelType.includes('Ordinary') || fuelType.includes('LAD')) return 'bg-teal-500/10 text-teal-700 border-teal-500/20';
                  return 'bg-slate-500/10 text-slate-700 border-slate-500/20';
                };

                return (
                  <div key={tank.id} className="bg-white rounded-xl border border-gray-200/80 shadow-sm overflow-hidden">
                    {/* Tank Header */}
                    <div className="p-4 bg-gray-50/80 border-b border-gray-200/80 flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center font-black text-sm shadow-sm flex-shrink-0">
                          <Database className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold border ${getFuelTypeBadgeStyle(tank.fuelType)}`}>
                              {tank.fuelType}
                            </span>
                            <h3 className="text-sm font-extrabold text-[#1C1C1C]">{tank.name}</h3>
                          </div>
                          <span className="text-xs font-medium text-gray-500 mt-0.5 block">
                            Capacity: <strong className="text-gray-700">{tank.capacity.toLocaleString()} L</strong> • Current Fill: <strong className="text-emerald-600">{tank.currentLevel.toLocaleString()} L</strong> • Direct Nozzles: <strong className="text-blue-600">{attachedNozzles.length}</strong>
                          </span>
                        </div>
                      </div>

                      <button
                        onClick={() => handleOpenAddNozzleModal(tank.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-colors shadow-xs flex-shrink-0 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add Fuel Pump</span>
                      </button>
                    </div>

                    {/* Attached Nozzles Grid */}
                    <div className="p-5">
                      {attachedNozzles.length === 0 ? (
                        <div className="py-4 px-6 text-center bg-gray-50/50 rounded-xl border border-dashed border-gray-200/80">
                          <p className="text-xs text-gray-400 font-medium">No pumps attached to this tank</p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          {attachedNozzles.map((nozzle) => {
                            return (
                              <div key={nozzle.id} className="p-4 bg-white border border-gray-200 rounded-xl space-y-3 hover:border-blue-300 transition-all shadow-xs">
                                <div className="flex items-start justify-between border-b border-gray-100 pb-2">
                                  <div>
                                    <h4 className="font-bold text-[#1C1C1C] text-xs">{nozzle.name}</h4>
                                    <span className="text-[10px] text-gray-400 ">{nozzle.id}</span>
                                  </div>

                                  <div className="flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        e.preventDefault();
                                        handleOpenEditNozzleModal(nozzle);
                                      }}
                                      className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors cursor-pointer z-30"
                                      title="Edit Pump"
                                    >
                                      <Edit2 className="w-3.5 h-3.5" />
                                    </button>
                                    {isAdmin(user?.role || userRole) && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          e.preventDefault();
                                          handleDeleteNozzle(nozzle.id);
                                        }}
                                        className="p-1 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors cursor-pointer z-30"
                                        title="Delete Pump"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                  </div>
                                </div>

                                <div className="grid grid-cols-2 gap-2 text-[11px]">
                                  <div className="bg-gray-50 p-2 rounded-lg">
                                    <span className="text-gray-400 text-[9px] uppercase font-bold block">Fuel Grade</span>
                                    <span className="font-extrabold text-blue-700">{nozzle.fuelType}</span>
                                  </div>

                                  <div className="bg-gray-50 p-2 rounded-lg">
                                    <span className="text-gray-400 text-[9px] uppercase font-bold block">Start Meter</span>
                                    <span className="font-bold text-[#1C1C1C] tabular-nums">
                                      {(nozzle.startMeter || 0).toLocaleString()} L
                                    </span>
                                  </div>
                                </div>

                                <div className="text-[10px] text-gray-500 bg-blue-50/50 p-2 rounded-lg border border-blue-100/50 flex items-center justify-between">
                                  <span>Bound Tank:</span>
                                  <strong className="text-blue-900 truncate max-w-[140px]">{tank.name}</strong>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* SECTION C: EMPLOYEE DIRECTORY */}
      {/* ========================================================================= */}
      {adminSection === 'employees' && (
        <div className="space-y-6">
          {/* Top Bar: Clean Standalone Search & Action Button (No Container Card) */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-2.5" />
              <input
                type="text"
                placeholder="Search staff by name, role, or phone..."
                value={empSearchQuery}
                onChange={(e) => setEmpSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-white border border-gray-200 text-[#1C1C1C] rounded-xl text-xs focus:outline-none focus:border-blue-500 shadow-2xs font-medium"
              />
            </div>

            <button
              onClick={handleOpenAddEmpModal}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-colors shadow-xs whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Register Staff Member</span>
            </button>
          </div>

          {/* Categorized Lists: Supervisors & Pumpers (Compact Table View) */}
          {(() => {
            const supervisors = filteredEmployees.filter(e => e.role === 'Supervisor');
            const pumpers = filteredEmployees.filter(e => e.role !== 'Supervisor');

            const renderEmpTable = (empList: Employee[], emptyText: string) => {
              if (empList.length === 0) {
                return (
                  <div className="p-4 bg-gray-50/80 rounded-xl text-center border border-dashed border-gray-200">
                    <p className="text-xs text-gray-400 font-medium">{emptyText}</p>
                  </div>
                );
              }

              return (
                <div className="bg-white rounded-2xl border border-gray-200/80 shadow-2xs overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[700px] text-left text-xs">
                      <thead>
                        <tr className="bg-gray-50/80 border-b border-gray-200/80 text-gray-500 font-bold uppercase tracking-wider text-[10px]">
                          <th className="py-3 px-4">Name</th>
                          <th className="py-3 px-4">Role</th>
                          <th className="py-3 px-4">Contact Number</th>
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4 text-right sticky right-0 bg-gray-50 z-10">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 font-medium">
                        {empList.map((emp) => (
                          <tr key={emp.id} className="hover:bg-blue-50/40 transition-colors group">
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-3">
                                <div className={`w-8 h-8 rounded-xl ${emp.avatarColor || 'bg-blue-500'} text-white flex items-center justify-center font-extrabold text-xs shadow-2xs flex-shrink-0`}>
                                  {emp.name.charAt(0)}
                                </div>
                                <span className="font-bold text-[#1C1C1C] text-xs">{emp.name}</span>
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                                emp.role === 'Supervisor' ? 'bg-purple-500/10 text-purple-700' : 'bg-blue-500/10 text-blue-700'
                              }`}>
                                {emp.role}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-gray-600 text-xs">
                              <div className="flex items-center gap-1.5">
                                <Phone className="w-3.5 h-3.5 text-gray-400" />
                                <span>{emp.phone}</span>
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  handleToggleEmpStatus(emp.id);
                                }}
                                className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold transition-colors cursor-pointer ${
                                  emp.status === 'Active' 
                                    ? 'bg-emerald-500/10 text-emerald-700 border border-emerald-500/20 hover:bg-emerald-500/20' 
                                    : 'bg-gray-100 text-gray-500 border border-gray-200 hover:bg-gray-200'
                                }`}
                              >
                                {emp.status}
                              </button>
                            </td>
                            <td className="py-3 px-4 text-right sticky right-0 bg-white group-hover:bg-blue-50/40 z-10 whitespace-nowrap shadow-[-4px_0_6px_-2px_rgba(0,0,0,0.03)]">
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    e.preventDefault();
                                    handleOpenEditEmpModal(emp);
                                  }}
                                  className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer z-30"
                                  title="Edit Staff Member"
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                                {isAdmin(user?.role || userRole) && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      e.preventDefault();
                                      handleDeleteEmployee(emp.id);
                                    }}
                                    className="p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer z-30"
                                    title="Remove Staff Member"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            };

            return (
              <div className="space-y-6">
                {/* 1. Shift Supervisors Section */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 pb-2 border-b border-gray-200/80">
                    <ShieldCheck className="w-4 h-4 text-purple-600" />
                    <h3 className="font-extrabold text-xs sm:text-sm text-[#1C1C1C] uppercase tracking-wider">Shift Supervisors</h3>
                    <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 text-[11px] font-extrabold">
                      {supervisors.length}
                    </span>
                  </div>

                  {renderEmpTable(supervisors, "No registered supervisor staff found matching criteria.")}
                </div>

                {/* 2. Pump Operators (Pumpers) Section */}
                <div className="space-y-3 pt-2">
                  <div className="flex items-center gap-2 pb-2 border-b border-gray-200/80">
                    <Users className="w-4 h-4 text-blue-600" />
                    <h3 className="font-extrabold text-xs sm:text-sm text-[#1C1C1C] uppercase tracking-wider">Pump Operators (Pumpers)</h3>
                    <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 text-[11px] font-extrabold">
                      {pumpers.length}
                    </span>
                  </div>

                  {renderEmpTable(pumpers, "No registered pump operator staff found matching criteria.")}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ========================================================================= */}
      {/* SECTION D: PRICE & TARIFF MANAGEMENT */}
      {/* ========================================================================= */}
      {adminSection === 'price' && (
        <div className="space-y-6">
          {/* Current Retail Prices Table */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50">
              <h3 className="font-bold text-[#1C1C1C] text-xs uppercase tracking-wider">Current Fuel Grade Retail Rates</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-gray-50/90 border-b border-gray-100 text-gray-500 font-bold text-xs uppercase tracking-wider">
                  <tr>
                    <th className="py-3.5 px-6">Product Grade</th>
                    <th className="py-3.5 px-6">Underground Storage Tank</th>
                    <th className="py-3.5 px-6 text-right">Selling Price (per Liter)</th>
                    <th className="py-3.5 px-6 text-center w-36">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 text-xs">
                  {sortedTanks.map((tank) => (
                    <tr key={tank.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="py-4 px-6">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold ${
                          tank.fuelType.includes('Petrol') ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'
                        }`}>
                          {tank.fuelType}
                        </span>
                      </td>
                      <td className="py-4 px-6 text-gray-700 font-semibold">
                        {tank.name}
                      </td>
                      <td className="py-4 px-6 text-right">
                        {editingTankPriceId === tank.id ? (
                          <div className="flex items-center justify-end gap-2">
                            <span className="text-xs font-bold text-gray-500">Rs.</span>
                            <input
                              type="number"
                              step="0.01"
                              value={tempPriceVal}
                              onFocus={(e) => e.target.select()}
                              onChange={(e) => setTempPriceVal(parseFloat(e.target.value) || 0)}
                              className="w-28 px-3 py-1.5 border border-blue-500 bg-white text-[#1C1C1C] rounded-lg tabular-nums font-bold text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-right"
                              autoFocus
                            />
                          </div>
                        ) : (
                          <span className="tabular-nums font-extrabold text-base text-blue-600">
                            {formatCurrency(tank.pricePerLiter)}
                          </span>
                        )}
                      </td>
                      <td className="py-4 px-6 text-center">
                        {editingTankPriceId === tank.id ? (
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => setEditingTankPriceId(null)}
                              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                              title="Cancel"
                            >
                              <X className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleSavePriceEdit(tank.id)}
                              className="p-1.5 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors"
                              title="Save Rate"
                            >
                              <Save className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => handleStartPriceEdit(tank)}
                            className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-gray-50 hover:bg-blue-50 text-gray-600 hover:text-blue-600 border border-gray-200 hover:border-blue-200 rounded-lg transition-colors font-bold text-xs"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                            <span>Edit Rate</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* LP GAS TARIFF & CYLINDER PRICES (CLEAN LIST VIEW) */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-orange-100 text-orange-600 rounded-lg">
                  <Flame className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-[#1C1C1C] text-xs uppercase tracking-wider">LP Gas Tariff &amp; Cylinder Prices</h3>
                  <p className="text-[11px] text-gray-500 font-medium">Counter retail selling prices for Litro LP gas cylinders</p>
                </div>
              </div>
              <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-200 uppercase tracking-wider">
                Retail Rates
              </span>
            </div>

            <form onSubmit={handleUpdateGasPrices}>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-gray-50/90 border-b border-gray-100 text-gray-500 font-bold text-xs uppercase tracking-wider">
                    <tr>
                      <th className="py-3 px-6">Cylinder Type</th>
                      <th className="py-3 px-6">Classification</th>
                      <th className="py-3 px-6 text-right w-64">Selling Price (Rs.)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 text-xs">
                    {/* 12.5 kg */}
                    <tr className="hover:bg-gray-50/50 transition-colors">
                      <td className="py-3.5 px-6 font-bold text-gray-900">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-orange-500"></span>
                          <span>12.5 kg Cylinder</span>
                        </div>
                      </td>
                      <td className="py-3.5 px-6">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-orange-50 text-orange-800 border border-orange-200">
                          Standard Household
                        </span>
                      </td>
                      <td className="py-3.5 px-6 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <span className="text-xs font-bold text-gray-400">Rs.</span>
                          <input
                            type="number"
                            step="1"
                            min="0"
                            required
                            value={gasPrices['12.5kg'] || ''}
                            onFocus={(e) => e.target.select()}
                            onChange={(e) => setGasPrices(prev => ({ ...prev, '12.5kg': parseFloat(e.target.value) || 0 }))}
                            className="w-32 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 tabular-nums font-bold text-xs text-right focus:bg-white focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                          />
                        </div>
                      </td>
                    </tr>

                    {/* 5.0 kg */}
                    <tr className="hover:bg-gray-50/50 transition-colors">
                      <td className="py-3.5 px-6 font-bold text-gray-900">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                          <span>5.0 kg Cylinder</span>
                        </div>
                      </td>
                      <td className="py-3.5 px-6">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                          Buddy Cylinder
                        </span>
                      </td>
                      <td className="py-3.5 px-6 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <span className="text-xs font-bold text-gray-400">Rs.</span>
                          <input
                            type="number"
                            step="1"
                            min="0"
                            required
                            value={gasPrices['5kg'] || ''}
                            onFocus={(e) => e.target.select()}
                            onChange={(e) => setGasPrices(prev => ({ ...prev, '5kg': parseFloat(e.target.value) || 0 }))}
                            className="w-32 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 tabular-nums font-bold text-xs text-right focus:bg-white focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                          />
                        </div>
                      </td>
                    </tr>

                    {/* 2.3 kg */}
                    <tr className="hover:bg-gray-50/50 transition-colors">
                      <td className="py-3.5 px-6 font-bold text-gray-900">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-yellow-500"></span>
                          <span>2.3 kg Cylinder</span>
                        </div>
                      </td>
                      <td className="py-3.5 px-6">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-yellow-50 text-yellow-800 border border-yellow-200">
                          Portable Small
                        </span>
                      </td>
                      <td className="py-3.5 px-6 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <span className="text-xs font-bold text-gray-400">Rs.</span>
                          <input
                            type="number"
                            step="1"
                            min="0"
                            required
                            value={gasPrices['2.3kg'] || ''}
                            onFocus={(e) => e.target.select()}
                            onChange={(e) => setGasPrices(prev => ({ ...prev, '2.3kg': parseFloat(e.target.value) || 0 }))}
                            className="w-32 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 tabular-nums font-bold text-xs text-right focus:bg-white focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                          />
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Bottom Compact Action Row */}
              <div className="px-6 py-3.5 bg-gray-50/60 border-t border-gray-100 flex items-center justify-between">
                <span className="text-[11px] text-gray-500">
                  Changes sync immediately with Shift Counter Sales &amp; LP Gas Inventory.
                </span>
                <button
                  type="submit"
                  disabled={isUpdatingGasPrices}
                  className="px-4 py-2 bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-700 hover:to-amber-700 text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center gap-2 cursor-pointer"
                >
                  {isUpdatingGasPrices ? (
                    <>
                      <RefreshCcw className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-3.5 h-3.5" />
                      <span>Update Gas Prices</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>

          {/* Schedule Future Price Change Section */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-gray-500" />
              <h3 className="font-bold text-[#1C1C1C] text-xs uppercase tracking-wider">Schedule Future Price Tariff</h3>
            </div>
            <div className="p-6">
              <form onSubmit={handleAddSchedule} className="flex flex-col md:flex-row gap-4 items-end text-xs">
                <div className="flex-1 w-full">
                  <label className="font-bold text-gray-500 uppercase tracking-wider block mb-1.5">Fuel Grade</label>
                  <select
                    value={schedFuelType}
                    onChange={(e) => setSchedFuelType(e.target.value as FuelType)}
                    className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-[#1C1C1C] font-semibold focus:outline-none focus:border-blue-500"
                  >
                    {Array.from(new Set(tanks.map(t => t.fuelType))).map(ft => (
                      <option key={ft} value={ft}>{ft}</option>
                    ))}
                  </select>
                </div>

                <div className="flex-1 w-full">
                  <label className="font-bold text-gray-500 uppercase tracking-wider block mb-1.5">New Retail Price (per Liter)</label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-2.5 text-xs font-bold text-gray-500">Rs.</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      required
                      placeholder="350.00"
                      value={schedPrice || ''}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => setSchedPrice(parseFloat(e.target.value) || 0)}
                      className="w-full pl-10 pr-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-[#1C1C1C] tabular-nums font-bold focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                <div className="flex-1 w-full">
                  <label className="font-bold text-gray-500 uppercase tracking-wider block mb-1.5">Effective Date & Time</label>
                  <input
                    type="datetime-local"
                    required
                    value={schedDate}
                    onChange={(e) => setSchedDate(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-[#1C1C1C] font-semibold focus:outline-none focus:border-blue-500"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full md:w-auto px-6 py-2.5 bg-[#1C1C1C] text-white font-bold rounded-xl hover:bg-gray-800 transition-all shadow-sm whitespace-nowrap cursor-pointer"
                >
                  Schedule Price Change
                </button>
              </form>
            </div>
          </div>

          {/* Pending Price Schedules */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50 flex items-center gap-2">
              <Clock className="w-4 h-4 text-gray-500" />
              <h3 className="font-bold text-[#1C1C1C] text-xs uppercase tracking-wider">Pending Price Schedules</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-gray-50/90 border-b border-gray-100 text-gray-500 font-bold text-xs uppercase tracking-wider">
                  <tr>
                    <th className="py-3.5 px-6">Product</th>
                    <th className="py-3.5 px-6 text-right">Scheduled Price</th>
                    <th className="py-3.5 px-6">Effective Time</th>
                    <th className="py-3.5 px-6">Status</th>
                    <th className="py-3.5 px-6 text-center w-32">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 text-xs">
                  {priceSchedules.length > 0 ? (
                    priceSchedules.map((sched) => (
                      <tr key={sched.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="py-4 px-6">
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold ${
                            sched.fuelType.includes('Petrol') ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'
                          }`}>
                            {sched.fuelType}
                          </span>
                        </td>
                        <td className="py-4 px-6 text-right">
                          <span className="tabular-nums font-extrabold text-[#1C1C1C]">
                            {formatCurrency(sched.newPrice)}
                          </span>
                        </td>
                        <td className="py-4 px-6 text-gray-600 font-semibold">
                          {new Date(sched.effectiveDate).toLocaleString()}
                        </td>
                        <td className="py-4 px-6">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                            sched.status === 'Pending' ? 'bg-amber-100 text-amber-800 border border-amber-200' :
                            sched.status === 'Applied' ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' :
                            'bg-gray-100 text-gray-700'
                          }`}>
                            {sched.status}
                          </span>
                        </td>
                        <td className="py-4 px-6 text-center">
                          {sched.status === 'Pending' && isAdmin(user?.role || userRole) && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                handleCancelSchedule(sched.id);
                              }}
                              className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg transition-colors font-bold text-xs flex items-center justify-center gap-1.5 w-full cursor-pointer z-30"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Cancel</span>
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="py-10 text-center text-gray-400 font-medium">
                        No pending price schedules found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SECTION E: SYSTEM & DATABASE DIAGNOSTICS */}
      {/* ========================================================================= */}
      {adminSection === 'system' && (
        <div className="space-y-6 max-w-4xl">
          {/* Station Identity Metadata Form */}
          <form onSubmit={handleSaveStationInfo} className="bg-white p-6 rounded-2xl border border-gray-100 space-y-4 shadow-sm">
            <h3 className="font-bold text-[#1C1C1C] text-base flex items-center gap-2">
              <Landmark className="w-5 h-5 text-blue-600" />
              <span>Station Identity Metadata</span>
            </h3>
            <p className="text-xs text-gray-500">Configure global station details displayed on reports and receipts</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div>
                <label className="text-xs font-bold text-gray-500 block mb-1">Station Name</label>
                <input
                  type="text"
                  value={stationName}
                  onChange={(e) => setStationName(e.target.value)}
                  className="w-full px-3.5 py-2 bg-gray-50 border border-gray-200 text-[#1C1C1C] rounded-xl text-xs font-semibold focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-gray-500 block mb-1">Station Location</label>
                <input
                  type="text"
                  value={stationLocation}
                  onChange={(e) => setStationLocation(e.target.value)}
                  className="w-full px-3.5 py-2 bg-gray-50 border border-gray-200 text-[#1C1C1C] rounded-xl text-xs font-semibold focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <button
              type="submit"
              className="px-4 py-2 bg-[#1C1C1C] text-white rounded-xl text-xs font-bold hover:bg-gray-800 transition-colors"
            >
              Save Station Info
            </button>
          </form>

          {/* Supabase Diagnostic Panel */}
          <div className="bg-white p-6 rounded-2xl border border-gray-100 space-y-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Database className="w-5 h-5 text-blue-600" />
                <h3 className="font-bold text-[#1C1C1C] text-base">Database Verification & SQL Schema</h3>
              </div>
              <button
                type="button"
                onClick={checkSupabaseConnection}
                disabled={checkingConnection}
                className="px-3.5 py-2 bg-blue-50 text-blue-600 border border-blue-200 rounded-xl text-xs font-bold hover:bg-blue-100 transition-colors flex items-center gap-2"
              >
                <RefreshCcw className={`w-3.5 h-3.5 ${checkingConnection ? 'animate-spin' : ''}`} />
                <span>Test Supabase Connection</span>
              </button>
            </div>

            {connectionStatus !== 'idle' && (
              <div className={`p-4 rounded-xl text-xs flex items-start gap-2.5 ${
                connectionStatus === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' :
                connectionStatus === 'missing_tables' ? 'bg-amber-50 text-amber-800 border border-amber-200' :
                'bg-rose-50 text-rose-800 border border-rose-200'
              }`}>
                <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{connectionMessage}</span>
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-gray-500">Copy initialization SQL script for Supabase SQL Editor:</span>
              <button
                type="button"
                onClick={handleCopySQL}
                className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-[#1C1C1C] rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied SQL' : 'Copy SQL Schema'}</span>
              </button>
            </div>

            {/* Quick Fix snippet box for missing tankid column */}
            <div className="bg-blue-50/70 border border-blue-200/80 p-3.5 rounded-xl text-xs space-y-2 mt-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-blue-900">Schema Update Quick Fix (If seeing 'tankid' column error):</span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText("ALTER TABLE pumps ADD COLUMN IF NOT EXISTS tankid TEXT;");
                    showToast("Copied ALTER TABLE SQL to clipboard!");
                  }}
                  className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-[11px] transition-colors flex items-center gap-1 flex-shrink-0"
                >
                  <Copy className="w-3 h-3" />
                  <span>Copy SQL</span>
                </button>
              </div>
              <code className="block bg-white p-2 rounded border border-blue-200 text-blue-950 text-[11px] overflow-x-auto select-all">
                ALTER TABLE pumps ADD COLUMN IF NOT EXISTS tankid TEXT;
              </code>
            </div>
          </div>

          {/* Reset System Data */}
          <div className="bg-rose-50/50 border border-rose-200/60 p-6 rounded-2xl space-y-3">
            <div className="flex items-center gap-2 text-rose-700">
              <AlertTriangle className="w-5 h-5" />
              <h3 className="font-extrabold text-sm">Emergency System Reset</h3>
            </div>
            <p className="text-xs text-rose-600">
              Clear custom station logs, pump readings, and restore initial demo tank levels and staff records.
            </p>
            {isAdmin(user?.role || userRole) && (
              <button
                onClick={() => {
                  if (confirm("Reset all station logs and data back to initial defaults?")) {
                    onResetAllData();
                    window.location.reload();
                  }
                }}
                className="px-4 py-2 bg-rose-600 text-white rounded-xl text-xs font-bold hover:bg-rose-700 transition-colors shadow-sm cursor-pointer"
              >
                Reset All Station Data
              </button>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: ADD / EDIT UNDERGROUND STORAGE TANK */}
      {/* ========================================================================= */}
      {isAddTankModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full space-y-5 shadow-2xl animate-scale-up">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <h3 className="text-base font-extrabold text-[#1C1C1C] flex items-center gap-2">
                <Database className="w-5 h-5 text-blue-600" />
                <span>{editingTank ? 'Edit Underground Storage Tank' : 'Add Underground Storage Tank'}</span>
              </h3>
              <button 
                onClick={() => setIsAddTankModalOpen(false)}
                className="p-1 text-gray-400 hover:text-gray-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {tankModalError && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl font-medium flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>{tankModalError}</span>
              </div>
            )}

            <div className="space-y-4 text-xs">
              <div>
                <label className="font-bold text-gray-600 block mb-1">Tank Name / Identifier</label>
                <input
                  type="text"
                  placeholder="e.g. Tank 01 - Petrol 92"
                  value={tankFormName}
                  onChange={(e) => setTankFormName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-[#1C1C1C] focus:outline-none focus:border-blue-500 font-medium"
                />
              </div>

              <div>
                <label className="font-bold text-gray-600 block mb-1">Fuel Grade Type</label>
                <select
                  value={tankFormFuelType}
                  onChange={(e) => setTankFormFuelType(e.target.value as FuelType)}
                  className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-[#1C1C1C] focus:outline-none focus:border-blue-500 font-semibold"
                >
                  <option value="Petrol 92">Petrol 92</option>
                  <option value="Petrol 95">Petrol 95</option>
                  <option value="Auto Diesel">Auto Diesel</option>
                  <option value="Super Diesel">Super Diesel</option>
                  <option value="Lanka Ordinary Diesel">Lanka Ordinary Diesel</option>
                </select>
              </div>

              <div>
                <label className="font-bold text-gray-600 block mb-1">Max Capacity (L)</label>
                <input
                  type="number"
                  value={tankFormCapacity}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setTankFormCapacity(Number(e.target.value))}
                  className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-[#1C1C1C] focus:outline-none focus:border-blue-500 tabular-nums font-bold"
                />
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setIsAddTankModalOpen(false)}
                className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-bold transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveTankSubmit}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-colors shadow-sm"
              >
                {editingTank ? 'Update Tank' : 'Save Tank'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: ADD / EDIT NOZZLE */}
      {/* ========================================================================= */}
      {isAddNozzleModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full space-y-5 shadow-2xl animate-scale-up">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <h3 className="text-base font-extrabold text-[#1C1C1C] flex items-center gap-2">
                <Gauge className="w-5 h-5 text-blue-600" />
                <span>{editingNozzle ? 'Edit Fuel Nozzle' : 'Configure New Fuel Nozzle'}</span>
              </h3>
              <button 
                onClick={() => setIsAddNozzleModalOpen(false)}
                className="p-1 text-gray-400 hover:text-gray-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {nozzleModalError && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl font-medium flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>{nozzleModalError}</span>
              </div>
            )}

            <div className="space-y-4 text-xs">
              <div>
                <label className="font-bold text-gray-600 block mb-1">Target Underground Storage Tank</label>
                <select
                  value={nozzleFormTankId}
                  onChange={(e) => {
                    const selId = e.target.value;
                    setNozzleFormTankId(selId);
                    const selected = tanks.find(t => t.id === selId);
                    if (selected) setNozzleFormFuelType(selected.fuelType);
                  }}
                  className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-[#1C1C1C] focus:outline-none focus:border-blue-500 font-semibold"
                >
                  {tanks.length === 0 ? (
                    <option value="">-- No Storage Tanks Configured --</option>
                  ) : (
                    <>
                      <option value="">-- Select Source Tank --</option>
                      {sortedTanks.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({t.fuelType}) - {t.capacity.toLocaleString()} L Capacity
                        </option>
                      ))}
                    </>
                  )}
                </select>
              </div>

              <div>
                <label className="font-bold text-gray-600 block mb-1">Pump</label>
                <input
                  type="text"
                  placeholder="Pump 01 - Petrol 92"
                  value={nozzleFormName}
                  onChange={(e) => setNozzleFormName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-[#1C1C1C] focus:outline-none focus:border-blue-500 font-medium"
                />
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setIsAddNozzleModalOpen(false)}
                className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-bold transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveNozzleSubmit}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-colors shadow-sm"
              >
                {editingNozzle ? 'Update Nozzle' : 'Save Nozzle'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: ADD / EDIT STAFF MEMBER */}
      {/* ========================================================================= */}
      {isAddEmpModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full space-y-5 shadow-2xl animate-scale-up">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <h3 className="text-base font-extrabold text-[#1C1C1C] flex items-center gap-2">
                <Users className="w-5 h-5 text-blue-600" />
                <span>{editingEmp ? 'Edit Staff Member' : 'Register Staff Member'}</span>
              </h3>
              <button 
                onClick={() => setIsAddEmpModalOpen(false)}
                className="p-1 text-gray-400 hover:text-gray-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {empModalError && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl font-medium flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>{empModalError}</span>
              </div>
            )}

            <div className="space-y-4 text-xs">
              <div>
                <label className="font-bold text-gray-600 block mb-1">Full Name</label>
                <input
                  type="text"
                  placeholder="e.g. Kasun Kalhara"
                  value={empFormName}
                  onChange={(e) => setEmpFormName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-[#1C1C1C] focus:outline-none focus:border-blue-500 font-medium"
                />
              </div>

              <div>
                <label className="font-bold text-gray-600 block mb-1">Designation Role</label>
                <select
                  value={empFormRole}
                  onChange={(e) => setEmpFormRole(e.target.value as 'Supervisor' | 'Pumper')}
                  className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-[#1C1C1C] focus:outline-none focus:border-blue-500 font-semibold"
                >
                  <option value="Pumper">Pump Operator (Pumper)</option>
                  <option value="Supervisor">Shift Supervisor</option>
                </select>
              </div>

              <div>
                <label className="font-bold text-gray-600 block mb-1">Contact Phone Number</label>
                <input
                  type="text"
                  placeholder="e.g. 0771234567"
                  value={empFormPhone}
                  onChange={(e) => setEmpFormPhone(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-[#1C1C1C] focus:outline-none focus:border-blue-500 "
                />
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setIsAddEmpModalOpen(false)}
                className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-bold transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEmpSubmit}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-colors shadow-sm"
              >
                {editingEmp ? 'Update Staff' : 'Register Staff'}
              </button>
            </div>
          </div>
        </div>
      )}


    </div>
  );
}
