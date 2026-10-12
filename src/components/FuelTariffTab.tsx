import React, { useState, useEffect, useMemo } from 'react';
import { FuelTank, FuelType, PriceSchedule, AuthUser, LPGasItem } from '../types';
import { Calendar, Trash2, Clock, Tag, Edit2, Save, X, CheckCircle2, Flame, RefreshCw, AlertCircle } from 'lucide-react';
import { supabase, getTanksTableName } from '../lib/supabase';
import { isAdmin } from '../lib/auth';

export interface FuelTariffTabProps {
  tanks: FuelTank[];
  setTanks: React.Dispatch<React.SetStateAction<FuelTank[]>>;
  priceSchedules: PriceSchedule[];
  setPriceSchedules: React.Dispatch<React.SetStateAction<PriceSchedule[]>>;
  gasStock?: LPGasItem[];
  onUpdateGasStock?: (items: LPGasItem[]) => void;
  user?: AuthUser | null;
  userRole?: string;
  onSubTabChange?: (sub: string) => void;
}

export default function FuelTariffTab({
  tanks,
  setTanks,
  priceSchedules,
  setPriceSchedules,
  gasStock,
  onUpdateGasStock,
  user,
  userRole,
  onSubTabChange
}: FuelTariffTabProps) {
  const [editingTankId, setEditingTankId] = useState<string | null>(null);
  const [tempPrice, setTempPrice] = useState<number>(0);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isRefreshingGas, setIsRefreshingGas] = useState<boolean>(false);
  const [isSavingGas, setIsSavingGas] = useState<boolean>(false);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // -------------------------------------------------------------
  // D1) LP GAS TARIFF STATE - DYNAMIC FETCHING FROM SUPABASE
  // -------------------------------------------------------------
  const [gasPrices, setGasPrices] = useState<{ [key: string]: number }>(() => {
    try {
      const storedPrices = localStorage.getItem('fuel_flow_gas_prices');
      if (storedPrices) return JSON.parse(storedPrices);
      const storedInv = localStorage.getItem('fuel_flow_gas_stock') || localStorage.getItem('fuel_flow_gas_inventory');
      if (storedInv) {
        const parsed = JSON.parse(storedInv);
        if (Array.isArray(parsed)) {
          const pMap: { [key: string]: number } = {};
          parsed.forEach((item: any) => {
            if (item.size === '12.5 kg' || item.id === 'gas-12.5kg') pMap['12.5kg'] = item.selling_price || item.unit_price || 3690;
            if (item.size === '5.0 kg' || item.id === 'gas-5.0kg' || item.id === 'gas-5kg') pMap['5kg'] = item.selling_price || item.unit_price || 1482;
            if (item.size === '2.3 kg' || item.id === 'gas-2.3kg') pMap['2.3kg'] = item.selling_price || item.unit_price || 694;
            if (item.size === '37.5 kg' || item.id === 'gas-37.5kg') pMap['37.5kg'] = item.selling_price || item.unit_price || 11200;
          });
          return {
            '12.5kg': pMap['12.5kg'] || 3690,
            '5kg': pMap['5kg'] || 1482,
            '2.3kg': pMap['2.3kg'] || 694,
            '37.5kg': pMap['37.5kg'] || 11200
          };
        }
      }
    } catch (_) {}
    return {
      '12.5kg': 3690,
      '5kg': 1482,
      '2.3kg': 694,
      '37.5kg': 11200
    };
  });

  // Dynamic fetch function that pulls directly from Supabase gas_inventory table
  const fetchLatestGasPricesFromDb = async () => {
    try {
      setIsRefreshingGas(true);
      const { data, error } = await supabase.from('gas_inventory').select('*');
      if (!error && data && data.length > 0) {
        const pMap: { [key: string]: number } = { ...gasPrices };
        let foundAny = false;

        data.forEach((row: any) => {
          const rawPrice = row.selling_price ?? row.unit_price ?? row.price;
          const price = Number(rawPrice) || 0;
          if (price > 0) {
            const id = String(row.id || '').toLowerCase();
            const size = String(row.size || '').toLowerCase();

            if (id.includes('12.5') || size.includes('12.5')) {
              pMap['12.5kg'] = price;
              foundAny = true;
            } else if (id.includes('37.5') || size.includes('37.5')) {
              pMap['37.5kg'] = price;
              foundAny = true;
            } else if (id.includes('5.0') || id.includes('5kg') || size.includes('5.0') || size.includes('5kg')) {
              pMap['5kg'] = price;
              foundAny = true;
            } else if (id.includes('2.3') || size.includes('2.3')) {
              pMap['2.3kg'] = price;
              foundAny = true;
            }
          }
        });

        if (foundAny) {
          setGasPrices(prev => ({ ...prev, ...pMap }));
          localStorage.setItem('fuel_flow_gas_prices', JSON.stringify(pMap));
          window.dispatchEvent(new CustomEvent('gas-prices-updated', {
            detail: { updatedPrices: pMap }
          }));
        }
      }
    } catch (err) {
      console.warn('Error fetching gas_inventory prices:', err);
    } finally {
      setIsRefreshingGas(false);
    }
  };

  // Mount, focus and realtime sync
  useEffect(() => {
    fetchLatestGasPricesFromDb();

    const handleWindowFocus = () => {
      fetchLatestGasPricesFromDb();
    };

    const handleGasPricesUpdated = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail?.updatedPrices) {
        setGasPrices(prev => ({ ...prev, ...customEvent.detail.updatedPrices }));
      }
    };

    window.addEventListener('focus', handleWindowFocus);
    window.addEventListener('gas-prices-updated', handleGasPricesUpdated);
    window.addEventListener('gas-inventory-updated', handleWindowFocus);

    // Subscribe to realtime database events on gas_inventory
    const channel = supabase
      .channel('fuel-tariff-gas-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gas_inventory' }, () => {
        fetchLatestGasPricesFromDb();
      })
      .subscribe();

    return () => {
      window.removeEventListener('focus', handleWindowFocus);
      window.removeEventListener('gas-prices-updated', handleGasPricesUpdated);
      window.removeEventListener('gas-inventory-updated', handleWindowFocus);
      supabase.removeChannel(channel);
    };
  }, []);

  // Save updated gas prices directly to Supabase gas_inventory and local caches
  const handleUpdateGasPrices = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingGas(true);

    try {
      localStorage.setItem('fuel_flow_gas_prices', JSON.stringify(gasPrices));

      // Update gas_inventory in Supabase
      const targetSizes = [
        { id: 'gas-12.5kg', size: '12.5 kg', price: gasPrices['12.5kg'] || 3690 },
        { id: 'gas-37.5kg', size: '37.5 kg', price: gasPrices['37.5kg'] || 11200 },
        { id: 'gas-5.0kg', size: '5.0 kg', price: gasPrices['5kg'] || 1482 },
        { id: 'gas-2.3kg', size: '2.3 kg', price: gasPrices['2.3kg'] || 694 }
      ];

      const { data: existingGasRows } = await supabase.from('gas_inventory').select('*');
      const existingMap = new Map((existingGasRows || []).map((r: any) => [r.id || r.size, r]));

      const upsertPayload = targetSizes.map(item => {
        const existing = existingMap.get(item.id) || existingMap.get(item.size);
        return {
          id: item.id,
          size: item.size,
          full_count: existing?.full_count ?? 0,
          empty_count: existing?.empty_count ?? 0,
          selling_price: item.price,
          unit_price: item.price,
          price: item.price,
          last_updated: new Date().toISOString()
        };
      });

      const { error: upsertErr } = await supabase.from('gas_inventory').upsert(upsertPayload, { onConflict: 'id' });
      if (upsertErr) {
        // Fallback row-by-row update
        for (const item of targetSizes) {
          await supabase
            .from('gas_inventory')
            .update({ selling_price: item.price, unit_price: item.price, last_updated: new Date().toISOString() })
            .or(`id.eq.${item.id},size.eq.${item.size}`);
        }
      }

      // Update local storage gas inventory lists
      const gasKey = 'fuelflow_lpgas_inventory';
      const storedGas = localStorage.getItem(gasKey) || localStorage.getItem('fuel_flow_gas_stock') || localStorage.getItem('fuel_flow_gas_inventory');
      let currentGasList: any[] = [];
      if (storedGas) {
        try {
          currentGasList = JSON.parse(storedGas);
        } catch (_) {}
      }

      if (Array.isArray(currentGasList) && currentGasList.length > 0) {
        currentGasList = currentGasList.map((item: any) => {
          if (item.size === '12.5 kg' || item.id === 'gas-12.5kg') {
            return { ...item, selling_price: gasPrices['12.5kg'], unit_price: gasPrices['12.5kg'], last_updated: new Date().toISOString() };
          }
          if (item.size === '5.0 kg' || item.id === 'gas-5.0kg' || item.id === 'gas-5kg') {
            return { ...item, selling_price: gasPrices['5kg'], unit_price: gasPrices['5kg'], last_updated: new Date().toISOString() };
          }
          if (item.size === '2.3 kg' || item.id === 'gas-2.3kg') {
            return { ...item, selling_price: gasPrices['2.3kg'], unit_price: gasPrices['2.3kg'], last_updated: new Date().toISOString() };
          }
          if (item.size === '37.5 kg' || item.id === 'gas-37.5kg') {
            return { ...item, selling_price: gasPrices['37.5kg'], unit_price: gasPrices['37.5kg'], last_updated: new Date().toISOString() };
          }
          return item;
        });
      } else {
        currentGasList = upsertPayload;
      }

      localStorage.setItem('fuelflow_lpgas_inventory', JSON.stringify(currentGasList));
      localStorage.setItem('fuel_flow_gas_stock', JSON.stringify(currentGasList));
      localStorage.setItem('fuel_flow_gas_inventory', JSON.stringify(currentGasList));

      if (onUpdateGasStock) {
        onUpdateGasStock(currentGasList);
      }

      // Broadcast events
      window.dispatchEvent(new CustomEvent('gas-prices-updated', {
        detail: { updatedPrices: gasPrices, updatedInventory: currentGasList }
      }));
      window.dispatchEvent(new CustomEvent('gas-inventory-updated', {
        detail: { updatedInventory: currentGasList }
      }));

      showToast('✓ LP Gas selling prices saved & synced to Supabase gas_inventory successfully!');
    } catch (err: any) {
      console.warn('Error updating gas prices:', err);
      showToast(`Warning: Prices saved locally. Database notice: ${err?.message || err}`);
    } finally {
      setIsSavingGas(false);
    }
  };

  // -------------------------------------------------------------
  // D2) LIQUID FUEL RETAIL TARIFF MANAGEMENT
  // -------------------------------------------------------------
  const [schedFuelType, setSchedFuelType] = useState<FuelType>('Petrol 92');
  const [schedPrice, setSchedPrice] = useState<number>(0);
  const [schedDate, setSchedDate] = useState<string>('');

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

    setPriceSchedules(prev => [...prev, newSchedule]);

    try {
      await supabase.from('price_schedules').insert([{
        id: newSchedule.id,
        fueltype: newSchedule.fuelType,
        newprice: newSchedule.newPrice,
        effectivedate: newSchedule.effectiveDate,
        status: newSchedule.status
      }]);
    } catch (err) {
      console.warn('Supabase price schedule insert warning:', err);
    }

    setSchedPrice(0);
    setSchedDate('');
    showToast(`Price schedule logged for ${newSchedule.fuelType} effective ${new Date(schedDate).toLocaleString()}.`);
  };

  const handleCancelSchedule = async (id: string) => {
    if (!window.confirm('Are you sure you want to cancel this price schedule?')) return;
    try {
      await supabase.from('price_schedules').delete().eq('id', id);
    } catch (err) {
      console.warn('Schedule delete error:', err);
    }
    const updated = priceSchedules.filter(s => s.id !== id);
    setPriceSchedules(updated);
    try {
      localStorage.setItem('fms_priceSchedules', JSON.stringify(updated));
    } catch (_) {}
    showToast('Pending price schedule cancelled.');
  };

  const handleStartEdit = (tank: FuelTank) => {
    setEditingTankId(tank.id);
    setTempPrice(tank.pricePerLiter);
  };

  const handleSaveEdit = async (tankId: string) => {
    if (tempPrice <= 0) return;
    const updated = tanks.map(t => {
      if (t.id === tankId) {
        return {
          ...t,
          pricePerLiter: tempPrice
        };
      }
      return t;
    });
    setTanks(updated);
    setEditingTankId(null);

    // Save to localStorage immediately
    try {
      localStorage.setItem('fms_tanks', JSON.stringify(updated));
      const priceMap: { [fuelType: string]: number } = {};
      updated.forEach(t => {
        if (t.fuelType) priceMap[t.fuelType] = t.pricePerLiter;
      });
      localStorage.setItem('fuel_flow_fuel_prices', JSON.stringify(priceMap));
    } catch (_) {}

    const targetTank = updated.find(t => t.id === tankId);
    if (targetTank) {
      let sbSuccess = false;
      let lastErrMsg = '';

      // 1. Direct update to fuel_tanks / fuel_tank
      try {
        const tableName = getTanksTableName();
        const { error: err1 } = await supabase.from(tableName).update({ priceperliter: tempPrice, price_per_liter: tempPrice }).eq('id', tankId);
        if (err1) {
          const { error: err2 } = await supabase.from(tableName).update({ priceperliter: tempPrice }).eq('id', tankId);
          if (err2) {
            const { error: err3 } = await supabase.from(tableName).update({ price_per_liter: tempPrice }).eq('id', tankId);
            if (!err3) sbSuccess = true;
            else lastErrMsg = err3.message || String(err3);
          } else {
            sbSuccess = true;
          }
        } else {
          sbSuccess = true;
        }
      } catch (err: any) {
        lastErrMsg = err?.message || String(err);
      }

      // 2. Direct update to underground_tanks
      try {
        await supabase.from('underground_tanks').update({ price_per_liter: tempPrice, priceperliter: tempPrice }).eq('id', tankId);
      } catch (_) {}

      // 3. Direct upsert to fuel_prices
      try {
        await supabase.from('fuel_prices').upsert([
          { id: tankId, fuel_type: targetTank.fuelType, price: tempPrice, price_per_liter: tempPrice, updated_at: new Date().toISOString() },
          { id: targetTank.fuelType, fuel_type: targetTank.fuelType, price: tempPrice, price_per_liter: tempPrice, updated_at: new Date().toISOString() }
        ]);
      } catch (_) {}

      // 4. Broadcast global events
      window.dispatchEvent(new CustomEvent('fuel-prices-updated', {
        detail: { updatedTanks: updated, fuelType: targetTank.fuelType, newPrice: tempPrice, tankId }
      }));
      window.dispatchEvent(new CustomEvent('tanks-updated', {
        detail: { tanks: updated }
      }));

      if (sbSuccess || !lastErrMsg) {
        showToast(`✓ Retail price for ${targetTank.name} (${targetTank.fuelType}) saved & synced to Rs. ${tempPrice.toFixed(2)}.`);
      } else {
        showToast(`Price updated locally. Database sync notice: ${lastErrMsg}`);
      }
    }
  };

  const handleCancelEdit = () => {
    setEditingTankId(null);
    setTempPrice(0);
  };

  const formatCurrency = (val: number) => {
    return `Rs. ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val)}`;
  };

  const sortedTanks = useMemo(() => {
    return [...tanks].sort((a, b) => (a.name || a.id || '').localeCompare(b.name || b.id || '', undefined, { numeric: true, sensitivity: 'base' }));
  }, [tanks]);

  return (
    <div id="fuel-tariff-root" className="space-y-6 w-full max-w-6xl mx-auto animate-fade-in pb-12">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#1C1C1C] text-white px-5 py-3 rounded-xl shadow-2xl flex items-center gap-3 border border-gray-700 animate-slide-up">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <span className="text-xs font-semibold">{toastMessage}</span>
        </div>
      )}

      {/* HEADER SECTION */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 bg-amber-500 text-white rounded-xl shadow-sm">
              <Tag className="w-5 h-5" />
            </div>
            <h1 className="text-xl font-black text-gray-900 tracking-tight">Fuel &amp; Gas Tariff Management</h1>
          </div>
          <p className="text-xs text-gray-500 font-medium mt-1">
            Configure dynamic selling prices for forecourt liquid fuels and Litro LP gas cylinders. All prices sync real-time to Supabase.
          </p>
        </div>

        <button
          type="button"
          onClick={fetchLatestGasPricesFromDb}
          disabled={isRefreshingGas}
          className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs rounded-xl transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingGas ? 'animate-spin text-amber-600' : ''}`} />
          <span>{isRefreshingGas ? 'Refreshing...' : 'Refresh Latest Prices'}</span>
        </button>
      </div>

      {/* SECTION 1: LP GAS TARIFF & CYLINDER PRICES */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 bg-orange-50/40 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-orange-100 text-orange-600 rounded-xl">
              <Flame className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-[#1C1C1C] text-xs uppercase tracking-wider">LP Gas Tariff &amp; Cylinder Prices</h3>
              <p className="text-[11px] text-gray-500 font-medium">
                Live unit selling prices for LP gas counter sales across active shifts
              </p>
            </div>
          </div>
          <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-orange-100 text-orange-800 border border-orange-200 uppercase tracking-wider">
            gas_inventory Synced
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
                      <span className="w-2.5 h-2.5 rounded-full bg-orange-500"></span>
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
                        className="w-36 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 tabular-nums font-bold text-xs text-right focus:bg-white focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                      />
                    </div>
                  </td>
                </tr>

                {/* 5.0 kg */}
                <tr className="hover:bg-gray-50/50 transition-colors">
                  <td className="py-3.5 px-6 font-bold text-gray-900">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
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
                        className="w-36 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 tabular-nums font-bold text-xs text-right focus:bg-white focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                      />
                    </div>
                  </td>
                </tr>

                {/* 2.3 kg */}
                <tr className="hover:bg-gray-50/50 transition-colors">
                  <td className="py-3.5 px-6 font-bold text-gray-900">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-yellow-500"></span>
                      <span>2.3 kg Cylinder</span>
                    </div>
                  </td>
                  <td className="py-3.5 px-6">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-yellow-50 text-yellow-800 border border-yellow-200">
                      Camping Cylinder
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
                        className="w-36 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 tabular-nums font-bold text-xs text-right focus:bg-white focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                      />
                    </div>
                  </td>
                </tr>

                {/* 37.5 kg */}
                <tr className="hover:bg-gray-50/50 transition-colors">
                  <td className="py-3.5 px-6 font-bold text-gray-900">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-red-500"></span>
                      <span>37.5 kg Cylinder</span>
                    </div>
                  </td>
                  <td className="py-3.5 px-6">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-red-50 text-red-800 border border-red-200">
                      Commercial / Industrial
                    </span>
                  </td>
                  <td className="py-3.5 px-6 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <span className="text-xs font-bold text-gray-400">Rs.</span>
                      <input
                        type="number"
                        step="1"
                        min="0"
                        value={gasPrices['37.5kg'] || ''}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => setGasPrices(prev => ({ ...prev, '37.5kg': parseFloat(e.target.value) || 0 }))}
                        className="w-36 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 tabular-nums font-bold text-xs text-right focus:bg-white focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                      />
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="px-6 py-4 bg-gray-50/50 border-t border-gray-100 flex items-center justify-between">
            <p className="text-[11px] text-gray-500">
              Changes reflect immediately across counter sales in active shifts and the LP Gas inventory tab.
            </p>
            <button
              type="submit"
              disabled={isSavingGas}
              className="flex items-center gap-2 px-5 py-2.5 bg-orange-600 hover:bg-orange-700 text-white font-bold text-xs rounded-xl shadow-sm transition-all disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{isSavingGas ? 'Saving to Database...' : 'Save Gas Tariff Rates'}</span>
            </button>
          </div>
        </form>
      </div>

      {/* SECTION 2: LIQUID FUEL RETAIL TARIFF */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-[#1C1C1C] text-xs uppercase tracking-wider">Forecourt Liquid Fuel Tariff</h3>
            <p className="text-[11px] text-gray-500 font-medium">Active pump dispenser price per liter</p>
          </div>
          <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 uppercase tracking-wider">
            Live Retail Rates
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-gray-50/90 backdrop-blur-sm">
              <tr className="border-b border-gray-100 text-gray-500 font-bold text-xs uppercase tracking-wider">
                <th className="py-4 px-6">Product</th>
                <th className="py-4 px-6">Storage Tank</th>
                <th className="py-4 px-6 text-right">Selling Price (per Liter)</th>
                <th className="py-4 px-6 text-center w-32">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-xs">
              {sortedTanks.map((tank) => {
                const isEditing = editingTankId === tank.id;
                return (
                  <tr key={tank.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="py-4 px-6">
                      <span className="font-bold text-[#1C1C1C] block text-sm">{tank.fuelType}</span>
                    </td>
                    <td className="py-4 px-6">
                      <span className="text-gray-500 font-medium">{tank.name}</span>
                    </td>
                    <td className="py-4 px-6 text-right">
                      {isEditing ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <span className="text-xs font-bold text-gray-400">Rs.</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={tempPrice || ''}
                            onChange={(e) => setTempPrice(parseFloat(e.target.value) || 0)}
                            className="w-28 px-2.5 py-1.5 bg-white border border-amber-500 rounded-lg text-right font-bold text-xs tabular-nums focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                            autoFocus
                          />
                        </div>
                      ) : (
                        <span className="font-extrabold text-[#1C1C1C] text-sm tabular-nums">
                          {formatCurrency(tank.pricePerLiter)}
                        </span>
                      )}
                    </td>
                    <td className="py-4 px-6 text-center">
                      {isEditing ? (
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleSaveEdit(tank.id)}
                            className="p-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg transition-colors"
                            title="Save Price"
                          >
                            <Save className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={handleCancelEdit}
                            className="p-1.5 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg transition-colors"
                            title="Cancel"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleStartEdit(tank)}
                          className="px-3 py-1.5 bg-gray-100 hover:bg-amber-500 hover:text-white text-gray-700 font-bold text-xs rounded-lg transition-colors flex items-center justify-center gap-1 mx-auto"
                        >
                          <Edit2 className="w-3 h-3" />
                          <span>Edit</span>
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* SECTION 3: FUTURE PRICE SCHEDULES */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden p-6 space-y-4">
        <div className="flex items-center gap-2 pb-3 border-b border-gray-100">
          <Clock className="w-4 h-4 text-gray-400" />
          <h3 className="font-bold text-[#1C1C1C] text-xs uppercase tracking-wider">Schedule Future Price Tariff</h3>
        </div>

        <form onSubmit={handleAddSchedule} className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div>
            <label className="block text-[11px] font-bold text-gray-500 mb-1">Fuel Type</label>
            <select
              value={schedFuelType}
              onChange={(e) => setSchedFuelType(e.target.value as FuelType)}
              className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 focus:bg-white focus:outline-none focus:border-amber-500"
            >
              {Array.from(new Set(sortedTanks.map(t => t.fuelType))).map(ft => (
                <option key={ft} value={ft}>{ft}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-gray-500 mb-1">New Price (Rs./L)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              required
              placeholder="0.00"
              value={schedPrice || ''}
              onChange={(e) => setSchedPrice(parseFloat(e.target.value) || 0)}
              className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 focus:bg-white focus:outline-none focus:border-amber-500 text-right tabular-nums"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-gray-500 mb-1">Effective Date &amp; Time</label>
            <input
              type="datetime-local"
              required
              value={schedDate}
              onChange={(e) => setSchedDate(e.target.value)}
              className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 focus:bg-white focus:outline-none focus:border-amber-500"
            />
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              className="w-full py-2 bg-[#1C1C1C] hover:bg-black text-white font-bold text-xs rounded-xl shadow-sm transition-colors"
            >
              Schedule Price
            </button>
          </div>
        </form>

        {priceSchedules.length > 0 && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Pending Price Adjustments</h4>
            <div className="space-y-2">
              {priceSchedules.map((sched) => (
                <div key={sched.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100 text-xs">
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-gray-900">{sched.fuelType}</span>
                    <span className="text-gray-400">→</span>
                    <span className="font-extrabold text-amber-600 tabular-nums">Rs. {sched.newPrice.toFixed(2)}</span>
                    <span className="text-gray-400">|</span>
                    <span className="text-gray-500">Effective: {new Date(sched.effectiveDate).toLocaleString()}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCancelSchedule(sched.id)}
                    className="text-red-500 hover:text-red-700 p-1"
                    title="Cancel Schedule"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
