/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { 
  Truck, ShoppingBag, Droplets, Fuel, Package, FileText, 
  Calendar, Search, Filter, Plus, Trash2, AlertTriangle, 
  CheckCircle2, Download, X, ArrowDownRight, Layers,
  Database, RefreshCw, ChevronRight, Info, Building2, Tag, DollarSign,
  Printer, Eye, Flame, GitBranch, Check, Droplet, Sparkles, ArrowLeft
} from 'lucide-react';
import { FuelTank, OilTank, StockDelivery, FuelType, Employee, PackagedOilItem, OilGRNRecord, ReceiptDesignerConfig, DEFAULT_RECEIPT_CONFIG, AuthUser, LPGasItem } from '../types';
import { supabase, getTanksTableName } from '../lib/supabase';
import { saveOilTank } from '../lib/supabaseClient';
import { isAdmin } from '../lib/auth';
import { 
  fetchPackagedLubricants, 
  fetchBulkLubricants, 
  fetchLubricantGRNReceipts, 
  saveLubricantGRN, 
  incrementPackagedStock, 
  incrementBulkStock 
} from '../lib/lubricantsClient';

export interface UnifiedPurchaseEntry {
  id: string;
  date: string;
  category: 'Fuel Bowser' | 'Packaged Lubricant' | 'Bulk Oil';
  supplier: string;
  invoiceNo: string;
  description: string;
  destination: string;
  quantity: number;
  unitLabel: string;
  unitPrice: number;
  totalAmount: number;
  receivedBy?: string;
  rawType: 'fuel' | 'lube_grn';
}

interface PurchasesTabProps {
  tanks: FuelTank[];
  setTanks: React.Dispatch<React.SetStateAction<FuelTank[]>>;
  oilTanks: OilTank[];
  setOilTanks: React.Dispatch<React.SetStateAction<OilTank[]>>;
  deliveries: StockDelivery[];
  setDeliveries: React.Dispatch<React.SetStateAction<StockDelivery[]>>;
  gasStock?: LPGasItem[];
  onUpdateGasStock?: (items: LPGasItem[]) => void;
  employees?: Employee[];
  user?: AuthUser | null;
  userRole?: string;
}

export default function PurchasesTab({
  tanks,
  setTanks,
  oilTanks,
  setOilTanks,
  deliveries,
  setDeliveries,
  gasStock,
  onUpdateGasStock,
  employees = [],
  user,
  userRole
}: PurchasesTabProps) {
  // Sub-tabs: 'fuel-bowser' | 'lubricants' | 'lp-gas'
  const [activeSubTab, setActiveSubTab] = useState<'fuel-bowser' | 'lubricants' | 'lp-gas'>('fuel-bowser');

  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Selected Purchase for Receipt Modal
  const [selectedReceiptPurchase, setSelectedReceiptPurchase] = useState<UnifiedPurchaseEntry | null>(null);
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false);
  const receiptPrintRef = useRef<HTMLDivElement>(null);

  // Load Receipt Designer Configuration from LocalStorage
  const [receiptConfig, setReceiptConfig] = useState<ReceiptDesignerConfig>(() => {
    try {
      const saved = localStorage.getItem('fms_receipt_designer_config');
      if (saved) {
        return { ...DEFAULT_RECEIPT_CONFIG, ...JSON.parse(saved) };
      }
    } catch {
      // Fallback
    }
    return DEFAULT_RECEIPT_CONFIG;
  });

  // Re-sync receipt configuration whenever modal opens or storage updates
  useEffect(() => {
    const loadConfig = () => {
      try {
        const saved = localStorage.getItem('fms_receipt_designer_config');
        if (saved) {
          setReceiptConfig({ ...DEFAULT_RECEIPT_CONFIG, ...JSON.parse(saved) });
        }
      } catch {
        // Fallback
      }
    };

    loadConfig();
    window.addEventListener('storage', loadConfig);
    return () => window.removeEventListener('storage', loadConfig);
  }, []);

  const handlePrintReceipt = () => {
    window.print();
  };

  const openReceiptModal = (entry: UnifiedPurchaseEntry) => {
    try {
      const saved = localStorage.getItem('fms_receipt_designer_config');
      if (saved) {
        setReceiptConfig({ ...DEFAULT_RECEIPT_CONFIG, ...JSON.parse(saved) });
      }
    } catch {
      // Fallback
    }
    setSelectedReceiptPurchase(entry);
    setIsReceiptModalOpen(true);
  };

  // Currency & Volume formatters (Sri Lankan Rupees)
  const formatCurrency = (val: number) => {
    return `Rs. ${(val || 0).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatLiters = (val: number) => {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(val) + ' L';
  };

  const [lpGasDeliveries, setLPGasDeliveries] = useState<any[]>([]);
  const [isLPGasModalOpen, setIsLPGasModalOpen] = useState(false);
  const [lpGasForm, setLPGasForm] = useState({
    size: '12.5 kg',
    fullQuantity: '',
    unitPrice: '',
    supplier: 'Litro Gas Lanka',
    invoiceNo: '',
    date: new Date().toISOString().split('T')[0]
  });
  const [lpGasModalError, setLPGasModalError] = useState<string | null>(null);

  const fetchLPGasDeliveries = async () => {
    try {
      const { data, error } = await supabase
        .from('lp_gas_purchases')
        .select('*')
        .order('date', { ascending: false });
      if (error && error.code !== 'PGRST205') {
        console.error('Error fetching LP Gas purchases:', error);
      }
      if (data) {
        setLPGasDeliveries(data);
      }
    } catch (err: any) {
      if (err?.code !== 'PGRST205') console.error('Error fetching LP Gas purchases:', err);
    }
  };

  useEffect(() => {
    fetchLPGasDeliveries();
  }, []);

  const handleSaveLPGasPurchase = async () => {
    if (!lpGasForm.fullQuantity || !lpGasForm.unitPrice || !lpGasForm.invoiceNo) {
      setLPGasModalError('Please fill all required fields');
      return;
    }

    const fullQty = Number(lpGasForm.fullQuantity) || 0;
    const unitPrice = Number(lpGasForm.unitPrice) || 0;
    const totalCost = fullQty * unitPrice;
    
    const getGasItemId = (sizeStr: string): string => {
      const norm = sizeStr.toLowerCase().replace(/[^0-9.]/g, '');
      if (norm === '12.5') return 'gas-12.5kg';
      if (norm === '37.5') return 'gas-37.5kg';
      if (norm === '5' || norm === '5.0') return 'gas-5.0kg';
      if (norm === '2.3') return 'gas-2.3kg';
      return `gas-${norm}kg`;
    };

    const targetId = getGasItemId(lpGasForm.size);

    const purchaseEntry = {
      id: crypto.randomUUID ? crypto.randomUUID() : `lpg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      date: lpGasForm.date || new Date().toISOString().split('T')[0],
      size: lpGasForm.size,
      full_quantity: fullQty,
      empty_returned: 0,
      unit_price: unitPrice,
      total_cost: totalCost,
      supplier: lpGasForm.supplier,
      invoice_no: lpGasForm.invoiceNo,
    };

    // 1. Instantly update the local UI purchase logs table
    setLPGasDeliveries(prev => [purchaseEntry, ...prev]);
    setIsLPGasModalOpen(false);
    showToast('LP Gas Delivery added successfully');

    setLPGasForm({
      size: '12.5 kg',
      fullQuantity: '',
      unitPrice: '',
      supplier: 'Litro Gas Lanka',
      invoiceNo: '',
      date: new Date().toISOString().split('T')[0]
    });
    setLPGasModalError(null);

    // 2. Direct LocalStorage Sync & Event Dispatch (ONLY update full_count, leave empty_count intact)
    let updatedFull = fullQty;
    try {
      const rawStored = localStorage.getItem('fuel_flow_gas_stock') || localStorage.getItem('fuel_flow_gas_inventory');
      let localData: any[] = rawStored ? JSON.parse(rawStored) : [];
      
      const defaultSizes: { id: string; size: '12.5 kg' | '37.5 kg' | '5.0 kg' | '2.3 kg' }[] = [
        { id: 'gas-12.5kg', size: '12.5 kg' },
        { id: 'gas-37.5kg', size: '37.5 kg' },
        { id: 'gas-5.0kg', size: '5.0 kg' },
        { id: 'gas-2.3kg', size: '2.3 kg' }
      ];

      if (!Array.isArray(localData) || localData.length === 0) {
        localData = defaultSizes.map(s => ({
          id: s.id,
          size: s.size,
          full_count: 0,
          empty_count: 0,
          last_updated: new Date().toISOString()
        }));
      }

      let found = false;
      localData = localData.map((item: any) => {
        if (item.id === targetId || item.size === lpGasForm.size || getGasItemId(item.size || '') === targetId) {
          found = true;
          updatedFull = (Number(item.full_count) || 0) + fullQty;
          return {
            ...item,
            id: targetId,
            size: lpGasForm.size,
            full_count: updatedFull,
            empty_count: Number(item.empty_count) || 0,
            last_updated: new Date().toISOString()
          };
        }
        return item;
      });

      if (!found) {
        updatedFull = fullQty;
        localData.push({
          id: targetId,
          size: lpGasForm.size,
          full_count: updatedFull,
          empty_count: 0,
          last_updated: new Date().toISOString()
        });
      }

      localStorage.setItem('fuel_flow_gas_stock', JSON.stringify(localData));
      localStorage.setItem('fuel_flow_gas_inventory', JSON.stringify(localData));
      
      if (onUpdateGasStock) {
        onUpdateGasStock(localData);
      }

      // Dispatch update event for instant UI re-render across all tabs
      window.dispatchEvent(new CustomEvent('gas-inventory-updated', { 
        detail: { updatedInventory: localData } 
      }));
    } catch (e) {
      console.error('LocalStorage sync failed', e);
    }

    // 3. Perform DB operations safely in the background
    try {
      const { error: purchaseError } = await supabase
        .from('lp_gas_purchases')
        .insert([purchaseEntry]);
        
      if (purchaseError && purchaseError.code !== 'PGRST205') {
        console.error('Error saving LP Gas purchase:', purchaseError);
      }

      const { data: invData } = await supabase
        .from('gas_inventory')
        .select('*')
        .eq('id', targetId)
        .maybeSingle();
        
      const currentFull = invData ? (Number(invData.full_count) || 0) : (updatedFull - fullQty);
      const currentEmpty = invData ? (Number(invData.empty_count) || 0) : 0;
      const finalUpdatedFull = currentFull + fullQty;
      
      await supabase
        .from('gas_inventory')
        .upsert({
          id: targetId,
          size: lpGasForm.size,
          full_count: finalUpdatedFull,
          empty_count: currentEmpty,
          last_updated: new Date().toISOString()
        });

    } catch (err: any) {
      if (err?.code !== 'PGRST205') console.error('Error in save LP Gas:', err);
    }
  };

  // -------------------------------------------------------------
  // 1. FUEL PURCHASE STATE (DIRECT TANK CARD ALLOCATIONS)
  // -------------------------------------------------------------
  const [isFuelModalOpen, setIsFuelModalOpen] = useState(false);
  const [deliveryQty, setDeliveryQty] = useState<number | ''>('');
  const [deliveryFuelType, setDeliveryFuelType] = useState<FuelType>('Petrol 92');
  const [tankAllocations, setTankAllocations] = useState<Record<string, number | ''>>({});
  const [deliverySupplier, setDeliverySupplier] = useState('Ceylon Petroleum Corporation');
  const [deliveryInvoiceNo, setDeliveryInvoiceNo] = useState<string>('');
  const [deliveryDate, setDeliveryDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [fuelModalError, setFuelModalError] = useState<string | null>(null);

  // Sorted tanks
  const sortedTanks = useMemo(() => {
    return [...tanks].sort((a, b) => (a.name || a.id || '').localeCompare(b.name || b.id || '', undefined, { numeric: true, sensitivity: 'base' }));
  }, [tanks]);

  // Standard fuel products sequence (Ceylon Petroleum Corporation)
  const ALL_FUEL_PRODUCTS: FuelType[] = ['Petrol 92', 'Petrol 95', 'Auto Diesel', 'Super Diesel', 'Lanka Ordinary Diesel'];

  // Dynamic Fuel Product Filtering: ONLY products that have at least 1 active storage tank in the station
  const availableFuelProducts = useMemo(() => {
    // 1. Standard fuel products that actually exist in the station's tanks
    const matchedStandard = ALL_FUEL_PRODUCTS.filter(product =>
      tanks.some(tank => tank.fuelType === product)
    );

    // 2. Any additional custom fuel types present in tanks (excluding lubricants)
    const customTypes = Array.from(new Set(
      tanks
        .map(t => t.fuelType)
        .filter(ft => ft && ft !== 'Oil & Lubricants' && !ALL_FUEL_PRODUCTS.includes(ft))
    )) as FuelType[];

    return [...matchedStandard, ...customTypes];
  }, [tanks]);

  // Backward-compatible alias for available fuel types
  const fuelTypeOptions = availableFuelProducts;

  // Auto-Select First Available Product if current selected product has no matching tanks
  useEffect(() => {
    if (availableFuelProducts.length > 0) {
      const currentHasTanks = tanks.some(t => t.fuelType === deliveryFuelType);
      if (!currentHasTanks || !availableFuelProducts.includes(deliveryFuelType)) {
        setDeliveryFuelType(availableFuelProducts[0]);
        setTankAllocations({});
      }
    }
  }, [availableFuelProducts, tanks, deliveryFuelType]);

  // Matching tanks for the selected fuel type
  const matchingFuelTanks = useMemo(() => {
    return sortedTanks.filter(t => t.fuelType === deliveryFuelType);
  }, [sortedTanks, deliveryFuelType]);

  // Total free space across all matching tanks for this fuel type
  const totalMatchingFreeSpace = useMemo(() => {
    return matchingFuelTanks.reduce((sum, t) => sum + Math.max(0, t.capacity - t.currentLevel), 0);
  }, [matchingFuelTanks]);

  // Max single tank free space
  const maxSingleTankFreeSpace = useMemo(() => {
    if (matchingFuelTanks.length === 0) return 0;
    return Math.max(...matchingFuelTanks.map(t => Math.max(0, t.capacity - t.currentLevel)));
  }, [matchingFuelTanks]);

  const numDeliveryQty = typeof deliveryQty === 'number' ? deliveryQty : parseFloat(deliveryQty) || 0;

  // Total allocated across all matching tanks
  const totalSplitAllocated = useMemo(() => {
    return matchingFuelTanks.reduce((sum, t) => {
      const val = tankAllocations[t.id];
      const vol = typeof val === 'number' ? val : parseFloat(val || '') || 0;
      return sum + (isNaN(vol) ? 0 : vol);
    }, 0);
  }, [matchingFuelTanks, tankAllocations]);

  const remainingUnallocated = numDeliveryQty - totalSplitAllocated;
  const isAllocationComplete = numDeliveryQty > 0 && Math.abs(remainingUnallocated) < 0.01;

  // Check if any matching tank's allocated volume exceeds its free space
  const tankCapacityErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    matchingFuelTanks.forEach(t => {
      const val = tankAllocations[t.id];
      const vol = typeof val === 'number' ? val : parseFloat(val || '') || 0;
      const freeSpace = Math.max(0, t.capacity - t.currentLevel);
      if (vol > freeSpace) {
        errors[t.id] = `Exceeds free space (${formatLiters(freeSpace)}) by ${(vol - freeSpace).toLocaleString()} L`;
      }
    });
    return errors;
  }, [matchingFuelTanks, tankAllocations]);

  const hasAnyCapacityExceeded = Object.keys(tankCapacityErrors).length > 0;
  const canConfirmDelivery = isAllocationComplete && !hasAnyCapacityExceeded && numDeliveryQty > 0;

  // Selected fuel unit price and estimated total delivery cost
  const currentFuelUnitPrice = useMemo(() => {
    const matched = tanks.find(t => t.fuelType === deliveryFuelType);
    return matched?.pricePerLiter || 0;
  }, [tanks, deliveryFuelType]);

  const estimatedTotalDeliveryCost = useMemo(() => {
    return Math.round(numDeliveryQty * currentFuelUnitPrice);
  }, [numDeliveryQty, currentFuelUnitPrice]);

  // Handle Delivery Quantity Input
  const handleDeliveryQtyChange = (val: number | '') => {
    setFuelModalError(null);
    setDeliveryQty(val);
    // Keep tank allocations clean and manual, without forcing auto-allocation on single keystrokes
  };

  // Open modal handler
  const handleOpenFuelModal = useCallback(() => {
    setFuelModalError(null);
    setDeliveryQty('');
    setDeliveryInvoiceNo('');
    setDeliverySupplier('Ceylon Petroleum Corporation');
    setDeliveryDate(new Date().toISOString().split('T')[0]);

    const initialFuelType = availableFuelProducts[0] || sortedTanks[0]?.fuelType || 'Petrol 92';
    setDeliveryFuelType(initialFuelType);
    setTankAllocations({});
    setIsFuelModalOpen(true);
  }, [availableFuelProducts, sortedTanks]);

  // Handle Fuel Type selection
  const handleSelectDeliveryFuelType = (fType: FuelType) => {
    setDeliveryFuelType(fType);
    setFuelModalError(null);
    setTankAllocations({});
  };

  // Update a single tank's allocated volume cleanly without mutating other tanks
  const handleUpdateTankVolume = (targetTankId: string, rawVal: string | number) => {
    setFuelModalError(null);
    const newVol = rawVal === '' ? '' : Math.max(0, typeof rawVal === 'number' ? rawVal : Number(rawVal) || 0);

    setTankAllocations(prev => ({
      ...prev,
      [targetTankId]: newVol
    }));
  };

  // Helper: Set tank to its max free space
  const handleSetMaxFreeForTank = (tankId: string) => {
    const targetTank = matchingFuelTanks.find(t => t.id === tankId);
    if (!targetTank) return;
    const freeSpace = Math.max(0, targetTank.capacity - targetTank.currentLevel);
    handleUpdateTankVolume(tankId, freeSpace);
  };

  // Helper: Fill remaining needed balance for tank
  const handleFillRemainderForTank = (tankId: string) => {
    const othersAllocated = matchingFuelTanks.filter(t => t.id !== tankId).reduce((sum, t) => {
      const v = tankAllocations[t.id];
      return sum + (typeof v === 'number' ? v : parseFloat(v || '') || 0);
    }, 0);
    const needed = Math.max(0, numDeliveryQty - othersAllocated);
    handleUpdateTankVolume(tankId, needed);
  };

  // Helper: Clear a tank allocation
  const handleClearTank = (tankId: string) => {
    handleUpdateTankVolume(tankId, '');
  };

  // Handle Fuel Delivery Submit (Direct Multi-Tank Allocation)
  const handleAddFuelDeliverySubmit = async () => {
    const totalVolume = typeof deliveryQty === 'number' ? deliveryQty : parseFloat(deliveryQty) || 0;
    if (totalVolume <= 0) {
      setFuelModalError('Delivery volume must be a positive number greater than 0.');
      return;
    }

    interface ValidAllocation {
      tank: FuelTank;
      volume: number;
    }
    const finalAllocations: ValidAllocation[] = [];
    let allocatedSum = 0;

    for (const tank of matchingFuelTanks) {
      const val = tankAllocations[tank.id];
      const vol = typeof val === 'number' ? val : parseFloat(val || '') || 0;
      if (vol > 0) {
        const freeSpace = Math.max(0, tank.capacity - tank.currentLevel);
        if (vol > freeSpace) {
          setFuelModalError(`Allocated volume for ${tank.name} (${vol.toLocaleString()} L) exceeds its available free space (${freeSpace.toLocaleString()} L)!`);
          return;
        }
        allocatedSum += vol;
        finalAllocations.push({ tank, volume: vol });
      }
    }

    if (finalAllocations.length === 0) {
      setFuelModalError('Please enter an unload volume under at least one storage tank.');
      return;
    }

    if (Math.abs(allocatedSum - totalVolume) > 0.01) {
      const diff = totalVolume - allocatedSum;
      setFuelModalError(
        `Total allocated volume (${allocatedSum.toLocaleString()} L) does not match total delivered bowser volume (${totalVolume.toLocaleString()} L). Difference: ${diff > 0 ? '+' : ''}${diff.toLocaleString()} L.`
      );
      return;
    }

    // 1. Increment current stock levels of ALL selected tanks
    let updatedTanks = [...tanks];
    const tankPayloads: any[] = [];

    for (const alloc of finalAllocations) {
      const updatedLevel = Math.min(alloc.tank.capacity, alloc.tank.currentLevel + alloc.volume);
      updatedTanks = updatedTanks.map(t => {
        if (t.id === alloc.tank.id) {
          return {
            ...t,
            currentLevel: updatedLevel
          };
        }
        return t;
      });

      tankPayloads.push({
        id: alloc.tank.id,
        name: alloc.tank.name,
        fueltype: alloc.tank.fuelType,
        capacity: alloc.tank.capacity,
        currentlevel: updatedLevel,
        priceperliter: alloc.tank.pricePerLiter
      });
    }

    setTanks(updatedTanks);
    try {
      localStorage.setItem('fms_tanks', JSON.stringify(updatedTanks));
    } catch (_) {}

    // 2. Create single unified delivery purchase record with combined destination tanks
    const baseInvoiceId = deliveryInvoiceNo.trim() || `DEL-${Date.now().toString().slice(-6)}`;
    const deliveryIsoDate = deliveryDate ? new Date(deliveryDate).toISOString() : new Date().toISOString();
    const supplierName = deliverySupplier.trim() || 'Ceylon Petroleum Corporation';

    // Construct combined destination tank string
    const combinedDestination = finalAllocations.length === 1
      ? finalAllocations[0].tank.name
      : finalAllocations.map(a => `${a.tank.name} (${a.volume.toLocaleString()} L)`).join(' + ');

    const totalDeliveryCost = finalAllocations.reduce(
      (sum, a) => sum + Math.round(a.volume * (a.tank.pricePerLiter || 0)),
      0
    );

    const singleDeliveryRecord: StockDelivery = {
      id: baseInvoiceId,
      date: deliveryIsoDate,
      fuelType: deliveryFuelType,
      tankId: finalAllocations.length === 1 ? finalAllocations[0].tank.id : 'multi-tank',
      tankName: combinedDestination,
      destination_tank: combinedDestination,
      quantity: totalVolume,
      supplier: supplierName,
      cost: totalDeliveryCost
    };

    const newDeliveriesList = [singleDeliveryRecord, ...deliveries];
    setDeliveries(newDeliveriesList);
    try {
      localStorage.setItem('fms_deliveries', JSON.stringify(newDeliveriesList));
    } catch (_) {}

    // 3. Persist single purchase record & updated tank stock levels to Supabase in background
    try {
      const dbDeliveryPayload = {
        id: baseInvoiceId,
        date: deliveryIsoDate,
        fueltype: deliveryFuelType,
        quantity: totalVolume,
        supplier: supplierName
      };

      const { error: delErr } = await supabase.from('stock_deliveries').upsert([dbDeliveryPayload]).select();
      if (delErr) {
        console.warn('Purchase Save Notice:', delErr.message || delErr);
      }
      if (tankPayloads.length > 0) {
        const { error: tankErr } = await supabase.from(getTanksTableName()).upsert(tankPayloads);
        if (tankErr) {
          console.warn("Supabase fuel_tanks level auto-increment notice:", tankErr.message || tankErr);
        }
      }
    } catch (err: any) {
      console.warn("Supabase purchase persistence notice:", err?.message || err);
    }

    // 4. Success notification: "13,200 L successfully allocated across selected tanks"
    showToast(`${totalVolume.toLocaleString()} L successfully allocated across selected tanks`);

    // Reset form state & close modal
    setIsFuelModalOpen(false);
    setDeliveryQty('');
    setDeliveryInvoiceNo('');
    setDeliverySupplier('Ceylon Petroleum Corporation');
    setFuelModalError(null);
  };

  // -------------------------------------------------------------
  // 2. OIL / LUBRICANT INVENTORY & GRN STATE (DYNAMIC SUPABASE SYNC)
  // -------------------------------------------------------------
  const [packagedItems, setPackagedItems] = useState<PackagedOilItem[]>(() => {
    try {
      const stored = localStorage.getItem('fms_packaged_oil_items');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && !parsed.some((p: any) => p.id === 'pkg-01' || p.id === 'pkg-02')) return parsed;
      }
    } catch (_) {}
    return [];
  });

  const [grnRecords, setGrnRecords] = useState<OilGRNRecord[]>(() => {
    try {
      const stored = localStorage.getItem('fms_oil_grn_records');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          const clean = parsed.filter((g: any) => 
            g.id !== 'grn-01' && 
            g.id !== 'grn-02' && 
            g.invoiceNumber !== 'INV-164639' && 
            g.invoiceNumber !== 'INV-CHEV-8891' && 
            g.invoiceNumber !== 'CPC-BULK-3419' &&
            g.grnNumber !== 'GRN-OIL-2026-042' && 
            g.grnNumber !== 'GRN-OIL-2026-041'
          );
          return clean;
        }
      }
    } catch (_) {}
    return [];
  });

  // Purge legacy mock data from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem('fms_oil_grn_records');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          const clean = parsed.filter((g: any) => 
            g.id !== 'grn-01' && 
            g.id !== 'grn-02' && 
            g.invoiceNumber !== 'INV-164639' && 
            g.invoiceNumber !== 'INV-CHEV-8891' && 
            g.invoiceNumber !== 'CPC-BULK-3419' &&
            g.grnNumber !== 'GRN-OIL-2026-042' && 
            g.grnNumber !== 'GRN-OIL-2026-041'
          );
          if (clean.length !== parsed.length) {
            localStorage.setItem('fms_oil_grn_records', JSON.stringify(clean));
            setGrnRecords(clean);
          }
        }
      }
    } catch (_) {}
  }, []);

  // Fetch dynamic catalog items and GRN records from Supabase on mount
  const loadDynamicLubricantData = useCallback(async () => {
    try {
      const [fetchedPackaged, fetchedBulk, fetchedGRN] = await Promise.all([
        fetchPackagedLubricants(),
        fetchBulkLubricants(),
        fetchLubricantGRNReceipts()
      ]);
      if (Array.isArray(fetchedPackaged)) {
        setPackagedItems(fetchedPackaged);
      }
      if (Array.isArray(fetchedBulk)) {
        setOilTanks(fetchedBulk);
      }
      if (Array.isArray(fetchedGRN)) {
        setGrnRecords(fetchedGRN);
      }
    } catch (err) {
      console.warn("Notice: Lubricant dynamic load error", err);
    }
  }, [setOilTanks]);

  useEffect(() => {
    loadDynamicLubricantData();
  }, [loadDynamicLubricantData]);

  // Real-time synchronization with Supabase for instant inventory reflection
  useEffect(() => {
    const isConfigured = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
    if (!isConfigured) return;

    const channel = supabase.channel('purchases-lubricant-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'packaged_lubricants' }, async () => {
        const updated = await fetchPackagedLubricants();
        if (Array.isArray(updated)) setPackagedItems(updated);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bulk_lubricants' }, async () => {
        const updated = await fetchBulkLubricants();
        if (Array.isArray(updated)) setOilTanks(updated);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'oil_tanks' }, async () => {
        const updated = await fetchBulkLubricants();
        if (Array.isArray(updated)) setOilTanks(updated);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lubricant_grn_receipts' }, async () => {
        const updated = await fetchLubricantGRNReceipts();
        if (Array.isArray(updated)) setGrnRecords(updated);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [setOilTanks]);

  // Sync Packaged items & GRN records to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('fms_packaged_oil_items', JSON.stringify(packagedItems));
    } catch (_) {}
  }, [packagedItems]);

  useEffect(() => {
    try {
      localStorage.setItem('fms_oil_grn_records', JSON.stringify(grnRecords));
    } catch (_) {}
  }, [grnRecords]);

  // -------------------------------------------------------------
  // 3. OIL / LUBRICANT PURCHASE MODAL STATE
  // -------------------------------------------------------------
  const [isLubeModalOpen, setIsLubeModalOpen] = useState(false);
  const [lubePurchaseType, setLubePurchaseType] = useState<'packaged' | 'bulk'>('packaged');
  const [selectedPackagedItemId, setSelectedPackagedItemId] = useState<string>('');
  const [lubeQuantity, setLubeQuantity] = useState<number | ''>('');
  const [lubeUnitCost, setLubeUnitCost] = useState<number | ''>('');
  const [lubeSupplier, setLubeSupplier] = useState('');
  const [lubeInvoiceNo, setLubeInvoiceNo] = useState('');
  const [lubeDeliveryDate, setLubeDeliveryDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [lubeReceivedBy, setLubeReceivedBy] = useState('Station Supervisor');
  const [lubeTargetOilTankId, setLubeTargetOilTankId] = useState<string>('');
  const [lubeModalError, setLubeModalError] = useState<string | null>(null);

  // Helper to open the lubricant purchase modal with pre-selected item and unit cost
  const handleOpenLubePurchaseModal = (initialType: 'packaged' | 'bulk' = 'packaged') => {
    setLubePurchaseType(initialType);
    setLubeModalError(null);
    setLubeQuantity('');
    setLubeInvoiceNo('');
    setLubeDeliveryDate(new Date().toISOString().split('T')[0]);

    if (initialType === 'packaged') {
      const activeItem = packagedItems.find(p => p.id === selectedPackagedItemId) || packagedItems[0];
      if (activeItem) {
        setSelectedPackagedItemId(activeItem.id);
        setLubeUnitCost(activeItem.unitCost || '');
      }
    } else {
      const activeTank = oilTanks.find(t => t.id === lubeTargetOilTankId) || oilTanks[0];
      if (activeTank) {
        setLubeTargetOilTankId(activeTank.id);
        setLubeUnitCost(activeTank.pricePerLiter || '');
      }
    }
    setIsLubeModalOpen(true);
  };

  // Switch type and auto-fill unit cost
  const handleSwitchLubeType = (type: 'packaged' | 'bulk') => {
    setLubePurchaseType(type);
    if (type === 'packaged') {
      const activeItem = packagedItems.find(p => p.id === selectedPackagedItemId) || packagedItems[0];
      if (activeItem) {
        setSelectedPackagedItemId(activeItem.id);
        setLubeUnitCost(activeItem.unitCost || '');
      }
    } else {
      const activeTank = oilTanks.find(t => t.id === lubeTargetOilTankId) || oilTanks[0];
      if (activeTank) {
        setLubeTargetOilTankId(activeTank.id);
        setLubeUnitCost(activeTank.pricePerLiter || '');
      }
    }
  };

  // Auto-populate unit cost when packaged item is changed
  useEffect(() => {
    if (lubePurchaseType === 'packaged' && selectedPackagedItemId) {
      const it = packagedItems.find(p => p.id === selectedPackagedItemId);
      if (it && it.unitCost) {
        setLubeUnitCost(it.unitCost);
      }
    }
  }, [selectedPackagedItemId, lubePurchaseType, packagedItems]);

  // Auto-populate unit cost when bulk tank is changed
  useEffect(() => {
    if (lubePurchaseType === 'bulk' && lubeTargetOilTankId) {
      const tank = oilTanks.find(t => t.id === lubeTargetOilTankId);
      if (tank && tank.pricePerLiter) {
        setLubeUnitCost(tank.pricePerLiter);
      }
    }
  }, [lubeTargetOilTankId, lubePurchaseType, oilTanks]);

  const handleAddLubePurchaseSubmit = async () => {
    const numQty = typeof lubeQuantity === 'number' ? lubeQuantity : parseFloat(lubeQuantity) || 0;
    const numUnitCost = typeof lubeUnitCost === 'number' ? lubeUnitCost : parseFloat(lubeUnitCost) || 0;

    if (numQty <= 0) {
      setLubeModalError('Please enter a valid quantity or volume received.');
      return;
    }
    if (numUnitCost < 0) {
      setLubeModalError('Unit cost cannot be negative.');
      return;
    }

    const grnId = `GRN-${Date.now().toString().slice(-6)}`;
    const invoiceNumber = lubeInvoiceNo.trim() || `INV-${Date.now().toString().slice(-6)}`;
    const supplierName = lubeSupplier.trim() || 'Supplier / Distributor';
    const totalCost = Math.round(numQty * numUnitCost);

    if (lubePurchaseType === 'packaged') {
      const selectedItem = packagedItems.find(p => p.id === selectedPackagedItemId) || packagedItems[0];
      if (!selectedItem) {
        setLubeModalError('Please select a packaged lubricant item from the catalog.');
        return;
      }

      const finalUnitCost = numUnitCost > 0 ? numUnitCost : (selectedItem.unitCost || 0);
      const newStockTotal = selectedItem.currentStock + numQty;

      // 1. Optimistic Local State Update for instant UI reflection
      const updatedPackaged = packagedItems.map(item => {
        if (item.id === selectedItem.id) {
          return {
            ...item,
            currentStock: newStockTotal,
            unitCost: finalUnitCost
          };
        }
        return item;
      });
      setPackagedItems(updatedPackaged);
      try {
        localStorage.setItem('fms_packaged_oil_items', JSON.stringify(updatedPackaged));
      } catch (_) {}

      // 2. Create new GRN record
      const newGRN: OilGRNRecord = {
        id: grnId,
        grnNumber: `GRN-OIL-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`,
        date: lubeDeliveryDate,
        supplier: supplierName,
        invoiceNumber: invoiceNumber,
        type: 'packaged',
        items: [
          {
            itemId: selectedItem.id,
            itemName: selectedItem.name,
            packageSize: selectedItem.packageSize,
            quantity: numQty,
            unitCost: finalUnitCost,
            totalCost: totalCost
          }
        ],
        totalAmount: totalCost,
        receivedBy: lubeReceivedBy,
        notes: `Inward stock received for ${selectedItem.name} (${selectedItem.packageSize}).`
      };

      const updatedGRNList = [newGRN, ...grnRecords];
      setGrnRecords(updatedGRNList);
      try {
        localStorage.setItem('fms_oil_grn_records', JSON.stringify(updatedGRNList));
      } catch (_) {}

      // 3. Automated Supabase DB Stock Increment & GRN Receipt Logging
      try {
        await saveLubricantGRN(newGRN);
        await incrementPackagedStock(selectedItem.id, numQty, finalUnitCost);
      } catch (err) {
        console.warn("Supabase automated stock sync warning:", err);
      }

      showToast(`✓ Received +${numQty} units of ${selectedItem.name}. New Stock: ${newStockTotal} units.`);
    } else {
      // Bulk Oil Refill
      const targetOilTank = oilTanks.find(t => t.id === lubeTargetOilTankId) || oilTanks[0];
      if (!targetOilTank) {
        setLubeModalError('Please select a target bulk oil tank.');
        return;
      }

      const freeSpace = Math.max(0, targetOilTank.capacity - targetOilTank.currentLevel);
      if (numQty > freeSpace) {
        setLubeModalError(`Inward volume (${numQty} L) exceeds tank capacity. Free space is ${freeSpace} L.`);
        return;
      }

      const updatedLevel = Math.min(targetOilTank.capacity, targetOilTank.currentLevel + numQty);
      const updatedOilTanks = oilTanks.map(t => {
        if (t.id === targetOilTank.id) {
          return {
            ...t,
            currentLevel: updatedLevel
          };
        }
        return t;
      });

      // 1. Optimistic Local State Update
      setOilTanks(updatedOilTanks);
      try {
        localStorage.setItem('fms_oil_tanks', JSON.stringify(updatedOilTanks));
        await saveOilTank(supabase, {
          ...targetOilTank,
          currentLevel: updatedLevel
        });
      } catch (err) {
        console.warn("Oil tank save notice:", err);
      }

      // 2. Create new GRN record
      const newGRN: OilGRNRecord = {
        id: grnId,
        grnNumber: `GRN-BULK-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`,
        date: lubeDeliveryDate,
        supplier: supplierName,
        invoiceNumber: invoiceNumber,
        type: 'bulk',
        tankId: targetOilTank.id,
        tankName: `${targetOilTank.name} (${targetOilTank.grade})`,
        litersReceived: numQty,
        totalAmount: totalCost,
        receivedBy: lubeReceivedBy,
        notes: `Bulk barrel oil refill into ${targetOilTank.name}.`
      };

      const updatedGRNList = [newGRN, ...grnRecords];
      setGrnRecords(updatedGRNList);
      try {
        localStorage.setItem('fms_oil_grn_records', JSON.stringify(updatedGRNList));
      } catch (_) {}

      // 3. Automated Supabase DB Stock Increment & GRN Receipt Logging
      try {
        await saveLubricantGRN(newGRN);
        await incrementBulkStock(targetOilTank.id, numQty, numUnitCost);
      } catch (err) {
        console.warn("Supabase bulk stock increment warning:", err);
      }

      showToast(`✓ Bulk Oil Refill: Received +${numQty} L into ${targetOilTank.name}. New Level: ${updatedLevel} / ${targetOilTank.capacity} L.`);
    }

    setIsLubeModalOpen(false);
    setLubeQuantity('');
    setLubeInvoiceNo('');
    setLubeModalError(null);
  };

  // Delete Delivery from History
  const handleDeleteDelivery = async (delId: string) => {
    if (window.confirm("Are you sure you want to delete this delivery entry?")) {
      const { error } = await supabase.from('stock_deliveries').delete().eq('id', delId);
      if (error && error.code !== '42501' && !error.message?.includes('policy')) {
        console.warn("Supabase delivery delete error:", error.message);
      }
      const updated = deliveries.filter(d => d.id !== delId);
      setDeliveries(updated);
      try {
        localStorage.setItem('fms_deliveries', JSON.stringify(updated));
      } catch (_) {}
      showToast("Fuel delivery entry removed from audit records.");
    }
  };

  const handleDeleteGRN = async (grnId: string) => {
    if (window.confirm("Are you sure you want to delete this Lubricant GRN record?")) {
      try {
        await supabase.from('lubricant_grn_receipts').delete().eq('id', grnId);
        await supabase.from('oil_grn_records').delete().eq('id', grnId);
      } catch (err) {
        console.warn("Supabase GRN delete error:", err);
      }
      const updated = grnRecords.filter(g => g.id !== grnId);
      setGrnRecords(updated);
      try {
        localStorage.setItem('fms_oil_grn_records', JSON.stringify(updated));
      } catch (_) {}
      showToast("Lubricant GRN record deleted.");
    }
  };

  // Aggregate Metrics
  const totalFuelLiters = useMemo(() => {
    return deliveries.reduce((acc, d) => acc + (d.quantity || 0), 0);
  }, [deliveries]);

  const totalFuelCost = useMemo(() => {
    return deliveries.reduce((acc, d) => {
      const matchedTank = tanks.find(t => t.id === d.tankId || t.fuelType === d.fuelType);
      return acc + (d.cost || Math.round(d.quantity * (matchedTank?.pricePerLiter || 0)));
    }, 0);
  }, [deliveries, tanks]);

  const totalLubeValue = useMemo(() => {
    return grnRecords.reduce((acc, g) => acc + (g.totalAmount || 0), 0);
  }, [grnRecords]);

  return (
    <div id="purchases-tab-root" className="space-y-4">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 bg-slate-900 text-white px-4 py-2.5 rounded-xl shadow-xl flex items-center gap-2.5 text-xs animate-fade-in border border-slate-700">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          <span className="font-medium">{toastMessage}</span>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 1. DEDICATED FULL PAGE VIEW: NEW FUEL BOWSER DELIVERY                     */}
      {/* ========================================================================= */}
      {isFuelModalOpen ? (
        <div id="fuel-delivery-full-page-view" className="space-y-4 animate-fade-in">
          {/* Top Header Bar (Compact & Sleek) */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 px-4 py-3 bg-white rounded-xl border border-slate-200 shadow-xs">
            <div className="flex items-center gap-3">
              <button
                id="btn-back-to-purchases"
                type="button"
                onClick={() => {
                  setIsFuelModalOpen(false);
                  setFuelModalError(null);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-lg border border-slate-200 transition-all cursor-pointer group shadow-2xs"
              >
                <ArrowLeft className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-0.5 text-slate-600" />
                <span>Back to Purchases</span>
              </button>

              <div className="h-4 w-px bg-slate-200" />

              <div className="flex items-center gap-2">
                <h1 className="text-sm sm:text-base font-black text-slate-900 tracking-tight font-sans">
                  New Fuel Bowser Delivery
                </h1>
                <span className="hidden sm:inline-block px-2 py-0.5 bg-blue-50 text-blue-700 text-[10px] font-extrabold rounded-full border border-blue-200 uppercase tracking-wider">
                  Full Page View
                </span>
              </div>
            </div>

            {/* Compact Step Progress Indicator */}
            <div className="flex items-center gap-1 self-start sm:self-auto bg-slate-50 p-1 rounded-lg border border-slate-200 text-[11px] font-bold">
              <div className={`flex items-center gap-1 px-2.5 py-0.5 rounded-md transition-all ${
                numDeliveryQty > 0 ? 'bg-blue-600 text-white shadow-2xs' : 'bg-white text-slate-800 border border-slate-200 shadow-2xs'
              }`}>
                <span className="w-3.5 h-3.5 rounded-full bg-white/20 text-center text-[9px] leading-3.5 font-black">1</span>
                <span>Product &amp; Volume</span>
              </div>
              <ChevronRight className="w-3 h-3 text-slate-400" />
              <div className={`flex items-center gap-1 px-2.5 py-0.5 rounded-md transition-all ${
                isAllocationComplete && !hasAnyCapacityExceeded
                  ? 'bg-blue-600 text-white shadow-2xs'
                  : numDeliveryQty > 0
                    ? 'bg-white text-slate-800 border border-slate-200 shadow-2xs'
                    : 'text-slate-400'
              }`}>
                <span className="w-3.5 h-3.5 rounded-full bg-slate-200 text-slate-700 text-center text-[9px] leading-3.5 font-black">2</span>
                <span>Tank Allocation</span>
              </div>
              <ChevronRight className="w-3 h-3 text-slate-400" />
              <div className={`flex items-center gap-1 px-2.5 py-0.5 rounded-md transition-all ${
                canConfirmDelivery
                  ? 'bg-emerald-600 text-white shadow-2xs'
                  : 'text-slate-400'
              }`}>
                <span className="w-3.5 h-3.5 rounded-full bg-slate-200 text-slate-700 text-center text-[9px] leading-3.5 font-black">3</span>
                <span>Confirm</span>
              </div>
            </div>
          </div>

          {/* Error Alert */}
          {fuelModalError && (
            <div className="p-3 bg-rose-50 text-rose-800 rounded-xl text-xs flex items-center justify-between gap-3 border border-rose-200 font-semibold animate-shake shadow-xs">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 text-rose-600" />
                <span>{fuelModalError}</span>
              </div>
              <button 
                type="button"
                onClick={() => setFuelModalError(null)}
                className="p-1 text-rose-500 hover:text-rose-800 hover:bg-rose-100 rounded-lg cursor-pointer transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* 3-Column Responsive Grid Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* ------------------------------------------------------------- */}
            {/* LEFT PANEL (Col 1 - lg:col-span-4): Clean Inputs Only         */}
            {/* ------------------------------------------------------------- */}
            <div className="lg:col-span-4 bg-white rounded-2xl border border-slate-200/90 shadow-xs p-5 space-y-5">
              {/* Fuel Product Selector Chips */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-bold text-slate-800">
                    Select Fuel Product <span className="text-rose-500">*</span>
                  </label>
                  <span className="text-[10px] font-bold text-slate-400">
                    {availableFuelProducts.length} Available
                  </span>
                </div>

                {availableFuelProducts.length === 0 ? (
                  <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 font-medium space-y-1">
                    <p className="font-bold">No Active Storage Tanks Found</p>
                    <p className="text-[11px] text-amber-700">Please configure fuel tanks in the Station Settings to record deliveries.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {availableFuelProducts.map((fType) => {
                      const isSelected = deliveryFuelType === fType;
                      const tankCount = sortedTanks.filter(t => t.fuelType === fType).length;
                      return (
                        <button
                          key={fType}
                          type="button"
                          onClick={() => handleSelectDeliveryFuelType(fType)}
                          className={`p-3 rounded-xl text-xs font-bold text-left transition-all border cursor-pointer flex flex-col justify-between gap-1.5 ${
                            isSelected
                              ? 'bg-blue-600 text-white border-blue-600 shadow-sm shadow-blue-500/20'
                              : 'bg-slate-50 text-slate-700 border-slate-200 hover:border-blue-300 hover:bg-blue-50/30'
                          }`}
                        >
                          <span className="truncate">{fType}</span>
                          <div className="flex items-center justify-between text-[10px]">
                            <span className={`font-normal ${isSelected ? 'text-blue-100' : 'text-slate-400'}`}>
                              {tankCount} {tankCount === 1 ? 'Tank' : 'Tanks'}
                            </span>
                            {isSelected && <Check className="w-3.5 h-3.5 text-white" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Total Delivery Volume Input (Litres) */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                    Total Delivery Volume <span className="text-rose-500">*</span>
                  </label>
                  {numDeliveryQty > 0 && (
                    <span className="text-xs font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200">
                      {numDeliveryQty.toLocaleString()} Liters
                    </span>
                  )}
                </div>
                <div className="relative">
                  <input
                    id="purchase-delivery-qty"
                    type="number"
                    step="any"
                    min="0"
                    value={deliveryQty}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => {
                      const val = e.target.value === '' ? '' : Number(e.target.value) || '';
                      handleDeliveryQtyChange(val);
                    }}
                    placeholder="e.g. 13200"
                    className="w-full px-4 py-3 bg-white border-2 border-blue-200 focus:border-blue-600 rounded-xl text-lg font-black text-slate-900 tabular-nums focus:outline-none focus:ring-4 focus:ring-blue-500/10 transition-all placeholder:text-gray-300 shadow-2xs"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-black text-slate-400 uppercase tracking-wider pointer-events-none">
                    Liters
                  </span>
                </div>

                {/* Quick Sri Lankan CPC Bowser Load Presets */}
                <div className="mt-2.5">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">
                    Quick Bowser Presets (CPC Standard)
                  </span>
                  <div className="grid grid-cols-4 gap-1.5">
                    {[6600, 13200, 19800, 33000].map(vol => (
                      <button
                        key={vol}
                        type="button"
                        onClick={() => handleDeliveryQtyChange(vol)}
                        className={`py-1.5 px-1 rounded-lg text-[10px] font-extrabold border transition-all cursor-pointer text-center ${
                          numDeliveryQty === vol
                            ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-blue-50 hover:border-blue-200'
                        }`}
                      >
                        {(vol / 1000).toFixed(vol % 1000 === 0 ? 0 : 1)}k L
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Free Space Dynamic Availability Banner */}
              <div className="pt-2">
                {matchingFuelTanks.length === 0 ? (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                    <span>No active storage tanks configured for <strong>{deliveryFuelType}</strong>. Please configure tanks.</span>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/70 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5 text-slate-700 font-bold">
                          <Database className="w-4 h-4 text-blue-600" />
                          <span>Station Storage</span>
                        </div>
                        <span className="text-slate-500 font-medium">
                          {matchingFuelTanks.length} {deliveryFuelType} {matchingFuelTanks.length === 1 ? 'Tank' : 'Tanks'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-200/60">
                        <span className="text-slate-600">Combined Free Space:</span>
                        <span className="font-extrabold text-slate-900 tabular-nums">
                          {formatLiters(totalMatchingFreeSpace)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-600">Current Unit Rate:</span>
                        <span className="font-bold text-slate-900 tabular-nums">
                          {formatCurrency(currentFuelUnitPrice)} / L
                        </span>
                      </div>
                    </div>

                    {/* Dynamic Capacity Feedback */}
                    {numDeliveryQty > 0 && (
                      <div>
                        {numDeliveryQty > totalMatchingFreeSpace ? (
                          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 space-y-1">
                            <div className="flex items-center gap-1.5 font-bold">
                              <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0" />
                              <span>Insufficient Total Station Capacity</span>
                            </div>
                            <p className="text-[11px] leading-relaxed text-rose-700">
                              Delivery volume ({numDeliveryQty.toLocaleString()} L) exceeds total station free capacity ({totalMatchingFreeSpace.toLocaleString()} L) by <strong>{(numDeliveryQty - totalMatchingFreeSpace).toLocaleString()} L</strong>.
                            </p>
                          </div>
                        ) : numDeliveryQty > maxSingleTankFreeSpace && matchingFuelTanks.length > 1 ? (
                          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 space-y-1">
                            <div className="flex items-center gap-1.5 font-bold">
                              <Info className="w-4 h-4 text-amber-600 flex-shrink-0" />
                              <span>Multi-Tank Load Required</span>
                            </div>
                            <p className="text-[11px] leading-relaxed text-amber-700">
                              Largest single tank free space is {maxSingleTankFreeSpace.toLocaleString()} L. Allocate portions across the {matchingFuelTanks.length} tanks in Step 2.
                            </p>
                          </div>
                        ) : (
                          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-center gap-2 font-semibold">
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                            <span>Sufficient free space available ({totalMatchingFreeSpace.toLocaleString()} L total free).</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* ----------------------------------------------------------------- */}
            {/* CENTER PANEL (Col 2 - lg:col-span-5): Direct Tank Allocation Cards */}
            {/* ----------------------------------------------------------------- */}
            <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200/90 shadow-xs p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-slate-800 bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200">
                  <Layers className="w-3.5 h-3.5 text-blue-600" />
                  Step 2: Storage Tank Allocation
                </span>

                {/* Live Balance Pill */}
                <div className={`px-2.5 py-1 rounded-lg text-xs font-bold border flex items-center gap-1.5 self-start sm:self-auto ${
                  isAllocationComplete
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : remainingUnallocated > 0
                      ? 'bg-amber-50 text-amber-800 border-amber-200'
                      : 'bg-rose-50 text-rose-800 border-rose-200'
                }`}>
                  <span>Allocated: <strong>{formatLiters(totalSplitAllocated)}</strong> / <strong>{numDeliveryQty > 0 ? formatLiters(numDeliveryQty) : '0 L'}</strong></span>
                  {isAllocationComplete ? (
                    <span className="text-[10px] px-1.5 py-0.5 bg-emerald-200 text-emerald-900 rounded font-black">✓ Match</span>
                  ) : remainingUnallocated > 0 ? (
                    <span className="text-[10px] px-1.5 py-0.5 bg-amber-200 text-amber-900 rounded font-black">{formatLiters(remainingUnallocated)} left</span>
                  ) : (
                    <span className="text-[10px] px-1.5 py-0.5 bg-rose-200 text-rose-900 rounded font-black">+{formatLiters(Math.abs(remainingUnallocated))} over</span>
                  )}
                </div>
              </div>

              {/* Tank Cards List with Direct Volume Inputs */}
              <div className="space-y-3.5">
                {matchingFuelTanks.length === 0 ? (
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-center text-xs text-slate-500">
                    No active storage tanks configured for {deliveryFuelType}.
                  </div>
                ) : (
                  matchingFuelTanks.map((tank) => {
                    const freeSpace = Math.max(0, tank.capacity - tank.currentLevel);
                    const rawVol = tankAllocations[tank.id];
                    const vol = typeof rawVol === 'number' ? rawVol : parseFloat(rawVol || '') || 0;
                    const isExceeded = vol > freeSpace;
                    const currentPct = Math.min(100, Math.round((tank.currentLevel / tank.capacity) * 100));
                    const projectedLevel = Math.min(tank.capacity, tank.currentLevel + vol);
                    const projectedPct = Math.min(100, Math.round((projectedLevel / tank.capacity) * 100));

                    return (
                      <div
                        key={tank.id}
                        className={`p-4 rounded-xl border-2 transition-all space-y-3 ${
                          isExceeded
                            ? 'border-rose-300 bg-rose-50/40 shadow-xs'
                            : vol > 0
                              ? 'border-blue-500 bg-blue-50/20 shadow-xs'
                              : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                      >
                        {/* Tank Header */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 font-black text-xs flex items-center justify-center">
                              <Database className="w-3.5 h-3.5" />
                            </div>
                            <div>
                              <h4 className="font-bold text-slate-900 text-xs">{tank.name}</h4>
                              <span className="text-[10px] text-slate-500 font-medium">Capacity: {formatLiters(tank.capacity)}</span>
                            </div>
                          </div>

                          {/* Free Space & Status Badge */}
                          <div className="text-right">
                            <span className="text-[10px] font-bold text-slate-500 block">Available Free Space</span>
                            <span className="text-xs font-black text-emerald-700 tabular-nums">
                              {formatLiters(freeSpace)}
                            </span>
                          </div>
                        </div>

                        {/* Gauge Progress Bar */}
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-[10px] text-slate-500">
                            <span>Current: <strong>{formatLiters(tank.currentLevel)}</strong> ({currentPct}%)</span>
                            {vol > 0 && !isExceeded && (
                              <span className="text-blue-700 font-bold">
                                Projected: {formatLiters(projectedLevel)} ({projectedPct}%)
                              </span>
                            )}
                          </div>
                          <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden relative">
                            {/* Current level bar */}
                            <div
                              className="h-full bg-slate-400 rounded-full transition-all duration-300"
                              style={{ width: `${currentPct}%` }}
                            />
                            {/* Projected addition bar overlay */}
                            {vol > 0 && !isExceeded && (
                              <div
                                className="absolute top-0 bottom-0 bg-blue-500 transition-all duration-300 opacity-80"
                                style={{
                                  left: `${currentPct}%`,
                                  width: `${Math.min(100 - currentPct, (vol / tank.capacity) * 100)}%`
                                }}
                              />
                            )}
                          </div>
                        </div>

                        {/* Direct Volume Input Field */}
                        <div className="pt-1 space-y-1.5">
                          <div className="flex items-center justify-between">
                            <label className="text-[11px] font-black uppercase tracking-wider text-slate-800">
                              Unload Volume (Liters)
                            </label>

                            {/* Quick Fill Actions */}
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleSetMaxFreeForTank(tank.id)}
                                className="px-2 py-0.5 text-[10px] font-bold bg-slate-100 hover:bg-blue-100 hover:text-blue-700 text-slate-700 rounded transition-colors cursor-pointer"
                                title="Fill available free space"
                              >
                                Max Free
                              </button>
                              {remainingUnallocated > 0 && (
                                <button
                                  type="button"
                                  onClick={() => handleFillRemainderForTank(tank.id)}
                                  className="px-2 py-0.5 text-[10px] font-bold bg-blue-50 hover:bg-blue-100 text-blue-700 rounded transition-colors cursor-pointer"
                                  title="Fill remaining balance of the bowser"
                                >
                                  + Remainder
                                </button>
                              )}
                              {vol > 0 && (
                                <button
                                  type="button"
                                  onClick={() => handleClearTank(tank.id)}
                                  className="px-1.5 py-0.5 text-[10px] font-bold text-slate-400 hover:text-rose-600 rounded transition-colors cursor-pointer"
                                  title="Clear allocation"
                                >
                                  Clear
                                </button>
                              )}
                            </div>
                          </div>

                          <div className="relative">
                            <input
                              id={`purchase-tank-alloc-${tank.id}`}
                              type="number"
                              step="any"
                              min="0"
                              value={rawVol ?? ''}
                              onFocus={(e) => e.target.select()}
                              onChange={(e) => {
                                const val = e.target.value === '' ? '' : Number(e.target.value) || '';
                                handleUpdateTankVolume(tank.id, val);
                              }}
                              placeholder="0"
                              className={`w-full px-3.5 py-2.5 bg-white border-2 rounded-xl text-sm font-black tabular-nums focus:outline-none transition-all ${
                                isExceeded
                                  ? 'border-rose-400 text-rose-700 focus:ring-4 focus:ring-rose-500/10'
                                  : vol > 0
                                    ? 'border-blue-500 text-slate-900 focus:ring-4 focus:ring-blue-500/10'
                                    : 'border-slate-200 text-slate-900 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10'
                              }`}
                            />
                            <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-black text-slate-400 pointer-events-none">
                              Liters
                            </span>
                          </div>

                          {/* Dynamic Feedback Banner */}
                          {isExceeded && (
                            <p className="text-[11px] font-bold text-rose-600 flex items-center gap-1 pt-0.5">
                              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                              <span>Exceeds available free space ({formatLiters(freeSpace)}) by {(vol - freeSpace).toLocaleString()} L!</span>
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Center bottom summary */}
              {numDeliveryQty > 0 && (
                <div className={`p-3 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
                  isAllocationComplete && !hasAnyCapacityExceeded
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : hasAnyCapacityExceeded
                      ? 'bg-rose-50 text-rose-800 border-rose-200'
                      : 'bg-amber-50 text-amber-800 border-amber-200'
                }`}>
                  {isAllocationComplete && !hasAnyCapacityExceeded ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                      <span>✓ Total {numDeliveryQty.toLocaleString()} L fully allocated with zero capacity overflow.</span>
                    </>
                  ) : hasAnyCapacityExceeded ? (
                    <>
                      <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0" />
                      <span>One or more tanks exceed available free space. Adjust volumes to continue.</span>
                    </>
                  ) : (
                    <>
                      <Info className="w-4 h-4 text-amber-600 flex-shrink-0" />
                      <span>Please allocate the remaining {remainingUnallocated.toLocaleString()} L across storage tanks.</span>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* ----------------------------------------------------------------- */}
            {/* RIGHT PANEL (Col 3 - lg:col-span-3): Reference & Confirm Action   */}
            {/* ----------------------------------------------------------------- */}
            <div className="lg:col-span-3 bg-white rounded-2xl border border-slate-200/90 shadow-xs p-5 space-y-5 flex flex-col justify-between">
              <div className="space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-slate-800 bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200">
                    <FileText className="w-3.5 h-3.5 text-blue-600" />
                    Step 3: Reference &amp; Approval
                  </span>
                </div>

                {/* Supplier Name */}
                <div>
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1.5">
                    Supplier Name
                  </label>
                  <input
                    id="purchase-supplier-name"
                    type="text"
                    value={deliverySupplier}
                    onChange={(e) => setDeliverySupplier(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-xs font-medium focus:outline-none focus:border-blue-500 focus:bg-white shadow-2xs"
                    placeholder="e.g. Ceylon Petroleum Corporation"
                  />
                </div>

                {/* Invoice / Bowser Ref No */}
                <div>
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1.5">
                    Invoice / Ref No
                  </label>
                  <input
                    id="purchase-invoice-no"
                    type="text"
                    value={deliveryInvoiceNo}
                    onChange={(e) => setDeliveryInvoiceNo(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-xs font-medium focus:outline-none focus:border-blue-500 focus:bg-white shadow-2xs"
                    placeholder="e.g. INV-2026-8891"
                  />
                </div>

                {/* Delivery Date */}
                <div>
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1.5">
                    Delivery Date
                  </label>
                  <input
                    id="purchase-delivery-date"
                    type="date"
                    value={deliveryDate}
                    onChange={(e) => setDeliveryDate(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-xs font-medium focus:outline-none focus:border-blue-500 focus:bg-white shadow-2xs"
                  />
                </div>

                {/* Real-time Order Summary Card */}
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-3">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 block">
                    Delivery Order Summary
                  </span>

                  <div className="space-y-1.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600">Product:</span>
                      <span className="font-bold text-blue-700">{deliveryFuelType}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600">Total Volume:</span>
                      <span className="font-extrabold text-slate-900 tabular-nums">
                        {numDeliveryQty > 0 ? formatLiters(numDeliveryQty) : '0 L'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600">Unit Price:</span>
                      <span className="font-bold text-slate-800 tabular-nums">
                        {formatCurrency(currentFuelUnitPrice)} / L
                      </span>
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t border-slate-200">
                      <span className="font-bold text-slate-800">Total Est. Value:</span>
                      <span className="font-extrabold text-emerald-700 text-sm tabular-nums">
                        {formatCurrency(estimatedTotalDeliveryCost)}
                      </span>
                    </div>
                  </div>

                  {/* Target Tanks Destinations Summary */}
                  <div className="pt-2 border-t border-slate-200/80 text-[11px] text-slate-500">
                    <span className="font-semibold block text-slate-700 mb-1">Destinations:</span>
                    {matchingFuelTanks.filter(t => {
                      const v = tankAllocations[t.id];
                      return (typeof v === 'number' ? v : parseFloat(v || '') || 0) > 0;
                    }).length === 0 ? (
                      <span className="italic text-slate-400">Enter volume in Step 2</span>
                    ) : (
                      <div className="space-y-1">
                        {matchingFuelTanks.filter(t => {
                          const v = tankAllocations[t.id];
                          return (typeof v === 'number' ? v : parseFloat(v || '') || 0) > 0;
                        }).map(t => {
                          const v = typeof tankAllocations[t.id] === 'number' ? tankAllocations[t.id] : parseFloat(tankAllocations[t.id] || '') || 0;
                          return (
                            <div key={t.id} className="flex items-center justify-between">
                              <span className="text-slate-700 font-medium">{t.name}:</span>
                              <strong className="text-slate-900 tabular-nums">{formatLiters(v as number)}</strong>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Action Buttons Panel */}
              <div className="pt-5 space-y-2 border-t border-slate-100">
                <button
                  id="btn-confirm-fuel-delivery"
                  type="button"
                  onClick={handleAddFuelDeliverySubmit}
                  disabled={!canConfirmDelivery}
                  className={`w-full py-3 px-4 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2 ${
                    canConfirmDelivery
                      ? 'bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600 text-white cursor-pointer shadow-sm shadow-blue-500/25'
                      : 'bg-slate-200 text-slate-400 cursor-not-allowed border border-slate-300/60'
                  }`}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Confirm Delivery &amp; Receive Stock</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsFuelModalOpen(false);
                    setFuelModalError(null);
                  }}
                  className="w-full py-2.5 px-4 bg-transparent border border-slate-200 hover:bg-slate-50 text-slate-600 font-bold text-xs rounded-xl transition-colors cursor-pointer text-center"
                >
                  Cancel &amp; Return to Purchases
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Main Header (Clean standard layout matching other tabs) */}
          <div id="purchases-header-block" className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h1 className="text-lg font-bold text-slate-900 tracking-tight font-sans">
                Purchases
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Manage fuel bowser deliveries and lubricant stock replenishment
              </p>
            </div>

            {/* Quick Stats Summary */}
            <div className="hidden sm:flex items-center gap-4 text-xs text-gray-500">
              <span>Total Fuel Volume: <strong className="text-slate-900 tabular-nums">{formatLiters(totalFuelLiters)}</strong></span>
              <span>&bull;</span>
              <span>Total Value: <strong className="text-emerald-700 tabular-nums">{formatCurrency(totalFuelCost + totalLubeValue)}</strong></span>
            </div>
          </div>

      {/* Top Category Filter Sub-Tabs with Action Button on Top Right */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-200/80 pb-2">
        <div className="flex items-center gap-2 overflow-x-auto">
          <button
            onClick={() => setActiveSubTab('fuel-bowser')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
              activeSubTab === 'fuel-bowser'
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/20'
                : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200/70'
            }`}
          >
            <Fuel className="w-3.5 h-3.5" />
            <span>Fuel Tanker Purchases</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
              activeSubTab === 'fuel-bowser' ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-600'
            }`}>
              {deliveries.length}
            </span>
          </button>

          <button
            onClick={() => setActiveSubTab('lubricants')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
              activeSubTab === 'lubricants'
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/20'
                : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200/70'
            }`}
          >
            <Droplets className="w-3.5 h-3.5" />
            <span>Lubricants &amp; Oil Purchases</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
              activeSubTab === 'lubricants' ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-600'
            }`}>
              {grnRecords.length}
            </span>
          </button>

          <button
            onClick={() => setActiveSubTab('lp-gas')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
              activeSubTab === 'lp-gas'
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/20'
                : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200/70'
            }`}
          >
            <Flame className="w-3.5 h-3.5" />
            <span>LP Gas Deliveries</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
              activeSubTab === 'lp-gas' ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-600'
            }`}>
              {lpGasDeliveries.length}
            </span>
          </button>
        </div>

        {/* Top Right Context-Specific Action Button */}
        {activeSubTab === 'fuel-bowser' && (
          <button
            id="btn-add-fuel-purchase-top"
            onClick={handleOpenFuelModal}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl transition-all shadow-xs cursor-pointer flex-shrink-0 self-start sm:self-auto"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Purchase</span>
          </button>
        )}

        {activeSubTab === 'lubricants' && (
          <button
            id="btn-add-lube-purchase-top"
            onClick={() => handleOpenLubePurchaseModal('packaged')}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl transition-all shadow-xs cursor-pointer flex-shrink-0 self-start sm:self-auto"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Purchase</span>
          </button>
        )}

        {activeSubTab === 'lp-gas' && (
          <button
            id="btn-add-lpgas-purchase-top"
            onClick={() => setIsLPGasModalOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl transition-all shadow-xs cursor-pointer flex-shrink-0 self-start sm:self-auto"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Purchase</span>
          </button>
        )}
      </div>

      {/* ========================================================================= */}
      {/* SUB-TAB 1: FUEL TANKER PURCHASES */}
      {/* ========================================================================= */}
      {activeSubTab === 'fuel-bowser' && (
        <div className="space-y-4 animate-fade-in">
          {/* Fuel Purchases Records List Table */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Fuel className="w-4 h-4 text-blue-600" />
                <h3 className="text-sm font-bold text-slate-900">Fuel Tanker Purchase Logs</h3>
              </div>
              <span className="text-xs text-gray-500 ">{deliveries.length} Records</span>
            </div>

            {deliveries.length === 0 ? (
              <div className="p-8 text-center text-gray-400 space-y-2">
                <Fuel className="w-8 h-8 mx-auto text-gray-300" />
                <p className="text-xs">No fuel bowser purchases logged yet.</p>
                <button
                  onClick={handleOpenFuelModal}
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:underline cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Purchase</span>
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[850px] text-left text-xs">
                  <thead className="bg-gray-50 text-gray-500 font-bold uppercase text-[10px] tracking-wider border-b border-gray-100">
                    <tr>
                      <th className="py-3 px-4">Date</th>
                      <th className="py-3 px-4">Invoice / Delivery No</th>
                      <th className="py-3 px-4">Product &amp; Destination Tank</th>
                      <th className="py-3 px-4">Supplier</th>
                      <th className="py-3 px-4 text-right">Volume (L)</th>
                      <th className="py-3 px-4 text-right">Unit Rate (Rs.)</th>
                      <th className="py-3 px-4 text-right">Total Amount (Rs.)</th>
                      <th className="py-3 px-4 text-center sticky right-0 bg-gray-50 z-10 shadow-[-4px_0_6px_-2px_rgba(0,0,0,0.03)]">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 text-slate-800">
                    {deliveries.map(del => {
                      const matchedTank = tanks.find(t => t.id === del.tankId || t.fuelType === del.fuelType);
                      const unitRate = matchedTank?.pricePerLiter || 0;
                      const cost = del.cost || Math.round(del.quantity * unitRate);
                      const invoiceId = del.id.startsWith('DEL-') ? del.id : `INV-${del.id}`;

                      // Unified entry object for receipt modal
                      const unifiedObj: UnifiedPurchaseEntry = {
                        id: del.id,
                        date: del.date ? del.date.split('T')[0] : new Date().toISOString().split('T')[0],
                        category: 'Fuel Bowser',
                        supplier: del.supplier || 'Ceylon Petroleum Corporation',
                        invoiceNo: invoiceId,
                        description: `${del.fuelType} Bowser Delivery`,
                        destination: del.destination_tank || del.tankName || matchedTank?.name || 'Underground Storage Tank',
                        quantity: del.quantity,
                        unitLabel: 'L',
                        unitPrice: unitRate,
                        totalAmount: cost,
                        receivedBy: 'Bowser Receiving Team',
                        rawType: 'fuel'
                      };

                      return (
                        <tr 
                          key={del.id} 
                          onClick={() => openReceiptModal(unifiedObj)}
                          className="hover:bg-blue-50/50 transition-colors cursor-pointer group"
                        >
                          <td className="py-3 px-4 text-gray-600 whitespace-nowrap">
                            {del.date ? del.date.split('T')[0] : 'Today'}
                          </td>
                          <td className="py-3 px-4 font-bold text-slate-900 whitespace-nowrap">
                            {invoiceId}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200/50 flex-shrink-0">
                                {del.fuelType}
                              </span>
                              <span className="font-medium text-slate-700 text-[11px] truncate max-w-[260px]" title={del.destination_tank || del.tankName || matchedTank?.name || 'Underground Tank'}>
                                {del.destination_tank || del.tankName || matchedTank?.name || 'Underground Tank'}
                              </span>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-gray-600">{del.supplier || 'Ceylon Petroleum Corporation'}</td>
                          <td className="py-3 px-4 text-right font-extrabold tabular-nums text-slate-900 whitespace-nowrap">
                            {formatLiters(del.quantity)}
                          </td>
                          <td className="py-3 px-4 text-right text-gray-600 tabular-nums whitespace-nowrap">
                            {formatCurrency(unitRate)}
                          </td>
                          <td className="py-3 px-4 text-right font-bold tabular-nums text-emerald-700 whitespace-nowrap">
                            {formatCurrency(cost)}
                          </td>
                          <td className="py-3 px-4 text-center sticky right-0 bg-white group-hover:bg-blue-50/50 z-10 whitespace-nowrap shadow-[-4px_0_6px_-2px_rgba(0,0,0,0.03)]" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  openReceiptModal(unifiedObj);
                                }}
                                className="p-1.5 text-blue-600 hover:text-blue-800 hover:bg-blue-100/70 rounded-lg transition-colors cursor-pointer z-30"
                                title="Print / View Receipt"
                              >
                                <Printer className="w-3.5 h-3.5" />
                              </button>
                              {isAdmin(user?.role || userRole) && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    e.preventDefault();
                                    handleDeleteDelivery(del.id);
                                  }}
                                  className="p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer z-30"
                                  title="Delete Record"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SUB-TAB 2: LUBRICANTS & OIL PURCHASES */}
      {/* ========================================================================= */}
      {activeSubTab === 'lubricants' && (
        <div className="space-y-4 animate-fade-in">
          {/* Lubricant Inward Stock List */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Droplets className="w-4 h-4 text-emerald-600" />
                <h3 className="text-sm font-bold text-slate-900">Lubricant Purchase Logs</h3>
              </div>
              <span className="text-xs text-gray-500 ">{grnRecords.length} Records</span>
            </div>

            {grnRecords.length === 0 ? (
              <div className="p-8 text-center text-gray-400 space-y-2">
                <Package className="w-8 h-8 mx-auto text-gray-300" />
                <p className="text-xs">No lubricant inward stock logged yet.</p>
                <button
                  onClick={() => handleOpenLubePurchaseModal('packaged')}
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:underline cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Purchase</span>
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[850px] text-left text-xs">
                  <thead className="bg-gray-50 text-gray-500 font-bold uppercase text-[10px] tracking-wider border-b border-gray-100">
                    <tr>
                      <th className="py-3 px-4">Date</th>
                      <th className="py-3 px-4">Invoice / Ref No</th>
                      <th className="py-3 px-4">Type</th>
                      <th className="py-3 px-4">Supplier</th>
                      <th className="py-3 px-4">Items / Details</th>
                      <th className="py-3 px-4 text-right">Qty / Liters</th>
                      <th className="py-3 px-4 text-right">Total Amount (Rs.)</th>
                      <th className="py-3 px-4 text-center sticky right-0 bg-gray-50 z-10 shadow-[-4px_0_6px_-2px_rgba(0,0,0,0.03)]">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 text-slate-800">
                    {grnRecords.map(grn => {
                      const isBulk = grn.type === 'bulk';
                      const details = isBulk 
                        ? (grn.tankName || 'Bulk Tank Refill')
                        : (grn.items || []).map(i => `${i.itemName} (${i.packageSize})`).join(', ');

                      const totalQty = isBulk 
                        ? (grn.litersReceived || 0)
                        : (grn.items || []).reduce((acc, i) => acc + i.quantity, 0);

                      const unitPrice = isBulk 
                        ? (grn.litersReceived ? Math.round(grn.totalAmount / grn.litersReceived) : 0)
                        : (totalQty ? Math.round(grn.totalAmount / totalQty) : 0);

                      const unifiedObj: UnifiedPurchaseEntry = {
                        id: grn.id,
                        date: grn.date,
                        category: isBulk ? 'Bulk Oil' : 'Packaged Lubricant',
                        supplier: grn.supplier,
                        invoiceNo: grn.invoiceNumber || grn.grnNumber,
                        description: details,
                        destination: isBulk ? (grn.tankName || 'Bulk Storage Tank') : 'Lubricant Retail Shelf / Store',
                        quantity: totalQty,
                        unitLabel: isBulk ? 'L' : 'units',
                        unitPrice: unitPrice,
                        totalAmount: grn.totalAmount,
                        receivedBy: grn.receivedBy,
                        rawType: 'lube_grn'
                      };

                      return (
                        <tr 
                          key={grn.id} 
                          onClick={() => openReceiptModal(unifiedObj)}
                          className="hover:bg-blue-50/50 transition-colors cursor-pointer group"
                        >
                          <td className="py-3 px-4 text-gray-600 whitespace-nowrap">{grn.date}</td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <span className="font-bold text-slate-900 block ">{grn.invoiceNumber || grn.grnNumber}</span>
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              isBulk ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-700'
                            }`}>
                              {isBulk ? 'Bulk Oil' : 'Packaged'}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-gray-600">{grn.supplier}</td>
                          <td className="py-3 px-4 max-w-[240px] truncate text-slate-700 font-medium" title={details}>
                            {details}
                          </td>
                          <td className="py-3 px-4 text-right font-bold tabular-nums text-slate-900 whitespace-nowrap">
                            {totalQty} {isBulk ? 'L' : 'units'}
                          </td>
                          <td className="py-3 px-4 text-right font-bold tabular-nums text-emerald-700 whitespace-nowrap">
                            {formatCurrency(grn.totalAmount)}
                          </td>
                          <td className="py-3 px-4 text-center sticky right-0 bg-white group-hover:bg-blue-50/50 z-10 whitespace-nowrap shadow-[-4px_0_6px_-2px_rgba(0,0,0,0.03)]" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  openReceiptModal(unifiedObj);
                                }}
                                className="p-1.5 text-blue-600 hover:text-blue-800 hover:bg-blue-100/70 rounded-lg transition-colors cursor-pointer z-30"
                                title="Print / View Receipt"
                              >
                                <Printer className="w-3.5 h-3.5" />
                              </button>
                              {isAdmin(user?.role || userRole) && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    e.preventDefault();
                                    handleDeleteGRN(grn.id);
                                  }}
                                  className="p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer z-30"
                                  title="Delete Record"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SUB-TAB 3: LP GAS DELIVERIES */}
      {/* ========================================================================= */}
      {activeSubTab === 'lp-gas' && (
        <div className="space-y-4 animate-fade-in">
          {/* LP Gas Purchases Records List Table */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Flame className="w-4 h-4 text-orange-600" />
                <h3 className="text-sm font-bold text-slate-900">LP Gas Purchase Logs</h3>
              </div>
              <span className="text-xs text-gray-500 ">{lpGasDeliveries.length} Records</span>
            </div>

            {lpGasDeliveries.length === 0 ? (
              <div className="p-8 text-center text-gray-400 space-y-2">
                <Flame className="w-8 h-8 mx-auto text-gray-300" />
                <p className="text-xs">No LP Gas deliveries logged yet.</p>
                <button
                  onClick={() => setIsLPGasModalOpen(true)}
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:underline cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add First Delivery
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className="bg-gray-50 text-gray-500 font-bold uppercase text-[10px] tracking-wider border-b border-gray-100">
                    <tr>
                      <th className="py-3 px-4">Date</th>
                      <th className="py-3 px-4">Invoice No</th>
                      <th className="py-3 px-4">Supplier</th>
                      <th className="py-3 px-4">Cylinder Size</th>
                      <th className="py-3 px-4 text-right">Full Quantity</th>
                      <th className="py-3 px-4 text-right">Unit Rate (Rs.)</th>
                      <th className="py-3 px-4 text-right">Total Amount (Rs.)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 text-slate-800">
                    {lpGasDeliveries.map(del => {
                      return (
                        <tr key={del.id} className="hover:bg-blue-50/50 transition-colors group">
                          <td className="py-3 px-4">
                            <div className="flex flex-col">
                              <span className="font-semibold text-slate-900 text-xs">
                                {new Date(del.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                              </span>
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <span className="font-mono text-xs font-semibold bg-gray-100 text-gray-700 px-2 py-0.5 rounded-lg border border-gray-200 group-hover:border-gray-300 transition-colors">
                              {del.invoice_no}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <Building2 className="w-3.5 h-3.5 text-gray-400" />
                              <span className="text-xs font-medium text-slate-700">{del.supplier}</span>
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <span className="text-xs font-bold text-orange-700 bg-orange-50 border border-orange-100 px-2 py-1 rounded-lg">
                              {del.size}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <span className="font-bold text-slate-900">{del.full_quantity}</span>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <span className="font-medium text-gray-600 text-[11px]">{formatCurrency(del.unit_price)}</span>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <span className="font-bold text-slate-900 text-xs">{formatCurrency(del.total_cost)}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Close subtabs main view fragment when isFuelModalOpen is false */}
        </>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: OIL & LUBRICANT PURCHASE / INWARD STOCK MODAL */}
      {/* ========================================================================= */}
      {isLubeModalOpen && (
        <div id="lube-delivery-modal-overlay" className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-fade-in">
          <div id="lube-delivery-modal-card" className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
              <h3 className="font-bold text-[#1C1C1C] text-lg flex items-center gap-2">
                <Droplets className="w-5 h-5 text-emerald-600" />
                <span>Receive Oil / Lubricant Inward Stock</span>
              </h3>
              <button onClick={() => setIsLubeModalOpen(false)} className="text-gray-500 hover:text-[#1C1C1C] cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {lubeModalError && (
                <div className="p-3 bg-red-500/10 text-red-600 rounded-xl text-xs flex items-start gap-2 border border-red-500/20">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <span>{lubeModalError}</span>
                </div>
              )}

              {/* Purchase Type Selector */}
              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1.5">
                  Lubricant Category / Product Type
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => handleSwitchLubeType('packaged')}
                    className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                      lubePurchaseType === 'packaged'
                        ? 'bg-emerald-50 border-emerald-500 text-emerald-800'
                        : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    <Package className="w-3.5 h-3.5" />
                    <span>Packaged Bottles &amp; Cans</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSwitchLubeType('bulk')}
                    className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                      lubePurchaseType === 'bulk'
                        ? 'bg-blue-50 border-blue-500 text-blue-800'
                        : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    <Droplets className="w-3.5 h-3.5" />
                    <span>Bulk Oil Tank Refill</span>
                  </button>
                </div>
              </div>

              {/* Item Selector (If packaged) */}
              {lubePurchaseType === 'packaged' ? (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                      Select Packaged Lubricant Product
                    </label>
                    <span className="text-[11px] text-gray-400">
                      {packagedItems.length} Products in Catalog
                    </span>
                  </div>
                  {packagedItems.length === 0 ? (
                    <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-900">
                      No packaged lubricants found in catalog.
                    </div>
                  ) : (
                    <select
                      id="select-packaged-lube-product"
                      value={selectedPackagedItemId}
                      onChange={(e) => {
                        setSelectedPackagedItemId(e.target.value);
                        const it = packagedItems.find(p => p.id === e.target.value);
                        if (it && it.unitCost) {
                          setLubeUnitCost(it.unitCost);
                        }
                      }}
                      className="w-full px-3.5 py-2.5 bg-white border border-gray-200 rounded-xl text-slate-900 text-xs font-semibold focus:outline-none focus:border-blue-500 cursor-pointer"
                    >
                      {packagedItems.map(item => (
                        <option key={item.id} value={item.id}>
                          {item.name} — {item.grade} • {item.packageSize} | In Stock: {item.currentStock} units
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              ) : (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                      Select Target Bulk Oil Tank / Barrel
                    </label>
                    <span className="text-[11px] text-gray-400">
                      {oilTanks.length} Tanks / Drums Available
                    </span>
                  </div>
                  {oilTanks.length === 0 ? (
                    <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-900">
                      No bulk oil tanks configured yet.
                    </div>
                  ) : (
                    <select
                      id="select-bulk-oil-tank-target"
                      value={lubeTargetOilTankId}
                      onChange={(e) => {
                        setLubeTargetOilTankId(e.target.value);
                        const tank = oilTanks.find(t => t.id === e.target.value);
                        if (tank && tank.pricePerLiter) {
                          setLubeUnitCost(tank.pricePerLiter);
                        }
                      }}
                      className="w-full px-3.5 py-2.5 bg-white border border-gray-200 rounded-xl text-slate-900 text-xs font-semibold focus:outline-none focus:border-blue-500 cursor-pointer"
                    >
                      {oilTanks.map(tank => (
                        <option key={tank.id} value={tank.id}>
                          {tank.name} ({tank.grade}) — Stock: {tank.currentLevel} / {tank.capacity} L (Free: {Math.max(0, tank.capacity - tank.currentLevel)} L)
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {/* Quantity & Unit Cost Grid */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1.5">
                    {lubePurchaseType === 'packaged' ? 'Quantity (Units)' : 'Volume (Liters)'}
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    placeholder="e.g. 24"
                    value={lubeQuantity}
                    onChange={(e) => setLubeQuantity(e.target.value === '' ? '' : parseFloat(e.target.value) || 0)}
                    className="w-full px-3.5 py-2.5 bg-white border border-gray-200 rounded-xl text-slate-900 text-sm font-bold focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1.5">
                    Unit Cost (Rs.)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="e.g. 1950"
                    value={lubeUnitCost}
                    onChange={(e) => setLubeUnitCost(e.target.value === '' ? '' : parseFloat(e.target.value) || 0)}
                    className="w-full px-3.5 py-2.5 bg-white border border-gray-200 rounded-xl text-slate-900 text-sm font-bold focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Supplier & Invoice */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1.5">
                    Supplier
                  </label>
                  <input
                    type="text"
                    value={lubeSupplier}
                    onChange={(e) => setLubeSupplier(e.target.value)}
                    placeholder="e.g. Chevron Lanka"
                    className="w-full px-3.5 py-2.5 bg-white border border-gray-200 rounded-xl text-slate-900 text-xs focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1.5">
                    Invoice / Ref No
                  </label>
                  <input
                    type="text"
                    value={lubeInvoiceNo}
                    onChange={(e) => setLubeInvoiceNo(e.target.value)}
                    placeholder="e.g. INV-CHEV-9901"
                    className="w-full px-3.5 py-2.5 bg-white border border-gray-200 rounded-xl text-slate-900 text-xs focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Date & Received By */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1.5">
                    Inward Date
                  </label>
                  <input
                    type="date"
                    value={lubeDeliveryDate}
                    onChange={(e) => setLubeDeliveryDate(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-white border border-gray-200 rounded-xl text-slate-900 text-xs focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1.5">
                    Received By
                  </label>
                  <input
                    type="text"
                    value={lubeReceivedBy}
                    onChange={(e) => setLubeReceivedBy(e.target.value)}
                    placeholder="Supervisor Name"
                    className="w-full px-3.5 py-2.5 bg-white border border-gray-200 rounded-xl text-slate-900 text-xs focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Calculated Total Cost Preview */}
              {lubeQuantity && lubeUnitCost ? (
                <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200/60 flex items-center justify-between">
                  <span className="text-xs font-bold text-emerald-900">Total Purchase Amount:</span>
                  <span className="text-sm font-extrabold text-emerald-800 tabular-nums">
                    {formatCurrency(Number(lubeQuantity) * Number(lubeUnitCost))}
                  </span>
                </div>
              ) : null}
            </div>

            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-end gap-3">
              <button
                onClick={() => setIsLubeModalOpen(false)}
                className="px-4 py-2 bg-transparent border border-gray-200 text-gray-600 font-medium text-xs rounded-lg hover:bg-gray-100 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleAddLubePurchaseSubmit}
                className="px-5 py-2 bg-emerald-600 text-white font-bold text-xs rounded-lg hover:bg-emerald-700 transition-all cursor-pointer shadow-sm"
              >
                Confirm Inward Stock
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: PRINTABLE PURCHASE INVOICE / PURCHASE RECEIPT MODAL */}
      {/* ========================================================================= */}
      {isReceiptModalOpen && selectedReceiptPurchase && (
        <div 
          id="purchase-invoice-modal-overlay" 
          className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-3 sm:p-4 overflow-y-auto animate-fade-in print:p-0 print:bg-transparent print:backdrop-blur-none print:static print:inset-auto"
        >
          <div 
            id="purchase-invoice-modal-card" 
            className="bg-white rounded-2xl max-w-[900px] w-full shadow-2xl border border-gray-200 overflow-hidden my-auto print:border-none print:shadow-none print:max-w-none print:w-full print:rounded-none print:bg-transparent print:m-0"
          >
            {/* Modal Top Control Bar (Hidden when printing) */}
            <div className="px-6 py-3.5 bg-slate-900 text-white flex items-center justify-between print:hidden">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-blue-400" />
                <span className="font-bold text-xs uppercase tracking-wider text-slate-200">
                  {receiptConfig.documentTitle} Preview
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-blue-300 font-bold">
                  {selectedReceiptPurchase.invoiceNo}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  id="btn-print-receipt-modal"
                  onClick={handlePrintReceipt}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 text-white rounded-lg text-xs font-bold transition-all cursor-pointer shadow-xs hover:opacity-90"
                  style={{ backgroundColor: receiptConfig.primaryBrandColor }}
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print Receipt</span>
                </button>
                <button
                  onClick={() => setIsReceiptModalOpen(false)}
                  className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Printable Document Sheet (900px format) */}
            <div 
              id="printable-purchase-receipt"
              ref={receiptPrintRef}
              className="p-6 sm:p-10 bg-white text-slate-900 space-y-6 font-sans print:p-0 print:m-0"
              style={{ minHeight: '600px' }}
            >
              {/* 1. Exact Header & Branding Styling */}
              <div className="pb-4" style={{ borderBottom: `3px solid ${receiptConfig.primaryBrandColor}` }}>
                <div className="flex flex-col sm:flex-row items-start justify-between gap-4">
                  {/* Left: Company Branding */}
                  <div className="space-y-1">
                    <div className="flex items-center gap-2.5">
                      {receiptConfig.logoUrl ? (
                        <img 
                          src={receiptConfig.logoUrl} 
                          alt="Logo" 
                          className="w-10 h-10 object-contain rounded-lg shadow-2xs"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div 
                          className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-black text-base shadow-xs"
                          style={{ backgroundColor: receiptConfig.primaryBrandColor }}
                        >
                          {receiptConfig.companyName.substring(0, 2).toUpperCase()}
                        </div>
                      )}
                      <div>
                        <h1 
                          className="text-xl sm:text-2xl font-black tracking-tight uppercase" 
                          style={{ color: receiptConfig.primaryBrandColor }}
                        >
                          {receiptConfig.companyName}
                        </h1>
                        <p className="text-xs font-medium italic text-slate-600">
                          {receiptConfig.tagline}
                        </p>
                      </div>
                    </div>
                    <div className="text-[11px] text-slate-600 pt-1 space-y-0.5">
                      <p>{receiptConfig.address}</p>
                      <p className="text-slate-500">
                        Tel: {receiptConfig.contactPhone} | Email: {receiptConfig.email}
                      </p>
                      <p className="text-[10px] text-slate-400 ">
                        CPC Dealer Code: {receiptConfig.dealerCode} • Business Reg: {receiptConfig.regNo}
                      </p>
                    </div>
                  </div>

                  {/* Right: Title & Receipt Meta */}
                  <div className="sm:text-right space-y-1">
                    <h2 
                      className="text-2xl font-black tracking-wider uppercase font-sans" 
                      style={{ color: receiptConfig.primaryBrandColor }}
                    >
                      {receiptConfig.documentTitle}
                    </h2>
                    <div className="text-xs font-bold">
                      <span className="text-slate-500 font-normal">Receipt No: </span>
                      <span style={{ color: receiptConfig.accentColor }} className="font-extrabold text-sm">
                        {selectedReceiptPurchase.invoiceNo.startsWith(receiptConfig.receiptNoPrefix) 
                          ? selectedReceiptPurchase.invoiceNo 
                          : `${receiptConfig.receiptNoPrefix}${selectedReceiptPurchase.invoiceNo.replace(/[^a-zA-Z0-9-]/g, '')}`}
                      </span>
                    </div>
                    <div className="text-xs text-slate-600">
                      <span className="text-slate-500 font-normal">Date &amp; Time: </span>
                      <span className="font-bold text-slate-800">{selectedReceiptPurchase.date} • 10:30 AM</span>
                    </div>
                    <div className="text-[11px] text-slate-500">
                      <span className="text-slate-400">Payment Terms: </span>
                      <span className="font-semibold text-slate-700">Bank Transfer / Advance</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 2. Dual Info Boxes Grid (info-grid) */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Box 1: SUPPLIER DETAILS */}
                <div className="rounded-xl border border-slate-200 overflow-hidden shadow-xs">
                  <div 
                    className="px-3.5 py-2 text-white font-bold text-xs uppercase tracking-wider flex items-center justify-between"
                    style={{ backgroundColor: receiptConfig.primaryBrandColor }}
                  >
                    <span>SUPPLIER DETAILS</span>
                    <Building2 className="w-3.5 h-3.5 opacity-80" />
                  </div>
                  <div className="p-3.5 bg-slate-50/60 text-xs space-y-1.5 text-slate-700">
                    <div className="flex items-start justify-between">
                      <span className="text-slate-500 font-medium">Supplier Name:</span>
                      <span className="font-bold text-slate-900 text-right">{selectedReceiptPurchase.supplier}</span>
                    </div>
                    <div className="flex items-start justify-between">
                      <span className="text-slate-500 font-medium">Terminal / Address:</span>
                      <span className="font-medium text-slate-800 text-right">
                        {selectedReceiptPurchase.supplier.toLowerCase().includes('petroleum') 
                          ? 'Kolonnawa Terminal, CPSTL Installation, Colombo' 
                          : 'Industrial Zone, Retail Oil Depot, Colombo'}
                      </span>
                    </div>
                    <div className="flex items-start justify-between">
                      <span className="text-slate-500 font-medium">Contact No:</span>
                      <span className="text-slate-800 text-right">+94 11 257 2000 / +94 11 257 2001</span>
                    </div>
                  </div>
                </div>

                {/* Box 2: PURCHASE DETAILS */}
                <div className="rounded-xl border border-slate-200 overflow-hidden shadow-xs">
                  <div 
                    className="px-3.5 py-2 text-white font-bold text-xs uppercase tracking-wider flex items-center justify-between"
                    style={{ backgroundColor: receiptConfig.primaryBrandColor }}
                  >
                    <span>PURCHASE DETAILS</span>
                    <Truck className="w-3.5 h-3.5 opacity-80" />
                  </div>
                  <div className="p-3.5 bg-slate-50/60 text-xs space-y-1.5 text-slate-700">
                    <div className="flex items-start justify-between">
                      <span className="text-slate-500 font-medium">Purchase Type:</span>
                      <span className="font-bold text-slate-900 text-right">{selectedReceiptPurchase.category}</span>
                    </div>
                    <div className="flex items-start justify-between">
                      <span className="text-slate-500 font-medium">Reference / Invoice:</span>
                      <span className="font-bold text-slate-900 text-right">{selectedReceiptPurchase.invoiceNo}</span>
                    </div>
                    <div className="flex items-start justify-between">
                      <span className="text-slate-500 font-medium">Delivery Note No:</span>
                      <span className="text-slate-800 text-right">
                        DN-{selectedReceiptPurchase.id.replace(/[^0-9]/g, '') || '884920'}
                      </span>
                    </div>
                    <div className="flex items-start justify-between">
                      <span className="text-slate-500 font-medium">Vehicle / Truck No:</span>
                      <span className="font-bold text-slate-900 text-right">
                        {selectedReceiptPurchase.rawType === 'fuel' ? 'WP-LI-8492 (Bowser Tanker)' : 'WP-NB-3391 (Delivery Van)'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 3. Items Table (purchase-table) */}
              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-xs">
                <table className="w-full text-left text-xs">
                  <thead 
                    className="text-white font-bold uppercase text-[10px] tracking-wider"
                    style={{ backgroundColor: receiptConfig.primaryBrandColor }}
                  >
                    <tr>
                      <th className="py-2.5 px-3.5 text-center w-10">#</th>
                      <th className="py-2.5 px-3.5">Item Description</th>
                      <th className="py-2.5 px-3.5 text-center">Unit</th>
                      <th className="py-2.5 px-3.5 text-right">Quantity</th>
                      <th className="py-2.5 px-3.5 text-right">Unit Price (LKR)</th>
                      <th className="py-2.5 px-3.5 text-right">Total (LKR)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-800 bg-white">
                    <tr>
                      <td className="py-3 px-3.5 text-center text-slate-500 font-bold">1</td>
                      <td className="py-3 px-3.5">
                        <div className="font-bold text-slate-900">{selectedReceiptPurchase.description}</div>
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          Destination: <span className="font-semibold text-slate-700">{selectedReceiptPurchase.destination}</span>
                        </div>
                      </td>
                      <td className="py-3 px-3.5 text-center font-medium text-slate-600">
                        {selectedReceiptPurchase.unitLabel}
                      </td>
                      <td className="py-3 px-3.5 text-right font-bold tabular-nums text-slate-900">
                        {selectedReceiptPurchase.quantity.toLocaleString()}
                      </td>
                      <td className="py-3 px-3.5 text-right tabular-nums text-slate-700">
                        {formatCurrency(selectedReceiptPurchase.unitPrice)}
                      </td>
                      <td className="py-3 px-3.5 text-right font-extrabold tabular-nums text-slate-900">
                        {formatCurrency(selectedReceiptPurchase.totalAmount)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* 4. Bottom Section & Calculations */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                {/* Left: REMARKS box with border #d8dee8 */}
                <div 
                  className="rounded-xl p-3.5 bg-slate-50/70 text-xs space-y-1.5"
                  style={{ border: '1px solid #d8dee8' }}
                >
                  <div className="font-bold text-slate-800 uppercase tracking-wider text-[10px] flex items-center gap-1.5">
                    <Info className="w-3.5 h-3.5 text-blue-600" />
                    <span>REMARKS &amp; VERIFICATION NOTES</span>
                  </div>
                  <p className="text-slate-600 text-[11px] leading-relaxed">
                    {receiptConfig.defaultRemarks}
                  </p>
                  <div className="text-[10px] text-slate-500 pt-1 border-t border-slate-200 flex items-center justify-between">
                    <span>Decanting Bay: Pump Island #1</span>
                    <span>Density: 0.832 @ 15°C</span>
                  </div>
                </div>

                {/* Right: Totals Card */}
                <div className="rounded-xl border border-slate-200 overflow-hidden shadow-xs text-xs">
                  <div className="p-3 bg-slate-50 space-y-1.5 ">
                    <div className="flex items-center justify-between text-slate-600">
                      <span>Sub Total:</span>
                      <span className="font-bold tabular-nums text-slate-900">
                        {formatCurrency(selectedReceiptPurchase.totalAmount)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-slate-500 text-[11px]">
                      <span>Discount (0.0%):</span>
                      <span className="tabular-nums">Rs. 0.00</span>
                    </div>
                    <div className="flex items-center justify-between text-slate-500 text-[11px]">
                      <span>VAT / Taxes (Included):</span>
                      <span className="tabular-nums">Rs. 0.00</span>
                    </div>
                  </div>

                  {/* Solid Grand Total banner */}
                  <div 
                    className="p-3.5 text-white flex items-center justify-between"
                    style={{ backgroundColor: receiptConfig.primaryBrandColor }}
                  >
                    <span className="font-extrabold uppercase tracking-wider text-xs">
                      GRAND TOTAL (LKR):
                    </span>
                    <span className="font-black text-base sm:text-lg tabular-nums">
                      {formatCurrency(selectedReceiptPurchase.totalAmount)}
                    </span>
                  </div>
                </div>
              </div>

              {/* 5. Signatures Section */}
              <div className="pt-6 border-t border-dashed border-slate-300">
                <div className="grid grid-cols-3 gap-6 text-center text-xs">
                  {/* Prepared By */}
                  <div className="space-y-6">
                    <div className="h-10 border-b border-slate-400 flex items-end justify-center pb-1">
                      <span className="text-[10px] text-slate-400 italic ">
                        {selectedReceiptPurchase.receivedBy || 'Station Staff'}
                      </span>
                    </div>
                    <div>
                      <p className="font-bold text-slate-800 text-[11px]">{receiptConfig.signatureLine1Title}</p>
                      <p className="text-[10px] text-slate-500">{receiptConfig.signatureLine1Sub}</p>
                    </div>
                  </div>

                  {/* Received By */}
                  <div className="space-y-6">
                    <div className="h-10 border-b border-slate-400 flex items-end justify-center pb-1">
                      <span className="text-[10px] text-slate-400 italic ">CPC Bowser Driver</span>
                    </div>
                    <div>
                      <p className="font-bold text-slate-800 text-[11px]">{receiptConfig.signatureLine2Title}</p>
                      <p className="text-[10px] text-slate-500">{receiptConfig.signatureLine2Sub}</p>
                    </div>
                  </div>

                  {/* Authorized By */}
                  <div className="space-y-6">
                    <div className="h-10 border-b border-slate-400 flex items-end justify-center pb-1">
                      <span className="text-[10px] text-slate-400 italic ">Station Manager</span>
                    </div>
                    <div>
                      <p className="font-bold text-slate-800 text-[11px]">{receiptConfig.signatureLine3Title}</p>
                      <p className="text-[10px] text-slate-500">{receiptConfig.signatureLine3Sub}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* 6. Footer */}
              <div 
                className="pt-3 text-center text-[10px] text-slate-500 font-sans"
                style={{ borderTop: `1px solid ${receiptConfig.primaryBrandColor}` }}
              >
                <p className="font-medium text-slate-600">
                  {receiptConfig.footerNote}
                </p>
                <p className="text-[9px] text-slate-400 mt-0.5 ">
                  {receiptConfig.footerDisclaimer}
                </p>
              </div>
            </div>

            {/* Modal Bottom Footer (Hidden when printing) */}
            <div className="px-6 py-3.5 bg-gray-50 border-t border-gray-100 flex items-center justify-between print:hidden">
              <span className="text-xs text-gray-500">
                Click <span className="font-semibold text-slate-700">Print Receipt</span> to print or save as PDF.
              </span>
              <button
                onClick={() => setIsReceiptModalOpen(false)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs rounded-xl transition-all cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: LP GAS PURCHASE MODAL */}
      {/* ========================================================================= */}
      {isLPGasModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gradient-to-r from-orange-50 to-white">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-orange-100 text-orange-600 rounded-xl">
                  <Flame className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-800">Add LP Gas Delivery</h2>
                  <p className="text-xs text-gray-500 font-medium">Log new Litro Gas cylinders purchase</p>
                </div>
              </div>
              <button 
                onClick={() => setIsLPGasModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 p-2 rounded-xl hover:bg-gray-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-5">
              {lpGasModalError && (
                <div className="p-3 bg-red-50 border border-red-100 text-red-700 text-xs font-semibold rounded-xl flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  {lpGasModalError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-wide">
                    Delivery Date
                  </label>
                  <div className="relative">
                    <Calendar className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input 
                      type="date"
                      value={lpGasForm.date}
                      onChange={e => setLPGasForm({...lpGasForm, date: e.target.value})}
                      max={new Date().toISOString().split('T')[0]}
                      className="w-full pl-9 pr-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-wide">
                    Supplier
                  </label>
                  <div className="relative">
                    <Building2 className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input 
                      type="text"
                      value={lpGasForm.supplier}
                      onChange={e => setLPGasForm({...lpGasForm, supplier: e.target.value})}
                      className="w-full pl-9 pr-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all outline-none"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-wide">
                  Invoice / Reference No.
                </label>
                <div className="relative">
                  <FileText className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input 
                    type="text"
                    value={lpGasForm.invoiceNo}
                    onChange={e => setLPGasForm({...lpGasForm, invoiceNo: e.target.value})}
                    placeholder="Enter invoice or delivery note number"
                    className="w-full pl-9 pr-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-wide">
                  Cylinder Size
                </label>
                <select
                  value={lpGasForm.size}
                  onChange={e => setLPGasForm({...lpGasForm, size: e.target.value})}
                  className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all outline-none"
                >
                  <option value="12.5 kg">12.5 kg (Standard Household)</option>
                  <option value="37.5 kg">37.5 kg (Commercial Industrial)</option>
                  <option value="5.0 kg">5.0 kg (Buddy)</option>
                  <option value="2.3 kg">2.3 kg (Portable)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-wide">
                  Full Cylinders Received (Quantity)
                </label>
                <input 
                  type="number"
                  min="1"
                  value={lpGasForm.fullQuantity}
                  onChange={e => setLPGasForm({...lpGasForm, fullQuantity: e.target.value})}
                  placeholder="E.g., 50"
                  className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-wide">
                  Wholesale Unit Rate (Rs.)
                </label>
                <div className="relative">
                  <span className="text-gray-500 font-bold text-sm absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">Rs.</span>
                  <input 
                    type="number"
                    min="0"
                    step="0.01"
                    value={lpGasForm.unitPrice}
                    onChange={e => setLPGasForm({...lpGasForm, unitPrice: e.target.value})}
                    placeholder="Price per cylinder"
                    className="w-full pl-10 pr-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-blue-700 focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all outline-none"
                  />
                </div>
              </div>
              
              {(lpGasForm.fullQuantity && lpGasForm.unitPrice) ? (
                <div className="p-4 bg-orange-50 border border-orange-100 rounded-xl flex items-center justify-between mt-2">
                  <span className="text-xs font-bold text-orange-800">Total Purchase Value</span>
                  <span className="text-lg font-black text-orange-700">
                    {formatCurrency(parseInt(lpGasForm.fullQuantity) * parseFloat(lpGasForm.unitPrice))}
                  </span>
                </div>
              ) : null}
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-3 bg-gray-50/50">
              <button 
                onClick={() => setIsLPGasModalOpen(false)}
                className="px-4 py-2.5 bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 font-bold text-xs rounded-xl transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button 
                onClick={handleSaveLPGasPurchase}
                className="px-6 py-2.5 bg-orange-600 hover:bg-orange-700 text-white font-bold text-xs rounded-xl transition-all shadow-md shadow-orange-500/20 cursor-pointer flex items-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4" />
                Confirm & Log Purchase
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
